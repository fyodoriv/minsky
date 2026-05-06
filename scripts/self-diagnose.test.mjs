import { describe, expect, it } from "vitest";

import {
  claudeBinaryReachableInvariant,
  daemonInFlightPrCollisionInvariant,
  daemonIterationRuntimeInvariant,
  daemonNoopIterationRateInvariant,
  daemonPrLintPassRateInvariant,
  daemonPrStuckOnCiInvariant,
  daemonShippedRatioInvariant,
  daemonTaskIdStalenessInvariant,
  findingsToTasksMd,
  runInvariants,
  tokenMonitorNotAllPeggedInvariant,
} from "./self-diagnose.mjs";

describe("self-diagnose runner", () => {
  it("returns no findings when every invariant passes", async () => {
    const findings = await runInvariants([async () => ({ id: "always-ok", ok: true })]);
    expect(findings).toEqual([]);
  });

  it("collects violations from every failing invariant", async () => {
    const findings = await runInvariants([
      async () => ({ id: "ok-one", ok: true }),
      async () => ({
        id: "fail-one",
        ok: false,
        evidence: "X did not equal Y",
        suggestedTaskTitle: "fix X",
        suggestedFix: "make X equal Y",
      }),
      async () => ({
        id: "fail-two",
        ok: false,
        evidence: "Z drifted",
        suggestedTaskTitle: "fix Z",
        suggestedFix: "re-anchor Z",
      }),
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.id)).toEqual(["fail-one", "fail-two"]);
  });

  it("converts a probe exception into a violation rather than throwing", async () => {
    const probe = async () => {
      throw new Error("network unreachable");
    };
    probe.invariantId = "probe-x";
    const findings = await runInvariants([probe]);
    expect(findings).toHaveLength(1);
    const first = findings[0];
    if (!first) throw new Error("unreachable");
    expect(first.id).toBe("probe-x");
    expect(first.ok).toBe(false);
    expect(first.evidence).toContain("network unreachable");
  });
});

describe("tokenMonitorNotAllPeggedInvariant", () => {
  it("passes when at least one plan has remaining tokens", async () => {
    /** @type {(plan: "pro"|"max5"|"max20"|"custom") => Promise<{tokensRemainingInWindow: number, windowSizeTokens: number, secondsUntilWindowReset: number, weeklyHeadroomFraction: number, observedAt: string}>} */
    const snapshotPerPlan = async (plan) => ({
      tokensRemainingInWindow: plan === "max20" ? 100_000 : 0,
      windowSizeTokens: 0,
      secondsUntilWindowReset: 0,
      weeklyHeadroomFraction: 0,
      observedAt: "2026-05-04T12:00:00.000Z",
    });
    const result = await tokenMonitorNotAllPeggedInvariant({ snapshotPerPlan })();
    expect(result.ok).toBe(true);
  });

  it("fails when all four plans report 0 remaining (the unit-mismatch signal)", async () => {
    const snapshotPerPlan = async () => ({
      tokensRemainingInWindow: 0,
      windowSizeTokens: 0,
      secondsUntilWindowReset: 0,
      weeklyHeadroomFraction: 0,
      observedAt: "2026-05-04T12:00:00.000Z",
    });
    const result = await tokenMonitorNotAllPeggedInvariant({ snapshotPerPlan })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("token-monitor-not-all-pegged");
    expect(result.evidence).toContain("pro:");
    expect(result.evidence).toContain("max20:");
    expect(result.suggestedFix).toContain("cache_read");
  });
});

describe("claudeBinaryReachableInvariant", () => {
  it("passes when the probe reports the binary is reachable", async () => {
    const probe = async () => ({ ok: true });
    const result = await claudeBinaryReachableInvariant({ probe })();
    expect(result.ok).toBe(true);
  });

  it("fails with the launchd-PATH suggestedFix when the probe reports unreachable", async () => {
    const probe = async () => ({ ok: false });
    const result = await claudeBinaryReachableInvariant({ probe })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("claude-binary-reachable");
    expect(result.evidence).toContain("ENOENT");
    expect(result.suggestedFix).toContain("launchd");
    expect(result.suggestedFix).toContain("run-tick-loop.sh");
  });
});

