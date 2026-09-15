#!/usr/bin/env node
// /borumi:chapters helpers: chapters.json -> youtube-chapters.txt + the text_overlay additions
// (Samin's Astra chapter-card style, verified in the cookbook), and re-timing after a cut.
//
//   chapters.mjs build --chapters chapters.json --out-dir D [--card-seconds 3.2] [--style astra|label] [--card-first]
//       writes D/youtube-chapters.txt and D/text_overlays.json; prints {files, cards, warnings}
//   chapters.mjs shift --chapters chapters.json --cuts cuts.json [--out chapters.json]
//       remaps every chapter start to its position after the ripple cuts (t - removedBefore(t));
//       writes back in place unless --out; prints the updated chapters
//
// chapters.json: {"chapters":[{"start_ms":0,"title":"Intro"}, ...], "placed":[...]} or a bare array.
// A chapter may carry "time" ("1:07") instead of start_ms. Titles longer than 27 characters get a
// 4 s card; the 0:00 chapter gets no card unless --card-first.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chapterStamp, parseTimeMs } from "./lib/fmt.mjs";
import { makeRemovedBefore, mergeRanges } from "./lib/intervals.mjs";

export const DEFAULT_CARD_SECONDS = 3.2;
export const LONG_TITLE_CARD_SECONDS = 4;
export const LONG_TITLE_CHARS = 27;

/** The Astra chapter card (DM Sans bold 62, fixed box bottom-left, dark navy background). */
export const ASTRA_CARD = Object.freeze({
  font_families: ["DM Sans"],
  bold: true,
  text_size: 62,
  line_height: 1.13,
  alignment: "left",
  sizing_mode: "fixed",
  position: { kind: "custom", x_ratio: 0.055, y_ratio: 0.76, width_ratio: 0.7, height_ratio: 0.16 },
  lock_aspect_ratio: false,
  text_color: { r: 255, g: 255, b: 255, a: 255 },
  text_shadow: false,
  background_color: { r: 17, g: 31, b: 47, a: 239 },
  background_sizing_mode: "paragraph",
  background_horizontal_padding_ratio: 0.3,
  background_vertical_padding_ratio: 0.22,
  border_radius_ratio: 0.016,
  entrance_transition: { kind: "fade" },
  exit_transition: { kind: "instant" },
});

/** Borumi's built-in Label template (from editing_segment_text_overlay_templates) anchored bottom-centre. */
export const LABEL_CARD = Object.freeze({
  sizing_mode: "hug",
  text_size: 64,
  line_height: 1.3,
  text_color: { r: 255, g: 255, b: 255, a: 255 },
  background_color: { r: 0, g: 0, b: 0, a: 153 },
  background_sizing_mode: "paragraph",
  background_horizontal_padding_ratio: 0.48,
  background_vertical_padding_ratio: 0.42,
  background_x_offset_ratio: 0,
  background_y_offset_ratio: 0,
  bold: true,
  italic: false,
  stroke_color: null,
  stroke_width: 0,
  text_shadow: false,
  text_shadow_color: null,
  text_shadow_blur_ratio: 0.04,
  text_shadow_spread_ratio: 0,
  text_shadow_x_offset_ratio: 0,
  text_shadow_y_offset_ratio: 0.01,
  casing_mode: "original",
  font_families: ["DM Sans", "sans-serif"],
  alignment: "center",
  wrapping_mode: null,
  position: { kind: "custom", x_ratio: 0.5, y_ratio: 0.8, width_ratio: 0.6, height_ratio: 0.12 },
  entrance_transition: { kind: "fade" },
  exit_transition: { kind: "instant" },
});

/** Accept {chapters:[...]} or a bare array; normalise each entry to {start_ms, title, ...rest}. */
export function normalizeChapters(input) {
  const list = Array.isArray(input) ? input : (input && input.chapters) || [];
  const out = [];
  for (const c of list) {
    if (!c) continue;
    let ms = c.start_ms != null ? Number(c.start_ms) : c.time_ms != null ? Number(c.time_ms) : parseTimeMs(c.time != null ? c.time : c.start);
    if (!Number.isFinite(ms)) continue;
    const title = String(c.title || c.name || "").trim();
    if (!title) continue;
    out.push({ ...c, start_ms: Math.max(0, Math.round(ms)), title });
  }
  out.sort((a, b) => a.start_ms - b.start_ms);
  return out;
}

/** "00:00 Intro\n01:07 Why this matters\n"; the first line is forced to 00:00 (YouTube's rule). */
export function chaptersText(chapters) {
  const list = normalizeChapters(chapters);
  const warnings = [];
  const lines = [];
  if (!list.length) return { text: "", warnings: ["no chapters"] };
  if (list[0].start_ms >= 1000) {
    warnings.push(`first chapter starts at ${chapterStamp(list[0].start_ms)}, YouTube needs a 00:00 chapter: added "Intro"`);
    lines.push("00:00 Intro");
  }
  for (const c of list) lines.push(`${chapterStamp(c.start_ms)} ${c.title}`);
  if (lines[0].slice(0, 5) !== "00:00") lines[0] = `00:00 ${lines[0].split(" ").slice(1).join(" ")}`;
  return { text: lines.join("\n") + "\n", warnings };
}

