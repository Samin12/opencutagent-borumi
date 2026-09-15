// scripts/segments.mjs: the upstream segmentation rules (ported checks from server/test/retakeSegments.js),
// the Borumi adapter, the list format, cut planning with detect_speech gaps, and "the part where I say".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  groupIntoPhrases, groupIntoCaptionChunks, sliceWordsToWindow, isCutoffToken, detectTranscriptGaps, detectFillers,
  partitionRange, classifyFragments, transcriptPauses, buildSegments, formatSegmentLines, applyDecisions,
  planCutRanges, nearestGap, findSaying, FALLBACK_LEAD_MS, FALLBACK_TAIL_MS,
} from "../scripts/segments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const WORDS_JSON = fixture("transcript-words.json");
const BLOCKS_JSON = fixture("transcript-blocks.json");
const SILENCES = fixture("silences.json");
const SCENES = fixture("scenes.json").scenes;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const word = (text, start, end) => ({ type: "word", text, start, end, speaker_id: "speaker_0" });

// A small transcript: a false start, then the full take, then a pop event.
const WORDS = [
  word("NAN", 1.0, 1.3), word("now", 1.3, 1.5), word("has", 1.5, 1.7),
  word("NAN", 2.6, 2.9), word("now", 2.9, 3.1), word("has", 3.1, 3.3), word("a", 3.3, 3.4), word("set", 3.4, 3.7),
  { type: "audio_event", text: "lips smacking", start: 5.0, end: 5.4 },
];

/* ---------- upstream rules, verbatim behaviour ---------- */

test("sliceWordsToWindow assigns each word to exactly one window (midpoint rule)", () => {
  assert.equal(sliceWordsToWindow(WORDS, 0.8, 2.0).filter((w) => w.type === "word").map((w) => w.text).join(" "), "NAN now has");
  assert.equal(sliceWordsToWindow(WORDS, 2.4, 3.9).filter((w) => w.type === "word").map((w) => w.text).join(" "), "NAN now has a set");
});

test("groupIntoPhrases: audio events contribute 0 words", () => {
  const ph = groupIntoPhrases(sliceWordsToWindow(WORDS, 4.5, 6.0), 0.5);
  assert.equal(ph.length, 1);
  assert.equal(ph[0].wordCount, 0);
});

test("partitionRange tiles the range with no gaps; empty range -> (no speech)", () => {
  const parts = partitionRange(0.5, 4.0, groupIntoPhrases(sliceWordsToWindow(WORDS, 0.5, 4.0), 0.5));
  assert.equal(parts.length, 2);
  assert.ok(approx(parts[0].start, 0.5) && approx(parts[parts.length - 1].end, 4.0));
  for (let i = 1; i < parts.length; i++) assert.ok(approx(parts[i].start, parts[i - 1].end));
  const empty = partitionRange(7.0, 8.0, []);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].text, "(no speech)");
  assert.equal(empty[0].wordCount, 0);
});

test("classifyFragments: empty auto-cut, short flagged, normal untouched, opts respected", () => {
  const segs = [
    { wordCount: 0, durationSec: 0.6, decision: "keep", fragment: null, reason: null },
    { wordCount: 1, durationSec: 0.3, decision: "keep", fragment: null, reason: null },
    { wordCount: 6, durationSec: 2.0, decision: "keep", fragment: null, reason: null },
  ];
  const frag = classifyFragments(segs);
  assert.ok(segs[0].decision === "cut" && segs[0].fragment === "empty");
  assert.ok(segs[1].decision === "keep" && segs[1].fragment === "short");
  assert.ok(segs[2].decision === "keep" && segs[2].fragment === null);
  assert.deepEqual(frag, { autoCut: 1, flagged: 1 });
  const segs2 = [{ wordCount: 0, durationSec: 0.6, decision: "keep", fragment: null, reason: null }];
  classifyFragments(segs2, { autoCutEmpty: false });
  assert.ok(segs2[0].fragment === "empty" && segs2[0].decision === "keep");
});

