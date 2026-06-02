import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALIBRATION_DRIFT_THRESHOLD,
  knowledge,
  type VerdictLogEntry,
} from "./knowledge.js";

const NOW = new Date("2026-05-10T12:00:00Z");

const entry = (overrides: Partial<VerdictLogEntry> = {}): VerdictLogEntry => ({
  id: "exp-1",
  verdict: "validated",
  value: 1.0,
  ts: "2026-05-09T00:00:00Z",
  predicted: 1.0,
  ...overrides,
});

describe("knowledge", () => {
  it("returns null amendment when calibration drift is below threshold", () => {
    const log: VerdictLogEntry[] = [
      entry({ id: "a", predicted: 1.0, value: 1.05 }),
      entry({ id: "b", predicted: 0.5, value: 0.4 }),
    ];
    const result = knowledge({
      verdictLog: log,
      topConstraintRuleId: "rule-9",
      executeDecision: "rollout",
      executeReason: "passed both guards",
      winnerVariantId: "rule-9-direct-answer",
      now: NOW,
    });
    expect(result.researchMdAmendmentProposal).toBeNull();
    expect(result.calibrationSampleSize).toBe(2);
    expect(result.calibrationMae).toBeLessThan(DEFAULT_CALIBRATION_DRIFT_THRESHOLD);
  });

  it("emits an amendment proposal text when calibration drift exceeds threshold", () => {
    const log: VerdictLogEntry[] = [
      // Predicted 1.0, observed 0.0 → abs err 1.0 each → MAE = 1.0 (>0.5).
      entry({ id: "a", predicted: 1.0, value: 0.0 }),
      entry({ id: "b", predicted: 1.0, value: 0.0 }),
    ];
    const result = knowledge({
      verdictLog: log,
      topConstraintRuleId: "rule-9",
      executeDecision: "abstain",
      executeReason: "sustained-gain failed",
      winnerVariantId: null,
      now: NOW,
    });
    expect(result.researchMdAmendmentProposal).not.toBeNull();
    expect(result.researchMdAmendmentProposal).toMatch(/Calibration drift exceeded/);
    expect(result.researchMdAmendmentProposal).toMatch(/Munafò/);
    expect(result.calibrationMae).toBeGreaterThan(DEFAULT_CALIBRATION_DRIFT_THRESHOLD);
  });

  it("always returns a non-empty constraints append (audit trail per Helland 2007)", () => {
    const result = knowledge({
      verdictLog: [],
      topConstraintRuleId: null,
      executeDecision: "no-op",
      executeReason: "no constraint detected",
      winnerVariantId: null,
      now: NOW,
    });
    expect(result.constraintsAppend.length).toBeGreaterThan(0);
    expect(result.constraintsAppend).toMatch(/## 2026-05-10/);
    expect(result.constraintsAppend).toMatch(/no-op/);
    expect(result.calibrationSampleSize).toBe(0);
    expect(result.researchMdAmendmentProposal).toBeNull();
  });

  it("ignores log entries without a predicted field (graceful degrade)", () => {
    const noPrediction: VerdictLogEntry = {
      id: "a",
      verdict: "validated",
      value: 5.0,
      ts: "2026-05-09T00:00:00Z",
    };
    const log: VerdictLogEntry[] = [noPrediction, entry({ id: "b", predicted: 1.0, value: 1.05 })];
    const result = knowledge({
      verdictLog: log,
      topConstraintRuleId: "rule-7",
      executeDecision: "rollout",
      executeReason: "passed",
      winnerVariantId: "rule-7-tighten-scope",
      now: NOW,
    });
    expect(result.calibrationSampleSize).toBe(1);
    expect(result.calibrationMae).toBeCloseTo(0.05, 2);
  });

  it("respects a custom calibrationDriftThreshold argument", () => {
    const log: VerdictLogEntry[] = [
      entry({ id: "a", predicted: 1.0, value: 0.8 }), // abs err 0.2
    ];
    const tight = knowledge({
      verdictLog: log,
      calibrationDriftThreshold: 0.1,
      topConstraintRuleId: "rule-9",
      executeDecision: "rollout",
      executeReason: "passed",
      winnerVariantId: "rule-9-direct-answer",
      now: NOW,
    });
    expect(tight.researchMdAmendmentProposal).not.toBeNull();
    const lenient = knowledge({
      verdictLog: log,
      calibrationDriftThreshold: 0.5,
      topConstraintRuleId: "rule-9",
      executeDecision: "rollout",
      executeReason: "passed",
      winnerVariantId: "rule-9-direct-answer",
      now: NOW,
    });
    expect(lenient.researchMdAmendmentProposal).toBeNull();
  });

  it("renders the constraint ruleId and winner id verbatim in the constraints append", () => {
    const result = knowledge({
      verdictLog: [],
      topConstraintRuleId: "rule-9",
      executeDecision: "rollout",
      executeReason: "passed both guards (sustained-gain + oscillation)",
      winnerVariantId: "rule-9-direct-answer",
      now: NOW,
    });
    expect(result.constraintsAppend).toMatch(/rule-9/);
    expect(result.constraintsAppend).toMatch(/rule-9-direct-answer/);
    expect(result.constraintsAppend).toMatch(/rollout/);
  });

  it("ignores entries with non-finite predicted or value (rule #7)", () => {
    const log: VerdictLogEntry[] = [
      entry({ id: "a", predicted: Number.NaN, value: 1.0 }),
      entry({ id: "b", predicted: 1.0, value: Number.POSITIVE_INFINITY }),
      entry({ id: "c", predicted: 1.0, value: 1.05 }), // valid
    ];
    const result = knowledge({
      verdictLog: log,
      topConstraintRuleId: "rule-7",
      executeDecision: "rollout",
      executeReason: "passed",
      winnerVariantId: "rule-7-tighten-scope",
      now: NOW,
    });
    expect(result.calibrationSampleSize).toBe(1);
  });
});
