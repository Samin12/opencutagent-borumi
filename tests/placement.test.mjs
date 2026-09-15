// scripts/placement.mjs: plan generation against the real staged timeline (screen_1 occupied 0-3000,
// pinned-camera layout 0-3000, camera 0-12000), the two-screen read, a derived camera-only variant,
// and verification of a synthesized post-placement read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  makePlan, planRemove, verifyPlacement, jobFacts, canvasSize, isLandscape, carveRange, cameraLayerIn,
  pinnedLayout, cameraOnlyLayout, layoutReferences, segmentsOverlapping, sceneContaining,
  CAMERA_RECT, KEEP_OUT, NEW_LAYER, NEW_SEGMENT, SELECT,
} from "../scripts/placement.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const STAGED = fixture("timeline-staged.json");
const TWO = fixture("timeline-two-screens.json");
const CANVAS = fixture("overview-canvas.json");
const MEDIA = "87d7";
const clone = (o) => JSON.parse(JSON.stringify(o));

/** The staged timeline without screen content and without layouts: a camera-only scene. */
function cameraOnly() {
  const t = clone(STAGED);
  t.layers = t.layers.filter((l) => l.kind !== "screen").map((l) => (l.kind === "layout" ? { ...l, segment_count: 0, segments: [] } : l));
  t.scenes[0].edit_spans = t.scenes[0].edit_spans.map((s) => ({ ...s, edit_sets: s.edit_sets.filter((set) => !set.includes("screen_1") && !set.includes("layout")) }));
  return t;
}

function job(startMs, endMs, extra = {}) {
  // durationInFrames exactly as scripts/lib/brief.mjs durationInFramesFor computes it (floor with a 1e-9 guard)
  return { jobId: "anim-t1", mode: "behind", sceneId: "b15a", startMs, endMs, width: 1920, height: 1080, fps: 30, durationInFrames: Math.floor(((endMs - startMs) * 30) / 1000 + 1e-9), ...extra };
}

const ops = (plan) => plan.steps.map((s) => s.op);

test("jobFacts: effective end from durationInFrames (floor), fallbacks for the create-output shape", () => {
  const f = jobFacts({ id: "x", start_ms: 1000, end_ms: 2517, durationInFrames: 45, fps: 30, jobDir: "/j" });
  assert.equal(f.id, "x");
  assert.equal(f.endMs, 2500, "45 frames at 30 fps = 1500 ms, never longer than the range");
  assert.equal(f.outDir, "/j");
  assert.equal(jobFacts({ startMs: 0, endMs: 1000 }).endMs, 1000);
  assert.equal(jobFacts({ startMs: 0, endMs: 1000, durationInFrames: 30 }).endMs, 1000);
  assert.equal(jobFacts({ startMs: 0, durationInFrames: 31 }).endMs, 1033);
  assert.equal(jobFacts({}).mode, "behind");
});

test("canvasSize + isLandscape from the overview slice, a bare size, or the job", () => {
  assert.deepEqual(canvasSize(CANVAS), { width: 1920, height: 1080, preset: "landscape" });
  assert.ok(isLandscape(canvasSize(CANVAS)));
  assert.ok(!isLandscape({ width: 1080, height: 1920 }));
  assert.ok(!isLandscape({ width: 1920, height: 1080, preset: "vertical" }), "a preset name wins over the pixels");
  assert.deepEqual(canvasSize(null, jobFacts(job(0, 1000))), { width: 1920, height: 1080, preset: null });
  assert.equal(canvasSize(null, jobFacts({})), null);
});

test("readers: overlapping segments, scene lookup, camera layer, layout references", () => {
  assert.equal(segmentsOverlapping(STAGED, (l) => l.kind === "screen", 2999, 5000).length, 1);
  assert.equal(segmentsOverlapping(STAGED, (l) => l.kind === "screen", 3000, 5000).length, 0);
  assert.equal(sceneContaining(STAGED, 11999).id, "b15a");
  assert.equal(sceneContaining(STAGED, 12000), null);
  assert.equal(cameraLayerIn(STAGED, 4000, 8000), "camera_1");
  assert.equal(cameraLayerIn({ layers: [] }, 0, 1), null);
  assert.equal(cameraLayerIn(cameraOnly(), 0, 1000), "camera_1");
  const layout = STAGED.layers.find((l) => l.kind === "layout").segments[0];
  assert.ok(layoutReferences(layout.properties, "screen_1"));
  assert.ok(layoutReferences(layout.properties, "camera_1"));
  assert.ok(!layoutReferences(layout.properties, "screen_2"));
  assert.ok(layoutReferences({ kind: "corner", main_layer_id: "screen_2", corner_layer_id: "camera_1" }, "screen_2"));
});

