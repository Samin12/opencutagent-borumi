// scripts/frames.mjs: inspect frames -> job-relative names, the frames-map v2 shape with keepOut,
// and (when ffmpeg is present) the real from-borumi / from-media pipelines on a stub image set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  framesFromInspect, stepFromTimes, planMediaTimes, keepOutFor, buildFramesMap, canvasMapFilter, ffmpegBinPath,
  analysisModulePath, kitDirFor, DEFAULT_STEP_SEC, FRAME_WIDTH,
} from "../scripts/frames.mjs";
import { jobFacts, KEEP_OUT } from "../scripts/placement.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const INSPECT = JSON.parse(readFileSync(join(here, "fixtures", "inspect-frames-max.json"), "utf8"));
const JOB = { jobId: "anim-fx", mode: "front", startMs: 0, endMs: 3000, width: 1920, height: 1080, fps: 30, durationInFrames: 90 };
const FF = ffmpegBinPath();
const hasFfmpeg = (() => { try { return spawnSync(FF, ["-version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
const pngSize = (p) => { const b = readFileSync(p); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };

test("framesFromInspect: the real fixture maps to job-relative tNNNN.NN.png names", () => {
  const { frames, skipped, durationSec } = framesFromInspect(INSPECT, jobFacts(JOB));
  assert.equal(durationSec, 3);
  assert.deepEqual(frames.map((f) => [f.t, f.file]), [[0.75, "t0000.75.png"], [2.25, "t0002.25.png"]]);
  assert.equal(frames[0].src, INSPECT.frames[0].path);
  assert.deepEqual(skipped, []);
});

test("framesFromInspect: job start offset, out-of-range and duplicate frames skipped, sorted by t", () => {
  const inspect = { frames: [
    { time_ms: 43250, path: "/x/b.jpg" }, { time_ms: 41750, path: "/x/a.jpg" }, { time_ms: 41752, path: "/x/a2.jpg" },
    { time_ms: 99000, path: "/x/z.jpg" }, { time_ms: 40000, path: "/x/early.jpg" }, { path: "/x/no-time.jpg" },
  ] };
  const { frames, skipped } = framesFromInspect(inspect, jobFacts({ startMs: 41000, endMs: 44000, width: 1920, height: 1080, fps: 30, durationInFrames: 90 }));
  assert.deepEqual(frames.map((f) => [f.t, f.file]), [[0.75, "t0000.75.png"], [2.25, "t0002.25.png"]]);
  assert.deepEqual(skipped.map((s) => s.reason), ["duplicate time", "outside the job range", "outside the job range", "no time_ms or path"]);
});

test("stepFromTimes and planMediaTimes", () => {
  assert.equal(stepFromTimes([0.75, 1.25, 1.75]), 0.5);
  assert.equal(stepFromTimes([0, 0.5, 1.7, 2.2, 2.7]), 0.5, "median gap");
  assert.equal(stepFromTimes([0.75]), DEFAULT_STEP_SEC);
  assert.equal(stepFromTimes([0.75], 3), 3);
  assert.deepEqual(planMediaTimes(1.6, 0.5), [0, 0.5, 1, 1.5]);
  assert.deepEqual(planMediaTimes(0.01), [0]);
});

test("keepOutFor: flag, job hints, behind mode; front without a pinned camera -> null", () => {
  assert.deepEqual(keepOutFor(jobFacts(JOB), { keepOut: true }), KEEP_OUT);
  assert.equal(keepOutFor(jobFacts(JOB), {}), null);
  assert.deepEqual(keepOutFor(jobFacts({ ...JOB, mode: "behind" }), {}), KEEP_OUT);
  assert.deepEqual(keepOutFor({ ...jobFacts(JOB), cameraPinned: true }, {}), KEEP_OUT);
  assert.equal(keepOutFor(jobFacts({ ...JOB, mode: "behind" }), { keepOut: false }), null);
});

test("buildFramesMap: version 2 with source borumi, canvas, step, frames, sheets under sheets/, keepOut, view", () => {
  const facts = jobFacts(JOB);
  const map = buildFramesMap({
    jobId: "anim-fx", source: "borumi", ffmpeg: "/usr/bin/ffmpeg", facts, step: 0.5,
    frames: [{ t: 0.75, file: "t0000.75.png", src: "/x" }],
    sheets: [{ file: "sheet-0000.75-0000.75.png", from: 0.75, to: 0.75, cols: 1, rows: 1, times: [0.75] }],
    analysis: { changes: [{ t: 0.75, score: 0.5, kind: "major" }], shots: [{ start: 0, end: 1, dur: 1 }], black: [] },
    keepOut: KEEP_OUT, view: { type: "render" }, timelineHash: "b490",
  });
  assert.equal(map.version, 2);
  assert.equal(map.jobId, "anim-fx");
  assert.equal(map.source, "borumi");
  assert.deepEqual(map.canvas, { width: 1920, height: 1080, fps: 30 });
  assert.equal(map.durationSec, 3);
  assert.equal(map.step, 0.5);
  assert.equal(map.frameWidth, FRAME_WIDTH);
  assert.deepEqual(map.frames, [{ t: 0.75, file: "t0000.75.png" }], "src is not written into the map");
  assert.equal(map.sheets[0].file, "sheets/sheet-0000.75-0000.75.png");
  assert.equal(map.changes.length, 1);
  assert.deepEqual(map.keepOut, { x: 0.775, y: 0.715, w: 0.225, h: 0.285 });
  assert.deepEqual(map.view, { type: "render" });
  assert.equal(map.timeline_hash, "b490");
  assert.deepEqual(map.range_ms, [0, 3000]);
  assert.equal(map.hiddenTrack, null);
  const small = buildFramesMap({ jobId: "j", source: "none", ffmpeg: "ffmpeg", facts: jobFacts({ ...JOB, width: 640, height: 360 }), step: 0.5, frames: [] });
  assert.equal(small.frameWidth, 640);
  assert.equal(small.keepOut, null);
  assert.deepEqual(small.changes, []);
});

test("canvasMapFilter letterboxes into the canvas; analysis module and kit dir resolution", () => {
  assert.equal(canvasMapFilter(1920, 1080), "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2");
  const plugin = join(root, "animation-kit", "scripts", "frame-analysis.mjs");
  const resolved = analysisModulePath("/nonexistent/kit");
  assert.ok(resolved.endsWith(join("scripts", "frame-analysis.mjs")) && existsSync(resolved), "a missing workspace falls through to an existing copy");
  assert.equal(analysisModulePath(join(root, "animation-kit")), plugin, "a workspace that has the file wins");
  assert.ok(existsSync(analysisModulePath(null)), "some copy of frame-analysis.mjs always resolves");
  assert.equal(kitDirFor(jobFacts(JOB), { kitDir: "/k" }), "/k");
  assert.equal(kitDirFor(jobFacts({ ...JOB, kitDir: "/from-job" }), {}), "/from-job");
  assert.ok(kitDirFor(jobFacts(JOB), {}).endsWith(join(".borumi-agent", "animation-kit")) || process.env.BORUMI_AGENT_HOME);
});

test("from-borumi on a stub image set: canvas-size PNGs, one contact sheet, frames-map.json with analysis and keepOut", { skip: hasFfmpeg ? false : "ffmpeg not found" }, () => {
  mkdirSync(join(root, "tests", ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tests", ".tmp", "frames-"));
  const jpg = join(dir, "jpg");
  mkdirSync(jpg);
  const lavfi = (src, out) => assert.equal(spawnSync(FF, ["-hide_banner", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", src, "-frames:v", "1", out], { encoding: "utf8" }).status, 0);
  lavfi("color=c=red:s=320x180", join(jpg, "f0.jpg"));
  lavfi("testsrc=s=320x180", join(jpg, "f1.jpg"));
  lavfi("color=c=black:s=320x180", join(jpg, "f2.jpg"));
  const inspect = {
    frames: [
      { time_ms: 41750, path: join(jpg, "f0.jpg"), width: 320, height: 180 },
      { time_ms: 42250, path: join(jpg, "f1.jpg"), width: 320, height: 180 },
      { time_ms: 42750, path: join(jpg, "f2.jpg"), width: 320, height: 180 },
      { time_ms: 42760, path: join(jpg, "missing.jpg"), width: 320, height: 180 },
    ],
    view: { type: "render" }, quality: "max", timeline_hash: "abc",
  };
  const inspectPath = join(dir, "inspect.json");
  writeFileSync(inspectPath, JSON.stringify(inspect));
  const jobPath = join(dir, "job.json");
  writeFileSync(jobPath, JSON.stringify({ jobId: "anim-fx", mode: "front", startMs: 41000, endMs: 44000, width: 640, height: 360, fps: 30, durationInFrames: 90, outDir: dir }));
  const kit = join(dir, "kit");
  const run = spawnSync(process.execPath, [join(root, "scripts", "frames.mjs"), "from-borumi", "anim-fx", inspectPath, "--job", jobPath, "--kit-dir", kit, "--keep-out"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const res = JSON.parse(run.stdout);
  assert.equal(res.frameCount, 3);
  assert.equal(res.step, 0.5);
  assert.equal(res.source, "borumi");
  assert.deepEqual(res.keepOut, KEEP_OUT);
  assert.ok(res.warnings.some((w) => /missing frame file missing\.jpg/.test(w)));
  const full = join(kit, "public", "frames", "anim-fx", "full");
  assert.deepEqual(readdirSync(full).sort(), ["t0000.75.png", "t0001.25.png", "t0001.75.png"]);
  assert.deepEqual(pngSize(join(full, "t0000.75.png")), { width: 640, height: 360 });
  assert.deepEqual(readdirSync(join(kit, "public", "frames", "anim-fx", "sheets")), ["sheet-0000.75-0001.75.png"]);
  const map = JSON.parse(readFileSync(join(kit, "src", "jobs", "anim-fx", "frames-map.json"), "utf8"));
  assert.equal(map.version, 2);
  assert.deepEqual(map.frames.map((f) => f.t), [0.75, 1.25, 1.75]);
  assert.deepEqual(map.canvas, { width: 640, height: 360, fps: 30 });
  assert.equal(map.changes.length, 2, "red -> testsrc -> black are two major changes");
  assert.ok(map.changes.every((c) => c.kind === "major"));
  assert.equal(map.shots.length, 3);
  assert.deepEqual(map.black, [{ start: 1.75, end: 2.25 }]);
  assert.deepEqual(map.sheets[0].times, [0.75, 1.25, 1.75]);
  assert.equal(map.sheets[0].file, "sheets/sheet-0000.75-0001.75.png");
  assert.equal(map.timeline_hash, "abc");
  assert.deepEqual(map.view, { type: "render" });
  // a failure is logged to the job folder before it propagates
  const bad = spawnSync(process.execPath, [join(root, "scripts", "frames.mjs"), "from-media", "anim-fx", join(dir, "nope.mp4"), "--job", jobPath, "--kit-dir", kit, "--source-in-ms", "0"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stdout).error, /media file not found/);
  const log = readFileSync(join(dir, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(log[log.length - 1].where, "frames");
});

test("from-media on a generated clip: frames every step from source-in, source media", { skip: hasFfmpeg ? false : "ffmpeg not found" }, () => {
  mkdirSync(join(root, "tests", ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tests", ".tmp", "frames-media-"));
  const clip = join(dir, "clip.mp4");
  const gen = spawnSync(FF, ["-hide_banner", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x180:r=30:d=4", "-pix_fmt", "yuv420p", clip], { encoding: "utf8" });
  assert.equal(gen.status, 0, gen.stderr);
  const jobPath = join(dir, "job.json");
  writeFileSync(jobPath, JSON.stringify({ jobId: "anim-mm", mode: "behind", startMs: 10000, endMs: 12000, width: 640, height: 360, fps: 30, durationInFrames: 60 }));
  const kit = join(dir, "kit");
  const run = spawnSync(process.execPath, [join(root, "scripts", "frames.mjs"), "from-media", "anim-mm", clip, "--job", jobPath, "--kit-dir", kit, "--source-in-ms", "1000", "--step", "0.5"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const res = JSON.parse(run.stdout);
  assert.equal(res.source, "media");
  assert.equal(res.frameCount, 4, "2 s at 0.5 s step: t = 0, 0.5, 1, 1.5");
  assert.deepEqual(res.keepOut, KEEP_OUT, "behind mode pins the camera");
  const map = JSON.parse(readFileSync(join(kit, "src", "jobs", "anim-mm", "frames-map.json"), "utf8"));
  assert.deepEqual(map.frames.map((f) => f.file), ["t0000.00.png", "t0000.50.png", "t0001.00.png", "t0001.50.png"]);
  assert.equal(map.media[0].sourceInMs, 1000);
  assert.deepEqual(pngSize(join(kit, "public", "frames", "anim-mm", "full", "t0001.00.png")), { width: 640, height: 360 });
});
