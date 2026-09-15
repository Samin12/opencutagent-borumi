#!/usr/bin/env node
// Placement planner for /borumi:visualize and /borumi:insert: a PURE function from a Borumi
// get_timeline read + job facts to the exact ordered MCP steps, so the skill executes
// deterministically and the logic is unit-tested (DESIGN 9.1 and 9.2).
//
//   placement.mjs plan --timeline <get_timeline json> --job <job.json> --media-id <id>
//                      [--canvas <get_project_overview canvas json>] --action place|remove|replace
//                      [--prev-placed <placed.json>] [--out plan.json]
//       -> {steps:[{op, args, reread, note, select?, tolerate_missing?, binds?}], warnings:[], expect:{...}}
//   placement.mjs verify --timeline <get_timeline json AFTER the steps> --job <job.json> --plan <plan.json>
//                        --media-id <id> [--out placed.json]
//       -> {ok, placed:{...}, problems:[]}
//
// Step contract for the executor (the skill):
//  - `args` are the tool arguments WITHOUT tx_id / timeline_hash; the executor adds both and, when
//    `reread` is true, re-reads get_timeline for the range after the call (structural edits change
//    the hash; update_segments does not).
//  - `find_new_segment` is not a Borumi tool: the executor locates the segment whose
//    media.media_id equals args.media_id at args.start_ms (segment type args.segment_type) in the
//    fresh read and binds "$NEW_LAYER" (its layer id) and "$NEW_SEGMENT" (its id). Later steps use
//    those placeholders verbatim.
//  - A delete step may carry `select`: after the re-read, every segment on layers of kind
//    select.layer_kinds whose [start_ms,end_ms] lies inside select.inside replaces the "$SELECT"
//    entry of args.segment_ids (deduped). This is how the inner piece of a split layout or control
//    segment is found, because split pieces get fresh ids.
//  - `tolerate_missing` on a delete: a segment_not_found error is not a failure (the piece was
//    already gone), the executor drops that id and continues.
//  - `verify` is not a tool either: run `placement.mjs verify` on the post-step read.
//
// Behind mode never deletes recorded screen content: a take added over an occupied screen_1 lands
// on a new screen_N (verified), so the planner only ever splits/deletes LAYOUT and CONTROL pieces
// (screen_zoom, screen_highlight, screen_blur) inside the range and records them for `remove`.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Samin's measured pinned-camera rect (Astra edit), canvas ratios; camera source goes LAST so it draws on top. */
export const CAMERA_RECT = Object.freeze({
  x_ratio: 0.775, y_ratio: 0.715, width_ratio: 0.21, height_ratio: 0.25,
  border_radius_ratio: 0.0284, corner_shape: "squircle_v2", lock_aspect_ratio: false, overflow: false,
  shadow: { blur_ratio: 0.0185, color: { r: 0, g: 0, b: 0, a: 100 }, x_offset_ratio: 0, y_offset_ratio: 0.0185 },
});
/** Canvas-ratio rectangle the animation must keep essential content out of when the camera is pinned. */
export const KEEP_OUT = Object.freeze({ x: 0.775, y: 0.715, w: 0.225, h: 0.285 });
export const FULL_FRAME_SOURCE = Object.freeze({ x_ratio: 0, y_ratio: 0, width_ratio: 1, height_ratio: 1, border_radius_ratio: 0, lock_aspect_ratio: false, overflow: false });
export const CONTROL_LAYER_KINDS = Object.freeze(["screen_zoom", "screen_highlight", "screen_blur"]);
export const NEW_LAYER = "$NEW_LAYER";
export const NEW_SEGMENT = "$NEW_SEGMENT";
export const SELECT = "$SELECT";
export const FPS = 30;

/* ---------- inputs ---------- */