test("caption chunks: a cut-off word splits the restart from the full take", () => {
  const restart = [word("n8n", 0, 0.2), word("now", 0.25, 0.4), word("has--", 0.45, 0.6), word("n8n", 0.7, 0.9), word("now", 0.95, 1.1), word("has", 1.15, 1.3), word("a", 1.35, 1.4), word("set", 1.45, 1.7), word("of", 1.75, 1.85), word("skills.", 1.9, 2.3)];
  const rs = groupIntoCaptionChunks(restart, {});
  assert.deepEqual(rs.map((c) => c.text), ["n8n now has--", "n8n now has a set of skills."]);
  assert.equal(groupIntoCaptionChunks([word("It--", 0, 0.2), word("It", 0.3, 0.4), word("works.", 0.5, 0.8)], {}).length, 2);
  assert.ok(isCutoffToken("compar--") && isCutoffToken("co-") && isCutoffToken("time\u2014") && !isCutoffToken("well-known") && !isCutoffToken("-"));
  assert.equal(groupIntoCaptionChunks(restart, { cutoffBreak: false, repeatBreak: false }).length, 1);
});

test("caption chunks: an immediate repeat starts a new segment; a stutter does not", () => {
  const rep = [word("let's", 0, 0.2), word("talk,", 0.25, 0.5), word("let's", 0.55, 0.7), word("talk", 0.75, 0.9), word("about", 0.95, 1.1), word("Muse.", 1.15, 1.5)];
  assert.deepEqual(groupIntoCaptionChunks(rep, {}).map((c) => c.text), ["let's talk,", "let's talk about Muse."]);
  const three = [word("in", 0, 0.1), word("August", 0.15, 0.4), word("5th,", 0.45, 0.7), word("in", 0.8, 0.9), word("August", 0.95, 1.2), word("5th,", 1.25, 1.5), word("we", 1.55, 1.7), word("saw", 1.75, 1.9), word("it.", 1.95, 2.2)];
  assert.equal(groupIntoCaptionChunks(three, {})[0].text, "in August 5th,");
  const stutter = [word("the", 0, 0.1), word("the", 0.15, 0.25), word("model", 0.3, 0.6), word("works.", 0.65, 0.9)];
  assert.equal(groupIntoCaptionChunks(stutter, {}).length, 1);
  assert.equal(groupIntoCaptionChunks(rep, { repeatBreak: false }).length, 1);
});

test("caption chunks: capitalised starter after no punctuation splits; proper nouns, 'I' and commas do not", () => {
  const join_ = [word("with", 0, 0.2), word("this", 0.25, 0.4), word("price", 0.45, 0.8), word("And", 0.9, 1.0), word("by", 1.05, 1.2), word("the", 1.25, 1.3), word("way.", 1.35, 1.6)];
  assert.deepEqual(groupIntoCaptionChunks(join_, {}).map((c) => c.text), ["with this price", "And by the way."]);
  const noun = [word("talk", 0, 0.2), word("about", 0.25, 0.4), word("Muse", 0.45, 0.7), word("Spark", 0.75, 1.0), word("and", 1.05, 1.1), word("I", 1.15, 1.2), word("think.", 1.25, 1.6)];
  assert.equal(groupIntoCaptionChunks(noun, {}).length, 1);
  const comma = [word("with", 0, 0.2), word("this,", 0.25, 0.4), word("And", 0.5, 0.6), word("more.", 0.65, 0.9)];
  assert.equal(groupIntoCaptionChunks(comma, {}).length, 1);
});

test("caption chunks: audio events stand alone as word-empty chunks", () => {
  const ev = [word("Fine.", 0, 0.3), { type: "audio_event", text: "[clears throat]", start: 0.4, end: 0.9 }, word("Next", 1.0, 1.2), word("point.", 1.25, 1.6)];
  const ec = groupIntoCaptionChunks(ev, {});
  assert.equal(ec.length, 3);
  assert.equal(ec[1].text, "[clears throat]");
  assert.equal(ec[1].wordCount, 0);
  assert.equal(groupIntoCaptionChunks(ev, { eventsAlone: false }).length, 1);
});

