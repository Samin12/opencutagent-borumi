#!/usr/bin/env node
// Frame-aware jobs: turn Borumi inspect_timeline frames (or a media file) into the kit's
// public/frames/<jobId>/full/tNNNN.NN.png set at canvas size, 4x3 contact sheets, and
// src/jobs/<jobId>/frames-map.json version 2 (DESIGN 9.2), so the kit's frames/SKILL.md,
// grab-frames.mjs and check-anchors.mjs work unchanged. Ported from OpenCutAgent
// server/animation/frames.js with the Premiere export replaced by Borumi's saved JPGs.
//
//   frames.mjs from-borumi <jobId> <inspect.json> --job <job.json> [--keep-out] [--kit-dir D] [--layer screen_1]
//   frames.mjs from-media  <jobId> <file> --job <job.json> --source-in-ms X [--step 0.5] [--kit-dir D] [--keep-out]
//
// inspect.json = the inspect_timeline reply with save:true, include_images:false
// ({frames:[{time_ms, path, width, height}], view, quality, timeline_hash}). Frame time t (seconds,
// relative to the job start) = (time_ms - start_ms) / 1000. The frame analysis (changes, shots,
// black) is imported from the kit WORKSPACE copy of scripts/frame-analysis.mjs (the same file
// check-anchors uses), falling back to the plugin's own animation-kit/scripts copy.
// keepOut = the pinned-camera rectangle in canvas ratios; written when --keep-out is passed, the
// job says the camera is pinned (job.keepOut / job.cameraPinned), or the job mode is behind.
// JSON to stdout, logs to stderr, failures appended to <outDir>/log.jsonl before they propagate.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { frameName } from "../animation-kit/scripts/frame-analysis.mjs";
import { jobFacts, KEEP_OUT } from "./placement.mjs";

export const DEFAULT_STEP_SEC = 0.5;
export const FRAME_WIDTH = 1568; // downscale hint for the agent's Reads (vision detail plateaus ~1.15MP)
export const SHEET_COLS = 4;
export const SHEET_ROWS = 3;
export const SHEET_TILE_W = 480;
export const THUMB_W = 320;
export const THUMB_H = 180;

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** ffmpeg binary: FFMPEG_BIN, then the usual Homebrew and /usr/local locations, then PATH. */
export function ffmpegBinPath() {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  for (const p of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) if (existsSync(p)) return p;
  return "ffmpeg";
}

/** The kit workspace: --kit-dir, job.kitDir, $BORUMI_AGENT_HOME/animation-kit, ~/.borumi-agent/animation-kit. */
export function kitDirFor(facts, opts = {}) {
  if (opts.kitDir) return resolve(opts.kitDir);
  if (facts && facts.kitDir) return resolve(facts.kitDir);
  const home = process.env.BORUMI_AGENT_HOME || join(homedir(), ".borumi-agent");
  return join(home, "animation-kit");
}

/** Where frame-analysis.mjs is loaded from: the workspace copy first, then the plugin's copy. */
export function analysisModulePath(kitDir) {
  const home = process.env.BORUMI_AGENT_HOME || join(homedir(), ".borumi-agent");
  const candidates = [
    kitDir ? join(kitDir, "scripts", "frame-analysis.mjs") : null,
    join(home, "animation-kit", "scripts", "frame-analysis.mjs"),
    join(PLUGIN_ROOT, "animation-kit", "scripts", "frame-analysis.mjs"),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || candidates[candidates.length - 1];
}

/* ---------- pure planning ---------- */

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** The ffmpeg -vf chain that maps a frame into canvas space (letterboxed, never stretched). */
export function canvasMapFilter(canvasW, canvasH) {
  return `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease,pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2`;
}

/**
 * Map Borumi inspect frames onto job-relative times and kit file names. Frames outside the job
 * range are skipped; two frames rounding to the same name keep the first.
 * @returns {{frames:Array<{t:number,file:string,src:string,time_ms:number}>, skipped:Array}}
 */
export function framesFromInspect(inspect, facts) {
  const durationSec = facts.durationInFrames != null ? facts.durationInFrames / facts.fps : (facts.endMs - facts.startMs) / 1000;
  const frames = [];
  const skipped = [];
  const seen = new Set();
  for (const f of (inspect && inspect.frames) || []) {
    if (!f || f.time_ms == null || !f.path) { skipped.push({ frame: f, reason: "no time_ms or path" }); continue; }
    const t = r2((Number(f.time_ms) - facts.startMs) / 1000);
    if (t < -0.005 || t > durationSec + 0.01) { skipped.push({ time_ms: f.time_ms, t, reason: "outside the job range" }); continue; }
    const file = frameName(Math.max(0, t));
    if (seen.has(file)) { skipped.push({ time_ms: f.time_ms, t, reason: "duplicate time" }); continue; }
    seen.add(file);
    frames.push({ t: Math.max(0, t), file, src: f.path, time_ms: Number(f.time_ms) });
  }
  frames.sort((a, b) => a.t - b.t);
  return { frames, skipped, durationSec: r3(durationSec) };
}

/** The sampling step in seconds: the median gap between consecutive frame times (2 decimals), else the fallback. */
export function stepFromTimes(times, fallback = DEFAULT_STEP_SEC) {
  const ts = (times || []).slice().sort((a, b) => a - b);
  if (ts.length < 2) return fallback;
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)];
  return mid > 0 ? r2(mid) : fallback;
}