/** Read the facts the planner needs from job.json (tolerates the create-output and deliverable shapes). */
export function jobFacts(job) {
  const j = job || {};
  const range = j.range || {};
  const startMs = num(j.startMs, j.start_ms, range.startMs, range.start_ms);
  const fps = num(j.fps) || FPS;
  const durationInFrames = num(j.durationInFrames, j.duration_in_frames);
  let endMs = num(j.endMsEffective, j.end_ms_effective, j.endMs, j.end_ms, range.endMs, range.end_ms);
  if (startMs != null && durationInFrames != null) {
    const eff = startMs + Math.floor((durationInFrames * 1000) / fps);
    endMs = endMs == null ? eff : Math.min(endMs, eff);
  }
  return {
    id: j.jobId || j.id || null,
    startMs,
    endMs,
    mode: j.mode || "behind",
    version: num(j.version, j.lastRenderedVersion) || null,
    sceneId: j.sceneId || j.scene_id || null,
    width: num(j.width, j.canvas && j.canvas.width),
    height: num(j.height, j.canvas && j.canvas.height),
    fps,
    durationInFrames,
    canvasFormat: j.canvasFormat || j.canvas_format || null,
    outDir: j.outDir || j.jobDir || null,
    kitDir: j.kitDir || null,
    placed: j.placed || null,
  };
}

function num(...vals) {
  for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** {width, height, preset} from a get_project_overview canvas slice, a bare {width,height}, or job facts. */
export function canvasSize(canvas, job = null) {
  const c = canvas || {};
  const f = (c.canvas && c.canvas.format) || c.format || null;
  if (f && f.width_px && f.height_px) return { width: Number(f.width_px), height: Number(f.height_px), preset: f.preset || null };
  if (c.width && c.height) return { width: Number(c.width), height: Number(c.height), preset: c.preset || null };
  if (job && job.width && job.height) return { width: job.width, height: job.height, preset: job.canvasFormat };
  return null;
}

/** Landscape = wider than tall (the measured camera rect only makes sense there). Unknown -> true with a warning upstream. */
export function isLandscape(size) {
  if (!size) return true;
  if (size.preset) return size.preset === "landscape";
  return size.width > size.height;
}

/* ---------- timeline readers ---------- */

const overlaps = (seg, start, end) => seg.start_ms < end && seg.end_ms > start;

/** [{layer, seg}] for every segment overlapping [start,end) on layers matching `pick(layer)`. */
export function segmentsOverlapping(timeline, pick, start, end) {
  const out = [];
  for (const layer of (timeline && timeline.layers) || []) {
    if (!pick(layer)) continue;
    for (const seg of layer.segments || []) if (overlaps(seg, start, end)) out.push({ layer, seg });
  }
  return out;
}

const byKind = (kind) => (layer) => layer.kind === kind;
const byKinds = (kinds) => (layer) => kinds.includes(layer.kind);

/** The scene whose [start_ms, end_ms) holds t, from timeline.scenes. */
export function sceneContaining(timeline, t) {
  for (const s of (timeline && timeline.scenes) || []) if (t >= s.start_ms && t < s.end_ms) return s;
  return null;
}

/** Layout properties reference this layer id? (custom sources, fullscreen, corner, side) */
export function layoutReferences(props, layerId) {
  if (!props) return false;
  if (Array.isArray(props.sources)) return props.sources.some((s) => s.layer_id === layerId);
  return [props.layer_id, props.main_layer_id, props.corner_layer_id, props.side_layer_id].includes(layerId);
}

/* ---------- pieces ---------- */

function step(op, args, extra = {}) {
  return { op, args, reread: extra.reread !== false, note: extra.note || "", ...(extra.select ? { select: extra.select } : {}), ...(extra.tolerate_missing ? { tolerate_missing: true } : {}), ...(extra.binds ? { binds: extra.binds } : {}) };
}

/**
 * Split/delete every segment of the given layer kinds that overlaps [start,end): the boundaries
 * strictly inside a segment become split times; the piece inside the range is deleted (by id when
 * it needs no split, via `select` after a split). Records {type, start_ms, end_ms, properties} per
 * removed piece so `remove` can re-add it.
 */
export function carveRange(timeline, kinds, start, end, label) {
  const hits = segmentsOverlapping(timeline, byKinds(kinds), start, end);
  const splits = [];
  const deleteIds = [];
  const records = [];
  let needSelect = false;
  for (const { layer, seg } of hits) {
    const times = [];
    if (seg.start_ms < start && seg.end_ms > start) times.push(start);
    if (seg.start_ms < end && seg.end_ms > end) times.push(end);
    records.push({
      type: layer.kind,
      layer_id: layer.id,
      original_segment_id: seg.synthetic ? null : seg.id,
      original_range: [seg.start_ms, seg.end_ms],
      start_ms: Math.max(seg.start_ms, start),
      end_ms: Math.min(seg.end_ms, end),
      properties: seg.properties || null,
    });
    if (seg.synthetic) {
      // A piece the remove half of a replace re-adds before this step runs: its id is only known at
      // execution time, so the executor's select locator (kind + inside the range) finds it.
      needSelect = true;
      if (times.length) splits.push({ segment_id: SELECT, times_ms: times, select: { layer_kinds: kinds, inside: [seg.start_ms, seg.end_ms] } });
    } else if (times.length) splits.push({ segment_id: seg.id, times_ms: times });
    else deleteIds.push(seg.id);
  }
  const steps = [];
  if (splits.length) {
    steps.push(step("split_segments", { splits }, { note: `split ${label} segment(s) at the range boundaries so only the piece inside ${start}-${end} is removed` }));
    needSelect = true;
  }
  if (records.length) {
    steps.push(step("delete_segments", { segment_ids: [...deleteIds, ...(needSelect ? [SELECT] : [])], expand_groups: false, ripple: false }, {
      note: `delete the ${label} piece(s) inside ${start}-${end} (recorded for remove; no ripple)`,
      select: { layer_kinds: kinds, inside: [start, end] },
    }));
  }
  return { steps, records };
}

/** The camera layer active in the range (camera_1 first), or null. */
export function cameraLayerIn(timeline, start, end) {
  const hits = segmentsOverlapping(timeline, byKind("camera"), start, end);
  if (!hits.length) return null;
  const ids = [...new Set(hits.map((h) => h.layer.id))].sort();
  return ids.includes("camera_1") ? "camera_1" : ids[0];
}

/** The layout properties for the placed animation. */
export function pinnedLayout(newLayerId, cameraLayerId, landscape) {
  if (!cameraLayerId) return { kind: "fullscreen", layer_id: newLayerId, transition: { kind: "instant" } };
  if (!landscape) return { kind: "corner", main_layer_id: newLayerId, corner_layer_id: cameraLayerId, corner_shape: "squircle_v2", transition: { kind: "instant" } };
  return {
    kind: "custom",
    transition: { kind: "instant" },
    sources: [
      { layer_id: newLayerId, ...FULL_FRAME_SOURCE },
      { layer_id: cameraLayerId, ...CAMERA_RECT },
    ],
  };
}

/** The camera-only pinned layout used in front mode when the camera would otherwise fill the frame. */
export function cameraOnlyLayout(cameraLayerId) {
  return { kind: "custom", transition: { kind: "instant" }, sources: [{ layer_id: cameraLayerId, ...CAMERA_RECT }] };
}

function baseExpect(timeline, facts, mediaId) {
  return {
    media_id: mediaId,
    start_ms: facts.startMs,
    end_ms: facts.endMs,
    scene_id: facts.sceneId || (sceneContaining(timeline, facts.startMs) || {}).id || null,
    duration_ms: timeline.duration_ms != null ? timeline.duration_ms : null,
    scene_starts: ((timeline && timeline.scenes) || []).map((s) => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms })),
  };
}

