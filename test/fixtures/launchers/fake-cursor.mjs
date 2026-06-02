#!/usr/bin/env node
// @ts-check
// `test/fixtures/launchers/fake-cursor.mjs` — a stubbed "Cursor" launcher
// agent for the launcher-agnostic feature-parity chaos test (TASKS.md
// `launcher-agnostic-feature-parity-chaos-test`, user-story 014).
//
// Why this file exists: this is the comparand to `fake-claude.mjs`. It is
// byte-identical in structure — it exports the env vars a real Cursor
// session sets (`CURSOR=1`, `CURSOR_AGENT=1`) plus `MINSKY_AGENT=cursor`
// (the single value story 014 permits to differ between launchers), then
// runs the SAME canonical INSTALL.md steps against the fixture repo via
// the shared `install-driver.mjs`. Because the two launchers diverge only
// in these launcher-identifying env vars, any non-allowlisted delta the
// chaos test observes between the two installs is, by construction, caused
// by launcher coupling in the runtime — which is exactly the regression
// the test exists to catch (story 014 § Metric, threshold 0, iron).
//
// Usage: node fake-cursor.mjs <fixture-repo> <isolated-home>

import { runInstallSteps } from "./install-driver.mjs";

const LAUNCHER_ENV = Object.freeze({
  // The env vars a real Cursor session exports. If `bin/minsky` branches
  // on either of these, the parity diff fails.
  CURSOR: "1",
  CURSOR_AGENT: "1",
  // The ONE permitted carrier — recorded as `telemetry_consent.agent`.
  MINSKY_AGENT: "cursor",
});

const fixtureRepo = process.argv[2];
const isolatedHome = process.argv[3];
if (fixtureRepo === undefined || isolatedHome === undefined) {
  process.stderr.write("usage: fake-cursor.mjs <fixture-repo> <isolated-home>\n");
  process.exit(2);
}

const result = runInstallSteps({
  fixtureRepo,
  isolatedHome,
  launcherEnv: LAUNCHER_ENV,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
