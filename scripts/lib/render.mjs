// Final render of an animation job. Ported from OpenCutAgent server/animation/render.js:
//  - audio is OFF unless the job's style declared it makes its own (job.audio);
//  - solid bg  -> Remotion h264 (PNG frames, CRF 14), then an ffmpeg remux (-c:v copy -an).
//    Borumi decodes long-GOP h264 fine, so upstream's all-intra transcode is off by default;
//    `allIntra` (flag --all-intra or env BORUMI_AGENT_ALL_INTRA=1) re-enables it;
//  - transparent -> Remotion ProRes 4444 with alpha (.mov), remuxed with -an so no silent
//    audio track reaches the Borumi timeline.
// Every render gets a NEW versioned filename (<id>-v<N>.mp4|.mov). Progress is policed by a
// stall watchdog, not a wall clock, and transient renderer failures get a bare retry.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, openSync, closeSync, writeSync } from "node:fs";
import { join } from "node:path";
import { ffmpegBin, ffprobeBin, nodeBin } from "./paths.mjs";
import { fmtDur } from "./fmt.mjs";

/**
 * `timeoutMs` is a wall-clock ceiling (0 = none); `stallMs` is the one that matters for long
 * jobs: it restarts on every byte of output, so a step that takes an hour but keeps reporting
 * is left alone while a wedged process is caught and REPORTED instead of hanging forever.
 * `logFile` appends the child's output to a file (the detached render worker's log).
 */
export function runProcess(bin, args, { cwd, env = process.env, onStdout, onStderr, timeoutMs = 900000, stallMs = 0, label = bin, logFile = null } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      reject(new Error(`Could not run ${label}: ${e.message}`));
      return;
    }
    let fd = null;
    if (logFile) { try { fd = openSync(logFile, "a"); } catch { fd = null; } }
    const logOut = (s) => { if (fd != null) { try { writeSync(fd, s); } catch { /* ignore */ } } };
    let timedOut = false;
    let stalled = false;
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } };
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, timeoutMs) : null;
    let stallTimer = stallMs ? setTimeout(() => { stalled = true; kill(); }, stallMs) : null;
    const markProgress = () => {
      if (!stallMs) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { stalled = true; kill(); }, stallMs);
    };
    const clearTimers = () => { if (timer) clearTimeout(timer); if (stallTimer) clearTimeout(stallTimer); if (fd != null) { try { closeSync(fd); } catch { /* ignore */ } fd = null; } };
    let err = "";
    child.stdout.on("data", (d) => { markProgress(); const s = d.toString(); logOut(s); if (onStdout) onStdout(s); });
    child.stderr.on("data", (d) => { markProgress(); const s = d.toString(); logOut(s); err += s; if (err.length > 20000) err = err.slice(-20000); if (onStderr) onStderr(s); });
    child.on("error", (e) => { clearTimers(); reject(new Error(`Could not run ${label}: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimers();
      if (stalled) return reject(new Error(`${label} stopped reporting progress for ${Math.round(stallMs / 60000)} min and looked stuck, so it was stopped.`));
      if (timedOut) return reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 60000)} min.`));
      if (code === 0) return resolve({ stderr: err });
      reject(new Error(`${label} failed (exit ${code}). ${err.slice(-600)}`));
    });
  });
}

/** Parse "Duration: 00:01:23.45" out of ffmpeg -i stderr. Pure. */
export function parseFfDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(text || ""));
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Best-effort "Rendered 123/456" progress out of the Remotion CLI output. Pure. */
export function parseRenderProgress(chunk) {
  const matches = String(chunk || "").match(/(\d+)\s*\/\s*(\d+)/g);
  if (!matches || !matches.length) return null;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(matches[matches.length - 1]);
  const done = Number(m[1]), total = Number(m[2]);
  if (!total || done > total) return null;
  return Math.min(99, Math.round((done / total) * 100));
}

/**
 * If the LIVE canvas differs from the job's composition size, render with Remotion's --scale
 * so the clip still comes out at the canvas's real resolution. Only when the aspect ratio
 * matches: scaling cannot fix a horizontal composition for a vertical canvas. Pure.
 * @returns {{scale:number, outWidth:number|null, warning:string|null}}
 */
export function renderScale(job, seqW, seqH) {
  const w = Number(seqW), h = Number(seqH);
  if (!(w > 0) || !(h > 0) || !(job.width > 0) || !(job.height > 0)) return { scale: 1, outWidth: null, warning: null };
  if (w === job.width && h === job.height) return { scale: 1, outWidth: w, warning: null };
  const aspectJob = job.width / job.height;
  const aspectSeq = w / h;
  if (Math.abs(aspectJob - aspectSeq) > 0.01) {
    return {
      scale: 1,
      outWidth: null,
      warning: `The canvas is ${w}x${h} but this animation was created at ${job.width}x${job.height} (a different shape). Create a new animation to match.`,
    };
  }
  return { scale: w / job.width, outWidth: w, warning: null };
}

