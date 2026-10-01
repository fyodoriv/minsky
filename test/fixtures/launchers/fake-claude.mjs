#!/usr/bin/env node
// @ts-check
// `test/fixtures/launchers/fake-claude.mjs` — a stubbed "Claude Code"
// launcher agent for the launcher-agnostic feature-parity chaos test
// (TASKS.md `launcher-agnostic-feature-parity-chaos-test`, user-story 014).
//
// Why this file exists: story 014's invariant is that the agent chat that
// *installs* Minsky must not color the *runtime*. To test that
// deterministically we need two launchers that differ ONLY in the
// launcher-identifying env vars they export, then drive the identical
// INSTALL.md steps. This script plays the Claude Code role: it exports the
// env vars a real Claude Code session sets (`CLAUDE_CODE=1`,
// `CLAUDECODE=1`) plus `MINSKY_AGENT=claude` (the one value story 014
// permits to flow into the telemetry-consent record), then runs the
// canonical install steps against the fixture repo passed as argv[1].
//
// It is intentionally minimal (env-var setting + exec'ing the install
// steps) per the task's Risk-(a) mitigation: the test's value is catching
// env-var-driven runtime branches, not reproducing every real-agent
// quirk. The sibling `fake-cursor.mjs` is byte-identical except for the
// launcher env vars + agent string — so any runtime delta the chaos test
// observes is attributable to launcher coupling, nothing else.
//
// Usage: node fake-claude.mjs <fixture-repo> <isolated-home>
//   - <fixture-repo> — a git repo the launcher runs `minsky init` against.
//   - <isolated-home> — HOME/MINSKY_STATE_DIR root so the install never
//     touches the operator's real ~/.minsky.

import { runInstallSteps } from "./install-driver.mjs";

const LAUNCHER_ENV = Object.freeze({
  // The env vars a real Claude Code session exports. If `bin/minsky` ever
  // branches on either of these, the parity diff fails (that's the point).
  CLAUDE_CODE: "1",
  CLAUDECODE: "1",
  // The ONE permitted carrier: `minsky consent` reads MINSKY_AGENT and
  // records it as `telemetry_consent.agent`. Story 014 allows this single
  // field to differ between launchers ("who turned the doorknob").
  MINSKY_AGENT: "claude",
});

const fixtureRepo = process.argv[2];
const isolatedHome = process.argv[3];
if (fixtureRepo === undefined || isolatedHome === undefined) {
  process.stderr.write("usage: fake-claude.mjs <fixture-repo> <isolated-home>\n");
  process.exit(2);
}

const result = runInstallSteps({
  fixtureRepo,
  isolatedHome,
  launcherEnv: LAUNCHER_ENV,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
