// Loudness-based silence detection, ported verbatim from OpenCutAgent server/audio/silence.js
// (the detector, the threshold estimator and the pacing PRESETS), plus one Borumi helper at the
// bottom that turns `detect_speech activity:"silence"` ranges into the /borumi:silences preview.
//
// Detector inputs: a per-window dBFS loudness envelope (20 ms hop, peak per window clamped to
// -60 dB). Classify each window as speech ("loud") or silence, then derive the ranges to remove
// from the user's controls. PURE (no I/O), unit-tested in tests/silence.test.mjs.
//
// Controls (mirrors the AutoCut-style reference):
//  - thresholdDb        Noise Threshold: windows below this are silence.
//  - minSilenceSec      "Remove Silences Longer Than": only cut silences >= this.
//  - keepTalkSec        "Keep speech longer than": speech islands shorter than this
//                       are treated as silence, unconditionally (so noise spikes
//                       and sub-keepTalk chatter bursts don't split, and thus
//                       preserve, a long silence).
//  - marginBeforeSec    "Margin before by": air kept BEFORE the next speech.
//  - marginAfterSec     "Margin after by": air kept AFTER the previous speech.
//
// Each kept silence run is shrunk by marginAfter at its head and marginBefore at
// its tail; whatever is left in the middle is the silence that gets removed.
// Leading/trailing silence (clip head/tail) has no neighbouring speech on one
// side, so that side keeps no margin.

export const SILENCE_FLOOR_DB = -100;

// The envelope is peak-per-window CLAMPED to this floor. Nothing in the envelope
// is ever below it, so threshold = -60 means "detect nothing".
export const ENVELOPE_FLOOR_DB = -60;

// Defaults mirror the reference panel; keepTalk 400ms sits in AutoCut's
// recommended 300-500ms band. Demotion is UNCONDITIONAL on length (exact
// AutoCut/TimeBolt semantics): every loud island shorter than keepTalk is
// treated as silence, no matter its surroundings. This is what merges a long
// stretch of low-level chatter (each burst < keepTalk) into ONE solid block.
// An isolation-guarded variant (only demote when flanked by clean silence) was
// tried on 2026-07-03 and REJECTED: in dense chatter the bursts protect each
// other and the block shreds into hundreds of slivers. The accepted trade-off
// (shared by AutoCut/TimeBolt) is that a genuinely meaningful sub-keepTalk
// word in the middle of dead air can be eaten, which is why values > ~750ms
// are not recommended.
export const DEFAULT_SETTINGS = Object.freeze({
  thresholdDb: -36,
  minSilenceMs: 120,
  keepTalkMs: 400,
  marginBeforeMs: 120,
  marginAfterMs: 120,
});

// Pacing presets tune aggressiveness (NOT the threshold, which is content-driven).
// Relaxed = leave generous pauses; Rapid = tighten almost everything. keepTalk
// scales with minSilence: long kept pauses are easily split (and thus
// preserved) by one stray blip, so gentler presets demote harder.
export const PRESETS = Object.freeze({
  Relaxed: { minSilenceMs: 1000, keepTalkMs: 700, marginBeforeMs: 200, marginAfterMs: 200 },
  Natural: { minSilenceMs: 700, keepTalkMs: 600, marginBeforeMs: 170, marginAfterMs: 170 },
  Balanced: { minSilenceMs: 500, keepTalkMs: 500, marginBeforeMs: 150, marginAfterMs: 150 },
  Brisk: { minSilenceMs: 300, keepTalkMs: 450, marginBeforeMs: 120, marginAfterMs: 120 },
  Rapid: { minSilenceMs: 120, keepTalkMs: 400, marginBeforeMs: 80, marginAfterMs: 80 },
});

function settingsToSec(s = {}) {
  const g = (key, def) => (s[key] != null ? s[key] : def);
  return {
    thresholdDb: g("thresholdDb", DEFAULT_SETTINGS.thresholdDb),
    minSilenceSec: g("minSilenceMs", DEFAULT_SETTINGS.minSilenceMs) / 1000,
    keepTalkSec: g("keepTalkMs", DEFAULT_SETTINGS.keepTalkMs) / 1000,
    marginBeforeSec: g("marginBeforeMs", DEFAULT_SETTINGS.marginBeforeMs) / 1000,
    marginAfterSec: g("marginAfterMs", DEFAULT_SETTINGS.marginAfterMs) / 1000,
  };
}

