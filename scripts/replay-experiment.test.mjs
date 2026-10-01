// @ts-check
// Tests for the pure function in replay-experiment.mjs. Pinned cases match
// the four cases in the original `experiment-tracker-v0` task brief
// (validated / regressed / inconclusive / idempotent re-run) plus
// supporting cases for threshold extraction and the chaos-discipline
// graceful-degrade path on corrupt JSONL lines.
//
// Pattern: rule #10 deterministic gate; xUnit test doubles (Meszaros 2007).

import { describe, expect, test } from "vitest";

import {
  dueWindows,
  extractThreshold,
  extractValue,
  parseJsonl,
  replayExperiment,
} from "./replay-experiment.mjs";

/** @type {import("./replay-experiment.mjs").ExperimentMeta} */
const META = Object.freeze({
  id: "synthetic-experiment",
  measurement: "echo 12",
  success: "≥10",
  pivot: "<0",
  replay_windows_days: [7, 30],
  timeout_seconds: 60,
});

/**
 * @param {Partial<import("./replay-experiment.mjs").StoreRecord>} [overrides]
 * @returns {import("./replay-experiment.mjs").StoreRecord}
 */
function makeRecord(overrides = {}) {
  return {
    experiment_id: "synthetic-experiment",
    baseline: "10\n",
    treatment: "12\n",
    ts: "2026-04-01T00:00:00.000Z",
    ref: "abc1234",
    base_ref: "deadbeef",
    ...overrides,
  };
}

describe("extractThreshold", () => {
  test("≥10 → { op: '>=', value: 10 }", () => {
    expect(extractThreshold("≥10")).toEqual({ op: ">=", value: 10 });
  });
  test(">= 10 (ASCII) → { op: '>=', value: 10 }", () => {
    expect(extractThreshold(">= 10 units")).toEqual({ op: ">=", value: 10 });
  });
  test("at least 5 → { op: '>=', value: 5 }", () => {
    expect(extractThreshold("at least 5 successful runs")).toEqual({ op: ">=", value: 5 });
  });
  test("<0 → { op: '<', value: 0 }", () => {
    expect(extractThreshold("<0 errors")).toEqual({ op: "<", value: 0 });
  });
  test("≤-1 → { op: '<=', value: -1 }", () => {
    expect(extractThreshold("≤-1")).toEqual({ op: "<=", value: -1 });
  });
  test("non-numeric → noop", () => {
    expect(extractThreshold("the docs read better")).toEqual({ op: "noop" });
  });
});

describe("extractValue", () => {
  test("first numeric token", () => {
    expect(extractValue("12\n")).toBe(12);
    expect(extractValue("  -5  ")).toBe(-5);
    expect(extractValue("error rate: 0.42 over 100 runs")).toBe(0.42);
  });
  test("no number → null", () => {
    expect(extractValue("no numbers here")).toBeNull();
  });
});

describe("replayExperiment — verdict ladder", () => {
  test("(a) validated: value 12 meets ≥10 with no prior pivot crossing", () => {
    const decision = replayExperiment({
      meta: META,
      record: makeRecord(),
      priorReplays: [],
      currentValueStdout: "12\n",
      now: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      windowDays: 7,
    });
    expect(decision.verdict).toBe("validated");
    expect(decision.resultLine.kind).toBe("replay-result");
    expect(decision.resultLine.window_days).toBe(7);
    expect(decision.resultLine.experiment_id).toBe("synthetic-experiment");
  });

  test("(b) regressed: value -1 crosses pivot AND prior replay also crossed pivot (two consecutive)", () => {
    /** @type {import("./replay-experiment.mjs").ReplayResult} */
    const priorRegression = {
      kind: "replay-result",
      experiment_id: "synthetic-experiment",
      ts: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      value: "-2\n",
      window_days: 7,
      verdict: "inconclusive",
      reason: "value -2 crosses pivot <0 once; awaiting next window before declaring regressed",
    };
    const decision = replayExperiment({
      meta: META,
      record: makeRecord(),
      priorReplays: [priorRegression],
      currentValueStdout: "-1\n",
      now: "2026-05-01T00:00:00.000Z",
      ref: "abc1234",
      windowDays: 30,
    });
    expect(decision.verdict).toBe("regressed");
    expect(decision.reason).toMatch(/two consecutive/);
  });

  test("first pivot crossing → inconclusive (must persist)", () => {
    const decision = replayExperiment({
      meta: META,
      record: makeRecord(),
      priorReplays: [],
      currentValueStdout: "-1\n",
      now: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      windowDays: 7,
    });
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.reason).toMatch(/awaiting next window/);
  });

  test("(c) inconclusive: value 5 below success but above pivot", () => {
    const decision = replayExperiment({
      meta: META,
      record: makeRecord(),
      priorReplays: [],
      currentValueStdout: "5\n",
      now: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      windowDays: 7,
    });
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.reason).toMatch(/below success/);
  });

  test("validated then validated still validated (sustained gain)", () => {
    /** @type {import("./replay-experiment.mjs").ReplayResult} */
    const priorValidation = {
      kind: "replay-result",
      experiment_id: "synthetic-experiment",
      ts: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      value: "12\n",
      window_days: 7,
      verdict: "validated",
      reason: "value 12 meets success >=10 at +7d",
    };
    const decision = replayExperiment({
      meta: META,
      record: makeRecord(),
      priorReplays: [priorValidation],
      currentValueStdout: "11\n",
      now: "2026-05-01T00:00:00.000Z",
      ref: "abc1234",
      windowDays: 30,
    });
    expect(decision.verdict).toBe("validated");
  });

  test("non-numeric stdout → inconclusive with explanatory reason", () => {
    const decision = replayExperiment({
      meta: META,
      record: makeRecord(),
      priorReplays: [],
      currentValueStdout: "no numbers here\n",
      now: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      windowDays: 7,
    });
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.reason).toMatch(/numeric/);
  });

  test("non-extractable success/pivot threshold → inconclusive", () => {
    const decision = replayExperiment({
      meta: { ...META, success: "the docs read better", pivot: "the docs read worse" },
      record: makeRecord(),
      priorReplays: [],
      currentValueStdout: "12\n",
      now: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      windowDays: 7,
    });
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.reason).toMatch(/threshold not numerically extractable/);
  });
});

