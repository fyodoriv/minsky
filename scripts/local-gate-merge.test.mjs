// Tests for local-gate-merge.mjs — pure decision functions + injected-seam
// sweep. No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import {
  decideLand,
  decideMerge,
  decidePreflight,
  landLocalBranch,
  parseGateVerdict,
  parseReview,
  pickGateCandidates,
  runGateSweep,
} from "./local-gate-merge.mjs";

/** @param {Partial<import("./local-gate-merge.mjs").PrSnapshot> & {number:number}} p */
const pr = (p) => ({
  number: p.number,
  isDraft: p.isDraft ?? false,
  mergeable: p.mergeable ?? "MERGEABLE",
  baseRefName: p.baseRefName ?? "main",
  headRefName: p.headRefName ?? `feat/${p.number}`,
  title: p.title ?? `PR ${p.number}`,
});

describe("pickGateCandidates", () => {
  it("keeps non-draft, non-CONFLICTING, base=main PRs", () => {
    const got = pickGateCandidates([
      pr({ number: 1 }),
      pr({ number: 2, isDraft: true }),
      pr({ number: 3, mergeable: "CONFLICTING" }),
      pr({ number: 4, baseRefName: "docs/x" }),
      pr({ number: 5, mergeable: "UNKNOWN" }),
    ]);
    expect(got.map((p) => p.number)).toEqual([1, 5]);
  });
});

describe("parseGateVerdict", () => {
  it("green when summary allPass=true and no failed steps", () => {
    const out = [
      JSON.stringify({ name: "biome", verdict: "pass" }),
      JSON.stringify({ name: "typecheck", verdict: "pass" }),
      JSON.stringify({ summary: true, stage: "full", allPass: true, stepCount: 2 }),
    ].join("\n");
    expect(parseGateVerdict(out)).toEqual({ green: true, failedSteps: [], sawSummary: true });
  });

  it("red + names the failed step when a step verdict=fail", () => {
    const out = [
      JSON.stringify({ name: "biome", verdict: "fail" }),
      JSON.stringify({ name: "vitest", verdict: "pass" }),
      JSON.stringify({ summary: true, allPass: false, stepCount: 2 }),
    ].join("\n");
    expect(parseGateVerdict(out)).toEqual({
      green: false,
      failedSteps: ["biome"],
      sawSummary: true,
    });
  });

  it("not green when summary is missing (vet did not complete)", () => {
    const out = JSON.stringify({ name: "biome", verdict: "pass" });
    expect(parseGateVerdict(out)).toEqual({ green: false, failedSteps: [], sawSummary: false });
  });

  it("ignores non-JSON and garbage lines", () => {
    const out = ["noise", "  ", "{bad json", JSON.stringify({ summary: true, allPass: true })].join(
      "\n",
    );
    expect(parseGateVerdict(out).green).toBe(true);
  });
});

describe("decideMerge", () => {
  const okVerdict = { green: true, failedSteps: [], sawSummary: true };
  it("merges on green", () => {
    expect(decideMerge({ pr: pr({ number: 1 }), verdict: okVerdict }).action).toBe("merge");
  });
  it("skips on vetError", () => {
    const d = decideMerge({
      pr: pr({ number: 1 }),
      verdict: { green: false, failedSteps: [], sawSummary: false },
      vetError: "merge-onto-main-conflict",
    });
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("merge-onto-main-conflict");
  });
  it("skips on red with the failed steps in the reason", () => {
    const d = decideMerge({
      pr: pr({ number: 1 }),
      verdict: { green: false, failedSteps: ["vitest"], sawSummary: true },
    });
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("vitest");
  });
  it("skips when the gate produced no summary", () => {
    expect(
      decideMerge({
        pr: pr({ number: 1 }),
        verdict: { green: false, failedSteps: [], sawSummary: false },
      }).action,
    ).toBe("skip");
  });
});

