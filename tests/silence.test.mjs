// scripts/lib/silence.mjs: the upstream server/test/silence.js checks (adapted to node:test) plus
// the Borumi detect_speech preview helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSilences, estimateThreshold, levelStats, totalRemovedSeconds, PRESETS, DEFAULT_SETTINGS, ENVELOPE_FLOOR_DB,
  previewSilences, pacingToMinKeep,
} from "../scripts/lib/silence.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const HOP = 0.02;
const LOUD = -20;
const SIL = -60; // the envelope floor

// Build an envelope from [seconds, dB] segments at 20 ms hop.
function env(segments) {
  const db = [];
  for (const [sec, level] of segments) {
    const n = Math.round(sec / HOP);
    for (let i = 0; i < n; i++) db.push(level);
  }
  return db;
}

const OPTS = { thresholdDb: -36, minSilenceMs: 120, keepTalkMs: 100, marginBeforeMs: 120, marginAfterMs: 120 };

test("interior silence shrunk by both margins", () => {
  const r = detectSilences(env([[1, LOUD], [1, SIL], [1, LOUD]]), HOP, OPTS);
  assert.equal(r.length, 1);
  assert.ok(approx(r[0].start, 1.12));
  assert.ok(approx(r[0].end, 1.88));
});

test("leading silence keeps no margin at the head", () => {
  const r = detectSilences(env([[1, SIL], [1, LOUD]]), HOP, OPTS);
  assert.ok(approx(r[0].start, 0));
  assert.ok(approx(r[0].end, 0.88));
});

test("trailing silence keeps no margin at the tail", () => {
  const r = detectSilences(env([[1, LOUD], [1, SIL]]), HOP, OPTS);
  assert.ok(approx(r[0].start, 1.12));
  assert.ok(approx(r[0].end, 2.0));
});

test("keepTalk merges a silence split by a brief blip (unconditional demotion)", () => {
  const split = env([[1, LOUD], [0.5, SIL], [0.04, LOUD], [0.46, SIL], [1, LOUD]]);
  const r = detectSilences(split, HOP, OPTS);
  assert.equal(r.length, 1);
  assert.ok(approx(r[0].start, 1.12) && approx(r[0].end, 1.88));
  assert.equal(detectSilences(split, HOP, { ...OPTS, keepTalkMs: 0 }).length, 2);
});

test("AutoCut semantics: sub-keepTalk chatter bursts merge into one solid silence", () => {
  const chatter = env([
    [1, LOUD], [0.3, SIL], [0.2, LOUD], [0.25, SIL], [0.3, LOUD], [0.2, SIL],
    [0.15, LOUD], [0.3, SIL], [0.25, LOUD], [0.35, SIL], [1, LOUD],
  ]);
  let r = detectSilences(chatter, HOP, { ...OPTS, keepTalkMs: 400 });
  assert.equal(r.length, 1);
  assert.ok(approx(r[0].start, 1.12) && r[0].silenceEnd > 3.25 && approx(r[0].end, r[0].silenceEnd - 0.12));
  const chatterWithWord = env([[1, LOUD], [0.5, SIL], [0.6, LOUD], [0.5, SIL], [1, LOUD]]);
  r = detectSilences(chatterWithWord, HOP, { ...OPTS, keepTalkMs: 400 });
  assert.equal(r.length, 2, "an island >= keepTalk survives and splits the silence");
  const headPop = env([[0.3, SIL], [0.2, LOUD], [1, SIL], [1, LOUD]]);
  r = detectSilences(headPop, HOP, { ...OPTS, keepTalkMs: 400 });
  assert.ok(r.length === 1 && approx(r[0].start, 0), "clip-head pop demoted, merges into leading silence");
});

test("silences shorter than minSilence are kept", () => {
  assert.equal(detectSilences(env([[1, LOUD], [0.08, SIL], [1, LOUD]]), HOP, OPTS).length, 0);
});

test("offset shifts ranges into absolute source seconds", () => {
  const r = detectSilences(env([[1, LOUD], [1, SIL], [1, LOUD]]), HOP, { ...OPTS, offsetSec: 10 });
  assert.ok(approx(r[0].start, 11.12) && approx(r[0].end, 11.88));
});

