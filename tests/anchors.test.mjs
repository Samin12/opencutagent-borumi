// animation-kit/scripts/check-anchors.mjs: the pinned-camera keep-out is enforced before any frame is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keepOutRect, rectsOverlap, runAnchorCheck } from "../animation-kit/scripts/check-anchors.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANVAS = { width: 1920, height: 1080 };
const KEEP_OUT = { x: 0.775, y: 0.715, w: 0.225, h: 0.285 };

test("keepOutRect: ratios become canvas pixels; missing or bad values give null", () => {
  assert.deepEqual(keepOutRect({ canvas: CANVAS, keepOut: KEEP_OUT }), { x: 1488, y: 772, w: 432, h: 308 });
  assert.equal(keepOutRect({ canvas: CANVAS }), null);
  assert.equal(keepOutRect({ canvas: CANVAS, keepOut: { x: 0.5, y: 0.5, w: 0, h: 0.1 } }), null);
  assert.equal(keepOutRect({ keepOut: KEEP_OUT }), null);
});

test("rectsOverlap: touching edges do not overlap, one shared pixel does", () => {
  const corner = { x: 1488, y: 772, w: 432, h: 308 };
  assert.equal(rectsOverlap({ x: 1000, y: 100, w: 400, h: 300 }, corner), false);
  assert.equal(rectsOverlap({ x: 1088, y: 472, w: 400, h: 300 }, corner), false, "edge to edge");
  assert.equal(rectsOverlap({ x: 1089, y: 473, w: 400, h: 300 }, corner), true);
  assert.equal(rectsOverlap({ x: 1600, y: 900, w: 100, h: 50 }, corner), true, "fully inside");
});

test("runAnchorCheck: an anchor inside the camera corner FAILs without reading frames; others still run", () => {
  mkdirSync(join(root, "tests", ".tmp"), { recursive: true });
  const kit = mkdtempSync(join(root, "tests", ".tmp", "anchors-"));
  const jobDir = join(kit, "src", "jobs", "anim-ko");
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "frames-map.json"), JSON.stringify({
    version: 2, source: "borumi", canvas: CANVAS, step: 0.5, keepOut: KEEP_OUT,
    frames: [{ file: "t0000.50.png", t: 0.5 }, { file: "t0001.00.png", t: 1.0 }],
  }));
  writeFileSync(join(jobDir, "anchors.json"), JSON.stringify({ anchors: [
    { id: "under-camera", what: "a badge in the corner", rect: { x: 1600, y: 900, w: 200, h: 100 }, from: 0.5, to: 1.0 },
    { id: "clear", what: "the title", rect: { x: 100, y: 100, w: 300, h: 80 }, from: 0.5, to: 1.0 },
  ] }));
  const out = runAnchorCheck({ kitDir: kit, jobId: "anim-ko", writeSheets: false, ffmpeg: "/nonexistent/ffmpeg" });
  assert.equal(out.ok, false);
  assert.equal(out.fails, 1);
  const under = out.results.find((r) => r.id === "under-camera");
  assert.equal(under.verdict, "fail");
  assert.equal(under.keepOut, true);
  assert.match(under.notes[0], /pinned-camera corner \(keepOut x1488 y772 432x308\)/);
  assert.match(out.report, /under-camera.*FAIL/);
  const clear = out.results.find((r) => r.id === "clear");
  assert.notEqual(clear.verdict, "fail", "an anchor outside the corner is judged on its frames (unreadable here, so unknown)");
  rmSync(kit, { recursive: true, force: true });
});