function checkRange(timeline, facts, warnings) {
  if (facts.startMs == null || facts.endMs == null) throw new Error("job.json has no start_ms/end_ms (or durationInFrames) to place");
  if (!(facts.endMs > facts.startMs)) throw new Error(`empty range ${facts.startMs}-${facts.endMs}`);
  const scenes = (timeline && timeline.scenes) || [];
  if (!scenes.length) { warnings.push("the timeline read carries no scenes: the scene-boundary check was skipped"); return; }
  const scene = sceneContaining(timeline, facts.startMs);
  if (!scene) throw new Error(`no scene contains ${facts.startMs} ms`);
  if (facts.endMs > scene.end_ms) throw new Error(`range ${facts.startMs}-${facts.endMs} crosses the end of scene ${scene.name || scene.id} (${scene.end_ms} ms): make one job per scene`);
  if (facts.sceneId && scene.id && facts.sceneId !== scene.id) warnings.push(`job scene ${facts.sceneId} differs from the scene under ${facts.startMs} ms (${scene.id})`);
  const r = timeline.range || null;
  if (r && (r.start_ms > facts.startMs || r.end_ms < facts.endMs)) warnings.push(`the timeline read (${r.start_ms}-${r.end_ms}) does not cover the whole range ${facts.startMs}-${facts.endMs}`);
}

