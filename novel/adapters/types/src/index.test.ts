import { describe, expect, it } from "vitest";
import { aggregateStatus, type SelfTestResult } from "./index.js";

const sample = (status: SelfTestResult["status"]): SelfTestResult => ({
  status,
  message: "test",
  latencyMs: 1,
  lastCheck: "2026-05-03T00:00:00Z",
});

describe("aggregateStatus (lattice meet)", () => {
  it("returns green for an empty input (vacuous truth — no failures observed)", () => {
    expect(aggregateStatus([])).toBe("green");
  });

  it("returns the only status when given a single result", () => {
    expect(aggregateStatus([sample("green")])).toBe("green");
    expect(aggregateStatus([sample("yellow")])).toBe("yellow");
    expect(aggregateStatus([sample("red")])).toBe("red");
  });

  it("returns green when all results are green", () => {
    expect(aggregateStatus([sample("green"), sample("green"), sample("green")])).toBe("green");
  });

  it("returns yellow when any result is yellow and none red (monotone climb)", () => {
    expect(aggregateStatus([sample("green"), sample("yellow")])).toBe("yellow");
    expect(aggregateStatus([sample("yellow"), sample("green")])).toBe("yellow");
    expect(aggregateStatus([sample("yellow"), sample("yellow"), sample("green")])).toBe("yellow");
  });

  it("returns red when any result is red regardless of others (worst-status-wins)", () => {
    expect(aggregateStatus([sample("green"), sample("red")])).toBe("red");
    expect(aggregateStatus([sample("yellow"), sample("red")])).toBe("red");
    expect(aggregateStatus([sample("red"), sample("green")])).toBe("red");
    expect(aggregateStatus([sample("green"), sample("yellow"), sample("red")])).toBe("red");
  });

  it("is order-independent (commutative meet)", () => {
    const a = [sample("green"), sample("yellow"), sample("red")];
    const b = [sample("red"), sample("green"), sample("yellow")];
    const c = [sample("yellow"), sample("red"), sample("green")];
    expect(aggregateStatus(a)).toBe(aggregateStatus(b));
    expect(aggregateStatus(b)).toBe(aggregateStatus(c));
  });

  it("realises the full monotone climb green → yellow → red", () => {
    const climb: SelfTestResult["status"][] = ["green", "yellow", "red"];
    let acc: SelfTestResult["status"] = "green";
    for (const s of climb) {
      acc = aggregateStatus([sample(acc), sample(s)]);
    }
    expect(acc).toBe("red");
  });
});
