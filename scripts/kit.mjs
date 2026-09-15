#!/usr/bin/env node
// Animation workspace management. Ported from OpenCutAgent server/animation/kit.js.
//
// The plugin ships the Remotion project TEMPLATE at <plugin>/animation-kit; at runtime it is
// synced into a user-writable workspace OUTSIDE the plugin (~/.borumi-agent/animation-kit,
// env BORUMI_AGENT_HOME) and `npm install`ed once. Two reasons the workspace is not the
// plugin folder itself: job churn and node_modules stay out of the install, and a designer
// agent whose cwd is the workspace inherits no CLAUDE.md from the plugin or the user's project.
//
// CLI (JSON on stdout, logs on stderr):
//   kit.mjs ensure [--quiet] [--detach] [--no-browser] [--no-install]
//   kit.mjs wait [--timeout 540]        block on a detached ensure (kit-status.json)
//   kit.mjs status
//   kit.mjs styles                      list styles (template + workspace custom)
//   kit.mjs path                        workspace + template paths, installed flags
import { spawn } from "node:child_process";
import {
  existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, renameSync, openSync,
} from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KIT_TEMPLATE_DIR, kitDir as defaultKitDir, nodeBin, npmBin } from "./lib/paths.mjs";

const IS_WINDOWS = process.platform === "win32";
const THIS_FILE = fileURLToPath(import.meta.url);

// Template files worth syncing. node_modules/lockfiles never ship in the template; job folders
// exist only in the workspace.
const SKIP_DIRS = new Set(["node_modules", ".remotion", "out", "build", ".git"]);
const SKIP_FILES = new Set(["package-lock.json", ".kit-version", ".deps-hash", ".DS_Store"]);

export function walkTemplate(dir, base, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkTemplate(join(dir, e.name), base, out);
    } else if (!SKIP_FILES.has(e.name)) {
      out.push(relative(base, join(dir, e.name)).split(sep).join("/"));
    }
  }
  return out;
}

/** Content hash of the shipped template: changes when the kit is updated. */
export function templateSignature(templateDir = KIT_TEMPLATE_DIR) {
  const files = walkTemplate(templateDir, templateDir, []).sort();
  const h = createHash("sha1");
  for (const f of files) {
    h.update(f);
    h.update(readFileSync(join(templateDir, f)));
  }
  return h.digest("hex");
}

// Workspace files never clobbered once they exist: the style skills and the frames guide carry
// a user-grown Learnings log the agent appends to. A template update must not erase it.
export const PRESERVE = [/^styles\/[^/]+\/SKILL\.md$/, /^frames\/SKILL\.md$/];

/** `<!-- guide-version: N -->` marker of a preserved guide (0 when absent). Pure. */
export function guideVersion(text) {
  const m = /<!--\s*guide-version:\s*(\d+)\s*-->/.exec(String(text || ""));
  return m ? Number(m[1]) : 0;
}

/**
 * Upgrade a preserved guide in place: when the template carries a higher guide-version than
 * the workspace copy, the template body wins but the workspace's "## Learnings log" entries
 * are carried over. Returns the merged text, or null when nothing should change. Pure.
 * Case-insensitive on purpose: the shipped styles write "## Learnings log" and a case-sensitive
 * match once dropped every entry a user had taught a style.
 */
export function mergePreservedGuide(templateText, workspaceText) {
  if (guideVersion(templateText) <= guideVersion(workspaceText)) return null;
  const logRe = /^## Learnings log[\s\S]*$/mi;
  const oldLog = logRe.exec(workspaceText);
  if (!oldLog) return templateText;
  const newLog = logRe.exec(templateText);
  if (!newLog) return templateText.replace(/\s*$/, "\n\n") + oldLog[0];
  const oldEntries = oldLog[0].split("\n").slice(1).filter((l) => /^\s*[-*]\s|^\s*\d{4}-\d{2}-\d{2}/.test(l));
  if (!oldEntries.length) return templateText;
  return templateText.replace(/\s*$/, "\n") + oldEntries.join("\n") + "\n";
}

// The generated jobs manifest: the template's empty copy must never overwrite a workspace
// manifest that registers real jobs (job.mjs regenerateManifest owns it).
export const GENERATED = new Set(["src/jobs/manifest.ts"]);

/**
 * Copy the template into the workspace when the signature changed. Additive: never deletes.
 * Returns {copied, changed} where changed says whether the signature moved. Pure given dirs.
 */
