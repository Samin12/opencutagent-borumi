#!/usr/bin/env node
// Animation job lifecycle for the Borumi plugin. Ported from OpenCutAgent
// server/animation/{jobs,index,render}.js as a standalone CLI (contract: DESIGN.md 9.8).
//
// A job = one Remotion composition for one stretch of a Borumi scene (or a raw clip of a
// chosen length): a kit-side folder src/jobs/<id>/ in the animation workspace (where the
// designing agent works) plus a deliverable folder next to the Borumi project,
// "<project name> Agent/animations/<id>/" (job.json, log.jsonl, brief.md copy, history/,
// the rendered <id>-v<N>.mp4|.mov files, frames/).
//
// Every command prints JSON to stdout and logs to stderr. Every failure path writes a line to
// the job's log.jsonl before it propagates. Renders detach by default (Claude Code's Bash tool
// kills commands after 600 s): `render` returns at once with a status file, `wait` polls it.
import { spawn } from "node:child_process";
import {
  existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, appendFileSync, statSync, openSync,
} from "node:fs";
import { join, basename, dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FPS, MIN_JOB_SEC, RAW_MIN_SEC, RAW_MAX_SEC, RAW_DEFAULT_SEC, newJobId, jobTitle, normalizeSizeOverride, durationInFramesFor, endMsEffectiveFor,
  inferCanvasFormat, regenerateManifest, sceneScaffold, extractItems, selectNarration, contextLines, buildWordsJson,
  buildBrief, buildRawBrief, placementLines, planLines, readRenderSignal, kitJobJson,
} from "./lib/brief.mjs";
import { renderJob, probeDurationSec, probeFile, runProcess, allIntraDefault } from "./lib/render.mjs";
import {
  kitDir as defaultKitDir, agentHome, currentJobFile, jobsIndexFile, ensureAgentDir, agentDirFor, assertProjectBundle,
  projectNameFrom, ffmpegBin, nodeBin, KIT_TEMPLATE_DIR, MountError,
} from "./lib/paths.mjs";
import { round3, fmtDur } from "./lib/fmt.mjs";
import {
  syncTemplate, listStyles, styleHasAudio, remotionCliEntry, tscEntry, depsInstalled, writeJsonAtomic, readJson, pidAlive,
} from "./kit.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const MULTI = new Set(["ref", "add"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `--key value` pairs, bare `--flag` booleans, repeated --ref/--add collected, positionals in `_`. Pure. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && a.length > 2) {
      const key = a.slice(2);
      const next = argv[i + 1];
      let val = true;
      if (next !== undefined && !(next.startsWith("--") && next.length > 2)) { val = next; i++; }
      if (MULTI.has(key)) { (out[key] = out[key] || []).push(val); }
      else out[key] = val;
    } else out._.push(a);
  }
  return out;
}

/* ============================ persistence ============================ */

const readJsonFile = (p) => JSON.parse(readFileSync(p, "utf8"));

function jobsIndex() { return readJson(jobsIndexFile(), {}) || {}; }
function indexJob(id, outDir) { const idx = jobsIndex(); idx[id] = outDir; writeJsonAtomic(jobsIndexFile(), idx); }
function unindexJob(id) { const idx = jobsIndex(); delete idx[id]; writeJsonAtomic(jobsIndexFile(), idx); }
function currentMap() { return readJson(currentJobFile(), {}) || {}; }
function setCurrent(projectPath, id) { const m = currentMap(); m[projectPath] = id; writeJsonAtomic(currentJobFile(), m); }

export function saveJob(job) {
  mkdirSync(job.outDir, { recursive: true });
  writeJsonAtomic(join(job.outDir, "job.json"), job);
  indexJob(job.id, job.outDir);
}

/** Append one line to the job's log.jsonl; falls back to ~/.borumi-agent/errors.log when the job folder is unreachable. */
export function appendLog(target, entry) {
  const line = JSON.stringify({ ts: Date.now(), ...entry }) + "\n";
  const outDir = typeof target === "string" ? target : target && target.outDir;
  try {
    if (!outDir) throw new Error("no outDir");
    mkdirSync(outDir, { recursive: true });
    appendFileSync(join(outDir, "log.jsonl"), line);
  } catch {
    try { mkdirSync(agentHome(), { recursive: true }); appendFileSync(join(agentHome(), "errors.log"), line); } catch { /* nothing left to try */ }
  }
}