/* ---------- plans ---------- */

/** Behind: take on a screen layer + face tracking off + carve layouts/controls + pinned-camera layout. */
export function planBehind(timeline, facts, mediaId, size, warnings = []) {
  const { startMs: start, endMs: end } = facts;
  const landscape = isLandscape(size);
  if (!size) warnings.push("no canvas size given: assuming a landscape canvas for the camera rect");
  const steps = [];
  const screenHits = segmentsOverlapping(timeline, byKind("screen"), start, end);
  const occupied = [...new Set(screenHits.map((h) => h.layer.id))].sort();
  if (occupied.length) warnings.push(`${occupied.join(", ")} already ${occupied.length > 1 ? "have" : "has"} content in ${start}-${end}: the animation take will land on a new screen layer (nothing is deleted)`);
  const cameraLayer = cameraLayerIn(timeline, start, end);
  if (!cameraLayer) warnings.push(`no camera segment in ${start}-${end}: using a fullscreen layout on the animation layer`);

  steps.push(step("add_segments", { additions: [{ type: "take", placement: { at_ms: start }, content: { media_id: mediaId, video_kind: "screen" } }] },
    { note: `add the render as a screen take at ${start} ms${occupied.length ? " (lands on a new screen layer)" : ""}` }));
  steps.push(step("find_new_segment", { media_id: mediaId, start_ms: start, segment_type: "video", category: "content" },
    { reread: false, binds: [NEW_LAYER, NEW_SEGMENT], note: "locate the new video segment by media id at start_ms; bind its layer id and segment id" }));
  steps.push(step("update_segments", { updates: [{ type: "video", segment_id: NEW_SEGMENT, properties: { face_tracking_mode: "disabled", transition: { kind: "cut" } } }] },
    { reread: false, note: "an animation has no face to track and must cut in, not auto-transition" }));

  const layouts = carveRange(timeline, ["layout"], start, end, "layout");
  steps.push(...layouts.steps);
  const controls = carveRange(timeline, CONTROL_LAYER_KINDS, start, end, "screen control");
  steps.push(...controls.steps);

  const layoutProps = pinnedLayout(NEW_LAYER, cameraLayer, landscape);
  steps.push(step("add_segments", { additions: [{ type: "layout", placement: { range: [start, end] }, properties: layoutProps }] },
    { note: layoutProps.kind === "custom" ? "pinned-camera layout: animation full frame, camera bottom-right on top" : layoutProps.kind === "corner" ? "non-landscape canvas: Borumi's corner preset instead of the measured rect" : "screen-only range: animation fullscreen" }));

  const expect = {
    ...baseExpect(timeline, facts, mediaId),
    mode: "behind",
    layout_kind: layoutProps.kind,
    camera_layer_id: cameraLayer,
    landscape,
    occupied_screen_layers: occupied,
    replaced_layouts: layouts.records,
    replaced_controls: controls.records,
    layouts_in_range_after: 1,
    keep_out: cameraLayer && landscape ? KEEP_OUT : null,
  };
  steps.push(step("verify", { action: "place", mode: "behind" }, { reread: false, note: "placement.mjs verify on the post-step read: take at start_ms, one layout in range, duration and scene starts unchanged" }));
  return { steps, warnings, expect };
}