export function syncTemplate(templateDir, dir, { log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const sig = templateSignature(templateDir);
  const verFile = join(dir, ".kit-version");
  let cur = null;
  try { cur = readFileSync(verFile, "utf8").trim(); } catch { /* first run */ }
  if (cur === sig) return { copied: 0, changed: false, signature: sig };
  const files = walkTemplate(templateDir, templateDir, []);
  let copied = 0;
  for (const f of files) {
    const dest = join(dir, f);
    if (GENERATED.has(f) && existsSync(dest)) continue;
    if (PRESERVE.some((re) => re.test(f)) && existsSync(dest)) {
      const merged = mergePreservedGuide(readFileSync(join(templateDir, f), "utf8"), readFileSync(dest, "utf8"));
      if (merged != null) { writeFileSync(dest, merged); copied++; }
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(templateDir, f), dest);
    copied++;
  }
  writeFileSync(verFile, sig);
  log(`animation kit synced (${copied} file(s)) -> ${dir}`);
  return { copied, changed: true, signature: sig };
}

function runChild(bin, args, { cwd, label, env = process.env, shell = false, logFile = null, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let stdio = ["ignore", "pipe", "pipe"];
    let fd = null;
    if (logFile) { try { fd = openSync(logFile, "a"); stdio = ["ignore", fd, fd]; } catch { fd = null; } }
    let child;
    try {
      child = spawn(bin, args, { cwd, env, stdio, shell });
    } catch (e) {
      return reject(new Error(`Could not run ${label}: ${e.message}`));
    }
    let err = "";
    if (child.stderr) child.stderr.on("data", (d) => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
    if (child.stdout) child.stdout.on("data", () => {});
    const timer = timeoutMs ? setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, timeoutMs) : null;
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new Error(`Could not run ${label}: ${e.message}. Is Node/npm installed?`)); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`${label} failed (exit ${code}). ${err.slice(-400)}`));
    });
  });
}

export function runNpmInstall(dir, { logFile = null } = {}) {
  return runChild(npmBin(), ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: dir, label: "npm install for the animation kit", shell: IS_WINDOWS, logFile, timeoutMs: 30 * 60000,
  });
}

/** Path to the Remotion CLI's JS entry inside the workspace (run with the current node). */
export function remotionCliEntry(dir, env = process.env) {
  if (env.BORUMI_AGENT_REMOTION_CLI && String(env.BORUMI_AGENT_REMOTION_CLI).trim()) return String(env.BORUMI_AGENT_REMOTION_CLI).trim();
  const pkgPath = join(dir, "node_modules", "@remotion", "cli", "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin && pkg.bin.remotion) || "remotion-cli.js";
    return join(dirname(pkgPath), bin);
  } catch {
    return join(dir, "node_modules", "@remotion", "cli", "remotion-cli.js");
  }
}

/** Path to the TypeScript compiler entry inside the workspace. */
export function tscEntry(dir) {
  const pkgPath = join(dir, "node_modules", "typescript", "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin && pkg.bin.tsc) || "bin/tsc";
    return join(dirname(pkgPath), bin);
  } catch {
    return join(dir, "node_modules", "typescript", "bin", "tsc");
  }
}

/** Remotion's headless browser lives under node_modules/.remotion once `browser ensure` ran. */
export function browserInstalled(dir) {
  const root = join(dir, "node_modules", ".remotion", "chrome-headless-shell");
  try { return readdirSync(root).some((n) => !n.startsWith(".")); } catch { return false; }
}

export function depsInstalled(dir) {
  return existsSync(join(dir, "node_modules", "remotion")) && existsSync(remotionCliEntry(dir, {}));
}

/** sha1 of the workspace package.json, the stamp `.deps-hash` must match for npm install to be skipped. */
export function depsHash(dir) {
  try { return createHash("sha1").update(readFileSync(join(dir, "package.json"))).digest("hex"); } catch { return null; }
}

export function depsUpToDate(dir) {
  if (!depsInstalled(dir)) return false;
  let cur = null;
  try { cur = readFileSync(join(dir, ".deps-hash"), "utf8").trim(); } catch { return false; }
  return cur === depsHash(dir);
}

/** Run `remotion browser ensure` so the first render is not a surprise download. */
export function ensureBrowser(dir, { logFile = null } = {}) {
  return runChild(nodeBin(), [remotionCliEntry(dir), "browser", "ensure"], {
    cwd: dir, label: "remotion browser ensure", logFile, timeoutMs: 30 * 60000,
  });
}

/**
 * Make sure the runtime workspace exists, matches the shipped template, has its npm
 * dependencies installed and Remotion's browser downloaded. Idempotent and cheap once set
 * up. Returns a report {kitDir, synced, copied, installed, browser, steps[]}.
 */
