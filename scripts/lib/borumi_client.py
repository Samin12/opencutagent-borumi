"""One Borumi MCP connection as a Python object (stdio JSON-RPC).

A transaction lives on the connection that began it, so any script that stages and commits an edit
must do the whole thing on one client instance. Ids returned by Borumi are stable, but a connection
can only use an id it has already seen in one of its own listings or reads; list before you use.

    from borumi_client import BorumiClient
    with BorumiClient() as b:
        b.guides("project_edits", "editing")
        projects = b.call("list_open_projects")
"""
import json
import os
import queue
import re
import subprocess
import threading
import time

BORUMI_BIN = os.environ.get("BORUMI_BIN") or "/Applications/Borumi.app/Contents/MacOS/borumi"
GUIDE_RE = re.compile(r'guide_ids"?\s*:\s*\[\s*"([a-z_]+)"', re.I)


class BorumiError(Exception):
    def __init__(self, tool, message, args=None):
        super().__init__(f"{tool}: {message}")
        self.tool = tool
        self.message = message
        self.args_sent = args


class BorumiClient:
    def __init__(self, client_name="borumi-plugin", log_path=None, default_timeout=180):
        self.client_name = client_name
        self.log_path = log_path
        self.default_timeout = default_timeout
        self.proc = None
        self.q = queue.Queue()
        self.seq = 0
        self.fetched_guides = set()
        self.calls = []

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()

    def start(self):
        stderr = open(self.log_path, "a") if self.log_path else subprocess.DEVNULL
        self.proc = subprocess.Popen([BORUMI_BIN, "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=stderr, text=True, bufsize=1)

        def reader():
            for line in self.proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    self.q.put(json.loads(line))
                except Exception:
                    self.q.put({"raw": line})

        threading.Thread(target=reader, daemon=True).start()
        self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                "clientInfo": {"name": self.client_name, "version": "0.1.0"}})
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.proc.stdin.flush()
        self.rpc("tools/call", {"name": "get_guides", "arguments": {}})

    def close(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()

    def rpc(self, method, params, timeout=None):
        timeout = timeout or self.default_timeout
        self.seq += 1
        i = self.seq
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                m = self.q.get(timeout=1)
            except queue.Empty:
                continue
            if m.get("id") == i:
                return m
        return {"error": {"message": f"timeout after {timeout}s"}}

    def tools(self):
        m = self.rpc("tools/list", {}, 60)
        return [t["name"] for t in (m.get("result") or {}).get("tools", [])]

    def guides(self, *ids):
        for gid in ids:
            if gid in self.fetched_guides:
                continue
            self.rpc("tools/call", {"name": "get_guides", "arguments": {"guide_ids": [gid]}}, 60)
            self.fetched_guides.add(gid)

    def call(self, tool, args=None, timeout=None, _retry=True):
        """Call a tool; returns parsed structuredContent (or parsed text). Raises BorumiError on isError."""
        args = args or {}
        m = self.rpc("tools/call", {"name": tool, "arguments": args}, timeout)
        result = m.get("result")
        if result is None:
            err = m.get("error") or {}
            raise BorumiError(tool, err.get("message", "no result"), args)
        text = "\n".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")
        self.calls.append({"tool": tool, "args": args, "isError": bool(result.get("isError")), "text": text[:500]})
        if result.get("isError"):
            if _retry and "guide_required" in text:
                gm = GUIDE_RE.search(text)
                if gm and gm.group(1) not in self.fetched_guides:
                    self.guides(gm.group(1))
                    return self.call(tool, args, timeout, _retry=False)
            raise BorumiError(tool, text.strip(), args)
        sc = result.get("structuredContent")
        if sc is not None:
            return sc
        try:
            return json.loads(text) if text[:1] in "{[" else text
        except Exception:
            return text

    # ---- convenience -------------------------------------------------------------------------

    def find_project(self, ref):
        """Resolve an open project by id, name or path; returns the project dict or None."""
        lp = self.call("list_open_projects")
        for pr in lp.get("projects", []):
            if ref in (pr.get("id"), pr.get("name"), pr.get("path")):
                return pr
        if len(lp.get("projects", [])) == 1 and ref in (None, "", "active"):
            return lp["projects"][0]
        if lp.get("active_project_id") and ref in (None, "", "active"):
            return next((pr for pr in lp["projects"] if pr["id"] == lp["active_project_id"]), None)
        return None

    def timeline(self, tx_id, start_ms, end_ms, detail="segments", fields=("media", "properties"), layers=None):
        args = {"tx_id": tx_id, "range": {"start_ms": max(0, start_ms), "end_ms": end_ms}, "detail": detail}
        if fields:
            args["segment_fields"] = list(fields)
        if layers:
            args["layers"] = list(layers)
        return self.call("get_timeline", args)

    def timeline_project(self, project_id, start_ms, end_ms, detail="segments", fields=("media", "properties")):
        args = {"project_id": project_id, "range": {"start_ms": max(0, start_ms), "end_ms": end_ms}, "detail": detail}
        if fields:
            args["segment_fields"] = list(fields)
        return self.call("get_timeline", args)

    def import_media(self, tx_id, path):
        imp = self.call("import_media", {"tx_id": tx_id, "file_path": os.path.abspath(path)})
        while imp.get("status") in ("queued", "running"):
            time.sleep(max(0.5, (imp.get("poll_after_ms") or 1000) / 1000))
            imp = self.call("get_media_import_status", {"import_id": imp["import_id"]})
        if imp.get("status") != "completed":
            raise BorumiError("import_media", f"import ended with status {imp.get('status')}", {"path": path})
        return imp["media"]

    def inspect_moment(self, tx_id_or_project, t_ms, quality="medium", view=None):
        """One frame near project time t_ms (Borumi has no frame-at-time parameter). Returns the frame dict."""
        key, val = tx_id_or_project
        args = {key: val, "range": {"start_ms": max(0, t_ms), "end_ms": max(0, t_ms) + 34},
                "view": view or {"type": "render"}, "presentation": "frames", "quality": quality,
                "sampling": {"type": "uniform", "max_frames": 1}, "save": True, "include_images": False}
        r = self.call("inspect_timeline", args)
        frames = r.get("frames") or []
        return frames[0] if frames else None

    def export_video(self, project_id, range_spec, settings, output_path=None):
        args = {"project_id": project_id, "range": range_spec, "settings": settings}
        if output_path:
            args["output_path"] = os.path.abspath(output_path)
        ex = self.call("export_video", args)
        eid = ex.get("export_id")
        while ex.get("status") in ("queued", "running", "exporting", "processing"):
            time.sleep(max(1, (ex.get("poll_after_ms") or 5000) / 1000))
            ex = self.call("get_export_status", {"export_id": eid})
        return ex
