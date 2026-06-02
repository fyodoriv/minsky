// Tests for local-gate-merge.mjs — pure decision functions + injected-seam
// sweep. No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import {
  decideLand,
  decideLoadShed,
  decideMerge,
  decidePreflight,
  decideTimeoutCircuit,
  headBranchPinnedByWorktree,
  isTimeoutVet,
  landLocalBranch,
  mergeArgs,
  parseGateVerdict,
  parseReview,
  partitionByCircuit,
  pickGateCandidates,
  recordTimeoutStrike,
  runGateSweep,
  setWorkerPauseSeam,
  summarizeLedger,
  withWorkerPaused,
} from "./local-gate-merge.mjs";

/** @param {Partial<import("./local-gate-merge.mjs").PrSnapshot> & {number:number}} p */
const pr = (p) => ({
  number: p.number,
  isDraft: p.isDraft ?? false,
  mergeable: p.mergeable ?? "MERGEABLE",
  baseRefName: p.baseRefName ?? "main",
  headRefName: p.headRefName ?? `feat/${p.number}`,
  headRefOid: p.headRefOid ?? `sha-${p.number}`,
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      mergeFn: () => {
        /* no-op */
      },
      log: () => {
        /* no-op */
      },
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

describe("headBranchPinnedByWorktree (worktree-pin detection — proactive arm)", () => {
  // `git worktree list --porcelain` emits one blank-line-separated stanza
  // per worktree; a branch-holding worktree carries `branch refs/heads/<name>`.
  const porcelain = [
    "worktree /repo",
    "HEAD aaaa",
    "branch refs/heads/main",
    "",
    "worktree /repo/.claude/worktrees/daemon-0",
    "HEAD bbbb",
    "branch refs/heads/worktree-daemon-0-minsky-cli-context-aware-ux",
    "",
  ].join("\n");

  it("true when the head branch is checked out in a worktree", () => {
    expect(
      headBranchPinnedByWorktree(porcelain, "worktree-daemon-0-minsky-cli-context-aware-ux"),
    ).toBe(true);
  });
  it("false when no worktree holds the head branch", () => {
    expect(headBranchPinnedByWorktree(porcelain, "feat/not-pinned")).toBe(false);
  });
  it("false for a detached/bare worktree (no `branch` line) and empty input", () => {
    const detached = ["worktree /repo/wt", "HEAD cccc", "detached", ""].join("\n");
    expect(headBranchPinnedByWorktree(detached, "feat/x")).toBe(false);
    expect(headBranchPinnedByWorktree("", "feat/x")).toBe(false);
  });
  it("false on empty head ref name (fail-safe — never claims a pin)", () => {
    expect(headBranchPinnedByWorktree(porcelain, "")).toBe(false);
  });
  it("does not match on a prefix collision (exact ref only)", () => {
    // `branch refs/heads/foo` must NOT count as a pin for head `fo`.
    expect(headBranchPinnedByWorktree("branch refs/heads/foo\n", "fo")).toBe(false);
    expect(headBranchPinnedByWorktree("branch refs/heads/foo\n", "foo")).toBe(true);
  });
});

describe("mergeArgs (pin → gh argv — rule #6 cleanup-never-gates)", () => {
  const p = pr({ number: 580, headRefName: "worktree-daemon-0-x" });
  it("appends --delete-branch when the head branch is NOT worktree-pinned", () => {
    expect(mergeArgs(p, false)).toEqual([
      "pr",
      "merge",
      "580",
      "--squash",
      "--admin",
      "--delete-branch",
    ]);
  });
  it("drops --delete-branch when the head branch IS worktree-pinned", () => {
    expect(mergeArgs(p, true)).toEqual(["pr", "merge", "580", "--squash", "--admin"]);
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
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
      landFn: () => {
        /* no-op */
      },
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
    });
    expect(res.outcome).toBe("aborted");
    expect(res.reason).toContain("land-failed");
  });

  it("missing branch name ⇒ aborted (no-branch-name)", () => {
    const res = landLocalBranch({
      branchName: "",
      log: () => {
        /* no-op */
      },
    });
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
      log: () => {
        /* no-op */
      },
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
      log: () => {
        /* no-op */
      },
    });
    expect(reviewCalls).toBe(0);
    expect(merged).toEqual([50]);
  });
});