/**
 * Detect removable silence ranges in a dBFS envelope.
 * @param {number[]} db      per-window loudness (dBFS), evenly spaced by hopSec.
 * @param {number} hopSec    seconds between windows.
 * @param {object} opts      settings (ms) + offsetSec (source time of db[0]).
 * @returns {{start:number,end:number,silenceStart:number,silenceEnd:number}[]}
 *          ranges in source seconds (absolute, including offsetSec).
 */
export function detectSilences(db, hopSec, opts = {}) {
  const n = db ? db.length : 0;
  if (!n || !(hopSec > 0)) return [];
  const { thresholdDb, minSilenceSec, keepTalkSec, marginBeforeSec, marginAfterSec } = settingsToSec(opts);
  const offsetSec = opts.offsetSec || 0;

  // 1. Classify each window: loud (speech) vs silent.
  const loud = new Uint8Array(n);
  for (let i = 0; i < n; i++) loud[i] = db[i] >= thresholdDb ? 1 : 0;

  // 2. Demote speech islands shorter than keepTalk to silence, UNCONDITIONALLY
  //    (exact AutoCut/TimeBolt semantics, see DEFAULT_SETTINGS note). This
  //    merges a run of sub-keepTalk chatter bursts into one solid silence.
  //    keepTalk=0 disables this.
  const keepTalkWin = keepTalkSec > 0 ? Math.max(1, Math.round(keepTalkSec / hopSec)) : 0;
  if (keepTalkWin > 1) {
    let i = 0;
    while (i < n) {
      if (!loud[i]) { i++; continue; }
      let j = i;
      while (j < n && loud[j]) j++;
      if (j - i < keepTalkWin) for (let k = i; k < j; k++) loud[k] = 0;
      i = j;
    }
  }

  // 3. Walk silent runs; keep those >= minSilence; shrink by the margins.
  const ranges = [];
  let i = 0;
  while (i < n) {
    if (loud[i]) { i++; continue; }
    let j = i;
    while (j < n && !loud[j]) j++;
    const runStart = offsetSec + i * hopSec;
    const runEnd = offsetSec + j * hopSec;
    if (runEnd - runStart >= minSilenceSec) {
      const isLeading = i === 0;
      const isTrailing = j === n;
      const start = runStart + (isLeading ? 0 : marginAfterSec);
      const end = runEnd - (isTrailing ? 0 : marginBeforeSec);
      if (end - start > 0.001) {
        ranges.push({ start, end, silenceStart: runStart, silenceEnd: runEnd });
      }
    }
    i = j;
  }
  return ranges;
}

