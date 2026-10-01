import { describe, expect, it } from "vitest";

import {
  type Advisory,
  CI_RULE_ID,
  type CiRun,
  type ExperimentRecord,
  monitor,
} from "./monitor.js";

const ciRun = (overrides: Partial<CiRun> = {}): CiRun => ({
  name: "ci.yml",
  conclusion: "success",
  createdAt: "2026-05-01T00:00:00Z",
  ...overrides,
});

const advisory = (overrides: Partial<Advisory> = {}): Advisory => ({
  ruleId: "rule-9",
  evidence: "EXPERIMENT.yaml: success threshold absent",
  severity: "warn",
  createdAt: "2026-05-01T00:00:00Z",
  ...overrides,
});

const experiment = (overrides: Partial<ExperimentRecord> = {}): ExperimentRecord => ({
  id: "exp-1",
  verdict: "validated",
  value: 1.0,
  ts: "2026-05-01T00:00:00Z",
  ...overrides,
});

describe("monitor", () => {
  it("returns an empty snapshot for empty inputs (zero violations / zero warnings)", () => {
    const snap = monitor({ ciRuns: [], advisories: [], experimentRecords: [] });
    expect(snap.violations).toEqual([]);
    expect(snap.ciFailureCount).toBe(0);
    expect(snap.advisoryCount).toBe(0);
    expect(snap.experiments).toEqual({ validated: 0, regressed: 0, inconclusive: 0 });
    expect(snap.warnings).toEqual([]);
  });

  it("aggregates a rule-N advisory cluster into a constraint candidate", () => {
    const snap = monitor({
      ciRuns: [],
      advisories: [
        advisory({
          ruleId: "rule-9",
          evidence: "vague hypothesis",
          createdAt: "2026-04-30T00:00:00Z",
        }),
        advisory({
          ruleId: "rule-9",
          evidence: "missing pivot",
          createdAt: "2026-05-01T00:00:00Z",
        }),
        advisory({
          ruleId: "rule-9",
          evidence: "post-hoc metric",
          createdAt: "2026-05-02T00:00:00Z",
        }),
      ],
      experimentRecords: [],
    });
    const v = snap.violations.find((x) => x.ruleId === "rule-9");
    expect(v?.violationCount).toBe(3);
    expect(v?.firstSeen).toBe("2026-04-30T00:00:00Z");
    expect(v?.lastSeen).toBe("2026-05-02T00:00:00Z");
    expect(v?.exemplars).toHaveLength(3);
    expect(snap.advisoryCount).toBe(3);
    expect(snap.ciFailureCount).toBe(0);
  });

  it("ranks by-rule with CI failures bucketed under CI_RULE_ID", () => {
    const snap = monitor({
      ciRuns: [
        ciRun({ name: "rule-1", conclusion: "failure" }),
        ciRun({ name: "rule-7", conclusion: "failure" }),
        ciRun({ name: "ci.yml", conclusion: "success" }),
        ciRun({ name: "ci.yml", conclusion: "cancelled" }),
      ],
      advisories: [advisory({ ruleId: "rule-9" }), advisory({ ruleId: "rule-7" })],
      experimentRecords: [
        experiment({ id: "a", verdict: "validated" }),
        experiment({ id: "b", verdict: "regressed" }),
        experiment({ id: "c", verdict: "inconclusive" }),
      ],
    });
    expect(snap.ciFailureCount).toBe(3);
    expect(snap.advisoryCount).toBe(2);
    expect(snap.experiments).toEqual({ validated: 1, regressed: 1, inconclusive: 1 });
    const ci = snap.violations.find((v) => v.ruleId === CI_RULE_ID);
    expect(ci?.violationCount).toBe(3);
    // Output is sorted by ruleId for determinism.
    expect(snap.violations.map((v) => v.ruleId)).toEqual(
      [...snap.violations.map((v) => v.ruleId)].sort(),
    );
  });

  it("caps exemplars at 3 even when more rows match the same ruleId", () => {
    const snap = monitor({
      ciRuns: [],
      advisories: [
        advisory({ evidence: "e1" }),
        advisory({ evidence: "e2" }),
        advisory({ evidence: "e3" }),
        advisory({ evidence: "e4" }),
        advisory({ evidence: "e5" }),
      ],
      experimentRecords: [],
    });
    const v = snap.violations[0];
    expect(v?.violationCount).toBe(5);
    expect(v?.exemplars).toEqual(["e1", "e2", "e3"]);
  });

  it("gracefully skips corrupt rows with a warning instead of crashing", () => {
    // Cast malformed rows through `unknown` to exercise rule-7 graceful-degrade
    // without sprinkling `any` (which would defeat the type-checker globally).
    const malformedCiRun = { bogus: true } as unknown as CiRun;
    const malformedAdvisory = {
      ruleId: "",
      evidence: "x",
      severity: "x",
      createdAt: "x",
    } as unknown as Advisory;
    const malformedExperiment = { id: "x" } as unknown as ExperimentRecord;
    const snap = monitor({
      ciRuns: [
        { name: "ok", conclusion: "failure", createdAt: "2026-05-01T00:00:00Z" },
        malformedCiRun,
      ],
      advisories: [advisory(), malformedAdvisory],
      experimentRecords: [experiment(), malformedExperiment],
    });
    expect(snap.warnings.length).toBe(3);
    expect(snap.warnings[0]).toMatch(/ci-run/);
    expect(snap.warnings[1]).toMatch(/advisory/);
    expect(snap.warnings[2]).toMatch(/experiment-record/);
    // The valid rows still made it through.
    expect(snap.ciFailureCount).toBe(1);
    expect(snap.advisoryCount).toBe(1);
    expect(snap.experiments.validated).toBe(1);
  });

  it("ignores success-conclusion CI runs (the constraint signal is *failure*)", () => {
    const snap = monitor({
      ciRuns: [
        ciRun({ conclusion: "success" }),
        ciRun({ conclusion: "success" }),
        ciRun({ conclusion: "success" }),
      ],
      advisories: [],
      experimentRecords: [],
    });
    expect(snap.ciFailureCount).toBe(0);
    expect(snap.violations).toEqual([]);
  });
});