describe("summarizeLedger (--self-metric — rule #9 throughput)", () => {
  it("empty ledger ⇒ zero snapshot", () => {
    expect(summarizeLedger([])).toEqual({ sweeps: 0, merged: 0, skipped: 0, mergedPrs: [] });
  });

  it("folds merged PR numbers and skipped counts across sweeps", () => {
    const lines = [
      JSON.stringify({ ts: "t1", merged: [10, 11], skipped: 2 }),
      JSON.stringify({ ts: "t2", merged: [], skipped: 3 }),
      JSON.stringify({ ts: "t3", merged: [12], skipped: 0 }),
    ];
    expect(summarizeLedger(lines)).toEqual({
      sweeps: 3,
      merged: 3,
      skipped: 5,
      mergedPrs: [10, 11, 12],
    });
  });

  it("skips garbage / non-object / unparseable lines without crashing (rule #6)", () => {
    const lines = [
      "",
      "noise",
      "{bad json",
      JSON.stringify(["not", "an", "object"]),
      JSON.stringify({ ts: "t1", merged: [42], skipped: 1 }),
    ];
    expect(summarizeLedger(lines)).toEqual({
      sweeps: 1,
      merged: 1,
      skipped: 1,
      mergedPrs: [42],
    });
  });

  it("tolerates malformed merged/skipped fields (non-array merged, non-number skipped)", () => {
    const lines = [
      JSON.stringify({ ts: "t1", merged: "oops", skipped: "nope" }),
      JSON.stringify({ ts: "t2", merged: [7, "x", 8], skipped: 4 }),
    ];
    expect(summarizeLedger(lines)).toEqual({
      sweeps: 2,
      merged: 2,
      skipped: 4,
      mergedPrs: [7, 8],
    });
  });
});

describe("decideLoadShed (gate-host-load-shed — pure load-shed plan)", () => {
  it("default-on: niceness + pause-worker when both levers enabled", () => {
    expect(decideLoadShed({ niceness: 10 })).toEqual({
      niceness: 10,
      pauseWorker: true,
      reason: "load-shed: nice +10 + pause-worker",
    });
  });

  it("clamps niceness to [0,20] and truncates fractions", () => {
    expect(decideLoadShed({ niceness: 99 }).niceness).toBe(20);
    expect(decideLoadShed({ niceness: 7.9 }).niceness).toBe(7);
  });

  it("niceness 0 / negative / NaN ⇒ no nice wrapper (debug opt-out)", () => {
    expect(decideLoadShed({ niceness: 0 }).niceness).toBe(0);
    expect(decideLoadShed({ niceness: -5 }).niceness).toBe(0);
    expect(decideLoadShed({ niceness: Number.NaN }).niceness).toBe(0);
  });

  it("MINSKY_GATE_NO_WORKER_PAUSE=1 disables the worker pause", () => {
    const d = decideLoadShed({ niceness: 10, noWorkerPause: "1" });
    expect(d.pauseWorker).toBe(false);
    expect(d.reason).toBe("load-shed: nice +10");
  });

  it("both levers off ⇒ reason 'load-shed: off'", () => {
    expect(decideLoadShed({ niceness: 0, noWorkerPause: "1" })).toEqual({
      niceness: 0,
      pauseWorker: false,
      reason: "load-shed: off",
    });
  });

  it("is pure / deterministic — same input, same output", () => {
    expect(decideLoadShed({ niceness: 10 })).toEqual(decideLoadShed({ niceness: 10 }));
  });
});

describe("withWorkerPaused (rule #6 — resume is guaranteed)", () => {
  /** Reset the module-level seam to no-ops after each test so leakage can't occur. */
  const noop = () => undefined;

  it("pauses before the vet, resumes after (happy path)", () => {
    const calls = /** @type {string[]} */ ([]);
    setWorkerPauseSeam({ pause: () => calls.push("pause"), resume: () => calls.push("resume") });
    const out = withWorkerPaused(true, () => {
      calls.push("vet");
      return "stdout";
    });
    expect(out).toBe("stdout");
    expect(calls).toEqual(["pause", "vet", "resume"]);
    setWorkerPauseSeam({ pause: noop, resume: noop });
  });

  it("resumes even when the vet throws (never leaves the worker SIGSTOP'd)", () => {
    let resumed = false;
    setWorkerPauseSeam({ pause: noop, resume: () => (resumed = true) });
    expect(() =>
      withWorkerPaused(true, () => {
        throw new Error("vet boom");
      }),
    ).toThrow("vet boom");
    expect(resumed).toBe(true);
    setWorkerPauseSeam({ pause: noop, resume: noop });
  });

  it("a failed pause does NOT block the vet, and resume is not attempted (degrade gracefully)", () => {
    let resumeCalls = 0;
    setWorkerPauseSeam({
      pause: () => {
        throw new Error("SIGSTOP failed");
      },
      resume: () => {
        resumeCalls += 1;
      },
    });
    const out = withWorkerPaused(true, () => "ran-anyway");
    expect(out).toBe("ran-anyway");
    // pause never succeeded ⇒ no dangling SIGCONT is issued
    expect(resumeCalls).toBe(0);
    setWorkerPauseSeam({ pause: noop, resume: noop });
  });

  it("pauseWorker=false runs the vet without touching the seam", () => {
    let touched = false;
    setWorkerPauseSeam({ pause: () => (touched = true), resume: () => (touched = true) });
    const out = withWorkerPaused(false, () => "direct");
    expect(out).toBe("direct");
    expect(touched).toBe(false);
    setWorkerPauseSeam({ pause: noop, resume: noop });
  });
});