test("pinnedLayout: measured custom rect on landscape, corner preset otherwise, fullscreen without a camera", () => {
  const custom = pinnedLayout(NEW_LAYER, "camera_1", true);
  assert.equal(custom.kind, "custom");
  assert.deepEqual(custom.transition, { kind: "instant" });
  assert.equal(custom.sources.length, 2);
  assert.deepEqual(custom.sources[0], { layer_id: NEW_LAYER, x_ratio: 0, y_ratio: 0, width_ratio: 1, height_ratio: 1, border_radius_ratio: 0, lock_aspect_ratio: false, overflow: false });
  assert.deepEqual(custom.sources[1], { layer_id: "camera_1", ...CAMERA_RECT }, "camera last so it draws on top");
  assert.equal(custom.sources[1].x_ratio, 0.775);
  assert.equal(custom.sources[1].corner_shape, "squircle_v2");
  const corner = pinnedLayout(NEW_LAYER, "camera_1", false);
  assert.deepEqual(corner, { kind: "corner", main_layer_id: NEW_LAYER, corner_layer_id: "camera_1", corner_shape: "squircle_v2", transition: { kind: "instant" } });
  assert.deepEqual(pinnedLayout(NEW_LAYER, null, true), { kind: "fullscreen", layer_id: NEW_LAYER, transition: { kind: "instant" } });
  assert.deepEqual(cameraOnlyLayout("camera_1").sources, [{ layer_id: "camera_1", ...CAMERA_RECT }]);
});

