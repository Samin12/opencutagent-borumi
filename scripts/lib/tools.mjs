// The Borumi tool surface this plugin relies on, in one place: the tool names the skills call,
// the plugin tool prefix, the Borumi version floor, and a small stdio JSON-RPC probe shared by
// scripts/doctor.sh and tests/smoke.mjs. The pure helpers are exported for tests; only
// probeBorumi() spawns anything.
//
//   node scripts/lib/tools.mjs probe [--bin <path>] [--lines]   JSON report (or key=value lines for bash)
//   node scripts/lib/tools.mjs version-ge <a> <b>               exit 0 when version a >= version b
//   node scripts/lib/tools.mjs list                             the tool names, one per line
//
// Verified shapes (Borumi 0.30.5, 2026-09-15): every tools/call answer is {content:[{type:"text",text}],
// structuredContent?, isError}. An error's text is "<code>: <message>" (guide_required,
// app_not_running, unknown_id_alias, invalid_request, ...). tools/list and get_guides answer even
// when the app is closed; every project tool then returns app_not_running.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BORUMI_BIN = process.env.BORUMI_BIN || "/Applications/Borumi.app/Contents/MacOS/borumi";
export const MIN_BORUMI_VERSION = "0.30.5";
export const PLUGIN_TOOL_PREFIX = "mcp__plugin_borumi_borumi__";
export const PROTOCOL_VERSION = "2025-06-18";

/** Every Borumi tool a plugin skill calls. The smoke test asserts these exact names, not a count. */
export const BORUMI_TOOLS = Object.freeze([
  // session and navigation
  "get_guides",
  "list_recent_projects",
  "list_open_projects",
  "get_ui_state",
  "focus_project",
  "open_project",
  // reads
  "get_project_overview",
  "get_scenes",
  "get_timeline",
  "get_transcript",
  "request_transcriptions",
  "detect_speech",
  "inspect_timeline",
  // exports
  "export_video",
  "export_audio",
  "export_transcript",
  "get_export_status",
  "cancel_export",
  // transactions
  "begin_project_edit",
  "import_media",
  "get_media_import_status",
  "add_segments",
  "trim_timeline",
  "untrim_segments",
  "split_segments",
  "delete_segments",
  "update_segments",
  "commit_project_edit",
  "abort_project_edit",
]);

/** "get_timeline" -> "mcp__plugin_borumi_borumi__get_timeline" (the name Claude Code gives a plugin MCP tool). */
export function pluginToolName(name) {
  return PLUGIN_TOOL_PREFIX + String(name || "").trim();
}

/** Error code of a Borumi error text ("guide_required: Call get_guides ..." -> "guide_required"), null when none. */
export function errorCode(text) {
  const m = /^\s*([a-z][a-z0-9_]*)\s*:/.exec(String(text || ""));
  return m ? m[1] : null;
}

/** Names in `expected` that are absent from `listed` (strings or {name} objects), in expected order. */
export function missingTools(expected, listed) {
  const have = new Set((listed || []).map((t) => (typeof t === "string" ? t : t && t.name)).filter(Boolean));
  return (expected || []).filter((n) => !have.has(n));
}

/** Tools whose inputSchema is not an object schema (the smoke test's second assertion). */
export function badSchemaTools(listed) {
  return (listed || [])
    .filter((t) => !(t && t.inputSchema && typeof t.inputSchema === "object" && t.inputSchema.type === "object"))
    .map((t) => (t && t.name) || "?");
}

/** "0.30.5" / "v24.18.1" / "ffmpeg version 7.0.2-tessus" -> "0.30.5" style string, null when absent. */
export function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ""));
  return m ? `${m[1]}.${m[2]}${m[3] != null ? "." + m[3] : ""}` : null;
}