test("caption chunks: one segment per sentence, word cap, minWords merge, pauses, ! breaks", () => {
  const flow = [];
  const say = (text, at) => flow.push(word(text, at, at + 0.2));
  say("Hello", 0.0); say("there.", 0.3);
  say("This", 0.6); say("is", 0.9); say("a", 1.2); say("test.", 1.5);
  for (let i = 0; i < 20; i++) say("w" + i, 2.0 + i * 0.3);
  const chunks = groupIntoCaptionChunks(flow, { maxWords: 8, gapSec: 0.5 });
  assert.equal(chunks[0].text, "Hello there.");
  assert.equal(chunks[1].text, "This is a test.");
  assert.deepEqual(chunks.map((c) => c.wordCount), [2, 4, 8, 8, 4]);
  assert.ok(approx(chunks[2].start, 2.0) && approx(chunks[2].end, 2.0 + 7 * 0.3 + 0.2));
  const tiny = groupIntoCaptionChunks([word("Yes.", 0, 0.2), word("So", 0.4, 0.6), word("anyway.", 0.7, 0.9)], {});
  assert.deepEqual(tiny.map((c) => c.text), ["Yes. So anyway."]);
  const paused = groupIntoCaptionChunks(WORDS, { maxWords: 8 });
  assert.ok(paused.length >= 2 && paused[0].text.indexOf("has") > 0);
  const s = [word("One", 0, 0.2), word("two", 0.3, 0.5), word("three!", 0.6, 0.8), word("Four", 1.0, 1.2)];
  assert.deepEqual(groupIntoCaptionChunks(s, { maxWords: 10 }).map((c) => c.text), ["One two three!", "Four"]);
  assert.equal(groupIntoPhrases(flow, 0.5).length, 1, "phrase mode unchanged");
  const capParts = partitionRange(0, 8.5, chunks);
  assert.equal(capParts.length, 5);
  assert.ok(capParts.every((p, i) => i === 0 || approx(capParts[i - 1].end, p.start)));
  assert.ok(approx(capParts[0].start, 0) && approx(capParts[4].end, 8.5));
});

test("detectTranscriptGaps, detectFillers, transcriptPauses", () => {
  const gaps = detectTranscriptGaps(WORDS, 0.4);
  assert.equal(gaps.length, 2);
  assert.ok(approx(gaps[0].start, 1.7) && approx(gaps[0].end, 2.6));
  const f = detectFillers([word("um", 0, 0.2), word("so", 0.3, 0.5), word("Uh,", 0.6, 0.8)]);
  assert.deepEqual(f.map((x) => x.text), ["um", "Uh,"]);
  assert.deepEqual(transcriptPauses(WORDS, 0.5, 4.0, true), [0.5, 0.9, 0.3]);
});

/* ---------- Borumi adapter ---------- */

test("buildSegments: the fixture becomes 5 sentence tiles in project ms covering the scene", () => {
  const { segments, autoCut, flagged, range } = buildSegments(WORDS_JSON, { scenes: SCENES });
  assert.equal(segments.length, 5);
  assert.equal(autoCut, 0);
  assert.equal(flagged, 0);
  assert.deepEqual(range, { start_ms: 0, end_ms: 20600 });
  assert.equal(segments[0].start_ms, 0);
  assert.equal(segments[0].text, "In this scene, I am going to show you the three pieces of the pipeline.");
  assert.equal(segments[0].speech_start_ms, 100);
  assert.equal(segments[0].speech_end_ms, 3560);
  assert.equal(segments[1].start_ms, 3820, "the tile boundary sits at the next phrase's first word");
  assert.equal(segments[4].end_ms, 20600, "the last tile snaps to the scene end");
  for (let i = 1; i < segments.length; i++) assert.equal(segments[i].start_ms, segments[i - 1].end_ms);
  assert.ok(segments.every((s) => s.scene_id === "eeaa" && s.decision === "keep" && s.index === segments.indexOf(s)));
  assert.equal(segments[2].wordCount, 16);
});

test("buildSegments: a sub-range and a two-scene tiling never cross the scene boundary", () => {
  const sub = buildSegments(WORDS_JSON, { startMs: 3700, endMs: 8000 });
  assert.equal(sub.segments.length, 1);
  assert.equal(sub.segments[0].start_ms, 3700);
  assert.equal(sub.segments[0].end_ms, 8000);
  assert.equal(sub.segments[0].text, "First, the recorder captures your camera and your screen as separate layers.");
  const two = buildSegments(WORDS_JSON, { scenes: [{ id: "s1", start_ms: 0, end_ms: 13800 }, { id: "s2", start_ms: 13800, end_ms: 20600 }] });
  const s1 = two.segments.filter((s) => s.scene_id === "s1");
  const s2 = two.segments.filter((s) => s.scene_id === "s2");
  assert.equal(s1[s1.length - 1].end_ms, 13800);
  assert.equal(s2[0].start_ms, 13800);
  assert.equal(s2[0].text, "And third, the render is placed behind the camera.");
});

