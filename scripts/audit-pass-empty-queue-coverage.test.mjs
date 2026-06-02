// Unit tests for audit-pass-empty-queue-coverage — pure helpers only. The
// JSONL store read + CLI exit codes are exercised through the exported pure
// functions; the I/O edge is a thin readStore + main wrapper.

import { describe, expect, test } from "vitest";

import {
  computeCoverage,
  formatCoverageSummary,
  IDLE_TO_NEXT_TASK_P50_THRESHOLD_MINUTES,
  parseArgs,
  parseTickEvents,
  parseWindow,
  percentile,
  selectWindow,
} from "./audit-pass-empty-queue-coverage.mjs";

/** @typedef {import("./audit-pass-empty-queue-coverage.mjs").TickEvent} TickEvent */

/**
 * @param {Partial<TickEvent>} over
 * @returns {TickEvent}
 */
function ev(over) {
  return {
    ts: "2026-01-01T00:00:00.000Z",
    emptyQueue: true,
    auditPassInvoked: true,
    newTasksProduced: 1,
    idleToNextTaskMinutes: 2,
    ...over,
  };
}

describe("parseTickEvents", () => {
  test("parses well-formed JSONL lines", () => {
    const text = [
      JSON.stringify(ev({ newTasksProduced: 2 })),
      JSON.stringify(ev({ emptyQueue: false, auditPassInvoked: false, newTasksProduced: 0 })),
    ].join("\n");
    const events = parseTickEvents(text);
    expect(events).toHaveLength(2);
    expect(events[0]?.newTasksProduced).toBe(2);
    expect(events[1]?.emptyQueue).toBe(false);
  });

  test("drops blank and unparseable lines (graceful-degrade, rule #6)", () => {
    const text = ["", "   ", "not json", JSON.stringify(ev({})), "{ broken"].join("\n");
    expect(parseTickEvents(text)).toHaveLength(1);
  });

  test("drops shape-invalid objects (missing ts)", () => {
    const text = JSON.stringify({ emptyQueue: true, auditPassInvoked: true });
    expect(parseTickEvents(text)).toHaveLength(0);
  });

  test("coerces a null idle measurement to null, not NaN", () => {
    const text = JSON.stringify(ev({ idleToNextTaskMinutes: null }));
    expect(parseTickEvents(text)[0]?.idleToNextTaskMinutes).toBeNull();
  });
});

describe("selectWindow", () => {
  test("keeps the most-recent N events", () => {
    const events = [ev({ ts: "a" }), ev({ ts: "b" }), ev({ ts: "c" })];
    expect(selectWindow(events, 2).map((e) => e.ts)).toEqual(["b", "c"]);
  });

  test("n <= 0 or non-finite means all events", () => {
    const events = [ev({ ts: "a" }), ev({ ts: "b" })];
    expect(selectWindow(events, 0)).toHaveLength(2);
    expect(selectWindow(events, Number.NaN)).toHaveLength(2);
  });
});

describe("percentile", () => {
  test("returns null for an empty sample (never NaN)", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  test("returns the single value for a one-element sample", () => {
    expect(percentile([3], 0.5)).toBe(3);
  });

  test("interpolates the p50 of an even-length sample", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 5);
  });

  test("p50 of an odd-length sample is the middle value", () => {
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
  });
});

