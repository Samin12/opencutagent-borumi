// scripts/chapters.mjs: youtube-chapters.txt, Astra chapter cards, and re-timing after cuts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  normalizeChapters, chaptersText, cardDurationMs, cardText, buildCardAdditions, shiftChapters,
  ASTRA_CARD, LABEL_CARD, DEFAULT_CARD_SECONDS, LONG_TITLE_CHARS,
} from "../scripts/chapters.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CHAPTERS = { chapters: [
  { start_ms: 0, title: "Intro" },
  { time: "1:07", title: "Why this matters" },
  { start_ms: 125000, title: "A much longer chapter title than usual" },
] };

test("normalizeChapters: accepts start_ms, time strings and bare arrays, sorts, drops junk", () => {
  const n = normalizeChapters(CHAPTERS);
  assert.deepEqual(n.map((c) => c.start_ms), [0, 67000, 125000]);
  const arr = normalizeChapters([{ start_ms: 5000, title: "B" }, { time: "0:01", title: "A" }, { title: "no time" }, { start_ms: 9000, title: "" }]);
  assert.deepEqual(arr.map((c) => [c.start_ms, c.title]), [[1000, "A"], [5000, "B"]]);
  assert.deepEqual(normalizeChapters(null), []);
});

test("chaptersText: mm:ss stamps, h:mm:ss past an hour, first line forced to 00:00", () => {
  const { text, warnings } = chaptersText(CHAPTERS);
  assert.equal(text, "00:00 Intro\n01:07 Why this matters\n02:05 A much longer chapter title than usual\n");
  assert.deepEqual(warnings, []);
  const late = chaptersText([{ start_ms: 30000, title: "Late start" }, { start_ms: 3661000, title: "Hour" }]);
  assert.equal(late.text, "00:00 Intro\n00:30 Late start\n1:01:01 Hour\n");
  assert.equal(late.warnings.length, 1);
  const sub = chaptersText([{ start_ms: 400, title: "Almost zero" }]);
  assert.equal(sub.text, "00:00 Almost zero\n");
  assert.equal(chaptersText([]).text, "");
});

test("cardDurationMs and cardText", () => {
  assert.equal(cardDurationMs("Short", 3.2), 3200);
  assert.equal(cardDurationMs("x".repeat(LONG_TITLE_CHARS), 3.2), 3200);
  assert.equal(cardDurationMs("x".repeat(LONG_TITLE_CHARS + 1), 3.2), 4000);
  assert.equal(cardDurationMs("Short"), Math.round(DEFAULT_CARD_SECONDS * 1000));
  assert.equal(cardText(1, "Smoke test chapter"), "01  Smoke test chapter");
  assert.equal(cardText(12, "Twelve"), "12  Twelve");
});

test("buildCardAdditions: Astra style, 0:00 skipped unless card-first, 4 s for long titles", () => {
  const { additions, cards, warnings } = buildCardAdditions(CHAPTERS, { cardSeconds: 3.2 });
  assert.equal(additions.length, 2);
  assert.equal(cards[0].card, null);
  assert.match(cards[0].skipped, /opening chapter/);
  assert.deepEqual(additions[0].placement, { range: [67000, 70200] });
  assert.deepEqual(additions[1].placement, { range: [125000, 129000] });
  assert.equal(additions[0].type, "text_overlay");
  assert.equal(additions[0].properties.text, "02  Why this matters");
  const p = additions[0].properties;
  assert.deepEqual(p.font_families, ["DM Sans"]);
  assert.equal(p.bold, true);
  assert.equal(p.text_size, 62);
  assert.equal(p.sizing_mode, "fixed");
  assert.deepEqual(p.position, { kind: "custom", x_ratio: 0.055, y_ratio: 0.76, width_ratio: 0.7, height_ratio: 0.16 });
  assert.deepEqual(p.background_color, { r: 17, g: 31, b: 47, a: 239 });
  assert.equal(p.background_sizing_mode, "paragraph");
  assert.equal(p.background_horizontal_padding_ratio, 0.3);
  assert.equal(p.background_vertical_padding_ratio, 0.22);
  assert.equal(p.border_radius_ratio, 0.016);
  assert.deepEqual(p.entrance_transition, { kind: "fade" });
  assert.deepEqual(p.exit_transition, { kind: "instant" });
  assert.equal(p.alignment, "left");
  assert.deepEqual(warnings, []);
  assert.ok(!("text" in ASTRA_CARD), "the style constant carries no text");
  const first = buildCardAdditions(CHAPTERS, { cardFirst: true });
  assert.equal(first.additions.length, 3);
  assert.deepEqual(first.additions[0].placement, { range: [0, 3200] });
  assert.equal(first.additions[0].properties.text, "01  Intro");
});