describe("dueWindows — idempotence + scheduling", () => {
  test("(d) re-running on already-resolved windows is a no-op (idempotent)", () => {
    const record = makeRecord({ ts: "2026-04-01T00:00:00.000Z", ref: "abc1234" });
    /** @type {import("./replay-experiment.mjs").ReplayResult[]} */
    const replays = [
      {
        kind: "replay-result",
        experiment_id: "synthetic-experiment",
        ts: "2026-04-08T00:00:00.000Z",
        ref: "abc1234",
        value: "12\n",
        window_days: 7,
        verdict: "validated",
        reason: "value 12 meets success >=10 at +7d",
      },
      {
        kind: "replay-result",
        experiment_id: "synthetic-experiment",
        ts: "2026-05-01T00:00:00.000Z",
        ref: "abc1234",
        value: "11\n",
        window_days: 30,
        verdict: "validated",
        reason: "value 11 meets success >=10 at +30d",
      },
    ];
    // Now is well past +30d. Both windows already resolved → due is empty.
    const due = dueWindows(record, replays, [7, 30], new Date("2026-06-01T00:00:00.000Z"));
    expect(due).toEqual([]);
  });

  test("only the +7d window is due 10 days post-merge", () => {
    const record = makeRecord({ ts: "2026-04-01T00:00:00.000Z" });
    const due = dueWindows(record, [], [7, 30], new Date("2026-04-11T00:00:00.000Z"));
    expect(due).toEqual([7]);
  });

  test("both windows due 31 days post-merge with no prior replays", () => {
    const record = makeRecord({ ts: "2026-04-01T00:00:00.000Z" });
    const due = dueWindows(record, [], [7, 30], new Date("2026-05-02T00:00:00.000Z"));
    expect(due).toEqual([7, 30]);
  });

  test("only +30d due when +7d already recorded", () => {
    const record = makeRecord({ ts: "2026-04-01T00:00:00.000Z", ref: "abc1234" });
    /** @type {import("./replay-experiment.mjs").ReplayResult} */
    const sevenDay = {
      kind: "replay-result",
      experiment_id: "synthetic-experiment",
      ts: "2026-04-08T00:00:00.000Z",
      ref: "abc1234",
      value: "12\n",
      window_days: 7,
      verdict: "validated",
      reason: "value 12 meets success >=10 at +7d",
    };
    const due = dueWindows(record, [sevenDay], [7, 30], new Date("2026-05-02T00:00:00.000Z"));
    expect(due).toEqual([30]);
  });
});

describe("parseJsonl — graceful-degrade on corrupt rows (rule #7)", () => {
  test("corrupt line surfaces a warning, valid lines are returned", () => {
    const content = [
      JSON.stringify({ experiment_id: "x", ts: "2026-04-01T00:00:00.000Z", ref: "a" }),
      "{not json",
      JSON.stringify({
        kind: "replay-result",
        experiment_id: "x",
        ts: "2026-04-08T00:00:00.000Z",
        ref: "a",
        value: "12\n",
        window_days: 7,
        verdict: "validated",
        reason: "",
      }),
      "",
    ].join("\n");
    const result = parseJsonl(content, "synthetic.jsonl");
    expect(result.records.length).toBe(1);
    expect(result.replays.length).toBe(1);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/corrupt JSONL/);
  });

  test("non-object row is warned, not crashed on", () => {
    const content = "42\n";
    const result = parseJsonl(content, "synthetic.jsonl");
    expect(result.records.length).toBe(0);
    expect(result.warnings.length).toBe(1);
  });
});