describe("runGateSweep (injected seam)", () => {
  const greenStdout = JSON.stringify({ summary: true, allPass: true, stepCount: 1 });
  const redStdout = [
    JSON.stringify({ name: "typecheck", verdict: "fail" }),
    JSON.stringify({ summary: true, allPass: false, stepCount: 1 }),
  ].join("\n");

  it("merges only the gate-green PR; skips the red one; never merges in dry-run", () => {
    const merged = /** @type {number[]} */ ([]);
    const base = {
      snapshotFn: () => [pr({ number: 10 }), pr({ number: 11 })],
      vetFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) => ({
        stdout: p.number === 10 ? greenStdout : redStdout,
      }),
      mergeFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) =>
        merged.push(p.number),
      noReview: true,
      log: () => {},
    };
    const real = runGateSweep(base);
    expect(merged).toEqual([10]);
    expect(real.merged.map((m) => m.number)).toEqual([10]);
    expect(real.skipped.map((s) => s.number)).toEqual([11]);

    merged.length = 0;
    const dry = runGateSweep({ ...base, dryRun: true });
    expect(merged).toEqual([]); // mergeFn never called in dry-run
    expect(dry.merged.map((m) => m.number)).toEqual([10]);
  });

  it("skips a vetError PR without calling mergeFn", () => {
    let mergeCalls = 0;
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 20 })],
      vetFn: () => ({ vetError: "merge-onto-main-conflict" }),
      mergeFn: () => {
        mergeCalls += 1;
      },
      log: () => {},
    });
    expect(mergeCalls).toBe(0);
    expect(res.skipped[0]?.reason).toContain("merge-onto-main-conflict");
  });

  it("records a merge-call failure as skipped, not merged", () => {
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 30 })],
      vetFn: () => ({ stdout: greenStdout }),
      mergeFn: () => {
        throw new Error("gh exploded");
      },
      // Genuine failure → state oracle returns "OPEN" (or null), confirms
      // the merge did NOT happen. Inject explicitly so the test doesn't
      // spawn real `gh`.
      prStateFn: () => "OPEN",
      noReview: true,
      log: () => {},
    });
    expect(res.merged).toEqual([]);
    expect(res.skipped[0]?.reason).toContain("merge-failed");
  });

  // Regression tests for `local-gate-merge-false-negative-on-worktree-
  // bound-branch-delete` (TASKS.md). The mergeFn throws because of the
  // worktree-bound-delete shape (remote merged, local `git branch -d`
  // failed), but the prStateFn confirms `state == "MERGED"`. The PR
  // must count as merged, not skipped. The fix shape was filed in the
  // 2026-05-17 live supervision session.

  it("counts a PR as MERGED when mergeFn throws but prStateFn returns 'MERGED' (worktree-bound-delete soft-fail)", () => {
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 575 })],
      vetFn: () => ({ stdout: greenStdout }),
      mergeFn: () => {
        // The canonical reproduction from 2026-05-17: gh's exit is non-zero
        // because the post-merge `git branch -d` rejects a branch checked
        // out in `.claude/worktrees/`, but the remote squash-merge HAS
        // already succeeded.
        throw new Error(
          "failed to delete local branch worktree-daemon-0-minsky-claude-exhaustion-persisted-state: cannot delete branch '…' used by worktree at '$MINSKY_REPO/.claude/worktrees/daemon-0-minsky-…'",
        );
      },
      prStateFn: () => "MERGED",
      noReview: true,
      log: () => {},
    });
    expect(res.merged.map((m) => m.number)).toEqual([575]);
    expect(res.merged[0]?.reason).toContain("local-delete soft-fail");
    expect(res.skipped).toEqual([]);
  });

  it("counts a PR as MERGED when mergeFn throws with `was already merged` and prStateFn confirms MERGED (re-run case)", () => {
    // A re-run of the gate against an already-merged PR also exits
    // non-zero on the worktree-bound-delete, but the stdout/stderr
    // contains "was already merged". Same state-oracle logic applies.
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 575 })],
      vetFn: () => ({ stdout: greenStdout }),
      mergeFn: () => {
        throw new Error("! Pull request fyodoriv/minsky#575 was already merged");
      },
      prStateFn: () => "MERGED",
      noReview: true,
      log: () => {},
    });
    expect(res.merged.map((m) => m.number)).toEqual([575]);
    expect(res.skipped).toEqual([]);
  });

  it("treats prStateFn returning null (probe failure) as not-merged → records merge-failed", () => {
    // Network/auth/unknown-PR probe failure must NOT silently mask a
    // genuine merge failure. defaultPrState returns null on catch; the
    // caller must treat that the same as "not MERGED".
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 999 })],
      vetFn: () => ({ stdout: greenStdout }),
      mergeFn: () => {
        throw new Error("gh: connection reset by peer");
      },
      prStateFn: () => null,
      noReview: true,
      log: () => {},
    });
    expect(res.merged).toEqual([]);
    expect(res.skipped[0]?.reason).toContain("merge-failed");
  });

  it("respects --pr (onlyPr) and limit", () => {
    const seen = /** @type {number[]} */ ([]);
    runGateSweep({
      snapshotFn: () => [pr({ number: 1 }), pr({ number: 2 }), pr({ number: 3 })],
      onlyPr: 2,
      vetFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) => {
        seen.push(p.number);
        return { stdout: greenStdout };
      },
      mergeFn: () => {},
      log: () => {},
    });
    expect(seen).toEqual([2]);
  });
});