/** Front: full-frame media_overlay with instant transitions (+ camera-only pinned layout when the camera fills the frame). */
export function planFront(timeline, facts, mediaId, size, warnings = []) {
  const { startMs: start, endMs: end } = facts;
  const landscape = isLandscape(size);
  const steps = [];
  steps.push(step("add_segments", {
    additions: [{
      type: "media_overlay",
      placement: { range: [start, end] },
      content: { media_id: mediaId },
      properties: {
        position: { kind: "custom", x_ratio: 0, y_ratio: 0, width_ratio: 1, height_ratio: 1 },
        lock_aspect_ratio: false,
        entrance_transition: { kind: "instant" },
        exit_transition: { kind: "instant" },
      },
    }],
  }, { note: "full-frame alpha overlay above everything (overlays render above the camera)" }));
  steps.push(step("find_new_segment", { media_id: mediaId, start_ms: start, segment_type: "media_overlay", category: "overlays" },
    { reread: false, binds: [NEW_LAYER, NEW_SEGMENT], note: "locate the new overlay segment by media id at start_ms" }));

  const cameraLayer = cameraLayerIn(timeline, start, end);
  const screenHits = segmentsOverlapping(timeline, byKind("screen"), start, end);
  const layoutHits = segmentsOverlapping(timeline, byKind("layout"), start, end);
  const cameraFullscreen = !!cameraLayer && !screenHits.length && !layoutHits.length;
  let addsCameraLayout = false;
  if (cameraFullscreen) {
    if (landscape) {
      addsCameraLayout = true;
      steps.push(step("add_segments", { additions: [{ type: "layout", placement: { range: [start, end] }, properties: cameraOnlyLayout(cameraLayer) }] },
        { note: "the camera fills the frame here: pin it bottom-right so the overlay never covers the face" }));
    } else {
      warnings.push("the camera fills the frame and the canvas is not landscape: no pinned layout added, the overlay may cover the face");
    }
  }
  const expect = {
    ...baseExpect(timeline, facts, mediaId),
    mode: "front",
    camera_layer_id: cameraLayer,
    landscape,
    camera_fullscreen: cameraFullscreen,
    adds_camera_layout: addsCameraLayout,
    layouts_in_range_after: layoutHits.length + (addsCameraLayout ? 1 : 0),
    replaced_layouts: [],
    replaced_controls: [],
    keep_out: addsCameraLayout || layoutHits.some((h) => layoutReferences(h.seg.properties, cameraLayer) && h.seg.properties.kind === "custom") ? KEEP_OUT : null,
  };
  steps.push(step("verify", { action: "place", mode: "front" }, { reread: false, note: "placement.mjs verify: overlay at start_ms, camera layout when expected, duration unchanged" }));
  return { steps, warnings, expect };
}

/** Remove a recorded placement: layout, then take/overlay, then re-add what the placement replaced. */
export function planRemove(timeline, prev, warnings = []) {
  if (!prev || typeof prev !== "object") throw new Error("remove needs the recorded placement (--prev-placed or job.placed)");
  const steps = [];
  const mode = prev.mode || "behind";
  const contentId = mode === "front" ? (prev.overlay_segment_id || prev.take_segment_id) : (prev.take_segment_id || prev.overlay_segment_id);
  const allSegs = new Map();
  for (const layer of (timeline && timeline.layers) || []) for (const seg of layer.segments || []) allSegs.set(seg.id, { layer, seg });
  if (contentId) {
    const hit = allSegs.get(contentId);
    if (!hit) warnings.push(`recorded ${mode === "front" ? "overlay" : "take"} segment ${contentId} is not on the timeline any more: its delete is tolerated`);
    else if (prev.start_ms != null && hit.seg.start_ms !== prev.start_ms) warnings.push(`recorded segment ${contentId} now starts at ${hit.seg.start_ms} ms, not ${prev.start_ms}: the narration moved since placement, re-resolve the range before re-placing`);
  }
  if (prev.layout_segment_id) {
    if (!allSegs.has(prev.layout_segment_id)) warnings.push(`recorded layout ${prev.layout_segment_id} is already gone (Borumi drops layouts whose layer vanished): delete tolerated`);
    steps.push(step("delete_segments", { segment_ids: [prev.layout_segment_id], expand_groups: false, ripple: false }, { tolerate_missing: true, note: "delete the layout we added (tolerate not found)" }));
  }
  if (contentId) {
    steps.push(step("delete_segments", { segment_ids: [contentId], expand_groups: false, ripple: false }, { tolerate_missing: true, note: `delete the ${mode === "front" ? "overlay" : "take"} segment we added (tolerate not found)` }));
  }
  const layouts = (prev.replaced_layouts || []).filter((r) => r && r.properties);
  if (layouts.length) {
    steps.push(step("add_segments", { additions: layouts.map((r) => ({ type: "layout", placement: { range: [r.start_ms, r.end_ms] }, properties: r.properties })) },
      { note: `re-add ${layouts.length} layout piece(s) the placement replaced` }));
  }
  const controls = (prev.replaced_controls || []).filter((r) => r && r.type);
  if (controls.length) {
    steps.push(step("add_segments", { additions: controls.map((r) => ({ type: r.type, placement: { range: [r.start_ms, r.end_ms] }, ...(r.properties ? { properties: r.properties } : {}) })) },
      { note: `re-add ${controls.length} screen control segment(s) the placement replaced` }));
  }
  const expect = {
    mode: "remove",
    removed_mode: mode,
    media_id: prev.media_id || null,
    start_ms: prev.start_ms != null ? prev.start_ms : null,
    end_ms: prev.end_ms != null ? prev.end_ms : null,
    duration_ms: timeline && timeline.duration_ms != null ? timeline.duration_ms : null,
    scene_starts: ((timeline && timeline.scenes) || []).map((s) => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms })),
    restored_layouts: layouts.length,
    restored_controls: controls.length,
  };
  steps.push(step("verify", { action: "remove", mode }, { reread: false, note: "placement.mjs verify: our media gone from the range, replaced pieces back, duration unchanged" }));
  return { steps, warnings, expect };
}

