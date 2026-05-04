import { StubPromptOptimizer } from "@minsky/prompt-optimizer";
import { describe, expect, it } from "vitest";

import type { Advisory } from "./monitor.js";
import { orchestrate } from "./orchestrator.js";
import type { RolloutHistoryEntry } from "./sustained-gain.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-10T00:00:00Z");

const sustainedHistoryFor = (variantId: string): RolloutHistoryEntry[] => {
  const earliest = new Date(NOW.getTime() - 7 * MS_PER_DAY);
  const mid = new Date(NOW.getTime() - 3 * MS_PER_DAY);
  return [
    { iteration: 1, ts: earliest.toISOString(), variantId, decision: "rollout", score: 0.9 },
    { iteration: 2, ts: mid.toISOString(), variantId, decision: "rollout", score: 0.95 },
    { iteration: 3, ts: NOW.toISOString(), variantId, decision: "rollout", score: 1.0 },
  ];
};

const oneAdvisory: Advisory = {
  ruleId: "rule-9",
  evidence: "missing pre-registration in PR #42",
  severity: "high",
  createdAt: "2026-05-09T00:00:00Z",
};

const metricFavouringFirst = async (output: string): Promise<number> => {
  if (output.includes("enumerate-failure-modes")) return 1.0;
  return 0.5;
};

describe("orchestrate — happy-path rollout draft", () => {
  it("emits a rollout draft with branch slug + EXPERIMENT.yaml carrying predicted gain", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    const result = await orchestrate({
      verdictLog: [
        {
          id: "exp-a",
          verdict: "validated",
          value: 1.0,
          ts: "2026-05-09T00:00:00Z",
          predicted: 1.0,
        },
      ],
      constraintsMdTail: "",
      currentPrompts: { default: "you are a helpful assistant" },
      optimizer: new StubPromptOptimizer(),
      history: sustainedHistoryFor(winnerId),
      now: NOW,
      advisories: [oneAdvisory, oneAdvisory, oneAdvisory],
      metric: metricFavouringFirst,
    });

    expect(result.tickResult.rolloutDecision?.decision).toBe("rollout");
    expect(result.rolloutDraft).toBeDefined();
    expect(result.rolloutDraft?.variantId).toBe(winnerId);
    expect(result.rolloutDraft?.branchSlug).toBe(`mape-k-rollout-${winnerId}-2026-05-10`);
    expect(result.rolloutDraft?.experimentYaml).toMatch(/^id: /);
    expect(result.rolloutDraft?.experimentYaml).toContain("hypothesis:");
    expect(result.rolloutDraft?.experimentYaml).toContain("success:");
    expect(result.rolloutDraft?.experimentYaml).toContain("pivot:");
    expect(result.rolloutDraft?.experimentYaml).toContain("measurement:");
    expect(result.rolloutDraft?.experimentYaml).toContain("anchor:");
    // Predicted gain (1.0) is rendered as a 4-decimal float somewhere in the body.
    expect(result.rolloutDraft?.experimentYaml).toMatch(/1\.0000/);
    // Knowledge surface populated.
    expect(result.knowledge.constraintsAppend).toContain("rule-9");
  });
});

describe("orchestrate — oscillation guard suppresses repeat variant", () => {
  it("returns no rolloutDraft when the winner was previously rejected within the lookback window", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    // History: 7 entries spanning the sustained-gain window AND a recent
    // rejection of the same variant id at iteration 4 — oscillation must
    // fire and Execute must abstain.
    const earliest = new Date(NOW.getTime() - 7 * MS_PER_DAY);
    const recent = new Date(NOW.getTime() - 1 * MS_PER_DAY);
    const history: RolloutHistoryEntry[] = [
      {
        iteration: 1,
        ts: earliest.toISOString(),
        variantId: winnerId,
        decision: "rollout",
        score: 1.0,
      },
      {
        iteration: 2,
        ts: recent.toISOString(),
        variantId: winnerId,
        decision: "rejected",
        score: 0.1,
      },
      { iteration: 3, ts: NOW.toISOString(), variantId: winnerId, decision: "rollout", score: 1.0 },
    ];
    const result = await orchestrate({
      verdictLog: [],
      constraintsMdTail: "",
      currentPrompts: { default: "you are a helpful assistant" },
      optimizer: new StubPromptOptimizer(),
      history,
      now: NOW,
      advisories: [oneAdvisory, oneAdvisory, oneAdvisory],
      metric: metricFavouringFirst,
    });
    expect(result.tickResult.rolloutDecision?.decision).toBe("abstain");
    expect(result.rolloutDraft).toBeUndefined();
    expect(result.tickResult.rolloutDecision?.reason).toMatch(/oscillation/);
  });
});