describe("parseReview (Opus brain reply parsing — fail-safe)", () => {
  it("APPROVE ⇒ approve with reason", () => {
    expect(parseReview("APPROVE: intent matches title, low risk")).toEqual({
      approve: true,
      reason: "intent matches title, low risk",
    });
  });
  it("REJECT ⇒ not approved with reason", () => {
    const r = parseReview("REJECT: silently widens scope to unrelated module");
    expect(r.approve).toBe(false);
    expect(r.reason).toContain("widens scope");
  });
  it("case-insensitive; uses only the first line", () => {
    expect(parseReview("approve: ok\nblah blah").approve).toBe(true);
  });
  it("ambiguous/garbage ⇒ NOT approved (never merge on ambiguity)", () => {
    expect(parseReview("hmm I am not sure").approve).toBe(false);
    expect(parseReview("").approve).toBe(false);
  });
});

describe("decideMerge with Opus review", () => {
  const green = { green: true, failedSteps: [], sawSummary: true };
  it("gate-green + review approve ⇒ merge (reason notes opus-approved)", () => {
    const d = decideMerge({
      pr: pr({ number: 1 }),
      verdict: green,
      review: { approve: true, reason: "looks correct" },
    });
    expect(d.action).toBe("merge");
    expect(d.reason).toContain("opus-approved");
  });
  it("gate-green + review reject ⇒ skip", () => {
    const d = decideMerge({
      pr: pr({ number: 1 }),
      verdict: green,
      review: { approve: false, reason: "hidden risk in retry path" },
    });
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("opus-review rejected");
  });
  it("gate-red ⇒ skip regardless of review", () => {
    expect(
      decideMerge({
        pr: pr({ number: 1 }),
        verdict: { green: false, failedSteps: ["vitest"], sawSummary: true },
        review: { approve: true, reason: "x" },
      }).action,
    ).toBe("skip");
  });
});

describe("decidePreflight (skip-earlier gate — round-trip elimination)", () => {
  it("0 commits ahead ⇒ do NOT proceed (no scratch vet)", () => {
    const d = decidePreflight(0);
    expect(d.proceed).toBe(false);
    expect(d.reason).toContain("nothing-to-land");
  });
  it("negative / NaN ⇒ do NOT proceed (fail-safe)", () => {
    expect(decidePreflight(-1).proceed).toBe(false);
    expect(decidePreflight(Number.NaN).proceed).toBe(false);
  });
  it("≥1 commit ahead ⇒ proceed", () => {
    const d = decidePreflight(3);
    expect(d.proceed).toBe(true);
    expect(d.reason).toContain("3 commit");
  });
});