/** Rel times for a media extraction: every step seconds from 0, a hair inside the end. */
export function planMediaTimes(durationSec, step = DEFAULT_STEP_SEC) {
  const s = Number(step) > 0 ? Number(step) : DEFAULT_STEP_SEC;
  const times = [];
  const last = Math.max(0, durationSec - 0.02);
  for (let t = 0; t <= last + 1e-9; t = Math.round((t + s) * 1000) / 1000) times.push(r2(t));
  if (!times.length) times.push(0);
  return times;
}

/** The pinned-camera keep-out rectangle when the camera is pinned, else null. */
export function keepOutFor(facts, opts = {}) {
  if (opts.keepOut === false) return null;
  const pinned = !!opts.keepOut || !!(facts && (facts.keepOut || facts.cameraPinned)) || (facts && facts.mode === "behind");
  return pinned ? { ...KEEP_OUT } : null;
}

/** frames-map.json version 2 (pure). */
export function buildFramesMap({ jobId, source, ffmpeg, facts, step, frames, sheets = [], analysis = null, keepOut = null, view = null, timelineHash = null, media = [] }) {
  const durationSec = facts.durationInFrames != null ? facts.durationInFrames / facts.fps : (facts.endMs - facts.startMs) / 1000;
  const a = analysis || { changes: [], shots: [], black: [] };
  return {
    version: 2,
    jobId,
    source, // "borumi" (inspect_timeline frames: exact composite) | "media" (decoded file: a guess) | "none"
    ffmpeg,
    canvas: { width: facts.width, height: facts.height, fps: facts.fps },
    durationSec: r3(durationSec),
    step,
    frameWidth: Math.min(FRAME_WIDTH, facts.width || FRAME_WIDTH),
    frames: frames.map((f) => ({ t: f.t, file: f.file })),
    sheets: sheets.map((s) => ({ ...s, file: s.file.startsWith("sheets/") ? s.file : `sheets/${s.file}` })),
    changes: a.changes || [],
    shots: a.shots || [],
    black: a.black || [],
    hiddenTrack: null,
    media,
    keepOut,
    view,
    timeline_hash: timelineHash,
    range_ms: facts.startMs != null ? [facts.startMs, facts.endMs] : null,
  };
}

/* ---------- ffmpeg work ---------- */

function ff(ffmpeg, args, opts = {}) {
  return execFileSync(ffmpeg, ["-hide_banner", "-nostdin", "-y", "-v", "error", ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26, ...opts });
}

/** Convert one Borumi JPG (any size) to a canvas-size PNG. */
export function convertFrame(ffmpeg, src, dst, width, height) {
  ff(ffmpeg, ["-i", src, "-vf", canvasMapFilter(width, height), "-frames:v", "1", dst]);
}

