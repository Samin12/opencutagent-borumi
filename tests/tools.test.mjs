// Tests for scripts/lib/tools.mjs (pure helpers), plus structural checks of the skills and the
// doctor that builder D owns: frontmatter shape, the borumi-editing load line, no em dashes.
// No Borumi needed: the tool list is checked against docs/borumi-guides/tools.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  BORUMI_TOOLS, PLUGIN_TOOL_PREFIX, MIN_BORUMI_VERSION, pluginToolName, errorCode, missingTools,
  badSchemaTools, parseVersion, versionAtLeast, parseToolResult, classifyAppStatus, toLines,
} from "../scripts/lib/tools.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EM_DASH = new RegExp("\\u2014");

test("BORUMI_TOOLS is a frozen, unique, snake_case list with the transaction trio", () => {
  assert.ok(Object.isFrozen(BORUMI_TOOLS));
  assert.ok(BORUMI_TOOLS.length >= 20);
  assert.equal(new Set(BORUMI_TOOLS).size, BORUMI_TOOLS.length, "duplicate names");
  for (const n of BORUMI_TOOLS) assert.match(n, /^[a-z][a-z0-9_]*$/, n);
  for (const n of ["begin_project_edit", "commit_project_edit", "abort_project_edit", "get_guides", "trim_timeline", "export_video"]) {
    assert.ok(BORUMI_TOOLS.includes(n), `missing ${n}`);
  }
});

test("every BORUMI_TOOLS name exists in Borumi's own tools.json with an object inputSchema", () => {
  const doc = JSON.parse(readFileSync(join(root, "docs", "borumi-guides", "tools.json"), "utf8"));
  const tools = doc.tools;
  assert.equal(tools.length, 45);
  assert.deepEqual(missingTools(BORUMI_TOOLS, tools), []);
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (const n of BORUMI_TOOLS) assert.equal(byName.get(n).inputSchema.type, "object", n);
  assert.deepEqual(badSchemaTools(tools), []);
});

test("pluginToolName prefixes the Claude Code plugin MCP name", () => {
  assert.equal(PLUGIN_TOOL_PREFIX, "mcp__plugin_borumi_borumi__");
  assert.equal(pluginToolName("get_timeline"), "mcp__plugin_borumi_borumi__get_timeline");
  assert.equal(pluginToolName(" trim_timeline "), "mcp__plugin_borumi_borumi__trim_timeline");
});

test("errorCode reads Borumi's '<code>: message' texts", () => {
  assert.equal(errorCode("guide_required: Call get_guides without arguments before using other Borumi tools, then retry."), "guide_required");
  assert.equal(errorCode("app_not_running: Borumi is not running."), "app_not_running");
  assert.equal(errorCode("unknown_id_alias: Borumi doesn't recognize this ID."), "unknown_id_alias");
  assert.equal(errorCode("invalid_request: Untargeted trim ranges overlap independent content edit sets."), "invalid_request");
  assert.equal(errorCode("# Borumi basics\n\nBorumi creates videos"), null);
  assert.equal(errorCode(""), null);
  assert.equal(errorCode(null), null);
});

test("missingTools and badSchemaTools", () => {
  assert.deepEqual(missingTools(["a", "b", "c"], [{ name: "a" }, "c"]), ["b"]);
  assert.deepEqual(missingTools(["a"], []), ["a"]);
  assert.deepEqual(missingTools([], null), []);
  assert.deepEqual(badSchemaTools([{ name: "x", inputSchema: { type: "object" } }, { name: "y", inputSchema: { type: "array" } }, { name: "z" }]), ["y", "z"]);
});

test("parseVersion and versionAtLeast", () => {
  assert.equal(parseVersion("v24.18.1"), "24.18.1");
  assert.equal(parseVersion("ffmpeg version 7.0.2-tessus"), "7.0.2");
  assert.equal(parseVersion("2.1.263 (Claude Code)"), "2.1.263");
  assert.equal(parseVersion("0.30"), "0.30");
  assert.equal(parseVersion("nope"), null);
  assert.equal(MIN_BORUMI_VERSION, "0.30.5");
  assert.equal(versionAtLeast("0.30.5", "0.30.5"), true);
  assert.equal(versionAtLeast("0.31.0", "0.30.5"), true);
  assert.equal(versionAtLeast("1.0", "0.30.5"), true);
  assert.equal(versionAtLeast("0.30.4", "0.30.5"), false);
  assert.equal(versionAtLeast("0.29.9", "0.30.5"), false);
  assert.equal(versionAtLeast("0.30", "0.30.5"), false);
  assert.equal(versionAtLeast("garbage", "0.30.5"), false);
  assert.equal(versionAtLeast("0.30.5", null), false);
});