describe("decideLand (local-branch land decision)", () => {
  const green = { green: true, failedSteps: [], sawSummary: true };
  it("lands on green", () => {
    expect(decideLand({ verdict: green }).action).toBe("land");
  });
  it("aborts on vetError", () => {
    const d = decideLand({
      verdict: { green: false, failedSteps: [], sawSummary: false },
      vetError: "local-branch-not-found: feat/x",
    });
    expect(d.action).toBe("abort");
    expect(d.reason).toContain("local-branch-not-found");
  });
  it("aborts on red with failed steps named", () => {
    const d = decideLand({
      verdict: { green: false, failedSteps: ["biome"], sawSummary: true },
    });
    expect(d.action).toBe("abort");
    expect(d.reason).toContain("biome");
  });
  it("aborts when the gate produced no summary", () => {
    expect(
      decideLand({ verdict: { green: false, failedSteps: [], sawSummary: false } }).action,
    ).toBe("abort");
  });
  it("green + Opus reject ⇒ abort; green + Opus approve ⇒ land", () => {
    expect(
      decideLand({ verdict: green, review: { approve: false, reason: "scope creep" } }).action,
    ).toBe("abort");
    const ok = decideLand({ verdict: green, review: { approve: true, reason: "intent ok" } });
    expect(ok.action).toBe("land");
    expect(ok.reason).toContain("opus-approved");
  });
});

describe("landLocalBranch (injected seam)", () => {
  const greenStdout = JSON.stringify({ summary: true, allPass: true, stepCount: 1 });
  const redStdout = [
    JSON.stringify({ name: "typecheck", verdict: "fail" }),
    JSON.stringify({ summary: true, allPass: false, stepCount: 1 }),
  ].join("\n");

  it("skip-earlier gate: 0 commits ahead ⇒ never calls the expensive vet", () => {
    let vetCalls = 0;
    let landCalls = 0;
    const res = landLocalBranch({
      branchName: "feat/empty",
      commitsAheadFn: () => 0,
      vetFn: () => {
        vetCalls += 1;
        return { stdout: greenStdout };
      },
      landFn: () => {
        landCalls += 1;
      },
      log: () => {},
    });
    expect(vetCalls).toBe(0); // the ~20-min scratch vet was elided
    expect(landCalls).toBe(0);
    expect(res.outcome).toBe("aborted");
    expect(res.reason).toContain("nothing-to-land");
  });

  it("green vet ⇒ lands (calls landFn once)", () => {
    let landed = "";
    const res = landLocalBranch({
      branchName: "fix/keystone",
      commitsAheadFn: () => 3,
      vetFn: () => ({ stdout: greenStdout }),
      landFn: (b) => {
        landed = b;
      },
      log: () => {},
    });
    expect(res.outcome).toBe("landed");
    expect(landed).toBe("fix/keystone");
  });

  it("red vet ⇒ aborts and never lands", () => {
    let landCalls = 0;
    const res = landLocalBranch({
      branchName: "fix/broken",
      commitsAheadFn: () => 1,
      vetFn: () => ({ stdout: redStdout }),
      landFn: () => {
        landCalls += 1;
      },
      log: () => {},
    });
    expect(landCalls).toBe(0);
    expect(res.outcome).toBe("aborted");
    expect(res.reason).toContain("typecheck");
  });

  it("vetError ⇒ aborts without landing", () => {
    let landCalls = 0;
    const res = landLocalBranch({
      branchName: "fix/conflict",
      commitsAheadFn: () => 1,
      vetFn: () => ({ vetError: "merge-onto-main-conflict" }),
      landFn: () => {
        landCalls += 1;
      },
      log: () => {},
    });
    expect(landCalls).toBe(0);
    expect(res.reason).toContain("merge-onto-main-conflict");
  });

  it("dry-run ⇒ would-land verdict but landFn never called", () => {
    let landCalls = 0;
    const res = landLocalBranch({
      branchName: "fix/x",
      dryRun: true,
      commitsAheadFn: () => 2,
      vetFn: () => ({ stdout: greenStdout }),
      landFn: () => {
        landCalls += 1;
      },
      log: () => {},
    });
    expect(landCalls).toBe(0);
    expect(res.outcome).toBe("landed");
  });

  it("green vet + Opus reject ⇒ abort (two-layer authority)", () => {
    let landCalls = 0;
    const res = landLocalBranch({
      branchName: "fix/risky",
      commitsAheadFn: () => 1,
      vetFn: () => ({ stdout: greenStdout }),
      reviewFn: () => ({ approve: false, reason: "hidden risk" }),
      landFn: () => {
        landCalls += 1;
      },
      log: () => {},
    });
    expect(landCalls).toBe(0);
    expect(res.reason).toContain("opus-review rejected");
  });

  it("noReview ⇒ deterministic-only: green lands without calling reviewFn", () => {
    let reviewCalls = 0;
    const res = landLocalBranch({
      branchName: "fix/det",
      noReview: true,
      commitsAheadFn: () => 1,
      vetFn: () => ({ stdout: greenStdout }),
      reviewFn: () => {
        reviewCalls += 1;
        return { approve: false, reason: "should-not-run" };
      },
      landFn: () => {},
      log: () => {},
    });
    expect(reviewCalls).toBe(0);
    expect(res.outcome).toBe("landed");
  });

  it("a landFn throw is reported as aborted (land-failed), not landed", () => {
    const res = landLocalBranch({
      branchName: "fix/ghdown",
      commitsAheadFn: () => 1,
      vetFn: () => ({ stdout: greenStdout }),
      landFn: () => {
        throw new Error("gh exploded");
      },
      log: () => {},
    });
    expect(res.outcome).toBe("aborted");
    expect(res.reason).toContain("land-failed");
  });

  it("missing branch name ⇒ aborted (no-branch-name)", () => {
    const res = landLocalBranch({ branchName: "", log: () => {} });
    expect(res.outcome).toBe("aborted");
    expect(res.reason).toBe("no-branch-name");
  });
});