/** Find a job by id (jobs index, then the kit-side slim job.json); "current" or no id = the current job for --project-path. */
export function loadJob(idArg, { projectPath = null } = {}) {
  let id = idArg;
  if (!id || id === "current") {
    const m = currentMap();
    if (projectPath && m[projectPath]) id = m[projectPath];
    else if (!projectPath && Object.keys(m).length === 1) id = Object.values(m)[0];
    else if (!projectPath && Object.keys(m).length > 1) throw new Error("Several projects have a current animation job; pass --project-path or a job id.");
    if (!id) throw new Error("No current animation job. Create one with `job.mjs create` or pass a job id.");
  }
  const idx = jobsIndex();
  let outDir = idx[id] || null;
  if (!outDir || !existsSync(join(outDir, "job.json"))) {
    const slim = readJson(join(defaultKitDir(), "src", "jobs", id, "job.json"), null);
    if (slim && slim.outDir && existsSync(join(slim.outDir, "job.json"))) outDir = slim.outDir;
  }
  if (!outDir || !existsSync(join(outDir, "job.json"))) throw new Error(`No animation job "${id}" on this machine (looked in the jobs index and the animation workspace).`);
  const job = readJsonFile(join(outDir, "job.json"));
  job.outDir = outDir;
  job.kitDir = job.kitDir || defaultKitDir();
  job.jobDir = join(job.kitDir, "src", "jobs", job.id);
  return job;
}

/* ============================ locks ============================ */

/** mkdir-based lock with a pid file: a dead holder or a stale lock is broken, a live one is waited on. */
async function acquireLock(lockDir, { waitMs = 30000, staleMs = 0, onWait = () => {} } = {}) {
  const started = Date.now();
  let told = false;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "pid"), String(process.pid));
      return () => { try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* gone */ } };
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
      let holder = null, age = 0;
      try { holder = parseInt(readFileSync(join(lockDir, "pid"), "utf8"), 10); age = Date.now() - statSync(lockDir).mtimeMs; } catch { /* half-written lock */ }
      if ((holder && !pidAlive(holder)) || (staleMs && age > staleMs) || (!holder && age > 10000)) {
        try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* raced */ }
        continue;
      }
      if (Date.now() - started > waitMs) throw new Error(`Another process holds ${basename(lockDir)} (pid ${holder || "?"}) and did not finish in time.`);
      if (!told) { told = true; onWait(holder); }
      await sleep(1000);
    }
  }
}

async function withManifestLock(kit, fn) {
  const release = await acquireLock(join(kit, ".manifest-lock"), { waitMs: 60000, staleMs: 120000 });
  try { return await fn(); } finally { release(); }
}

/* ============================ create ============================ */

function copyRefInto(jobDir, src) {
  const source = resolve(String(src));
  if (!existsSync(source)) throw new Error(`Reference image not found: ${source}`);
  const safe = basename(source).replace(/[^\w.@-]+/g, "_").slice(-80) || "image.png";
  const dir = join(jobDir, "refs");
  mkdirSync(dir, { recursive: true });
  let file = safe;
  let n = 1;
  while (existsSync(join(dir, file))) {
    const dot = safe.lastIndexOf(".");
    file = dot > 0 ? `${safe.slice(0, dot)}-${n}${safe.slice(dot)}` : `${safe}-${n}`;
    n++;
  }
  copyFileSync(source, join(dir, file));
  return `src/jobs/${basename(jobDir)}/refs/${file}`;
}

function scenesFrom(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.scenes)) return json.scenes;
  return [];
}

