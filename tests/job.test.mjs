// scripts/job.mjs and its libraries: manifest generation, brief wording, words.json from the
// real Borumi fixture, fps 30, durationInFrames floor, size rules, render arg lists, render
// scale, plus the CLI end to end (create, signal, detached render + wait with a fake Remotion
// CLI, placed, refs, list, sheet, probe, discard, mount guard). Needs ffmpeg for the render
// half; those tests skip without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FPS, newJobId, jobTitle, normalizeSizeOverride, normalizeRawDuration, durationInFramesFor, endMsEffectiveFor, inferCanvasFormat,
  manifestSource, regenerateManifest, sceneScaffold, extractItems, wordsInRange, selectNarration, contextLines, buildWordsJson,
  buildBrief, buildRawBrief, placementLines, planLines, extractScriptBeats, readRenderSignal, kitJobJson, CAMERA_KEEP_OUT_LINE,
} from "../scripts/lib/brief.mjs";
import {
  renderArgs, finishArgs, renderFileName, renderScale, renderConcurrency, isTransientRenderError, parseRenderProgress, parseFfDuration,
  renderAttempts, renderStallMs, renderTimeoutMs, allIntraDefault,
} from "../scripts/lib/render.mjs";
import { parseArgs } from "../scripts/job.mjs";
import { ffmpegBin } from "../scripts/lib/paths.mjs";

const JOB = fileURLToPath(new URL("../scripts/job.mjs", import.meta.url));
const FIX = fileURLToPath(new URL("./fixtures/", import.meta.url));
const wordsFixture = JSON.parse(readFileSync(join(FIX, "transcript-words.json"), "utf8"));
const blocksFixture = JSON.parse(readFileSync(join(FIX, "transcript-blocks.json"), "utf8"));
const scenesFixture = JSON.parse(readFileSync(join(FIX, "scenes.json"), "utf8"));

let haveFfmpeg = false;
try { haveFfmpeg = spawnSync(ffmpegBin(), ["-version"], { stdio: "ignore" }).status === 0; } catch { haveFfmpeg = false; }

/* ---------- pure rules ---------- */

test("fps is fixed at 30 and durationInFrames floors", () => {
  assert.equal(FPS, 30);
  assert.equal(durationInFramesFor(0, 20600), 618);
  assert.equal(durationInFramesFor(3820, 13700), 296, "9880 ms = 296.4 frames -> 296");
  assert.equal(durationInFramesFor(0, 8433), 252, "252.99 -> 252, never rounded up");
  assert.equal(durationInFramesFor(0, 1000), 30);
  assert.equal(durationInFramesFor(0, 33), 0);
  assert.equal(durationInFramesFor(5, 5), 0);
  assert.equal(endMsEffectiveFor(3820, 296), 3820 + 9866);
  assert.equal(endMsEffectiveFor(0, 618), 20600);
  assert.ok(endMsEffectiveFor(3820, durationInFramesFor(3820, 13700)) <= 13700, "the render never outlasts the range");
});

test("size rules: even dims, 16..8192, garbage falls back", () => {
  assert.deepEqual(normalizeSizeOverride(3840, 2160), { width: 3840, height: 2160 });
  assert.deepEqual(normalizeSizeOverride(1081, 1921), { width: 1080, height: 1920 });
  assert.deepEqual(normalizeSizeOverride("2560", "1440.4"), { width: 2560, height: 1440 });
  assert.equal(normalizeSizeOverride(null, null), null);
  assert.equal(normalizeSizeOverride("x", 1080), null);
  assert.equal(normalizeSizeOverride(1920, 8), null);
  assert.equal(normalizeSizeOverride(9000, 1080), null);
  assert.equal(inferCanvasFormat(1920, 1080), "landscape");
  assert.equal(inferCanvasFormat(1080, 1920), "vertical");
  assert.equal(inferCanvasFormat(1080, 1080), "square");
  assert.equal(inferCanvasFormat(0, 0), "custom");
  assert.equal(normalizeRawDuration(5), 5);
  assert.equal(normalizeRawDuration("7.5"), 7.5);
  assert.equal(normalizeRawDuration(0.2), null);
  assert.equal(normalizeRawDuration(601), null);
  assert.equal(normalizeRawDuration("x"), null);
});

test("job ids and titles", () => {
  assert.match(newJobId(), /^anim-[a-z0-9]+$/);
  assert.equal(newJobId(1000), "anim-rs");
  assert.equal(jobTitle("Webhook branches"), "Webhook branches");
  const long = jobTitle("For example, I've just asked it a really long question");
  assert.ok(long.length <= 20 && long.endsWith("…"));
  assert.equal(jobTitle(""), "Animation");
  assert.equal(jobTitle("   "), "Animation");
});