/** No wall-clock ceiling by default; opt in with BORUMI_AGENT_RENDER_TIMEOUT_MS. */
export function renderTimeoutMs(env = process.env) {
  const v = parseInt(env.BORUMI_AGENT_RENDER_TIMEOUT_MS || "", 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Remotion prints a line per frame, so silence this long means it is wedged (10 min). */
export function renderStallMs(env = process.env) {
  const v = parseInt(env.BORUMI_AGENT_RENDER_STALL_MS || "", 10);
  return Number.isFinite(v) && v > 0 ? v : 600000;
}

/**
 * Browser tabs, not CPU, are the scarce resource at high resolutions: too many concurrent
 * 4K pages starve the renderer until an open delayRender (the font handle) trips the frame
 * timeout. Pure.
 * @returns {number|null} concurrency to pass, or null for Remotion's default
 */
export function renderConcurrency(width, height, env = process.env) {
  const forced = parseInt(env.BORUMI_AGENT_CONCURRENCY || "", 10);
  if (Number.isFinite(forced) && forced > 0) return forced;
  const pixels = Number(width) * Number(height);
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  if (pixels >= 3840 * 2160) return 3;
  if (pixels >= 2560 * 1440) return 4;
  return null;
}

export function renderAttempts(env = process.env) {
  const v = parseInt(env.BORUMI_AGENT_RENDER_ATTEMPTS || "", 10);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 5) : 2;
}

/** Env switch for the libx264 all-intra finishing pass (off by default for Borumi). */
export function allIntraDefault(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.BORUMI_AGENT_ALL_INTRA || ""));
}

/**
 * A Remotion render can die thousands of frames in for reasons that have nothing to do with
 * the scene (a recycled browser tab that never finishes a delayRender, a renderer crash under
 * memory pressure). Those are transient; a cancel or a hard timeout is not. Pure.
 */
export function isTransientRenderError(message) {
  const m = String(message || "");
  if (/Cancelled/i.test(m)) return false;
  if (/timed out after \d+ min/i.test(m)) return false;
  if (/stopped reporting progress/i.test(m)) return true;
  return /delayRender|renderer crashed|Target closed|Session closed|Protocol error|browser has disconnected|out of memory|ENOMEM|exit 1\b/i.test(m);
}

/** "<id>-v<N>.mov" for transparent jobs, "<id>-v<N>.mp4" for solid ones. Pure. */
export function renderFileName(job, version) {
  return `${job.id}-v${version}${job.background === "transparent" ? ".mov" : ".mp4"}`;
}

/**
 * The Remotion CLI argument list (after the CLI entry path), verbatim from upstream:
 * `render <id> <tmp> --timeout=120000 --image-format=png --overwrite --props={"final":true}`,
 * `--muted` unless the style has audio, then the codec flags per background, then optional
 * `--scale` and `--concurrency`. Pure.
 */
export function renderArgs(job, tmpPath, { scale = 1, env = process.env } = {}) {
  const transparent = job.background === "transparent";
  const args = ["render", job.id, tmpPath, "--timeout=120000", "--image-format=png", "--overwrite", '--props={"final":true}'];
  if (!job.audio) args.push("--muted");
  if (transparent) args.push("--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le");
  else args.push("--codec=h264", "--crf=14");
  if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.001) args.push(`--scale=${scale}`);
  const concurrency = renderConcurrency(job.width * (scale || 1), job.height * (scale || 1), env);
  if (concurrency) args.push(`--concurrency=${concurrency}`);
  return args;
}

/**
 * The ffmpeg finishing pass. Both containers are remuxed `-c:v copy` by default; `allIntra`
 * re-enables upstream's libx264 `-g 1 -bf 0` transcode for the mp4. Audio is stripped
 * (`-an`) unless the style declared sound, then re-encoded to AAC. Pure.
 */
export function finishArgs(job, tmpPath, outPath, { allIntra = false } = {}) {
  const audioArgs = job.audio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"];
  const transparent = job.background === "transparent";
  if (transparent || !allIntra) {
    return ["-y", "-i", tmpPath, "-c:v", "copy", ...audioArgs, ...(transparent ? [] : ["-movflags", "+faststart"]), outPath];
  }
  return ["-y", "-i", tmpPath, "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-g", "1", "-bf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", ...audioArgs, outPath];
}