export async function createJob(args, { kit = defaultKitDir(), templateDir = KIT_TEMPLATE_DIR, now = Date.now(), env = process.env, log = () => {} } = {}) {
  const projectPath = args["project-path"];
  if (!projectPath) throw new Error("--project-path is required (the .bmprojbundle).");
  const projectName = args["project-name"] || projectNameFrom(projectPath);
  const mode = args.mode || "behind";
  if (!["behind", "front"].includes(mode)) throw new Error(`--mode must be behind or front (got "${mode}").`);
  const frames = !!args.frames;
  if (frames && mode === "behind") throw new Error("--frames is front-only: a frame-aware overlay must sit on the footage. Use --mode front.");
  let background = args.background || (mode === "front" ? "transparent" : "solid");
  if (!["solid", "transparent"].includes(background)) throw new Error(`--background must be solid or transparent (got "${background}").`);
  if (frames) background = "transparent";
  if (args.fps !== undefined && Number(args.fps) !== FPS) throw new Error(`fps is fixed at ${FPS} (the kit's timing is built on it; Borumi conforms the imported clip).`);

  // Style: shipped or workspace-custom; the default is the style.json flagged default.
  const styles = listStyles({ templateDir, workspaceDir: kit });
  const style = args.style || (styles.find((s) => s.default) || { id: "excalidraw" }).id;
  const styleInfo = styles.find((s) => s.id === style);
  if (!styleInfo) throw new Error(`Unknown style "${style}". Available: ${styles.map((s) => s.id).join(", ") || "none (run kit.mjs ensure)"}.`);

  // Size: the project canvas when given, else 1920x1080 with a note. Even dims always.
  let sizeSource = "canvas";
  let size = normalizeSizeOverride(args.width, args.height);
  if (!size) {
    if (args.width !== undefined || args.height !== undefined) throw new Error(`Unusable canvas size ${args.width}x${args.height} (16..8192 each).`);
    size = { width: 1920, height: 1080 };
    sizeSource = "default";
    log("canvas size not given, composing at 1920x1080");
  }
  const canvasFormat = args["canvas-format"] || inferCanvasFormat(size.width, size.height);

  // Range and duration (floor, never round: the render must never outlast the range).
  const raw = !!args.raw;
  const startMs = Math.round(Number(args["start-ms"] !== undefined ? args["start-ms"] : (raw ? 0 : NaN)));
  if (!Number.isFinite(startMs) || startMs < 0) throw new Error("--start-ms is required (project ms, >= 0).");
  let endMs;
  if (raw) {
    const lengthMs = args["length-ms"] !== undefined ? Number(args["length-ms"]) : (args["end-ms"] !== undefined ? Number(args["end-ms"]) - startMs : RAW_DEFAULT_SEC * 1000);
    if (!Number.isFinite(lengthMs) || lengthMs < RAW_MIN_SEC * 1000 || lengthMs > RAW_MAX_SEC * 1000) throw new Error(`--length-ms must be between ${RAW_MIN_SEC * 1000} and ${RAW_MAX_SEC * 1000} ms.`);
    endMs = startMs + Math.round(lengthMs);
  } else {
    endMs = Math.round(Number(args["end-ms"]));
    if (!Number.isFinite(endMs) || endMs <= startMs) throw new Error("--end-ms is required and must be after --start-ms.");
  }
  const durationInFrames = durationInFramesFor(startMs, endMs, FPS);
  if (durationInFrames < Math.ceil(MIN_JOB_SEC * FPS)) throw new Error(`The range is shorter than half a second (${fmtDur((endMs - startMs) / 1000)}). Pick a longer stretch.`);
  const endMsEffective = endMsEffectiveFor(startMs, durationInFrames, FPS);

  // Scene bounds when known: a range may not cross a scene boundary.
  const sceneId = args["scene-id"] || null;
  const sceneName = args["scene-name"] || null;
  const scenes = args.scenes ? scenesFrom(readJsonFile(args.scenes)) : [];
  if (scenes.length) {
    const scene = sceneId ? scenes.find((s) => s.id === sceneId) : scenes.find((s) => startMs >= Number(s.start_ms) && startMs < Number(s.end_ms));
    if (scene && (startMs < Number(scene.start_ms) || endMsEffective > Number(scene.end_ms))) {
      throw new Error(`The range ${startMs}-${endMsEffective} ms crosses the boundary of scene "${scene.name || scene.id}" (${scene.start_ms}-${scene.end_ms} ms). Make one job per scene.`);
    }
  }

  // Inputs for the brief.
  const userBrief = args["user-brief"] ? String(args["user-brief"]) : "";
  const scriptText = args["script-text"] ? readFileSync(String(args["script-text"]), "utf8") : "";
  let words = [];
  let blocks = [];
  if (!raw) {
    if (!args.words) throw new Error("--words <get_transcript words.json> is required for a narrated job (use --raw for a standalone clip).");
    words = extractItems(readJsonFile(args.words));
    blocks = args.context ? extractItems(readJsonFile(args.context)) : [];
  }

  // Workspace must be synced (cheap, idempotent) so src/jobs/ exists; npm install is kit.mjs ensure's job.
  syncTemplate(templateDir, kit, { log });
  const kitInstalled = depsInstalled(kit);
  if (!kitInstalled) log("the animation workspace has no node_modules yet: run `kit.mjs ensure` before typecheck/still/render");

  const id = newJobId(now);
  const outDir = ensureAgentDir(projectPath, projectName, ["animations", id], { env });
  const jobDir = join(kit, "src", "jobs", id);
  const job = {
    id,
    title: "Animation",
    createdAt: now,
    raw,
    mode,
    style,
    audio: styleHasAudio(style, { templateDir, workspaceDir: kit }),
    background,
    seeFrames: frames,
    sizeSource,
    canvasFormat,
    fps: FPS,
    width: size.width,
    height: size.height,
    durationInFrames,
    startMs,
    endMs,
    endMsEffective,
    range: { startSec: round3(startMs / 1000), endSec: round3(endMsEffective / 1000) },
    sceneId,
    sceneName,
    projectPath,
    projectName,
    kitDir: kit,
    jobDir,
    outDir,
    userBrief: userBrief || null,
    wordsCount: 0,
    refs: [],
    importedMediaIds: [],
    currentVersion: 0,
    lastRenderedVersion: 0,
    renders: [],
    placed: null,
    replaced: null,
  };

  let briefText;
  let wordsJson = [];
  const plan = planLines({ userBrief, scriptText });
  if (raw) {
    job.title = userBrief ? jobTitle(userBrief) : "Raw animation";
    briefText = buildRawBrief(job, { placement: placementLines(job), plan });
  } else {
    const { selected, wordsBySegment } = selectNarration({ words, blocks, startMs, endMs: endMsEffective });
    wordsJson = buildWordsJson(wordsBySegment);
    job.wordsCount = wordsJson.length;
    job.title = jobTitle(selected.map((s) => s.text).join(" "));
    const transcriptLines = contextLines(blocks, startMs, endMsEffective, { scenes, sceneId });
    briefText = buildBrief(job, { selected, transcriptLines, wordsBySegment, placement: placementLines(job), plan });
  }

  // Kit-side folder: refs/, words.json, job.json, Scene.tsx, brief.md, then register.
  mkdirSync(join(jobDir, "refs"), { recursive: true });
  writeFileSync(join(jobDir, "words.json"), JSON.stringify(wordsJson));
  writeFileSync(join(jobDir, "job.json"), JSON.stringify(kitJobJson(job), null, 2));
  writeFileSync(join(jobDir, "Scene.tsx"), sceneScaffold(job, { styleHasSrc: !!styleInfo.hasSrc }));
  writeFileSync(join(jobDir, "brief.md"), briefText);
  for (const ref of args.ref || []) job.refs.push(copyRefInto(jobDir, ref));
  await withManifestLock(kit, () => regenerateManifest(kit));

  // Deliverable folder.
  mkdirSync(join(outDir, "history"), { recursive: true });
  writeFileSync(join(outDir, "brief.md"), briefText);
  saveJob(job);
  setCurrent(projectPath, id);
  appendLog(job, { kind: "created", text: `Animation job created: ${job.title}, ${fmtDur(durationInFrames / FPS)}, ${mode}, ${style}${raw ? ", raw" : `, ${job.wordsCount} words`}.` });

  return {
    jobId: id, kitDir: kit, jobDir, outDir, briefPath: join(jobDir, "brief.md"), scenePath: join(jobDir, "Scene.tsx"),
    wordsCount: job.wordsCount, durationInFrames, endMsEffective, kitInstalled, title: job.title,
  };
}

