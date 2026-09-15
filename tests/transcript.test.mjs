// scripts/lib/transcript.mjs: Borumi transcript helpers (pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  flattenTranscript, flattenWords, flattenBlocks, sliceByRange, toRelativeSec, toProjectMs, toScribeTokens,
  itemsText, wordKeyOf, findPhrase, snapToBlocks, sceneAt, describeMs, mmssMs,
} from "../scripts/lib/transcript.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const WORDS = fixture("transcript-words.json");
const BLOCKS = fixture("transcript-blocks.json");

test("flattenTranscript: every item in time order with layer/segment/scene ids", () => {
  const items = flattenTranscript(WORDS);
  assert.equal(items.length, 65);
  assert.deepEqual(items[0], { text: "In", start_ms: 100, end_ms: 260, layer_id: "microphone_1", segment_id: "95dd", scene_id: "eeaa", media_id: "871a" });
  assert.equal(items[items.length - 1].text, "frame.");
  for (let i = 1; i < items.length; i++) assert.ok(items[i].start_ms >= items[i - 1].start_ms);
  assert.equal(flattenWords(WORDS).length, 65);
  assert.equal(flattenBlocks(BLOCKS).length, 9);
});

test("flattenTranscript: tolerates an empty or malformed response", () => {
  assert.deepEqual(flattenTranscript(null), []);
  assert.deepEqual(flattenTranscript({ layers: [{ id: "x", segments: [{ items: [[null, 1, "a"]] }] }] }), []);
  const t = flattenTranscript({ layers: [{ id: "x", segments: [{ items: [[10, null, "a"]] }] }] });
  assert.equal(t[0].end_ms, 10);
});

test("sliceByRange: midpoint rule assigns each word to exactly one range", () => {
  const items = flattenWords(WORDS);
  const a = sliceByRange(items, 0, 3700);
  const b = sliceByRange(items, 3700, 8000);
  assert.equal(itemsText(a), "In this scene, I am going to show you the three pieces of the pipeline.");
  assert.equal(a.length + b.length, sliceByRange(items, 0, 8000).length);
  // a word straddling the boundary goes to the side its midpoint is on
  const straddle = sliceByRange([{ text: "x", start_ms: 900, end_ms: 1300 }], 1000, 2000);
  assert.equal(straddle.length, 1);
  assert.equal(sliceByRange([{ text: "x", start_ms: 800, end_ms: 1100 }], 1000, 2000).length, 0);
});

test("time conversions: project ms <-> relative seconds", () => {
  assert.equal(toRelativeSec(41750, 41000), 0.75);
  assert.equal(toRelativeSec(100), 0.1);
  assert.equal(toProjectMs(0.75, 41000), 41750);
  assert.equal(toProjectMs(1.2345, 0), 1235);
  assert.equal(mmssMs(83500), "1:23");
  assert.equal(describeMs(83500), "1:23 (83.5s)");
});

test("toScribeTokens: the shape segments.mjs expects, in seconds relative to the origin", () => {
  const toks = toScribeTokens(sliceByRange(flattenWords(WORDS), 3820, 8000), 3820);
  assert.deepEqual(toks[0], { type: "word", text: "First,", start: 0, end: 0.49 });
  assert.equal(toks[toks.length - 1].text, "layers.");
});

test("wordKeyOf + findPhrase: punctuation and case insensitive, every match returned", () => {
  assert.equal(wordKeyOf("Pipeline."), "pipeline");
  assert.equal(wordKeyOf("let's"), "let's");
  const items = flattenWords(WORDS);
  const m = findPhrase(items, "designs an animation");
  assert.equal(m.length, 1);
  assert.equal(m[0].start_ms, 10460);
  assert.equal(m[0].end_ms, 11580);
  assert.equal(m[0].text, "designs an animation");
  assert.equal(findPhrase(items, "the").length, 10);
  assert.deepEqual(findPhrase(items, ""), []);
  assert.deepEqual(findPhrase(items, "words that are not there"), []);
});

test("snapToBlocks: widens a word match to the enclosing block boundaries", () => {
  const blocks = flattenBlocks(BLOCKS);
  const snapped = snapToBlocks({ start_ms: 10460, end_ms: 11580 }, blocks);
  assert.equal(snapped.start_ms, 8680);
  assert.equal(snapped.end_ms, 13700);
  assert.deepEqual(snapped.blocks, ["the agent reads the transcript and designs an animation for exactly this stretch of narration."]);
  // a match spanning two blocks takes the first block's start and the second block's end
  const two = snapToBlocks({ start_ms: 13920, end_ms: 15140 }, blocks);
  assert.equal(two.start_ms, 13840);
  assert.equal(two.end_ms, 16550);
  assert.equal(two.blocks.length, 2);
  // outside every block: unchanged
  const none = snapToBlocks({ start_ms: 3600, end_ms: 3700 }, blocks);
  assert.equal(none.start_ms, 3600);
  assert.equal(none.end_ms, 3700);
});

test("sceneAt: half-open scene ranges", () => {
  const scenes = [{ id: "a", start_ms: 0, end_ms: 5000 }, { id: "b", start_ms: 5000, end_ms: 9000 }];
  assert.equal(sceneAt(scenes, 4999).id, "a");
  assert.equal(sceneAt(scenes, 5000).id, "b");
  assert.equal(sceneAt(scenes, 9000), null);
});
