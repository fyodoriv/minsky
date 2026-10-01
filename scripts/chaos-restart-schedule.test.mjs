// Tests for chaos-restart-schedule.mjs. Pins the task's `**Measurement**`
// steady state: schedule_followed / reset_on_health / stopped_at_limit
// all true and restarts_after_limit == 0 (deterministic virtual clock,
// no process spawn). No @ts-check (sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import { allHold, simulateChaos } from "./chaos-restart-schedule.mjs";

describe("chaos-restart-schedule simulation", () => {
  it("steady state holds — all four observables", () => {
    const r = simulateChaos();
    expect(r).toEqual({
      schedule_followed: true,
      reset_on_health: true,
      stopped_at_limit: true,
      restarts_after_limit: 0,
    });
    expect(allHold(r)).toBe(true);
  });

  it("is deterministic — same result every run", () => {
    expect(simulateChaos()).toEqual(simulateChaos());
  });

  it("allHold rejects any violated observable", () => {
    const base = simulateChaos();
    expect(allHold({ ...base, schedule_followed: false })).toBe(false);
    expect(allHold({ ...base, reset_on_health: false })).toBe(false);
    expect(allHold({ ...base, stopped_at_limit: false })).toBe(false);
    expect(allHold({ ...base, restarts_after_limit: 1 })).toBe(false);
  });
});
