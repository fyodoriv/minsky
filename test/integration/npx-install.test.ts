/**
 * `npx minsky` (no subcommand) install-and-run flow smoke test
 * (`minsky-npx-install-and-run`).
 *
 * The sibling `npx-init-tarball.test.ts` pins the `npx minsky init`
 * half (tarball is publishable + `init` writes the config). This file
 * pins the OTHER half: the `npx minsky` (NO subcommand) routing that the
 * `minsky-npx-install-and-run` task adds to `bin/minsky`:
 *
 *   1. `minsky --version` / `minsky version` print the package version
 *      and exit 0 with ZERO side-effects (probe mode — Success §3). No
 *      config file is written; no daemon is started.
 *   2. The npx-bootstrap branch is GATED on an interactive TTY (criterion
 *      iii). A non-interactive `npx minsky` run (CI, piped stdin) must
 *      NOT silently write `~/.minsky/config.json` — it falls through to
 *      the normal start-or-attach path, leaving config untouched.
 *   3. `MINSKY_SKIP_NPX_INIT=1` is the documented opt-out (rule #11): even
 *      under an npx-flagged invocation it skips the bootstrap.
 *
 * Why an integration test (AGENTS.md rule 3b): the routing lives in the
 * bash shim, not in a pure function — only exercising the real
 * `bin/minsky` catches the wiring between npx env detection, the config
 * probe, and the TTY guard. Unit tests of a pure resolver would miss it.
 *
 * Hypothesis (rule #9): if these invariants hold, `npx minsky` on a fresh
 * machine reaches a live iteration in one shell line (the bootstrap fires
 * on a real TTY) while never clobbering a scripted/CI run.
 * Success: every test below passes.
 * Pivot: if an operator reports `npx minsky` bootstrapping in a context
 *   where it shouldn't (or NOT bootstrapping on a real TTY), add the
 *   specific env shape as a new invariant here.
 * Measurement: this file (opt-in via MINSKY_RUN_INTEGRATION=1).
 * Anchor: rule #1 (npm is the universal Node distribution channel);
 *   rule #11 (default-by-default with a documented opt-out);
 *   Krug *Don't Make Me Think* 2014 (one obvious path).
 *
 * Opt-in via MINSKY_RUN_INTEGRATION=1 (same shape as the neighbouring
 * shell-out integration tests — lefthook's stripped PATH can't run these
 * reliably; `pnpm test:integration` sets the env var).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const BIN = join(REPO_ROOT, "bin", "minsky");

const RUN_INTEGRATION =
  process.env["MINSKY_RUN_INTEGRATION"] === "1" ||
  process.env["CI"] === "true" ||
  process.env["VITEST_INTEGRATION"] === "1";

const PKG_VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  .version as string;

/** Append known system locations as a fallback without unseating the
 * pinned node already first on PATH (same pattern as npx-init-tarball). */
function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
    ...extra,
  };
}

/** Run `bin/minsky` with the given args + env, capturing stdout/exit.
 * stdin is piped (NOT a TTY) so the npx-bootstrap TTY guard stays closed
 * unless a test explicitly intends otherwise. */
function runMinsky(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("bash", [BIN, ...args], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; status?: number };
    return { stdout: String(e.stdout ?? ""), exitCode: e.status ?? 1 };
  }
}

describe.skipIf(!RUN_INTEGRATION)("`npx minsky` install-and-run routing", () => {
  test("`minsky --version` prints the package version, exits 0, writes no config", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "minsky-npx-ver-"));
    const work = mkdtempSync(join(tmpdir(), "minsky-npx-work-"));
    const { stdout, exitCode } = runMinsky(
      ["--version"],
      baseEnv({ MINSKY_STATE_DIR: stateDir }),
      work,
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(PKG_VERSION);
    // Probe mode: no side-effects (no config written).
    expect(existsSync(join(stateDir, "config.json"))).toBe(false);
  });

  test("`minsky version` (subcommand form) matches `--version`", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "minsky-npx-ver2-"));
    const work = mkdtempSync(join(tmpdir(), "minsky-npx-work2-"));
    const { stdout, exitCode } = runMinsky(
      ["version"],
      baseEnv({ MINSKY_STATE_DIR: stateDir }),
      work,
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(PKG_VERSION);
    expect(existsSync(join(stateDir, "config.json"))).toBe(false);
  });

  test("non-interactive npx run does NOT bootstrap (TTY guard protects CI)", () => {
    // Simulate `npx minsky` (npm sets npm_config_user_agent) but with
    // piped stdin (not a TTY) — the CI / scripted case. The bootstrap
    // must NOT write config; it falls through to start-or-attach.
    // MINSKY_REPO points at a nonexistent path so the start path exits
    // at the resolver instead of launching a real daemon.
    const stateDir = mkdtempSync(join(tmpdir(), "minsky-npx-noinit-"));
    const work = mkdtempSync(join(tmpdir(), "minsky-npx-noinit-work-"));
    const { exitCode } = runMinsky(
      [],
      baseEnv({
        MINSKY_STATE_DIR: stateDir,
        MINSKY_SKIP_DOCTOR: "1",
        npm_config_user_agent: "npm/10.0.0 node/v20.0.0 npx",
        MINSKY_REPO: "/nonexistent-minsky-npx-test",
      }),
      work,
    );
    // No config bootstrapped (TTY guard held).
    expect(existsSync(join(stateDir, "config.json"))).toBe(false);
    // The start path failed loudly at the resolver (no silent daemon).
    expect(exitCode).not.toBe(0);
  });

  test("MINSKY_SKIP_NPX_INIT=1 opt-out skips the bootstrap under npx", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "minsky-npx-optout-"));
    const work = mkdtempSync(join(tmpdir(), "minsky-npx-optout-work-"));
    const { exitCode } = runMinsky(
      [],
      baseEnv({
        MINSKY_STATE_DIR: stateDir,
        MINSKY_SKIP_DOCTOR: "1",
        MINSKY_SKIP_NPX_INIT: "1",
        npm_config_user_agent: "npm/10.0.0 node/v20.0.0 npx",
        MINSKY_REPO: "/nonexistent-minsky-npx-test",
      }),
      work,
    );
    expect(existsSync(join(stateDir, "config.json"))).toBe(false);
    expect(exitCode).not.toBe(0);
  });
});