describe("daemonNoopIterationRateInvariant", () => {
  it("passes when no taskId has ≥threshold consecutive non-committed iterations", async () => {
    const recentIterations = async () => [
      { taskId: "a", committed: false, timestamp: "" },
      { taskId: "a", committed: true, timestamp: "" },
      { taskId: "a", committed: false, timestamp: "" },
      { taskId: "a", committed: false, timestamp: "" },
    ];
    const result = await daemonNoopIterationRateInvariant({ recentIterations, threshold: 4 })();
    expect(result.ok).toBe(true);
  });

  it("fires when consecutive non-committed iterations on the same taskId reach the threshold", async () => {
    const recentIterations = async () => [
      { taskId: "stuck-task", committed: false, timestamp: "" },
      { taskId: "stuck-task", committed: false, timestamp: "" },
      { taskId: "stuck-task", committed: false, timestamp: "" },
      { taskId: "stuck-task", committed: false, timestamp: "" },
    ];
    const result = await daemonNoopIterationRateInvariant({ recentIterations, threshold: 4 })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-noop-iteration-rate-too-high");
    expect(result.evidence).toContain("stuck-task");
    expect(result.suggestedFix).toContain("placeholder");
  });
});

describe("daemonPrStuckOnCiInvariant", () => {
  it("passes when no PR has ≥failureThreshold failures without a fix commit", async () => {
    const daemonPrs = async () => [
      {
        number: 1,
        headRefName: "feat/x",
        ciFailureCount: 1,
        hasDaemonFixCommitSinceLastFailure: false,
      },
      {
        number: 2,
        headRefName: "feat/y",
        ciFailureCount: 3,
        hasDaemonFixCommitSinceLastFailure: true,
      },
    ];
    const result = await daemonPrStuckOnCiInvariant({ daemonPrs })();
    expect(result.ok).toBe(true);
  });

  it("fires for PRs with ≥failureThreshold failures and no fix commit", async () => {
    const daemonPrs = async () => [
      {
        number: 42,
        headRefName: "feat/stuck",
        ciFailureCount: 3,
        hasDaemonFixCommitSinceLastFailure: false,
      },
    ];
    const result = await daemonPrStuckOnCiInvariant({ daemonPrs })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-pr-stuck-on-ci-failure");
    expect(result.evidence).toContain("#42");
    expect(result.suggestedFix).toContain("daemon-fix-own-pr-on-ci-failure");
  });
});

describe("daemonShippedRatioInvariant", () => {
  it("passes when iterationCount is below the warm-up window (no signal)", async () => {
    const rollingStats = async () => ({ iterationCount: 5, shippedPrCount: 0 });
    const result = await daemonShippedRatioInvariant({ rollingStats })();
    expect(result.ok).toBe(true);
  });

  it("passes when ratio meets minRatio", async () => {
    const rollingStats = async () => ({ iterationCount: 100, shippedPrCount: 10 });
    const result = await daemonShippedRatioInvariant({ rollingStats })();
    expect(result.ok).toBe(true);
  });

  it("fires when ratio is below minRatio and the warm-up window is met", async () => {
    const rollingStats = async () => ({ iterationCount: 100, shippedPrCount: 1 });
    const result = await daemonShippedRatioInvariant({ rollingStats })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-iteration-vs-shipped-ratio");
    expect(result.evidence).toContain("1");
    expect(result.evidence).toContain("100");
  });
});

