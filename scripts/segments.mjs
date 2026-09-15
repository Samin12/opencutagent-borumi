#!/usr/bin/env node
// Sentence-level segmentation for /borumi:retakes and "the part where I say ..." lookups.
//
// The segmentation rules are OpenCutAgent's server/transcription/segments.js ported verbatim
// (groupIntoCaptionChunks and its lexical rules), fed by a Borumi adapter: get_transcript words
// (project ms, punctuation and capitalisation kept) -> {type:"word", text, start, end} in project
// seconds. The review tiling (partitionRange, classifyFragments) is the upstream review.js logic
// with a scene range standing in for the Premiere clip. Cut planning keeps upstream cutplan.js's
// rule that a cut edge never sits on a raw word timestamp: it moves into the nearest detected
// silence gap (Borumi detect_speech) or falls back to the conservative 250 ms lead / 300 ms tail pads.
//
//   segments.mjs list --words words.json [--start-ms A --end-ms B] [--scenes scenes.json] [--out segments.json] [--json]
//       prints "[i] m:ss text ⟦cut: no speech⟧|⟦flag: very short⟧" lines (m:ss = PROJECT time)
//   segments.mjs plan --segments segments.json --decisions decisions.json [--silences silences.json]
//                     [--pad-lead-ms 250] [--pad-tail-ms 300] [--snap-ms 400] [--margin-ms 120] [--out ranges.json]
//       -> {ranges:[[a,b]], summary}   (project ms, for trim_timeline; runs never cross a scene boundary)
//   segments.mjs find --words words.json --phrase "..." [--blocks blocks.json] [--start-ms A --end-ms B]
//       -> {matches:[...], best, ambiguous}
//
// JSON goes to stdout, logs to stderr.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mmss, fmtDur } from "./lib/fmt.mjs";
import { flattenWords, flattenBlocks, sliceByRange, toScribeTokens, findPhrase, snapToBlocks } from "./lib/transcript.mjs";

/* ======================= upstream segments.js (verbatim rules) ======================= */

export const DEFAULT_FILLERS = [
  "um", "umm", "umh", "uh", "uhh", "uhm", "er", "err", "erm",
  "ah", "ahh", "hmm", "hm", "mm", "mmm", "mhm", "uh-huh", "huh",
];

