// Paired test for the `bin/minsky` bash shim's `stop` subcommand — the
// first paired test for the shim (TASKS.md `minsky-stop-host-filter`).
//
// The shim is bash, so we test it the way `test/integration/
// bin-minsky-multi-agent-safety.test.ts` tests `reset-host-if-crashed`:
// spawn the real `bin/minsky` with a fabricated PATH whose `pgrep` /
// `pkill` / `launchctl` are deterministic mocks. `kill` is a bash
// builtin (so PATH-mocking won't reach it), and we can't rely on real
// cross-process SIGTERM either — macOS process restrictions deny EPERM
// when a bash subprocess tries to signal a node-spawned sibling
// (reproduces 100% under the Claude Code sandbox and under launchd
// child contexts; the pgrep-mock-mismatch task documents this). We
// override `kill` via a BASH_ENV-loaded shell function instead, which
// records each invocation to a log the test asserts against.
//
// Hypothesis (rule #9): `minsky stop --host <dir>` SIGTERMs ONLY the
// minsky-run whose argv carries the matching `--host`, leaving every
// other operator's runner alive; `minsky stop` with no flag prints the
// host-list banner + 3s grace period (skipped under
// MINSKY_NON_INTERACTIVE=1) and then kills globally.
// Success: every assertion below passes.
// Measurement: this file (`vitest run bin/minsky.test.mjs`).
// Anchor: TASKS.md `minsky-stop-host-filter`; rule #6 (let-it-crash at
// the RIGHT boundary); AGENTS.md §3b (CLI integration tests).

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

/**
 * The shim resolves `--host <dir>` via realpath before building the
 * pgrep pattern (so a relative `--host ./repo` matches the runner's
 * absolute argv). On macOS `mkdtempSync` under `/tmp` resolves to
 * `/private/tmp`, so the mock's pgrep branch must key on the SAME
 * canonical path the shim computes — otherwise it never matches.
 *
 * @param {string} p
 * @returns {string}
 */
function canonical(p) {
  return realpathSync(p);
}

/**
 * Throwaway child processes spawned by a test, tracked so we can reap
 * them in afterEach AND so each test can observe a clean exit (a Node
 * child that's signalled but not yet reaped lingers as a zombie, which
 * `process.kill(pid, 0)` still reports as alive — checking the child's
 * own `exited` flag is the reliable signal).
 *
 * @type {{ child: import("node:child_process").ChildProcess, exited: boolean }[]}
 */
const sleepers = [];

afterEach(() => {
  for (const s of sleepers.splice(0)) {
    try {
      s.child.kill("SIGKILL");
    } catch {
      // already gone — that's the point of the test
    }
  }
});

/**
 * Spawn a real, long-lived `sleep` process and track it. Returns a
 * handle whose `pid` is a real signalable target (so the shim's
 * `kill -TERM` builtin actually does something) and whose `exited` flag
 * flips true once the child terminates and is reaped.
 *
 * @returns {{ pid: number, isAlive: () => boolean }}
 */
function spawnSleeper() {
  const child = spawn("sleep", ["120"], { stdio: "ignore" });
  const handle = { child, exited: false };
  child.on("exit", () => {
    handle.exited = true;
  });
  sleepers.push(handle);
  return {
    pid: /** @type {number} */ (child.pid),
    isAlive: () => !handle.exited,
  };
}

/**
 * Build a tmp dir holding mock `pgrep` / `pkill` / `launchctl` binaries
 * and a BASH_ENV file that overrides the `kill` bash builtin with a
 * shell function. `pgrep` emits the PIDs registered for the matched
 * `--host <dir>` pattern; with `-af` it emits a fake `ps`-style line
 * per host so the no-filter banner has something to list. `pkill` /
 * `launchctl` invocations are appended to `calls.log` for assertion.
 * `launchctl list` emits nothing, so the global path's bootout is a
 * no-op. Every `kill -<sig> <pid>` the shim invokes is appended to
 * `kill.log` instead of being delivered as a real signal — works
 * regardless of whether the host kernel would allow a bash subprocess
 * to signal node-spawned siblings.
 *
 * @param {{ hostPids: Record<string, number[] | string[]>, allHosts?: string[] }} cfg
 */
function makeMockBin(cfg) {
  const binDir = mkdtempSync(join(tmpdir(), "minsky-stop-bin-"));
  const callsLog = join(binDir, "calls.log");
  const killLog = join(binDir, "kill.log");
  writeFileSync(callsLog, "");
  writeFileSync(killLog, "");

  const hostBranches = Object.entries(cfg.hostPids)
    .map(([dir, pids]) => `    *"--host ${dir}"*) ${pids.map((p) => `echo "${p}"`).join("; ")} ;;`)
    .join("\n");
  const afLines = (cfg.allHosts ?? Object.keys(cfg.hostPids))
    .map((dir, i) => `9${i}00 node minsky-run --host ${dir}`)
    .join("\\n");

  const pgrep = `#!/bin/bash
case "$*" in
  *-af*)
    printf '%b\\n' "${afLines}"
    exit 0
    ;;
${hostBranches}
  *) ;;
esac
exit 0
`;
  writeFileSync(join(binDir, "pgrep"), pgrep);

  for (const tool of ["pkill", "launchctl"]) {
    writeFileSync(join(binDir, tool), `#!/bin/bash\necho "${tool} $*" >> "${callsLog}"\nexit 0\n`);
  }

  for (const f of ["pgrep", "pkill", "launchctl"]) {
    chmodSync(join(binDir, f), 0o755);
  }

  // BASH_ENV-loaded `kill` mock. Bash sources BASH_ENV at startup for
  // every non-interactive shell, so this function is in scope before
  // the shim's first `set -euo pipefail`. The function records args
  // and returns 0 — the shim's `if kill -TERM "$pid" ...; then` branch
  // counts the kill as delivered.
  const bashEnv = join(binDir, "bash-env.sh");
  writeFileSync(
    bashEnv,
    `kill() {\n  echo "kill $*" >> "${killLog}"\n  return 0\n}\nexport -f kill\n`,
  );

  return {
    binDir,
    callsLog,
    killLog,
    bashEnv,
    readCalls: () => readFileSync(callsLog, "utf8"),
    readKills: () => readFileSync(killLog, "utf8"),
  };
}