describe("daemonInFlightPrCollisionInvariant", () => {
  it("passes when no two PRs share both a taskId and overlapping files", async () => {
    const openDaemonPrs = async () => [
      { number: 1, taskId: "a", files: ["foo.ts"] },
      { number: 2, taskId: "b", files: ["bar.ts"] },
    ];
    const result = await daemonInFlightPrCollisionInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(true);
  });

  it("fires when ≥2 PRs share a taskId and their file-sets overlap above threshold", async () => {
    const openDaemonPrs = async () => [
      {
        number: 180,
        taskId: "daily-changelog-for-humans",
        files: ["CHANGELOG.md", "src/changelog.ts", "src/changelog.test.ts"],
      },
      {
        number: 181,
        taskId: "daily-changelog-for-humans",
        files: ["CHANGELOG.md", "src/changelog.ts", "docs/changelog.md"],
      },
      {
        number: 182,
        taskId: "daily-changelog-for-humans",
        files: ["CHANGELOG.md", "src/changelog.ts", "src/changelog.wire.ts"],
      },
    ];
    const result = await daemonInFlightPrCollisionInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-in-flight-pr-collision");
    expect(result.evidence).toContain("daily-changelog-for-humans");
    expect(result.evidence).toContain("#180");
  });
});

describe("daemonTaskIdStalenessInvariant", () => {
  it("passes when every in-flight taskId has a matching block in TASKS.md", async () => {
    const inFlightTaskIds = async () => ["foo-task", "bar-task"];
    const tasksMdContent = async () =>
      "- [ ] foo\n  - **ID**: foo-task\n- [ ] bar\n  - **ID**: bar-task\n";
    const result = await daemonTaskIdStalenessInvariant({ inFlightTaskIds, tasksMdContent })();
    expect(result.ok).toBe(true);
  });

  it("passes when there are no in-flight taskIds", async () => {
    const inFlightTaskIds = async () => [];
    const tasksMdContent = async () => "";
    const result = await daemonTaskIdStalenessInvariant({ inFlightTaskIds, tasksMdContent })();
    expect(result.ok).toBe(true);
  });

  it("fires when an in-flight taskId is absent from TASKS.md (orphan work)", async () => {
    const inFlightTaskIds = async () => ["live-task", "removed-task"];
    const tasksMdContent = async () => "- [ ] live\n  - **ID**: live-task\n";
    const result = await daemonTaskIdStalenessInvariant({ inFlightTaskIds, tasksMdContent })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-task-id-staleness");
    expect(result.evidence).toContain("removed-task");
    expect(result.evidence).not.toContain("live-task,");
  });
});

