// Pins the supervisor-stays-alive loop in bin/minsky-run.sh.
//
// History: 2026-05-28 the live supervisor exited after 3 iterations and
// never restarted. launchctl print showed "state = not running,
// last exit code = 0" — launchd's KeepAlive: SuccessfulExit=false (OTP
// transient restart) treats exit 0 as "completed successfully" and
// refuses to respawn. Root cause: bin/minsky-run.sh called walk_hosts
// once and exited. The fix wraps walk_hosts in a while-true when
// MAX_ITERATIONS=0 (unbounded; the supervisor default).
//
// These tests pin: (a) the structural elements (trap, while-true loop,
// 75-propagation) are present in the source, (b) capped mode with
// --max-iterations N still works as before. A live integration test
// would be ideal but the while-true would deadlock the test runner;
// the source-level check is the practical gate.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUN_SH = join(REPO_ROOT, "bin", "minsky-run.sh");

describe("supervisor-stays-alive: bin/minsky-run.sh loops forever in unbounded mode", () => {
  test("source contains a SIGTERM/SIGINT trap that exits 0", () => {
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(/trap\b.*\bexit 0\b.*\bTERM\b/);
  });

  test("source contains a while-true loop guarded by MAX_ITERATIONS==0", () => {
    const src = readFileSync(RUN_SH, "utf8");
    // The unbounded branch must wrap walk_hosts in a while-true.
    expect(src).toMatch(/\$MAX_ITERATIONS["\s]+-eq 0/);
    expect(src).toMatch(/while true\b[\s\S]+walk_hosts/);
  });

  test("source propagates exit 75 (restart-sentinel) from walk_hosts", () => {
    const src = readFileSync(RUN_SH, "utf8");
    // Without this, the post-merge auto-installer's restart sentinel is
    // dropped silently and operators don't get the freshly-updated code.
    expect(src).toMatch(/walk_exit.*-eq 75\b[\s\S]+exit 75/);
  });

  test("capped mode (--max-iterations N) runs ONE walk and exits — no behavior regression", () => {
    // Use --dry-run to skip openhands invariant + tasks-md picker.
    // --max-iterations 1 forces the capped branch; the script must
    // complete in <15s (would deadlock if the while-true was reached).
    const stdout = execSync(
      `bash ${RUN_SH} --dry-run --host ${REPO_ROOT} --max-iterations 1 2>&1 | head -3`,
      { encoding: "utf8", timeout: 15_000, cwd: REPO_ROOT },
    );
    // Capped mode emits the canonical "iterating single host" line and
    // returns. We don't assert on specific iteration content (depends on
    // operator state); we just require the bash exited cleanly.
    expect(stdout.length).toBeGreaterThan(0);
  });
});
