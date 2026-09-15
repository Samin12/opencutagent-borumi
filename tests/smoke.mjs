// Smoke test against the real Borumi MCP server: spawn `borumi mcp` over stdio JSON-RPC,
// initialize, tools/list, and assert every name in scripts/lib/tools.mjs is present with an
// object inputSchema. Borumi does not have to be running (tools/list and get_guides answer
// with the app closed); when the binary itself is absent the test skips with a clear message.
//
//   node tests/smoke.mjs            (BORUMI_BIN overrides the binary path)
import { existsSync } from "node:fs";
import { BORUMI_BIN, BORUMI_TOOLS, MIN_BORUMI_VERSION, probeBorumi, versionAtLeast } from "../scripts/lib/tools.mjs";

let failures = 0;
function check(label, cond, got) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!cond) failures++;
}

if (!existsSync(BORUMI_BIN)) {
  console.log(`SKIP  Borumi binary not found at ${BORUMI_BIN} (install Borumi.app or set BORUMI_BIN); nothing to smoke.`);
  process.exit(0);
}

let report;
try {
  report = await probeBorumi({ bin: BORUMI_BIN, timeoutMs: 20000 });
} catch (e) {
  check(`borumi mcp answers over stdio (${e.message})`, false);
  process.exit(1);
}

check("server identifies itself as borumi", report.server.name === "borumi", report.server);
check(`server version >= ${MIN_BORUMI_VERSION}`, versionAtLeast(report.server.version, MIN_BORUMI_VERSION), report.server.version);
check(`tools/list returns at least the ${BORUMI_TOOLS.length} tools the skills call`, report.toolCount >= BORUMI_TOOLS.length, report.toolCount);
check("every expected tool is advertised", report.missing.length === 0, report.missing);
check("every advertised tool carries an object inputSchema", report.badSchema.length === 0, report.badSchema);
check(
  "list_open_projects answers ok or app_not_running (the tool-call path works)",
  report.app.status === "ok" || report.app.status === "app_not_running",
  report.app,
);
console.log(`   ${report.toolCount} tools; Borumi ${report.server.version}; app ${report.app.status}${report.app.status === "ok" ? ` (${report.app.openProjects} project(s) open)` : ""}`);
console.log(failures ? `${failures} smoke check(s) failed` : "smoke ok");
process.exit(failures ? 1 : 0);