/** Duration in seconds via ffprobe (JSON), falling back to parsing `ffmpeg -i`. */
export async function probeDurationSec(path, { env = process.env } = {}) {
  try {
    let out = "";
    await runProcess(ffprobeBin(env), ["-v", "error", "-print_format", "json", "-show_format", path], { env, timeoutMs: 30000, label: "ffprobe", onStdout: (s) => { out += s; } });
    const parsed = JSON.parse(out || "{}");
    const d = Number(parsed && parsed.format && parsed.format.duration);
    if (Number.isFinite(d)) return d;
  } catch { /* fall through to ffmpeg */ }
  let stderr = "";
  try {
    const r = await runProcess(ffmpegBin(env), ["-hide_banner", "-i", path], { env, timeoutMs: 30000, label: "ffmpeg probe" });
    stderr = r.stderr;
  } catch (e) {
    stderr = String(e.message || "");
  }
  return parseFfDuration(stderr);
}

/** ffprobe JSON (format + streams) for `job.mjs probe`. */
export async function probeFile(path, { env = process.env } = {}) {
  let out = "";
  await runProcess(ffprobeBin(env), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { env, timeoutMs: 30000, label: "ffprobe", onStdout: (s) => { out += s; } });
  return JSON.parse(out || "{}");
}

/**
 * Render one version of the job's composition into its output folder.
 * `cli` is the Remotion CLI entry (run with the current node). `onProgress(text, pct)`.
 * @returns {Promise<{path:string, file:string, durationSec:number|null, codec:string}>}
 */
export async function renderJob({ kitDirPath, cli, job, version, scale = 1, allIntra = allIntraDefault(), onProgress = () => {}, logFile = null, env = process.env }) {
  const transparent = job.background === "transparent";
  const file = renderFileName(job, version);
  const outPath = join(job.outDir, file);
  const tmpPath = join(job.outDir, `.render-tmp-${version}${transparent ? ".mov" : ".mp4"}`);
  mkdirSync(job.outDir, { recursive: true });
  rmSync(tmpPath, { force: true });
  if (!cli || !existsSync(cli)) throw new Error("The animation workspace is not installed yet (Remotion CLI missing). Run `kit.mjs ensure` first.");

  const args = [cli, ...renderArgs(job, tmpPath, { scale, env })];
  const attempts = renderAttempts(env);
  for (let attempt = 1; ; attempt++) {
    onProgress(attempt === 1 ? `Rendering animation v${version}` : `Rendering animation v${version} (attempt ${attempt} of ${attempts})`, 0);
    let lastPct = -1;
    const onChunk = (s) => {
      const pct = parseRenderProgress(s);
      if (pct != null && pct !== lastPct) { lastPct = pct; onProgress(`Rendering animation v${version}: ${pct}%`, pct); }
    };
    try {
      await runProcess(nodeBin(), args, {
        cwd: kitDirPath,
        env,
        timeoutMs: renderTimeoutMs(env),
        stallMs: renderStallMs(env),
        label: "remotion render",
        onStdout: onChunk,
        onStderr: onChunk,
        logFile,
      });
      break;
    } catch (e) {
      if (attempt >= attempts || !isTransientRenderError(e.message)) throw e;
      onProgress(`The renderer stumbled (${String(e.message).slice(-200)}). Starting that render over`, 0);
      rmSync(tmpPath, { force: true });
    }
  }
  if (!existsSync(tmpPath)) throw new Error("Remotion reported success but produced no file.");

  onProgress("Finishing the clip for Borumi", 99);
  rmSync(outPath, { force: true });
  await runProcess(ffmpegBin(env), finishArgs(job, tmpPath, outPath, { allIntra }), {
    env, timeoutMs: allIntra && !transparent ? 900000 : 300000, label: allIntra && !transparent ? "ffmpeg all-intra transcode" : "ffmpeg remux", logFile,
  });
  rmSync(tmpPath, { force: true });

  // Sanity: the clip must match the range (within max(0.25 s, 2 frames); container timestamps round a little).
  const expected = job.durationInFrames / job.fps;
  const durationSec = await probeDurationSec(outPath, { env });
  if (durationSec != null && Math.abs(durationSec - expected) > Math.max(0.25, 2 / job.fps)) {
    throw new Error(`The render came out ${fmtDur(durationSec)} but the range is ${fmtDur(expected)}. The composition duration is fixed by the job; create the job again.`);
  }
  return { path: outPath, file, durationSec, codec: transparent ? "prores4444-alpha" : "h264" };
}