/** 4x3 contact sheets (480 px tiles, 6 px #202020 padding) named sheet-<from>-<to>.png. */
export function writeSheets(ffmpeg, fullDir, frames, sheetDir) {
  mkdirSync(sheetDir, { recursive: true });
  const per = SHEET_COLS * SHEET_ROWS;
  const sheets = [];
  const stamp = (t) => frameName(t).replace(/^t|\.png$/g, "");
  for (let i = 0; i < frames.length; i += per) {
    const group = frames.slice(i, i + per);
    const tmp = mkdtempSync(join(tmpdir(), "borumi-sheet-"));
    try {
      const list = join(tmp, "list.txt");
      writeFileSync(list, group.map((f) => `file '${join(fullDir, f.file).replace(/'/g, "'\\''")}'\nduration 1`).join("\n") + "\n");
      const file = `sheet-${stamp(group[0].t)}-${stamp(group[group.length - 1].t)}.png`;
      const cols = Math.min(SHEET_COLS, group.length);
      const rows = Math.ceil(group.length / cols);
      const vf = `scale=${SHEET_TILE_W}:-2,pad=iw+6:ih+6:3:3:color=#202020,tile=${cols}x${rows}`;
      try {
        ff(ffmpeg, ["-f", "concat", "-safe", "0", "-i", list, "-fps_mode", "passthrough", "-vf", vf, "-frames:v", "1", join(sheetDir, file)]);
      } catch {
        ff(ffmpeg, ["-f", "concat", "-safe", "0", "-i", list, "-vsync", "0", "-vf", vf, "-frames:v", "1", join(sheetDir, file)]);
      }
      sheets.push({ file, from: group[0].t, to: group[group.length - 1].t, cols, rows, times: group.map((f) => f.t) });
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  return sheets;
}

/** Change analysis over the full frames via the kit's shared module (workspace copy first). */
export async function analyzeFrames(ffmpeg, files, times, step, kitDir) {
  const modPath = analysisModulePath(kitDir);
  const { grayFrames, detectChanges, shotsFromChanges, blackSpans } = await import(pathToFileURL(modPath).href);
  const gray = grayFrames(ffmpeg, files, { w: THUMB_W, h: THUMB_H });
  const changes = detectChanges(gray, times, THUMB_W, THUMB_H);
  const endT = times.length ? times[times.length - 1] + step : 0;
  return { changes, shots: shotsFromChanges(times, changes, endT), black: blackSpans(gray, times, step), module: modPath };
}

/* ---------- drivers ---------- */

function logToJob(facts, kind, text) {
  try {
    if (!facts || !facts.outDir || !existsSync(facts.outDir)) return false;
    appendFileSync(join(facts.outDir, "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), kind, where: "frames", text }) + "\n");
    return true;
  } catch { return false; }
}

async function finish({ jobId, source, ffmpeg, facts, kitDir, fullDir, frames, step, keepOut, view, timelineHash, warnings, media = [] }) {
  const sheetDir = join(kitDir, "public", "frames", jobId, "sheets");
  let analysis = null;
  let sheets = [];
  if (frames.length) {
    try {
      analysis = await analyzeFrames(ffmpeg, frames.map((f) => join(fullDir, f.file)), frames.map((f) => f.t), step, kitDir);
    } catch (e) {
      warnings.push(`frame analysis failed: ${e.message}`);
    }
    try {
      sheets = writeSheets(ffmpeg, fullDir, frames, sheetDir);
    } catch (e) {
      warnings.push(`contact sheets failed: ${e.message}`);
    }
  } else {
    warnings.push("no frames were produced: the animation will use a free canvas");
  }
  const map = buildFramesMap({ jobId, source: frames.length ? source : "none", ffmpeg, facts, step, frames, sheets, analysis, keepOut, view, timelineHash, media });
  const jobDir = join(kitDir, "src", "jobs", jobId);
  mkdirSync(jobDir, { recursive: true });
  const mapPath = join(jobDir, "frames-map.json");
  writeFileSync(mapPath, JSON.stringify(map, null, 2));
  return {
    jobId, source: map.source, frameCount: frames.length, step, keepOut, mapPath, fullDir,
    sheets: sheets.map((s) => join(sheetDir, s.file)), changes: map.changes.length, shots: map.shots.length, black: map.black.length,
    analysisModule: analysis ? analysis.module : null, warnings,
  };
}

/** from-borumi: inspect frames -> full PNGs at canvas size -> sheets -> frames-map.json. */
export async function fromBorumi(jobId, inspect, job, opts = {}) {
  const facts = jobFacts(job);
  const warnings = [];
  const kitDir = kitDirFor(facts, opts);
  const ffmpeg = opts.ffmpeg || ffmpegBinPath();
  if (facts.startMs == null || !facts.width || !facts.height) throw new Error("job.json needs start_ms, width and height");
  const plan = framesFromInspect(inspect, facts);
  if (plan.skipped.length) warnings.push(`${plan.skipped.length} inspect frame(s) skipped (${[...new Set(plan.skipped.map((s) => s.reason))].join("; ")})`);
  const fullDir = join(kitDir, "public", "frames", jobId, "full");
  mkdirSync(fullDir, { recursive: true });
  const frames = [];
  for (const f of plan.frames) {
    if (!existsSync(f.src)) { warnings.push(`missing frame file ${basename(f.src)} at ${f.t}s`); continue; }
    try {
      convertFrame(ffmpeg, f.src, join(fullDir, f.file), facts.width, facts.height);
      frames.push(f);
    } catch (e) {
      warnings.push(`could not convert ${basename(f.src)}: ${String(e.stderr || e.message).trim().slice(-200)}`);
    }
  }
  const step = stepFromTimes(frames.map((f) => f.t), plan.durationSec && frames.length === 1 ? plan.durationSec : DEFAULT_STEP_SEC);
  const view = (inspect && inspect.view) || (opts.layer ? { type: "layer_source", layer_id: opts.layer } : { type: "render" });
  return finish({ jobId, source: "borumi", ffmpeg, facts, kitDir, fullDir, frames, step, keepOut: keepOutFor(facts, opts), view, timelineHash: (inspect && inspect.timeline_hash) || null, warnings });
}

/** from-media: decode a media file every step seconds from source-in (ms) for the job's duration. */
export async function fromMedia(jobId, file, job, opts = {}) {
  const facts = jobFacts(job);
  const warnings = [];
  const kitDir = kitDirFor(facts, opts);
  const ffmpeg = opts.ffmpeg || ffmpegBinPath();
  if (!existsSync(file)) throw new Error(`media file not found: ${file}`);
  if (facts.startMs == null || !facts.width || !facts.height) throw new Error("job.json needs start_ms, width and height");
  const durationSec = facts.durationInFrames != null ? facts.durationInFrames / facts.fps : (facts.endMs - facts.startMs) / 1000;
  const step = Number(opts.step) > 0 ? Number(opts.step) : DEFAULT_STEP_SEC;
  const sourceInSec = (Number(opts.sourceInMs) || 0) / 1000;
  const fullDir = join(kitDir, "public", "frames", jobId, "full");
  mkdirSync(fullDir, { recursive: true });
  const pattern = join(fullDir, "mf-%04d.png");
  ff(ffmpeg, ["-ss", String(sourceInSec), "-t", String(durationSec), "-i", file, "-vf", `fps=1/${step},${canvasMapFilter(facts.width, facts.height)}`, pattern]);
  const frames = [];
  for (const f of readdirSync(fullDir)) {
    const m = /^mf-(\d+)\.png$/.exec(f);
    if (!m) continue;
    const rel = r2((Number(m[1]) - 1) * step);
    if (rel > durationSec + 0.01) { rmSync(join(fullDir, f), { force: true }); continue; }
    const name = frameName(rel);
    renameSync(join(fullDir, f), join(fullDir, name));
    frames.push({ t: rel, file: name });
  }
  frames.sort((a, b) => a.t - b.t);
  const media = [{ path: resolve(file), sourceInMs: Number(opts.sourceInMs) || 0 }];
  return finish({ jobId, source: "media", ffmpeg, facts, kitDir, fullDir, frames, step, keepOut: keepOutFor(facts, opts), view: { type: "media" }, timelineHash: null, warnings, media });
}

/* ---------- CLI ---------- */

function parseArgv(argv) {
  const out = { cmd: argv[0] || "", opts: {}, positional: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) { out.opts[key] = next; i++; }
      else out.opts[key] = true;
    } else out.positional.push(a);
  }
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

async function main(argv) {
  const { cmd, opts, positional } = parseArgv(argv);
  if (cmd !== "from-borumi" && cmd !== "from-media") throw new Error("usage: frames.mjs from-borumi <jobId> <inspect.json> --job <job.json> | from-media <jobId> <file> --job <job.json> --source-in-ms X");
  const [jobId, input] = positional;
  if (!jobId || !input || !opts.job) throw new Error(`${cmd} needs <jobId> <${cmd === "from-borumi" ? "inspect.json" : "file"}> --job <job.json>`);
  const job = readJson(opts.job);
  const common = { kitDir: opts["kit-dir"], keepOut: opts["keep-out"] ? true : undefined, ffmpeg: opts.ffmpeg, layer: opts.layer };
  try {
    const res = cmd === "from-borumi"
      ? await fromBorumi(jobId, readJson(input), job, common)
      : await fromMedia(jobId, input, job, { ...common, sourceInMs: opts["source-in-ms"], step: opts.step });
    for (const w of res.warnings) console.error(`frames.mjs: ${w}`);
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    logToJob(jobFacts(job), "error", `frames ${cmd}: ${e.message}`);
    throw e;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`frames.mjs: ${e.message}`);
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  });
}
