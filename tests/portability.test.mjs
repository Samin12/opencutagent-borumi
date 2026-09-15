// Host portability gate: every skill must work in Codex (and any Agent-Skills host), not only Claude Code.
// - the procedure never hardcodes ${CLAUDE_PLUGIN_ROOT} or mcp__plugin_ tool names outside the "Host notes" block
// - every skill resolves BORUMI_PLUGIN_ROOT once, near the top
// - every skill ships agents/openai.yaml (Codex skill picker metadata)
// - no em dashes anywhere in user-visible skill text
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const skillDirs = existsSync(SKILLS)
  ? readdirSync(SKILLS).filter((n) => statSync(join(SKILLS, n)).isDirectory() && existsSync(join(SKILLS, n, "SKILL.md")))
  : [];

function stripHostNotes(text) {
  // Drop the frontmatter (Claude-only metadata that other hosts ignore) and everything from the
  // "Host notes" heading to the end of the file (Host notes is always the last section).
  const noFm = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const cut = noFm.search(/^#{1,6}\s+Host notes/m);
  return cut >= 0 ? noFm.slice(0, cut) : noFm;
}

test("skills exist", () => {
  assert.ok(skillDirs.length >= 10, `expected at least 10 skills, found ${skillDirs.length}: ${skillDirs.join(", ")}`);
});

for (const name of skillDirs) {
  const file = join(SKILLS, name, "SKILL.md");
  const text = readFileSync(file, "utf8");
  const body = stripHostNotes(text);

  test(`${name}: frontmatter has name and description`, () => {
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, "frontmatter block missing");
    assert.match(fm[1], /^name:\s*\S+/m);
    assert.match(fm[1], /^description:\s*\S+/m);
  });

  test(`${name}: no Claude-only path or tool names outside Host notes`, () => {
    const claudeRoot = (body.match(/\$\{CLAUDE_PLUGIN_ROOT\}/g) || []).length;
    const pluginTools = (body.match(/mcp__plugin_/g) || []).length;
    assert.equal(claudeRoot, 0, "${CLAUDE_PLUGIN_ROOT} appears outside the Host notes block; use $BORUMI_PLUGIN_ROOT");
    assert.equal(pluginTools, 0, "mcp__plugin_ tool names appear outside the Host notes block; name the Borumi tool instead");
  });

  test(`${name}: resolves BORUMI_PLUGIN_ROOT`, () => {
    assert.match(text, /BORUMI_PLUGIN_ROOT/, "skill never mentions BORUMI_PLUGIN_ROOT");
  });

  test(`${name}: ships agents/openai.yaml for Codex`, () => {
    const y = join(SKILLS, name, "agents", "openai.yaml");
    assert.ok(existsSync(y), `${y} missing (run node scripts/gen-openai-yaml.mjs)`);
    const yt = readFileSync(y, "utf8");
    assert.match(yt, /display_name:/);
    assert.match(yt, /short_description:/);
    assert.match(yt, /default_prompt:/);
  });

  test(`${name}: no em dashes`, () => {
    assert.ok(!text.includes("—"), "em dash found in SKILL.md");
  });
}

test("README documents Codex use", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /install-codex\.sh/, "README must show scripts/install-codex.sh");
  assert.match(readme, /\$borumi-visualize/, "README must show the Codex invocation $borumi-visualize");
});