function percentileSorted(sorted, p) {
  if (!sorted.length) return SILENCE_FLOOR_DB;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Estimate a sensible noise threshold from the envelope's level distribution.
 * SPEECH-ANCHORED: place the threshold a fixed drop below the speech level
 * (p90 - 30 dB on the peak-normalized meter), never closer than 10 dB to
 * speech, never below noise + 6 dB. The 30 dB drop leaves room for QUIET
 * passages (a speaker leaning back sits 15-25 dB under their normal level and
 * must stay above the threshold) and reproduces AutoCut's AI pick (-43) on the
 * reference recording. Windows on the envelope's -60 clamp are excluded so the
 * pile doesn't skew percentiles.
 */
export function estimateThreshold(db) {
  const vals = [];
  for (let i = 0; i < db.length; i++) {
    const v = db[i];
    if (isFinite(v) && v > ENVELOPE_FLOOR_DB + 0.5) vals.push(v);
  }
  if (!vals.length) return DEFAULT_SETTINGS.thresholdDb;
  vals.sort((a, b) => a - b);
  const noise = percentileSorted(vals, 0.15);
  const speech = percentileSorted(vals, 0.9);
  let th = Math.max(noise + 6, speech - 30);
  th = Math.min(th, speech - 10); // always leave headroom below speech
  th = Math.max(-55, Math.min(-20, th)); // stay off the slider ends (-60 = off)
  return Math.round(th);
}

/** Summary stats over a dBFS envelope, for the analyze step and AI reasoning. */
export function levelStats(db) {
  const vals = [];
  for (let i = 0; i < db.length; i++) if (isFinite(db[i])) vals.push(db[i]);
  if (!vals.length) {
    return { windows: 0, minDb: null, maxDb: null, medianDb: null, noiseFloorDb: null, speechDb: null, suggestedThresholdDb: DEFAULT_SETTINGS.thresholdDb };
  }
  vals.sort((a, b) => a - b);
  const r1 = (x) => Math.round(x * 10) / 10;
  const nonFloor = vals.filter((v) => v > ENVELOPE_FLOOR_DB + 0.5);
  const noiseSrc = nonFloor.length ? nonFloor : vals;
  return {
    windows: db.length,
    minDb: r1(vals[0]),
    maxDb: r1(vals[vals.length - 1]),
    medianDb: r1(percentileSorted(vals, 0.5)),
    noiseFloorDb: r1(percentileSorted(noiseSrc, 0.15)),
    speechDb: r1(percentileSorted(vals, 0.9)),
    suggestedThresholdDb: estimateThreshold(db),
  };
}

/** Total seconds across a range list. */
export function totalRemovedSeconds(ranges) {
  let t = 0;
  for (const r of ranges) t += Math.max(0, r.end - r.start);
  return Math.round(t * 1000) / 1000;
}

/* ---------- Borumi: detect_speech silence ranges -> the /borumi:silences preview ---------- */

/** /borumi:silences --pacing name -> {minMs, keepMs} from the upstream PRESETS (case-insensitive). */
export function pacingToMinKeep(name) {
  const key = Object.keys(PRESETS).find((k) => k.toLowerCase() === String(name || "").toLowerCase());
  if (!key) return null;
  const p = PRESETS[key];
  return { preset: key, minMs: p.minSilenceMs, keepMs: p.marginBeforeMs };
}

/**
 * Turn Borumi `detect_speech {activity:"silence"}` ranges (project ms, including the leading and
 * trailing edges) into the cut list and the one-line preview for /borumi:silences:
 *  - keep silences >= minMs;
 *  - shrink each by keepMs on both sides, except on a side that touches a scene edge or the
 *    range edge (there is no speech to protect there);
 *  - merge touching results.
 * @param {number[][]} ranges   [[start_ms,end_ms], ...] from detect_speech
 * @param {object} opts   {minMs=700, keepMs=150, rangeStart, rangeEnd, sceneEdges:number[]}
 * @returns {{count, totalMs, pct, longest, top5, ranges}}
 */
export function previewSilences(ranges, opts = {}) {
  const minMs = opts.minMs != null ? Number(opts.minMs) : 700;
  const keepMs = opts.keepMs != null ? Number(opts.keepMs) : 150;
  const clean = (ranges || [])
    .map((r) => (Array.isArray(r) ? [Number(r[0]), Number(r[1])] : [Number(r.start_ms), Number(r.end_ms)]))
    .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0])
    .sort((a, b) => a[0] - b[0]);
  const rangeStart = opts.rangeStart != null ? Number(opts.rangeStart) : (clean.length ? clean[0][0] : 0);
  const rangeEnd = opts.rangeEnd != null ? Number(opts.rangeEnd) : (clean.length ? clean[clean.length - 1][1] : 0);
  const edges = new Set([rangeStart, rangeEnd, ...(opts.sceneEdges || []).map(Number)]);
  const kept = [];
  for (const [s, e] of clean) {
    if (e - s < minMs) continue;
    const a = edges.has(s) ? s : s + keepMs;
    const b = edges.has(e) ? e : e - keepMs;
    if (b - a > 0) kept.push([a, b, s, e]);
  }
  // merge touching or overlapping
  const merged = [];
  for (const r of kept) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) { last[1] = Math.max(last[1], r[1]); last[3] = Math.max(last[3], r[3]); }
    else merged.push(r.slice());
  }
  const rows = merged.map(([a, b, s, e]) => ({ start_ms: a, end_ms: b, dur_ms: b - a, silence_ms: e - s }));
  const totalMs = rows.reduce((n, r) => n + r.dur_ms, 0);
  const span = Math.max(1, rangeEnd - rangeStart);
  const byLength = rows.slice().sort((x, y) => y.dur_ms - x.dur_ms);
  return {
    count: rows.length,
    totalMs,
    pct: Math.round((totalMs / span) * 1000) / 10,
    longest: byLength[0] || null,
    top5: byLength.slice(0, 5),
    ranges: rows.map((r) => [r.start_ms, r.end_ms]),
    minMs,
    keepMs,
  };
}