export async function ensureKit({ templateDir = KIT_TEMPLATE_DIR, workspaceDir = defaultKitDir(), install = true, browser = true, onProgress = () => {}, logFile = null } = {}) {
  if (!existsSync(templateDir)) throw new Error(`The animation-kit template folder is missing from the plugin install (${templateDir}).`);
  const dir = workspaceDir;
  const steps = [];
  onProgress("Preparing the animation workspace", "sync");
  const sync = syncTemplate(templateDir, dir, { log: (m) => steps.push(m) });

  let installed = depsInstalled(dir);
  let ranInstall = false;
  if (install && !depsUpToDate(dir)) {
    onProgress("Installing animation dependencies (first run only, this can take a few minutes)", "install");
    await runNpmInstall(dir, { logFile });
    writeFileSync(join(dir, ".deps-hash"), depsHash(dir));
    steps.push("animation kit dependencies installed");
    installed = depsInstalled(dir);
    ranInstall = true;
  }

  let browserOk = browserInstalled(dir);
  if (browser && installed && (!browserOk || ranInstall)) {
    onProgress("Downloading Remotion's headless browser (first run only)", "browser");
    await ensureBrowser(dir, { logFile });
    browserOk = browserInstalled(dir);
    steps.push(browserOk ? "remotion browser ready" : "remotion browser ensure ran (location not detected)");
  }
  return { kitDir: dir, synced: sync.changed, copied: sync.copied, installed, browser: browserOk, steps };
}

/**
 * The available animation styles: shipped styles from the TEMPLATE (always current) plus any
 * package the user dropped into the WORKSPACE's styles/ folder (flagged custom). Sorted
 * default-first then by name.
 */
export function listStyles({ templateDir = KIT_TEMPLATE_DIR, workspaceDir = defaultKitDir() } = {}) {
  const seen = new Map();
  for (const { base, custom } of [{ base: templateDir, custom: false }, { base: workspaceDir, custom: true }]) {
    const stylesDir = join(base, "styles");
    let entries = [];
    try { entries = readdirSync(stylesDir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const manifest = JSON.parse(readFileSync(join(stylesDir, e.name, "style.json"), "utf8"));
        if (manifest && manifest.id && !seen.has(manifest.id)) {
          seen.set(manifest.id, {
            id: manifest.id,
            name: manifest.name || manifest.id,
            description: manifest.description || "",
            default: !!manifest.default,
            audio: !!manifest.audio,
            hasSrc: existsSync(join(stylesDir, e.name, "src", "index.ts")),
            custom,
          });
        }
      } catch { /* not a valid style folder */ }
    }
  }
  const out = [...seen.values()];
  out.sort((a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0) || a.name.localeCompare(b.name));
  return out;
}

/** Does this style's scenes carry their own audio? Silent unless the style says so. */
export function styleHasAudio(styleId, opts) {
  const found = listStyles(opts).find((s) => s.id === styleId);
  return !!(found && found.audio);
}

/** The style's design guide, workspace copy first (it carries the Learnings log), template otherwise. */
export function readStyleSkill(styleId, { templateDir = KIT_TEMPLATE_DIR, workspaceDir = defaultKitDir() } = {}) {
  const rel = join("styles", styleId, "SKILL.md");
  for (const base of [workspaceDir, templateDir]) {
    try {
      const p = join(base, rel);
      if (existsSync(p) && statSync(p).isFile()) return readFileSync(p, "utf8");
    } catch { /* try the next location */ }
  }
  return "";
}

/** The frame-aware workflow guide, workspace copy first, template otherwise. */
export function readFramesSkill({ templateDir = KIT_TEMPLATE_DIR, workspaceDir = defaultKitDir() } = {}) {
  for (const base of [workspaceDir, templateDir]) {
    try {
      const p = join(base, "frames", "SKILL.md");
      if (existsSync(p) && statSync(p).isFile()) return readFileSync(p, "utf8");
    } catch { /* try the next location */ }
  }
  return "";
}

/* ============================ status file + CLI ============================ */

export function kitStatusPath(dir = defaultKitDir()) {
  return join(dir, "kit-status.json");
}