describe("runGateSweep — two-layer authority (gate + Opus brain)", () => {
  const greenStdout = JSON.stringify({ summary: true, allPass: true, stepCount: 1 });
  const redStdout = [
    JSON.stringify({ name: "vitest", verdict: "fail" }),
    JSON.stringify({ summary: true, allPass: false, stepCount: 1 }),
  ].join("\n");

  it("merges only when gate-green AND Opus approves; reviewFn skipped on gate-red (cost discipline)", () => {
    const reviewed = /** @type {number[]} */ ([]);
    const merged = /** @type {number[]} */ ([]);
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 40 }), pr({ number: 41 }), pr({ number: 42 })],
      // 40 green→approve, 41 green→reject, 42 red (review must NOT run)
      vetFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) => ({
        stdout: p.number === 42 ? redStdout : greenStdout,
      }),
      reviewFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) => {
        reviewed.push(p.number);
        return p.number === 40
          ? { approve: true, reason: "ok" }
          : { approve: false, reason: "risky" };
      },
      mergeFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) =>
        merged.push(p.number),
      log: () => {},
    });
    expect(merged).toEqual([40]);
    expect(reviewed.sort()).toEqual([40, 41]); // 42 (red) never reviewed
    expect(res.skipped.map((s) => s.number).sort()).toEqual([41, 42]);
  });

  it("noReview ⇒ deterministic-only: gate-green merges without ever calling reviewFn", () => {
    let reviewCalls = 0;
    const merged = /** @type {number[]} */ ([]);
    runGateSweep({
      noReview: true,
      snapshotFn: () => [pr({ number: 50 })],
      vetFn: () => ({ stdout: greenStdout }),
      reviewFn: () => {
        reviewCalls += 1;
        return { approve: false, reason: "should-not-run" };
      },
      mergeFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) =>
        merged.push(p.number),
      log: () => {},
    });
    expect(reviewCalls).toBe(0);
    expect(merged).toEqual([50]);
  });
});