test("buildSegments: an empty stretch becomes a (no speech) tile that is pre-marked cut", () => {
  const { segments, autoCut } = buildSegments(WORDS_JSON, { startMs: 20590, endMs: 22000 });
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "(no speech)");
  assert.equal(segments[0].decision, "cut");
  assert.equal(segments[0].fragment, "empty");
  assert.equal(autoCut, 1);
});

test("formatSegmentLines: the exact '[i] m:ss text ⟦tag⟧' format with project time", () => {
  const { segments } = buildSegments(WORDS_JSON, { scenes: SCENES });
  const lines = formatSegmentLines(segments);
  assert.equal(lines[0], "[0] 0:00 In this scene, I am going to show you the three pieces of the pipeline.");
  assert.equal(lines[3], "[3] 0:13 And third, the render is placed behind the camera.");
  const tagged = formatSegmentLines([
    { index: 7, start_ms: 83000, text: "(no speech)", fragment: "empty" },
    { index: 8, start_ms: 84000, text: "Yes.", fragment: "short" },
  ]);
  assert.equal(tagged[0], "[7] 1:23 (no speech) ⟦cut: no speech⟧");
  assert.equal(tagged[1], "[8] 1:24 Yes. ⟦flag: very short⟧");
});

test("applyDecisions: keep/cut with group and reason, protected untouched, unknown counted", () => {
  const { segments } = buildSegments(WORDS_JSON, { scenes: SCENES });
  segments[3].protected = true;
  const r = applyDecisions(segments, { decisions: [{ index: 1, decision: "cut", group: 2, reason: "restart" }, { index: 3, decision: "cut" }, { index: 99, decision: "cut" }, { index: 0, decision: "maybe" }] });
  assert.deepEqual(r, { applied: 1, unknown: 1 });
  assert.equal(segments[1].decision, "cut");
  assert.equal(segments[1].group, 2);
  assert.equal(segments[1].reason, "restart");
  assert.equal(segments[3].decision, "keep");
  assert.equal(segments[0].decision, "keep");
});

/* ---------- cut planning ---------- */

test("nearestGap picks the gap containing t, else the closest within snapMs", () => {
  const gaps = [[100, 300], [900, 1000]];
  assert.deepEqual(nearestGap(gaps, 200, 400), [100, 300]);
  assert.deepEqual(nearestGap(gaps, 600, 400), [100, 300]);
  assert.deepEqual(nearestGap(gaps, 700, 400), [900, 1000]);
  assert.equal(nearestGap(gaps, 5000, 400), null);
});

test("planCutRanges: a run of cut tiles becomes one span whose edges snap into the detect_speech gaps", () => {
  const { segments } = buildSegments(WORDS_JSON, { scenes: SCENES });
  applyDecisions(segments, [{ index: 1, decision: "cut" }, { index: 2, decision: "cut" }]);
  const plan = planCutRanges(segments, { silences: SILENCES.ranges });
  // kept "pipeline." ends 3560, gap [3560,3820]: cut starts 120 ms into the gap; kept "And" starts 13840, gap [13700,13840]: cut ends 120 ms before it
  assert.deepEqual(plan.ranges, [[3680, 13720]]);
  assert.equal(plan.summary.cutTiles, 2);
  assert.equal(plan.summary.runs, 1);
  assert.deepEqual(plan.summary.edges, { snapped: 2, padded: 0, boundary: 0 });
  assert.equal(plan.summary.removedMs, 10040);
  assert.deepEqual(plan.spans[0].indexes, [1, 2]);
});

test("planCutRanges: without gaps the edges fall back to the 250 ms lead / 300 ms tail pads, clamped to the words", () => {
  const { segments } = buildSegments(WORDS_JSON, { scenes: SCENES });
  applyDecisions(segments, [{ index: 1, decision: "cut" }, { index: 2, decision: "cut" }]);
  const plan = planCutRanges(segments, {});
  // tail pad from 3560 would land at 3860, past the first cut word at 3820, so it clamps there; lead pad from 13840 gives 13590 but the last cut word ends 13700
  assert.deepEqual(plan.ranges, [[3820, 13700]]);
  assert.deepEqual(plan.summary.edges, { snapped: 0, padded: 2, boundary: 0 });
  assert.equal(FALLBACK_LEAD_MS, 250);
  assert.equal(FALLBACK_TAIL_MS, 300);
  const wide = planCutRanges(segments, { padLeadMs: 50, padTailMs: 50 });
  assert.deepEqual(wide.ranges, [[3610, 13790]]);
});