describe("daemonIterationRuntimeInvariant", () => {
  it("passes when no claude --print spawn exceeds the threshold", async () => {
    const listClaudePrintSpawns = async () => [
      { pid: 1234, etimeSeconds: 60, ppid: 1 },
      { pid: 1235, etimeSeconds: 600, ppid: 1 },
    ];
    const result = await daemonIterationRuntimeInvariant({
      listClaudePrintSpawns,
      thresholdSeconds: 1800,
    })();
    expect(result.ok).toBe(true);
  });

  it("passes when there are no spawns at all", async () => {
    const listClaudePrintSpawns = async () => [];
    const result = await daemonIterationRuntimeInvariant({ listClaudePrintSpawns })();
    expect(result.ok).toBe(true);
  });

  it("fires with kill commands when a spawn exceeds the threshold", async () => {
    const listClaudePrintSpawns = async () => [{ pid: 93564, etimeSeconds: 7320, ppid: 97262 }];
    const result = await daemonIterationRuntimeInvariant({
      listClaudePrintSpawns,
      thresholdSeconds: 1800,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-iteration-runtime-exceeded");
    expect(result.evidence).toContain("pid=93564");
    expect(result.evidence).toContain("2h2m0s");
    expect(result.suggestedFix).toContain("kill 93564");
    expect(result.suggestedFix).toContain("scripts/kill-stuck-iterations.mjs");
  });

  it("emits a kill command per stuck spawn when multiple exceed", async () => {
    const listClaudePrintSpawns = async () => [
      { pid: 1001, etimeSeconds: 1900, ppid: 1 },
      { pid: 1002, etimeSeconds: 200, ppid: 1 },
      { pid: 1003, etimeSeconds: 3600, ppid: 1 },
    ];
    const result = await daemonIterationRuntimeInvariant({
      listClaudePrintSpawns,
      thresholdSeconds: 1800,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.suggestedFix).toContain("kill 1001 && kill 1003");
    expect(result.suggestedFix).not.toContain("kill 1002");
  });

  it("uses a custom threshold when injected", async () => {
    const listClaudePrintSpawns = async () => [{ pid: 5000, etimeSeconds: 400, ppid: 1 }];
    const passResult = await daemonIterationRuntimeInvariant({
      listClaudePrintSpawns,
      thresholdSeconds: 600,
    })();
    expect(passResult.ok).toBe(true);
    const failResult = await daemonIterationRuntimeInvariant({
      listClaudePrintSpawns,
      thresholdSeconds: 300,
    })();
    expect(failResult.ok).toBe(false);
  });
});

describe("daemonPrLintPassRateInvariant", () => {
  it("passes when the rolling window is below the warm-up size (no signal)", async () => {
    const recentDaemonPrs = async () => [
      { number: 1, hasFailure: true },
      { number: 2, hasFailure: true },
      { number: 3, hasFailure: true },
    ];
    const result = await daemonPrLintPassRateInvariant({ recentDaemonPrs })();
    expect(result.ok).toBe(true);
  });

  it("passes when ≥80% of PRs in the window have no FAILURE checks", async () => {
    const recentDaemonPrs = async () =>
      Array.from({ length: 10 }, (_, i) => ({ number: i + 1, hasFailure: i < 2 }));
    const result = await daemonPrLintPassRateInvariant({ recentDaemonPrs })();
    expect(result.ok).toBe(true);
  });

  it("fires when >20% of PRs in the window carry a FAILURE check", async () => {
    const recentDaemonPrs = async () =>
      Array.from({ length: 10 }, (_, i) => ({ number: 100 + i, hasFailure: i < 5 }));
    const result = await daemonPrLintPassRateInvariant({ recentDaemonPrs })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-pr-lint-pass-rate");
    expect(result.evidence).toContain("5 clean / 10");
    expect(result.evidence).toContain("0.500");
    expect(result.evidence).toContain("#100");
    expect(result.suggestedFix).toContain("run-pre-pr-lint-stack.mjs");
    expect(result.suggestedFix).toContain("buildDaemonBrief");
  });

  it("respects custom windowMinPrs and minPassRate when injected", async () => {
    const recentDaemonPrs = async () =>
      Array.from({ length: 5 }, (_, i) => ({ number: i + 1, hasFailure: i < 2 }));
    const passResult = await daemonPrLintPassRateInvariant({
      recentDaemonPrs,
      windowMinPrs: 5,
      minPassRate: 0.5,
    })();
    expect(passResult.ok).toBe(true);
    const failResult = await daemonPrLintPassRateInvariant({
      recentDaemonPrs,
      windowMinPrs: 5,
      minPassRate: 0.9,
    })();
    expect(failResult.ok).toBe(false);
  });
});

describe("findingsToTasksMd", () => {
  it("returns empty string when there are no findings", () => {
    expect(findingsToTasksMd([], "2026-05-04T12:00:00.000Z")).toBe("");
  });

  it("renders a TASKS.md block carrying ID / Hypothesis / Measurement / Pivot fields", () => {
    const block = findingsToTasksMd(
      [
        {
          id: "token-monitor-not-all-pegged",
          ok: false,
          evidence: "every plan pegged",
          suggestedTaskTitle: "token-monitor unit mismatch",
          suggestedFix: "patch the sum or recalibrate PLAN_CAPS",
        },
      ],
      "2026-05-04T12:00:00.000Z",
    );
    expect(block).toContain("self-diagnose-token-monitor-not-all-pegged-2026-05-04");
    expect(block).toContain("**Hypothesis**:");
    expect(block).toContain("**Measurement**:");
    expect(block).toContain("**Pivot**:");
    expect(block).toContain("**Tags**: self-detected, token-monitor-not-all-pegged");
  });
});
