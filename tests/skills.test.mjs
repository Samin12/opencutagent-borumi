// Lints the skill and agent documents: frontmatter shape, house rules (no em dashes),
// every Borumi tool and guide id they name exists in docs/borumi-guides/tools.json,
// every reference file they point at exists, every script call matches the job.mjs
// contract, and the layout JSON they carry parses with the camera drawn last.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const OWNED = [
  "skills/borumi-editing/SKILL.md",
  "skills/borumi-editing/references/borumi-mcp-cookbook.md",
  "skills/borumi-editing/references/segment-schemas.md",
  "skills/borumi-editing/references/treatment.md",
  "skills/borumi-editing/references/recovery.md",
  "skills/visualize/SKILL.md",
  "skills/visualize/references/placement.md",
  "skills/visualize/references/script-markers.md",
  "skills/visualize/references/design-rules.md",
  "agents/animator.md",
  "skills/borumi-editing/agents/openai.yaml",
  "skills/visualize/agents/openai.yaml",
];

/** The body of a SKILL.md without its frontmatter and without the "## Host notes" section. */
export function bodyWithoutHostNotes(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body.replace(/^## Host notes[\s\S]*?(?=^## )/m, "");
}

test("procedures use $BORUMI_PLUGIN_ROOT and bare Borumi tool names; Host notes carry the Claude Code mapping", () => {
  for (const rel of ["skills/borumi-editing/SKILL.md", "skills/visualize/SKILL.md"]) {
    const text = read(rel);
    assert.match(text, /^## Host notes$/m, `${rel} has a Host notes section`);
    assert.match(text, /BORUMI_PLUGIN_ROOT/, `${rel} names BORUMI_PLUGIN_ROOT`);
    const body = bodyWithoutHostNotes(text);
    const loadLine = body.trim().split("\n").find((l) => /borumi-editing\/SKILL\.md/.test(l)) || "";
    const rest = body.replace(loadLine, "");
    assert.ok(!/\$\{CLAUDE_PLUGIN_ROOT\}/.test(rest), `${rel}: only the load line and Host notes may spell out the Claude Code plugin root`);
    assert.ok(!/mcp__plugin_/.test(rest), `${rel}: the procedure names Borumi tools bare; the prefix lives in Host notes`);
    const notes = text.slice(text.indexOf("## Host notes"));
    assert.match(notes, /mcp__plugin_borumi_borumi__<tool>/, `${rel}: Host notes give the Claude Code tool prefix`);
    assert.match(notes, /borumi_mcp\.py/, `${rel}: Host notes give the Codex path`);
  }
  for (const rel of ["skills/borumi-editing/agents/openai.yaml", "skills/visualize/agents/openai.yaml"]) {
    const y = read(rel);
    for (const key of ["display_name:", "short_description:", "default_prompt:"]) assert.ok(y.includes(key), `${rel} lacks ${key}`);
  }
});

const ALLOWED_TOOLS = "Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__list_recent_projects mcp__plugin_borumi_borumi__get_ui_state mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__get_media_transcript mcp__plugin_borumi_borumi__detect_speech mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__request_transcriptions mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__abort_project_edit mcp__plugin_borumi_borumi__import_media mcp__plugin_borumi_borumi__get_media_import_status mcp__plugin_borumi_borumi__cancel_media_import mcp__plugin_borumi_borumi__add_segments mcp__plugin_borumi_borumi__update_segments mcp__plugin_borumi_borumi__split_segments mcp__plugin_borumi_borumi__delete_segments mcp__plugin_borumi_borumi__move_timeline_segments mcp__plugin_borumi_borumi__trim_timeline mcp__plugin_borumi_borumi__untrim_segments mcp__plugin_borumi_borumi__export_video mcp__plugin_borumi_borumi__get_export_status mcp__plugin_borumi_borumi__cancel_export";

/** Parse the YAML-ish frontmatter block (flat `key: value` lines) at the top of a markdown file. */
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

function toolsJson() {
  const d = JSON.parse(read("docs/borumi-guides/tools.json"));
  const tools = Array.isArray(d) ? d : d.tools;
  const names = new Set(tools.map((t) => t.name));
  const guides = tools.find((t) => t.name === "get_guides").inputSchema.properties.guide_ids.items.enum;
  return { names, guides: new Set(guides) };
}

test("every owned file exists and carries no em or en dash", () => {
  for (const rel of OWNED) {
    assert.ok(existsSync(join(root, rel)), `${rel} missing`);
    const text = read(rel);
    const bad = text.split("\n").findIndex((l) => /[—–]/.test(l));
    assert.equal(bad, -1, `${rel}:${bad + 1} contains an em or en dash`);
  }
});

test("skill frontmatter follows the plugin convention", () => {
  const base = parseFrontmatter(read("skills/borumi-editing/SKILL.md"));
  assert.equal(base.name, "borumi-editing");
  assert.ok(base.description.startsWith("Borumi:"), "base description must start with Borumi:");
  assert.equal(base["allowed-tools"], ALLOWED_TOOLS);
  assert.equal(base["user-invocable"], "false");
  assert.equal(base["disable-model-invocation"], undefined);

  const viz = parseFrontmatter(read("skills/visualize/SKILL.md"));
  assert.equal(viz.name, "visualize");
  assert.ok(viz.description.startsWith("Borumi:"), "visualize description must start with Borumi:");
  assert.ok(/visualize scene 3/.test(viz.description), "description carries a trigger phrase");
  assert.equal(viz["allowed-tools"], ALLOWED_TOOLS);
  assert.equal(viz["disable-model-invocation"], "true");
  assert.equal(viz["user-invocable"], undefined);
});

test("commit_project_edit is never in an allowlist", () => {
  for (const rel of OWNED) {
    for (const line of read(rel).split("\n")) {
      if (/^allowed-tools:/.test(line)) assert.ok(!/commit_project_edit/.test(line), `${rel} allowlists commit`);
    }
  }
});

test("skill bodies stay under 300 lines", () => {
  for (const rel of ["skills/borumi-editing/SKILL.md", "skills/visualize/SKILL.md"]) {
    const lines = read(rel).split("\n").length;
    assert.ok(lines <= 300, `${rel} has ${lines} lines`);
  }
});

test("animator agent frontmatter: file tools only, model inherit", () => {
  const fm = parseFrontmatter(read("agents/animator.md"));
  assert.equal(fm.name, "animator");
  assert.ok(fm.description.length > 40);
  assert.equal(fm.tools, "Bash, Read, Write, Edit, Glob, Grep");
  assert.equal(fm.model, "inherit");
  assert.ok(!/mcp__/.test(read("agents/animator.md")), "the animator never names an MCP tool");
});

test("every prefixed Borumi tool name in the docs exists", () => {
  const { names } = toolsJson();
  for (const rel of OWNED) {
    for (const m of read(rel).matchAll(/mcp__plugin_borumi_borumi__([a-z_]+)/g)) {
      if (m[1] === "tool" || m[1].endsWith("_")) continue; // the `<tool>` placeholder
      assert.ok(names.has(m[1]), `${rel}: unknown tool ${m[1]}`);
    }
  }
});

test("the base skill's tool map names real tools and covers all 45", () => {
  const { names } = toolsJson();
  const text = read("skills/borumi-editing/SKILL.md");
  const section = text.slice(text.indexOf("## Tool map"), text.indexOf("## Guide gating"));
  const seen = new Set();
  for (const m of section.matchAll(/`([a-z_]+)`/g)) {
    assert.ok(names.has(m[1]), `tool map names unknown tool ${m[1]}`);
    seen.add(m[1]);
  }
  for (const n of names) assert.ok(seen.has(n), `tool map is missing ${n}`);
  assert.equal(names.size, 45);
});

test("every guide id in the gating table and the cookbook exists", () => {
  const { guides } = toolsJson();
  const text = read("skills/borumi-editing/SKILL.md");
  const section = text.slice(text.indexOf("## Guide gating"), text.indexOf("## Ids and hashes"));
  for (const m of section.matchAll(/`([a-z_]+)`/g)) {
    const id = m[1];
    if (/^editing_segment_X_(add|update)$/.test(id) || id === "guide_required") continue;
    if (id.startsWith("editing_segment_") || /^(basics|project_edits|scripting|editing|editing_canvas|editing_cursors|editing_layouts|editing_sound_effects|editing_synchronization|editing_transcripts|editing_transitions|editing_trimming|exporting|importing_media|ui_navigation|use_cases)$/.test(id)) {
      assert.ok(guides.has(id), `gating table names unknown guide ${id}`);
    }
  }
  // the X placeholders expand to real guides
  for (const t of ["take", "media_overlay", "text_overlay", "layout", "captions", "screen_zoom", "camera_zoom", "screen_highlight", "screen_blur", "music", "sound_effect", "cursor"]) {
    assert.ok(guides.has(`editing_segment_${t}_add`), `no add guide for ${t}`);
  }
  for (const t of ["audio", "video", "overlay", "media_overlay", "text_overlay", "layout", "captions", "screen_zoom", "camera_zoom", "screen_highlight", "screen_blur", "music", "sound_effect", "cursor"]) {
    assert.ok(guides.has(`editing_segment_${t}_update`), `no update guide for ${t}`);
  }
  assert.ok(!guides.has("editing_segment_take_update"), "there is no take update guide");
  // every guide id the visualize preflight fetches exists
  const viz = read("skills/visualize/SKILL.md");
  const pre = viz.slice(viz.indexOf("### 1. Preflight"), viz.indexOf("### 2."));
  const looksLikeGuide = (id) => /^(editing|exporting|importing_media|project_edits|scripting|ui_navigation|basics|use_cases)/.test(id);
  let fetched = 0;
  for (const m of pre.matchAll(/`([a-z_]+)`/g)) {
    if (!looksLikeGuide(m[1])) continue;
    fetched++;
    assert.ok(guides.has(m[1]), `preflight fetches unknown guide ${m[1]}`);
  }
  assert.ok(fetched >= 8, "the preflight names the guides it fetches");
});

test("every references/ link points at a file that exists", () => {
  for (const rel of OWNED) {
    const dir = rel.includes("/references/") ? dirname(dirname(rel)) : dirname(rel);
    for (const m of read(rel).matchAll(/`references\/([a-z0-9-]+\.md)`/g)) {
      const target = join(root, dir, "references", m[1]);
      assert.ok(existsSync(target), `${rel} points at missing ${m[1]}`);
    }
  }
  const skillDirs = readdirSync(join(root, "skills"));
  assert.ok(skillDirs.includes("borumi-editing") && skillDirs.includes("visualize"));
});

test("script calls match the plugin contracts", () => {
  const scripts = new Set(["job", "kit", "frames", "segments", "placement", "chapters", "check"]);
  const jobSub = new Set(["create", "manifest", "signal", "render", "wait", "status", "typecheck", "still", "anchors", "sheet", "probe", "list", "show", "current", "set-current", "placed", "unplaced", "replaced", "log", "refs", "discard"]);
  for (const rel of OWNED) {
    const text = read(rel);
    // plugin scripts are invoked through the plugin root ($BORUMI_PLUGIN_ROOT, or ${CLAUDE_PLUGIN_ROOT} in Host notes);
    // bare `scripts/x.mjs` mentions are the kit's own
    for (const m of text.matchAll(/\$(?:\{CLAUDE_PLUGIN_ROOT\}|BORUMI_PLUGIN_ROOT)\/scripts\/([a-z_-]+)\.mjs/g)) {
      assert.ok(scripts.has(m[1]), `${rel} calls unknown plugin script ${m[1]}.mjs`);
    }
    const kitScripts = new Set(["check-anchors", "grab-frames", "frame-analysis", "inline-fonts"]);
    for (const m of text.matchAll(/(?<!(?:\{CLAUDE_PLUGIN_ROOT\}|BORUMI_PLUGIN_ROOT)\/)scripts\/([a-z_-]+)\.mjs/g)) {
      assert.ok(scripts.has(m[1]) || kitScripts.has(m[1]), `${rel} mentions unknown script ${m[1]}.mjs`);
    }
    for (const m of text.matchAll(/job\.mjs ([a-z-]+)/g)) {
      assert.ok(jobSub.has(m[1]), `${rel} uses unknown job.mjs subcommand ${m[1]}`);
    }
    for (const m of text.matchAll(/kit\.mjs ([a-z-]+)/g)) {
      assert.ok(["ensure", "wait", "status", "styles", "path"].includes(m[1]), `${rel} uses unknown kit.mjs subcommand ${m[1]}`);
    }
    for (const m of text.matchAll(/placement\.mjs ([a-z-]+)/g)) {
      assert.ok(["plan", "verify"].includes(m[1]), `${rel} uses unknown placement.mjs subcommand ${m[1]}`);
    }
    for (const m of text.matchAll(/segments\.mjs ([a-z-]+)/g)) {
      assert.ok(["list", "plan", "find"].includes(m[1]), `${rel} uses unknown segments.mjs subcommand ${m[1]}`);
    }
    for (const m of text.matchAll(/frames\.mjs ([a-z-]+)/g)) {
      assert.ok(["from-borumi", "from-media"].includes(m[1]), `${rel} uses unknown frames.mjs subcommand ${m[1]}`);
    }
    assert.ok(!/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[a-z_]+\.py/.test(text) || /borumi_mcp\.py/.test(text), `${rel} names an unknown python script`);
  }
});

/** Replace the documented placeholders so a JSON block with A/B/hash/layer placeholders parses. */
export function substitutePlaceholders(block) {
  return block
    .replace(/\bSTART_MS\b/g, "41000")
    .replace(/\bEND_MS\b/g, "49400")
    .replace(/\[A,B\]/g, "[41000,49400]")
    .replace(/\[start_ms,end_ms\]/g, "[41000,49400]")
    .replace(/"at_ms":A/g, '"at_ms":41000')
    .replace(/"start_ms":T,"end_ms":T\+34/g, '"start_ms":41050,"end_ms":41084')
    .replace(/<[^>"]+>/g, "x")
    .replace(/\{\.\.\.\}/g, "{}")
    .replace(/\$NEW_LAYER/g, "screen_2")
    .replace(/\$NEW_SEGMENT/g, "b054")
    .replace(/\bSCREEN\b/g, "screen_2");
}

function jsonBlocks(text) {
  return [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1].trim());
}

test("treatment and placement JSON blocks parse, camera drawn last with the measured rect", () => {
  for (const rel of ["skills/borumi-editing/references/treatment.md", "skills/visualize/references/placement.md", "skills/borumi-editing/references/borumi-mcp-cookbook.md"]) {
    const blocks = jsonBlocks(read(rel));
    assert.ok(blocks.length > 0, `${rel} has no json blocks`);
    for (const raw of blocks) {
      let obj;
      try {
        obj = JSON.parse(substitutePlaceholders(raw));
      } catch (e) {
        assert.fail(`${rel}: json block does not parse: ${e.message}\n${raw.slice(0, 120)}`);
      }
      const layouts = [];
      const walk = (o) => {
        if (!o || typeof o !== "object") return;
        if (o.kind === "custom" && Array.isArray(o.sources)) layouts.push(o);
        for (const v of Object.values(o)) walk(v);
      };
      walk(obj);
      for (const l of layouts) {
        const cam = l.sources[l.sources.length - 1];
        if (l.sources.length === 1 && cam.layer_id !== "camera_1") continue;
        assert.equal(cam.layer_id, "camera_1", `${rel}: camera must be the last custom source`);
        assert.deepEqual([cam.x_ratio, cam.y_ratio, cam.width_ratio, cam.height_ratio], [0.775, 0.715, 0.21, 0.25]);
        assert.equal(cam.corner_shape, "squircle_v2");
        assert.equal(cam.border_radius_ratio, 0.0284);
        assert.deepEqual(cam.shadow, { blur_ratio: 0.0185, color: { r: 0, g: 0, b: 0, a: 100 }, x_offset_ratio: 0, y_offset_ratio: 0.0185 });
        assert.equal(l.transition.kind, "instant");
      }
    }
  }
});

test("the chapter card JSON carries the Astra numbers", () => {
  const text = read("skills/borumi-editing/references/treatment.md");
  const block = jsonBlocks(text).find((b) => b.includes('"text_overlay"'));
  const card = JSON.parse(substitutePlaceholders(block)).properties;
  assert.deepEqual(card.font_families, ["DM Sans"]);
  assert.equal(card.bold, true);
  assert.equal(card.text_size, 62);
  assert.equal(card.sizing_mode, "fixed");
  assert.deepEqual(card.position, { kind: "custom", x_ratio: 0.055, y_ratio: 0.76, width_ratio: 0.7, height_ratio: 0.16 });
  assert.deepEqual(card.background_color, { r: 17, g: 31, b: 47, a: 239 });
  assert.equal(card.background_sizing_mode, "paragraph");
  assert.equal(card.background_horizontal_padding_ratio, 0.3);
  assert.equal(card.background_vertical_padding_ratio, 0.22);
  assert.equal(card.border_radius_ratio, 0.016);
  assert.deepEqual(card.entrance_transition, { kind: "fade" });
  assert.deepEqual(card.exit_transition, { kind: "instant" });
});

test("the cookbook keeps every section of the verified draft", () => {
  const text = read("skills/borumi-editing/references/borumi-mcp-cookbook.md");
  for (const fact of [
    "unknown_id_alias",
    "app_not_running",
    "guide_required",
    "invalid_project_path",
    "timeline_layer_not_found",
    "Untargeted trim ranges overlap independent content edit sets",
    "ranges:[[1000,2000],[5000,6000]]",
    "yuva444p12le",
    "screen_2",
    "pending_media_count",
    "max_frames:1",
    "poll_after_ms:5000",
    "face_tracking_mode:\"auto\"",
    "layouts follow the screen layer",
  ]) {
    assert.ok(text.includes(fact), `cookbook lost the fact: ${fact}`);
  }
});

test("the visualize skill documents the pipeline stages in order", () => {
  const text = read("skills/visualize/SKILL.md");
  const order = ["### 1. Preflight", "### 2. Resolve the target", "### 3. Gather inputs", "### 4. Create the job", "### 5. Frames", "### 6. Design", "### 7. Render", "### 8. Place", "### 9. Verify, record, report", "## Iteration", "## Subcommands", "## Failure handling", "## What to print"];
  let last = -1;
  for (const h of order) {
    const i = text.indexOf(h);
    assert.ok(i > last, `${h} missing or out of order`);
    last = i;
  }
  assert.ok(text.includes("Place v2 into Borumi?"), "the iteration loop asks the one question");
  assert.ok(text.includes("Superseded versions stay inside the project bundle"), "the superseded note is printed");
  assert.ok(text.includes("--timeout 540"), "waits stay under the Bash limit");
  assert.ok(text.includes("floor((B - A) / (1000/30))"), "duration is floored to the range");
});