/** Card duration: 4 s for long titles, else cardSeconds. */
export function cardDurationMs(title, cardSeconds = DEFAULT_CARD_SECONDS) {
  const secs = String(title || "").length > LONG_TITLE_CHARS ? LONG_TITLE_CARD_SECONDS : Number(cardSeconds) || DEFAULT_CARD_SECONDS;
  return Math.round(secs * 1000);
}

/** Card text: "01  Title" (two spaces, as on the Astra edit). */
export function cardText(n, title) {
  return `${String(n).padStart(2, "0")}  ${title}`;
}

/**
 * The add_segments additions for the chapter cards.
 * @returns {{additions:Array, cards:Array, warnings:string[]}}
 */
export function buildCardAdditions(chapters, opts = {}) {
  const list = normalizeChapters(chapters);
  const style = opts.style === "label" ? LABEL_CARD : ASTRA_CARD;
  const cardFirst = !!opts.cardFirst;
  const additions = [];
  const cards = [];
  const warnings = [];
  list.forEach((c, i) => {
    const n = i + 1;
    if (c.start_ms < 1000 && !cardFirst) {
      cards.push({ index: n, start_ms: c.start_ms, title: c.title, card: null, skipped: "opening chapter (use --card-first to card it)" });
      return;
    }
    const dur = cardDurationMs(c.title, opts.cardSeconds);
    const next = list[i + 1];
    let end = c.start_ms + dur;
    let shortened = false;
    if (next && end > next.start_ms) { end = next.start_ms; shortened = true; }
    if (opts.durationMs != null && end > Number(opts.durationMs)) { end = Number(opts.durationMs); shortened = true; }
    if (end - c.start_ms < 500) { cards.push({ index: n, start_ms: c.start_ms, title: c.title, card: null, skipped: "no room for a card" }); return; }
    if (shortened) warnings.push(`card ${n} shortened to ${end - c.start_ms} ms so it ends before ${next && end === next.start_ms ? `chapter ${n + 1}` : "the end of the project"}`);
    additions.push({
      type: "text_overlay",
      placement: { range: [c.start_ms, end] },
      properties: { ...style, text: cardText(n, c.title) },
    });
    cards.push({ index: n, start_ms: c.start_ms, title: c.title, card: { range: [c.start_ms, end], text: cardText(n, c.title) } });
  });
  return { additions, cards, warnings };
}

/** Remap chapter starts after ripple cuts: t -> t - removedBefore(t). Returns the new chapters (same extra fields). */
export function shiftChapters(chapters, cuts) {
  const list = normalizeChapters(chapters);
  const ranges = mergeRanges(Array.isArray(cuts) ? cuts : (cuts && cuts.ranges) || []);
  const removedBefore = makeRemovedBefore(ranges);
  return list.map((c) => ({ ...c, previous_start_ms: c.start_ms, start_ms: c.start_ms - removedBefore(c.start_ms) }));
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
  if (cmd === "build") {
    if (!opts.chapters || !opts["out-dir"]) throw new Error("build needs --chapters chapters.json --out-dir D");
    const input = readJson(opts.chapters);
    const outDir = opts["out-dir"];
    mkdirSync(outDir, { recursive: true });
    const txt = chaptersText(input);
    const cards = buildCardAdditions(input, {
      cardSeconds: opts["card-seconds"] != null ? Number(opts["card-seconds"]) : DEFAULT_CARD_SECONDS,
      style: opts.style || "astra",
      cardFirst: !!opts["card-first"],
      durationMs: opts["duration-ms"] != null ? Number(opts["duration-ms"]) : undefined,
    });
    const txtPath = join(outDir, "youtube-chapters.txt");
    const jsonPath = join(outDir, "text_overlays.json");
    writeFileSync(txtPath, txt.text);
    writeFileSync(jsonPath, JSON.stringify({ style: opts.style || "astra", additions: cards.additions, cards: cards.cards }, null, 2));
    console.log(JSON.stringify({ files: [txtPath, jsonPath], chapters: normalizeChapters(input).length, cards: cards.additions.length, warnings: [...txt.warnings, ...cards.warnings] }, null, 2));
    return;
  }
  if (cmd === "shift") {
    if (!opts.chapters || !opts.cuts) throw new Error("shift needs --chapters chapters.json --cuts cuts.json");
    const input = readJson(opts.chapters);
    const shifted = shiftChapters(input, readJson(opts.cuts));
    const doc = Array.isArray(input) ? shifted : { ...input, chapters: shifted };
    const outPath = opts.out || opts.chapters;
    writeFileSync(outPath, JSON.stringify(doc, null, 2));
    console.log(JSON.stringify({ file: outPath, chapters: shifted.map((c) => ({ title: c.title, from_ms: c.previous_start_ms, to_ms: c.start_ms })) }, null, 2));
    return;
  }
  throw new Error("usage: chapters.mjs build|shift ... (see the header comment)");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`chapters.mjs: ${e.message}`);
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
