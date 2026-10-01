// Unit tests for minsky-report — pure helpers only. The CLI wrapper
// is covered by the integration test in test/integration/m1-red-green.test.ts.

import { describe, expect, test } from "vitest";
import {
  directionArrow,
  extractNumber,
  formatDelta,
  formatSummary,
  formatValue,
  pickLatestTwo,
  sameValue,
} from "./minsky-report.mjs";

describe("extractNumber", () => {
  test("returns the leading number from a string", () => {
    expect(extractNumber("43.3% active days")).toBe(43.3);
    expect(extractNumber("16.6 commits/day (497 in 30d)")).toBe(16.6);
    expect(extractNumber("-5 errors")).toBe(-5);
  });
  test("passes through numbers unchanged", () => {
    expect(extractNumber(42)).toBe(42);
    expect(extractNumber(0)).toBe(0);
  });
  test("returns undefined for non-numeric strings", () => {
    expect(extractNumber("pass")).toBe(undefined);
    expect(extractNumber("no OTEL backend")).toBe(undefined);
  });
});

describe("directionArrow", () => {
  test("higher-is-better metric going up = ↑", () => {
    expect(directionArrow(40, 50, true)).toBe("↑");
  });
  test("higher-is-better metric going down = ↓", () => {
    expect(directionArrow(50, 40, true)).toBe("↓");
  });
  test("lower-is-better metric going down = ↑ (good)", () => {
    expect(directionArrow(50, 40, false)).toBe("↑");
  });
  test("lower-is-better metric going up = ↓ (bad)", () => {
    expect(directionArrow(40, 50, false)).toBe("↓");
  });
  test("no change returns →", () => {
    expect(directionArrow(50, 50, true)).toBe("→");
  });
  test("non-numeric values return →", () => {
    expect(directionArrow("pass", "fail", true)).toBe("→");
  });
  test("works with string-with-units (the real snapshot format)", () => {
    expect(directionArrow("43.3% active days (13/30d)", "46.7% active days (14/30d)", true)).toBe(
      "↑",
    );
  });
});

describe("sameValue", () => {
  test("primitives equal", () => {
    expect(sameValue(42, 42)).toBe(true);
    expect(sameValue("hello", "hello")).toBe(true);
  });
  test("primitives unequal", () => {
    expect(sameValue(42, 43)).toBe(false);
  });
  test("objects deep-equal", () => {
    expect(sameValue({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });
  test("type mismatch is unequal", () => {
    expect(sameValue(42, "42")).toBe(false);
  });
});

describe("formatValue", () => {
  test("undefined → em dash", () => {
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue(null)).toBe("—");
  });
  test("numbers stringify", () => {
    expect(formatValue(42)).toBe("42");
  });
  test("strings pass through", () => {
    expect(formatValue("hello")).toBe("hello");
  });
});

describe("pickLatestTwo", () => {
  test("empty list returns both undefined", () => {
    expect(pickLatestTwo([])).toEqual({ latest: undefined, previous: undefined });
  });
  test("single snapshot returns latest, no previous", () => {
    const a = { date: "2026-05-19", data: {} };
    expect(pickLatestTwo([a])).toEqual({ latest: a, previous: undefined });
  });
  test("multiple snapshots: latest is last (sorted), previous is second-to-last", () => {
    const a = { date: "2026-05-17", data: {} };
    const b = { date: "2026-05-18", data: {} };
    const c = { date: "2026-05-19", data: {} };
    expect(pickLatestTwo([a, b, c])).toEqual({ latest: c, previous: b });
  });
});

describe("formatDelta", () => {
  test("no snapshots returns informative message", () => {
    expect(formatDelta(undefined, undefined)).toContain("no snapshots");
  });
  test("baseline-only (no previous) lists all metrics with +", () => {
    const out = formatDelta(
      {
        date: "2026-05-19",
        data: { foo: { value: 42, higherIsBetter: true } },
      },
      undefined,
    );
    expect(out).toContain("baseline-only");
    expect(out).toContain("+ foo");
    expect(out).toContain("42");
  });
  test("standard delta shows arrows for changed metrics", () => {
    const prev = {
      date: "2026-05-18",
      data: { foo: { value: 40, higherIsBetter: true } },
    };
    const cur = {
      date: "2026-05-19",
      data: { foo: { value: 50, higherIsBetter: true } },
    };
    const out = formatDelta(cur, prev);
    expect(out).toContain("↑");
    expect(out).toContain("foo");
    expect(out).toContain("40");
    expect(out).toContain("50");
  });
  test("same value is reported with → and (same)", () => {
    const prev = {
      date: "2026-05-18",
      data: { foo: { value: 50, higherIsBetter: true } },
    };
    const cur = {
      date: "2026-05-19",
      data: { foo: { value: 50, higherIsBetter: true } },
    };
    const out = formatDelta(cur, prev);
    expect(out).toContain("→");
    expect(out).toContain("(same)");
  });
  test("new metric (in latest only) shows + (new)", () => {
    const prev = {
      date: "2026-05-18",
      data: { foo: { value: 50, higherIsBetter: true } },
    };
    const cur = {
      date: "2026-05-19",
      data: {
        foo: { value: 50, higherIsBetter: true },
        bar: { value: 99, higherIsBetter: true },
      },
    };
    const out = formatDelta(cur, prev);
    expect(out).toContain("+ bar");
    expect(out).toContain("(new)");
  });
});

describe("formatSummary", () => {
  test("no snapshot returns hint", () => {
    expect(formatSummary(undefined)).toContain("no snapshots");
    expect(formatSummary(undefined)).toContain("metrics:collect");
  });
  test("formatted summary contains date and metric names", () => {
    const out = formatSummary({
      date: "2026-05-19",
      data: {
        "loop-uptime": { value: "46.7%", higherIsBetter: true },
        mttr: { value: "no OTEL backend", higherIsBetter: false },
      },
    });
    expect(out).toContain("2026-05-19");
    expect(out).toContain("loop-uptime");
    expect(out).toContain("mttr");
    expect(out).toContain("higher better");
    expect(out).toContain("lower better");
  });
});
