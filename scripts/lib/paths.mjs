// Where things live and how binaries are found. Ported from OpenCutAgent server/paths.js
// (commonBinDirs, mergePath, augmentPath, ffmpegBin) and extended with the Borumi plugin's
// locations:
//   - agent home: ~/.borumi-agent (env BORUMI_AGENT_HOME) holds the animation-kit workspace,
//     the current-job pointer, the jobs index and the cache;
//   - deliverables: "<dirname(project.path)>/<project name> Agent/" next to the .bmprojbundle
//     (env BORUMI_AGENT_OUT overrides the parent directory).
// The deliverable guard refuses to create anything when the .bmprojbundle does not exist at
// call time, and never creates a directory under /Volumes/<x> unless /Volumes/<x> is a real
// mount point. Samin's projects live on an external drive; when it is unmounted, macOS would
// happily let us mkdir under a stale /Volumes/<x> on the boot disk.
import { existsSync, statSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const IS_WINDOWS = process.platform === "win32";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const KIT_TEMPLATE_DIR = join(PLUGIN_ROOT, "animation-kit");
export const AGENT_DIR_SUFFIX = " Agent";
export const BUNDLE_EXT = ".bmprojbundle";

/** Thrown when a deliverable folder cannot be created safely (bundle missing, drive unmounted). */
export class MountError extends Error {
  constructor(message) {
    super(message);
    this.name = "MountError";
  }
}

/* ============================ agent home ============================ */

export function agentHome(env = process.env) {
  const v = env.BORUMI_AGENT_HOME;
  return v && String(v).trim() ? resolve(String(v).trim()) : join(homedir(), ".borumi-agent");
}

/** The animation-kit workspace (template synced here, npm installed here, jobs live here). */
export function kitDir(env = process.env) {
  return join(agentHome(env), "animation-kit");
}

export function cacheDir(env = process.env) {
  return join(agentHome(env), "cache");
}

/** `{ "<project path>": "<jobId>" }`: the job a plain follow-up in a session refers to. */
export function currentJobFile(env = process.env) {
  return join(agentHome(env), "current.json");
}

/** `{ "<jobId>": "<outDir>" }`: how a bare job id finds its deliverable folder. */
export function jobsIndexFile(env = process.env) {
  return join(agentHome(env), "jobs.json");
}

/* ============================ project + deliverables ============================ */

export function isProjectBundlePath(p) {
  return typeof p === "string" && p.toLowerCase().endsWith(BUNDLE_EXT);
}

/** "/x/My Talk.bmprojbundle" -> "My Talk". Pure. */
export function projectNameFrom(projectPath) {
  const b = basename(String(projectPath || ""));
  return isProjectBundlePath(b) ? b.slice(0, -BUNDLE_EXT.length) : b;
}

/**
 * "/Volumes/<x>" for a path under the volumes root, else null. Pure: works on any
 * `volumesRoot` so tests can simulate an external drive inside a temp dir.
 */
export function volumeRootOf(p, volumesRoot = "/Volumes") {
  const root = resolve(volumesRoot);
  const full = resolve(p);
  if (!full.startsWith(root + sep)) return null;
  const rest = full.slice(root.length + 1).split(sep)[0];
  return rest ? join(root, rest) : null;
}

/**
 * A directory is a mount point when its device id differs from its parent's. On macOS a
 * stale /Volumes/<x> left behind after an unplug sits on the boot disk and shares its
 * parent's device; a mounted drive does not.
 */
export function isMountPoint(dir, statFn = statSync) {
  try {
    const here = statFn(dir);
    const parent = statFn(dirname(dir));
    return here.dev !== parent.dev;
  } catch {
    return false;
  }
}

/**
 * Throw when `p` sits under /Volumes/<x> and that volume is a plain folder rather than a
 * mount. A symlinked volume root (/Volumes/Macintosh HD -> /) is skipped: it resolves
 * elsewhere and the caller checks the real path too.
 * @throws {MountError}
 */
export function assertVolumeMounted(p, { volumesRoot = "/Volumes", statFn = statSync, what = "The project" } = {}) {
  const vol = volumeRootOf(p, volumesRoot);
  if (!vol) return;
  try { if (lstatSync(vol).isSymbolicLink()) return; } catch { /* the volume folder itself is missing: not a mount */ }
  if (!isMountPoint(vol, statFn)) {
    throw new MountError(`${what} lives on "${vol}" but that drive is not mounted (a leftover folder on the boot disk): mount the drive first, then try again.`);
  }
}

/**
 * Refuse unless the .bmprojbundle exists right now and, when it sits under /Volumes/<x>,
 * that volume is actually mounted (checked on the path as given AND on its real path).
 * Returns the real (symlink-resolved) bundle path.
 * @throws {MountError}
 */
export function assertProjectBundle(projectPath, { volumesRoot = "/Volumes", statFn = statSync } = {}) {
  const p = String(projectPath || "").trim();
  if (!p || !isAbsolute(p)) throw new MountError(`The project path must be absolute (got "${p || "nothing"}").`);
  if (!isProjectBundlePath(p)) throw new MountError(`The project path must end in ${BUNDLE_EXT} (got "${p}").`);
  assertVolumeMounted(resolve(p), { volumesRoot, statFn });
  let real;
  try {
    real = realpathSync(p);
  } catch {
    throw new MountError(`The Borumi project bundle does not exist: "${p}". Open the project in Borumi first (or check the path).`);
  }
  let st;
  try { st = statFn(real); } catch { st = null; }
  if (!st || !st.isDirectory()) throw new MountError(`The Borumi project bundle is not a folder: "${p}".`);
  assertVolumeMounted(real, { volumesRoot, statFn });
  return real;
}

/**
 * "<dirname(project)>/<project name> Agent" (or under BORUMI_AGENT_OUT when set). Pure: no
 * filesystem access, no guard. Use ensureAgentDir to create it.
 */
export function agentDirFor(projectPath, projectName, env = process.env) {
  const name = (projectName && String(projectName).trim()) || projectNameFrom(projectPath);
  const parent = env.BORUMI_AGENT_OUT && String(env.BORUMI_AGENT_OUT).trim()
    ? resolve(String(env.BORUMI_AGENT_OUT).trim())
    : dirname(resolve(String(projectPath)));
  return join(parent, name + AGENT_DIR_SUFFIX);
}

/**
 * Create (if needed) and return "<project> Agent/<...subs>". Runs the mount guard first, so a
 * missing bundle or an unmounted drive throws a MountError instead of creating a folder on the
 * wrong disk.
 */
export function ensureAgentDir(projectPath, projectName, subs = [], opts = {}) {
  assertProjectBundle(projectPath, opts);
  // The deliverable folder follows the path Borumi reports (not its realpath), so it lands
  // where the user expects; the mount check runs on the given parent and on its real path.
  const base = agentDirFor(projectPath, projectName, opts.env || process.env);
  const guard = { volumesRoot: opts.volumesRoot || "/Volumes", statFn: opts.statFn || statSync, what: "The deliverable folder" };
  assertVolumeMounted(base, guard);
  try { assertVolumeMounted(join(realpathSync(dirname(base)), basename(base)), guard); } catch (e) { if (e instanceof MountError) throw e; /* parent missing: mkdir below creates it on the checked path */ }
  const dir = join(base, ...(Array.isArray(subs) ? subs : [subs]).filter(Boolean));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* ============================ binaries ============================ */

/**
 * Standard bin directories for this platform, best-first. The node binary's own directory
 * comes first: whatever node runs this script ships npm/npx beside it. Pure given its inputs.
 */
export function commonBinDirs({ platform = process.platform, home = homedir(), execPath = process.execPath, env = process.env } = {}) {
  const dirs = [];
  if (execPath) dirs.push(dirname(execPath));
  if (platform === "win32") {
    if (env.APPDATA) dirs.push(join(env.APPDATA, "npm"));
    if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, "Microsoft", "WindowsApps"));
    dirs.push("C:\\ffmpeg\\bin", "C:\\Program Files\\ffmpeg\\bin");
  } else {
    dirs.push(
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/opt/local/bin",
      "/snap/bin",
      join(home, ".local", "bin"),
      join(home, "bin")
    );
  }
  return dirs;
}

