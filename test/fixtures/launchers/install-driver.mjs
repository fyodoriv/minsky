#!/usr/bin/env node
// @ts-check
// `test/fixtures/launchers/install-driver.mjs` — the shared INSTALL.md
// step runner used by both stubbed launchers (`fake-claude.mjs`,
// `fake-cursor.mjs`) in the launcher-agnostic feature-parity chaos test
// (TASKS.md `launcher-agnostic-feature-parity-chaos-test`, user-story 014).
//
// Why this file exists: the two fake launchers MUST run identical install
// steps — if they diverged in *which* steps they ran (not just which env
// vars they set), the chaos test would be measuring step divergence, not
// launcher coupling. Factoring the steps into one driver guarantees the
// two launchers differ only in their `launcherEnv` map. This is the heart
// of the test's falsifiability: feed the same steps two ways, diff the
// result.
//
// The steps mirror INSTALL.md's agent-followable runbook, reduced to the
// subset that mutates `~/.minsky/` deterministically without spending real
// compute or network:
//   1. `minsky init <repo>`         → writes ~/.minsky/config.json
//   2. `minsky consent --yes`       → writes ~/.minsky/telemetry-consent.json
//   3. capture `minsky --help`      → the advertised subcommand set
// The daemon-start / OpenHands-spawn steps are NOT run here (they need a
// live model); the chaos test builds the OpenHands envelope deterministic-
// ally from each install's config instead (a pure function of config, so
// any launcher leak into config surfaces in the envelope too).
//
// Pattern: shared test-fixture driver (Meszaros, *xUnit Test Patterns*,
//   2007 — "Test Utility Method" / "Creation Method"). Conformance: full.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const BIN_MINSKY = join(REPO_ROOT, "bin", "minsky");

/**
 * @typedef {object} InstallResult
 * @property {boolean} ok                whether every step exited 0
 * @property {string} helpText           captured `minsky --help` stdout
 * @property {string} stateDir           the isolated ~/.minsky for this install
 * @property {{ name: string, status: number }[]} steps  per-step exit codes
 */

/**
 * Run the canonical INSTALL.md steps as a given launcher. The ONLY thing
 * that differs between launchers is `launcherEnv`. Everything else — PATH,
 * the fixture repo, the isolated HOME, the model — is held identical so
 * the chaos test can attribute any delta to launcher coupling.
 *
 * @param {{
 *   fixtureRepo: string,
 *   isolatedHome: string,
 *   launcherEnv: Record<string, string>,
 * }} opts
 * @returns {InstallResult}
 */
export function runInstallSteps(opts) {
  const stateDir = join(opts.isolatedHome, ".minsky");
  mkdirSync(stateDir, { recursive: true });

  /** @type {Record<string, string>} */
  const baseEnv = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: opts.isolatedHome,
    MINSKY_STATE_DIR: stateDir,
    // Held identical across launchers — the same model on both installs so
    // model selection can't be a source of (legitimate) divergence.
    MINSKY_LLM_PROVIDER: "local-only",
    // Non-TTY / no-color so any captured text is stable.
    CI: "true",
    // No telemetry endpoint — consent records locally, never POSTs.
    MINSKY_TELEMETRY_ENDPOINT: "",
    ...opts.launcherEnv,
  };

  /**
   * @param {string[]} args
   * @param {string} [cwd]
   * @returns {{ status: number, stdout: string }}
   */
  const run = (args, cwd) => {
    const r = spawnSync("bash", [BIN_MINSKY, ...args], {
      encoding: "utf8",
      env: baseEnv,
      cwd: cwd ?? opts.fixtureRepo,
      timeout: 20_000,
    });
    return { status: r.status ?? -1, stdout: r.stdout ?? "" };
  };

  /** @type {{ name: string, status: number }[]} */
  const steps = [];

  // Step 1 — init (writes config.json with default_host = fixtureRepo).
  const init = run(["init", opts.fixtureRepo]);
  steps.push({ name: "init", status: init.status });

  // Step 2 — consent (writes telemetry-consent.json; reads MINSKY_AGENT).
  const consent = run(["consent", "--yes"], opts.fixtureRepo);
  steps.push({ name: "consent", status: consent.status });

  // Step 3 — capture the advertised subcommand surface.
  const help = run(["--help"], opts.fixtureRepo);
  steps.push({ name: "help", status: help.status });

  return {
    ok: steps.every((s) => s.status === 0),
    helpText: help.stdout,
    stateDir,
    steps,
  };
}
