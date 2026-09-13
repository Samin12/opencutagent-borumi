// Unit checks for the Health dropdown helpers (server/health.js): version
// parsing, the Node minimum, platform fix hints, and the live check shape.
import { parseVersion, majorOf, nodeOk, fixHint, runHealthChecks, extensionsDir } from "../health.js";

let failures = 0;
function check(label, cond, got) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!cond) failures++;
}

check("parseVersion node", parseVersion("v22.1.0") === "22.1.0", parseVersion("v22.1.0"));
check("parseVersion ffmpeg banner", parseVersion("ffmpeg version 7.0.2-tessus Copyright") === "7.0.2", parseVersion("ffmpeg version 7.0.2-tessus"));
check("parseVersion claude", parseVersion("2.1.3 (Claude Code)") === "2.1.3", parseVersion("2.1.3 (Claude Code)"));
check("parseVersion two-part", parseVersion("node 18.0") === "18.0", parseVersion("node 18.0"));
check("parseVersion none", parseVersion("nope") === null, parseVersion("nope"));
check("majorOf", majorOf("22.1.0") === 22 && Number.isNaN(majorOf(null)), majorOf("22.1.0"));
check("nodeOk accepts 18+", nodeOk("v18.19.0") && nodeOk("v22.0.0"), null);
check("nodeOk rejects 16", !nodeOk("v16.20.0"), null);
check("fixHint mac ffmpeg", /brew install ffmpeg/.test(fixHint("ffmpeg", "darwin")), fixHint("ffmpeg", "darwin"));
check("fixHint win node", /winget/.test(fixHint("node", "win32")), fixHint("node", "win32"));
check("fixHint has no em dash", !/\u2014/.test(["node", "ffmpeg", "claude", "elevenlabs"].map((t) => fixHint(t, "darwin") + fixHint(t, "win32")).join("")), null);
check("extensionsDir mac", /Library\/Application Support\/Adobe\/CEP\/extensions$/.test(extensionsDir("darwin", "/Users/x")), extensionsDir("darwin", "/Users/x"));
check("extensionsDir win", /Adobe[\\/]CEP[\\/]extensions$/.test(extensionsDir("win32", "C:\\Users\\x", "C:\\Users\\x\\AppData\\Roaming")), extensionsDir("win32", "C:\\Users\\x", "C:\\Users\\x\\AppData\\Roaming"));

// Live shape: never throws, always the four rows, node row is truthful for this process.
const h = await runHealthChecks();
check("health returns four checks", Array.isArray(h.checks) && h.checks.length === 4, h.checks && h.checks.map((c) => c.id));
check("health rows carry id/label/ok/detail", h.checks.every((c) => c.id && c.label && typeof c.ok === "boolean" && typeof c.detail === "string"), h.checks);
check("health node row matches this process", h.checks[0].id === "node" && h.checks[0].ok === nodeOk(), h.checks[0]);
check("health mode is self or cloud", h.mode === "self" || h.mode === "cloud", h.mode);
check("health failing rows carry a fix", h.checks.filter((c) => !c.ok).every((c) => c.fix), h.checks.filter((c) => !c.ok));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nhealth: all checks passed");