export function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, path);
}

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runEnsure(opts, { statusPath, log }) {
  const started = Date.now();
  const status = { state: "running", step: "sync", started_at: started, pid: process.pid, kitDir: opts.workspaceDir };
  writeJsonAtomic(statusPath, status);
  try {
    const report = await ensureKit({
      ...opts,
      onProgress: (text, step) => { log(text); writeJsonAtomic(statusPath, { ...status, step, message: text }); },
    });
    writeJsonAtomic(statusPath, { ...status, ...report, state: "done", step: "done", finished_at: Date.now() });
    return report;
  } catch (e) {
    writeJsonAtomic(statusPath, { ...status, state: "failed", step: "failed", error: e.message, finished_at: Date.now() });
    throw e;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0] || "ensure";
  const quiet = !!args.quiet;
  const log = (m) => { if (!quiet) process.stderr.write(`[kit] ${m}\n`); };
  const workspaceDir = defaultKitDir();
  const templateDir = KIT_TEMPLATE_DIR;
  const statusPath = kitStatusPath(workspaceDir);
  const print = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  if (cmd === "path") {
    print({ kitDir: workspaceDir, templateDir, synced: existsSync(join(workspaceDir, ".kit-version")), installed: depsInstalled(workspaceDir), browser: browserInstalled(workspaceDir) });
    return 0;
  }
  if (cmd === "styles") {
    print(listStyles({ templateDir, workspaceDir }));
    return 0;
  }
  if (cmd === "status") {
    const st = readJson(statusPath, null);
    if (!st) { print({ state: "idle", kitDir: workspaceDir, installed: depsInstalled(workspaceDir), browser: browserInstalled(workspaceDir) }); return 0; }
    if (st.state === "running" && st.pid && !pidAlive(st.pid)) {
      const dead = { ...st, state: "failed", error: "the kit install process exited without reporting", finished_at: Date.now() };
      writeJsonAtomic(statusPath, dead);
      print(dead);
      return 1;
    }
    print(st);
    return st.state === "failed" ? 1 : 0;
  }
  if (cmd === "wait") {
    const timeoutSec = Number(args.timeout) > 0 ? Number(args.timeout) : 540;
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
      const st = readJson(statusPath, null);
      if (!st) { print({ state: "idle", kitDir: workspaceDir }); return 0; }
      if (st.state !== "running") { print(st); return st.state === "failed" ? 1 : 0; }
      if (st.pid && !pidAlive(st.pid)) {
        const dead = { ...st, state: "failed", error: "the kit install process exited without reporting", finished_at: Date.now() };
        writeJsonAtomic(statusPath, dead);
        print(dead);
        return 1;
      }
      if (Date.now() >= deadline) { print({ ...st, timedOut: true }); return 0; }
      await sleep(1000);
    }
  }
  if (cmd === "ensure") {
    const opts = { templateDir, workspaceDir, install: !args["no-install"], browser: !args["no-browser"] };
    if (args.worker) {
      const logFile = join(workspaceDir, "kit-install.log");
      const report = await runEnsure({ ...opts, logFile }, { statusPath, log });
      print(report);
      return 0;
    }
    if (args.detach) {
      const st = readJson(statusPath, null);
      if (st && st.state === "running" && pidAlive(st.pid)) { print({ ...st, statusPath }); return 0; }
      // Cheap path first: when nothing needs installing, finish inline.
      const sync = syncTemplate(templateDir, workspaceDir, { log });
      const needsInstall = opts.install && !depsUpToDate(workspaceDir);
      const needsBrowser = opts.browser && depsInstalled(workspaceDir) && !browserInstalled(workspaceDir);
      if (!needsInstall && !needsBrowser) {
        const report = { kitDir: workspaceDir, synced: sync.changed, copied: sync.copied, installed: depsInstalled(workspaceDir), browser: browserInstalled(workspaceDir), steps: [] };
        writeJsonAtomic(statusPath, { state: "done", step: "done", started_at: Date.now(), finished_at: Date.now(), pid: process.pid, ...report });
        print({ state: "done", ...report, statusPath });
        return 0;
      }
      mkdirSync(workspaceDir, { recursive: true });
      writeJsonAtomic(statusPath, { state: "running", step: "starting", started_at: Date.now(), pid: null, kitDir: workspaceDir });
      const logFile = join(workspaceDir, "kit-install.log");
      const fd = openSync(logFile, "a");
      const childArgs = [THIS_FILE, "ensure", "--worker", "--quiet"];
      if (!opts.install) childArgs.push("--no-install");
      if (!opts.browser) childArgs.push("--no-browser");
      const child = spawn(nodeBin(), childArgs, { detached: true, stdio: ["ignore", fd, fd], env: process.env, cwd: workspaceDir });
      child.unref();
      writeJsonAtomic(statusPath, { state: "running", step: "starting", started_at: Date.now(), pid: child.pid, kitDir: workspaceDir });
      print({ state: "running", statusPath, pid: child.pid, logPath: logFile, kitDir: workspaceDir });
      return 0;
    }
    const report = await runEnsure(opts, { statusPath, log });
    print(report);
    return 0;
  }
  process.stderr.write(`Unknown command "${cmd}". Commands: ensure, wait, status, styles, path\n`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
    process.stderr.write(`[kit] ${e.message}\n`);
    process.exit(1);
  });
}