/* ============================ render ============================ */

const statusPathFor = (job) => join(job.outDir, "render-status.json");

function snapshotScene(job, version) {
  try {
    const src = join(job.jobDir, "Scene.tsx");
    if (!existsSync(src)) return;
    mkdirSync(join(job.outDir, "history"), { recursive: true });
    copyFileSync(src, join(job.outDir, "history", `v${version}-${Date.now()}-Scene.tsx`));
    copyFileSync(src, join(job.outDir, "Scene.tsx"));
  } catch { /* best-effort */ }
}

function resolveVersion(job, { force = false } = {}) {
  const signal = readRenderSignal(job.jobDir);
  if (!signal) throw new Error(`No render.json for ${job.id} yet: the design step writes src/jobs/${job.id}/render.json {"version": N} when the scene is ready.`);
  if (signal.version <= (job.lastRenderedVersion || 0) && !force) {
    throw new Error(`Version ${signal.version} of ${job.id} is already rendered (last rendered v${job.lastRenderedVersion}). Bump render.json's version, or pass --force to render it again.`);
  }
  return signal;
}

async function renderForeground(job, { force = false, allIntra = allIntraDefault(), env = process.env, log = () => {} } = {}) {
  assertProjectBundle(job.projectPath);
  const signal = resolveVersion(job, { force });
  const version = signal.version;
  const statusPath = statusPathFor(job);
  const started = Date.now();
  const base = { state: "running", version, progress: 0, pid: process.pid, started_at: started, message: "starting" };
  writeJsonAtomic(statusPath, base);
  const logFile = join(job.outDir, `render-v${version}.log`);
  const release = await acquireLock(join(job.kitDir, ".render-lock"), {
    waitMs: 3 * 3600000,
    onWait: (pid) => { log(`waiting for another render (pid ${pid || "?"})`); writeJsonAtomic(statusPath, { ...base, queued: true, message: "waiting for another render to finish" }); },
  });
  try {
    const result = await renderJob({
      kitDirPath: job.kitDir, cli: remotionCliEntry(job.kitDir, env), job, version, allIntra, env, logFile,
      onProgress: (text, pct) => { log(text); writeJsonAtomic(statusPath, { ...base, progress: pct == null ? 0 : pct, message: text }); },
    });
    job.lastRenderedVersion = version;
    job.currentVersion = version;
    if (signal.title) job.title = signal.title;
    job.renders = (job.renders || []).filter((r) => r.version !== version);
    job.renders.push({ version, file: result.file, path: result.path, ts: Date.now(), notes: signal.notes, title: signal.title, durationSec: result.durationSec, codec: result.codec });
    snapshotScene(job, version);
    saveJob(job);
    appendLog(job, { kind: "rendered", text: `Rendered v${version}: ${result.file} (${result.durationSec != null ? fmtDur(result.durationSec) : "duration unknown"}).`, version, path: result.path });
    const done = { state: "done", version, progress: 100, pid: process.pid, started_at: started, finished_at: Date.now(), path: result.path, file: result.file, durationSec: result.durationSec, codec: result.codec, title: job.title };
    writeJsonAtomic(statusPath, done);
    return { version, path: result.path, file: result.file, durationSec: result.durationSec, codec: result.codec, elapsedMs: Date.now() - started };
  } catch (e) {
    appendLog(job, { kind: "error", text: `Render v${version} failed: ${e.message}`, version });
    writeJsonAtomic(statusPath, { state: "failed", version, progress: 0, pid: process.pid, started_at: started, finished_at: Date.now(), error: e.message, logPath: logFile });
    throw e;
  } finally {
    release();
  }
}

