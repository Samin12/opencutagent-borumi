#!/usr/bin/env node
// Write skills/<name>/agents/openai.yaml (Codex skill-picker metadata) from each SKILL.md frontmatter.
// Idempotent; run after editing a skill's description:  node scripts/gen-openai-yaml.mjs [--check]
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const check = process.argv.includes("--check");

const PROMPTS = {
  "borumi-editing": "Use $borumi-editing before any Borumi edit: transaction discipline, tool map, and the verified quirks.",
  visualize: "Use $borumi-visualize to design and render an animation for scene 3 of my open Borumi project and place it behind my camera.",
  cut: "Use $borumi-cut to remove a range from my open Borumi project after showing me the plan.",
  silences: "Use $borumi-silences to preview and remove the dead air in scene 2 of my open Borumi project.",
  retakes: "Use $borumi-retakes to find my repeated takes and false starts in scene 2 and cut all but the best pass.",
  insert: "Use $borumi-insert to put this b-roll clip at 1:23 for 4 seconds behind my camera.",
  chapters: "Use $borumi-chapters to add chapter cards to my project and write the YouTube chapters file.",
  captions: "Use $borumi-captions to add styled captions to scene 1.",
  inspect: "Use $borumi-inspect to show me the scenes, layers and transcript of my open Borumi project.",
  export: "Use $borumi-export to export scene 3 at 1080p and give me a phone-sized copy.",
  setup: "Use $borumi-setup to check this machine and install the animation kit workspace.",
  open: "Use $borumi-open to open my most recent Borumi project.",
};

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const k = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (k) out[k[1]] = k[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function titleCase(name) {
  return name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function yamlQuote(s) {
  return JSON.stringify(String(s));
}

let changed = 0, missing = 0;
for (const name of readdirSync(SKILLS)) {
  const dir = join(SKILLS, name);
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, "SKILL.md"))) continue;
  const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
  const desc = (fm.description || "").replace(/^Borumi:\s*/i, "");
  const short = desc.split(/(?<=\.)\s/)[0].slice(0, 110);
  const display = name === "borumi-editing" ? "Borumi Editing" : `Borumi ${titleCase(name)}`;
  const y = `interface:\n  display_name: ${yamlQuote(display)}\n  short_description: ${yamlQuote(short)}\n  default_prompt: ${yamlQuote(PROMPTS[name] || `Use $borumi-${name} on my open Borumi project.`)}\n`;
  const target = join(dir, "agents", "openai.yaml");
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === y) continue;
  if (check) { missing++; console.error(`stale or missing: ${target}`); continue; }
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(target, y);
  changed++;
  console.error(`wrote ${target}`);
}
if (check && missing) process.exit(1);
console.log(JSON.stringify({ changed, missing }));