describe("computeCoverage — pre-registered Measurement shape", () => {
  test("counts only empty-queue ticks; sums tasks; passes when every empty tick audited and idle low", () => {
    const events = [
      ev({
        emptyQueue: false,
        auditPassInvoked: false,
        newTasksProduced: 0,
        idleToNextTaskMinutes: null,
      }),
      ev({
        emptyQueue: true,
        auditPassInvoked: true,
        newTasksProduced: 2,
        idleToNextTaskMinutes: 1,
      }),
      ev({
        emptyQueue: true,
        auditPassInvoked: true,
        newTasksProduced: 3,
        idleToNextTaskMinutes: 3,
      }),
    ];
    const r = computeCoverage(events);
    expect(r.empty_queue_ticks).toBe(2);
    expect(r.audit_pass_invocations).toBe(2);
    expect(r.new_tasks_produced).toBe(5);
    expect(r.idle_to_next_task_p50_minutes).toBe(2);
    expect(r.success).toBe(true);
  });

  test("fails when an empty-queue tick did NOT invoke an audit pass", () => {
    const events = [
      ev({ emptyQueue: true, auditPassInvoked: true, idleToNextTaskMinutes: 1 }),
      ev({
        emptyQueue: true,
        auditPassInvoked: false,
        newTasksProduced: 0,
        idleToNextTaskMinutes: 1,
      }),
    ];
    const r = computeCoverage(events);
    expect(r.empty_queue_ticks).toBe(2);
    expect(r.audit_pass_invocations).toBe(1);
    expect(r.success).toBe(false);
  });

  test("fails when idle→next-task p50 exceeds the threshold", () => {
    const events = [
      ev({ emptyQueue: true, auditPassInvoked: true, idleToNextTaskMinutes: 10 }),
      ev({ emptyQueue: true, auditPassInvoked: true, idleToNextTaskMinutes: 12 }),
    ];
    const r = computeCoverage(events);
    expect(r.idle_to_next_task_p50_minutes).toBeGreaterThanOrEqual(
      IDLE_TO_NEXT_TASK_P50_THRESHOLD_MINUTES,
    );
    expect(r.success).toBe(false);
  });

  test("no empty-queue ticks → success is false (no coverage to claim)", () => {
    const r = computeCoverage([ev({ emptyQueue: false, auditPassInvoked: false })]);
    expect(r.empty_queue_ticks).toBe(0);
    expect(r.success).toBe(false);
  });

  test("idle p50 is null (insufficient data) is vacuously under-threshold", () => {
    const events = [
      ev({ emptyQueue: true, auditPassInvoked: true, idleToNextTaskMinutes: null }),
      ev({ emptyQueue: true, auditPassInvoked: true, idleToNextTaskMinutes: null }),
    ];
    const r = computeCoverage(events);
    expect(r.idle_to_next_task_p50_minutes).toBeNull();
    expect(r.success).toBe(true);
  });
});

describe("parseWindow", () => {
  test("Nticks parses to N", () => {
    expect(parseWindow("10ticks")).toBe(10);
  });
  test("all / undefined means 0 (every event)", () => {
    expect(parseWindow("all")).toBe(0);
    expect(parseWindow(undefined)).toBe(0);
  });
  test("a bare positive integer is accepted", () => {
    expect(parseWindow("25")).toBe(25);
  });
  test("garbage falls back to 0", () => {
    expect(parseWindow("soon")).toBe(0);
  });
});

describe("parseArgs", () => {
  test("defaults", () => {
    const o = parseArgs(["node", "script"]);
    expect(o).toEqual({
      windowRaw: "all",
      store: undefined,
      json: false,
      strict: false,
      help: false,
    });
  });
  test("parses flags", () => {
    const o = parseArgs([
      "node",
      "script",
      "--window=10ticks",
      "--json",
      "--strict",
      "--store",
      "/tmp/x",
    ]);
    expect(o.windowRaw).toBe("10ticks");
    expect(o.json).toBe(true);
    expect(o.strict).toBe(true);
    expect(o.store).toBe("/tmp/x");
  });
});

describe("formatCoverageSummary", () => {
  test("renders PASS verdict and the four metrics", () => {
    const s = formatCoverageSummary({
      empty_queue_ticks: 5,
      audit_pass_invocations: 5,
      new_tasks_produced: 8,
      idle_to_next_task_p50_minutes: 2.5,
      success: true,
    });
    expect(s).toContain("empty-queue ticks:        5");
    expect(s).toContain("audit-pass invocations:   5");
    expect(s).toContain("2.50 min");
    expect(s).toContain("PASS");
  });

  test("renders insufficient data when p50 is null", () => {
    const s = formatCoverageSummary({
      empty_queue_ticks: 0,
      audit_pass_invocations: 0,
      new_tasks_produced: 0,
      idle_to_next_task_p50_minutes: null,
      success: false,
    });
    expect(s).toContain("(insufficient data)");
    expect(s).toContain("BELOW");
  });
});