function renderDetached(job, { force = false, allIntra = false, env = process.env } = {}) {
  assertProjectBundle(job.projectPath);
  const statusPath = statusPathFor(job);
  const running = readJson(statusPath, null);
  if (running && running.state === "running" && pidAlive(running.pid)) {
    return { state: "running", statusPath, version: running.version, pid: running.pid, alreadyRunning: true };
  }
  const signal = resolveVersion(job, { force });
  const logFile = join(job.outDir, `render-v${signal.version}.log`);
  writeJsonAtomic(statusPath, { state: "running", version: signal.version, progress: 0, pid: null, started_at: Date.now(), message: "starting" });
  const fd = openSync(logFile, "a");
  const childArgs = [THIS_FILE, "render", job.id, "--foreground", "--worker"];
  if (force) childArgs.push("--force");
  if (allIntra) childArgs.push("--all-intra");
  const child = spawn(nodeBin(), childArgs, { detached: true, stdio: ["ignore", fd, fd], env, cwd: job.kitDir });
  child.unref();
  const fresh = readJson(statusPath, null);
  if (fresh && fresh.state === "running" && !fresh.pid) writeJsonAtomic(statusPath, { ...fresh, pid: child.pid });
  appendLog(job, { kind: "note", text: `Render v${signal.version} started in the background (pid ${child.pid}).`, version: signal.version });
  return { state: "running", statusPath, version: signal.version, pid: child.pid, logPath: logFile };
}

function readStatus(job) {
  const statusPath = statusPathFor(job);
  const st = readJson(statusPath, null);
  if (!st) return { state: "idle", version: job.lastRenderedVersion || 0, statusPath };
  if (st.state === "running" && st.pid && !pidAlive(st.pid) && Date.now() - (st.started_at || 0) > 3000) {
    const dead = { ...st, state: "failed", error: "the render process exited without reporting (see the render log)", finished_at: Date.now() };
    writeJsonAtomic(statusPath, dead);
    appendLog(job, { kind: "error", text: dead.error, version: st.version });
    return { ...dead, statusPath };
  }
  return { ...st, statusPath };
}