test("parseToolResult handles errors, structuredContent, JSON text and prose", () => {
  const err = parseToolResult({ content: [{ type: "text", text: "app_not_running: Borumi is not running" }], isError: true });
  assert.deepEqual(err, { ok: false, code: "app_not_running", text: "app_not_running: Borumi is not running", data: null });
  const sc = parseToolResult({ content: [{ type: "text", text: "{\"projects\":[]}" }], structuredContent: { projects: [{ id: "a56d" }] }, isError: false });
  assert.equal(sc.ok, true);
  assert.equal(sc.data.projects[0].id, "a56d");
  const txt = parseToolResult({ content: [{ type: "text", text: "{\"active_project_id\":null,\"projects\":[]}" }], isError: false });
  assert.deepEqual(txt.data, { active_project_id: null, projects: [] });
  const prose = parseToolResult({ content: [{ type: "text", text: "# Borumi basics" }], isError: false });
  assert.equal(prose.ok, true);
  assert.equal(prose.data, null);
  assert.equal(prose.text, "# Borumi basics");
  assert.equal(parseToolResult(undefined).ok, true);
});

test("classifyAppStatus tells ok from app_not_running from other errors", () => {
  const ok = classifyAppStatus(parseToolResult({
    content: [{ type: "text", text: "{}" }],
    structuredContent: { active_project_id: "5842", projects: [{ id: "a56d", name: "smoke" }, { id: "5842", name: "viz", is_active: true }] },
  }));
  assert.equal(ok.status, "ok");
  assert.equal(ok.openProjects, 2);
  assert.equal(ok.activeProjectId, "5842");
  assert.deepEqual(ok.projectNames, ["smoke", "viz"]);
  const closed = classifyAppStatus(parseToolResult({ content: [{ type: "text", text: "app_not_running: Open Borumi first." }], isError: true }));
  assert.equal(closed.status, "app_not_running");
  assert.equal(closed.code, "app_not_running");
  assert.equal(closed.message, "app_not_running: Open Borumi first.");
  const other = classifyAppStatus(parseToolResult({ content: [{ type: "text", text: "guide_required: Call get_guides" }], isError: true }));
  assert.equal(other.status, "error");
  assert.equal(other.code, "guide_required");
  const empty = classifyAppStatus(parseToolResult({ content: [{ type: "text", text: "{\"active_project_id\":null,\"projects\":[]}" }] }));
  assert.equal(empty.status, "ok");
  assert.equal(empty.openProjects, 0);
});

test("toLines emits one key=value per line with no newlines in values", () => {
  const lines = toLines({
    server: { name: "borumi", version: "0.30.5", protocolVersion: "2025-06-18" },
    toolCount: 45, missing: ["x"], badSchema: [],
    app: { status: "error", code: "boom", message: "line one\nline two", openProjects: 0, activeProjectId: null, projectNames: [] },
  }).split("\n");
  assert.ok(lines.includes("server_version=0.30.5"));
  assert.ok(lines.includes("tool_count=45"));
  assert.ok(lines.includes("missing=x"));
  assert.ok(lines.includes("app_status=error"));
  assert.ok(lines.includes("app_message=line one line two"));
  for (const l of lines) assert.match(l, /^[a-z_]+=/);
  assert.equal(toLines({}).split("\n").length, 12);
});

/* ---------- structural checks of builder D's skills and doctor ---------- */

const MUTATING = ["cut", "silences", "retakes", "insert", "chapters", "captions", "export"];
const READ_ONLY = ["inspect", "setup", "open"];
const SKILLS = [...MUTATING, ...READ_ONLY];

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, "frontmatter block");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: m[2] };
}

