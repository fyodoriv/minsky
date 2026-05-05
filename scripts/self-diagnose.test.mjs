import { describe, expect, it } from "vitest";

import {
  claudeBinaryReachableInvariant,
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
