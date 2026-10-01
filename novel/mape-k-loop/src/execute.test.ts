import { StubPromptOptimizer } from "@minsky/prompt-optimizer";
import { describe, expect, it } from "vitest";

import { execute } from "./execute.js";
import type { Variant } from "./plan.js";
import type { RolloutHistoryEntry } from "./sustained-gain.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const variants: readonly Variant[] = [
  {
    id: "rule-9-direct-answer",
    basePrompt: "you are an assistant",
    mutation: "swap CoT for direct-answer",
    rationale: "rationale-1",
  },
  {
    id: "rule-9-tighten-scope",
    basePrompt: "you are an assistant",
    mutation: "tighten scope",
    rationale: "rationale-2",
  },
];

const evalSet = [{ task: "summarise" }, { task: "extract" }];

/**
 * Score: variant a returns 1.0, variant b returns 0.5 — variant a wins.
 */
const metricFavouringDirectAnswer = async (output: string): Promise<number> => {
  if (output.startsWith("rule-9-direct-answer")) return 1.0;
  return 0.5;
};

/**
 * Build a history that satisfies the sustained-gain guard for `winnerId` over
 * the last 7 days.
 */
const sustainedHistory = (winnerId: string, now: Date): RolloutHistoryEntry[] => {
  const earliest = new Date(now.getTime() - 7 * MS_PER_DAY);
  const mid = new Date(now.getTime() - 3 * MS_PER_DAY);
  return [
    {
      iteration: 1,
      ts: earliest.toISOString(),
      variantId: winnerId,
      decision: "rollout",
      score: 0.9,
    },
    { iteration: 2, ts: mid.toISOString(), variantId: winnerId, decision: "rollout", score: 0.95 },
    {
      iteration: 3,
      ts: now.toISOString(),
      variantId: winnerId,
      decision: "rollout",
      score: 1.0,
    },
  ];
};

describe("execute", () => {
  it("rolls out the highest-scoring variant when both guards pass", async () => {
    const optimizer = new StubPromptOptimizer();
    const now = new Date("2026-05-10T00:00:00Z");
    const result = await execute({
      variants,
      evalSet,
      optimizer,
      metric: metricFavouringDirectAnswer,
      history: sustainedHistory("rule-9-direct-answer", now),
      now,
    });
    expect(result.decision).toBe("rollout");
    expect(result.winner?.id).toBe("rule-9-direct-answer");
    expect(result.abMetrics).toHaveLength(2);
    const winnerScore = result.abMetrics.find((m) => m.variantId === "rule-9-direct-answer");
    expect(winnerScore?.score).toBeCloseTo(1.0);
  });

  it("abstains when sustained-gain fails (insufficient history)", async () => {
    const optimizer = new StubPromptOptimizer();
    const now = new Date("2026-05-10T00:00:00Z");
    const result = await execute({
      variants,
      evalSet,
      optimizer,
      metric: metricFavouringDirectAnswer,
      history: [], // no history → cold start → sustained-gain refuses
      now,
    });
    expect(result.decision).toBe("abstain");
    expect(result.winner?.id).toBe("rule-9-direct-answer");
    expect(result.reason).toMatch(/sustained-gain/);
  });

  it("abstains when oscillation fails (variant recently rejected)", async () => {
    const optimizer = new StubPromptOptimizer();
    const now = new Date("2026-05-10T00:00:00Z");
    const history: RolloutHistoryEntry[] = [
      ...sustainedHistory("rule-9-direct-answer", now),
      {
        iteration: 4,
        ts: now.toISOString(),
        variantId: "rule-9-direct-answer",
        decision: "rejected",
      },
    ];
    const result = await execute({
      variants,
      evalSet,
      optimizer,
      metric: metricFavouringDirectAnswer,
      history,
      now,
    });
    expect(result.decision).toBe("abstain");
    expect(result.reason).toMatch(/oscillation/);
  });

  it("returns null winner gracefully when variants is empty", async () => {
    const optimizer = new StubPromptOptimizer();
    const now = new Date("2026-05-10T00:00:00Z");
    const result = await execute({
      variants: [],
      evalSet,
      optimizer,
      metric: metricFavouringDirectAnswer,
      history: [],
      now,
    });
    expect(result.winner).toBeNull();
    expect(result.decision).toBe("abstain");
    expect(result.reason).toMatch(/variants is empty/);
  });

  it("forwards sustainedGainWindowDays into the guard (custom 3-d window passes)", async () => {
    const optimizer = new StubPromptOptimizer();
    const now = new Date("2026-05-10T00:00:00Z");
    const earliest = new Date(now.getTime() - 3 * MS_PER_DAY);
    const history: RolloutHistoryEntry[] = [
      {
        iteration: 1,
        ts: earliest.toISOString(),
        variantId: "rule-9-direct-answer",
        decision: "rollout",
        score: 0.9,
      },
      {
        iteration: 2,
        ts: now.toISOString(),
        variantId: "rule-9-direct-answer",
        decision: "rollout",
        score: 1.0,
      },
    ];
    const result = await execute({
      variants,
      evalSet,
      optimizer,
      metric: metricFavouringDirectAnswer,
      history,
      now,
      sustainedGainWindowDays: 3,
    });
    expect(result.decision).toBe("rollout");
  });
});
