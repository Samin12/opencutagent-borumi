// parseTimeMs and the duration formatters in scripts/lib/fmt.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimeMs, mmss, mmssMs, mmssMsPrecise, chapterStamp, fmtDur, fmtElapsed, round3 } from "../scripts/lib/fmt.mjs";

test("parseTimeMs: m:ss and h:mm:ss forms are project ms", () => {
  assert.equal(parseTimeMs("1:23"), 83000);
  assert.equal(parseTimeMs("1:23.5"), 83500);
  assert.equal(parseTimeMs("01:02:03"), 3723000);
  assert.equal(parseTimeMs("1:02:03.25"), 3723250);
  assert.equal(parseTimeMs("0:05"), 5000);
});

test("parseTimeMs: seconds, unit suffixes and numbers", () => {
  assert.equal(parseTimeMs("83"), 83000);
  assert.equal(parseTimeMs("83s"), 83000);
  assert.equal(parseTimeMs("83.25s"), 83250);
  assert.equal(parseTimeMs("1m23s"), 83000);
  assert.equal(parseTimeMs("1h2m3s"), 3723000);
  assert.equal(parseTimeMs("2h"), 7200000);
  assert.equal(parseTimeMs("1500ms"), 1500);
  assert.equal(parseTimeMs(12.5), 12500);
  assert.equal(parseTimeMs(" 1:02 "), 62000);
});

test("parseTimeMs: garbage is null, never a silent zero", () => {
  assert.equal(parseTimeMs(""), null);
  assert.equal(parseTimeMs(null), null);
  assert.equal(parseTimeMs(undefined), null);
  assert.equal(parseTimeMs("later"), null);
  assert.equal(parseTimeMs("1:2:3:4"), null);
  assert.equal(parseTimeMs(NaN), null);
});

test("mmss / mmssMs / mmssMsPrecise / chapterStamp", () => {
  assert.equal(mmss(83.9), "1:23");
  assert.equal(mmssMs(83900), "1:23");
  assert.equal(mmssMsPrecise(83900), "1:23.900");
  assert.equal(mmssMsPrecise(5), "0:00.005");
  assert.equal(chapterStamp(0), "00:00");
  assert.equal(chapterStamp(67000), "01:07");
  assert.equal(chapterStamp(3723000), "1:02:03");
});

test("fmtDur is footage length, fmtElapsed is wall clock", () => {
  assert.equal(fmtDur(0.42), "0.42s");
  assert.equal(fmtDur(8.44), "8.4s");
  assert.equal(fmtDur(45), "45s");
  assert.equal(fmtDur(59.6), "1:00");
  assert.equal(fmtDur(85), "1:25");
  assert.equal(fmtDur(3723), "1:02:03");
  assert.equal(fmtElapsed(45), "45s");
  assert.equal(fmtElapsed(192), "3m 12s");
  assert.equal(fmtElapsed(300), "5m");
  assert.equal(fmtElapsed(3900), "1h 05m");
  assert.equal(round3(1.23456), 1.235);
});