/**
 * The whole plan. action: place | remove | replace (remove prev, then place; one transaction).
 * @param {{timeline:object, job:object, mediaId?:string, canvas?:object, action:string, prevPlaced?:object}} input
 */
export function makePlan({ timeline, job, mediaId, canvas, action = "place", prevPlaced = null }) {
  const facts = jobFacts(job);
  const warnings = [];
  const prev = prevPlaced || facts.placed || null;
  if (action === "remove") {
    const r = planRemove(timeline, prev, warnings);
    return { action, steps: r.steps, warnings: r.warnings, expect: r.expect };
  }
  if (!mediaId) throw new Error("place needs --media-id (the id import_media returned)");
  checkRange(timeline, facts, warnings);
  const size = canvasSize(canvas, facts);
  if (action === "replace") {
    // Plan the removal on the live read, then plan the placement on a copy of the timeline with the
    // previous placement's pieces already gone: the executor runs the remove steps first, so a
    // place step must never reference a segment the remove half deleted (a stale layout id did
    // exactly that on the first live replace and aborted the transaction).
    const r = planRemove(timeline, prev, warnings);
    const removeSteps = r.steps.filter((s) => s.op !== "verify").map((s) => ({ ...s, note: `[remove v${prev.version || "prev"}] ${s.note}` }));
    const after = withoutPlacement(timeline, prev);
    const place = facts.mode === "front" ? planFront(after, facts, mediaId, size, warnings) : planBehind(after, facts, mediaId, size, warnings);
    return { action, steps: [...removeSteps, ...place.steps], warnings, expect: { ...place.expect, removed: r.expect, replaces: prev } };
  }
  const place = facts.mode === "front" ? planFront(timeline, facts, mediaId, size, warnings) : planBehind(timeline, facts, mediaId, size, warnings);
  if (action !== "place") throw new Error(`unknown action "${action}" (place|remove|replace)`);
  return { action, steps: place.steps, warnings, expect: place.expect };
}

/** A deep copy of the timeline without the segments a recorded placement added (take/overlay and layout);
 *  a layer left empty disappears, as Borumi does. Replaced layouts/controls are re-added by the remove
 *  steps, so they are put back into the copy at their recorded ranges (ids unknown, marked synthetic). */
export function withoutPlacement(timeline, prev) {
  const gone = new Set([prev && prev.take_segment_id, prev && prev.overlay_segment_id, prev && prev.layout_segment_id].filter(Boolean));
  const copy = JSON.parse(JSON.stringify(timeline || {}));
  copy.layers = (copy.layers || []).map((layer) => ({ ...layer, segments: (layer.segments || []).filter((s) => !gone.has(s.id)) }))
    .map((layer) => ({ ...layer, segment_count: layer.segments.length }))
    .filter((layer) => layer.segments.length > 0 || layer.category === "control" || layer.category === "overlays");
  const layoutLayer = copy.layers.find((l) => l.id === "layout" || l.kind === "layout");
  for (const r of (prev && prev.replaced_layouts) || []) {
    if (layoutLayer && r && r.properties) layoutLayer.segments.push({ id: `synthetic-${r.start_ms}-${r.end_ms}`, type: "layout", start_ms: r.start_ms, end_ms: r.end_ms, properties: r.properties, synthetic: true });
  }
  for (const r of (prev && prev.replaced_controls) || []) {
    const layer = copy.layers.find((l) => l.kind === r.type || l.id === r.type);
    if (layer && r) layer.segments.push({ id: `synthetic-${r.type}-${r.start_ms}`, type: r.type, start_ms: r.start_ms, end_ms: r.end_ms, properties: r.properties || {}, synthetic: true });
  }
  if (layoutLayer) layoutLayer.segment_count = layoutLayer.segments.length;
  return copy;
}

