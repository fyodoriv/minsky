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

import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  test("run-tick-loop.sh gates on endpoint-ready + opt-in enable (EPM anti-hammer)", () => {
    const src = readFileSync(RUN_TICK_LOOP_SH, "utf8");
    expect(src).toMatch(/endpoint-ready sentinel missing/);
    expect(src).toMatch(/minsky enable-tick-loop/);
    expect(src).toMatch(/MINSKY_JQ unset/);
    expect(src).toMatch(/exit 0/);
  });

  test("default mode (no --loop) runs ONE walk and exits — historical default preserved", () => {
    // Without --loop, the script must take the else branch (one walk,
    // exit). Use --dry-run to skip the openhands invariant + picker so
    // the test runs on any CI runner. 15s timeout would catch a
    // regression that accidentally made --loop the default.
    const host = mkdtempSync(join(tmpdir(), "minsky-no-loop-host-"));
    const fakeBin = mkdtempSync(join(tmpdir(), "minsky-no-loop-bin-"));
    const configPath = join(mkdtempSync(join(tmpdir(), "minsky-no-loop-config-")), "config.json");
    execSync("git init -q", { cwd: host });
    mkdirSync(join(host, ".minsky"), { recursive: true });
    writeFileSync(join(host, ".minsky", "repo.yaml"), "task_source: tasks-md\n");
    writeFileSync(join(host, "TASKS.md"), "# Tasks\n\n## P0\n\n## P1\n\n## P2\n\n## P3\n");
    writeFileSync(
      configPath,
      JSON.stringify({ cloud_agent: "claude", local_agent: "aider", local_llm_enabled: false }),
    );
    writeFileSync(
      join(fakeBin, "gh"),
      [
        "#!/usr/bin/env bash",
        'if [[ "$1 $2" == "repo view" ]]; then echo "fixture/host"; exit 0; fi',
        'if [[ "$1 $2" == "pr list" && " $* " == *" --jq "* ]]; then exit 0; fi',
        'if [[ "$1 $2" == "pr list" ]]; then echo "[]"; exit 0; fi',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = spawnSync("bash", [RUN_SH, "--dry-run", "--host", host], {
      encoding: "utf8",
      timeout: 15_000,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MINSKY_CONFIG: configPath,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`.length).toBeGreaterThan(0);
  });
});