async function waitForRender(job, { timeoutSec = 540 } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const st = readStatus(job);
    if (st.state !== "running") return st;
    if (Date.now() >= deadline) return { ...st, timedOut: true };
    await sleep(1000);
  }
}

/* ============================ design-step helpers ============================ */

async function runCapture(bin, args, { cwd, env = process.env, label, timeoutMs = 600000 } = {}) {
  let out = "";
  try {
    await runProcess(bin, args, { cwd, env, timeoutMs, label, onStdout: (s) => { out += s; }, onStderr: (s) => { out += s; } });
    return { ok: true, output: out.slice(-8000) };
  } catch (e) {
    return { ok: false, output: (out + "\n" + e.message).slice(-8000), error: e.message };
  }
}

async function contactSheet(file, outPath, { frames = 6, env = process.env } = {}) {
  const dur = await probeDurationSec(file, { env });
  const cols = 3, rows = Math.max(1, Math.ceil(frames / cols));
  const pick = dur && dur > 0 ? `fps=${frames / dur}` : "select=not(mod(n\\,10))";
  const vf = `${pick},scale=480:-2,tile=${cols}x${rows}:padding=6:margin=6:color=#202020`;
  mkdirSync(dirname(outPath), { recursive: true });
  await runProcess(ffmpegBin(env), ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", vf, "-frames:v", "1", outPath], { env, timeoutMs: 300000, label: "ffmpeg contact sheet" });
  return { path: outPath, frames, durationSec: dur };
}

function listJobs(projectPath) {
  const root = join(agentDirFor(projectPath, projectNameFrom(projectPath)), "animations");
  const jobs = [];
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return jobs; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const j = readJson(join(root, e.name, "job.json"), null);
    if (j && j.id && !j.discarded) {
      jobs.push({
        id: j.id, title: j.title, sceneId: j.sceneId, sceneName: j.sceneName, startMs: j.startMs, endMs: j.endMsEffective != null ? j.endMsEffective : j.endMs,
        mode: j.mode, style: j.style, background: j.background, createdAt: j.createdAt, currentVersion: j.currentVersion || 0, lastRenderedVersion: j.lastRenderedVersion || 0,
        placed: j.placed ? { version: j.placed.version, commit_id: j.placed.commit_id, mode: j.placed.mode } : null, outDir: join(root, e.name),
      });
    }
  }
  jobs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return jobs;
}