/* ---------- verify ---------- */

/**
 * Check a post-step get_timeline read against the plan's expectations and build the `placed` record.
 * @returns {{ok:boolean, placed:object|null, problems:string[]}}
 */
export function verifyPlacement(timeline, job, plan, mediaId) {
  const facts = jobFacts(job);
  const expect = (plan && plan.expect) || {};
  const problems = [];
  const start = expect.start_ms != null ? expect.start_ms : facts.startMs;
  const end = expect.end_ms != null ? expect.end_ms : facts.endMs;
  const media = mediaId || expect.media_id;
  if (expect.duration_ms != null && timeline.duration_ms != null && timeline.duration_ms !== expect.duration_ms) {
    problems.push(`duration changed: ${expect.duration_ms} -> ${timeline.duration_ms} ms (the placement must not ripple)`);
  }
  const afterScenes = new Map(((timeline && timeline.scenes) || []).map((s) => [s.id, s]));
  for (const s of expect.scene_starts || []) {
    const now = afterScenes.get(s.id);
    if (now && now.start_ms !== s.start_ms) problems.push(`scene ${s.id} moved: ${s.start_ms} -> ${now.start_ms} ms`);
  }
  const layoutsInRange = segmentsOverlapping(timeline, byKind("layout"), start, end);
  const ownMedia = (h) => h.seg.media && h.seg.media.media_id === media;

  if (expect.mode === "remove") {
    const leftovers = segmentsOverlapping(timeline, () => true, start, end).filter(ownMedia);
    if (leftovers.length) problems.push(`${leftovers.length} segment(s) of media ${media} still in ${start}-${end}: ${leftovers.map((h) => `${h.layer.id}/${h.seg.id}`).join(", ")}`);
    if (expect.restored_layouts != null && layoutsInRange.length < expect.restored_layouts) problems.push(`expected ${expect.restored_layouts} restored layout(s) in range, found ${layoutsInRange.length}`);
    return { ok: problems.length === 0, placed: null, problems, removed: { media_id: media, start_ms: start, end_ms: end } };
  }

  let placed = null;
  if (expect.mode === "front") {
    const overlays = segmentsOverlapping(timeline, byKind("media_overlay"), start, end).filter((h) => ownMedia(h) && h.seg.start_ms === start);
    if (!overlays.length) problems.push(`no media_overlay of media ${media} starts at ${start} ms`);
    else if (overlays.length > 1) problems.push(`${overlays.length} overlays of media ${media} start at ${start} ms (expected one)`);
    const ov = overlays[0] || null;
    if (ov && ov.seg.end_ms !== end) problems.push(`overlay ends at ${ov.seg.end_ms} ms, expected ${end}`);
    let layoutId = null;
    if (expect.adds_camera_layout) {
      const cam = layoutsInRange.filter((h) => h.seg.start_ms === start && h.seg.properties && layoutReferences(h.seg.properties, expect.camera_layer_id));
      if (cam.length !== 1) problems.push(`expected exactly one camera layout starting at ${start} ms, found ${cam.length}`);
      else layoutId = cam[0].seg.id;
    }
    if (expect.layouts_in_range_after != null && layoutsInRange.length !== expect.layouts_in_range_after) problems.push(`expected ${expect.layouts_in_range_after} layout(s) in range, found ${layoutsInRange.length}`);
    placed = {
      mode: "front", version: facts.version, media_id: media, layer_id: ov ? ov.layer.id : null,
      overlay_segment_id: ov ? ov.seg.id : null, layout_segment_id: layoutId,
      replaced_layouts: [], replaced_controls: [], start_ms: start, end_ms: end,
    };
  } else {
    const takes = segmentsOverlapping(timeline, byKind("screen"), start, end).filter((h) => ownMedia(h) && h.seg.start_ms === start);
    if (!takes.length) problems.push(`no screen video segment of media ${media} starts at ${start} ms`);
    else if (takes.length > 1) problems.push(`${takes.length} screen segments of media ${media} start at ${start} ms (expected one)`);
    const take = takes[0] || null;
    if (take) {
      if (take.seg.end_ms > end + Math.ceil(1000 / facts.fps)) problems.push(`the take ends at ${take.seg.end_ms} ms, more than a frame past ${end}`);
      const p = take.seg.properties || {};
      if (p.face_tracking_mode != null && p.face_tracking_mode !== "disabled") problems.push(`face_tracking_mode is ${p.face_tracking_mode}, expected disabled`);
      if (p.transition && p.transition.kind !== "cut") problems.push(`transition is ${p.transition.kind}, expected cut`);
      if (expect.occupied_screen_layers && expect.occupied_screen_layers.includes(take.layer.id)) problems.push(`the take landed on ${take.layer.id}, which already had content in the range`);
    }
    if (layoutsInRange.length !== 1) problems.push(`expected exactly one layout in ${start}-${end}, found ${layoutsInRange.length}`);
    const layout = layoutsInRange[0] || null;
    if (layout && take && !layoutReferences(layout.seg.properties, take.layer.id)) problems.push(`the layout in range does not reference ${take.layer.id}`);
    if (layout && (layout.seg.start_ms !== start || layout.seg.end_ms !== end)) problems.push(`the layout covers ${layout.seg.start_ms}-${layout.seg.end_ms}, expected ${start}-${end}`);
    placed = {
      mode: "behind", version: facts.version, media_id: media, layer_id: take ? take.layer.id : null,
      take_segment_id: take ? take.seg.id : null, layout_segment_id: layout ? layout.seg.id : null,
      replaced_layouts: expect.replaced_layouts || [], replaced_controls: expect.replaced_controls || [],
      start_ms: start, end_ms: end,
    };
  }
  return { ok: problems.length === 0, placed, problems };
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

/** Append one line to <outDir>/log.jsonl when the job folder exists (every failure is logged before it propagates). */
function logToJob(job, kind, text) {
  try {
    const facts = jobFacts(job);
    if (!facts.outDir || !existsSync(facts.outDir)) return false;
    appendFileSync(`${facts.outDir}/log.jsonl`, JSON.stringify({ ts: new Date().toISOString(), kind, where: "placement", text }) + "\n");
    return true;
  } catch { return false; }
}

function main(argv) {
  const { cmd, opts } = parseArgv(argv);
  let job = null;
  try {
    if (cmd === "plan") {
      if (!opts.timeline || !opts.job) throw new Error("plan needs --timeline <json> --job <job.json> [--media-id <id>] [--canvas <json>] --action place|remove|replace [--prev-placed <json>]");
      job = readJson(opts.job);
      const plan = makePlan({
        timeline: readJson(opts.timeline),
        job,
        mediaId: opts["media-id"] || null,
        canvas: opts.canvas ? readJson(opts.canvas) : null,
        action: opts.action || "place",
        prevPlaced: opts["prev-placed"] ? readJson(opts["prev-placed"]) : null,
      });
      if (opts.out) writeFileSync(opts.out, JSON.stringify(plan, null, 2));
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    if (cmd === "verify") {
      if (!opts.timeline || !opts.job || !opts.plan) throw new Error("verify needs --timeline <after json> --job <job.json> --plan <plan json> [--media-id <id>]");
      job = readJson(opts.job);
      const res = verifyPlacement(readJson(opts.timeline), job, readJson(opts.plan), opts["media-id"] || null);
      if (!res.ok) logToJob(job, "error", `placement verify failed: ${res.problems.join("; ")}`);
      if (opts.out) writeFileSync(opts.out, JSON.stringify(res, null, 2));
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok) process.exit(2);
      return;
    }
    throw new Error("usage: placement.mjs plan|verify ... (see the header comment)");
  } catch (e) {
    if (job) logToJob(job, "error", `placement ${cmd}: ${e.message}`);
    throw e;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`placement.mjs: ${e.message}`);
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