/**
 * Spawn `bin/minsky stop <...args>` with the mock bin dir prepended to
 * PATH. Returns combined stdout. MINSKY_STATE_DIR is isolated so no real
 * `~/.minsky/daemon.pid` is touched.
 *
 * @param {string[]} args
 * @param {{ binDir: string, env?: Record<string,string> }} opts
 */
function runStop(args, opts) {
  const stateDir = mkdtempSync(join(tmpdir(), "minsky-stop-state-"));
  return execFileSync(MINSKY_BIN, ["stop", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${opts.binDir}:${process.env.PATH ?? ""}`,
      MINSKY_STATE_DIR: stateDir,
      BASH_ENV: join(opts.binDir, "bash-env.sh"),
      ...(opts.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("minsky stop --host <dir> — per-host kill switch", () => {
  test("SIGTERMs only the minsky-run matching the --host dir; other host untouched", () => {
    // Fake PIDs: the BASH_ENV-loaded `kill` mock records args instead
    // of signalling, so we verify intent (the shim invoked `kill -TERM`
    // on exactly the matched-host PIDs) rather than signal delivery
    // (which a node-spawned sibling can't observe under macOS process
    // restrictions / sandboxed test runners).
    const aPids = [990001, 990002];
    const bPid = 990003;
    const hostA = mkdtempSync(join(tmpdir(), "host-a-"));
    const hostB = mkdtempSync(join(tmpdir(), "host-b-"));
    const mock = makeMockBin({
      hostPids: { [canonical(hostA)]: aPids, [canonical(hostB)]: [bPid] },
    });

    const out = runStop(["--host", hostA], { binDir: mock.binDir });

    expect(out).toContain(`pid ${aPids[0]}`);
    expect(out).toContain(`pid ${aPids[1]}`);
    expect(out).toContain("SIGTERM sent to 2 runner(s)");
    expect(out).toContain("other hosts untouched");

    // The shim's `kill -TERM` ran for both host-a pids and nothing else.
    const kills = mock.readKills();
    expect(kills).toContain(`kill -TERM ${aPids[0]}`);
    expect(kills).toContain(`kill -TERM ${aPids[1]}`);
    expect(kills).not.toContain(`kill -TERM ${bPid}`);

    // No global pkill, no launchd bootout in --host mode.
    const calls = mock.readCalls();
    expect(calls).not.toContain("pkill");
    expect(calls).not.toContain("launchctl");
  });

  test("no matching runner for the host → 'nothing to stop', exit 0, nothing killed", () => {
    const other = spawnSleeper();
    const hostA = mkdtempSync(join(tmpdir(), "host-a-"));
    const otherDir = mkdtempSync(join(tmpdir(), "other-"));
    const mock = makeMockBin({ hostPids: { [canonical(otherDir)]: [other.pid] } });

    const out = runStop(["--host", hostA], { binDir: mock.binDir });

    expect(out).toContain("nothing to stop for host=");
    expect(other.isAlive()).toBe(true);
  });

  test("--host with no argument exits 2 with a usage hint", () => {
    const mock = makeMockBin({ hostPids: {} });
    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync(MINSKY_BIN, ["stop", "--host"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${mock.binDir}:${process.env.PATH ?? ""}` },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--host requires a directory argument");
  });
});

describe("minsky stop (no flag) — global kill with grace banner", () => {
  test("MINSKY_NON_INTERACTIVE=1 skips the banner and runs the global pkill", () => {
    const hostA = mkdtempSync(join(tmpdir(), "host-a-"));
    const hostB = mkdtempSync(join(tmpdir(), "host-b-"));
    const mock = makeMockBin({
      hostPids: { [canonical(hostA)]: ["1111", "2222"], [canonical(hostB)]: ["3333"] },
      allHosts: [hostA, hostB],
    });

    const out = runStop([], { binDir: mock.binDir, env: { MINSKY_NON_INTERACTIVE: "1" } });

    expect(out).not.toContain("Ctrl-C within 3s to abort");
    expect(mock.readCalls()).toContain("pkill -TERM -f cross-repo-runner/bin/minsky-run");
  });

  test("interactive (default) prints the host-list banner before killing", () => {
    const hostA = mkdtempSync(join(tmpdir(), "host-a-"));
    const hostB = mkdtempSync(join(tmpdir(), "host-b-"));
    const mock = makeMockBin({
      hostPids: { [canonical(hostA)]: ["1111"], [canonical(hostB)]: ["3333"] },
      allHosts: [hostA, hostB],
    });

    const out = runStop([], { binDir: mock.binDir });

    expect(out).toContain("about to SIGTERM EVERY minsky-run");
    expect(out).toContain("hosts affected");
    expect(out).toContain(hostA);
    expect(out).toContain(hostB);
    expect(out).toContain("minsky stop --host <dir>");
    expect(out).toContain("Ctrl-C within 3s to abort");
    expect(mock.readCalls()).toContain("pkill -TERM -f cross-repo-runner/bin/minsky-run");
  });
});