describe("orchestrate — sustained-gain failure abstains", () => {
  it("returns no rolloutDraft when the rollout history is too short for the sustained-gain window", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    // Only one entry, very recent — sustained-gain check must fail because
    // the in-window span is < 7d.
    const result = await orchestrate({
      verdictLog: [],
      constraintsMdTail: "",
      currentPrompts: { default: "you are a helpful assistant" },
      optimizer: new StubPromptOptimizer(),
      history: [
        {
          iteration: 1,
          ts: new Date(NOW.getTime() - 1 * MS_PER_DAY).toISOString(),
          variantId: winnerId,
          decision: "rollout",
          score: 1.0,
        },
      ],
      now: NOW,
      advisories: [oneAdvisory, oneAdvisory, oneAdvisory],
      metric: metricFavouringFirst,
    });
    expect(result.tickResult.rolloutDecision?.decision).toBe("abstain");
    expect(result.tickResult.rolloutDecision?.reason).toMatch(/sustained-gain/);
    expect(result.rolloutDraft).toBeUndefined();
  });
});

describe("orchestrate — no-op when no experiment verdicts available", () => {
  it("runs the tick (Knowledge logs a no-op) and emits no rolloutDraft", async () => {
    const result = await orchestrate({
      verdictLog: [],
      constraintsMdTail: "",
      currentPrompts: { default: "you are a helpful assistant" },
      optimizer: new StubPromptOptimizer(),
      history: [],
      now: NOW,
    });
    expect(result.tickResult.analysis.topConstraint).toBeNull();
    expect(result.tickResult.rolloutDecision).toBeNull();
    expect(result.rolloutDraft).toBeUndefined();
    // Knowledge still records a no-op entry — Helland 2007 audit-trail discipline.
    expect(result.knowledge.constraintsAppend).toMatch(/no-op/);
  });
});

describe("orchestrate — ingest-mode skips rollout entirely", () => {
  it("processes verdicts → constraints append, no Plan/Execute, no rolloutDraft even when constraints exist", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    const result = await orchestrate({
      verdictLog: [
        // Predicted 1.0, observed 0.0 → MAE 1.0 — should fire amendment.
        { id: "a", verdict: "regressed", value: 0.0, ts: "2026-05-09T00:00:00Z", predicted: 1.0 },
        { id: "b", verdict: "regressed", value: 0.0, ts: "2026-05-09T01:00:00Z", predicted: 1.0 },
      ],
      constraintsMdTail: "",
      currentPrompts: { default: "you are a helpful assistant" },
      optimizer: new StubPromptOptimizer(),
      history: sustainedHistoryFor(winnerId),
      now: NOW,
      advisories: [oneAdvisory, oneAdvisory, oneAdvisory],
      metric: metricFavouringFirst,
      ingestMode: true,
      calibrationDriftThreshold: 0.5,
    });
    expect(result.rolloutDraft).toBeUndefined();
    // No rollout decision because Plan/Execute were skipped (no advisories
    // forwarded into Monitor in ingest mode → no top-constraint).
    expect(result.tickResult.rolloutDecision).toBeNull();
    // Calibration MAE > threshold → research amendment proposed.
    expect(result.knowledge.researchAmendmentProposal).not.toBeNull();
  });
});

describe("orchestrate — maxRollouts cap suppresses draft", () => {
  it("returns no rolloutDraft when maxRollouts is 0, even on a passing rollout decision", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    const result = await orchestrate({
      verdictLog: [],
      constraintsMdTail: "",
      currentPrompts: { default: "you are a helpful assistant" },
      optimizer: new StubPromptOptimizer(),
      history: sustainedHistoryFor(winnerId),
      now: NOW,
      advisories: [oneAdvisory, oneAdvisory, oneAdvisory],
      metric: metricFavouringFirst,
      maxRollouts: 0,
    });
    expect(result.tickResult.rolloutDecision?.decision).toBe("rollout");
    expect(result.rolloutDraft).toBeUndefined();
  });
});
