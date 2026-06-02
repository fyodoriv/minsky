/**
 * User-story 003 — "MAPE-K loop improves persona prompts measurably"
 * (`user-stories/003-mape-k-improves-prompts.md`).
 *
 * This integration test drives the assembled MAPE-K loop end-to-end against
 * a synthetic fixture. It uses `StubPromptOptimizer` (sub-task 1's test fake)
 * — DO NOT hit the network from this test.
 *
 * Acceptance asserted (sub-set of the full user-story acceptance criteria —
 * the rest live in the README chaos table):
 *   - `mape.knowledge.write` event fires on each constraints append.
 *   - The calibration-drift amendment proposal fires only when the verdict
 *     log's MAE exceeds the configured threshold.
 *   - The sustained-gain guard fires on a synthetic history crafted to trip
 *     it (cold-start path).
 *   - The oscillation guard fires on a synthetic history crafted to trip it
 *     (variant recently rejected).
 *
 * Pivot per the brief: the test must finish within 60 s of compressed-
 * simulation time. We assert the wall-clock budget at the end of the suite.
 */

import type {
  Advisory,
  CiRun,
  ExperimentRecord,
  RolloutHistoryEntry,
  TickEvent,
  VerdictLogEntry,
} from "@minsky/mape-k-loop";
import { tick } from "@minsky/mape-k-loop";
import { StubPromptOptimizer } from "@minsky/prompt-optimizer";
import { describe, expect, it } from "vitest";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-10T00:00:00Z");
const PIVOT_BUDGET_MS = 60_000;

const advisory = (ruleId: string, ts: string): Advisory => ({
  ruleId,
  evidence: `synthetic advisory for ${ruleId} at ${ts}`,
  severity: "high",
  createdAt: ts,
});

const failedCiRun: CiRun = {
  name: "ci.yml",
  conclusion: "failure",
  createdAt: "2026-05-09T00:00:00Z",
};

const validatedExperiment: ExperimentRecord = {
  id: "exp-1",
  verdict: "validated",
  value: 1.0,
  ts: "2026-05-09T01:00:00Z",
};

const sustainedHistoryFor = (variantId: string): RolloutHistoryEntry[] => {
  const earliest = new Date(NOW.getTime() - 7 * MS_PER_DAY);
  const mid = new Date(NOW.getTime() - 3 * MS_PER_DAY);
  return [
    { iteration: 1, ts: earliest.toISOString(), variantId, decision: "rollout", score: 0.9 },
    { iteration: 2, ts: mid.toISOString(), variantId, decision: "rollout", score: 0.95 },
    { iteration: 3, ts: NOW.toISOString(), variantId, decision: "rollout", score: 1.0 },
  ];
};

/**
 * Bias the metric toward the first variant emitted by `plan` for whichever
 * ruleId is the constraint. The Plan catalogue's first mutation is
 * `enumerate-failure-modes`, so this favors `<ruleId>-enumerate-failure-modes`.
 */
// Returns a `Promise<number>` (the metric signature is Promise-based to
// allow real I/O on production paths) but does not await anything itself —
// rewritten from `async` + bare returns to plain `Promise.resolve()` so
// biome's `useAwait` rule (which CI runs whole-tree, escalates warnings
// to errors) doesn't fire on this pre-existing test fixture.
const metricFavouringEnumerate = (output: string): Promise<number> => {
  if (output.includes("enumerate-failure-modes")) return Promise.resolve(1.0);
  return Promise.resolve(0.5);
};

const happyVerdictLog: VerdictLogEntry[] = [
  { id: "exp-a", verdict: "validated", value: 1.0, ts: "2026-05-09T00:00:00Z", predicted: 1.05 },
  { id: "exp-b", verdict: "validated", value: 0.5, ts: "2026-05-09T01:00:00Z", predicted: 0.45 },
];

const driftedVerdictLog: VerdictLogEntry[] = [
  // Predicted 1.0, observed 0.0 → MAE 1.0 (>0.5 default threshold).
  { id: "exp-a", verdict: "regressed", value: 0.0, ts: "2026-05-09T00:00:00Z", predicted: 1.0 },
  { id: "exp-b", verdict: "regressed", value: 0.0, ts: "2026-05-09T01:00:00Z", predicted: 1.0 },
];

