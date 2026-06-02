// Tests for orchestrate.mjs. The conductor's deterministic decision
// (rule #10 — no I/O in the decision) is `decideHeal`; the I/O wiring
// (pgrep / launchctl / runGateSweep) is validated by the `--once` run.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import {
  buildTickLedgerLine,
  decideHeal,
  decideWorkerPausePids,
  parseLaunchctlRunning,
} from "./orchestrate.mjs";

describe("decideHeal (conductor self-heal decision)", () => {
  it("worker alive ⇒ ok (no heal)", () => {
    expect(decideHeal(true)).toBe("ok");
  });
  it("worker down ⇒ heal", () => {
    expect(decideHeal(false)).toBe("heal");
  });
  it("is pure / deterministic — same input, same output", () => {
    expect(decideHeal(true)).toBe(decideHeal(true));
    expect(decideHeal(false)).toBe(decideHeal(false));
  });
});

// Regression tests for `local-gate-merge-false-negative-on-worktree-bound-
// branch-delete` (TASKS.md), conductor-side. `runGateSweep` already counts a
// worktree-bound-delete soft-fail as MERGED via the `gh pr view --json state`
// oracle; these pin that the conductor's `.minsky/orchestrate.jsonl`
// `merged:[]` accounting carries that PR number through — so the autonomous
// path agrees with the manual `local-gate-merge.mjs` path.
describe("buildTickLedgerLine (conductor merge-accounting)", () => {
  const ctx = { ts: "2026-05-17T06:11:28Z", workerAlive: true, healed: false };

  it("includes a soft-fail-merged PR number in merged:[] (worktree-bound-delete)", () => {
    // The sweep counted #575 as merged despite gh's non-zero exit on the
    // post-merge local branch-delete (remote squash-merge succeeded).
    const res = { merged: [{ number: 575 }], skipped: [] };
    const line = buildTickLedgerLine(res, ctx);
    expect(line.merged).toEqual([575]);
    expect(line.skipped).toBe(0);
  });

  it("keeps a genuinely-failed merge out of merged:[] (no false positive)", () => {
    const res = { merged: [], skipped: [{ number: 999 }] };
    const line = buildTickLedgerLine(res, ctx);
    expect(line.merged).toEqual([]);
    expect(line.skipped).toBe(1);
  });

  it("records a sweep error and an empty merged:[] without throwing", () => {
    const res = { merged: [], skipped: [] };
    const line = buildTickLedgerLine(res, { ...ctx, sweepError: "boom" });
    expect(line.merged).toEqual([]);
    expect(line.sweepError).toBe("boom");
  });

  it("omits sweepError when none occurred", () => {
    const line = buildTickLedgerLine({ merged: [], skipped: [] }, ctx);
    expect("sweepError" in line).toBe(false);
  });
});

// Regression tests for `worker-liveness-detect-by-label-not-argv` (TASKS.md):
// liveness is the launchd supervisor's truth (`state = running`), not an
// argv-substring grep that breaks when the worker fans out via
// `--spawn-additional-workers=N`. `parseLaunchctlRunning` is the pure seam
// `workerDaemonAlive` feeds; `decideHeal` consumes its boolean.
describe("parseLaunchctlRunning (launchd-label liveness, not argv grep)", () => {
  // Verbatim shape of `launchctl print gui/<uid>/<label>` for a running job.
  const RUNNING = ["com.minsky.opus-sonnet-run = {", "\tstate = running", "\tpid = 4242", "}"].join(
    "\n",
  );

  it("alive when the top-level job state = running", () => {
    expect(parseLaunchctlRunning(RUNNING)).toBe(true);
  });

  it("alive regardless of worker argv shape (--spawn-additional-workers=N)", () => {
    // The whole point: the worker's argv no longer contains `--worker-id=0`,
    // yet launchd still reports the job running. The old pgrep would miss it.
    const noWorkerId0 = [
      "com.minsky.opus-sonnet-run = {",
      "\tstate = running",
      "\targuments = { tick-loop.mjs --spawn-additional-workers=3 }",
      "}",
    ].join("\n");
    expect(parseLaunchctlRunning(noWorkerId0)).toBe(true);
  });

  it("down when the job is not running (state = waiting)", () => {
    const waiting = ["com.minsky.opus-sonnet-run = {", "\tstate = waiting", "}"].join("\n");
    expect(parseLaunchctlRunning(waiting)).toBe(false);
  });

  it("down when launchctl reports the service is not loaded (empty/error)", () => {
    expect(parseLaunchctlRunning("")).toBe(false);
    expect(
      parseLaunchctlRunning('Could not find service "com.minsky.opus-sonnet-run" in domain'),
    ).toBe(false);
  });

  it("a nested sub-job `state = active` alone does NOT read as alive", () => {
    // launchctl nests endpoint sub-jobs deeper-indented; only the top-level
    // (single-tab) `state = running` is the daemon's own liveness.
    const nestedOnly = [
      "com.minsky.opus-sonnet-run = {",
      "\tstate = waiting",
      "\tendpoints = {",
      "\t\tstate = active",
      "\t}",
      "}",
    ].join("\n");
    expect(parseLaunchctlRunning(nestedOnly)).toBe(false);
  });

  it("is pure / deterministic — same input, same output", () => {
    expect(parseLaunchctlRunning(RUNNING)).toBe(parseLaunchctlRunning(RUNNING));
    expect(parseLaunchctlRunning("")).toBe(parseLaunchctlRunning(""));
  });

  it("feeds decideHeal correctly: running ⇒ ok, not-loaded ⇒ heal", () => {
    expect(decideHeal(parseLaunchctlRunning(RUNNING))).toBe("ok");
    expect(decideHeal(parseLaunchctlRunning(""))).toBe("heal");
  });
});

// gate-host-load-shed: the conductor SIGSTOPs the worker daemon's iteration
// processes for the duration of a gate vet so gate-vet and worker-tick never
// run vitest simultaneously under host oversubscription. `decideWorkerPausePids`
// is the pure pid-selection (rule #10 — no I/O); it MUST exclude the conductor's
// own pid so a load-shed pause can never freeze the conductor.
describe("decideWorkerPausePids (load-shed pid selection)", () => {
  it("parses pgrep output into integer pids", () => {
    expect(decideWorkerPausePids("4101\n4102\n4103\n", 9999)).toEqual([4101, 4102, 4103]);
  });

  it("excludes the conductor's own pid (never freeze self)", () => {
    expect(decideWorkerPausePids("4101\n5000\n4103\n", 5000)).toEqual([4101, 4103]);
  });

  it("drops blank lines, non-numeric, and non-positive entries", () => {
    expect(decideWorkerPausePids("4101\n\n  \nnotapid\n0\n-7\n4102\n", 1)).toEqual([4101, 4102]);
  });

  it("empty pgrep output ⇒ nothing to pause", () => {
    expect(decideWorkerPausePids("", 1)).toEqual([]);
  });

  it("is pure / deterministic — same input, same output", () => {
    expect(decideWorkerPausePids("4101\n4102\n", 1)).toEqual(
      decideWorkerPausePids("4101\n4102\n", 1),
    );
  });
});