describe("isTimeoutVet (only genuine timeouts arm the breaker)", () => {
  it("true for a vet-timeout vetError", () => {
    expect(isTimeoutVet({ vetError: "vet-timeout (>1500000ms — bounded …)" })).toBe(true);
  });
  it("false for a conflict / infra vetError (never accrues a strike)", () => {
    expect(isTimeoutVet({ vetError: "merge-onto-main-conflict" })).toBe(false);
    expect(isTimeoutVet({ vetError: "scratch-install-failed: x" })).toBe(false);
  });
  it("false for a completed vet (stdout present)", () => {
    expect(isTimeoutVet({ stdout: "{}" })).toBe(false);
  });
});

describe("recordTimeoutStrike (per-PR-head strike accrual)", () => {
  it("first strike for a head ⇒ count 1", () => {
    const s = recordTimeoutStrike(
      {},
      pr({ number: 580, headRefOid: "aaa" }),
      "2026-06-02T00:00:00Z",
    );
    expect(s["580"]).toEqual({ headOid: "aaa", count: 1, lastTs: "2026-06-02T00:00:00Z" });
  });
  it("same head increments", () => {
    const s0 = { 580: { headOid: "aaa", count: 1, lastTs: "t0" } };
    const s1 = recordTimeoutStrike(s0, pr({ number: 580, headRefOid: "aaa" }), "t1");
    expect(s1["580"]).toEqual({ headOid: "aaa", count: 2, lastTs: "t1" });
  });
  it("new head SHA resets the count to 1 (cleared on new push)", () => {
    const s0 = { 580: { headOid: "aaa", count: 5, lastTs: "t0" } };
    const s1 = recordTimeoutStrike(s0, pr({ number: 580, headRefOid: "bbb" }), "t1");
    expect(s1["580"]).toEqual({ headOid: "bbb", count: 1, lastTs: "t1" });
  });
  it("does not mutate the input store", () => {
    /** @type {Record<string, any>} */
    const s0 = {};
    recordTimeoutStrike(s0, pr({ number: 1, headRefOid: "x" }), "t");
    expect(s0).toEqual({});
  });
});

describe("decideTimeoutCircuit (open/closed/half-open decision)", () => {
  const now = Date.parse("2026-06-02T12:00:00Z");
  const ago = (/** @type {number} */ mins) => new Date(now - mins * 60000).toISOString();

  it("closed when no record exists for the PR", () => {
    expect(decideTimeoutCircuit({}, pr({ number: 1 }), { now }).open).toBe(false);
  });
  it("closed below the strike threshold", () => {
    const store = { 1: { headOid: "sha-1", count: 1, lastTs: ago(1) } };
    expect(decideTimeoutCircuit(store, pr({ number: 1 }), { now }).open).toBe(false);
  });
  it("OPEN at/over threshold within the cooldown window", () => {
    const store = { 1: { headOid: "sha-1", count: 2, lastTs: ago(10) } };
    const d = decideTimeoutCircuit(store, pr({ number: 1 }), { now });
    expect(d.open).toBe(true);
    expect(d.reason).toContain("timeout-circuit-open");
  });
  it("half-open (closed) once the cooldown has elapsed — re-vets", () => {
    const store = { 1: { headOid: "sha-1", count: 9, lastTs: ago(7 * 60) } };
    const d = decideTimeoutCircuit(store, pr({ number: 1 }), { now });
    expect(d.open).toBe(false);
    expect(d.reason).toContain("cooldown elapsed");
  });
  it("closed when strikes belong to a stale head (a new push happened)", () => {
    const store = { 1: { headOid: "OLD", count: 9, lastTs: ago(1) } };
    expect(decideTimeoutCircuit(store, pr({ number: 1, headRefOid: "NEW" }), { now }).open).toBe(
      false,
    );
  });
  it("closed (fail-safe) when the live head SHA is unknown", () => {
    const store = { 1: { headOid: "sha-1", count: 9, lastTs: ago(1) } };
    const noOid = { ...pr({ number: 1 }), headRefOid: undefined };
    expect(decideTimeoutCircuit(store, /** @type {any} */ (noOid), { now }).open).toBe(false);
  });
  it("honours injected threshold / cooldown overrides (rule #10 determinism)", () => {
    const store = { 1: { headOid: "sha-1", count: 1, lastTs: ago(1) } };
    expect(decideTimeoutCircuit(store, pr({ number: 1 }), { now, threshold: 1 }).open).toBe(true);
  });
});