test("buildCardAdditions: label style, cards shortened before the next chapter, no room -> skipped", () => {
  const label = buildCardAdditions(CHAPTERS, { style: "label" });
  assert.equal(label.additions[0].properties.sizing_mode, "hug");
  assert.deepEqual(label.additions[0].properties.font_families, LABEL_CARD.font_families);
  const tight = buildCardAdditions([{ start_ms: 0, title: "A" }, { start_ms: 10000, title: "B" }, { start_ms: 12000, title: "C" }, { start_ms: 12300, title: "D" }], { cardSeconds: 3.2 });
  assert.deepEqual(tight.additions.map((a) => a.placement.range), [[10000, 12000], [12300, 15500]]);
  assert.equal(tight.warnings.length, 1);
  assert.equal(tight.cards[2].card, null);
  assert.match(tight.cards[2].skipped, /no room/);
  const capped = buildCardAdditions([{ start_ms: 0, title: "A" }, { start_ms: 10000, title: "B" }], { durationMs: 11000 });
  assert.deepEqual(capped.additions[0].placement.range, [10000, 11000]);
});

test("shiftChapters: t -> t - removedBefore(t); a chapter inside a cut lands on the cut start", () => {
  const shifted = shiftChapters(CHAPTERS, { ranges: [[60000, 62000], [120000, 121000]] });
  assert.deepEqual(shifted.map((c) => [c.previous_start_ms, c.start_ms]), [[0, 0], [67000, 65000], [125000, 122000]]);
  const inside = shiftChapters([{ start_ms: 61000, title: "In the cut" }], [[60000, 62000]]);
  assert.equal(inside[0].start_ms, 60000);
  const none = shiftChapters(CHAPTERS, []);
  assert.deepEqual(none.map((c) => c.start_ms), [0, 67000, 125000]);
});

test("CLI: build writes both files, shift rewrites the chapters file", () => {
  mkdirSync(join(root, "tests", ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tests", ".tmp", "chapters-"));
  const script = join(root, "scripts", "chapters.mjs");
  const chaptersPath = join(dir, "chapters.json");
  writeFileSync(chaptersPath, JSON.stringify(CHAPTERS));
  const build = spawnSync(process.execPath, [script, "build", "--chapters", chaptersPath, "--out-dir", join(dir, "out"), "--card-seconds", "3.2"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const res = JSON.parse(build.stdout);
  assert.equal(res.cards, 2);
  assert.ok(existsSync(join(dir, "out", "youtube-chapters.txt")));
  assert.equal(readFileSync(join(dir, "out", "youtube-chapters.txt"), "utf8").split("\n")[0], "00:00 Intro");
  const overlays = JSON.parse(readFileSync(join(dir, "out", "text_overlays.json"), "utf8"));
  assert.equal(overlays.additions.length, 2);
  assert.equal(overlays.additions[0].properties.text, "02  Why this matters");
  const cutsPath = join(dir, "cuts.json");
  writeFileSync(cutsPath, JSON.stringify({ ranges: [[60000, 62000]] }));
  const shift = spawnSync(process.execPath, [script, "shift", "--chapters", chaptersPath, "--cuts", cutsPath], { encoding: "utf8" });
  assert.equal(shift.status, 0, shift.stderr);
  const after = JSON.parse(readFileSync(chaptersPath, "utf8"));
  assert.equal(after.chapters[1].start_ms, 65000);
  assert.equal(after.chapters[1].previous_start_ms, 67000);
  const bad = spawnSync(process.execPath, [script, "build"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
});