describe("user-story 003 — MAPE-K loop improves persona prompts measurably", () => {
  const startedMs = Date.now();

  it("fires `mape.knowledge.write` on each completed tick (audit-trail emission)", async () => {
    const events: TickEvent[] = [];
    const winnerId = "rule-9-enumerate-failure-modes";
    await tick({
      monitorInput: {
        ciRuns: [failedCiRun],
        advisories: [
          advisory("rule-9", "2026-05-09T00:00:00Z"),
          advisory("rule-9", "2026-05-09T00:30:00Z"),
          advisory("rule-9", "2026-05-09T01:00:00Z"),
        ],
        experimentRecords: [validatedExperiment],
      },
      verdictLog: happyVerdictLog,
      history: sustainedHistoryFor(winnerId),
      evalSet: [{ task: "summarise" }, { task: "extract" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringEnumerate,
      basePrompt: "you are a QA-tester persona",
      now: NOW,
      emit: (e) => events.push(e),
    });
    const knowledgeEvents = events.filter((e) => e.name === "mape.knowledge.write");
    expect(knowledgeEvents).toHaveLength(1);
    expect(knowledgeEvents[0]?.attributes["knowledge.calibrationSampleSize"]).toBe(2);
  });

  it("fires the calibration-drift amendment only when drift exceeds threshold", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    const happy = await tick({
      monitorInput: {
        ciRuns: [],
        advisories: [
          advisory("rule-9", "2026-05-09T00:00:00Z"),
          advisory("rule-9", "2026-05-09T00:30:00Z"),
          advisory("rule-9", "2026-05-09T01:00:00Z"),
        ],
        experimentRecords: [],
      },
      verdictLog: happyVerdictLog,
      history: sustainedHistoryFor(winnerId),
      evalSet: [{ task: "summarise" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringEnumerate,
      basePrompt: "you are a QA-tester persona",
      now: NOW,
    });
    expect(happy.knowledgeWrites.researchMdAmendmentProposal).toBeNull();

    const drifted = await tick({
      monitorInput: {
        ciRuns: [],
        advisories: [
          advisory("rule-9", "2026-05-09T00:00:00Z"),
          advisory("rule-9", "2026-05-09T00:30:00Z"),
          advisory("rule-9", "2026-05-09T01:00:00Z"),
        ],
        experimentRecords: [],
      },
      verdictLog: driftedVerdictLog,
      history: sustainedHistoryFor(winnerId),
      evalSet: [{ task: "summarise" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringEnumerate,
      basePrompt: "you are a QA-tester persona",
      now: NOW,
    });
    expect(drifted.knowledgeWrites.researchMdAmendmentProposal).not.toBeNull();
    expect(drifted.knowledgeWrites.researchMdAmendmentProposal).toMatch(/Calibration drift/);
  });

  it("sustained-gain guard fires on a cold-start history (rule #7 — graceful abstain)", async () => {
    const result = await tick({
      monitorInput: {
        ciRuns: [],
        advisories: [
          advisory("rule-9", "2026-05-09T00:00:00Z"),
          advisory("rule-9", "2026-05-09T00:30:00Z"),
        ],
        experimentRecords: [],
      },
      verdictLog: happyVerdictLog,
      history: [], // cold start → sustained-gain refuses
      evalSet: [{ task: "summarise" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringEnumerate,
      basePrompt: "you are a QA-tester persona",
      now: NOW,
    });
    expect(result.rolloutDecision?.decision).toBe("abstain");
    expect(result.rolloutDecision?.reason).toMatch(/sustained-gain/);
  });

  it("oscillation guard fires when the winner was recently rejected (Ries 2011 don't re-pivot)", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    const history: RolloutHistoryEntry[] = [
      ...sustainedHistoryFor(winnerId),
      {
        iteration: 4,
        ts: NOW.toISOString(),
        variantId: winnerId,
        decision: "rejected",
      },
    ];
    const result = await tick({
      monitorInput: {
        ciRuns: [],
        advisories: [
          advisory("rule-9", "2026-05-09T00:00:00Z"),
          advisory("rule-9", "2026-05-09T00:30:00Z"),
        ],
        experimentRecords: [],
      },
      verdictLog: happyVerdictLog,
      history,
      evalSet: [{ task: "summarise" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringEnumerate,
      basePrompt: "you are a QA-tester persona",
      now: NOW,
    });
    expect(result.rolloutDecision?.decision).toBe("abstain");
    expect(result.rolloutDecision?.reason).toMatch(/oscillation/);
  });

  it("rolls out the winner on the happy path (Goldratt constraint detection + sustained gain)", async () => {
    const winnerId = "rule-9-enumerate-failure-modes";
    const result = await tick({
      monitorInput: {
        ciRuns: [failedCiRun],
        advisories: [
          advisory("rule-9", "2026-05-09T00:00:00Z"),
          advisory("rule-9", "2026-05-09T00:30:00Z"),
          advisory("rule-9", "2026-05-09T01:00:00Z"),
        ],
        experimentRecords: [validatedExperiment],
      },
      verdictLog: happyVerdictLog,
      history: sustainedHistoryFor(winnerId),
      evalSet: [{ task: "summarise" }, { task: "extract" }],
      optimizer: new StubPromptOptimizer(),
      metric: metricFavouringEnumerate,
      basePrompt: "you are a QA-tester persona",
      now: NOW,
    });
    expect(result.analysis.topConstraint?.ruleId).toBe("rule-9");
    expect(result.rolloutDecision?.decision).toBe("rollout");
    expect(result.rolloutDecision?.winner?.id).toBe(winnerId);
    expect(result.knowledgeWrites.constraintsAppend).toMatch(/rule-9/);
  });

  it("finishes the full integration sweep within the pivot wall-clock budget", () => {
    const elapsedMs = Date.now() - startedMs;
    expect(elapsedMs).toBeLessThan(PIVOT_BUDGET_MS);
  });
});
