import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  claudeBinaryReachableInvariant,
  claudePrintTimeoutFrequencyInvariant,
  daemonInFlightPrCollisionInvariant,
  daemonIterationRuntimeInvariant,
  daemonNoProgressRateInvariant,
  daemonNoopIterationRateInvariant,
  daemonPrLintPassRateInvariant,
  daemonPrStuckDirtyInvariant,
  daemonPrStuckOnCiInvariant,
  daemonPrThrashInvariant,
  daemonShippedRatioInvariant,
  daemonSpawnFailureRateInvariant,
  daemonTaskIdStalenessInvariant,
  daemonTaskScopeExplosionInvariant,
  defaultInvariants,
  detectConflictMarker,
  extractTaskIdFromPr,
  findConflictMarkers,
  findingsToTasksMd,
  formatEtime,
  gitConfigParseableInvariant,
  localServerConcurrencyMismatchInvariant,
  mapGhPrListToCiSnapshots,
  modelCatalogInvariantsHoldInvariant,
  parseEtime,
  parseIterationLogLine,
  runInvariants,
  stripBranchPrefix,
  stripBranchSuffixes,
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
    /** @type {(plan: "pro"|"max5"|"max20"|"custom") => Promise<{tokensRemainingInWindow: number, windowSizeTokens: number, secondsUntilWindowReset: number, weeklyHeadroomFraction: number, observedAt: string, monthlyHeadroomFraction: number, secondsUntilWeekReset: number, secondsUntilMonthReset: number}>} */
    const snapshotPerPlan = async (plan) => ({
      tokensRemainingInWindow: plan === "max20" ? 100_000 : 0,
      windowSizeTokens: 0,
      secondsUntilWindowReset: 0,
      weeklyHeadroomFraction: 0,
      observedAt: "2026-05-04T12:00:00.000Z",
      monthlyHeadroomFraction: 1,
      secondsUntilWeekReset: 604800,
      secondsUntilMonthReset: 2592000,
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
      monthlyHeadroomFraction: 1,
      secondsUntilWeekReset: 604800,
      secondsUntilMonthReset: 2592000,
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

describe("daemonSpawnFailureRateInvariant", () => {
  const T0 = Date.parse("2026-05-27T00:00:00Z");

  it("passes when there are no iterations yet", async () => {
    const result = await daemonSpawnFailureRateInvariant({
      recentVerdicts: async () => [],
    })();
    expect(result.id).toBe("daemon-spawn-failure-rate");
    expect(result.ok).toBe(true);
  });

  it("passes when fewer than threshold of last-5 are spawn-failed", async () => {
    // 2 of 5 spawn-failed — below the default threshold of 3.
    const result = await daemonSpawnFailureRateInvariant({
      recentVerdicts: async () => [
        { verdict: "spawn-failed", timestampMs: T0 + 5 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 4 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 3 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 2 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 1 * 60_000 },
      ],
    })();
    expect(result.ok).toBe(true);
  });

  it("FIRES when 3 of last 5 iterations are spawn-failed (default threshold)", async () => {
    const result = await daemonSpawnFailureRateInvariant({
      recentVerdicts: async () => [
        { verdict: "spawn-failed", timestampMs: T0 + 5 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 4 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 3 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 2 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 1 * 60_000 },
      ],
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.actor).toBe("operator");
    expect(result.evidence).toContain("3/5");
    expect(result.suggestedFix).toMatch(/ANTHROPIC_API_KEY/);
    expect(result.suggestedFix).toMatch(/Ollama/);
    expect(result.suggestedFix).toMatch(/pnpm minsky:setup/);
  });

  it("only looks at the LAST `windowSize` iterations (not all history)", async () => {
    // 100 older spawn-failed entries, but the last 5 are all validated —
    // invariant should pass because the window is only the last 5.
    /** @type {{verdict: string, timestampMs: number}[]} */
    const verdicts = [];
    for (let i = 0; i < 100; i++) {
      verdicts.push({ verdict: "spawn-failed", timestampMs: T0 + i * 60_000 });
    }
    // 5 newest are validated (timestamps higher).
    for (let i = 0; i < 5; i++) {
      verdicts.push({ verdict: "validated", timestampMs: T0 + (200 + i) * 60_000 });
    }
    const result = await daemonSpawnFailureRateInvariant({
      recentVerdicts: async () => verdicts,
    })();
    expect(result.ok).toBe(true);
  });

  it("respects custom windowSize + maxFailures", async () => {
    const result = await daemonSpawnFailureRateInvariant({
      recentVerdicts: async () => [
        { verdict: "spawn-failed", timestampMs: T0 + 3 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 2 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 1 * 60_000 },
      ],
      windowSize: 3,
      maxFailures: 2,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("2/3");
  });

  it("does NOT fire on no-progress verdicts (those are the other invariant's domain)", async () => {
    // Cross-invariant isolation: spawn-failure-rate counts only the
    // spawn-failed verdict class. No-progress is a different bug class
    // (model engagement, not spawn mechanics) caught by
    // daemon-no-progress-rate. Mixing them under one invariant would
    // produce a generic "something is broken" finding instead of two
    // distinct ones with different fix paths.
    const result = await daemonSpawnFailureRateInvariant({
      recentVerdicts: async () => [
        { verdict: "no-progress", timestampMs: T0 + 5 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 4 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 3 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 2 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 1 * 60_000 },
      ],
    })();
    expect(result.ok).toBe(true);
  });
});

describe("daemonNoProgressRateInvariant", () => {
  const T0 = Date.parse("2026-05-27T00:00:00Z");

  it("passes when there are no iterations yet", async () => {
    const result = await daemonNoProgressRateInvariant({
      recentVerdicts: async () => [],
    })();
    expect(result.id).toBe("daemon-no-progress-rate");
    expect(result.ok).toBe(true);
  });

  it("passes when fewer than threshold of last-5 are no-progress", async () => {
    const result = await daemonNoProgressRateInvariant({
      recentVerdicts: async () => [
        { verdict: "no-progress", timestampMs: T0 + 5 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 4 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 3 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 2 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 1 * 60_000 },
      ],
    })();
    expect(result.ok).toBe(true);
  });

  it("FIRES when 3 of last 5 iterations are no-progress (default threshold)", async () => {
    // Reproduces the 2026-05-27 9-hour-monitor pattern: 13/13 iterations
    // exited 0 with one `ls -la` and no further work. Pre-fix, every
    // iteration recorded verdict=validated and self-diagnose was green.
    // Post-fix, those iterations record verdict=no-progress and THIS
    // invariant fires within one supervisor cycle.
    const result = await daemonNoProgressRateInvariant({
      recentVerdicts: async () => [
        { verdict: "no-progress", timestampMs: T0 + 5 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 4 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 3 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 2 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 1 * 60_000 },
      ],
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.actor).toBe("operator");
    expect(result.evidence).toContain("3/5");
    expect(result.evidence).toContain("no progress");
    expect(result.suggestedFix).toMatch(/under-engaging/);
    expect(result.suggestedFix).toMatch(/\.minsky\/failures/);
  });

  it("does NOT fire on spawn-failed verdicts (cross-invariant isolation)", async () => {
    const result = await daemonNoProgressRateInvariant({
      recentVerdicts: async () => [
        { verdict: "spawn-failed", timestampMs: T0 + 5 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 4 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 3 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 2 * 60_000 },
        { verdict: "spawn-failed", timestampMs: T0 + 1 * 60_000 },
      ],
    })();
    expect(result.ok).toBe(true);
  });

  it("respects custom windowSize + maxNoProgress", async () => {
    const result = await daemonNoProgressRateInvariant({
      recentVerdicts: async () => [
        { verdict: "no-progress", timestampMs: T0 + 3 * 60_000 },
        { verdict: "no-progress", timestampMs: T0 + 2 * 60_000 },
        { verdict: "validated", timestampMs: T0 + 1 * 60_000 },
      ],
      windowSize: 3,
      maxNoProgress: 2,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("2/3");
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

// ---- slice 23/N parsers — lifted to module scope so the test body's --------
// cognitive complexity stays under biome's `noExcessiveCognitiveComplexity`
// ceiling (max 10). Same shape as the extractor helpers in
// scripts/run-pre-pr-lint-stack.test.mjs (slice 17/N) and
// novel/tick-loop/src/daemon.test.ts (slice 22/N): a pure regex parse over a
// source string the repo owns.

/** @type {Readonly<Record<string, number>>} */
const ROOT_CAUSE_NUMBER_WORDS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
});

/**
 * Slice the `## When the invariant fires` section out of the doc and return
 * its body. The section ends at the next H2 header.
 *
 * @param {string} doc
 * @returns {string}
 */
function extractDocsInvariantFiresSection(doc) {
  const start = doc.search(/^## When the invariant fires$/m);
  if (start < 0) {
    throw new Error("docs/daemon-pre-pr-gate.md: missing 'When the invariant fires' H2");
  }
  const tail = doc.slice(start);
  const nextSection = tail.slice(1).search(/^## /m);
  return nextSection < 0 ? tail : tail.slice(0, nextSection + 1);
}

/**
 * Count markdown numbered root-cause bullets (`1. **Name** — …`) in the
 * sliced section. The `**` requirement keeps incidental numbered lists
 * elsewhere in the section from inflating the count.
 *
 * @param {string} block
 * @returns {number}
 */
function countDocsRootCauseBullets(block) {
  let count = 0;
  for (const line of block.split("\n")) {
    if (/^\d+\. \*\*/.test(line)) count++;
  }
  return count;
}

/**
 * Pull the prose count from `with N named root causes` (e.g., `with two
 * named root causes`) and map it to an integer.
 *
 * @param {string} block
 * @returns {number}
 */
function extractDocsHeaderCount(block) {
  const m = /with (\w+) named root causes/.exec(block);
  if (m === null || m[1] === undefined) {
    throw new Error("docs/daemon-pre-pr-gate.md: missing 'with N named root causes' prose");
  }
  const n = ROOT_CAUSE_NUMBER_WORDS[m[1].toLowerCase()];
  if (n === undefined) {
    throw new Error(`docs/daemon-pre-pr-gate.md: unrecognised number word '${m[1]}'`);
  }
  return n;
}

/**
 * Count `(N)` enumerations in the invariant's `suggestedFix` prose. The
 * invariant emits its root causes as "(1) ... (2) ..."; matching the
 * parenthesised digit is a structural count that ignores any incidental
 * use of digits in the surrounding sentences.
 *
 * @param {string} suggestedFix
 * @returns {number}
 */
function countSuggestedFixEnumerations(suggestedFix) {
  return [...suggestedFix.matchAll(/\((\d+)\)/g)].length;
}

describe("daemonPrLintPassRateInvariant ↔ docs root-cause enumeration parity (slice 23/N)", () => {
  // The invariant's `suggestedFix` enumerates N named root causes as
  // `(1) ... (2) ...`. `docs/daemon-pre-pr-gate.md` § "When the invariant
  // fires" enumerates them as a markdown numbered list AND echoes the count
  // in prose ("with two named root causes"). Three surfaces, no parity check
  // before this slice — a future PR adding a third root cause to the
  // invariant without updating the docs (or the reverse) would let the
  // operator-facing diagnostic silently diverge from the in-context hint
  // the supervisor emits. Slice 23/N pins all three surfaces' counts equal.

  it("invariant suggestedFix `(N)` count == docs numbered bullets count == docs prose 'N named root causes'", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const docPath = resolve(here, "../docs/daemon-pre-pr-gate.md");
    const doc = readFileSync(docPath, "utf8");
    const section = extractDocsInvariantFiresSection(doc);
    const docBulletCount = countDocsRootCauseBullets(section);
    const docHeaderCount = extractDocsHeaderCount(section);

    // Trigger the unmet branch — same fixture shape as the existing
    // `fires when >20% of PRs in the window carry a FAILURE check` test.
    const recentDaemonPrs = async () =>
      Array.from({ length: 10 }, (_, i) => ({ number: 100 + i, hasFailure: i < 5 }));
    const result = await daemonPrLintPassRateInvariant({ recentDaemonPrs })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const suggestedFixCount = countSuggestedFixEnumerations(result.suggestedFix ?? "");

    expect({ suggestedFixCount, docBulletCount, docHeaderCount }).toEqual({
      suggestedFixCount: 2,
      docBulletCount: 2,
      docHeaderCount: 2,
    });
  });

  it("parser sanity: extractDocsInvariantFiresSection finds the H2 and the section body contains the prose header", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const docPath = resolve(here, "../docs/daemon-pre-pr-gate.md");
    const doc = readFileSync(docPath, "utf8");
    const section = extractDocsInvariantFiresSection(doc);
    expect(section).toContain("## When the invariant fires");
    expect(section).toMatch(/with \w+ named root causes/);
  });
});

describe("daemonPrLintPassRateInvariant ↔ docs/TASKS.md jq selector parity (slice 25/N)", () => {
  // Drift protection (TASKS.md `daemon-pre-pr-lint-gate`): the invariant ID
  // string `"daemon-pr-lint-pass-rate"` is set on `daemonPrLintPassRateInvariant`'s
  // returned function via `fn.invariantId = ...` (canonical source: the
  // factory in `scripts/self-diagnose.mjs`). Two operator-facing surfaces
  // mirror that exact string inside a `jq` selector so operators can probe
  // the live verdict:
  //
  //   - `docs/daemon-pre-pr-gate.md` § "What you'll see day-to-day":
  //       node scripts/self-diagnose.mjs --json |
  //         jq '.[] | select(.id == "daemon-pr-lint-pass-rate")'
  //   - `TASKS.md` task block § "Measurement" (the pre-registered metric
  //     verification one-liner): same `select(.id == "...")` predicate.
  //
  // No parity check before this slice — a refactor renaming the invariant
  // ID in the source would update the existing
  // `expect(result.id).toBe(...)` test (line 372) but the docs and the
  // task-block verification command would silently keep referencing the
  // old name; operators run the documented `jq` query, get an empty
  // result, and conclude the invariant isn't firing when in fact the
  // selector is stale. Same shape as slice 24/N (noop-exit token
  // brief↔invariant↔docs parity), applied to a different load-bearing
  // string with a different canonical source.

  it('invariant ID set on `fn.invariantId` matches the `select(.id == "…")` literal in both docs and TASKS.md', () => {
    // Pull the canonical ID off the function the way `runInvariants` does
    // — `(fn).invariantId` is the same property name self-diagnose's
    // runner uses to label findings, so this is the source of truth, not
    // a freshly-typed string. The factory needs an opts object; the
    // recentDaemonPrs probe is never invoked because we only read the
    // attached property.
    const fn = daemonPrLintPassRateInvariant({ recentDaemonPrs: async () => [] });
    const id = /** @type {{ invariantId?: string }} */ (fn).invariantId;
    // Sanity: the property must exist and be a non-empty kebab-case token.
    // Without this, a regression that drops the `(fn).invariantId = …`
    // assignment would make `id` `undefined`, and `select(.id == "undefined")`
    // would silently pass `toContain` against… nothing useful.
    expect(id).toMatch(/^[a-z][a-z0-9-]+$/);

    // The selector predicate is the load-bearing shape — the literal
    // string by itself appears in plenty of unrelated prose, but the
    // `select(.id == "…")` substring uniquely identifies the operator's
    // jq query. Pin that exact predicate, not just the bare ID.
    const selector = `select(.id == "${id}")`;

    const here = dirname(fileURLToPath(import.meta.url));
    const docs = readFileSync(resolve(here, "../docs/daemon-pre-pr-gate.md"), "utf8");
    const tasks = readFileSync(resolve(here, "../TASKS.md"), "utf8");
    expect(docs).toContain(selector);
    expect(tasks).toContain(selector);
  });
});

describe("gitConfigParseableInvariant", () => {
  it("passes when git status exits cleanly under threshold", async () => {
    const probeGitStatus = async () => ({ ok: true, durationMs: 50 });
    const scanGitConfigForConflicts = async () => [];
    const result = await gitConfigParseableInvariant({
      probeGitStatus,
      scanGitConfigForConflicts,
    })();
    expect(result.ok).toBe(true);
  });

  it("fires with conflict-marker evidence when git status fails AND ~/.gitconfig has merge markers", async () => {
    const probeGitStatus = async () => ({
      ok: false,
      durationMs: 100,
      stderr: "fatal: bad config line 100 in file ~/.gitconfig",
    });
    const scanGitConfigForConflicts = async () => [
      { line: 100, marker: "<<<<<<<" },
      { line: 108, marker: "=======" },
      { line: 111, marker: ">>>>>>>" },
    ];
    const result = await gitConfigParseableInvariant({
      probeGitStatus,
      scanGitConfigForConflicts,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("git-config-parseable");
    expect(result.evidence).toContain("bad config line 100");
    expect(result.evidence).toContain("line 100");
    expect(result.evidence).toContain("<<<<<<<");
    expect(result.suggestedFix).toContain("Resolve the conflict markers");
  });

  it("fires on slow git status (over threshold) even when no markers found", async () => {
    const probeGitStatus = async () => ({ ok: true, durationMs: 6000 });
    const scanGitConfigForConflicts = async () => [];
    const result = await gitConfigParseableInvariant({
      probeGitStatus,
      scanGitConfigForConflicts,
      timeoutMs: 5000,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("6000ms");
    expect(result.suggestedFix).toContain("git status is failing or slow");
  });

  it("fires when git status fails and no markers found (other corruption)", async () => {
    const probeGitStatus = async () => ({ ok: false, durationMs: 80, stderr: "ENOENT" });
    const scanGitConfigForConflicts = async () => [];
    const result = await gitConfigParseableInvariant({
      probeGitStatus,
      scanGitConfigForConflicts,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.suggestedFix).toContain("no conflict markers found");
    expect(result.suggestedFix).toContain("rm .git/index.lock");
  });
});

describe("daemonPrStuckDirtyInvariant", () => {
  it("passes when no PR is dirty", async () => {
    const openDaemonPrs = async () => [
      { number: 1, mergeableState: "clean", ageHours: 5 },
      { number: 2, mergeableState: "behind", ageHours: 10 },
    ];
    const result = await daemonPrStuckDirtyInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(true);
  });

  it("passes when a dirty PR is younger than the threshold", async () => {
    const openDaemonPrs = async () => [{ number: 1, mergeableState: "dirty", ageHours: 1 }];
    const result = await daemonPrStuckDirtyInvariant({ openDaemonPrs, maxAgeHours: 2 })();
    expect(result.ok).toBe(true);
  });

  it("fires for dirty PRs older than threshold and emits update-branch fix", async () => {
    const openDaemonPrs = async () => [
      { number: 227, mergeableState: "dirty", ageHours: 6.5 },
      { number: 999, mergeableState: "dirty", ageHours: 3.2 },
    ];
    const result = await daemonPrStuckDirtyInvariant({ openDaemonPrs, maxAgeHours: 2 })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-pr-stuck-dirty");
    expect(result.evidence).toContain("#227");
    expect(result.evidence).toContain("6.5h");
    expect(result.suggestedFix).toContain("gh pr update-branch 227");
    expect(result.suggestedFix).toContain("gh pr update-branch 999");
  });

  it("uses default threshold of 2 hours when none provided", async () => {
    const openDaemonPrs = async () => [{ number: 1, mergeableState: "dirty", ageHours: 2.5 }];
    const result = await daemonPrStuckDirtyInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(false);
  });
});

describe("daemonPrThrashInvariant", () => {
  // Paired cases per the task's Verification field:
  // pr-fresh / pr-aged-fresh-commits / pr-aged-many-commits / pr-merged.

  it("pr-fresh: passes for a young PR with few commits", async () => {
    const openDaemonPrs = async () => [
      { number: 1, commitCount: 2, ageHours: 0.5, mergeable: "CONFLICTING" },
    ];
    const result = await daemonPrThrashInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(true);
    expect(result.id).toBe("daemon-pr-thrash");
  });

  it("pr-aged-fresh-commits: passes for an old PR that has NOT over-accumulated commits", async () => {
    const openDaemonPrs = async () => [
      { number: 2, commitCount: 3, ageHours: 9, mergeable: "CONFLICTING" },
    ];
    const result = await daemonPrThrashInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(true);
  });

  it("pr-aged-many-commits: fires for an old, commit-stacked, non-MERGEABLE PR", async () => {
    const openDaemonPrs = async () => [
      { number: 322, commitCount: 11, ageHours: 5, mergeable: "CONFLICTING" },
      { number: 99, commitCount: 2, ageHours: 0.1, mergeable: "MERGEABLE" },
    ];
    const result = await daemonPrThrashInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-pr-thrash");
    expect(result.evidence).toContain("#322");
    expect(result.evidence).toContain("11 commits");
    expect(result.evidence).not.toContain("#99");
    expect(result.suggestedFix).toContain("rebase #322 or close it");
    expect(result.suggestedFix).toContain("do NOT add more commits");
  });

  it("pr-merged: passes when an old, commit-stacked PR is MERGEABLE (about to land, not thrashing)", async () => {
    const openDaemonPrs = async () => [
      { number: 400, commitCount: 12, ageHours: 6, mergeable: "MERGEABLE" },
    ];
    const result = await daemonPrThrashInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(true);
  });

  it("respects custom maxCommits / maxAgeHours when injected (pivot lever)", async () => {
    const openDaemonPrs = async () => [
      { number: 7, commitCount: 8, ageHours: 3, mergeable: "CONFLICTING" },
    ];
    const fireResult = await daemonPrThrashInvariant({ openDaemonPrs })();
    expect(fireResult.ok).toBe(false);
    const pivotResult = await daemonPrThrashInvariant({
      openDaemonPrs,
      maxCommits: 10,
      maxAgeHours: 4,
    })();
    expect(pivotResult.ok).toBe(true);
  });
});

describe("daemonTaskScopeExplosionInvariant", () => {
  it("passes when no taskId crosses the threshold", async () => {
    const mergedPrCountByTaskId = async () =>
      new Map([
        ["task-a", 3],
        ["task-b", 2],
      ]);
    const result = await daemonTaskScopeExplosionInvariant({ mergedPrCountByTaskId })();
    expect(result.ok).toBe(true);
  });

  it("fires when a taskId ships ≥threshold PRs in 24h and names the offender in suggestedFix", async () => {
    const mergedPrCountByTaskId = async () =>
      new Map([
        ["daemon-pre-pr-lint-gate", 18],
        ["task-b", 2],
      ]);
    const result = await daemonTaskScopeExplosionInvariant({
      mergedPrCountByTaskId,
      threshold: 6,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("daemon-task-scope-explosion");
    expect(result.evidence).toContain("daemon-pre-pr-lint-gate: 18 PRs/24h");
    expect(result.evidence).not.toContain("task-b");
    expect(result.suggestedFix).toContain("close the task block");
    expect(result.suggestedFix).toContain("daemon-pre-pr-lint-gate");
  });

  it("fires across multiple exploded taskIds", async () => {
    const mergedPrCountByTaskId = async () =>
      new Map([
        ["task-a", 7],
        ["task-b", 9],
      ]);
    const result = await daemonTaskScopeExplosionInvariant({
      mergedPrCountByTaskId,
      threshold: 6,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("task-a: 7 PRs/24h");
    expect(result.evidence).toContain("task-b: 9 PRs/24h");
  });

  it("uses default threshold of 6 when none provided", async () => {
    const mergedPrCountByTaskId = async () => new Map([["task-x", 6]]);
    const result = await daemonTaskScopeExplosionInvariant({ mergedPrCountByTaskId })();
    expect(result.ok).toBe(false);
  });
});

describe("claudePrintTimeoutFrequencyInvariant", () => {
  it("passes when count is 0 (no timeouts in window)", async () => {
    const countTimeoutsInRollingWindow = () => Promise.resolve(0);
    const result = await claudePrintTimeoutFrequencyInvariant({ countTimeoutsInRollingWindow })();
    expect(result.ok).toBe(true);
    expect(result.id).toBe("claude-print-timeout-frequency");
  });

  it("passes at the default threshold boundary (count == 14)", async () => {
    const countTimeoutsInRollingWindow = () => Promise.resolve(14);
    const result = await claudePrintTimeoutFrequencyInvariant({ countTimeoutsInRollingWindow })();
    expect(result.ok).toBe(true);
  });

  it("fires when count exceeds the default threshold (15 > 14)", async () => {
    const countTimeoutsInRollingWindow = () => Promise.resolve(15);
    const result = await claudePrintTimeoutFrequencyInvariant({ countTimeoutsInRollingWindow })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("claude-print-timeout-frequency");
    expect(result.evidence).toContain("15");
    expect(result.evidence).toContain("rolling 7d window");
    expect(result.evidence).toContain("threshold 14");
    expect(result.suggestedTaskTitle).toContain("15 in 7d");
    expect(result.suggestedFix).toContain("MINSKY_CLAUDE_PRINT_TIMEOUT_MS");
    expect(result.suggestedFix).toContain(".minsky/workers/*.log");
  });

  it("honours custom threshold and names it in evidence + title", async () => {
    const countTimeoutsInRollingWindow = () => Promise.resolve(6);
    const result = await claudePrintTimeoutFrequencyInvariant({
      countTimeoutsInRollingWindow,
      threshold: 5,
    })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("threshold 5");
    expect(result.suggestedTaskTitle).toContain("threshold 5");
  });

  it("uses default threshold of 14 when none provided", async () => {
    // count == 14 should pass (boundary), count == 15 should fail (above)
    const passResult = await claudePrintTimeoutFrequencyInvariant({
      countTimeoutsInRollingWindow: () => Promise.resolve(14),
    })();
    const fireResult = await claudePrintTimeoutFrequencyInvariant({
      countTimeoutsInRollingWindow: () => Promise.resolve(15),
    })();
    expect(passResult.ok).toBe(true);
    expect(fireResult.ok).toBe(false);
  });

  it("attaches invariantId on the function for runInvariants dispatch", () => {
    const fn = claudePrintTimeoutFrequencyInvariant({
      countTimeoutsInRollingWindow: () => Promise.resolve(0),
    });
    const id = /** @type {{ invariantId?: string }} */ (fn).invariantId;
    expect(id).toBe("claude-print-timeout-frequency");
  });
});

describe("daemonInFlightPrCollisionInvariant — task-prefix sibling-branch detection", () => {
  it("groups sibling slice-N branches as the same taskId via title backtick", async () => {
    const openDaemonPrs = async () => [
      {
        number: 218,
        taskId: "daemon-pre-pr-lint-gate",
        files: ["scripts/run-pre-pr-lint-stack.mjs", "package.json"],
      },
      {
        number: 219,
        taskId: "daemon-pre-pr-lint-gate",
        files: ["scripts/run-pre-pr-lint-stack.mjs", "package.json"],
      },
    ];
    const result = await daemonInFlightPrCollisionInvariant({ openDaemonPrs })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("#218");
    expect(result.evidence).toContain("#219");
    expect(result.evidence).toContain("daemon-pre-pr-lint-gate");
  });
});

describe("formatEtime", () => {
  it("formats sub-minute as Ns", () => {
    expect(formatEtime(45)).toBe("45s");
  });
  it("formats sub-hour as MmSs", () => {
    expect(formatEtime(125)).toBe("2m5s");
  });
  it("formats over-hour as HhMmSs", () => {
    expect(formatEtime(7320)).toBe("2h2m0s");
  });
  it("handles zero", () => {
    expect(formatEtime(0)).toBe("0s");
  });
});

describe("parseEtime", () => {
  it("parses MM:SS", () => {
    expect(parseEtime("02:30")).toBe(150);
  });
  it("parses HH:MM:SS", () => {
    expect(parseEtime("01:00:00")).toBe(3600);
  });
  it("parses DD-HH:MM:SS", () => {
    expect(parseEtime("1-00:00:00")).toBe(86400);
  });
  it("parses bare seconds (single component)", () => {
    expect(parseEtime("42")).toBe(42);
  });
  it("returns null on malformed input", () => {
    expect(parseEtime("not-a-time")).toBeNull();
    expect(parseEtime("a:b")).toBeNull();
  });
  it("returns null on too many components (>3)", () => {
    expect(parseEtime("1:2:3:4")).toBeNull();
  });
});

describe("extractTaskIdFromPr", () => {
  it("prefers backticked taskId from title", () => {
    expect(extractTaskIdFromPr("daemon-foo-slice-2", "feat: ship `my-task` slice 2")).toBe(
      "my-task",
    );
  });
  it("falls back to branch when title has no backtick", () => {
    expect(extractTaskIdFromPr("daemon-foo-bar", "feat: ship slice")).toBe("daemon-foo-bar");
  });
  it("strips feat/ prefix from branch", () => {
    expect(extractTaskIdFromPr("feat/daemon-foo", "x")).toBe("daemon-foo");
  });
  it("collapses sibling slice/substrate branches to same taskId", () => {
    const a = extractTaskIdFromPr("daemon-pre-pr-lint-gate-substrate", "feat: ship");
    const b = extractTaskIdFromPr("daemon-pre-pr-lint-gate-slice-2", "feat: ship");
    const c = extractTaskIdFromPr("daemon-pre-pr-lint-gate-slice-12-docs", "feat: ship");
    expect(a).toBe("daemon-pre-pr-lint-gate");
    expect(b).toBe("daemon-pre-pr-lint-gate");
    expect(c).toBe("daemon-pre-pr-lint-gate");
  });
  it("returns null when input has no recognizable taskId", () => {
    expect(extractTaskIdFromPr("", "")).toBeNull();
  });
});

describe("stripBranchPrefix", () => {
  it("strips feat/, fix/, chore/, docs/", () => {
    expect(stripBranchPrefix("feat/foo")).toBe("foo");
    expect(stripBranchPrefix("fix/foo")).toBe("foo");
    expect(stripBranchPrefix("chore/foo")).toBe("foo");
    expect(stripBranchPrefix("docs/foo")).toBe("foo");
  });
  it("returns input unchanged when no recognized prefix", () => {
    expect(stripBranchPrefix("daemon-foo")).toBe("daemon-foo");
  });
});

describe("stripBranchSuffixes", () => {
  it("strips -slice-N", () => {
    expect(stripBranchSuffixes("daemon-foo-slice-2")).toBe("daemon-foo");
  });
  it("strips -slice-N-docs", () => {
    expect(stripBranchSuffixes("daemon-foo-slice-12-docs")).toBe("daemon-foo");
  });
  it("strips -substrate", () => {
    expect(stripBranchSuffixes("daemon-foo-substrate")).toBe("daemon-foo");
  });
  it("strips -final", () => {
    expect(stripBranchSuffixes("daemon-foo-final")).toBe("daemon-foo");
  });
  it("strips -rebased", () => {
    expect(stripBranchSuffixes("daemon-foo-rebased")).toBe("daemon-foo");
  });
  it("strips -vN", () => {
    expect(stripBranchSuffixes("daemon-foo-v2")).toBe("daemon-foo");
  });
  it("idempotent on already-clean branch", () => {
    expect(stripBranchSuffixes("daemon-foo")).toBe("daemon-foo");
  });
});

describe("detectConflictMarker", () => {
  it("detects each marker type", () => {
    expect(detectConflictMarker("<<<<<<< Updated upstream")).toBe("<<<<<<<");
    expect(detectConflictMarker(">>>>>>> Stashed changes")).toBe(">>>>>>>");
    expect(detectConflictMarker("||||||| Stash base")).toBe("|||||||");
  });
  it("returns null on a regular line", () => {
    expect(detectConflictMarker("[user]")).toBeNull();
    expect(detectConflictMarker("=======")).toBeNull();
  });
});

describe("findConflictMarkers", () => {
  it("returns empty for clean content", () => {
    expect(findConflictMarkers("[user]\n  email = x@y.com\n")).toEqual([]);
  });
  it("locates each marker by line number", () => {
    const content = [
      "[a]",
      "<<<<<<< Updated upstream",
      "  helper = a",
      "||||||| Stash base",
      "  helper = b",
      "=======",
      "  helper = c",
      ">>>>>>> Stashed changes",
    ].join("\n");
    const markers = findConflictMarkers(content);
    expect(markers).toEqual([
      { line: 2, marker: "<<<<<<<" },
      { line: 4, marker: "|||||||" },
      { line: 8, marker: ">>>>>>>" },
    ]);
  });
});

describe("parseIterationLogLine", () => {
  it("returns null on empty line", () => {
    expect(parseIterationLogLine("")).toBeNull();
  });
  it("returns null on non-JSON line", () => {
    expect(parseIterationLogLine("not json at all")).toBeNull();
  });
  it("returns null on JSON missing the iteration evt", () => {
    expect(parseIterationLogLine('{"evt":"other","taskId":"x"}')).toBeNull();
  });
  it("parses a committed iteration line", () => {
    const result = parseIterationLogLine(
      '{"evt":"iteration","taskId":"foo","committedSha":"abc123","ts":"2026-05-06T00:00:00Z"}',
    );
    expect(result).toEqual({ taskId: "foo", committed: true, timestamp: "2026-05-06T00:00:00Z" });
  });
  it("parses a non-committed iteration line", () => {
    const result = parseIterationLogLine('{"evt":"iteration","taskId":"foo"}');
    expect(result).toEqual({ taskId: "foo", committed: false, timestamp: "" });
  });
});

describe("defaultInvariants", () => {
  it("returns at least 12 invariants (covering all the named gap-detectors)", () => {
    const invariants = defaultInvariants();
    expect(invariants.length).toBeGreaterThanOrEqual(12);
  });
  it("each invariant is a callable function", () => {
    for (const inv of defaultInvariants()) {
      expect(typeof inv).toBe("function");
    }
  });
  it("runInvariants(defaultInvariants()) executes every probe and returns an array", async () => {
    const findings = await runInvariants(defaultInvariants());
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings) {
      expect(f.ok).toBe(false);
      expect(typeof f.id).toBe("string");
      expect(typeof f.evidence).toBe("string");
      expect(typeof f.suggestedFix).toBe("string");
      expect(typeof f.suggestedTaskTitle).toBe("string");
    }
    // 600s (not 120s/300s): this case runs all 99 invariants, each
    // shelling out to real git/gh/fs probes. It completes in ~26s in
    // isolation but is starved well past 120s when the whole-repo vitest
    // suite runs it in the parallel pool (the `pnpm pre-pr-lint
    // --stage=full` pre-push path). 300s was raised to 600s after it was
    // observed timing out at exactly 300000ms in the pre-push gate under
    // ~20-daemon worktree-swarm contention (every daemon's full-stage
    // vitest pool sharing one machine). The work is deterministic — only
    // wall-time under contention exceeds the cap — so a larger timeout is
    // the correct remedy (vitest's own timeout-exceeded guidance) rather
    // than masking a logic failure.
  }, 600_000);
});

describe("CANONICAL_REPO is single-sourced from daemon-pr-lint-metrics", () => {
  // Slice extension: the metric script (daemon-pr-lint-metrics.mjs) already
  // exports CANONICAL_REPO so the rolling-30d query is immune to origin
  // pollution (slice 14). The two `gh pr list --repo …` callers in
  // self-diagnose.mjs (`openDaemonPrsForDirty`, `mergedPrCountByTaskId`)
  // used to hardcode the same string, so a fork or repo rename would have
  // to flip three places. Pin the absence of the literal so future drift
  // can't silently re-introduce the duplicate.
  const SOURCE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "self-diagnose.mjs");

  it("self-diagnose.mjs holds zero hardcoded `fyodoriv/minsky` literals", () => {
    const src = readFileSync(SOURCE_PATH, "utf8");
    expect(src).not.toMatch(/"fyodoriv\/minsky"/);
  });

  it("self-diagnose.mjs imports CANONICAL_REPO from daemon-pr-lint-metrics", () => {
    const src = readFileSync(SOURCE_PATH, "utf8");
    expect(src).toMatch(/CANONICAL_REPO[\s\S]*?from "\.\/daemon-pr-lint-metrics\.mjs"/);
  });
});

describe("mapGhPrListToCiSnapshots", () => {
  it("returns empty for empty input", () => {
    expect(mapGhPrListToCiSnapshots([])).toEqual([]);
  });
  it("counts FAILURE checks across both .conclusion and .state shapes", () => {
    const out = mapGhPrListToCiSnapshots([
      {
        number: 1,
        headRefName: "feat/a",
        statusCheckRollup: [
          { conclusion: "FAILURE", state: null },
          { conclusion: "SUCCESS", state: null },
          { conclusion: null, state: "FAILURE" },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        number: 1,
        headRefName: "feat/a",
        ciFailureCount: 2,
        hasDaemonFixCommitSinceLastFailure: false,
      },
    ]);
  });
  it("handles missing statusCheckRollup gracefully", () => {
    const out = mapGhPrListToCiSnapshots([{ number: 9, headRefName: "feat/x" }]);
    expect(out[0]?.ciFailureCount).toBe(0);
  });
  it("filters out null/undefined check entries", () => {
    const out = mapGhPrListToCiSnapshots([
      {
        number: 1,
        headRefName: "feat/a",
        statusCheckRollup: [null, { conclusion: "FAILURE" }, undefined],
      },
    ]);
    expect(out[0]?.ciFailureCount).toBe(1);
  });
});

describe("findingsToTasksMd — additional cases", () => {
  it("renders multiple findings as separate task blocks", () => {
    const block = findingsToTasksMd(
      [
        {
          id: "first",
          ok: false,
          evidence: "e1",
          suggestedTaskTitle: "t1",
          suggestedFix: "f1",
        },
        {
          id: "second",
          ok: false,
          evidence: "e2",
          suggestedTaskTitle: "t2",
          suggestedFix: "f2",
        },
      ],
      "2026-05-06T00:00:00.000Z",
    );
    expect(block).toContain("self-diagnose-first-2026-05-06");
    expect(block).toContain("self-diagnose-second-2026-05-06");
    expect(block).toContain("**Hypothesis**: f1");
    expect(block).toContain("**Hypothesis**: f2");
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
    expect(block).toContain("**Tags**: p0, self-detected, token-monitor-not-all-pegged");
  });

  // Regression pin for `daemon-self-detect-throughput-issues`: the rendered
  // `**Tags**:` line MUST carry a `p0` priority tag matching the exact
  // contract `scripts/drain-concerns.mjs` uses to route a pending block to
  // its `## PX` section (`PRIORITY_TAG = /\b(p[0-3])\b/i` applied to the
  // Tags line). Before this pin the line read `self-detected, <id>` with no
  // priority tag, so the drainer matched nothing, moved every finding to
  // `invalid/`, and the daemon could detect a throughput issue but never
  // file it as a pickable P0 task. Encoding the contract as a test (not
  // just a comment) is the "every bug becomes a rule" guardrail — if a
  // future edit drops the tag, this fails loudly instead of silently
  // re-breaking autonomous filing.
  it("emits a p0 priority tag the drain-concerns pipeline routes to ## P0", () => {
    const drainPriorityTag = /\b(p[0-3])\b/i;
    const block = findingsToTasksMd(
      [
        {
          id: "daemon-noop-iteration-rate-too-high",
          ok: false,
          evidence: "5 consecutive noop iterations on `foo`",
          suggestedTaskTitle: "daemon stuck in noop loop",
          suggestedFix: "investigate the spawn path",
        },
      ],
      "2026-05-17T00:00:00.000Z",
    );
    const tagsLine = block.split("\n").find((l) => l.match(/^\s*-\s+\*\*Tags\*\*:/));
    expect(tagsLine).toBeDefined();
    const m = String(tagsLine).match(drainPriorityTag);
    expect(m).not.toBeNull();
    expect(String(m?.[1]).toLowerCase()).toBe("p0");
  });
});

describe("modelCatalogInvariantsHoldInvariant — slice 7 of `claude-usage-aware-strategic-model-router`", () => {
  it("passes when validate() returns ok", async () => {
    const validate = () => ({ ok: true, errors: [] });
    const result = await modelCatalogInvariantsHoldInvariant({ validate })();
    expect(result.ok).toBe(true);
    expect(result.id).toBe("model-catalog-invariants-hold");
  });

  it("fires with the validation errors when validate() returns ok=false", async () => {
    const validate = () => ({
      ok: false,
      errors: ["entry 2 (haiku): qualityTier 3 > prev tier 2"],
    });
    const result = await modelCatalogInvariantsHoldInvariant({ validate })();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.id).toBe("model-catalog-invariants-hold");
    expect(result.evidence).toContain("MODEL_CATALOG fails validation");
    expect(result.evidence).toContain("qualityTier 3 > prev tier 2");
    expect(result.suggestedFix).toContain("model-catalog.ts");
  });

  it("joins multiple validation errors with semicolons", async () => {
    const validate = () => ({
      ok: false,
      errors: ["error A", "error B", "error C"],
    });
    const result = await modelCatalogInvariantsHoldInvariant({ validate })();
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("error A; error B; error C");
  });
});

describe("localServerConcurrencyMismatchInvariant — slice 1 of `local-server-concurrency-aware-worker-spawn`", () => {
  it("passes when env is unset (gate engaged, cap defaults to 1)", async () => {
    const probe = async () => ({ ok: true, body: "{}" });
    const inv = localServerConcurrencyMismatchInvariant({ envValue: undefined, probe });
    const result = await inv();
    expect(result.ok).toBe(true);
    expect(result.id).toBe("local-server-concurrency-mismatch");
  });

  it("passes when env=1 (gate engaged)", async () => {
    const probe = async () => ({ ok: true, body: "{}" });
    const inv = localServerConcurrencyMismatchInvariant({ envValue: "1", probe });
    const result = await inv();
    expect(result.ok).toBe(true);
  });

  it("passes when env=non-numeric (falls back to safe)", async () => {
    const probe = async () => ({ ok: true, body: "{}" });
    const inv = localServerConcurrencyMismatchInvariant({ envValue: "auto", probe });
    const result = await inv();
    expect(result.ok).toBe(true);
  });

  it("passes when env≥2 AND probe body advertises concurrency (vLLM/sglang/Pro)", async () => {
    const probe = async () => ({
      ok: true,
      body: '{"object":"list","data":[],"max_concurrent_requests":8}',
    });
    const inv = localServerConcurrencyMismatchInvariant({ envValue: "8", probe });
    const result = await inv();
    expect(result.ok).toBe(true);
  });

  it("fires when env≥2 AND probe body has no concurrency hints (stock mlx_lm.server)", async () => {
    const probe = async () => ({
      ok: true,
      body: '{"object":"list","data":[{"id":"mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"}]}',
    });
    const inv = localServerConcurrencyMismatchInvariant({ envValue: "5", probe });
    const result = await inv();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.evidence).toContain("MINSKY_LOCAL_SERVER_MAX_CONCURRENT=5");
    expect(result.evidence).toContain("GPU-OOM");
    expect(result.suggestedFix).toContain("Unset MINSKY_LOCAL_SERVER_MAX_CONCURRENT");
  });

  it("passes when probe is down (no signal — don't fire spuriously)", async () => {
    const probe = async () => ({ ok: false });
    const inv = localServerConcurrencyMismatchInvariant({ envValue: "5", probe });
    const result = await inv();
    expect(result.ok).toBe(true);
  });

  it("recognises vllm hint", async () => {
    const probe = async () => ({ ok: true, body: '{"backend":"vllm-openai-server"}' });
    const inv = localServerConcurrencyMismatchInvariant({ envValue: "8", probe });
    const result = await inv();
    expect(result.ok).toBe(true);
  });
});