for (const name of SKILLS) {
  test(`skills/${name}/SKILL.md has the agreed frontmatter, load line and no em dashes`, () => {
    const file = join(root, "skills", name, "SKILL.md");
    assert.ok(existsSync(file), `${file} exists`);
    const text = readFileSync(file, "utf8");
    assert.ok(!EM_DASH.test(text), "no em dashes");
    const { fm, body } = frontmatter(text);
    assert.equal(fm.name, name);
    assert.match(fm.description, /^"Borumi: /, "description starts with Borumi:");
    assert.match(fm["allowed-tools"], /Bash\((node|bash):\*\)/, "colon-form Bash allow");
    assert.match(fm["allowed-tools"], /mcp__plugin_borumi_borumi__/, "plugin MCP tools allowed");
    assert.ok(!/mcp__plugin_borumi_borumi__commit_project_edit\b/.test(fm["allowed-tools"]), "commit_project_edit is never pre-approved");
    if (MUTATING.includes(name)) assert.equal(fm["disable-model-invocation"], "true", "mutating skills are user-invoked only");
    const firstLine = body.trim().split("\n")[0];
    assert.match(firstLine, /skills\/borumi-editing\/SKILL\.md/, "first line loads borumi-editing");
    assert.match(firstLine, /\$BORUMI_PLUGIN_ROOT/, "load line uses the host-neutral plugin root");
    assert.ok(body.split("\n").length <= 320, "body under ~300 lines");
  });
}

test("scripts/doctor.sh follows the [ok]/[did]/[fix]/[note] contract and has no em dashes", () => {
  const text = readFileSync(join(root, "scripts", "doctor.sh"), "utf8");
  assert.ok(!EM_DASH.test(text));
  assert.match(text, /^#!\/usr\/bin\/env bash/);
  for (const p of ["'[ok]   %s\\n'", "'[did]  %s\\n'", "'[fix]  %s\\n'", "'[note] %s\\n'"]) assert.ok(text.includes(p), p);
  assert.ok(text.includes("--check"));
  assert.ok(text.includes("--install"));
  assert.ok(text.includes("thing(s) to fix"));
  assert.ok(text.includes("All set."));
  assert.ok(text.includes("scripts/lib/tools.mjs"), "doctor reuses the shared tool list and probe");
});

test("tests/smoke.mjs and scripts/lib/tools.mjs carry no em dashes", () => {
  for (const f of ["tests/smoke.mjs", "scripts/lib/tools.mjs"]) assert.ok(!EM_DASH.test(readFileSync(join(root, f), "utf8")), f);
});

/* ---------- the one-liners embedded in the skills must run against the real fixtures ---------- */

/** The JS inside `node --input-type=module -e '...'` of the first bash block after `marker`, with the plugin root spliced in. */
function embeddedProgram(skillFile, marker) {
  const text = readFileSync(join(root, "skills", skillFile), "utf8");
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `marker "${marker}" in ${skillFile}`);
  const block = /```bash\n([\s\S]*?)```/.exec(text.slice(at));
  assert.ok(block, "bash block after the marker");
  // blocks inside a numbered list are indented; strip the common indent first
  const lines = block[1].split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const body = lines.map((l) => l.slice(indent)).join("\n");
  const start = body.indexOf("-e '") + 4;
  const end = body.lastIndexOf("\n' ");
  assert.ok(start > 3 && end > start, "node -e '...' program");
  return body.slice(start, end).split("'\"$BORUMI_PLUGIN_ROOT\"'").join(root);
}

function runProgram(code, args) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", code, ...args], { encoding: "utf8" });
}

test("cut skill: the position checker accepts a correct targeted trim and flags the double-cut layout (fixtures)", () => {
  const code = embeddedProgram("cut/SKILL.md", "## The position checker");
  const tmp = join(root, "tests", ".tmp");
  mkdirSync(tmp, { recursive: true });
  const cuts = join(tmp, "cuts-1000-2000.json");
  writeFileSync(cuts, JSON.stringify({ ranges: [[1000, 2000]] }));
  const before = join(root, "tests", "fixtures", "timeline-before-trim.json");
  const after = join(root, "tests", "fixtures", "timeline-after-trims.json");
  const good = runProgram(code, [before, after, cuts, "camera_1,microphone_1,screen_1,media_overlay_1,text_overlay_1", "0", "11500"]);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal((good.stdout.match(/^ok /gm) || []).length, 5, good.stdout);
  assert.match(good.stdout, /camera_1 expected \[\[0,1000\],\[1000,8500\],\[8500,10500\]\]/);
  assert.match(good.stdout, /media_overlay_1 expected \[\[500,1500\],\[2000,5000\]\]/);
  // the fixture's layout was cut twice (probe of 2026-09-15): the checker must refuse it
  const bad = runProgram(code, [before, after, cuts, "layout", "0", "11500"]);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /MISMATCH layout expected \[\[0,2000\]\] got \[\[0,1000\]\]/);
});

test("silences skill: the preview one-liner runs against detect_speech ranges (fixture)", () => {
  const code = embeddedProgram("silences/SKILL.md", "## Procedure");
  const tmp = join(root, "tests", ".tmp");
  mkdirSync(tmp, { recursive: true });
  const out = join(tmp, "silences-cuts.json");
  const sil = join(root, "tests", "fixtures", "silences.json");
  const res = runProgram(code, [sil, out, "rapid", "700", "150", "0", "20600", "0,20600"]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const summary = JSON.parse(res.stdout.trim().split("\n").pop());
  assert.equal(summary.minMs, 120);
  assert.equal(summary.keepMs, 80);
  assert.ok(summary.count >= 1, JSON.stringify(summary));
  const file = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(Array.isArray(file.ranges) && file.ranges.length === summary.count);
  for (const [a, b] of file.ranges) assert.ok(b > a && a >= 0 && b <= 20600);
  assert.equal(summary.totalMs, file.ranges.reduce((n, [a, b]) => n + (b - a), 0));
  assert.ok(summary.top5.length <= 5 && summary.top5.length <= summary.count);
  // the default flags path (no pacing) keeps only silences >= 700 ms, of which this take has none
  const none = runProgram(code, [sil, out, "-", "700", "150", "0", "20600", "0,20600"]);
  assert.equal(none.status, 0);
  assert.equal(JSON.parse(none.stdout.trim().split("\n").pop()).count, 0);
});