/* ============================ main ============================ */

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const quiet = !!args.quiet;
  const log = (m) => { if (!quiet) process.stderr.write(`[job] ${m}\n`); };
  const print = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  const kit = defaultKitDir();
  let job = null;
  const needJob = () => { job = loadJob(args._[1], { projectPath: args["project-path"] || null }); return job; };

  try {
    switch (cmd) {
      case "create": {
        print(await createJob(args, { kit, log }));
        return 0;
      }
      case "manifest": {
        const count = await withManifestLock(kit, () => regenerateManifest(kit));
        print({ entries: count, manifest: join(kit, "src", "jobs", "manifest.ts") });
        return 0;
      }
      case "signal": {
        needJob();
        const sig = readRenderSignal(job.jobDir);
        if (!sig) { print({ version: null, notes: "", title: null, pending: false, lastRenderedVersion: job.lastRenderedVersion || 0 }); return 0; }
        if (sig.version > (job.currentVersion || 0)) { job.currentVersion = sig.version; saveJob(job); }
        print({ ...sig, pending: sig.version > (job.lastRenderedVersion || 0), lastRenderedVersion: job.lastRenderedVersion || 0 });
        return 0;
      }
      case "render": {
        needJob();
        const force = !!args.force;
        const allIntra = !!args["all-intra"] || allIntraDefault();
        if (args.foreground) { print(await renderForeground(job, { force, allIntra, log })); return 0; }
        print(renderDetached(job, { force, allIntra }));
        return 0;
      }
      case "wait": {
        needJob();
        const st = await waitForRender(job, { timeoutSec: Number(args.timeout) > 0 ? Number(args.timeout) : 540 });
        print(st);
        return st.state === "failed" ? 1 : 0;
      }
      case "status": {
        needJob();
        const st = readStatus(job);
        print(st);
        return st.state === "failed" ? 1 : 0;
      }
      case "typecheck": {
        const r = await runCapture(nodeBin(), [tscEntry(kit), "--noEmit"], { cwd: kit, label: "typecheck" });
        print(r);
        return r.ok ? 0 : 1;
      }
      case "still": {
        needJob();
        const frame = Math.max(0, parseInt(args.frame || "0", 10) || 0);
        const out = args.out ? resolve(String(args.out)) : join(job.jobDir, "check.png");
        mkdirSync(dirname(out), { recursive: true });
        const r = await runCapture(nodeBin(), [remotionCliEntry(kit), "still", job.id, out, `--frame=${frame}`], { cwd: kit, label: "remotion still" });
        if (!r.ok) { appendLog(job, { kind: "error", text: `still at frame ${frame} failed: ${r.error}` }); print({ ok: false, error: r.error, output: r.output }); return 1; }
        print({ ok: true, path: out, frame });
        return 0;
      }
      case "anchors": {
        needJob();
        if (!existsSync(join(job.jobDir, "frames-map.json"))) { print({ status: "none", ok: true, note: "not a frame-aware job (no frames-map.json)" }); return 0; }
        const mod = await import(pathToFileURL(join(kit, "scripts", "check-anchors.mjs")).href);
        const res = mod.runAnchorCheck({ kitDir: kit, jobId: job.id, writeSheets: true, ffmpeg: ffmpegBin() });
        const status = res.reason ? (/anchors\.json/i.test(res.reason) ? "missing" : "skipped") : (res.fails ? "fail" : (res.warns ? "warn" : "ok"));
        print({ status, ...res });
        return status === "fail" ? 1 : 0;
      }
      case "sheet": {
        const target = args._[1];
        let file, out;
        if (target && existsSync(target) && statSync(target).isFile()) {
          file = resolve(target);
          out = args.out ? resolve(String(args.out)) : join(dirname(file), `${basename(file, extname(file))}-sheet.png`);
        } else {
          needJob();
          const last = (job.renders || [])[job.renders.length - 1];
          if (!last) throw new Error(`No render of ${job.id} yet.`);
          file = last.path;
          out = args.out ? resolve(String(args.out)) : join(job.outDir, "frames", `v${last.version}-sheet.png`);
        }
        print(await contactSheet(file, out, { frames: parseInt(args.frames || "6", 10) || 6 }));
        return 0;
      }
      case "probe": {
        const file = args._[1];
        if (!file || !existsSync(file)) throw new Error(`probe: file not found: ${file || "(none)"}`);
        const info = await probeFile(resolve(file));
        const v = (info.streams || []).find((s) => s.codec_type === "video") || {};
        print({ path: resolve(file), durationSec: Number(info.format && info.format.duration) || null, width: v.width || null, height: v.height || null, codec: v.codec_name || null, pixFmt: v.pix_fmt || null, fps: v.r_frame_rate || null, streams: (info.streams || []).map((s) => s.codec_type), raw: info });
        return 0;
      }
      case "list": {
        if (!args["project-path"]) throw new Error("list needs --project-path.");
        print(listJobs(args["project-path"]));
        return 0;
      }
      case "show": {
        needJob();
        print(job);
        return 0;
      }
      case "current": {
        const m = currentMap();
        const pp = args["project-path"];
        const id = pp ? m[pp] || null : (Object.keys(m).length === 1 ? Object.values(m)[0] : null);
        if (!id) { print({ jobId: null, projects: m }); return 0; }
        let rec = null;
        try { rec = loadJob(id); } catch { rec = null; }
        print({ jobId: id, projectPath: pp || (rec && rec.projectPath) || Object.keys(m).find((k) => m[k] === id) || null, job: rec });
        return 0;
      }
      case "set-current": {
        needJob();
        setCurrent(job.projectPath, job.id);
        print({ jobId: job.id, projectPath: job.projectPath });
        return 0;
      }
      case "placed": {
        needJob();
        if (!args.json) throw new Error("placed needs --json '{...}'.");
        const rec = JSON.parse(String(args.json));
        const placed = { ...rec, placed_at: rec.placed_at || Date.now() };
        if (placed.version == null) placed.version = job.lastRenderedVersion || null;
        if (placed.mode == null) placed.mode = job.mode;
        if (job.replaced) {
          if (!placed.replaced_layouts && job.replaced.replaced_layouts) placed.replaced_layouts = job.replaced.replaced_layouts;
          if (!placed.replaced_controls && job.replaced.replaced_controls) placed.replaced_controls = job.replaced.replaced_controls;
          job.replaced = null;
        }
        job.placed = placed;
        job.importedMediaIds = job.importedMediaIds || [];
        if (placed.media_id && !job.importedMediaIds.includes(placed.media_id)) job.importedMediaIds.push(placed.media_id);
        saveJob(job);
        appendLog(job, { kind: "placed", text: `Placed v${placed.version} ${placed.mode === "front" ? "in front" : "behind the camera"}${placed.commit_id ? ` (commit ${placed.commit_id})` : ""}.`, placed });
        print({ jobId: job.id, placed: job.placed, importedMediaIds: job.importedMediaIds });
        return 0;
      }
      case "unplaced": {
        // After a remove committed: clear the placed record (kept as lastPlaced for the log/history).
        needJob();
        const was = job.placed || null;
        job.lastPlaced = was || job.lastPlaced || null;
        job.placed = null;
        job.replaced = null;
        saveJob(job);
        appendLog(job, { kind: "note", text: was ? `Removed v${was.version} from the project${args["commit-id"] ? ` (commit ${args["commit-id"]})` : ""}.` : "Unplaced: no placement was recorded.", removed: was, commit_id: args["commit-id"] || null });
        print({ jobId: job.id, placed: null, removed: was });
        return 0;
      }
      case "replaced": {
        needJob();
        if (!args.json) throw new Error("replaced needs --json '{...}'.");
        const rec = JSON.parse(String(args.json));
        job.replaced = { ...(job.replaced || {}), ...rec };
        saveJob(job);
        appendLog(job, { kind: "note", text: "Recorded replaced layouts/controls for restore on remove.", replaced: rec });
        print({ jobId: job.id, replaced: job.replaced });
        return 0;
      }
      case "log": {
        needJob();
        const kind = String(args.kind || "note");
        if (!["note", "error", "placed"].includes(kind)) throw new Error("--kind must be note, error or placed.");
        appendLog(job, { kind, text: String(args.text || "") });
        print({ jobId: job.id, logged: kind });
        return 0;
      }
      case "refs": {
        needJob();
        const added = [];
        for (const p of args.add || []) added.push(copyRefInto(job.jobDir, p));
        if (!added.length) throw new Error("refs needs --add <image> (repeatable).");
        job.refs = [...(job.refs || []), ...added];
        saveJob(job);
        appendLog(job, { kind: "note", text: `Added ${added.length} reference image(s).`, refs: added });
        print({ jobId: job.id, added, refs: job.refs });
        return 0;
      }
      case "discard": {
        needJob();
        const deleteOutputs = !!args["delete-outputs"];
        try { rmSync(job.jobDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { rmSync(join(kit, "public", "frames", job.id), { recursive: true, force: true }); } catch { /* ignore */ }
        await withManifestLock(kit, () => regenerateManifest(kit));
        const m = currentMap();
        if (m[job.projectPath] === job.id) { delete m[job.projectPath]; writeJsonAtomic(currentJobFile(), m); }
        if (deleteOutputs) {
          try { rmSync(job.outDir, { recursive: true, force: true }); } catch { /* ignore */ }
          unindexJob(job.id);
        } else {
          job.discarded = true;
          appendLog(job, { kind: "note", text: "Job discarded; rendered files kept (Borumi copied them into the bundle anyway)." });
          saveJob(job);
        }
        print({ discarded: true, jobId: job.id, wasPlaced: !!job.placed, placed: job.placed || null, outDir: job.outDir, keptOutputs: !deleteOutputs });
        return 0;
      }
      case undefined:
      case "help": {
        process.stderr.write("job.mjs create|manifest|signal|render|wait|status|typecheck|still|anchors|sheet|probe|list|show|current|set-current|placed|unplaced|replaced|log|refs|discard (see docs/DESIGN.md 9.8)\n");
        return cmd ? 0 : 2;
      }
      default:
        throw new Error(`Unknown command "${cmd}".`);
    }
  } catch (e) {
    const msg = e instanceof MountError ? e.message : (e && e.message) || String(e);
    if (job) appendLog(job, { kind: "error", text: `${cmd}: ${msg}` });
    else appendLog(null, { kind: "error", text: `${cmd || "job.mjs"}: ${msg}` });
    process.stderr.write(`[job] ${msg}\n`);
    print({ ok: false, error: msg, kind: e && e.name === "MountError" ? "mount" : "error" });
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => {
    process.stdout.write(JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }) + "\n");
    process.exit(1);
  });
}
