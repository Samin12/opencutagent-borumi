// Human formatting for durations and positions. Ported from OpenCutAgent server/tools/util.js.
// fmtDur is for footage LENGTH ("8.4s", "1:25"); fmtElapsed is for WALL CLOCK ("3m 12s").
// Format at the message, never at the data: numeric fields stay raw ms/seconds.

export function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** Seconds -> "m:ss" (floors). */
export function mmss(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/** Milliseconds -> "m:ss" (floors). */
export function mmssMs(ms) {
  return mmss((Number(ms) || 0) / 1000);
}

/** Milliseconds -> "m:ss.mmm" for cut lists and receipts. */
export function mmssMsPrecise(ms) {
  const t = Math.max(0, Math.round(Number(ms) || 0));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const r = t % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}

/** Milliseconds -> YouTube chapter stamp: "mm:ss" or "h:mm:ss"; the first chapter must be "00:00". */
export function chapterStamp(ms) {
  const t = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Footage length in seconds -> "0.42s" / "8.4s" / "45s" / "1:25" / "1:02:03". Rounds BEFORE the 60 s test. */
export function fmtDur(sec) {
  const s = Math.abs(Number(sec) || 0);
  if (s < 1) return `${Math.round(s * 100) / 100}s`;
  if (s < 10) return `${Math.round(s * 10) / 10}s`;
  const t = Math.round(s);
  if (t < 60) return `${t}s`;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), ss = t % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** Wall-clock seconds -> "45s" / "3m 12s" / "5m" / "1h 05m". */
export function fmtElapsed(sec) {
  const t = Math.round(Math.abs(Number(sec) || 0));
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  if (m < 60) return t % 60 ? `${m}m ${t % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Parse a user time into milliseconds. Accepts "1:23", "1:23.5", "01:02:03", "83", "83s", "1m23s",
 * "1500ms", and numbers (seconds). Returns null when it cannot parse.
 */
export function parseTimeMs(input) {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 1000) : null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+)ms$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)s?$/))) return Math.round(Number(m[1]) * 1000);
  if ((m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/)) && (m[1] || m[2] || m[3])) {
    return Math.round(((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)) * 1000);
  }
  if ((m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/))) {
    return Math.round(((Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3])) * 1000);
  }
  return null;
}
