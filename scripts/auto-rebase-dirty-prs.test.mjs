// Paired tests for `auto-rebase-dirty-prs.mjs`. Pure-function
// tests over `decideRebaseAction` + `executeDecisions` with injected
// I/O seams (rule #2 — Strategy seam). No `gh` calls, no network.

import { describe, expect, test } from "vitest";

import { decideRebaseAction, executeDecisions, rollupOutcomes } from "./auto-rebase-dirty-prs.mjs";

const NOW = Date.parse("2026-05-26T18:00:00Z");
const THREE_H_AGO = new Date(NOW - 3 * 3_600_000).toISOString();
const ONE_H_AGO = new Date(NOW - 1 * 3_600_000).toISOString();

/** @returns {import("./auto-rebase-dirty-prs.mjs").OpenPrSnapshot} */
function pr(over = {}) {
  return {
    number: 100,
    headRefName: "feat/some-feature",
    mergeStateStatus: "DIRTY",
    title: "feat: something",
    createdAt: THREE_H_AGO,
    author: "fyodoriv",
    ...over,
  };
}

describe("decideRebaseAction — pure decisions", () => {
  test("rebases a daemon-shaped DIRTY PR older than 2h", () => {
    const decisions = decideRebaseAction([pr()], { nowMs: NOW });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("rebase");
    expect(decisions[0]?.pr).toBe(100);
    expect(decisions[0]?.stuckState).toBe("DIRTY");
  });

  test("rebases a daemon-shaped CONFLICTING PR older than 2h (the watchdog extension)", () => {
    const decisions = decideRebaseAction(
      [pr({ mergeStateStatus: "CONFLICTING", createdAt: THREE_H_AGO })],
      { nowMs: NOW },
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("rebase");
    expect(decisions[0]?.stuckState).toBe("CONFLICTING");
    expect(decisions[0]?.reason).toMatch(/CONFLICTING for 3\.0h/);
  });

  test("skips a CONFLICTING PR younger than 2h (same flake tolerance as DIRTY)", () => {
    const decisions = decideRebaseAction(
      [pr({ mergeStateStatus: "CONFLICTING", createdAt: ONE_H_AGO })],
      { nowMs: NOW },
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toMatch(/age=1\.0h < 2h/);
  });

  test("skips a CLEAN PR — that's the gh-native auto-merge path's job", () => {
    const decisions = decideRebaseAction([pr({ mergeStateStatus: "CLEAN" })], { nowMs: NOW });
    expect(decisions).toHaveLength(0);
  });

  test("skips a DIRTY PR younger than 2h (flake-tolerance threshold)", () => {
    const decisions = decideRebaseAction([pr({ createdAt: ONE_H_AGO })], { nowMs: NOW });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toMatch(/age=1\.0h < 2h/);
  });

  test("skips a non-daemon-shaped branch (operator's hand-authored work)", () => {
    const decisions = decideRebaseAction([pr({ headRefName: "operator-experiment-branch" })], {
      nowMs: NOW,
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toMatch(/not daemon-shaped/);
  });

  test("respects the --limit cap (bounded per-cycle work)", () => {
    const prs = Array.from({ length: 10 }, (_, i) => pr({ number: 200 + i }));
    const decisions = decideRebaseAction(prs, { nowMs: NOW, limit: 3 });
    expect(decisions.filter((d) => d.action === "rebase")).toHaveLength(3);
  });

  test("accepts all 6 daemon-shaped prefixes (feat/fix/chore/docs/refactor/test)", () => {
    const prefixes = ["feat/", "fix/", "chore/", "docs/", "refactor/", "test/"];
    const prs = prefixes.map((p, i) => pr({ number: 300 + i, headRefName: `${p}thing-${i}` }));
    const decisions = decideRebaseAction(prs, { nowMs: NOW, limit: 99 });
    expect(decisions.filter((d) => d.action === "rebase")).toHaveLength(6);
  });
});

describe("executeDecisions — actions via injected seams", () => {
  test("rebased: gh pr update-branch returned 'rebased' → outcome=rebased", () => {
    const rebaseFn = () => /** @type {const} */ ("rebased");
    const closeFn = () => {
      throw new Error("close should NOT be called when rebase succeeds");
    };
    const recheckFn = () => {
      throw new Error("recheck should NOT be called when rebase succeeds");
    };
    const out = executeDecisions([{ pr: 100, action: "rebase", reason: "DIRTY for 3h" }], {
      rebaseFn,
      closeFn,
      recheckFn,
      dryRun: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("rebased");
  });

  test("conflict + still-stuck recheck escalates to close-superseded", () => {
    let closeCalled = 0;
    const rebaseFn = () => /** @type {const} */ ("conflict");
    const closeFn = () => {
      closeCalled += 1;
    };
    const out = executeDecisions([{ pr: 200, action: "rebase", reason: "DIRTY for 5h" }], {
      rebaseFn,
      closeFn,
      recheckFn: () => "CONFLICTING",
      dryRun: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("closed-superseded");
    expect(closeCalled).toBe(1);
  });

  // TOCTOU guard pin (PR #1213 incident 2026-06-11): the author rebased
  // the branch green between the janitor's snapshot and its execute
  // step; the janitor must NOT close on stale evidence.
  test("conflict + recovered recheck skips the close (recovered-externally)", () => {
    let closeCalled = 0;
    const rebaseFn = () => /** @type {const} */ ("conflict");
    const closeFn = () => {
      closeCalled += 1;
    };
    const out = executeDecisions([{ pr: 1213, action: "rebase", reason: "CONFLICTING for 3h" }], {
      rebaseFn,
      closeFn,
      recheckFn: () => "MERGEABLE",
      dryRun: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("recovered-externally");
    expect(closeCalled).toBe(0);
  });

  test("conflict + UNKNOWN recheck fails safe (no close, retry next cycle)", () => {
    let closeCalled = 0;
    const out = executeDecisions([{ pr: 500, action: "rebase", reason: "DIRTY for 3h" }], {
      rebaseFn: () => /** @type {const} */ ("conflict"),
      closeFn: () => {
        closeCalled += 1;
      },
      recheckFn: () => "UNKNOWN",
      dryRun: false,
    });
    expect(out[0]?.outcome).toBe("recovered-externally");
    expect(closeCalled).toBe(0);
  });

  test("transient error → no close, just record for retry next cycle", () => {
    let closeCalled = 0;
    const rebaseFn = () => /** @type {const} */ ("transient");
    const closeFn = () => {
      closeCalled += 1;
    };
    const out = executeDecisions([{ pr: 300, action: "rebase", reason: "DIRTY for 4h" }], {
      rebaseFn,
      closeFn,
      recheckFn: () => "DIRTY",
      dryRun: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("transient-error");
    expect(closeCalled).toBe(0);
  });

  test("dry-run: rebase/close functions are NEVER called", () => {
    let rebaseCalled = 0;
    let closeCalled = 0;
    const rebaseFn = () => {
      rebaseCalled += 1;
      return /** @type {const} */ ("rebased");
    };
    const closeFn = () => {
      closeCalled += 1;
    };
    const out = executeDecisions([{ pr: 400, action: "rebase", reason: "DIRTY for 3h" }], {
      rebaseFn,
      closeFn,
      recheckFn: () => "CONFLICTING",
      dryRun: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("dry-run");
    expect(rebaseCalled).toBe(0);
    expect(closeCalled).toBe(0);
  });

  test("skip decisions pass through to skipped outcome", () => {
    const out = executeDecisions(
      [{ pr: 500, action: "skip", reason: "branch is not daemon-shaped" }],
      {
        rebaseFn: () => /** @type {const} */ ("rebased"),
        closeFn: () => {
          /* no-op */
        },
        recheckFn: () => "CONFLICTING",
        dryRun: false,
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("skipped");
  });

  test("propagates stuckState=CONFLICTING through to the outcome", () => {
    const out = executeDecisions(
      [{ pr: 600, action: "rebase", reason: "CONFLICTING for 3h", stuckState: "CONFLICTING" }],
      {
        rebaseFn: () => /** @type {const} */ ("rebased"),
        closeFn: () => {
          /* no-op */
        },
        recheckFn: () => "CONFLICTING",
        dryRun: false,
      },
    );
    expect(out[0]?.stuckState).toBe("CONFLICTING");
  });

  test("CONFLICTING rebase-fails-close: conflict escalates to close, stuckState preserved", () => {
    let closeCalled = 0;
    const out = executeDecisions(
      [{ pr: 700, action: "rebase", reason: "CONFLICTING for 4h", stuckState: "CONFLICTING" }],
      {
        rebaseFn: () => /** @type {const} */ ("conflict"),
        closeFn: () => {
          closeCalled += 1;
        },
        recheckFn: () => "CONFLICTING",
        dryRun: false,
      },
    );
    expect(out[0]?.outcome).toBe("closed-superseded");
    expect(out[0]?.stuckState).toBe("CONFLICTING");
    expect(closeCalled).toBe(1);
  });
});

describe("rollupOutcomes — supervisor ledger counts", () => {
  test("conflicting count tallies acted-on CONFLICTING PRs across rebase/close axes", () => {
    const rollup = rollupOutcomes([
      { pr: 1, outcome: "rebased", stuckState: "DIRTY" },
      { pr: 2, outcome: "rebased", stuckState: "CONFLICTING" },
      { pr: 3, outcome: "closed-superseded", stuckState: "CONFLICTING" },
      { pr: 4, outcome: "skipped" },
    ]);
    expect(rollup.rebased).toBe(2);
    expect(rollup.closed).toBe(1);
    expect(rollup.skipped).toBe(1);
    expect(rollup.conflicting).toBe(2);
  });

  test("conflicting excludes a skipped CONFLICTING PR (skip is not an act)", () => {
    const rollup = rollupOutcomes([
      { pr: 1, outcome: "skipped", stuckState: "CONFLICTING" },
      { pr: 2, outcome: "rebased", stuckState: "CONFLICTING" },
    ]);
    expect(rollup.conflicting).toBe(1);
  });

  test("rollup shape always carries rebased/closed/skipped/conflicting (Measurement contract)", () => {
    const rollup = rollupOutcomes([]);
    expect(rollup).toHaveProperty("rebased");
    expect(rollup).toHaveProperty("closed");
    expect(rollup).toHaveProperty("skipped");
    expect(rollup).toHaveProperty("conflicting");
    expect(rollup.conflicting).toBe(0);
  });

  test("dry-run CONFLICTING PR still counts toward conflicting population", () => {
    const rollup = rollupOutcomes([{ pr: 1, outcome: "dry-run", stuckState: "CONFLICTING" }]);
    expect(rollup.dryRun).toBe(1);
    expect(rollup.conflicting).toBe(1);
  });
});