function normalizeToken(text) {
  return String(text || "").toLowerCase().replace(/[^a-z'-]/g, "");
}

export function isFiller(text, fillerSet) {
  return fillerSet.has(normalizeToken(text));
}

// Keep only spoken content (drop "spacing"); keep audio events as tokens.
function contentTokens(words) {
  const out = [];
  for (const w of words) {
    const type = w.type || "word";
    if (type === "spacing") continue;
    if (w.start == null) continue;
    out.push({
      type,
      text: w.text || "",
      start: w.start,
      end: w.end != null ? w.end : w.start,
      speaker: w.speaker_id != null ? String(w.speaker_id) : null,
    });
  }
  return out;
}

/**
 * Group content tokens into phrases, breaking on a silence >= silenceThreshold
 * OR a speaker change. Returns [{ start, end, text, speaker }].
 */
export function groupIntoPhrases(words, silenceThreshold = 0.5) {
  return groupTokens(words, { gapSec: silenceThreshold });
}

// A sentence ends on . ! ? or … (closing quotes/brackets allowed after).
const SENTENCE_END_RE = /[.!?…]["'”’)\]]*$/;

// A token that trails off mid-word: the STT writes the abandoned word with a
// trailing dash ("compar--", "significan-", "It--"). That is the speaker
// restarting, so the take that was abandoned ends right there.
const CUTOFF_RE = /[-\u2013\u2014]+$/;
export function isCutoffToken(text) {
  const t = String(text || "").trim();
  return t.length > 1 && CUTOFF_RE.test(t);
}

// Words that are capitalised ONLY at the start of a sentence. An STT often
// capitalises a new sentence without closing the previous one ("with this
// price And by the way"), so a capitalised starter after an unpunctuated word
// is a sentence boundary. Proper nouns are not on this list, and neither is
// "I" (always capitalised), so "talk about Muse Spark" and "and I think" stay whole.
const SENTENCE_STARTERS = new Set([
  "and", "but", "so", "now", "then", "okay", "ok", "also", "because", "if", "when", "while", "after", "before",
  "this", "that", "these", "those", "here", "there", "what", "which", "why", "how", "where", "who",
  "we", "we're", "we'll", "you", "you're", "you'll", "it", "it's", "it'll", "they", "they're", "he", "she",
  "the", "a", "an", "yes", "no", "well", "anyway", "basically", "actually", "alright", "right",
  "first", "second", "next", "finally", "let's", "let", "look", "remember", "notice", "again", "another",
  "for", "in", "on", "at", "with", "from", "to", "by", "of", "as", "or", "not", "just", "maybe", "of", "one",
]);
const wordKey = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9']/g, "");
const hasTerminalPunct = (text) => SENTENCE_END_RE.test(String(text || "").trim()) || /[,;:]$/.test(String(text || "").trim());

/**
 * Sentence-level grouping (the Retakes segmentation): ONE SEGMENT PER
 * SENTENCE, split as finely as the transcript allows so every restart can be
 * reviewed and removed on its own. Breaks on pauses and speaker changes like
 * groupIntoPhrases, plus:
 *  - sentence-ending punctuation (once the chunk holds >= minWords);
 *  - a CUT-OFF word (trailing dash: the speaker abandoned the line);
 *  - an IMMEDIATE REPEAT: the next 2..6 words re-say the chunk's last 2..6
 *    words ("let's talk about, let's talk about"), a restart with no dash
 *    and no pause, so the new attempt starts a new segment;
 *  - a capitalised sentence starter after a word with no punctuation
 *    ("with this price And by the way");
 *  - audio events ("[clears throat]") stand ALONE as word-empty segments, so
 *    they are auto-cut instead of riding inside a kept sentence.
 * maxWords is only a safety cap that splits punctuation-less run-on speech.
 * Exact word timings per chunk.
 */
export function groupIntoCaptionChunks(words, opts = {}) {
  return groupTokens(words, {
    gapSec: opts.gapSec != null ? opts.gapSec : 0.5,
    maxWords: opts.maxWords != null ? opts.maxWords : 24,
    minWords: opts.minWords != null ? opts.minWords : 2,
    sentenceBreak: true,
    cutoffBreak: opts.cutoffBreak !== false,
    repeatBreak: opts.repeatBreak !== false,
    starterBreak: opts.starterBreak !== false,
    eventsAlone: opts.eventsAlone !== false,
  });
}

function groupTokens(words, { gapSec = 0.5, maxWords = 0, minWords = 3, sentenceBreak = false, cutoffBreak = false, repeatBreak = false, starterBreak = false, eventsAlone = false } = {}) {
  const toks = contentTokens(words);
  // Word tokens only (events skipped) with their positions, for the repeat lookahead.
  const wordIdx = [];
  for (let i = 0; i < toks.length; i++) if (toks[i].type !== "audio_event") wordIdx.push(i);
  const wordPos = new Map(wordIdx.map((ti, wi) => [ti, wi]));
  // Does the run of k words starting at token i re-say the k words just before it?
  const repeatsBefore = (i) => {
    const wi = wordPos.get(i);
    if (wi == null) return false;
    for (let k = 2; k <= 6; k++) {
      if (wi - k < 0 || wi + k > wordIdx.length) break;
      let same = true;
      for (let j = 0; j < k && same; j++) same = wordKey(toks[wordIdx[wi - k + j]].text) === wordKey(toks[wordIdx[wi + j]].text);
      if (same) return k;
    }
    return 0;
  };
  const phrases = [];
  let cur = [];
  let curStart = null;
  let curSpeaker = null;
  let curWords = 0; // type==="word" tokens in cur (mirrors flush's wordCount)
  let prevEnd = null;

  const flush = () => {
    if (!cur.length) return;
    const parts = [];
    let wordCount = 0; // type==="word" tokens only; audio events (pops/breaths) don't count
    for (const t of cur) {
      let raw = (t.text || "").trim();
      if (!raw) continue;
      if (t.type === "audio_event") {
        if (!/^[(\[]/.test(raw)) raw = `(${raw})`; // the STT writes "[clears throat]"; keep its brackets
      } else {
        wordCount += 1;
      }
      parts.push(raw);
    }
    if (parts.length) {
      let text = parts.join(" ")
        .replace(/ ,/g, ",").replace(/ \./g, ".").replace(/ \?/g, "?").replace(/ !/g, "!");
      phrases.push({ start: curStart, end: cur[cur.length - 1].end, text, speaker: curSpeaker, wordCount });
    }
    cur = [];
    curStart = null;
    curSpeaker = null;
    curWords = 0;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const isEvent = t.type === "audio_event";
    if (curSpeaker != null && t.speaker != null && t.speaker !== curSpeaker) flush();
    if (prevEnd != null && t.start - prevEnd >= gapSec) flush();
    if (eventsAlone && isEvent) flush(); // a sound never joins the sentence before it
    else if (!isEvent && cur.length && curWords > 0) {
      const lastWord = [...cur].reverse().find((x) => x.type !== "audio_event");
      // A restart: the words from here re-say the chunk's last words. Only whole
      // multi-word runs count, so a stutter ("the the") does not split.
      const rep = repeatBreak ? repeatsBefore(i) : 0;
      if (rep && curWords >= rep) flush();
      else if (starterBreak && curWords >= minWords && lastWord && !hasTerminalPunct(lastWord.text) && /^[A-Z]/.test(String(t.text || "").trim()) && SENTENCE_STARTERS.has(wordKey(t.text))) flush();
    }
    if (curStart == null) {
      curStart = t.start;
      curSpeaker = t.speaker;
    }
    cur.push(t);
    if (!isEvent) curWords += 1;
    prevEnd = t.end;
    if (eventsAlone && isEvent) { flush(); continue; }
    // Caption-mode breaks close AFTER the word that triggers them, so the
    // punctuation (or the cap-hitting word) stays in its own chunk.
    if (cutoffBreak && !isEvent && isCutoffToken(t.text)) flush(); // an abandoned word ends its take, however short
    else if (sentenceBreak && curWords >= minWords && t.type !== "audio_event" && SENTENCE_END_RE.test((t.text || "").trim())) flush();
    else if (maxWords > 0 && curWords >= maxWords) flush();
  }
  flush();
  return phrases;
}

/**
 * Words whose midpoint falls inside a window [inSec, outSec], i.e. the words actually audible
 * within ONE range. Using the midpoint assigns every word to exactly one range, so phrases built
 * from a slice never straddle a cut. Keeps the original token shape.
 */
export function sliceWordsToWindow(words, inSec, outSec) {
  const out = [];
  for (const w of words || []) {
    if (w.start == null) continue;
    const end = w.end != null ? w.end : w.start;
    const mid = (w.start + end) / 2;
    if (mid >= inSec && mid <= outSec) out.push(w);
  }
  return out;
}

/**
 * Silent gaps between consecutive content tokens, in seconds (upstream detectSilences, renamed so
 * it cannot be confused with the loudness detector in lib/silence.mjs). Returns [{start,end,duration}].
 */
export function detectTranscriptGaps(words, minSilenceSec = 0.4) {
  const toks = contentTokens(words);
  const gaps = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const gapStart = toks[i].end;
    const gapEnd = toks[i + 1].start;
    const dur = gapEnd - gapStart;
    if (dur >= minSilenceSec) gaps.push({ start: gapStart, end: gapEnd, duration: dur });
  }
  return gaps;
}

/** Filler tokens, in seconds. Returns [{ start, end, text }]. */
export function detectFillers(words, { fillers = DEFAULT_FILLERS } = {}) {
  const set = new Set(fillers.map(normalizeToken));
  const toks = contentTokens(words);
  const out = [];
  for (const t of toks) {
    if (t.type === "audio_event") continue;
    if (isFiller(t.text, set)) out.push({ start: t.start, end: t.end, text: t.text.trim() });
  }
  return out;
}

/* ======================= upstream review.js pieces (scene range = clip) ======================= */

// Segments shorter than this that DO contain speech are flagged (not auto-cut):
// they may be a real short word ("Yes.") or a clipped false start.
export const MIN_FRAGMENT_SEC = 0.5;

/**
 * Split one range into contiguous segments that exactly tile [inSec, outSec]: boundaries fall at
 * phrase starts and the edges are snapped to the range, so cutting any subset never leaves a
 * silent sliver. A word-empty range still yields one cuttable "(no speech)" segment.
 */
export function partitionRange(inSec, outSec, phrases) {
  if (!phrases.length) {
    return [{ start: inSec, end: outSec, text: "(no speech)", speaker: null, wordCount: 0, speechStart: null, speechEnd: null }];
  }
  const parts = [];
  for (let i = 0; i < phrases.length; i++) {
    const start = i === 0 ? inSec : phrases[i].start;
    const end = i === phrases.length - 1 ? outSec : phrases[i + 1].start;
    parts.push({
      start,
      end,
      text: phrases[i].text,
      speaker: phrases[i].speaker,
      wordCount: phrases[i].wordCount || 0,
      speechStart: Math.max(start, phrases[i].start),
      speechEnd: Math.min(end, phrases[i].end),
    });
  }
  return parts;
}

/**
 * Tag and (optionally) pre-mark fragment segments:
 *  - "empty" (no recognized words: a pop/breath/noise): auto-marked Cut.
 *  - "short" (has speech but under MIN_FRAGMENT_SEC): flagged for review only.
 */
export function classifyFragments(segments, opts = {}) {
  const autoCutEmpty = opts.autoCutEmpty !== false;
  const flagShort = opts.flagShort !== false;
  const minFragSec = opts.minFragmentSec || MIN_FRAGMENT_SEC;
  let autoCut = 0;
  let flagged = 0;
  for (const s of segments) {
    if (s.wordCount === 0) {
      s.fragment = "empty";
      if (autoCutEmpty) {
        s.decision = "cut";
        s.reason = "no speech (pop / breath / noise)";
        autoCut += 1;
      }
    } else if (flagShort && s.durationSec < minFragSec) {
      s.fragment = "short";
      s.reason = s.reason || `very short (${fmtDur(s.durationSec)}), possible false start`;
      flagged += 1;
    }
  }
  return { autoCut, flagged };
}

/** Transcript gaps >= 0.15 s inside a tile (plus head/tail gaps), seconds, for the review table. */
export function transcriptPauses(words, inSec, outSec, atHead = false) {
  const toks = [];
  for (const w of words || []) {
    if (w.start == null || (w.type || "word") === "spacing") continue;
    const end = w.end != null ? w.end : w.start;
    const mid = (w.start + end) / 2;
    if (mid >= inSec && mid <= outSec) toks.push({ start: w.start, end });
  }
  toks.sort((a, b) => a.start - b.start);
  const out = [];
  const add = (g) => { if (g >= 0.15) out.push(Math.round(g * 100) / 100); };
  if (!toks.length) { if (atHead) add(outSec - inSec); return out; }
  if (atHead) add(toks[0].start - inSec);
  for (let i = 1; i < toks.length; i++) add(toks[i].start - toks[i - 1].end);
  add(outSec - toks[toks.length - 1].end);
  return out;
}

/* ======================= Borumi: words -> review segments ======================= */

const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Build the indexed review segments for a Borumi words response.
 * @param {object} wordsJson  get_transcript mode:"words" response
 * @param {object} opts {startMs, endMs, scenes:[{id,start_ms,end_ms}], maxWords, gapSec}
 * @returns {{segments:Array, autoCut:number, flagged:number, range:{start_ms,end_ms}}}
 * Segments: {index, scene_id, start_ms, end_ms, speech_start_ms, speech_end_ms, text, wordCount,
 *            durationSec, pauses, fragment, decision, reason, group, protected, manual}
 * Tiles never cross a scene boundary: each scene inside the range is tiled on its own.
 */
export function buildSegments(wordsJson, opts = {}) {
  const all = flattenWords(wordsJson);
  const rr = (wordsJson && wordsJson.range) || {};
  const startMs = opts.startMs != null ? Number(opts.startMs) : (rr.start_ms != null ? Number(rr.start_ms) : (all.length ? all[0].start_ms : 0));
  const endMs = opts.endMs != null ? Number(opts.endMs) : (rr.end_ms != null ? Number(rr.end_ms) : (all.length ? all[all.length - 1].end_ms : 0));
  const tiles = [];
  const scenes = (opts.scenes || []).filter((s) => s.end_ms > startMs && s.start_ms < endMs).sort((a, b) => a.start_ms - b.start_ms);
  if (scenes.length) {
    for (const s of scenes) tiles.push({ scene_id: s.id || null, start_ms: Math.max(startMs, s.start_ms), end_ms: Math.min(endMs, s.end_ms) });
  } else {
    tiles.push({ scene_id: all.length ? all[0].scene_id : null, start_ms: startMs, end_ms: endMs });
  }
  const segments = [];
  for (const tile of tiles) {
    const items = sliceByRange(all, tile.start_ms, tile.end_ms);
    const toks = toScribeTokens(items, 0);
    const phrases = groupIntoCaptionChunks(toks, { maxWords: opts.maxWords, gapSec: opts.gapSec });
    const parts = partitionRange(tile.start_ms / 1000, tile.end_ms / 1000, phrases);
    parts.forEach((p, i) => {
      const s = Math.round(p.start * 1000), e = Math.round(p.end * 1000);
      if (e - s < 1) return;
      segments.push({
        index: -1,
        scene_id: tile.scene_id || (items[0] && items[0].scene_id) || null,
        start_ms: s,
        end_ms: e,
        speech_start_ms: p.speechStart != null ? Math.round(p.speechStart * 1000) : null,
        speech_end_ms: p.speechEnd != null ? Math.round(p.speechEnd * 1000) : null,
        text: p.text,
        wordCount: p.wordCount,
        durationSec: r3((e - s) / 1000),
        pauses: transcriptPauses(toks, p.start, p.end, i === 0),
        fragment: null,
        decision: "keep",
        reason: null,
        group: null,
        protected: false,
        manual: false,
      });
    });
  }
  segments.sort((a, b) => a.start_ms - b.start_ms);
  segments.forEach((s, i) => { s.index = i; });
  const { autoCut, flagged } = classifyFragments(segments);
  return { segments, autoCut, flagged, range: { start_ms: startMs, end_ms: endMs } };
}

/** The exact upstream list format: "[i] m:ss text" + " ⟦cut: no speech⟧" | " ⟦flag: very short⟧". */
export function formatSegmentLines(segments) {
  return (segments || []).map((s) => {
    const tag = s.fragment === "empty" ? " ⟦cut: no speech⟧" : s.fragment === "short" ? " ⟦flag: very short⟧" : "";
    return `[${s.index}] ${mmss(s.start_ms / 1000)} ${s.text}${tag}`;
  });
}

/** Apply [{index, decision, group?, reason?}] onto segments (protected untouched). Returns counts. */
export function applyDecisions(segments, decisions) {
  const list = Array.isArray(decisions) ? decisions : (decisions && decisions.decisions) || [];
  const byIndex = new Map((segments || []).map((s) => [s.index, s]));
  let applied = 0, unknown = 0;
  for (const d of list) {
    const s = byIndex.get(Number(d.index));
    if (!s) { unknown++; continue; }
    if (s.protected) continue;
    if (d.decision !== "keep" && d.decision !== "cut") continue;
    s.decision = d.decision;
    s.manual = false;
    if (Number.isInteger(d.group)) s.group = d.group;
    if (typeof d.reason === "string") s.reason = d.reason;
    applied++;
  }
  return { applied, unknown };
}

export const FALLBACK_LEAD_MS = 250;   // no silence gap: cut ends this far before the kept word (STT onset lag p90)
export const FALLBACK_TAIL_MS = 300;   // no silence gap: cut starts this far after the kept word (STT end earliness p90)
export const DEFAULT_SNAP_MS = 400;    // a detected gap this close to the tile boundary is "the" gap
export const DEFAULT_MARGIN_MS = 120;  // air kept on the kept side inside a detected gap

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hasSpeech = (s) => s && s.speech_start_ms != null && s.speech_end_ms != null;

/** The detected silence gap nearest to `t` (distance 0 when it contains t) within snapMs, else null. */
export function nearestGap(gaps, t, snapMs) {
  let best = null, bestD = Infinity;
  for (const g of gaps || []) {
    const d = t < g[0] ? g[0] - t : t > g[1] ? t - g[1] : 0;
    if (d <= snapMs && d < bestD) { best = g; bestD = d; }
  }
  return best;
}

/**
 * Cut ranges (project ms) from decisions: each maximal run of consecutive Cut tiles inside one
 * scene becomes one span; an edge next to a KEPT spoken tile moves off the tile boundary into the
 * nearest detected silence gap (keeping marginMs of air on the kept side) or, with no gap within
 * snapMs, to the padded word timestamp. Edges next to a protected, empty or missing neighbour
 * (scene edge) stay on the tile boundary. Touching spans merge; spans under 5 ms are dropped.
 * @param {Array} segments   from buildSegments (decisions already applied)
 * @param {object} opts {silences:[[a,b]] project ms, padLeadMs, padTailMs, snapMs, marginMs}
 */
export function planCutRanges(segments, opts = {}) {
  const padLead = opts.padLeadMs != null ? Number(opts.padLeadMs) : FALLBACK_LEAD_MS;
  const padTail = opts.padTailMs != null ? Number(opts.padTailMs) : FALLBACK_TAIL_MS;
  const snapMs = opts.snapMs != null ? Number(opts.snapMs) : DEFAULT_SNAP_MS;
  const marginMs = opts.marginMs != null ? Number(opts.marginMs) : DEFAULT_MARGIN_MS;
  const gaps = (opts.silences || [])
    .map((g) => (Array.isArray(g) ? [Number(g[0]), Number(g[1])] : [Number(g.start_ms), Number(g.end_ms)]))
    .filter((g) => Number.isFinite(g[0]) && Number.isFinite(g[1]) && g[1] > g[0])
    .sort((a, b) => a[0] - b[0]);
  const segs = (segments || []).slice().sort((a, b) => a.start_ms - b.start_ms);
  const isCut = (s) => s.decision === "cut" && !s.protected;
  const spans = [];
  const edges = { snapped: 0, padded: 0, boundary: 0 };
  let cutTiles = 0;
  let i = 0;
  while (i < segs.length) {
    if (!isCut(segs[i])) { i++; continue; }
    let j = i;
    while (j + 1 < segs.length && isCut(segs[j + 1]) && segs[j + 1].scene_id === segs[i].scene_id && segs[j + 1].start_ms === segs[j].end_ms) j++;
    const run = segs.slice(i, j + 1);
    cutTiles += run.length;
    const L = i > 0 && segs[i - 1].scene_id === run[0].scene_id && segs[i - 1].end_ms === run[0].start_ms ? segs[i - 1] : null;
    const R = j + 1 < segs.length && segs[j + 1].scene_id === run[0].scene_id && segs[j + 1].start_ms === run[run.length - 1].end_ms ? segs[j + 1] : null;
    let start = run[0].start_ms;
    let end = run[run.length - 1].end_ms;
    const firstSound = run.find(hasSpeech);
    const lastSound = run.slice().reverse().find(hasSpeech);
    if (L && !L.protected && hasSpeech(L)) {
      const nextSound = firstSound ? firstSound.speech_start_ms : end;
      const g = nearestGap(gaps, start, snapMs);
      if (g) { start = clamp(Math.min(g[1], g[0] + marginMs), L.speech_end_ms, end); edges.snapped++; }
      else { start = clamp(Math.min(nextSound, L.speech_end_ms + padTail), L.speech_end_ms, end); edges.padded++; }
    } else edges.boundary++;
    if (R && !R.protected && hasSpeech(R)) {
      const prevSound = lastSound ? lastSound.speech_end_ms : start;
      const g = nearestGap(gaps, end, snapMs);
      if (g) { end = clamp(Math.max(g[0], g[1] - marginMs), start, R.speech_start_ms); edges.snapped++; }
      else { end = clamp(Math.max(prevSound, R.speech_start_ms - padLead), start, R.speech_start_ms); edges.padded++; }
    } else edges.boundary++;
    if (end - start >= 5) spans.push({ start, end, indexes: run.map((s) => s.index), scene_id: run[0].scene_id });
    i = j + 1;
  }
  // merge touching spans
  spans.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) { last.end = Math.max(last.end, s.end); last.indexes.push(...s.indexes); }
    else merged.push({ ...s, indexes: s.indexes.slice() });
  }
  const removedMs = merged.reduce((n, s) => n + (s.end - s.start), 0);
  return {
    ranges: merged.map((s) => [s.start, s.end]),
    spans: merged,
    summary: {
      cutTiles,
      keptTiles: segs.filter((s) => !isCut(s)).length,
      runs: spans.length,
      ranges: merged.length,
      removedMs,
      removed: fmtDur(removedMs / 1000),
      edges,
      silencesUsed: gaps.length,
      padLeadMs: padLead,
      padTailMs: padTail,
      snapMs,
      marginMs,
    },
  };
}

/**
 * "The part where I say ...": word-level matches in a words response, each widened to the
 * enclosing block boundaries when a blocks response is given.
 */
export function findSaying(wordsJson, phrase, blocksJson = null, range = {}) {
  let words = flattenWords(wordsJson);
  if (range.startMs != null || range.endMs != null) {
    words = sliceByRange(words, range.startMs != null ? range.startMs : -Infinity, range.endMs != null ? range.endMs : Infinity);
  }
  const blocks = blocksJson ? flattenBlocks(blocksJson) : null;
  const matches = findPhrase(words, phrase).map((m) => {
    const snapped = blocks ? snapToBlocks(m, blocks) : null;
    return { start_ms: m.start_ms, end_ms: m.end_ms, text: m.text, snapped, range: snapped ? [snapped.start_ms, snapped.end_ms] : [m.start_ms, m.end_ms] };
  });
  return { phrase, matches, best: matches.length ? 0 : null, ambiguous: matches.length > 1 };
}

/* ======================= CLI ======================= */

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

function main(argv) {
  const { cmd, opts } = parseArgv(argv);
  if (cmd === "list") {
    if (!opts.words) throw new Error("list needs --words <get_transcript words json>");
    const scenes = opts.scenes ? (readJson(opts.scenes).scenes || readJson(opts.scenes)) : [];
    const built = buildSegments(readJson(opts.words), {
      startMs: opts["start-ms"] != null ? Number(opts["start-ms"]) : undefined,
      endMs: opts["end-ms"] != null ? Number(opts["end-ms"]) : undefined,
      scenes,
      maxWords: opts["max-words"] != null ? Number(opts["max-words"]) : undefined,
    });
    if (opts.out) writeFileSync(opts.out, JSON.stringify({ ...built, source: opts.words }, null, 2));
    if (opts.json) console.log(JSON.stringify({ count: built.segments.length, pre_marked_cut: built.autoCut, flagged_short: built.flagged, range: built.range, out: opts.out || null, lines: formatSegmentLines(built.segments) }, null, 2));
    else {
      for (const line of formatSegmentLines(built.segments)) console.log(line);
      console.error(`${built.segments.length} segments (${built.autoCut} pre-marked cut, ${built.flagged} flagged short)${opts.out ? `, written to ${opts.out}` : ""}`);
    }
    return;
  }
  if (cmd === "plan") {
    if (!opts.segments || !opts.decisions) throw new Error("plan needs --segments <segments.json> --decisions <decisions.json>");
    const segFile = readJson(opts.segments);
    const segments = Array.isArray(segFile) ? segFile : segFile.segments;
    const dec = readJson(opts.decisions);
    const { applied, unknown } = applyDecisions(segments, dec);
    const silences = opts.silences ? (readJson(opts.silences).ranges || readJson(opts.silences)) : [];
    const plan = planCutRanges(segments, {
      silences,
      padLeadMs: opts["pad-lead-ms"] != null ? Number(opts["pad-lead-ms"]) : undefined,
      padTailMs: opts["pad-tail-ms"] != null ? Number(opts["pad-tail-ms"]) : undefined,
      snapMs: opts["snap-ms"] != null ? Number(opts["snap-ms"]) : undefined,
      marginMs: opts["margin-ms"] != null ? Number(opts["margin-ms"]) : undefined,
    });
    const out = { ranges: plan.ranges, spans: plan.spans, summary: { ...plan.summary, decisionsApplied: applied, decisionsUnknown: unknown } };
    if (opts.out) writeFileSync(opts.out, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (cmd === "find") {
    if (!opts.words || !opts.phrase) throw new Error('find needs --words <words json> --phrase "..."');
    const res = findSaying(readJson(opts.words), String(opts.phrase), opts.blocks ? readJson(opts.blocks) : null, {
      startMs: opts["start-ms"] != null ? Number(opts["start-ms"]) : undefined,
      endMs: opts["end-ms"] != null ? Number(opts["end-ms"]) : undefined,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  throw new Error("usage: segments.mjs list|plan|find ... (see the header comment)");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`segments.mjs: ${e.message}`);
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
