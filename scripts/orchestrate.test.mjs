// Tests for orchestrate.mjs. The conductor's deterministic decision
// (rule #10 — no I/O in the decision) is `decideHeal`; the I/O wiring
// (pgrep / launchctl / runGateSweep) is validated by the `--once` run.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import { buildTickLedgerLine, decideHeal, decideWorkerPausePids } from "./orchestrate.mjs";

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
