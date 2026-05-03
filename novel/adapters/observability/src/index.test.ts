import { describe, expect, it } from "vitest";
import { type SelfTestResult, aggregateStatus } from "./index.js";

const sample = (status: SelfTestResult["status"]): SelfTestResult => ({
  status,
  message: "test",
  latencyMs: 1,
  lastCheck: "2026-05-03T00:00:00Z",
});

describe("aggregateStatus", () => {
  it("returns green when all results are green", () => {
    expect(aggregateStatus([sample("green"), sample("green")])).toBe("green");
  });

  it("returns yellow when any result is yellow and none red", () => {
    expect(aggregateStatus([sample("green"), sample("yellow")])).toBe("yellow");
  });

  it("returns red when any result is red regardless of others", () => {
    expect(aggregateStatus([sample("green"), sample("yellow"), sample("red")])).toBe("red");
  });

  it("returns green for an empty array (no failures observed)", () => {
    expect(aggregateStatus([])).toBe("green");
  });
});
