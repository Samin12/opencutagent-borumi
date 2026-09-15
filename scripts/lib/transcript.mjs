// Borumi transcript helpers shared by segments.mjs, chapters.mjs and the skills.
//
// Borumi's `get_transcript` (mode words | blocks) returns
//   { layers:[{ id, kind, segments:[{ segment_id, scene_id, media_id, start_ms, end_ms,
//     media_range:{start_ms,end_ms}, items:[[start_ms, end_ms, "text"], ...] }] }], range, timeline_hash }
// Item times are PROJECT milliseconds (verified 2026-09-15, see the cookbook). Words keep their
// punctuation and capitalisation, so the upstream sentence rules in segments.mjs apply unchanged.
//
// Everything here is pure. Times in: project ms. Times out: project ms unless the name says sec.
import { mmss, mmssMs } from "./fmt.mjs";

export { mmss, mmssMs };

/** One flat item per transcript entry, sorted by start: {text,start_ms,end_ms,layer_id,segment_id,scene_id,media_id}. */
export function flattenTranscript(json) {
  const out = [];
  const layers = (json && json.layers) || [];
  for (const layer of layers) {
    for (const seg of layer.segments || []) {
      for (const it of seg.items || []) {
        const [start, end, text] = Array.isArray(it) ? it : [it.start_ms, it.end_ms, it.text];
        if (start == null || !Number.isFinite(Number(start))) continue;
        out.push({
          text: String(text == null ? "" : text),
          start_ms: Number(start),
          end_ms: end != null && Number.isFinite(Number(end)) ? Number(end) : Number(start),
          layer_id: layer.id || null,
          segment_id: seg.segment_id || null,
          scene_id: seg.scene_id || null,
          media_id: seg.media_id || null,
        });
      }
    }
  }
  out.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  return out;
}

/** Alias that reads better at the call site for mode:"words" responses. */
export function flattenWords(json) {
  return flattenTranscript(json);
}

/** Alias for mode:"blocks" responses (same shape, longer items). */
export function flattenBlocks(json) {
  return flattenTranscript(json);
}

/**
 * Items whose MIDPOINT falls inside [startMs, endMs]. The midpoint rule assigns every item to
 * exactly one range, so segments built from a slice never straddle a cut (upstream sliceWordsToWindow).
 */
export function sliceByRange(items, startMs, endMs) {
  const a = Number(startMs), b = Number(endMs);
  return (items || []).filter((w) => {
    const mid = (w.start_ms + w.end_ms) / 2;
    return mid >= a && mid <= b;
  });
}

/** Project ms -> seconds relative to an origin (the job's start), rounded to 3 decimals. */
export function toRelativeSec(ms, originMs = 0) {
  return Math.round(((Number(ms) || 0) - (Number(originMs) || 0))) / 1000;
}

/** Relative seconds -> project ms (rounded to whole ms). */
export function toProjectMs(sec, originMs = 0) {
  return Math.round((Number(sec) || 0) * 1000 + (Number(originMs) || 0));
}

/**
 * The adapter the upstream segmentation expects: Borumi items -> Scribe-style tokens
 * [{type:"word", text, start, end}] in SECONDS relative to originMs (0 = project seconds).
 */
export function toScribeTokens(items, originMs = 0) {
  return (items || []).map((w) => ({
    type: "word",
    text: w.text,
    start: toRelativeSec(w.start_ms, originMs),
    end: toRelativeSec(w.end_ms, originMs),
  }));
}

/** Join item texts with single spaces. */
export function itemsText(items) {
  return (items || []).map((w) => String(w.text || "").trim()).filter(Boolean).join(" ");
}

/** Normalise a word for matching: lowercase, letters/digits/apostrophes only. */
export function wordKeyOf(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9']/g, "");
}

/**
 * Word-level search for "the part where I say ...": every run of words whose keys equal the
 * phrase's keys in order. Returns [{start_ms, end_ms, from, to, text}] (from/to = item indexes,
 * inclusive) in time order. Empty phrase or no match -> [].
 */
export function findPhrase(items, phrase) {
  const keys = String(phrase || "").split(/\s+/).map(wordKeyOf).filter(Boolean);
  const words = items || [];
  if (!keys.length || !words.length) return [];
  const out = [];
  for (let i = 0; i + keys.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < keys.length && ok; j++) ok = wordKeyOf(words[i + j].text) === keys[j];
    if (!ok) continue;
    const slice = words.slice(i, i + keys.length);
    out.push({ start_ms: slice[0].start_ms, end_ms: slice[slice.length - 1].end_ms, from: i, to: i + keys.length - 1, text: itemsText(slice) });
  }
  return out;
}

/**
 * Widen a word range to the enclosing block boundaries: the block that contains start_ms gives
 * the new start, the block that contains end_ms gives the new end. Blocks are flattened items
 * from mode:"blocks". A time outside every block keeps its own value.
 */
export function snapToBlocks(range, blocks) {
  const contains = (b, t) => t >= b.start_ms && t <= b.end_ms;
  let start = range.start_ms, end = range.end_ms;
  const bs = (blocks || []).find((b) => contains(b, range.start_ms));
  const be = (blocks || []).find((b) => contains(b, range.end_ms));
  if (bs) start = Math.min(start, bs.start_ms);
  if (be) end = Math.max(end, be.end_ms);
  const covered = (blocks || []).filter((b) => b.end_ms > start && b.start_ms < end);
  return { start_ms: start, end_ms: end, blocks: covered.map((b) => b.text) };
}

/** The scene (from get_scenes / get_timeline scenes[]) whose [start_ms, end_ms) holds t; null when none. */
export function sceneAt(scenes, t) {
  for (const s of scenes || []) if (t >= s.start_ms && (t < s.end_ms || (t === s.end_ms && t === s.start_ms))) return s;
  return null;
}

/** "m:ss" of a project time in ms plus the same time in seconds: "0:41 (41.2s)". */
export function describeMs(ms) {
  return `${mmssMs(ms)} (${Math.round((Number(ms) || 0) / 100) / 10}s)`;
}
