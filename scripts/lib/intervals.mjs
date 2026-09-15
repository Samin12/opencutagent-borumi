// Pure interval arithmetic in milliseconds. Ported from OpenCutAgent server/rebuild.js
// (makeRemovedBefore, keepSpans) and server/silences.js (mergeFrameRanges), renamed to ms.
// Use makeRemovedBefore to remap any project time computed BEFORE a ripple cut (chapter marks,
// a planned overlay in-point, transcript word times) to its position AFTER the cut.

/** Sort ascending, drop invalid or empty ranges, merge overlaps and touching neighbours. */
export function mergeRanges(ranges) {
  const clean = (ranges || [])
    .map((r) => (Array.isArray(r) ? { start: Number(r[0]), end: Number(r[1]) } : { start: Number(r.start), end: Number(r.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out.map((r) => [r.start, r.end]);
}

/**
 * Given merged ascending cuts [[start,end],...], return removedBefore(t): how many ms of material
 * strictly before project time t were removed. A cut straddling t counts partially.
 * The remapped position of t after a ripple apply is t - removedBefore(t).
 */
export function makeRemovedBefore(cuts) {
  const c = mergeRanges(cuts);
  const n = c.length;
  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (c[i][1] - c[i][0]);
  return function removedBefore(t) {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid][1] <= t) lo = mid + 1;
      else hi = mid;
    }
    let rem = prefix[lo];
    if (lo < n && c[lo][0] < t) rem += t - c[lo][0];
    return rem;
  };
}

/** Subtract merged cuts from [cs, ce): the kept sub-spans as [[start,end],...]. */
export function keepSpans(cs, ce, cuts) {
  const c = mergeRanges(cuts);
  const spans = [];
  let cur = cs;
  for (const [s, e] of c) {
    if (e <= cs) continue;
    if (s >= ce) break;
    if (s > cur) spans.push([cur, Math.min(s, ce)]);
    cur = Math.max(cur, Math.min(e, ce));
  }
  if (cur < ce) spans.push([cur, ce]);
  return spans;
}

/** Total ms covered by a list of ranges after merging. */
export function totalMs(ranges) {
  return mergeRanges(ranges).reduce((n, [s, e]) => n + (e - s), 0);
}

/** Clip a range to [lo, hi]; returns null when nothing remains. */
export function clipRange([s, e], lo, hi) {
  const a = Math.max(s, lo), b = Math.min(e, hi);
  return b > a ? [a, b] : null;
}