const exists = (p) => {
  try { return existsSync(p); } catch { return false; }
};

/** Append `dirs` to a PATH string, skipping duplicates. Pure. */
export function mergePath(current, dirs) {
  const parts = String(current || "").split(delimiter).filter(Boolean);
  const seen = new Set(parts);
  for (const d of dirs) {
    if (!d || seen.has(d)) continue;
    parts.push(d);
    seen.add(d);
  }
  return parts.join(delimiter);
}

/** Widen env.PATH with the common bin directories that exist here (append-only). */
export function augmentPath(env = process.env) {
  env.PATH = mergePath(env.PATH, commonBinDirs({ env }).filter(exists));
  return env.PATH;
}

const binMemo = new Map();

/**
 * Absolute path of a helper binary: `<NAME>_BIN` env override, then the standard install
 * directories, then the bare name for PATH to resolve.
 */
export function findBin(name, env = process.env) {
  const override = env[`${name.toUpperCase()}_BIN`];
  if (override && String(override).trim()) return String(override).trim();
  const memo = binMemo.get(name);
  if (memo && exists(memo)) return memo;
  const file = IS_WINDOWS ? `${name}.exe` : name;
  for (const dir of commonBinDirs({ env })) {
    const p = join(dir, file);
    if (exists(p)) {
      binMemo.set(name, p);
      return p;
    }
  }
  return name;
}

export function ffmpegBin(env = process.env) {
  return findBin("ffmpeg", env);
}

export function ffprobeBin(env = process.env) {
  return findBin("ffprobe", env);
}

/** The node that runs this script: always run the kit's CLI entries with it (no npx, no .cmd shims). */
export function nodeBin() {
  return process.execPath;
}

export function npmBin(env = process.env) {
  const beside = join(dirname(process.execPath), IS_WINDOWS ? "npm.cmd" : "npm");
  if (exists(beside)) return beside;
  return findBin("npm", env) === "npm" && IS_WINDOWS ? "npm.cmd" : findBin("npm", env);
}

/** One shared explanation for "we could not launch ffmpeg". */
export function ffmpegMissingMessage(bin, detail) {
  return (
    `Could not run "${bin}"${detail ? `: ${detail}` : ""}. ` +
    "Install ffmpeg (macOS: brew install ffmpeg), or set FFMPEG_BIN to its full path."
  );
}