test("behind over an empty stretch: take, find, update, pinned layout, verify; nothing split or deleted", () => {
  const plan = makePlan({ timeline: STAGED, job: job(4000, 8000), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.deepEqual(ops(plan), ["add_segments", "find_new_segment", "update_segments", "add_segments", "verify"]);
  const [take, find, update, layout] = plan.steps;
  assert.deepEqual(take.args, { additions: [{ type: "take", placement: { at_ms: 4000 }, content: { media_id: MEDIA, video_kind: "screen" } }] });
  assert.equal(take.reread, true);
  assert.ok(!("tx_id" in take.args) && !("timeline_hash" in take.args));
  assert.deepEqual(find.args, { media_id: MEDIA, start_ms: 4000, segment_type: "video", category: "content" });
  assert.deepEqual(find.binds, [NEW_LAYER, NEW_SEGMENT]);
  assert.equal(find.reread, false);
  assert.deepEqual(update.args, { updates: [{ type: "video", segment_id: NEW_SEGMENT, properties: { face_tracking_mode: "disabled", transition: { kind: "cut" } } }] });
  assert.equal(update.reread, false);
  assert.deepEqual(layout.args.additions[0].placement, { range: [4000, 8000] });
  assert.equal(layout.args.additions[0].properties.kind, "custom");
  assert.equal(layout.args.additions[0].properties.sources[0].layer_id, NEW_LAYER);
  assert.equal(layout.args.additions[0].properties.sources[1].layer_id, "camera_1");
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.expect.mode, "behind");
  assert.equal(plan.expect.duration_ms, 12000);
  assert.deepEqual(plan.expect.scene_starts, [{ id: "b15a", start_ms: 0, end_ms: 12000 }]);
  assert.deepEqual(plan.expect.replaced_layouts, []);
  assert.deepEqual(plan.expect.replaced_controls, []);
  assert.deepEqual(plan.expect.occupied_screen_layers, []);
  assert.deepEqual(plan.expect.keep_out, KEEP_OUT);
});

test("behind over occupied screen_1 with an existing layout straddling both edges: split at both, delete the inner piece via select, record it", () => {
  const plan = makePlan({ timeline: STAGED, job: job(1000, 2500), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.deepEqual(ops(plan), ["add_segments", "find_new_segment", "update_segments", "split_segments", "delete_segments", "add_segments", "verify"]);
  const split = plan.steps[3];
  assert.deepEqual(split.args, { splits: [{ segment_id: "c353", times_ms: [1000, 2500] }] });
  const del = plan.steps[4];
  assert.deepEqual(del.args, { segment_ids: [SELECT], expand_groups: false, ripple: false });
  assert.deepEqual(del.select, { layer_kinds: ["layout"], inside: [1000, 2500] });
  assert.equal(plan.expect.replaced_layouts.length, 1);
  const rec = plan.expect.replaced_layouts[0];
  assert.equal(rec.original_segment_id, "c353");
  assert.deepEqual([rec.start_ms, rec.end_ms], [1000, 2500]);
  assert.deepEqual(rec.original_range, [0, 3000]);
  assert.equal(rec.properties.kind, "custom");
  assert.equal(rec.properties.sources.length, 2);
  assert.deepEqual(plan.expect.occupied_screen_layers, ["screen_1"]);
  assert.match(plan.warnings[0], /screen_1 already has content .* new screen layer/);
  // no step ever deletes screen content
  for (const s of plan.steps) if (s.op === "delete_segments") assert.ok(!s.args.segment_ids.includes("911d"));
});

test("behind over a range that only overlaps the tail of the layout: one split, the inner piece recorded as 2000-3000", () => {
  const plan = makePlan({ timeline: STAGED, job: job(2000, 5000), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  const split = plan.steps.find((s) => s.op === "split_segments");
  assert.deepEqual(split.args.splits, [{ segment_id: "c353", times_ms: [2000] }]);
  assert.deepEqual(plan.expect.replaced_layouts.map((r) => [r.start_ms, r.end_ms]), [[2000, 3000]]);
  // a layout entirely inside the range is deleted by id, no split
  const whole = makePlan({ timeline: STAGED, job: job(0, 3000), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.ok(!whole.steps.some((s) => s.op === "split_segments"));
  const del = whole.steps.find((s) => s.op === "delete_segments");
  assert.deepEqual(del.args.segment_ids, ["c353"]);
});

test("behind: control segments (screen_zoom/highlight/blur) inside the range are carved and recorded for remove", () => {
  const t = clone(STAGED);
  const zoom = t.layers.find((l) => l.kind === "screen_zoom");
  zoom.segments = [{ id: "z1", type: "screen_zoom", start_ms: 3500, end_ms: 6000, properties: { zoom_factor: 1.6, focus_point: "cursor" } }];
  zoom.segment_count = 1;
  const blur = t.layers.find((l) => l.kind === "screen_blur");
  blur.segments = [{ id: "b1", type: "screen_blur", start_ms: 4500, end_ms: 5000, properties: { blur_kind: "pixelated" } }];
  blur.segment_count = 1;
  const plan = makePlan({ timeline: t, job: job(4000, 8000), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.deepEqual(ops(plan), ["add_segments", "find_new_segment", "update_segments", "split_segments", "delete_segments", "add_segments", "verify"]);
  const split = plan.steps[3];
  assert.deepEqual(split.args.splits, [{ segment_id: "z1", times_ms: [4000] }]);
  const del = plan.steps[4];
  assert.deepEqual(del.args.segment_ids, ["b1", SELECT]);
  assert.deepEqual(del.select, { layer_kinds: ["screen_zoom", "screen_highlight", "screen_blur"], inside: [4000, 8000] });
  assert.deepEqual(plan.expect.replaced_controls.map((r) => [r.type, r.start_ms, r.end_ms]), [["screen_zoom", 4000, 6000], ["screen_blur", 4500, 5000]]);
  assert.deepEqual(plan.expect.replaced_controls[0].properties, { zoom_factor: 1.6, focus_point: "cursor" });
  const carved = carveRange(t, ["screen_zoom"], 5000, 5500, "zoom");
  assert.deepEqual(carved.steps[0].args.splits, [{ segment_id: "z1", times_ms: [5000, 5500] }]);
});

test("behind on the two-screen read: both screen layers reported occupied, the layout piece recorded", () => {
  const plan = makePlan({ timeline: TWO, job: job(1000, 2000), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.deepEqual(plan.expect.occupied_screen_layers, ["screen_1", "screen_2"]);
  assert.match(plan.warnings[0], /screen_1, screen_2 already have content/);
  assert.deepEqual(plan.expect.replaced_layouts.map((r) => [r.original_segment_id, r.start_ms, r.end_ms]), [["2ca5", 1000, 2000]]);
  assert.equal(plan.expect.duration_ms, 11500);
});

test("behind on a camera-only scene: no split, no delete, custom layout with the camera pinned", () => {
  const plan = makePlan({ timeline: cameraOnly(), job: job(1000, 4000), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.deepEqual(ops(plan), ["add_segments", "find_new_segment", "update_segments", "add_segments", "verify"]);
  assert.equal(plan.steps[3].args.additions[0].properties.kind, "custom");
  assert.deepEqual(plan.warnings, []);
});

test("behind with no camera in the range: fullscreen layout on the new layer; non-landscape canvas: corner preset", () => {
  const t = cameraOnly();
  t.layers = t.layers.filter((l) => l.kind !== "camera");
  const plan = makePlan({ timeline: t, job: job(1000, 4000), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  const layout = plan.steps.find((s) => s.op === "add_segments" && s.args.additions[0].type === "layout");
  assert.deepEqual(layout.args.additions[0].properties, { kind: "fullscreen", layer_id: NEW_LAYER, transition: { kind: "instant" } });
  assert.match(plan.warnings[0], /no camera segment/);
  assert.equal(plan.expect.keep_out, null);
  const vertical = makePlan({ timeline: STAGED, job: job(4000, 8000), mediaId: MEDIA, canvas: { width: 1080, height: 1920 }, action: "place" });
  const corner = vertical.steps.find((s) => s.op === "add_segments" && s.args.additions[0].type === "layout");
  assert.equal(corner.args.additions[0].properties.kind, "corner");
  assert.equal(corner.args.additions[0].properties.main_layer_id, NEW_LAYER);
  assert.equal(corner.args.additions[0].properties.corner_layer_id, "camera_1");
  assert.equal(vertical.expect.keep_out, null);
});

test("front with a fullscreen camera: overlay + camera-only pinned layout; front over screen content: overlay only", () => {
  const plan = makePlan({ timeline: cameraOnly(), job: job(1000, 4000, { mode: "front" }), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.deepEqual(ops(plan), ["add_segments", "find_new_segment", "add_segments", "verify"]);
  const ov = plan.steps[0].args.additions[0];
  assert.equal(ov.type, "media_overlay");
  assert.deepEqual(ov.placement, { range: [1000, 4000] });
  assert.deepEqual(ov.content, { media_id: MEDIA });
  assert.deepEqual(ov.properties, {
    position: { kind: "custom", x_ratio: 0, y_ratio: 0, width_ratio: 1, height_ratio: 1 },
    lock_aspect_ratio: false,
    entrance_transition: { kind: "instant" },
    exit_transition: { kind: "instant" },
  });
  assert.deepEqual(plan.steps[1].args, { media_id: MEDIA, start_ms: 1000, segment_type: "media_overlay", category: "overlays" });
  const cam = plan.steps[2].args.additions[0];
  assert.equal(cam.type, "layout");
  assert.deepEqual(cam.placement, { range: [1000, 4000] });
  assert.deepEqual(cam.properties.sources, [{ layer_id: "camera_1", ...CAMERA_RECT }]);
  assert.equal(plan.expect.adds_camera_layout, true);
  assert.equal(plan.expect.camera_fullscreen, true);
  assert.deepEqual(plan.expect.keep_out, KEEP_OUT);
  // over the staged screen + layout: no extra layout, keepOut still set because the existing custom layout pins the camera
  const over = makePlan({ timeline: STAGED, job: job(1000, 2000, { mode: "front" }), mediaId: MEDIA, canvas: CANVAS, action: "place" });
  assert.deepEqual(ops(over), ["add_segments", "find_new_segment", "verify"]);
  assert.equal(over.expect.adds_camera_layout, false);
  assert.equal(over.expect.layouts_in_range_after, 1);
  assert.deepEqual(over.expect.keep_out, KEEP_OUT);
  // fullscreen camera on a vertical canvas: no layout, a warning
  const vert = makePlan({ timeline: cameraOnly(), job: job(1000, 4000, { mode: "front" }), mediaId: MEDIA, canvas: { width: 1080, height: 1920 }, action: "place" });
  assert.deepEqual(ops(vert), ["add_segments", "find_new_segment", "verify"]);
  assert.match(vert.warnings[0], /not landscape/);
});

test("range guards: crossing a scene boundary, empty ranges, missing media id, missing scenes", () => {
  const t = clone(STAGED);
  t.scenes = [{ id: "s1", name: "One", start_ms: 0, end_ms: 6000, edit_spans: [] }, { id: "s2", name: "Two", start_ms: 6000, end_ms: 12000, edit_spans: [] }];
  assert.throws(() => makePlan({ timeline: t, job: job(4000, 8000), mediaId: MEDIA, canvas: CANVAS }), /crosses the end of scene One/);
  assert.throws(() => makePlan({ timeline: STAGED, job: job(4000, 4000), mediaId: MEDIA, canvas: CANVAS }), /empty range/);
  assert.throws(() => makePlan({ timeline: STAGED, job: job(4000, 8000), canvas: CANVAS }), /media-id/);
  assert.throws(() => makePlan({ timeline: STAGED, job: job(4000, 8000), mediaId: MEDIA, canvas: CANVAS, action: "teleport" }), /unknown action/);
  const noScenes = makePlan({ timeline: { ...STAGED, scenes: [] }, job: job(4000, 8000), mediaId: MEDIA, canvas: CANVAS });
  assert.match(noScenes.warnings[0], /no scenes/);
  const partial = makePlan({ timeline: { ...STAGED, range: { start_ms: 0, end_ms: 6000 } }, job: job(4000, 8000), mediaId: MEDIA, canvas: CANVAS });
  assert.match(partial.warnings[0], /does not cover/);
});

const PREV = {
  mode: "behind", version: 1, media_id: "aaaa", layer_id: "screen_2", take_segment_id: "t111", layout_segment_id: "l222",
  replaced_layouts: [{ type: "layout", start_ms: 1000, end_ms: 2500, properties: { kind: "custom", transition: { kind: "instant" }, sources: [{ layer_id: "screen_1", x_ratio: 0, y_ratio: 0, width_ratio: 1, height_ratio: 1, border_radius_ratio: 0 }] } }],
  replaced_controls: [{ type: "screen_zoom", start_ms: 1000, end_ms: 2000, properties: { zoom_factor: 1.6 } }],
  start_ms: 1000, end_ms: 2500,
};

test("remove: layout first, then the take (both tolerant), then re-add replaced layouts and controls, then verify", () => {
  const plan = makePlan({ timeline: STAGED, job: job(1000, 2500), action: "remove", prevPlaced: PREV });
  assert.deepEqual(ops(plan), ["delete_segments", "delete_segments", "add_segments", "add_segments", "verify"]);
  assert.deepEqual(plan.steps[0].args, { segment_ids: ["l222"], expand_groups: false, ripple: false });
  assert.equal(plan.steps[0].tolerate_missing, true);
  assert.deepEqual(plan.steps[1].args, { segment_ids: ["t111"], expand_groups: false, ripple: false });
  assert.equal(plan.steps[1].tolerate_missing, true);
  assert.deepEqual(plan.steps[2].args.additions, [{ type: "layout", placement: { range: [1000, 2500] }, properties: PREV.replaced_layouts[0].properties }]);
  assert.deepEqual(plan.steps[3].args.additions, [{ type: "screen_zoom", placement: { range: [1000, 2000] }, properties: { zoom_factor: 1.6 } }]);
  assert.equal(plan.expect.mode, "remove");
  assert.equal(plan.expect.restored_layouts, 1);
  assert.equal(plan.expect.restored_controls, 1);
  assert.ok(plan.warnings.some((w) => /t111 is not on the timeline/.test(w)), "the recorded take is not in this read: tolerated with a warning");
  // front removal deletes the overlay (and any camera layout we added)
  const front = planRemove(STAGED, { mode: "front", overlay_segment_id: "o1", layout_segment_id: "l1", start_ms: 0, end_ms: 100 });
  assert.deepEqual(front.steps.map((s) => [s.op, s.args.segment_ids || null]), [["delete_segments", ["l1"]], ["delete_segments", ["o1"]], ["verify", null]]);
  // job.placed is the default source of the record
  const fromJob = makePlan({ timeline: STAGED, job: job(1000, 2500, { placed: PREV }), action: "remove" });
  assert.equal(fromJob.steps.length, 5);
  assert.throws(() => makePlan({ timeline: STAGED, job: job(1000, 2500), action: "remove" }), /recorded placement/);
});

test("remove warns when the recorded take moved (a cut happened in between)", () => {
  const t = clone(STAGED);
  t.layers.push({ id: "screen_2", kind: "screen", category: "content", segment_count: 1, segments: [{ id: "t111", type: "video", start_ms: 800, end_ms: 2300, media: { media_id: "aaaa" }, properties: {} }] });
  const plan = planRemove(t, PREV);
  assert.ok(plan.warnings.some((w) => /now starts at 800 ms, not 1000/.test(w)));
});

test("replace: the remove steps come first (minus their verify), then the full place plan, one expect", () => {
  const plan = makePlan({ timeline: STAGED, job: job(1000, 2500, { version: 2 }), mediaId: MEDIA, canvas: CANVAS, action: "replace", prevPlaced: PREV });
  // The place half is planned on the timeline as it will be after the remove half ran: prev's take and
  // layout gone, the layout piece and screen_zoom it had replaced back in place (so both get carved again).
  assert.deepEqual(ops(plan), ["delete_segments", "delete_segments", "add_segments", "add_segments", "add_segments", "find_new_segment", "update_segments", "split_segments", "delete_segments", "delete_segments", "add_segments", "verify"]);
  assert.match(plan.steps[0].note, /^\[remove v1\]/);
  const removedIds = new Set(["t111", "l222"]);
  for (const s of plan.steps.slice(4)) {
    const ids = (s.args && s.args.segment_ids) || [];
    assert.ok(!ids.some((id) => removedIds.has(id) || String(id).startsWith("synthetic")), `place half must not name removed or placeholder ids: ${ids}`);
  }
  assert.deepEqual(plan.steps[8].args.segment_ids, ["$SELECT"], "re-added layout piece is located by the select locator");
  assert.deepEqual(plan.steps[8].select, { layer_kinds: ["layout"], inside: [1000, 2500] });
  assert.deepEqual(plan.steps[9].args.segment_ids, ["$SELECT"], "re-added screen_zoom piece is located by the select locator");
  assert.equal(plan.steps[4].args.additions[0].type, "take");
  assert.equal(plan.expect.mode, "behind");
  assert.equal(plan.expect.removed.mode, "remove");
  assert.equal(plan.expect.replaces.take_segment_id, "t111");
  assert.equal(plan.steps.filter((s) => s.op === "verify").length, 1);
});

/** A post-placement read: the staged timeline plus the take on screen_2 and the layout carved + replaced. */
function afterBehind(start, end, mutate = () => {}) {
  const t = clone(STAGED);
  t.layers.push({
    id: "screen_2", kind: "screen", category: "content", segment_count: 1,
    segments: [{ id: "n1", type: "video", start_ms: start, end_ms: end, group_id: "g9", scene_id: "b15a", media: { media_id: MEDIA, start_ms: 0, end_ms: end - start, speed: 1 }, properties: { face_tracking_mode: "disabled", transition: { kind: "cut" } } }],
  });
  const layout = t.layers.find((l) => l.kind === "layout");
  layout.segments = [
    { id: "c353a", type: "layout", start_ms: 0, end_ms: start, properties: STAGED.layers.find((l) => l.kind === "layout").segments[0].properties },
    { id: "n2", type: "layout", start_ms: start, end_ms: end, properties: pinnedLayout("screen_2", "camera_1", true) },
    { id: "c353b", type: "layout", start_ms: end, end_ms: 3000, properties: STAGED.layers.find((l) => l.kind === "layout").segments[0].properties },
  ];
  layout.segment_count = 3;
  mutate(t);
  return t;
}

test("verify (behind): the take at start on a fresh screen layer, one layout in range, duration and scenes unchanged -> placed record", () => {
  const j = job(1000, 2500, { version: 1 });
  const plan = makePlan({ timeline: STAGED, job: j, mediaId: MEDIA, canvas: CANVAS, action: "place" });
  const res = verifyPlacement(afterBehind(1000, 2500), j, plan, MEDIA);
  assert.deepEqual(res.problems, []);
  assert.equal(res.ok, true);
  assert.deepEqual(res.placed, {
    mode: "behind", version: 1, media_id: MEDIA, layer_id: "screen_2", take_segment_id: "n1", layout_segment_id: "n2",
    replaced_layouts: plan.expect.replaced_layouts, replaced_controls: [], start_ms: 1000, end_ms: 2500,
  });
  assert.equal(res.placed.replaced_layouts[0].original_segment_id, "c353");
});

test("verify (behind) catches: a changed duration, a moved scene, a missing take, two layouts, wrong properties, a take on the occupied layer", () => {
  const j = job(1000, 2500);
  const plan = makePlan({ timeline: STAGED, job: j, mediaId: MEDIA, canvas: CANVAS, action: "place" });
  const rippled = verifyPlacement(afterBehind(1000, 2500, (t) => { t.duration_ms = 13500; t.scenes[0].end_ms = 13500; }), j, plan, MEDIA);
  assert.ok(rippled.problems.some((p) => /duration changed: 12000 -> 13500/.test(p)));
  const moved = verifyPlacement(afterBehind(1000, 2500, (t) => { t.scenes[0].start_ms = 500; }), j, plan, MEDIA);
  assert.ok(moved.problems.some((p) => /scene b15a moved/.test(p)));
  const missing = verifyPlacement(STAGED, j, plan, MEDIA);
  assert.ok(missing.problems.some((p) => /no screen video segment of media 87d7 starts at 1000/.test(p)));
  const twoLayouts = verifyPlacement(afterBehind(1000, 2500, (t) => { t.layers.find((l) => l.kind === "layout").segments[0].end_ms = 1500; }), j, plan, MEDIA);
  assert.ok(twoLayouts.problems.some((p) => /expected exactly one layout .* found 2/.test(p)));
  const props = verifyPlacement(afterBehind(1000, 2500, (t) => { t.layers.find((l) => l.id === "screen_2").segments[0].properties = { face_tracking_mode: "auto", transition: { kind: "auto" } }; }), j, plan, MEDIA);
  assert.ok(props.problems.some((p) => /face_tracking_mode is auto/.test(p)) && props.problems.some((p) => /transition is auto/.test(p)));
  const wrongLayer = verifyPlacement(afterBehind(1000, 2500, (t) => { t.layers.find((l) => l.id === "screen_2").id = "screen_1"; }), j, plan, MEDIA);
  assert.ok(wrongLayer.problems.some((p) => /landed on screen_1/.test(p)));
  const long = verifyPlacement(afterBehind(1000, 2600), j, plan, MEDIA);
  assert.ok(long.problems.some((p) => /more than a frame past 2500/.test(p)));
});

test("verify (front): overlay at start with the camera layout when expected; (remove): our media gone, layouts restored", () => {
  const j = job(1000, 4000, { mode: "front" });
  const plan = makePlan({ timeline: cameraOnly(), job: j, mediaId: MEDIA, canvas: CANVAS, action: "place" });
  const after = cameraOnly();
  after.layers.find((l) => l.kind === "media_overlay").segments.push({ id: "o9", type: "media_overlay", start_ms: 1000, end_ms: 4000, media: { media_id: MEDIA }, properties: {} });
  after.layers.find((l) => l.kind === "layout").segments.push({ id: "l9", type: "layout", start_ms: 1000, end_ms: 4000, properties: cameraOnlyLayout("camera_1") });
  const res = verifyPlacement(after, j, plan, MEDIA);
  assert.deepEqual(res.problems, []);
  assert.equal(res.placed.overlay_segment_id, "o9");
  assert.equal(res.placed.layout_segment_id, "l9");
  assert.equal(res.placed.layer_id, "media_overlay_1");
  const noLayout = cameraOnly();
  noLayout.layers.find((l) => l.kind === "media_overlay").segments.push({ id: "o9", type: "media_overlay", start_ms: 1000, end_ms: 4000, media: { media_id: MEDIA }, properties: {} });
  assert.ok(verifyPlacement(noLayout, j, plan, MEDIA).problems.some((p) => /camera layout/.test(p)));
  // remove verification
  const rj = job(1000, 2500, { placed: PREV });
  const rplan = makePlan({ timeline: afterBehind(1000, 2500), job: rj, action: "remove", prevPlaced: { ...PREV, media_id: MEDIA, take_segment_id: "n1", layout_segment_id: "n2" } });
  const stillThere = verifyPlacement(afterBehind(1000, 2500), rj, rplan, MEDIA);
  assert.ok(stillThere.problems.some((p) => /still in 1000-2500/.test(p)));
  const restored = afterBehind(1000, 2500, (t) => {
    t.layers = t.layers.filter((l) => l.id !== "screen_2");
    const layout = t.layers.find((l) => l.kind === "layout");
    layout.segments = layout.segments.map((s) => (s.id === "n2" ? { ...s, id: "r1", properties: PREV.replaced_layouts[0].properties } : s));
  });
  const ok = verifyPlacement(restored, rj, rplan, MEDIA);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.placed, null);
});

test("CLI: plan and verify round trip through files; verify exits 2 on problems and logs to the job folder", () => {
  mkdirSync(join(root, "tests", ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tests", ".tmp", "placement-"));
  const script = join(root, "scripts", "placement.mjs");
  const jobPath = join(dir, "job.json");
  writeFileSync(jobPath, JSON.stringify(job(1000, 2500, { outDir: dir })));
  const planPath = join(dir, "plan.json");
  const plan = spawnSync(process.execPath, [script, "plan", "--timeline", join(here, "fixtures", "timeline-staged.json"), "--job", jobPath, "--media-id", MEDIA, "--canvas", join(here, "fixtures", "overview-canvas.json"), "--action", "place", "--out", planPath], { encoding: "utf8" });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).steps.length, 7);
  const afterPath = join(dir, "after.json");
  writeFileSync(afterPath, JSON.stringify(afterBehind(1000, 2500)));
  const ok = spawnSync(process.execPath, [script, "verify", "--timeline", afterPath, "--job", jobPath, "--plan", planPath, "--media-id", MEDIA], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).placed.layer_id, "screen_2");
  const bad = spawnSync(process.execPath, [script, "verify", "--timeline", join(here, "fixtures", "timeline-staged.json"), "--job", jobPath, "--plan", planPath, "--media-id", MEDIA], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).ok, false);
  const log = readFileSync(join(dir, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(log[log.length - 1].kind, "error");
  assert.match(log[log.length - 1].text, /placement verify failed/);
  const usage = spawnSync(process.execPath, [script, "plan"], { encoding: "utf8" });
  assert.equal(usage.status, 1);
});

test("replace: the place half never references a segment the remove half deleted", async () => {
  const { makePlan } = await import("../scripts/placement.mjs");
  const timeline = JSON.parse(readFileSync(new URL("./fixtures/timeline-staged.json", import.meta.url), "utf8"));
  const layoutId = timeline.layers.find((l) => l.id === "layout").segments[0].id;
  const takeId = timeline.layers.find((l) => l.id === "screen_1").segments[0].id;
  const prev = { mode: "behind", version: 1, media_id: "8df6", layer_id: "screen_1", take_segment_id: takeId, layout_segment_id: layoutId, replaced_layouts: [], replaced_controls: [], start_ms: 0, end_ms: 3000 };
  const job = { id: "anim-test", startMs: 0, endMs: 3000, durationInFrames: 90, fps: 30, width: 1920, height: 1080, mode: "behind", canvasFormat: "landscape", placed: prev };
  const plan = makePlan({ timeline, job, mediaId: "new1", action: "replace", prevPlaced: prev });
  const ops = plan.steps.map((s) => s.op);
  const firstAdd = ops.indexOf("add_segments");
  assert.ok(firstAdd > 0, "remove steps come first");
  for (const s of plan.steps.slice(firstAdd)) {
    const ids = (s.args && s.args.segment_ids) || [];
    assert.ok(!ids.includes(layoutId) && !ids.includes(takeId), `place half references a removed id in step ${s.op}: ${ids}`);
  }
});
