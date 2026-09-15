// scripts/kit.mjs: the workspace sync (hash stamp, additive copy, preserved guides with the
// Learnings-log merge, generated manifest), style discovery, and the CLI surface. No npm
// install and no browser download: those are exercised by hand (kit.mjs ensure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  guideVersion, mergePreservedGuide, syncTemplate, templateSignature, walkTemplate, listStyles, styleHasAudio, readStyleSkill, readFramesSkill,
  remotionCliEntry, tscEntry, depsInstalled, depsUpToDate, browserInstalled, ensureKit, kitStatusPath, writeJsonAtomic, readJson, pidAlive,
} from "../scripts/kit.mjs";
import { KIT_TEMPLATE_DIR } from "../scripts/lib/paths.mjs";

const KIT = fileURLToPath(new URL("../scripts/kit.mjs", import.meta.url));

function fakeTemplate(dir) {
  mkdirSync(join(dir, "src", "jobs"), { recursive: true });
  mkdirSync(join(dir, "styles", "foo"), { recursive: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fake-kit", dependencies: {} }));
  writeFileSync(join(dir, "package-lock.json"), "{}");
  writeFileSync(join(dir, "src", "jobs", "manifest.ts"), "export const jobs = [];\n");
  writeFileSync(join(dir, "styles", "foo", "style.json"), JSON.stringify({ id: "foo", name: "Foo", default: true }));
  writeFileSync(join(dir, "styles", "foo", "SKILL.md"), "<!-- guide-version: 1 -->\n# Foo guide v1\nold body\n\n## Learnings log (append here; newest wins)\n- shipped rule\n");
  writeFileSync(join(dir, "frames", "SKILL.md"), "<!-- guide-version: 1 -->\n# Frames v1\n\n## Learnings Log\n");
  writeFileSync(join(dir, "node_modules", "junk", "x.js"), "// never synced");
}

test("guideVersion reads the marker, 0 when absent", () => {
  assert.equal(guideVersion("<!-- guide-version: 3 -->\n# x"), 3);
  assert.equal(guideVersion("# no marker"), 0);
  assert.equal(guideVersion(null), 0);
});

test("mergePreservedGuide: a newer template body wins and the workspace's Learnings log entries ride along", () => {
  const ws = "<!-- guide-version: 1 -->\n# Guide\nold body\n\n## Learnings Log\nIntro line.\n- 2026-07-01 keep circles 12px padded\n* star rule\n2026-08-01 dated rule\n";
  const tmpl = "<!-- guide-version: 2 -->\n# Guide\nnew body\n\n## Learnings Log\nIntro line.\n";
  const merged = mergePreservedGuide(tmpl, ws);
  assert.ok(merged.includes("new body") && !merged.includes("old body"));
  assert.ok(merged.includes("- 2026-07-01 keep circles 12px padded"));
  assert.ok(merged.includes("* star rule") && merged.includes("2026-08-01 dated rule"));
  assert.equal(mergePreservedGuide(tmpl, merged), null, "equal version: leave the workspace alone");
  assert.equal(mergePreservedGuide("# no version", ws), null, "older template: leave it alone");
  // The shipped styles spell it "## Learnings log"; the match is case-insensitive on purpose.
  const lc = mergePreservedGuide(tmpl.replace("## Learnings Log", "## Learnings log"), ws.replace("## Learnings Log", "## Learnings log"));
  assert.ok(lc.includes("- 2026-07-01 keep circles 12px padded"));
  // Workspace without a log: the template replaces it outright.
  assert.equal(mergePreservedGuide(tmpl, "<!-- guide-version: 1 -->\n# Guide\nold body\n"), tmpl);
  // Template without a log heading: the old log is appended whole.
  const noHeading = mergePreservedGuide("<!-- guide-version: 2 -->\n# Guide\nnew body\n", ws);
  assert.ok(noHeading.endsWith("## Learnings Log\nIntro line.\n- 2026-07-01 keep circles 12px padded\n* star rule\n2026-08-01 dated rule\n"));
  // A log with only prose (no entries) does not survive: nothing to carry.
  assert.equal(mergePreservedGuide(tmpl, "<!-- guide-version: 1 -->\n# G\n\n## Learnings Log\nnothing yet\n"), tmpl);
});

test("syncTemplate: hash-stamped additive copy, preserved guides, generated manifest", () => {
  const tmp = mkdtempSync(join(tmpdir(), "borumi-kit-"));
  try {
    const tmpl = join(tmp, "template");
    const ws = join(tmp, "workspace");
    fakeTemplate(tmpl);
    assert.deepEqual(walkTemplate(tmpl, tmpl, []).sort(), ["frames/SKILL.md", "package.json", "src/jobs/manifest.ts", "styles/foo/SKILL.md", "styles/foo/style.json"]);
    const sig1 = templateSignature(tmpl);

    const first = syncTemplate(tmpl, ws);
    assert.equal(first.changed, true);
    assert.equal(first.copied, 5);
    assert.equal(readFileSync(join(ws, ".kit-version"), "utf8"), sig1);
    assert.equal(existsSync(join(ws, "node_modules")), false, "node_modules never syncs");
    assert.equal(existsSync(join(ws, "package-lock.json")), false, "lockfile never syncs");

    const again = syncTemplate(tmpl, ws);
    assert.equal(again.changed, false);
    assert.equal(again.copied, 0);

    // The user teaches the style something; the template body changes WITHOUT a version bump.
    writeFileSync(join(ws, "styles", "foo", "SKILL.md"), readFileSync(join(ws, "styles", "foo", "SKILL.md"), "utf8") + "- 2026-09-15 user rule: arrows pink\n");
    writeFileSync(join(tmpl, "styles", "foo", "SKILL.md"), "<!-- guide-version: 1 -->\n# Foo guide v1b\nedited body\n\n## Learnings log (append here; newest wins)\n- shipped rule\n");
    writeFileSync(join(ws, "src", "jobs", "manifest.ts"), "// registers anim-x\nexport const jobs = [1];\n");
    writeFileSync(join(tmpl, "package.json"), JSON.stringify({ name: "fake-kit", dependencies: { x: "1" } }));
    const third = syncTemplate(tmpl, ws);
    assert.equal(third.changed, true, "the signature moved");
    assert.notEqual(third.signature, sig1);
    const skill = readFileSync(join(ws, "styles", "foo", "SKILL.md"), "utf8");
    assert.ok(skill.includes("user rule: arrows pink") && !skill.includes("edited body"), "preserved guide untouched without a version bump");
    assert.ok(readFileSync(join(ws, "src", "jobs", "manifest.ts"), "utf8").includes("anim-x"), "generated manifest never clobbered");
    assert.ok(readFileSync(join(ws, "package.json"), "utf8").includes('"x"'), "ordinary files update");

    // Now bump the guide version: body replaced, the user's entry carried over.
    writeFileSync(join(tmpl, "styles", "foo", "SKILL.md"), "<!-- guide-version: 2 -->\n# Foo guide v2\nnew body\n\n## Learnings log (append here; newest wins)\n- shipped rule\n");
    syncTemplate(tmpl, ws);
    const merged = readFileSync(join(ws, "styles", "foo", "SKILL.md"), "utf8");
    assert.ok(merged.includes("new body") && merged.includes("- 2026-09-15 user rule: arrows pink") && !merged.includes("edited body"));

    // Style discovery across template + workspace.
    mkdirSync(join(ws, "styles", "mine"), { recursive: true });
    writeFileSync(join(ws, "styles", "mine", "style.json"), JSON.stringify({ id: "mine", name: "Mine", audio: true }));
    writeFileSync(join(ws, "styles", "mine", "SKILL.md"), "custom skill");
    mkdirSync(join(ws, "styles", "foo-shadow"), { recursive: true });
    writeFileSync(join(ws, "styles", "foo-shadow", "style.json"), JSON.stringify({ id: "foo", name: "Shadowed" }));
    const styles = listStyles({ templateDir: tmpl, workspaceDir: ws });
    assert.deepEqual(styles.map((s) => [s.id, s.custom, s.default, s.audio]), [["foo", false, true, false], ["mine", true, false, true]]);
    assert.equal(styles[0].name, "Foo", "a shipped id shadows a workspace copy");
    assert.equal(styleHasAudio("mine", { templateDir: tmpl, workspaceDir: ws }), true);
    assert.equal(styleHasAudio("foo", { templateDir: tmpl, workspaceDir: ws }), false);
    assert.equal(styleHasAudio("nope", { templateDir: tmpl, workspaceDir: ws }), false);
    assert.equal(readStyleSkill("mine", { templateDir: tmpl, workspaceDir: ws }), "custom skill");
    assert.ok(readStyleSkill("foo", { templateDir: tmpl, workspaceDir: ws }).includes("arrows pink"), "workspace copy first (it carries the log)");
    assert.equal(readStyleSkill("nope", { templateDir: tmpl, workspaceDir: ws }), "");
    assert.ok(readFramesSkill({ templateDir: tmpl, workspaceDir: ws }).includes("Frames v1"));

    // Nothing installed in a fresh workspace.
    assert.equal(depsInstalled(ws), false);
    assert.equal(depsUpToDate(ws), false);
    assert.equal(browserInstalled(ws), false);
    assert.equal(remotionCliEntry(ws, {}), join(ws, "node_modules", "@remotion", "cli", "remotion-cli.js"));
    assert.equal(remotionCliEntry(ws, { BORUMI_AGENT_REMOTION_CLI: "/fake/cli.mjs" }), "/fake/cli.mjs");
    assert.equal(tscEntry(ws), join(ws, "node_modules", "typescript", "bin", "tsc"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureKit with install off syncs and reports honestly", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "borumi-kit-ensure-"));
  try {
    const tmpl = join(tmp, "template");
    const ws = join(tmp, "workspace");
    fakeTemplate(tmpl);
    const steps = [];
    const report = await ensureKit({ templateDir: tmpl, workspaceDir: ws, install: false, browser: false, onProgress: (t, s) => steps.push(s) });
    assert.equal(report.kitDir, ws);
    assert.equal(report.synced, true);
    assert.equal(report.installed, false);
    assert.equal(report.browser, false);
    assert.deepEqual(steps, ["sync"]);
    await assert.rejects(() => ensureKit({ templateDir: join(tmp, "missing"), workspaceDir: ws, install: false }), /template folder is missing/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("the shipped template registers excalidraw (default), n8n and leo; styles are silent by default", () => {
  const styles = listStyles({ templateDir: KIT_TEMPLATE_DIR, workspaceDir: join(tmpdir(), "borumi-no-such-workspace") });
  assert.ok(styles.some((s) => s.id === "excalidraw" && s.default && !s.custom));
  assert.ok(styles.some((s) => s.id === "n8n" && !s.default && s.hasSrc));
  assert.ok(styles.some((s) => s.id === "leo" && !s.default && s.hasSrc));
  assert.ok(styles.every((s) => s.audio === false));
  assert.ok(/Learnings log/i.test(readStyleSkill("excalidraw", { templateDir: KIT_TEMPLATE_DIR, workspaceDir: "/nonexistent" })));
  assert.ok(/words\.json/.test(readStyleSkill("leo", { templateDir: KIT_TEMPLATE_DIR, workspaceDir: "/nonexistent" })));
  assert.ok(guideVersion(readFramesSkill({ templateDir: KIT_TEMPLATE_DIR, workspaceDir: "/nonexistent" })) >= 3);
});

test("status helpers: atomic json, pidAlive", () => {
  const tmp = mkdtempSync(join(tmpdir(), "borumi-kit-status-"));
  try {
    const p = join(tmp, "deep", "kit-status.json");
    writeJsonAtomic(p, { state: "done" });
    assert.deepEqual(readJson(p), { state: "done" });
    assert.equal(readJson(join(tmp, "missing.json"), "fallback"), "fallback");
    assert.equal(kitStatusPath("/w"), "/w/kit-status.json");
    assert.equal(pidAlive(process.pid), true);
    assert.equal(pidAlive(999999999), false);
    assert.equal(pidAlive(null), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI: path, styles, ensure --no-install (sync only), status, detach with nothing to install", () => {
  const home = mkdtempSync(join(tmpdir(), "borumi-kit-cli-"));
  const env = { ...process.env, BORUMI_AGENT_HOME: home };
  const run = (args) => {
    const r = spawnSync(process.execPath, [KIT, ...args], { env, encoding: "utf8" });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* not json */ }
    return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
  };
  try {
    let r = run(["path"]);
    assert.equal(r.code, 0);
    assert.equal(r.json.kitDir, join(home, "animation-kit"));
    assert.equal(r.json.synced, false);

    r = run(["styles"]);
    assert.equal(r.code, 0);
    assert.ok(r.json.some((s) => s.id === "excalidraw"));

    r = run(["status"]);
    assert.equal(r.json.state, "idle");

    r = run(["ensure", "--no-install", "--no-browser", "--quiet"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.synced, true);
    assert.equal(r.json.installed, false);
    assert.ok(existsSync(join(home, "animation-kit", "src", "jobs", "manifest.ts")));
    assert.ok(existsSync(join(home, "animation-kit", "styles", "excalidraw", "SKILL.md")));
    assert.ok(existsSync(join(home, "animation-kit", "GUIDE.md")));
    assert.equal(existsSync(join(home, "animation-kit", "node_modules")), false);

    r = run(["status"]);
    assert.equal(r.json.state, "done");
    r = run(["wait", "--timeout", "1"]);
    assert.equal(r.code, 0);
    assert.equal(r.json.state, "done");

    r = run(["ensure", "--detach", "--no-install", "--no-browser", "--quiet"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.state, "done", "nothing to install finishes inline");
    assert.equal(r.json.synced, false);

    r = run(["path"]);
    assert.equal(r.json.synced, true);
    r = run(["bogus"]);
    assert.equal(r.code, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