/** Numeric dotted compare: versionAtLeast("0.31.0", "0.30.5") is true; unparsable input is false. */
export function versionAtLeast(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return false;
  const A = pa.split(".").map(Number), B = pb.split(".").map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Normalize one tools/call result: {ok, code, text, data}. `data` is structuredContent when present,
 * else the text parsed as JSON, else null. Errors carry their code.
 */
export function parseToolResult(result) {
  const r = result || {};
  const text = (Array.isArray(r.content) ? r.content : [])
    .filter((c) => c && c.type === "text")
    .map((c) => c.text || "")
    .join("\n");
  if (r.isError) return { ok: false, code: errorCode(text) || "error", text, data: null };
  let data = r.structuredContent != null ? r.structuredContent : null;
  if (data == null && text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { ok: true, code: null, text, data };
}

/**
 * What a list_open_projects answer says about the app: {status:"ok"|"app_not_running"|"error", code,
 * message, openProjects, activeProjectId, projectNames}.
 */
export function classifyAppStatus(parsed) {
  const p = parsed || {};
  if (!p.ok) {
    const code = p.code || "error";
    return {
      status: code === "app_not_running" ? "app_not_running" : "error",
      code,
      message: String(p.text || "").split("\n")[0],
      openProjects: 0,
      activeProjectId: null,
      projectNames: [],
    };
  }
  const projects = Array.isArray(p.data && p.data.projects) ? p.data.projects : [];
  return {
    status: "ok",
    code: null,
    message: "",
    openProjects: projects.length,
    activeProjectId: (p.data && p.data.active_project_id) || null,
    projectNames: projects.map((x) => x && x.name).filter(Boolean),
  };
}

/** key=value lines for bash consumers (scripts/doctor.sh). Values never contain newlines. */
export function toLines(report) {
  const r = report || {};
  const app = r.app || {};
  const server = r.server || {};
  const one = (v) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ");
  return [
    `server_name=${one(server.name)}`,
    `server_version=${one(server.version)}`,
    `protocol_version=${one(server.protocolVersion)}`,
    `tool_count=${one(r.toolCount || 0)}`,
    `missing=${one((r.missing || []).join(","))}`,
    `bad_schema=${one((r.badSchema || []).join(","))}`,
    `app_status=${one(app.status)}`,
    `app_code=${one(app.code)}`,
    `app_message=${one(app.message)}`,
    `open_projects=${one(app.openProjects || 0)}`,
    `active_project=${one(app.activeProjectId)}`,
    `project_names=${one((app.projectNames || []).join(" | "))}`,
  ].join("\n");
}

/** Minimal line-delimited JSON-RPC client over the borumi binary's stdio. */
function startClient(bin, { timeoutMs = 15000 } = {}) {
  const child = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map();
  let buf = "";
  let seq = 0;
  let exited = null;
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg && msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg);
      }
    }
  });
  const failAll = (err) => {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(err); pending.delete(id); }
  };
  child.on("error", (e) => { exited = e; failAll(new Error(`could not start ${bin} mcp: ${e.message}`)); });
  child.on("exit", (code, signal) => {
    exited = exited || new Error(`borumi mcp exited (${signal || code}) before answering`);
    failAll(exited);
  });
  function request(method, params) {
    return new Promise((resolve, reject) => {
      if (exited) return reject(exited);
      const id = ++seq;
      const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs} ms`)); }
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  function close() {
    try { child.stdin.end(); } catch { /* already closed */ }
    try { child.kill(); } catch { /* already gone */ }
  }
  return { request, notify, close };
}

/**
 * Spawn `borumi mcp`, initialize, list tools, fetch the basics guide (Borumi gates every other
 * tool on it), then call list_open_projects to learn whether the app is running.
 * Resolves {bin, server, toolCount, tools, missing, badSchema, app}; rejects only when the
 * binary cannot be started or does not answer.
 */
export async function probeBorumi({ bin = BORUMI_BIN, timeoutMs = 15000, expected = BORUMI_TOOLS } = {}) {
  if (!existsSync(bin)) throw new Error(`Borumi binary not found at ${bin}`);
  const client = startClient(bin, { timeoutMs });
  try {
    const init = await client.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "borumi-plugin-probe", version: "0.1.0" },
    });
    const info = (init.result && init.result.serverInfo) || {};
    client.notify("notifications/initialized", {});
    const list = await client.request("tools/list", {});
    const tools = (list.result && list.result.tools) || [];
    await client.request("tools/call", { name: "get_guides", arguments: {} });
    const lop = await client.request("tools/call", { name: "list_open_projects", arguments: {} });
    const app = classifyAppStatus(parseToolResult(lop.result));
    return {
      bin,
      server: { name: info.name || "", version: info.version || "", protocolVersion: (init.result && init.result.protocolVersion) || "" },
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name, objectSchema: !!(t.inputSchema && t.inputSchema.type === "object") })),
      missing: missingTools(expected, tools),
      badSchema: badSchemaTools(tools),
      app,
    };
  } finally {
    client.close();
  }
}

/* ---------- CLI ---------- */

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "list") {
    process.stdout.write(BORUMI_TOOLS.join("\n") + "\n");
    return 0;
  }
  if (cmd === "version-ge") {
    return versionAtLeast(rest[0], rest[1]) ? 0 : 1;
  }
  if (cmd === "probe") {
    const bin = argValue(rest, "--bin") || BORUMI_BIN;
    const timeoutMs = Number(argValue(rest, "--timeout-ms")) || 15000;
    try {
      const report = await probeBorumi({ bin, timeoutMs });
      process.stdout.write((rest.includes("--lines") ? toLines(report) : JSON.stringify(report, null, 1)) + "\n");
      return 0;
    } catch (e) {
      process.stderr.write(`probe failed: ${e.message}\n`);
      if (rest.includes("--lines")) process.stdout.write(`probe_error=${String(e.message).replace(/[\r\n]+/g, " ")}\n`);
      return 2;
    }
  }
  process.stderr.write("usage: tools.mjs list | version-ge <a> <b> | probe [--bin <path>] [--lines]\n");
  return 2;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`${e.message}\n`); process.exit(2); });
}
