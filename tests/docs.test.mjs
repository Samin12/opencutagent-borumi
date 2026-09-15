// Guards the documentation and the kit wording (builder E's files): no em dashes anywhere in
// user-visible text, the Premiere-era words gone from the kit guides, the frames guide version
// bumped so preserved workspace copies pick the new text up, the notice and the CI workflow in
// place, and the README naming every command.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const DOCS = [
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "NOTICE.md",
  "docs/ARCHITECTURE.md",
  "docs/LESSONS.md",
  "animation-kit/GUIDE.md",
  "animation-kit/styles/README.md",
  "animation-kit/frames/SKILL.md",
  "animation-kit/src/Root.tsx",
  "animation-kit/src/components/DebugFrame.tsx",
  "animation-kit/remotion.config.ts",
  ".github/workflows/test.yml",
];

test("no em dashes in the documentation and kit wording", () => {
  for (const rel of DOCS) {
    const src = read(rel);
    const at = src.indexOf("\u2014");
    assert.equal(at, -1, `${rel} has an em dash near: ${JSON.stringify(src.slice(Math.max(0, at - 40), at + 40))}`);
  }
});

test("kit guides no longer talk about Premiere, the panel or the server", () => {
  for (const rel of ["animation-kit/GUIDE.md", "animation-kit/styles/README.md", "animation-kit/frames/SKILL.md"]) {
    const src = read(rel);
    assert.doesNotMatch(src, /premiere/i, `${rel} still mentions Premiere`);
    assert.doesNotMatch(src, /\bthe server\b/i, `${rel} still mentions the server`);
    assert.doesNotMatch(src, /opencutagent server/i, `${rel} still mentions the OpenCutAgent server`);
  }
  assert.doesNotMatch(read("animation-kit/styles/README.md"), /panel dropdown|Style dropdown/i);
});

test("frames guide: version 4, keepOut, and the time-budget table kept verbatim", () => {
  const src = read("animation-kit/frames/SKILL.md");
  assert.match(src.split("\n")[0], /^<!-- guide-version: 4 -->$/);
  assert.match(src, /keepOut/);
  for (const row of [
    "| under 0.7s         | nothing anchored. Let the footage speak; the narration carries it.       |",
    "| 0.7s to 1.5s       | ONE bare stroke: a border, an underline, an arrow, a circle. NO text.    |",
    "| 1.5s to 3s         | the stroke + at most one short label (1 to 3 words) that appears WITH    |",
    "| over 3s            | a label of up to ~6 words per line and one supporting element. Everything|",
  ]) assert.ok(src.includes(row), `time-budget row missing: ${row}`);
  for (const key of ['"rect"', '"from"', '"to"', '"text"', '"drawIn"', "expectMotion", "0.6s + 0.25s per word"]) {
    assert.ok(src.includes(key), `anchors contract lost ${key}`);
  }
});

test("kit GUIDE keeps the hard rules and gotchas, in Borumi terms", () => {
  const src = read("animation-kit/GUIDE.md");
  for (const rule of [
    "Only create/edit files inside YOUR job folder",
    "Duration, fps, width, height are fixed",
    "Silent unless your STYLE says otherwise",
    "Frame-pure and seeded",
    "No em dashes in on-screen text",
    "render.json",
    "Unseeded rough shapes boil",
    "Springs are front-loaded",
    "geometric (`z0*(z1/z0)^t`)",
    "SketchLoopArrow",
    "a beat needs >= 2s to read",
  ]) assert.ok(src.includes(rule), `GUIDE lost: ${rule}`);
  assert.match(src, /Borumi timeline/);
  assert.match(src, /job\.mjs typecheck/);
  assert.match(src, /job\.mjs still/);
  assert.match(src, /x >= 0\.775, y >= 0\.715/);
});

test("styles README ships exactly excalidraw, n8n and leo", () => {
  const src = read("animation-kit/styles/README.md");
  for (const id of ["`excalidraw/`", "`n8n/`", "`leo/`"]) assert.ok(src.includes(id), `missing ${id}`);
  assert.doesNotMatch(src, /^- `n8n-(brand|game|ui)\/`/m, "upstream-only styles must not be listed as shipped");
  assert.match(src, /~\/\.borumi-agent\/animation-kit\/styles/);
});

test("README covers install, prerequisites, every command, locations, Codex, v0.2, safety, license", () => {
  const src = read("README.md");
  assert.match(src, /claude plugin marketplace add Samin12\/samin-plugins/);
  assert.match(src, /claude plugin install borumi@samin-plugins/);
  assert.match(src, /claude --plugin-dir/);
  assert.match(src, /0\.30\.5/);
  assert.match(src, /Enable MCP/);
  assert.match(src, /\/borumi:setup --install/);
  for (const cmd of ["visualize", "cut", "silences", "retakes", "insert", "chapters", "captions", "inspect", "export", "open", "setup"]) {
    assert.ok(src.includes(`\`/borumi:${cmd}\``), `README table lacks /borumi:${cmd}`);
  }
  assert.match(src, /Agent\//);
  assert.match(src, /~\/\.borumi-agent/);
  assert.match(src, /borumi_mcp\.py/);
  assert.match(src, /v0\.2/);
  assert.match(src, /Commons Clause/);
});

test("NOTICE credits OpenCutAgent and the LICENSE is untouched upstream text", () => {
  const notice = read("NOTICE.md");
  assert.match(notice, /https:\/\/github\.com\/leonardogrig\/opencutagent/);
  assert.match(notice, /Leonardo Grigorio/);
  const license = read("LICENSE");
  assert.match(license, /"Commons Clause" License Condition v1\.0/);
  assert.match(license, /Licensor: Leonardo Grigorio/);
});

test("LESSONS opens with the Borumi section and keeps the Premiere-era archive below it", () => {
  const src = read("docs/LESSONS.md");
  const borumi = src.indexOf("# Borumi plugin (2026-09-15)");
  const archive = src.indexOf("# OpenCutAgent (Premiere era) history, kept for reference");
  assert.ok(borumi > -1 && archive > borumi, "section order");
  assert.ok(src.indexOf("Original CLAUDE.md (archived 2026-09-07)") > archive, "upstream history missing");
  assert.match(src, /unknown_id_alias/);
  assert.match(src, /screen_2/);
});

test("CI runs on macOS with Node 20 and 22 and never installs the kit", () => {
  const yml = read(".github/workflows/test.yml");
  assert.match(yml, /runs-on: macos-latest/);
  assert.match(yml, /node: \[20, 22\]/);
  assert.match(yml, /node scripts\/check\.mjs/);
  assert.match(yml, /node --test tests\/\*\.test\.mjs/);
  assert.doesNotMatch(yml, /run:.*npm (ci|install)/, "no step may install the kit");
});

test("the workflow file and the notice exist where the README points", () => {
  assert.ok(existsSync(join(root, ".github/workflows/test.yml")));
  assert.ok(existsSync(join(root, "NOTICE.md")));
});