test("threshold estimate is speech-anchored and never lands on the floor", () => {
  const QUIET = -52;
  const bimodal = env([[10, QUIET], [10, LOUD]]);
  let th = estimateThreshold(bimodal);
  assert.ok(th > QUIET && th < LOUD);
  assert.ok(Math.abs(th - (QUIET + 6)) <= 2, "max(noise+6, speech-30) = -46");
  th = estimateThreshold(env([[30, ENVELOPE_FLOOR_DB], [10, LOUD]]));
  assert.ok(th >= -55 && th <= -20, "floor pile excluded");
  th = estimateThreshold(env([[10, -30], [10, -10]]));
  assert.ok(th <= -20 && th <= -10 - 8, "hot audio capped at -20 with headroom");
});

test("levelStats summary", () => {
  const st = levelStats(env([[10, -52], [10, LOUD]]));
  assert.ok(Math.abs(st.speechDb - LOUD) <= 2);
  assert.ok(Math.abs(st.noiseFloorDb - -52) <= 2);
  assert.ok(Number.isFinite(st.suggestedThresholdDb));
  assert.equal(levelStats([]).windows, 0);
});

test("totals over two interior silences", () => {
  const r = detectSilences(env([[1, LOUD], [1, SIL], [1, LOUD], [1, SIL], [1, LOUD]]), HOP, OPTS);
  assert.equal(r.length, 2);
  assert.ok(approx(totalRemovedSeconds(r), 1.52));
});

test("presets and defaults are well-formed", () => {
  assert.equal(DEFAULT_SETTINGS.thresholdDb, -36);
  assert.equal(DEFAULT_SETTINGS.keepTalkMs, 400);
  assert.equal(Object.keys(PRESETS).length, 5);
  assert.ok(PRESETS.Rapid.minSilenceMs < PRESETS.Relaxed.minSilenceMs);
  assert.ok(Object.values(PRESETS).every((p) => p.keepTalkMs >= 400));
  assert.ok(!("minGapMs" in DEFAULT_SETTINGS));
});

test("empty and degenerate inputs", () => {
  assert.equal(detectSilences([], HOP, OPTS).length, 0);
  assert.equal(detectSilences(env([[2, LOUD]]), HOP, OPTS).length, 0);
  assert.equal(detectSilences(env([[1, SIL]]), 0, OPTS).length, 0);
  assert.equal(detectSilences(env([[2, ENVELOPE_FLOOR_DB], [1, LOUD]]), HOP, { ...OPTS, thresholdDb: ENVELOPE_FLOOR_DB }).length, 0, "threshold at the floor = off");
});

/* ---------- Borumi helpers ---------- */

test("pacingToMinKeep maps the upstream presets (Relaxed 1000/200 ... Rapid 120/80)", () => {
  assert.deepEqual(pacingToMinKeep("relaxed"), { preset: "Relaxed", minMs: 1000, keepMs: 200 });
  assert.deepEqual(pacingToMinKeep("Rapid"), { preset: "Rapid", minMs: 120, keepMs: 80 });
  assert.equal(pacingToMinKeep("warp"), null);
});

test("previewSilences: min filter, keep shrink except on scene/range edges, merge, stats", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const silences = JSON.parse(readFileSync(join(here, "fixtures", "silences.json"), "utf8"));
  // fixture gaps are all under 700 ms except none; use a low min to exercise the shrink
  const p = previewSilences(silences.ranges, { minMs: 200, keepMs: 50, rangeStart: 0, rangeEnd: 20600 });
  // >= 200 ms: [3560,3820] only (260 ms); edges [0,100] and [20586,20600] are too short
  assert.equal(p.count, 1);
  assert.deepEqual(p.ranges, [[3610, 3770]]);
  assert.equal(p.totalMs, 160);
  assert.equal(p.longest.dur_ms, 160);
  assert.equal(p.top5.length, 1);
  // a leading silence touching the range start keeps its start edge
  const lead = previewSilences([[0, 1000], [5000, 6000]], { minMs: 500, keepMs: 150, rangeStart: 0, rangeEnd: 10000 });
  assert.deepEqual(lead.ranges, [[0, 850], [5150, 5850]]);
  assert.equal(lead.pct, 15.5);
  // a scene edge inside the range also keeps its side
  const scene = previewSilences([[4500, 5500]], { minMs: 500, keepMs: 100, rangeStart: 0, rangeEnd: 10000, sceneEdges: [5500] });
  assert.deepEqual(scene.ranges, [[4600, 5500]]);
  // touching results merge
  const merge = previewSilences([[1000, 2000], [2000, 3000]], { minMs: 500, keepMs: 0, rangeStart: 0, rangeEnd: 4000 });
  assert.deepEqual(merge.ranges, [[1000, 3000]]);
  assert.equal(previewSilences([], {}).count, 0);
});