test("manifestSource and regenerateManifest", () => {
  const src = manifestSource([
    { id: "anim-abc", fps: 30, width: 1920, height: 1080, durationInFrames: 450 },
    { id: "anim-x-2", fps: 30, width: 3840, height: 2160, durationInFrames: 100 },
  ]);
  assert.ok(src.includes('import Scene_anim_abc from "./anim-abc/Scene";'));
  assert.ok(src.includes('import Scene_anim_x_2 from "./anim-x-2/Scene";'));
  assert.ok(src.includes('{ id: "anim-abc", component: Scene_anim_abc, fps: 30, width: 1920, height: 1080, durationInFrames: 450 }'));
  assert.ok(src.includes('import type { JobEntry } from "./types";'));
  assert.ok(manifestSource([]).includes("export const jobs: JobEntry[] = ["));
  assert.ok(!/—/.test(src), "no em dashes");

  const tmp = mkdtempSync(join(tmpdir(), "borumi-manifest-"));
  try {
    mkdirSync(join(tmp, "src", "jobs", "anim-aaa"), { recursive: true });
    writeFileSync(join(tmp, "src", "jobs", "anim-aaa", "job.json"), JSON.stringify({ id: "anim-aaa", fps: 30, width: 1920, height: 1080, durationInFrames: 60 }));
    writeFileSync(join(tmp, "src", "jobs", "anim-aaa", "Scene.tsx"), "export default null;");
    mkdirSync(join(tmp, "src", "jobs", "broken"), { recursive: true });
    mkdirSync(join(tmp, "src", "jobs", "anim-bad"), { recursive: true });
    writeFileSync(join(tmp, "src", "jobs", "anim-bad", "job.json"), JSON.stringify({ id: "other", fps: 30, width: 1920, height: 1080, durationInFrames: 60 }));
    writeFileSync(join(tmp, "src", "jobs", "anim-bad", "Scene.tsx"), "export default null;");
    const count = regenerateManifest(tmp);
    const manifest = readFileSync(join(tmp, "src", "jobs", "manifest.ts"), "utf8");
    assert.equal(count, 1);
    assert.ok(manifest.includes("anim-aaa") && !manifest.includes("broken") && !manifest.includes("anim-bad"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("sceneScaffold follows the background and the style package", () => {
  const job = { id: "anim-test1", style: "excalidraw", background: "transparent" };
  const s = sceneScaffold(job);
  assert.ok(s.includes("<Canvas transparent={true}>") && s.includes("anim-test1") && !s.includes("styles/"));
  assert.ok(sceneScaffold({ ...job, background: "solid" }).includes("transparent={false}"));
  assert.ok(sceneScaffold({ ...job, style: "n8n" }, { styleHasSrc: true }).includes('"../../../styles/n8n/src"'));
  assert.deepEqual(kitJobJson({ id: "a", fps: 30, width: 2, height: 2, durationInFrames: 3, background: "solid", style: "x", audio: false, outDir: "/o", projectPath: "/p" }),
    { id: "a", fps: 30, width: 2, height: 2, durationInFrames: 3, background: "solid", style: "x", audio: false, outDir: "/o", projectPath: "/p" });
});

/* ---------- Borumi transcript adapters on the real fixture ---------- */

test("extractItems flattens get_transcript words and blocks", () => {
  const words = extractItems(wordsFixture);
  assert.equal(words.length, 65);
  assert.deepEqual([words[0].start_ms, words[0].end_ms, words[0].text], [100, 260, "In"]);
  assert.equal(words[0].segment_id, "95dd");
  assert.equal(words[0].scene_id, "eeaa");
  assert.equal(words[64].text, "frame.");
  const blocks = extractItems(blocksFixture);
  assert.equal(blocks.length, 9);
  assert.equal(blocks[2].text, "First,");
  assert.equal(extractItems([wordsFixture, blocksFixture]).length, 74, "chunked responses concatenate");
  assert.deepEqual(extractItems([[5, 10, "a"], [1, 2, "b"]]).map((i) => i.text), ["b", "a"], "bare triples sort by start");
  assert.equal(extractItems(null).length, 0);
});

test("words.json: 65 words from t=0 ('In' at 0.100); from 3820 the first is 'First,' at 0.000", () => {
  const items = extractItems(wordsFixture);
  const all = wordsInRange(items, 0, 20600);
  assert.equal(all.length, 65);
  assert.deepEqual(all[0], { text: "In", rel: 0.1, end: 0.26 });
  const wj = buildWordsJson(new Map([[0, all]]));
  assert.equal(wj.length, 65);
  assert.deepEqual(wj[0], { text: "In", start: 0.1, end: 0.26 });
  assert.deepEqual(wj[64], { text: "frame.", start: 20.28, end: 20.586 });

  const later = wordsInRange(items, 3820, 13700);
  assert.deepEqual(later[0], { text: "First,", rel: 0, end: 0.49 });
  assert.equal(later[later.length - 1].text, "narration.");
  assert.equal(later.length, 28);
  // A word starting within 50 ms before the in-point is kept and clamped to 0; one before that is not.
  assert.equal(wordsInRange(items, 3850, 13700)[0].text, "First,");
  assert.equal(wordsInRange(items, 3850, 13700)[0].rel, 0);
  assert.equal(wordsInRange(items, 3900, 13700)[0].text, "the");
  // Ends clamp to the range.
  const clipped = wordsInRange(items, 0, 3000);
  assert.equal(clipped[clipped.length - 1].text, "pipeline.");
  assert.equal(clipped[clipped.length - 1].end, 3);
});

test("buildWordsJson flattens, sorts, drops a bad end and empty/untimed words", () => {
  const wb = new Map([
    [7, [{ text: "later", rel: 4.2, end: 4.6 }, { text: "bad", rel: 5.0, end: 4.9 }]],
    [3, [{ text: "first", rel: 0.1, end: 0.4 }, { text: "", rel: 0.5 }, { text: "noRel" }]],
  ]);
  assert.deepEqual(buildWordsJson(wb), [{ text: "first", start: 0.1, end: 0.4 }, { text: "later", start: 4.2, end: 4.6 }, { text: "bad", start: 5.0 }]);
  assert.deepEqual(buildWordsJson(), []);
});

test("selectNarration: blocks become the narration lines, words attach to their block", () => {
  const words = extractItems(wordsFixture);
  const blocks = extractItems(blocksFixture);
  const { selected, wordsBySegment } = selectNarration({ words, blocks, startMs: 3820, endMs: 13686 });
  assert.deepEqual(selected.map((s) => [s.relStart, s.relEnd, s.text]), [
    [0, 0.49, "First,"],
    [0.63, 3.97, "the recorder captures your camera and your screen as separate layers."],
    [4.11, 4.72, "Second,"],
    [4.86, 9.866, "the agent reads the transcript and designs an animation for exactly this stretch of narration."],
  ]);
  assert.equal(wordsBySegment.get(0)[0].text, "First,");
  assert.equal(wordsBySegment.get(1).length, 11);
  assert.equal(wordsBySegment.get(3)[wordsBySegment.get(3).length - 1].text, "narration.");
  assert.equal(buildWordsJson(wordsBySegment).length, 28);

  // Without blocks: one line per Borumi words segment with the words joined.
  const noBlocks = selectNarration({ words, blocks: [], startMs: 3820, endMs: 7900 });
  assert.equal(noBlocks.selected.length, 1);
  assert.ok(noBlocks.selected[0].text.startsWith("First, the recorder") && noBlocks.selected[0].text.endsWith("layers."));
  assert.equal(noBlocks.selected[0].relStart, 0);
  assert.equal(noBlocks.selected[0].relEnd, 3.97);

  // No words at all: a single "(no speech)" line covers the range.
  const silent = selectNarration({ words: [], blocks: [], startMs: 1000, endMs: 3000 });
  assert.deepEqual(silent.selected, [{ index: 0, relStart: 0, relEnd: 2, text: "" }]);
});

test("contextLines marks the selected blocks with >>> and limits to the scene and its neighbours", () => {
  const blocks = extractItems(blocksFixture);
  const lines = contextLines(blocks, 3820, 13686, { scenes: scenesFixture.scenes, sceneId: "eeaa" });
  assert.equal(lines.length, 9);
  assert.equal(lines[0], "- [0:00] In this scene,");
  assert.equal(lines[2], ">>> [0:03] First,");
  assert.equal(lines[5], ">>> [0:08] the agent reads the transcript and designs an animation for exactly this stretch of narration.");
  assert.equal(lines[6], "- [0:13] And third,");
  // Neighbour filter: a far scene's blocks drop out.
  const scenes = [
    { id: "s1", start_ms: 0, end_ms: 100000 }, { id: "s2", start_ms: 100000, end_ms: 200000 }, { id: "s3", start_ms: 200000, end_ms: 300000 },
    { id: "s4", start_ms: 300000, end_ms: 400000 }, { id: "s5", start_ms: 400000, end_ms: 500000 },
  ];
  const far = [{ start_ms: 5000, end_ms: 6000, text: "one" }, { start_ms: 150000, end_ms: 151000, text: "two" }, { start_ms: 250000, end_ms: 251000, text: "three" }, { start_ms: 350000, end_ms: 351000, text: "four" }, { start_ms: 450000, end_ms: 451000, text: "five" }];
  assert.deepEqual(contextLines(far, 250000, 251000, { scenes, sceneId: "s3" }), ["- [0:05] one", "- [2:30] two", ">>> [4:10] three", "- [5:50] four", "- [7:30] five"]);
  assert.deepEqual(contextLines(far, 5000, 6000, { scenes, sceneId: "s1" }), [">>> [0:05] one", "- [2:30] two", "- [4:10] three"]);
  // The line cap keeps a window around the target.
  const many = Array.from({ length: 1000 }, (_, i) => ({ start_ms: i * 1000, end_ms: i * 1000 + 900, text: `line ${i}` }));
  const capped = contextLines(many, 600000, 601000, { maxLines: 10 });
  assert.equal(capped.length, 10);
  assert.ok(capped.some((l) => l.startsWith(">>> [10:00] line 600")));
});

/* ---------- brief wording ---------- */

const baseJob = {
  id: "anim-test1", style: "excalidraw", background: "solid", mode: "behind", fps: 30, width: 1920, height: 1080, durationInFrames: 300,
  startMs: 10000, endMs: 20000, endMsEffective: 20000, sceneName: "Scene 3", canvasFormat: "landscape", range: { startSec: 10, endSec: 20 },
};

test("buildBrief keeps upstream's section format and adds Placement + the user's plan", () => {
  const brief = buildBrief(baseJob, {
    selected: [{ index: 4, relStart: 0, relEnd: 4.2, text: "hello there" }, { index: 5, relStart: 4.2, relEnd: 10, text: "welcome back" }, { index: 6, relStart: 10, relEnd: 10, text: "" }],
    transcriptLines: ["- [0:01] intro line", ">>> [0:10] hello there"],
    wordsBySegment: new Map([[4, [{ text: "hello", rel: 0.1 }, { text: "there", rel: 0.6 }]]]),
    plan: planLines({ userBrief: "make the arrows pink", scriptText: scenesFixture.scenes[0].script_markdown }),
  });
  assert.ok(brief.startsWith("# Animation brief: anim-test1\n\n- Canvas: 1920x1080 @ 30 fps\n- Duration: 300 frames (10s). FIXED: fill exactly this time.\n"));
  assert.ok(brief.includes("- [0.00s - 4.20s] hello there\n  words: hello@0.10 there@0.60\n- [4.20s - 10.00s] welcome back\n- [10.00s - 10.00s] (no speech)"));
  assert.ok(brief.includes("## The narration you are animating (the selected timeline range)\nTimes are seconds relative to the animation start (t=0 is your first frame).\nThe narration plays on the Borumi timeline under your clip; sync your visual beats to it."));
  assert.ok(brief.includes("## Full video transcript (context only)\nSo you understand the topic around this moment. Lines marked >>> are the selected range.\n\n- [0:01] intro line\n>>> [0:10] hello there\n"));
  assert.ok(brief.includes("## Placement\nBehind the camera (Scene 3, project 0:10.000-0:20.000): the render becomes the screen layer"));
  assert.ok(brief.includes(CAMERA_KEEP_OUT_LINE));
  assert.ok(brief.includes("## The user's plan for this beat\nThe user asked for: make the arrows pink\n\nFrom the scene Script in Borumi:\n- Animation beat: three sketched boxes appear one by one, labeled Recorder, Agent, Render"));
  assert.ok(/solid canvas \(covers the footage/.test(brief));
  assert.ok(!brief.includes("Premiere"));
  assert.ok(!/—/.test(brief), "no em dashes");
  assert.ok(brief.endsWith("\n"));
});

test("brief variants: transparent front overlay, frames section, non-landscape corner note", () => {
  const front = buildBrief({ ...baseJob, mode: "front", background: "transparent", seeFrames: true }, { selected: [{ index: 0, relStart: 0, relEnd: 10, text: "x" }], transcriptLines: [] });
  assert.ok(/transparent \(overlay/.test(front));
  assert.ok(front.includes("## Placement\nIn front of the footage (Scene 3, project 0:10.000-0:20.000): the render is a transparent overlay"));
  assert.ok(!front.includes(CAMERA_KEEP_OUT_LINE));
  assert.ok(front.includes("## Screen frames (frame-aware overlay)") && front.includes("src/jobs/anim-test1/frames-map.json") && front.includes("public/frames/anim-test1/sheets/"));
  assert.ok(!front.includes("## The user's plan for this beat"), "no plan section without a brief or script");
  const vertical = placementLines({ ...baseJob, width: 1080, height: 1920, canvasFormat: "vertical", sceneName: null });
  assert.ok(vertical[0].startsWith("Behind the camera (project 0:10.000-0:20.000)"));
  assert.ok(/corner layout/.test(vertical[1]) && !vertical.includes(CAMERA_KEEP_OUT_LINE));
});

test("buildRawBrief: standalone wording, landing time, Placement, no transcript section", () => {
  const raw = buildRawBrief({ ...baseJob, id: "anim-raw1", raw: true, mode: "front", background: "transparent", width: 3840, height: 2160, durationInFrames: 150, startMs: 650500, endMs: 655500, endMsEffective: 655500, sceneName: null, range: { startSec: 650.5, endSec: 655.5 } }, { plan: planLines({ userBrief: "a stopwatch counting down" }) });
  assert.ok(raw.includes("150 frames (5s). FIXED"));
  assert.ok(/NOT tied to the video's transcript/.test(raw) && /no narration/.test(raw));
  assert.ok(raw.includes("It lands on the timeline at 10:50,"));
  assert.ok(raw.includes("## Placement\nIn front of the footage (project 10:50.500-10:55.500)"));
  assert.ok(raw.includes("## The user's plan for this beat\nThe user asked for: a stopwatch counting down"));
  assert.ok(!raw.includes("Full video transcript"));
  assert.ok(!/—/.test(raw));
});

test("script markers: (ANIMATION: ...) beats, [IMAGE: ...] blocks, [SHOW TABLE n] tables; plain scripts are quoted", () => {
  const script = "Intro line.\n\n(ANIMATION: two cards side by side,\nwith a \"$?\" between them.)\n\n[IMAGE: refs/01-table.jpg] Anthropic's benchmark table.\nSource: https://example.com/x\n\n[SHOW TABLE 1]\n\n| Benchmark | A |\n|---|---|\n| T-Bench | 55.8% |\n\nClosing line.";
  const beats = extractScriptBeats(script);
  assert.equal(beats[0], "- Animation beat: two cards side by side, with a \"$?\" between them.");
  assert.ok(beats.includes("- [IMAGE: refs/01-table.jpg] Anthropic's benchmark table. Source: https://example.com/x"));
  assert.ok(beats.includes("- [SHOW TABLE 1]") && beats.includes("  | T-Bench | 55.8% |"));
  assert.deepEqual(extractScriptBeats("just prose"), []);
  assert.deepEqual(extractScriptBeats(""), []);
  const plain = planLines({ scriptText: "Line one.\nLine two." });
  assert.deepEqual(plain, ["The scene Script in Borumi (no explicit animation markers):", "> Line one.", "> Line two."]);
  assert.deepEqual(planLines({}), []);
  assert.deepEqual(planLines({ userBrief: "  slower  " }), ["The user asked for: slower"]);
});

test("readRenderSignal parses the sentinel and clamps the title", () => {
  const tmp = mkdtempSync(join(tmpdir(), "borumi-signal-"));
  try {
    assert.equal(readRenderSignal(tmp), null);
    writeFileSync(join(tmp, "render.json"), JSON.stringify({ version: 2, notes: "first pass" }));
    assert.deepEqual(readRenderSignal(tmp), { version: 2, notes: "first pass", title: null });
    writeFileSync(join(tmp, "render.json"), JSON.stringify({ version: 3, title: "A very long animation title from the agent" }));
    assert.ok(readRenderSignal(tmp).title.length <= 20);
    writeFileSync(join(tmp, "render.json"), "{bad json");
    assert.equal(readRenderSignal(tmp), null);
    writeFileSync(join(tmp, "render.json"), JSON.stringify({ version: 0 }));
    assert.equal(readRenderSignal(tmp), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/* ---------- render args ---------- */

test("render arg list matches upstream for both modes; finishing pass copies by default", () => {
  const solid = { id: "anim-s", background: "solid", audio: false, width: 1920, height: 1080 };
  assert.deepEqual(renderArgs(solid, "/o/.render-tmp-1.mp4", { env: {} }), [
    "render", "anim-s", "/o/.render-tmp-1.mp4", "--timeout=120000", "--image-format=png", "--overwrite", '--props={"final":true}', "--muted", "--codec=h264", "--crf=14",
  ]);
  const alpha = { id: "anim-a", background: "transparent", audio: false, width: 1920, height: 1080 };
  assert.deepEqual(renderArgs(alpha, "/o/.render-tmp-2.mov", { env: {} }), [
    "render", "anim-a", "/o/.render-tmp-2.mov", "--timeout=120000", "--image-format=png", "--overwrite", '--props={"final":true}', "--muted", "--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le",
  ]);
  const loud4k = { id: "anim-l", background: "solid", audio: true, width: 3840, height: 2160 };
  const args = renderArgs(loud4k, "/o/t.mp4", { scale: 2, env: {} });
  assert.ok(!args.includes("--muted"), "a style with audio renders un-muted");
  assert.ok(args.includes("--scale=2") && args.includes("--concurrency=3"));
  assert.ok(renderArgs({ ...solid, width: 2560, height: 1440 }, "/o/t.mp4", { env: {} }).includes("--concurrency=4"));
  assert.ok(renderArgs(solid, "/o/t.mp4", { env: { BORUMI_AGENT_CONCURRENCY: "2" } }).includes("--concurrency=2"));
  assert.equal(renderFileName(solid, 3), "anim-s-v3.mp4");
  assert.equal(renderFileName(alpha, 1), "anim-a-v1.mov");

  assert.deepEqual(finishArgs(alpha, "/o/t.mov", "/o/anim-a-v1.mov"), ["-y", "-i", "/o/t.mov", "-c:v", "copy", "-an", "/o/anim-a-v1.mov"]);
  assert.deepEqual(finishArgs(solid, "/o/t.mp4", "/o/anim-s-v1.mp4"), ["-y", "-i", "/o/t.mp4", "-c:v", "copy", "-an", "-movflags", "+faststart", "/o/anim-s-v1.mp4"]);
  assert.deepEqual(finishArgs(solid, "/o/t.mp4", "/o/out.mp4", { allIntra: true }), ["-y", "-i", "/o/t.mp4", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-g", "1", "-bf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "/o/out.mp4"]);
  assert.deepEqual(finishArgs({ ...alpha, audio: true }, "/o/t.mov", "/o/out.mov"), ["-y", "-i", "/o/t.mov", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "/o/out.mov"]);
  assert.equal(allIntraDefault({}), false);
  assert.equal(allIntraDefault({ BORUMI_AGENT_ALL_INTRA: "1" }), true);
  assert.equal(renderAttempts({}), 2);
  assert.equal(renderAttempts({ BORUMI_AGENT_RENDER_ATTEMPTS: "9" }), 5);
  assert.equal(renderStallMs({}), 600000);
  assert.equal(renderTimeoutMs({}), 0);
});

test("renderScale, concurrency, transient errors, progress and duration parsing", () => {
  const j = { width: 1920, height: 1080 };
  assert.deepEqual(renderScale(j, 1920, 1080), { scale: 1, outWidth: 1920, warning: null });
  assert.deepEqual(renderScale(j, 3840, 2160), { scale: 2, outWidth: 3840, warning: null });
  assert.ok(Math.abs(renderScale({ width: 3840, height: 2160 }, 1920, 1080).scale - 0.5) < 1e-9);
  const vert = renderScale(j, 1080, 1920);
  assert.equal(vert.scale, 1);
  assert.match(vert.warning, /different shape/);
  assert.equal(renderScale(j, null, undefined).scale, 1);
  assert.equal(renderScale(j, 0, 0).warning, null);
  assert.equal(renderConcurrency(1920, 1080, {}), null);
  assert.equal(renderConcurrency(2560, 1440, {}), 4);
  assert.equal(renderConcurrency(3840, 2160, {}), 3);
  assert.equal(renderConcurrency(2160, 3840, {}), 3);
  assert.equal(renderConcurrency(null, undefined, {}), null);
  assert.equal(isTransientRenderError("remotion render failed (exit 1). delayRender was called but not cleared after 118000ms"), true);
  assert.equal(isTransientRenderError("Protocol error: Target closed"), true);
  assert.equal(isTransientRenderError("Cancelled"), false);
  assert.equal(isTransientRenderError("remotion render timed out after 30 min."), false);
  assert.equal(isTransientRenderError("remotion render stopped reporting progress for 10 min and looked stuck, so it was stopped."), true);
  assert.equal(isTransientRenderError("remotion render failed (exit 2). ReferenceError: foo is not defined"), false);
  assert.equal(isTransientRenderError(undefined), false);
  assert.equal(parseRenderProgress("Rendered 30/300 frames ... 45/300"), 15);
  assert.equal(parseRenderProgress("500/300"), null);
  assert.equal(parseRenderProgress("300/300"), 99);
  assert.equal(parseRenderProgress("no numbers"), null);
  assert.ok(Math.abs(parseFfDuration("...\n  Duration: 00:01:23.45, start: 0\n") - 83.45) < 1e-6);
  assert.equal(parseFfDuration("nope"), null);
});

test("parseArgs: values, flags, repeated --ref, positionals", () => {
  const a = parseArgs(["create", "--start-ms", "0", "--raw", "--ref", "a.png", "--ref", "b.png", "--user-brief", "make it pink", "--force"]);
  assert.equal(a._[0], "create");
  assert.equal(a["start-ms"], "0");
  assert.equal(a.raw, true);
  assert.deepEqual(a.ref, ["a.png", "b.png"]);
  assert.equal(a["user-brief"], "make it pink");
  assert.equal(a.force, true);
});

/* ---------- CLI end to end ---------- */

function fakeRemotionCli(dir) {
  const file = join(dir, "fake-remotion-cli.mjs");
  writeFileSync(file, `
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const FF = ${JSON.stringify(ffmpegBin())};
const [cmd, id, out, ...rest] = process.argv.slice(2);
writeFileSync(join(${JSON.stringify(dir)}, "last-args.json"), JSON.stringify(process.argv.slice(2)));
if (cmd === "browser") process.exit(0);
if (cmd === "still") { spawnSync(FF, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", out]); process.exit(0); }
if (cmd !== "render") process.exit(2);
const job = JSON.parse(readFileSync(join(process.cwd(), "src", "jobs", id, "job.json"), "utf8"));
const n = job.durationInFrames;
const prores = rest.some((a) => a.startsWith("--codec=prores"));
const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30", "-frames:v", String(n)];
if (prores) args.push("-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"); else args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
args.push(out);
process.stdout.write("Rendered 1/" + n + "\\n");
const r = spawnSync(FF, args, { stdio: "inherit" });
process.stdout.write("Rendered " + n + "/" + n + "\\n");
process.exit(r.status);
`);
  return file;
}

test("CLI end to end: create, signal, detached render + wait, placed, refs, list, sheet, probe, discard, mount guard", { skip: !haveFfmpeg && "ffmpeg not found" }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "borumi-jobcli-"));
  const home = join(tmp, "home");
  const bundle = join(tmp, "Borumi Projects", "Pipeline Demo.bmprojbundle");
  mkdirSync(bundle, { recursive: true });
  const env = { ...process.env, BORUMI_AGENT_HOME: home, BORUMI_AGENT_REMOTION_CLI: fakeRemotionCli(tmp), BORUMI_AGENT_RENDER_STALL_MS: "120000" };
  const run = (args) => {
    const r = spawnSync(process.execPath, [JOB, ...args], { env, encoding: "utf8" });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* not json */ }
    return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
  };
  try {
    // Mount guard through the CLI: a bundle that does not exist is refused before anything is written.
    let r = run(["create", "--project-path", join(tmp, "Gone.bmprojbundle"), "--start-ms", "0", "--end-ms", "5000", "--words", join(FIX, "transcript-words.json")]);
    assert.equal(r.code, 1);
    assert.equal(r.json.kind, "mount");
    assert.match(r.json.error, /does not exist/);
    assert.equal(existsSync(join(tmp, "Gone Agent")), false);
    assert.ok(readFileSync(join(home, "errors.log"), "utf8").includes("does not exist"), "the failure was logged");

    // Argument errors.
    r = run(["create", "--project-path", bundle, "--start-ms", "0", "--end-ms", "5000", "--words", join(FIX, "transcript-words.json"), "--frames", "--mode", "behind"]);
    assert.equal(r.code, 1); assert.match(r.json.error, /front-only/);
    r = run(["create", "--project-path", bundle, "--start-ms", "0", "--end-ms", "5000", "--words", join(FIX, "transcript-words.json"), "--fps", "60"]);
    assert.equal(r.code, 1); assert.match(r.json.error, /fps is fixed at 30/);
    r = run(["create", "--project-path", bundle, "--start-ms", "0", "--end-ms", "5000", "--words", join(FIX, "transcript-words.json"), "--style", "nope"]);
    assert.equal(r.code, 1); assert.match(r.json.error, /Unknown style/);
    r = run(["create", "--project-path", bundle, "--start-ms", "1000", "--end-ms", "1300", "--words", join(FIX, "transcript-words.json")]);
    assert.equal(r.code, 1); assert.match(r.json.error, /shorter than half a second/);
    r = run(["create", "--project-path", bundle, "--start-ms", "15000", "--end-ms", "25000", "--scene-id", "eeaa", "--scenes", join(FIX, "scenes.json"), "--words", join(FIX, "transcript-words.json")]);
    assert.equal(r.code, 1); assert.match(r.json.error, /crosses the boundary/);
    r = run(["create", "--project-path", bundle, "--start-ms", "0", "--end-ms", "5000"]);
    assert.equal(r.code, 1); assert.match(r.json.error, /--words/);

    // A narrated job from the real fixture.
    r = run(["create", "--project-path", bundle, "--scene-id", "eeaa", "--scene-name", "Scene 1", "--start-ms", "3820", "--end-ms", "13700", "--width", "1920", "--height", "1080",
      "--style", "excalidraw", "--mode", "behind", "--words", join(FIX, "transcript-words.json"), "--context", join(FIX, "transcript-blocks.json"), "--scenes", join(FIX, "scenes.json"),
      "--user-brief", "make the arrows pink", "--canvas-format", "landscape", "--quiet"]);
    assert.equal(r.code, 0, r.stderr);
    const c = r.json;
    assert.match(c.jobId, /^anim-[a-z0-9]+$/);
    assert.equal(c.durationInFrames, 296);
    assert.equal(c.endMsEffective, 13686);
    assert.equal(c.wordsCount, 28);
    assert.equal(c.kitDir, join(home, "animation-kit"));
    assert.equal(c.jobDir, join(home, "animation-kit", "src", "jobs", c.jobId));
    assert.equal(c.outDir, join(tmp, "Borumi Projects", "Pipeline Demo Agent", "animations", c.jobId));
    assert.equal(c.briefPath, join(c.jobDir, "brief.md"));
    assert.ok(existsSync(c.scenePath));
    for (const f of ["job.json", "log.jsonl", "brief.md", "history"]) assert.ok(existsSync(join(c.outDir, f)), `outDir has ${f}`);
    for (const f of ["job.json", "brief.md", "words.json", "Scene.tsx", "refs"]) assert.ok(existsSync(join(c.jobDir, f)), `jobDir has ${f}`);
    const job = JSON.parse(readFileSync(join(c.outDir, "job.json"), "utf8"));
    assert.equal(job.fps, 30);
    assert.equal(job.mode, "behind");
    assert.equal(job.background, "solid");
    assert.equal(job.sceneId, "eeaa");
    assert.equal(job.sceneName, "Scene 1");
    assert.equal(job.startMs, 3820);
    assert.equal(job.endMs, 13700);
    assert.equal(job.endMsEffective, 13686);
    assert.equal(job.canvasFormat, "landscape");
    assert.equal(job.placed, null);
    assert.deepEqual(job.importedMediaIds, []);
    assert.equal(job.currentVersion, 0);
    assert.equal(job.lastRenderedVersion, 0);
    assert.deepEqual(job.renders, []);
    assert.deepEqual(job.refs, []);
    assert.equal(job.projectPath, bundle);
    assert.equal(job.projectName, "Pipeline Demo");
    assert.equal(job.audio, false);
    assert.equal(job.userBrief, "make the arrows pink");
    assert.deepEqual(job.range, { startSec: 3.82, endSec: 13.686 });
    const words = JSON.parse(readFileSync(join(c.jobDir, "words.json"), "utf8"));
    assert.equal(words.length, 28);
    assert.deepEqual(words[0], { text: "First,", start: 0, end: 0.49 });
    const kitJob = JSON.parse(readFileSync(join(c.jobDir, "job.json"), "utf8"));
    assert.equal(kitJob.id, c.jobId); assert.equal(kitJob.fps, 30); assert.equal(kitJob.durationInFrames, 296); assert.equal(kitJob.outDir, c.outDir);
    const brief = readFileSync(c.briefPath, "utf8");
    assert.ok(brief.includes("296 frames (9.867s). FIXED"));
    assert.ok(brief.includes("- [0.00s - 0.49s] First,\n  words: First,@0.00"));
    assert.ok(brief.includes(">>> [0:03] First,"));
    assert.ok(brief.includes("## Placement\nBehind the camera (Scene 1, project 0:03.820-0:13.686)"));
    assert.ok(brief.includes("## The user's plan for this beat\nThe user asked for: make the arrows pink"));
    assert.equal(readFileSync(join(c.outDir, "brief.md"), "utf8"), brief, "the deliverable folder keeps a copy");
    assert.ok(readFileSync(join(home, "animation-kit", "src", "jobs", "manifest.ts"), "utf8").includes(c.jobId));
    assert.deepEqual(JSON.parse(readFileSync(join(home, "current.json"), "utf8")), { [bundle]: c.jobId });
    assert.ok(readFileSync(join(c.outDir, "log.jsonl"), "utf8").includes('"kind":"created"'));

    // A raw job needs no words.
    r = run(["create", "--raw", "--project-path", bundle, "--start-ms", "83000", "--length-ms", "5000", "--mode", "front", "--user-brief", "a stopwatch counting down", "--quiet"]);
    assert.equal(r.code, 0, r.stderr);
    const rawId = r.json.jobId;
    assert.equal(r.json.durationInFrames, 150);
    assert.equal(r.json.wordsCount, 0);
    assert.equal(readFileSync(join(r.json.jobDir, "words.json"), "utf8"), "[]");
    const rawBrief = readFileSync(r.json.briefPath, "utf8");
    assert.ok(rawBrief.includes("STANDALONE") && rawBrief.includes("It lands on the timeline at 1:23,") && rawBrief.includes("## Placement\nIn front of the footage"));
    const rawJob = JSON.parse(readFileSync(join(r.json.outDir, "job.json"), "utf8"));
    assert.equal(rawJob.raw, true); assert.equal(rawJob.background, "transparent"); assert.equal(rawJob.title, "a stopwatch…");
    r = run(["create", "--raw", "--project-path", bundle, "--start-ms", "0", "--length-ms", "100"]);
    assert.equal(r.code, 1); assert.match(r.json.error, /length-ms/);

    // current / set-current / show / list
    r = run(["current", "--project-path", bundle]);
    assert.equal(r.json.jobId, rawId, "the raw job is current now");
    r = run(["set-current", c.jobId]);
    assert.equal(r.code, 0);
    r = run(["current", "--project-path", bundle]);
    assert.equal(r.json.jobId, c.jobId);
    assert.equal(r.json.job.id, c.jobId);
    r = run(["show", c.jobId]);
    assert.equal(r.json.id, c.jobId);
    r = run(["list", "--project-path", bundle]);
    assert.deepEqual(r.json.map((j) => j.id), [c.jobId, rawId]);
    assert.equal(r.json[0].endMs, 13686);
    assert.equal(r.json[0].placed, null);

    // signal: nothing yet, then render.json.
    r = run(["signal", c.jobId]);
    assert.deepEqual(r.json, { version: null, notes: "", title: null, pending: false, lastRenderedVersion: 0 });
    r = run(["render", c.jobId]);
    assert.equal(r.code, 1); assert.match(r.json.error, /No render.json/);
    writeFileSync(join(c.jobDir, "render.json"), JSON.stringify({ version: 1, notes: "first pass", title: "Three boxes" }));
    r = run(["signal", c.jobId]);
    assert.equal(r.json.version, 1); assert.equal(r.json.pending, true); assert.equal(r.json.title, "Three boxes");
    assert.equal(JSON.parse(readFileSync(join(c.outDir, "job.json"), "utf8")).currentVersion, 1);
    r = run(["status", c.jobId]);
    assert.equal(r.json.state, "idle");

    // Detached render with the fake Remotion CLI, then wait.
    r = run(["render", c.jobId]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.state, "running");
    assert.equal(r.json.version, 1);
    assert.equal(r.json.statusPath, join(c.outDir, "render-status.json"));
    assert.ok(r.json.pid > 0);
    r = run(["wait", c.jobId, "--timeout", "120"]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(r.json.state, "done", JSON.stringify(r.json));
    assert.equal(r.json.version, 1);
    assert.equal(r.json.path, join(c.outDir, `${c.jobId}-v1.mp4`));
    assert.ok(existsSync(r.json.path));
    assert.ok(Math.abs(r.json.durationSec - 296 / 30) < 0.25);
    assert.equal(r.json.codec, "h264");
    const lastArgs = JSON.parse(readFileSync(join(tmp, "last-args.json"), "utf8"));
    assert.deepEqual(lastArgs.slice(0, 2), ["render", c.jobId]);
    assert.ok(lastArgs.includes('--props={"final":true}') && lastArgs.includes("--muted") && lastArgs.includes("--codec=h264") && lastArgs.includes("--crf=14") && lastArgs.includes("--image-format=png"));
    const after = JSON.parse(readFileSync(join(c.outDir, "job.json"), "utf8"));
    assert.equal(after.lastRenderedVersion, 1);
    assert.equal(after.currentVersion, 1);
    assert.equal(after.title, "Three boxes");
    assert.equal(after.renders.length, 1);
    assert.equal(after.renders[0].file, `${c.jobId}-v1.mp4`);
    assert.equal(after.renders[0].notes, "first pass");
    assert.ok(readdirSync(join(c.outDir, "history")).some((f) => /^v1-\d+-Scene\.tsx$/.test(f)), "Scene.tsx snapshot per version");
    assert.ok(existsSync(join(c.outDir, "Scene.tsx")));
    assert.ok(existsSync(join(c.outDir, "render-v1.log")));
    assert.ok(readFileSync(join(c.outDir, "log.jsonl"), "utf8").includes('"kind":"rendered"'));
    assert.equal(existsSync(join(home, "animation-kit", ".render-lock")), false, "the render lock was released");
    r = run(["status", c.jobId]);
    assert.equal(r.json.state, "done");
    r = run(["signal", c.jobId]);
    assert.equal(r.json.pending, false);

    // Same version again is refused; --force re-renders it in the foreground.
    r = run(["render", c.jobId]);
    assert.equal(r.code, 1); assert.match(r.json.error, /already rendered/);
    assert.ok(readFileSync(join(c.outDir, "log.jsonl"), "utf8").includes("already rendered"), "the refusal was logged");
    r = run(["render", c.jobId, "--force", "--foreground", "--quiet"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.version, 1);
    assert.equal(r.json.path, join(c.outDir, `${c.jobId}-v1.mp4`));
    assert.equal(JSON.parse(readFileSync(join(c.outDir, "job.json"), "utf8")).renders.length, 1, "a forced re-render replaces its entry");

    // The transparent raw job renders a .mov via the ProRes branch.
    writeFileSync(join(home, "animation-kit", "src", "jobs", rawId, "render.json"), JSON.stringify({ version: 1 }));
    r = run(["render", rawId, "--foreground", "--quiet"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.codec, "prores4444-alpha");
    assert.ok(r.json.path.endsWith(`${rawId}-v1.mov`) && existsSync(r.json.path));
    const rawArgs = JSON.parse(readFileSync(join(tmp, "last-args.json"), "utf8"));
    assert.ok(rawArgs.includes("--codec=prores") && rawArgs.includes("--prores-profile=4444") && rawArgs.includes("--pixel-format=yuva444p10le"));

    // probe + sheet
    r = run(["probe", join(c.outDir, `${c.jobId}-v1.mp4`)]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.codec, "h264"); assert.equal(r.json.width, 64); assert.deepEqual(r.json.streams, ["video"]);
    r = run(["sheet", c.jobId]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.path, join(c.outDir, "frames", "v1-sheet.png"));
    assert.ok(existsSync(r.json.path));
    r = run(["sheet", join(c.outDir, `${c.jobId}-v1.mp4`), "--out", join(tmp, "custom-sheet.png"), "--frames", "4"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(tmp, "custom-sheet.png")));

    // still through the fake CLI
    r = run(["still", c.jobId, "--frame", "12"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.path, join(c.jobDir, "check.png"));
    assert.ok(existsSync(r.json.path));
    assert.deepEqual(JSON.parse(readFileSync(join(tmp, "last-args.json"), "utf8")), ["still", c.jobId, join(c.jobDir, "check.png"), "--frame=12"]);
    r = run(["anchors", c.jobId]);
    assert.equal(r.json.status, "none");

    // placed / replaced / log / refs
    r = run(["replaced", c.jobId, "--json", JSON.stringify({ replaced_layouts: [{ start_ms: 0, end_ms: 20600, properties: { kind: "fullscreen" } }] })]);
    assert.equal(r.code, 0);
    r = run(["placed", c.jobId, "--json", JSON.stringify({ mode: "behind", media_id: "87d7", layer_id: "screen_2", take_segment_id: "aaaa", layout_segment_id: "bbbb", start_ms: 3820, end_ms: 13686, commit_id: "6c56" })]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.placed.version, 1);
    assert.equal(r.json.placed.commit_id, "6c56");
    assert.equal(r.json.placed.replaced_layouts.length, 1, "replaced pieces fold into the placement record");
    assert.ok(r.json.placed.placed_at > 0);
    assert.deepEqual(r.json.importedMediaIds, ["87d7"]);
    r = run(["list", "--project-path", bundle]);
    assert.deepEqual(r.json[0].placed, { version: 1, commit_id: "6c56", mode: "behind" });
    r = run(["log", c.jobId, "--kind", "note", "--text", "verification frames viewed"]);
    assert.equal(r.code, 0);
    r = run(["log", c.jobId, "--kind", "bogus", "--text", "x"]);
    assert.equal(r.code, 1);
    const logText = readFileSync(join(c.outDir, "log.jsonl"), "utf8");
    assert.ok(logText.includes('"kind":"placed"') && logText.includes("verification frames viewed"));
    // unplaced: a committed remove clears the record but keeps it as lastPlaced
    r = run(["unplaced", c.jobId, "--commit-id", "6d70"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.placed, null);
    assert.equal(r.json.removed.commit_id, "6c56");
    const afterRemove = JSON.parse(readFileSync(join(c.outDir, "job.json"), "utf8"));
    assert.equal(afterRemove.placed, null);
    assert.equal(afterRemove.lastPlaced.take_segment_id, "aaaa");
    assert.ok(readFileSync(join(c.outDir, "log.jsonl"), "utf8").includes("Removed v1 from the project (commit 6d70)"));
    r = run(["list", "--project-path", bundle]);
    assert.equal(r.json[0].placed, null);
    r = run(["placed", c.jobId, "--json", JSON.stringify({ mode: "behind", media_id: "87d7", layer_id: "screen_2", take_segment_id: "aaaa", layout_segment_id: "bbbb", start_ms: 3820, end_ms: 13686, commit_id: "6c56" })]);
    assert.equal(r.code, 0, r.stderr);
    writeFileSync(join(tmp, "my shot (1).png"), "png-bytes");
    r = run(["refs", c.jobId, "--add", join(tmp, "my shot (1).png"), "--add", join(tmp, "my shot (1).png")]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.added, [`src/jobs/${c.jobId}/refs/my_shot_1_.png`, `src/jobs/${c.jobId}/refs/my_shot_1_-1.png`]);
    assert.ok(existsSync(join(home, "animation-kit", r.json.added[1])));
    r = run(["refs", c.jobId, "--add", join(tmp, "missing.png")]);
    assert.equal(r.code, 1);

    // discard keeps the rendered files and the deliverable folder, drops the kit job + manifest entry.
    r = run(["discard", c.jobId]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.wasPlaced, true);
    assert.equal(r.json.keptOutputs, true);
    assert.equal(existsSync(c.jobDir), false);
    assert.ok(!readFileSync(join(home, "animation-kit", "src", "jobs", "manifest.ts"), "utf8").includes(c.jobId));
    assert.ok(existsSync(join(c.outDir, `${c.jobId}-v1.mp4`)));
    assert.equal(JSON.parse(readFileSync(join(c.outDir, "job.json"), "utf8")).discarded, true);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "current.json"), "utf8")), {}, "the discarded job is no longer current");
    r = run(["list", "--project-path", bundle]);
    assert.deepEqual(r.json.map((j) => j.id), [rawId]);
    r = run(["discard", rawId, "--delete-outputs"]);
    assert.equal(r.code, 0);
    assert.equal(existsSync(join(tmp, "Borumi Projects", "Pipeline Demo Agent", "animations", rawId)), false);
    r = run(["show", rawId]);
    assert.equal(r.code, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