describe("partitionByCircuit (pre-skip before the limit slice)", () => {
  const now = Date.parse("2026-06-02T12:00:00Z");
  it("splits open-circuit PRs out of the vet set", () => {
    const store = {
      11: { headOid: "sha-11", count: 3, lastTs: new Date(now - 60000).toISOString() },
    };
    const { toVet, preSkipped } = partitionByCircuit(
      [pr({ number: 10 }), pr({ number: 11 }), pr({ number: 12 })],
      store,
      now,
    );
    expect(toVet.map((p) => p.number)).toEqual([10, 12]);
    expect(preSkipped.map((s) => s.pr.number)).toEqual([11]);
  });
});

describe("runGateSweep — timeout circuit-breaker (accrue / skip / clear)", () => {
  const greenStdout = JSON.stringify({ summary: true, allPass: true, stepCount: 1 });
  const now = Date.parse("2026-06-02T12:00:00Z");

  it("accrues a strike on a vet-timeout; never on a conflict skip", () => {
    /** @type {Record<string, any>} */
    let store = {};
    const sweep = (/** @type {string} */ vetError, /** @type {number} */ n) =>
      runGateSweep({
        snapshotFn: () => [pr({ number: n, headRefOid: `sha-${n}` })],
        vetFn: () => ({ vetError }),
        mergeFn: () => {
          /* never */
        },
        noReview: true,
        now,
        loadStrikesFn: () => store,
        saveStrikesFn: (s) => {
          store = s;
        },
        log: () => {
          /* no-op */
        },
      });
    sweep("vet-timeout (>1500000ms)", 70);
    expect(store["70"]?.count).toBe(1);
    sweep("merge-onto-main-conflict", 71);
    expect(store["71"]).toBeUndefined(); // non-timeout never accrues
  });

  it("pre-skips an open-circuit PR (0 vet slots) so the green PR is reached", () => {
    let vetCalls = 0;
    const merged = /** @type {number[]} */ ([]);
    const store = {
      80: { headOid: "sha-80", count: 2, lastTs: new Date(now - 60000).toISOString() },
    };
    const res = runGateSweep({
      // limit=1 reproduces the starvation: without the breaker, #80 would
      // consume the only slot every tick and #81 would never be reached.
      limit: 1,
      snapshotFn: () => [pr({ number: 80, headRefOid: "sha-80" }), pr({ number: 81 })],
      vetFn: (p) => {
        vetCalls += 1;
        return p.number === 81 ? { stdout: greenStdout } : { vetError: "vet-timeout (>x)" };
      },
      mergeFn: (p) => merged.push(p.number),
      noReview: true,
      now,
      loadStrikesFn: () => store,
      saveStrikesFn: () => {
        /* no-op */
      },
      log: () => {
        /* no-op */
      },
    });
    expect(vetCalls).toBe(1); // only #81 vetted; #80 pre-skipped
    expect(merged).toEqual([81]);
    expect(res.skipped.map((s) => s.number)).toContain(80);
    expect(res.skipped.find((s) => s.number === 80)?.reason).toContain("timeout-circuit-open");
  });

  it("clears the circuit when the PR's head SHA changes (new push ⇒ re-vet)", () => {
    let vetCalls = 0;
    const store = {
      90: { headOid: "OLD-sha", count: 5, lastTs: new Date(now - 60000).toISOString() },
    };
    runGateSweep({
      snapshotFn: () => [pr({ number: 90, headRefOid: "NEW-sha" })],
      vetFn: () => {
        vetCalls += 1;
        return { stdout: greenStdout };
      },
      mergeFn: () => {
        /* no-op */
      },
      noReview: true,
      now,
      loadStrikesFn: () => store,
      saveStrikesFn: () => {
        /* no-op */
      },
      log: () => {
        /* no-op */
      },
    });
    expect(vetCalls).toBe(1); // stale-head strikes ignored ⇒ re-vetted
  });
});
