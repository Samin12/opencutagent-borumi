// scripts/lib/paths.mjs: deliverable locations, the mount guard (simulated with a temp dir),
// and binary resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, writeFileSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import {
  MountError, projectNameFrom, isProjectBundlePath, volumeRootOf, isMountPoint, assertProjectBundle, agentDirFor, ensureAgentDir,
  commonBinDirs, mergePath, augmentPath, findBin, ffmpegBin, ffprobeBin, nodeBin, agentHome, kitDir, currentJobFile, jobsIndexFile,
  KIT_TEMPLATE_DIR, PLUGIN_ROOT,
} from "../scripts/lib/paths.mjs";

test("project names come from the bundle basename", () => {
  assert.equal(projectNameFrom("/x/y/My Talk.bmprojbundle"), "My Talk");
  assert.equal(projectNameFrom("/x/y/Other.BMPROJBUNDLE"), "Other");
  assert.equal(isProjectBundlePath("/x/y/My Talk.bmprojbundle"), true);
  assert.equal(isProjectBundlePath("/x/y/folder"), false);
});

test("agent home and its files follow BORUMI_AGENT_HOME", () => {
  const env = { BORUMI_AGENT_HOME: "/tmp/agent-home" };
  assert.equal(agentHome(env), "/tmp/agent-home");
  assert.equal(kitDir(env), "/tmp/agent-home/animation-kit");
  assert.equal(currentJobFile(env), "/tmp/agent-home/current.json");
  assert.equal(jobsIndexFile(env), "/tmp/agent-home/jobs.json");
  assert.ok(agentHome({}).endsWith(".borumi-agent"));
  assert.equal(KIT_TEMPLATE_DIR, join(PLUGIN_ROOT, "animation-kit"));
  assert.ok(existsSync(join(KIT_TEMPLATE_DIR, "package.json")), "the plugin ships the kit template");
});

test("deliverables land next to the bundle as '<name> Agent' (BORUMI_AGENT_OUT overrides the parent)", () => {
  assert.equal(agentDirFor("/Volumes/Drive/Borumi Projects/Astra.bmprojbundle", null, {}), "/Volumes/Drive/Borumi Projects/Astra Agent");
  assert.equal(agentDirFor("/p/Astra.bmprojbundle", "Astra", {}), "/p/Astra Agent");
  assert.equal(agentDirFor("/p/Astra.bmprojbundle", "Astra", { BORUMI_AGENT_OUT: "/out" }), "/out/Astra Agent");
});

