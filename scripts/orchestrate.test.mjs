// Tests for orchestrate.mjs. The conductor's deterministic decision
// (rule #10 — no I/O in the decision) is `decideHeal`; the I/O wiring
// (pgrep / launchctl / runGateSweep) is validated by the `--once` run.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import { buildTickLedgerLine, decideHeal } from "./orchestrate.mjs";

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
