import { StubPromptOptimizer } from "@minsky/prompt-optimizer";
import { describe, expect, it } from "vitest";

import { type TickEvent, tick } from "./index.js";
import type { Advisory, CiRun, ExperimentRecord } from "./monitor.js";
import type { RolloutHistoryEntry } from "./sustained-gain.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-10T00:00:00Z");

const sustainedHistoryFor = (variantId: string): RolloutHistoryEntry[] => {
  const earliest = new Date(NOW.getTime() - 7 * MS_PER_DAY);
  const mid = new Date(NOW.getTime() - 3 * MS_PER_DAY);
  return [
    {
      iteration: 1,
      ts: earliest.toISOString(),
      variantId,
      decision: "rollout",
      score: 0.9,
    },
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

const oneFailedRun: CiRun = {
  name: "ci.yml",
  conclusion: "failure",
  createdAt: "2026-05-09T01:00:00Z",
};

const oneExperiment: ExperimentRecord = {
  id: "exp-1",
  verdict: "validated",
  value: 1.0,
  ts: "2026-05-09T02:00:00Z",
};

/**
 * Bias the metric toward the first variant emitted by `plan` (the
 * `enumerate-failure-modes` mutation for whatever ruleId is the constraint).
 */
const metricFavouringFirst = async (output: string): Promise<number> => {
  if (output.includes("enumerate-failure-modes")) return 1.0;
  return 0.5;
};

describe("tick — full MAPE-K assembly", () => {
  it("runs Monitor → Analyze → Plan → Execute → Knowledge on the happy path and rolls out", async () => {
    const events: TickEvent[] = [];
    const winnerId = "rule-9-enumerate-failure-modes";
    const result = await tick({
      monitorInput: {
        ciRuns: [oneFailedRun],
        advisories: [oneAdvisory, oneAdvisory, oneAdvisory], // 3× rule-9 advisories
        experimentRecords: [oneExperiment],
      },
      verdictLog: [
        {
          id: "exp-a",
          verdict: "validated",
          value: 1.0,
          ts: "2026-05-09T00:00:00Z",
          predicted: 1.0,
        },
      ],
      history: sustainedHistoryFor(winnerId),
      evalSet: [{ task: "summarise" }, { task: "extract" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringFirst,
      basePrompt: "you are a helpful assistant",
      now: NOW,
      emit: (e) => events.push(e),
    });
    expect(result.snapshot.violations.length).toBeGreaterThan(0);
    expect(result.analysis.topConstraint?.ruleId).toBe("rule-9");
    expect(result.variants.length).toBeGreaterThan(0);
    expect(result.rolloutDecision?.decision).toBe("rollout");
    expect(result.rolloutDecision?.winner?.id).toBe(winnerId);
    expect(result.knowledgeWrites.constraintsAppend).toMatch(/rule-9/);
    expect(result.knowledgeWrites.researchMdAmendmentProposal).toBeNull();
    // Five OTEL events fired in order.
    const names = events.map((e) => e.name);
    expect(names).toEqual([
      "mape.monitor.snapshot",
      "mape.analyze.constraint",
      "mape.plan.variants",
      "mape.execute.decision",
      "mape.knowledge.write",
    ]);
  });

  it("degrades gracefully when there is no constraint — no Plan/Execute, but Knowledge still records", async () => {
    const events: TickEvent[] = [];
    const result = await tick({
      monitorInput: { ciRuns: [], advisories: [], experimentRecords: [] },
      verdictLog: [],
      history: [],
      evalSet: [],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringFirst,
      basePrompt: "you are a helpful assistant",
      now: NOW,
      emit: (e) => events.push(e),
    });
    expect(result.analysis.topConstraint).toBeNull();
    expect(result.variants).toHaveLength(0);
    expect(result.rolloutDecision).toBeNull();
    // Knowledge still writes a no-op entry (the audit trail records every tick).
    expect(result.knowledgeWrites.constraintsAppend).toMatch(/no-op/);
    // Three events: Monitor, Analyze, Knowledge — Plan and Execute are skipped.
    const names = events.map((e) => e.name);
    expect(names).toEqual([
      "mape.monitor.snapshot",
      "mape.analyze.constraint",
      "mape.knowledge.write",
    ]);
  });

  it("forwards calibrationDriftThreshold into Knowledge — drift > threshold fires the amendment", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    const result = await tick({
      monitorInput: {
        ciRuns: [],
        advisories: [oneAdvisory, oneAdvisory, oneAdvisory],
        experimentRecords: [],
      },
      verdictLog: [
        // Predicted 1.0, observed 0.0 → MAE 1.0 — fires under threshold 0.5.
        { id: "a", verdict: "regressed", value: 0.0, ts: "2026-05-09T00:00:00Z", predicted: 1.0 },
        { id: "b", verdict: "regressed", value: 0.0, ts: "2026-05-09T01:00:00Z", predicted: 1.0 },
      ],
      history: sustainedHistoryFor(winnerId),
      evalSet: [{ task: "summarise" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringFirst,
      basePrompt: "you are a helpful assistant",
      now: NOW,
    });
    expect(result.knowledgeWrites.researchMdAmendmentProposal).not.toBeNull();
  });
});
