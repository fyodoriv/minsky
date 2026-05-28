// Pins the supervisor-stays-alive --loop flag in bin/minsky-run.sh.
//
// History: 2026-05-28 the live supervisor exited after 3 iterations
// and never restarted. launchctl print showed "state = not running,
// last exit code = 0" — launchd's KeepAlive: SuccessfulExit=false (OTP
// transient restart) treats exit 0 as "completed successfully" and
// refuses to respawn. Root cause: bin/minsky-run.sh called walk_hosts
// once and exited. PR #983 added a while-true loop keyed on
// MAX_ITERATIONS=0 — but that broke the many bats / integration tests
// that invoke the script in unbounded mode expecting it to exit. This
// refinement makes the loop opt-in via the new `--loop` flag and
// updates the launchd bootstrap (distribution/systemd/run-tick-loop.sh)
// to pass it. Ad-hoc callers and tests get the historical one-walk-
// and-exit default; the supervisor gets the while-true loop.
//
// These tests pin: (a) the structural elements (trap, while-true loop
// gated by LOOP_FOREVER, 75-propagation, --loop flag parsing) are
// present in the source, (b) the run-tick-loop.sh bootstrap passes
// --loop, (c) default mode (no --loop) runs one walk and exits with
// no deadlock. A live integration test of --loop itself would deadlock
// the test runner; the source-level check is the practical gate.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUN_SH = join(REPO_ROOT, "bin", "minsky-run.sh");
const RUN_TICK_LOOP_SH = join(REPO_ROOT, "distribution", "systemd", "run-tick-loop.sh");

describe("supervisor-stays-alive: --loop flag keeps the supervisor running", () => {
  test("source contains a SIGTERM/SIGINT trap that exits 0", () => {
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(/trap\b.*\bexit 0\b.*\bTERM\b/);
  });

  test("source contains a while-true loop guarded by LOOP_FOREVER==1", () => {
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(/\$LOOP_FOREVER["\s]+==/);
    expect(src).toMatch(/while true\b[\s\S]+walk_hosts/);
  });

  test("argv parser accepts --loop flag", () => {
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(/--loop\)\s+LOOP_FOREVER=1/);
  });

  test("source propagates exit 75 (restart-sentinel) from walk_hosts", () => {
    const src = readFileSync(RUN_SH, "utf8");
    // Without this, the post-merge auto-installer's restart sentinel is
    // dropped silently and operators don't get the freshly-updated code.
    expect(src).toMatch(/walk_exit.*-eq 75\b[\s\S]+exit 75/);
  });

  test("run-tick-loop.sh passes --loop to bin/minsky-run.sh", () => {
    // The launchd / systemd bootstrap MUST pass --loop or the supervisor
    // dies after one walk (the bug this PR closes).
    const src = readFileSync(RUN_TICK_LOOP_SH, "utf8");
    expect(src).toMatch(/exec bash[^\n]+minsky-run\.sh[^\n]*\s--loop\b/);
  });

  test("default mode (no --loop) runs ONE walk and exits — historical default preserved", () => {
    // Without --loop, the script must take the else branch (one walk,
    // exit). Use --dry-run to skip the openhands invariant + picker so
    // the test runs on any CI runner. 15s timeout would catch a
    // regression that accidentally made --loop the default.
    const stdout = execSync(`bash ${RUN_SH} --dry-run --host ${REPO_ROOT} 2>&1 | head -3`, {
      encoding: "utf8",
      timeout: 15_000,
      cwd: REPO_ROOT,
    });
    expect(stdout.length).toBeGreaterThan(0);
  });
});