test("volumeRootOf and isMountPoint", () => {
  assert.equal(volumeRootOf("/Volumes/Razer/Borumi Projects/x.bmprojbundle"), "/Volumes/Razer");
  assert.equal(volumeRootOf("/Users/me/x.bmprojbundle"), null);
  assert.equal(volumeRootOf("/Volumes"), null);
  assert.equal(volumeRootOf("/tmp/vol/Razer/x", "/tmp/vol"), "/tmp/vol/Razer");
  const tmp = mkdtempSync(join(tmpdir(), "borumi-paths-"));
  try {
    mkdirSync(join(tmp, "sub"));
    assert.equal(isMountPoint(join(tmp, "sub")), false, "a plain subfolder shares its parent's device");
    assert.equal(isMountPoint(join(tmp, "missing")), false);
    const fakeStat = (p) => ({ dev: p === join(tmp, "sub") ? 2 : 1 });
    assert.equal(isMountPoint(join(tmp, "sub"), fakeStat), true, "a different device id means a mount");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("mount guard: refuses a missing bundle, a non-bundle path, and a stale /Volumes folder", () => {
  const tmp = mkdtempSync(join(tmpdir(), "borumi-guard-"));
  const volumesRoot = join(tmp, "Volumes");
  try {
    assert.throws(() => assertProjectBundle("relative.bmprojbundle"), (e) => e instanceof MountError && /absolute/.test(e.message));
    assert.throws(() => assertProjectBundle(join(tmp, "folder")), (e) => e instanceof MountError && /bmprojbundle/.test(e.message));
    assert.throws(() => assertProjectBundle(join(tmp, "gone.bmprojbundle")), (e) => e instanceof MountError && /does not exist/.test(e.message));

    // A bundle that exists under a stale (unmounted) volume folder: the drive is not mounted.
    const stale = join(volumesRoot, "Razer", "Borumi Projects", "Talk.bmprojbundle");
    mkdirSync(stale, { recursive: true });
    assert.throws(() => assertProjectBundle(stale, { volumesRoot }), (e) => e instanceof MountError && /mount the drive first/.test(e.message));
    // A missing bundle under an unmounted volume names the drive, not the bundle.
    assert.throws(() => assertProjectBundle(join(volumesRoot, "Razer", "Other.bmprojbundle"), { volumesRoot }), (e) => /not mounted.*mount the drive first/.test(e.message));
    // Simulate the drive being mounted: the volume root gets its own device id.
    const mounted = (p) => { const st = statSync(p); return { ...st, dev: p === join(volumesRoot, "Razer") ? st.dev + 1 : st.dev, isDirectory: () => st.isDirectory() }; };
    assert.equal(assertProjectBundle(stale, { volumesRoot, statFn: mounted }), realpathSync(stale));
    // A symlinked volume root (/Volumes/Macintosh HD -> /) is not a stale folder: it passes.
    symlinkSync(tmp, join(volumesRoot, "Boot"));
    const viaLink = join(volumesRoot, "Boot", "Linked.bmprojbundle");
    mkdirSync(join(tmp, "Linked.bmprojbundle"));
    assert.equal(assertProjectBundle(viaLink, { volumesRoot }), realpathSync(join(tmp, "Linked.bmprojbundle")));

    // A bundle on the boot disk passes and returns its real path.
    const local = join(tmp, "Local.bmprojbundle");
    mkdirSync(local);
    assert.equal(assertProjectBundle(local), realpathSync(local));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureAgentDir creates '<name> Agent/<subs>' beside a real bundle and never under an unmounted volume", () => {
  const tmp = mkdtempSync(join(tmpdir(), "borumi-agentdir-"));
  const volumesRoot = join(tmp, "Volumes");
  try {
    const bundle = join(tmp, "proj", "Talk.bmprojbundle");
    mkdirSync(bundle, { recursive: true });
    const dir = ensureAgentDir(bundle, null, ["animations", "anim-x"]);
    assert.equal(dir, join(tmp, "proj", "Talk Agent", "animations", "anim-x"));
    assert.ok(existsSync(dir));
    assert.equal(ensureAgentDir(bundle, "Custom Name"), join(tmp, "proj", "Custom Name Agent"));

    const stale = join(volumesRoot, "Razer", "Talk.bmprojbundle");
    mkdirSync(stale, { recursive: true });
    assert.throws(() => ensureAgentDir(stale, null, ["animations"], { volumesRoot }), MountError);
    assert.equal(existsSync(join(volumesRoot, "Razer", "Talk Agent")), false, "nothing was created on the stale volume");
    // Deliverables pointed at an unmounted volume through BORUMI_AGENT_OUT are refused too.
    assert.throws(() => ensureAgentDir(bundle, null, ["exports"], { volumesRoot, env: { BORUMI_AGENT_OUT: join(volumesRoot, "Razer", "out") } }), MountError);
    assert.equal(existsSync(join(volumesRoot, "Razer", "out")), false);

    // BORUMI_AGENT_OUT moves the parent; the bundle guard still applies.
    const out = join(tmp, "out");
    const moved = ensureAgentDir(bundle, null, ["exports"], { env: { BORUMI_AGENT_OUT: out } });
    assert.equal(moved, join(out, "Talk Agent", "exports"));
    assert.throws(() => ensureAgentDir(join(tmp, "nope.bmprojbundle"), null, [], { env: { BORUMI_AGENT_OUT: out } }), MountError);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("binary resolution: PATH merge, common dirs, env overrides", () => {
  assert.equal(mergePath("/a:/b", ["/b", "/c", ""]).split(delimiter).join(","), "/a,/b,/c");
  assert.equal(commonBinDirs({ platform: "darwin", home: "/Users/x", execPath: "/opt/node/bin/node", env: {} })[0], "/opt/node/bin");
  assert.ok(commonBinDirs({ platform: "darwin", home: "/Users/x", execPath: "/opt/node/bin/node", env: {} }).includes("/opt/homebrew/bin"));
  const env = { PATH: "/usr/bin" };
  augmentPath(env);
  assert.ok(env.PATH.startsWith("/usr/bin"), "existing entries keep priority");
  assert.equal(findBin("ffmpeg", { FFMPEG_BIN: "/custom/ffmpeg" }), "/custom/ffmpeg");
  assert.equal(ffmpegBin({ FFMPEG_BIN: "/custom/ffmpeg" }), "/custom/ffmpeg");
  assert.equal(ffprobeBin({ FFPROBE_BIN: "/custom/ffprobe" }), "/custom/ffprobe");
  assert.equal(nodeBin(), process.execPath);
  const ff = ffmpegBin({});
  assert.ok(ff === "ffmpeg" || ff.startsWith("/") || /ffmpeg/.test(ff), "absolute when installed in a standard dir, else the bare name");
  const tmp = mkdtempSync(join(tmpdir(), "borumi-bin-"));
  try {
    writeFileSync(join(tmp, "zzztool"), "#!/bin/sh\n");
    assert.equal(findBin("zzztool", { ZZZTOOL_BIN: join(tmp, "zzztool") }), join(tmp, "zzztool"));
    assert.equal(findBin("zzztool", {}), "zzztool");
    assert.equal(dirname(join(tmp, "zzztool")), tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
