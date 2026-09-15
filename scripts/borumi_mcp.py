#!/usr/bin/env python3
"""Persistent Borumi MCP session over stdio JSON-RPC.

Use it from any agent host that cannot hold an MCP connection itself (Codex, cron jobs, shell
scripts) or when a flow needs dozens of calls without chat overhead. Inside Claude Code the plugin's
own MCP server (`mcp__plugin_borumi_borumi__*` tools) is the normal path; this script is the fallback
and the batch driver.

  python3 borumi_mcp.py start                          # daemon: initialize + get_guides once, then serve a FIFO
  python3 borumi_mcp.py call <tool> '<json args>' [timeout_s]
  python3 borumi_mcp.py guides <id> [<id> ...]          # fetch guides one at a time (guides gate tools per connection)
  python3 borumi_mcp.py tools                          # list tool names
  python3 borumi_mcp.py stop

Environment:
  BORUMI_BIN        path to the borumi executable (default /Applications/Borumi.app/Contents/MacOS/borumi)
  BORUMI_SESS_DIR   where the FIFO and responses live (default ~/.borumi-agent/sess)
  MCP_OUT=<file>    also save the raw response of a call
  MCP_SC=1          also print structuredContent when the tool returned text

A `guide_required` error is handled once per call: the named guide is fetched and the call retried.
Borumi must be open (Settings > AI > Enable MCP) for every project tool; `tools` and `guides` work
with the app closed.
"""
import json, os, queue, re, subprocess, sys, threading, time, uuid

BIN = os.environ.get("BORUMI_BIN") or "/Applications/Borumi.app/Contents/MacOS/borumi"
BASE = os.environ.get("BORUMI_SESS_DIR") or os.path.expanduser("~/.borumi-agent/sess")
FIFO = os.path.join(BASE, "req.fifo")
RESP = os.path.join(BASE, "resp")
LOG = os.path.join(BASE, "daemon.log")
READY = os.path.join(BASE, "ready")
PIDFILE = os.path.join(BASE, "daemon.pid")
GUIDE_RE = re.compile(r'guide_ids"?\s*:\s*\[\s*"([a-z_]+)"', re.I)


def daemon():
    os.makedirs(RESP, exist_ok=True)
    for stale in (FIFO, READY):
        if os.path.exists(stale):
            os.remove(stale)
    os.mkfifo(FIFO)
    proc = subprocess.Popen([BIN, "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=open(LOG, "a"), text=True, bufsize=1)
    open(PIDFILE, "w").write(str(os.getpid()))
    q = queue.Queue()

    def reader():
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                q.put(json.loads(line))
            except Exception:
                q.put({"raw": line})

    threading.Thread(target=reader, daemon=True).start()
    seq = [0]
    fetched = set()

    def rpc(method, params, timeout=120):
        seq[0] += 1
        i = seq[0]
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}) + "\n")
        proc.stdin.flush()
        t0 = time.time()
        notes = []
        while time.time() - t0 < timeout:
            try:
                m = q.get(timeout=1)
            except queue.Empty:
                continue
            if m.get("id") == i:
                return m, notes
            notes.append(m)
        return {"error": {"message": "timeout"}}, notes

    def tool_call(name, args, timeout):
        m, notes = rpc("tools/call", {"name": name, "arguments": args}, timeout)
        result = m.get("result") or {}
        text = "\n".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text") if isinstance(result, dict) else ""
        if isinstance(result, dict) and result.get("isError") and "guide_required" in text:
            gm = GUIDE_RE.search(text)
            if gm and gm.group(1) not in fetched:
                fetched.add(gm.group(1))
                rpc("tools/call", {"name": "get_guides", "arguments": {"guide_ids": [gm.group(1)]}}, 60)
                m, notes = rpc("tools/call", {"name": name, "arguments": args}, timeout)
        return m, notes

    rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "borumi-plugin", "version": "0.1.0"}})
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    proc.stdin.flush()
    rpc("tools/call", {"name": "get_guides", "arguments": {}})
    open(READY, "w").write("ok")
    while True:
        with open(FIFO) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    req = json.loads(line)
                except Exception:
                    continue
                rid = req["rid"]
                if req.get("tool") == "__quit__":
                    open(os.path.join(RESP, rid + ".json"), "w").write("{}")
                    proc.terminate()
                    for stale in (FIFO, READY, PIDFILE):
                        if os.path.exists(stale):
                            os.remove(stale)
                    return
                if req.get("tool") == "__tools__":
                    m, notes = rpc("tools/list", {}, 60)
                elif req.get("tool") == "get_guides" and req.get("args", {}).get("guide_ids"):
                    fetched.update(req["args"]["guide_ids"])
                    m, notes = rpc("tools/call", {"name": "get_guides", "arguments": req["args"]}, req.get("timeout", 120))
                else:
                    m, notes = tool_call(req["tool"], req.get("args", {}), req.get("timeout", 120))
                tmp = os.path.join(RESP, rid + ".json.tmp")
                open(tmp, "w").write(json.dumps({"response": m, "notifications": notes}))
                os.rename(tmp, os.path.join(RESP, rid + ".json"))


def call(tool, args, timeout=120):
    if not os.path.exists(FIFO):
        return {"error": "session not running: start it with `borumi_mcp.py start &` and wait for the ready file"}
    rid = uuid.uuid4().hex
    with open(FIFO, "w") as f:
        f.write(json.dumps({"rid": rid, "tool": tool, "args": args, "timeout": timeout}) + "\n")
    path = os.path.join(RESP, rid + ".json")
    t0 = time.time()
    while not os.path.exists(path):
        time.sleep(0.2)
        if time.time() - t0 > timeout + 10:
            return {"error": "client timeout"}
    return json.load(open(path))


def print_result(r):
    resp = r.get("response", {})
    out = resp.get("result", resp.get("error"))
    if isinstance(out, dict) and "content" in out:
        txt = "\n".join(c.get("text", "") for c in out["content"] if c.get("type") == "text")
        sc = out.get("structuredContent")
        print(txt if txt else json.dumps(sc, indent=1))
        if sc and txt and os.environ.get("MCP_SC"):
            print("\n[structuredContent]\n" + json.dumps(sc, indent=1))
        if out.get("isError"):
            sys.exit(2)
    else:
        print(json.dumps(out, indent=1))
    if os.environ.get("MCP_OUT"):
        open(os.environ["MCP_OUT"], "w").write(json.dumps(r, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "start":
        daemon()
    elif cmd == "stop":
        print(json.dumps(call("__quit__", {}, 10)))
    elif cmd == "tools":
        r = call("__tools__", {}, 60)
        tools = (r.get("response", {}).get("result") or {}).get("tools", [])
        for t in tools:
            print(t["name"])
    elif cmd == "guides":
        for gid in sys.argv[2:]:
            r = call("get_guides", {"guide_ids": [gid]}, 60)
            print(f"### {gid}")
            print_result(r)
    elif cmd == "call":
        tool = sys.argv[2]
        args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        to = int(sys.argv[4]) if len(sys.argv) > 4 else 120
        print_result(call(tool, args, to))
    else:
        print(__doc__)
        sys.exit(1)
