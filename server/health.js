// Prerequisite checks behind the panel's Health dropdown. Each check answers
// "is this thing the panel NEEDS actually usable from the engine process?"
// (the same PATH, env and overrides the real features use), so a green dot
// here means the feature will work, not merely that a binary exists somewhere.
//
// Pure helpers (version parsing/comparison, fix hints) are exported for tests;
// runHealthChecks() does the spawning.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ffmpegBin } from "./paths.js";
import { resolveClaudeLaunch, claudeSpawnEnv } from "./ai.js";
import { liveEnv } from "./config.js";
import { readCloudConfig } from "./cloud.js";

const IS_WINDOWS = process.platform === "win32";
export const MIN_NODE_MAJOR = 18;

/** "v22.1.0" / "ffmpeg version 7.0.2-..." / "2.1.3 (Claude Code)" -> "22.1.0" style string, or null. */
export function parseVersion(text) {
  const m = String(text || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? `${m[1]}.${m[2]}${m[3] != null ? "." + m[3] : ""}` : null;
}

/** Major number of a version string ("22.1.0" -> 22), NaN when absent. */
export function majorOf(version) {
  return parseInt(String(version || "").split(".")[0], 10);
}

/** True when the running Node satisfies the engine's minimum. */
export function nodeOk(version = process.version, min = MIN_NODE_MAJOR) {
  return majorOf(parseVersion(version)) >= min;
}

/** Platform-specific one-liner the user can follow to install a missing tool. */
export function fixHint(tool, platform = process.platform) {
  const mac = platform === "darwin", win = platform === "win32";
  switch (tool) {
    case "node":
      return mac ? "Install Node 18+: brew install node (or nodejs.org)" : win ? "Install Node 18+: winget install OpenJS.NodeJS.LTS (or nodejs.org)" : "Install Node 18+ from nodejs.org";
    case "ffmpeg":
      return mac ? "Install: brew install ffmpeg" : win ? "Install: winget install Gyan.FFmpeg, then reopen the panel" : "Install ffmpeg and put it on PATH";
    case "claude":
      return "Install Claude Code and sign in: https://claude.ai/code (then reopen the panel)";
    case "elevenlabs":
      return "Add your ElevenLabs key in Settings (gear icon)";
    default:
      return "";
  }
}

/** Run a binary with args, resolve {code, out} or reject on spawn failure / timeout. */
function run(bin, args, { env = process.env, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let out = "", done = false;
    let child;
    try {
      child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: IS_WINDOWS && /\.(cmd|bat)$/i.test(bin) });
    } catch (e) { return reject(e); }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch { /* gone */ } reject(new Error("timed out")); } }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out }); } });
  });
}

async function checkFfmpeg() {
  const bin = ffmpegBin();
  try {
    const r = await run(bin, ["-version"]);
    const v = parseVersion(r.out);
    if (r.code === 0 && v) return { ok: true, detail: v };
    return { ok: false, detail: "not working", fix: fixHint("ffmpeg") };
  } catch {
    return { ok: false, detail: "not found", fix: fixHint("ffmpeg") };
  }
}

async function checkClaude() {
  const [bin, ...prefix] = resolveClaudeLaunch();
  try {
    const r = await run(bin, [...prefix, "--version"], { env: claudeSpawnEnv() });
    const v = parseVersion(r.out);
    if (r.code === 0 && v) return { ok: true, detail: v };
    return { ok: false, detail: "not working", fix: fixHint("claude") };
  } catch {
    return { ok: false, detail: "not found", fix: fixHint("claude") };
  }
}

/**
 * The panel's Health list. Only what a feature needs to run, nothing optional:
 *   node        the engine itself (always true when this code answers, but the
 *               version can still be too old for a dependency)
 *   ffmpeg      Remove Silences, transcription audio extraction, renders
 *   claude      self-hosted: every AI button, the Animation agent, Sync mode
 *               cloud: the Animation agent only
 *   elevenlabs  self-hosted only: the Retakes tab (transcription)
 * `required:false` rows are the ones a mode makes unnecessary; the panel hides them.
 */
export async function runHealthChecks() {
  const mode = readCloudConfig().mode;
  const self = mode !== "cloud";
  const [ffmpeg, claude] = await Promise.all([checkFfmpeg(), checkClaude()]);
  const nodeVersion = parseVersion(process.version);
  const keySet = !!liveEnv("ELEVENLABS_API_KEY");
  return {
    mode,
    platform: process.platform,
    checks: [
      { id: "node", label: "Node.js", ok: nodeOk(), detail: nodeVersion ? "v" + nodeVersion : "unknown", fix: nodeOk() ? "" : fixHint("node"), required: true },
      { id: "ffmpeg", label: "ffmpeg", ...ffmpeg, required: true },
      { id: "claude", label: "Claude Code", ...claude, required: true, note: self ? "AI buttons and animations" : "animations" },
      { id: "elevenlabs", label: "ElevenLabs key", ok: keySet, detail: keySet ? "set" : "not set", fix: keySet ? "" : fixHint("elevenlabs"), required: self, note: "Retakes transcription" },
    ],
  };
}

/** Where a fresh install of the panel is expected on this platform (for hints). */
export function extensionsDir(platform = process.platform, home = homedir(), appData = process.env.APPDATA) {
  if (platform === "win32") return join(appData || join(home, "AppData", "Roaming"), "Adobe", "CEP", "extensions");
  if (platform === "darwin") return join(home, "Library", "Application Support", "Adobe", "CEP", "extensions");
  return join(home, ".adobe", "CEP", "extensions");
}

export function panelLinked(dir = extensionsDir()) {
  return existsSync(join(dir, "com.opencutagent.panel"));
}