test("planCutRanges: edges at a scene boundary or next to a protected neighbour stay on the tile boundary", () => {
  const { segments } = buildSegments(WORDS_JSON, { scenes: SCENES });
  applyDecisions(segments, [{ index: 0, decision: "cut" }, { index: 4, decision: "cut" }]);
  segments[3].protected = true;
  const plan = planCutRanges(segments, { silences: SILENCES.ranges });
  assert.equal(plan.ranges.length, 2);
  assert.equal(plan.ranges[0][0], 0, "scene start: no kept neighbour on the left");
  assert.equal(plan.ranges[0][1], 3700, "right edge snaps into the [3560,3820] gap, 120 ms before the kept word");
  assert.equal(plan.ranges[1][0], segments[4].start_ms, "protected neighbour: the edge is untouched");
  assert.equal(plan.ranges[1][1], 20600, "scene end");
  assert.deepEqual(plan.summary.edges, { snapped: 1, padded: 0, boundary: 3 });
});

test("planCutRanges: runs never cross a scene boundary and touching spans merge", () => {
  const two = buildSegments(WORDS_JSON, { scenes: [{ id: "s1", start_ms: 0, end_ms: 13800 }, { id: "s2", start_ms: 13800, end_ms: 20600 }] });
  const segs = two.segments;
  applyDecisions(segs, segs.map((s) => ({ index: s.index, decision: "cut" })));
  const plan = planCutRanges(segs, { silences: SILENCES.ranges });
  assert.equal(plan.spans.length, 1, "two per-scene runs that touch at 13800 merge into one span");
  assert.deepEqual(plan.ranges, [[0, 20600]]);
  assert.equal(plan.summary.runs, 2);
  const none = planCutRanges(segs.map((s) => ({ ...s, decision: "keep" })), {});
  assert.deepEqual(none.ranges, []);
});

test("findSaying: word match snapped to the block boundaries; ambiguity flagged", () => {
  const r = findSaying(WORDS_JSON, "designs an animation", BLOCKS_JSON);
  assert.equal(r.matches.length, 1);
  assert.deepEqual(r.matches[0].range, [8680, 13700]);
  assert.equal(r.ambiguous, false);
  const amb = findSaying(WORDS_JSON, "the", BLOCKS_JSON);
  assert.ok(amb.ambiguous && amb.matches.length > 1 && amb.best === 0);
  const none = findSaying(WORDS_JSON, "nothing like this", BLOCKS_JSON);
  assert.equal(none.best, null);
  const ranged = findSaying(WORDS_JSON, "the camera", null, { startMs: 14000, endMs: 20600 });
  assert.equal(ranged.matches.length, 1);
  assert.deepEqual(ranged.matches[0].range, [16020, 16550]);
});

/* ---------- CLI ---------- */

test("CLI: list writes segments.json and prints the lines; plan prints ranges", () => {
  mkdirSync(join(root, "tests", ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tests", ".tmp", "seg-"));
  const script = join(root, "scripts", "segments.mjs");
  const out = join(dir, "segments.json");
  const list = spawnSync(process.execPath, [script, "list", "--words", join(here, "fixtures", "transcript-words.json"), "--scenes", join(here, "fixtures", "scenes.json"), "--out", out], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  const lines = list.stdout.trim().split("\n");
  assert.equal(lines.length, 5);
  assert.ok(lines[0].startsWith("[0] 0:00 In this scene,"));
  const dec = join(dir, "decisions.json");
  writeFileSync(dec, JSON.stringify([{ index: 1, decision: "cut" }, { index: 2, decision: "cut" }]));
  const plan = spawnSync(process.execPath, [script, "plan", "--segments", out, "--decisions", dec, "--silences", join(here, "fixtures", "silences.json")], { encoding: "utf8" });
  assert.equal(plan.status, 0, plan.stderr);
  const j = JSON.parse(plan.stdout);
  assert.deepEqual(j.ranges, [[3680, 13720]]);
  assert.equal(j.summary.decisionsApplied, 2);
  const bad = spawnSync(process.execPath, [script, "plan"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.ok(JSON.parse(bad.stdout).error);
});
