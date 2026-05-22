import { describe, expect, test } from "vitest";

import {
  DEFAULT_THRESHOLDS,
  computeFreshness,
  extractCorpusEntries,
} from "./check-corpus-freshness.mjs";

describe("extractCorpusEntries", () => {
  test("(a) parses a single published competitor", () => {
    const body = `
      export const COMPETITORS = [
        {
          id: "test-vendor",
          label: "Test Vendor",
          kind: "open-source",
          homepage: "https://example.com",
          resultSource: {
            kind: "published",
            citation: "Test, 'Test publication', example.com, 2025-01-15",
            asOf: "2025-01-15",
            values: { "autonomous-merge-rate": 0.5 },
          },
        },
      ];
    `;
    const entries = extractCorpusEntries(body);
    expect(entries).toEqual([{ id: "test-vendor", asOf: "2025-01-15" }]);
  });

  test("(b) parses multiple published competitors in declaration order", () => {
    const body = `
      [
        { id: "vendor-a", kind: "published", asOf: "2025-01-01", },
        { id: "vendor-b", kind: "published", asOf: "2025-02-01", },
        { id: "vendor-c", kind: "published", asOf: "2025-03-01", },
      ]
    `;
    const entries = extractCorpusEntries(body);
    expect(entries.map((e) => e.id)).toEqual(["vendor-a", "vendor-b", "vendor-c"]);
  });

  test("(c) skips local-harness competitors (no asOf to track)", () => {
    const body = `
      [
        { id: "published-vendor", kind: "published", asOf: "2025-01-01", },
        { id: "harness-vendor", kind: "local-harness", harnessId: "shared", },
        { id: "another-published", kind: "published", asOf: "2025-02-01", },
      ]
    `;
    const entries = extractCorpusEntries(body);
    expect(entries.map((e) => e.id)).toEqual(["published-vendor", "another-published"]);
  });

  test("(d) returns empty array when no published competitors found", () => {
    const body = `[{ id: "only-harness", kind: "local-harness", harnessId: "x", }]`;
    const entries = extractCorpusEntries(body);
    expect(entries).toEqual([]);
  });

  test("(e) ignores asOf strings outside the kebab/ISO shape", () => {
    const body = `
      [
        { id: "good-vendor", kind: "published", asOf: "2025-01-15", },
        { id: "bad-vendor", kind: "published", asOf: "January 2025", },
      ]
    `;
    const entries = extractCorpusEntries(body);
    // The bad-vendor's asOf doesn't match \d{4}-\d{2}-\d{2}, so it's skipped.
    expect(entries.map((e) => e.id)).toEqual(["good-vendor"]);
  });
});

describe("computeFreshness", () => {
  const NOW = "2026-05-22";

  test("(f) all-fresh corpus: 0 stale, 0 very-stale, status=fresh", () => {
    const summary = computeFreshness({
      competitors: [
        { id: "a", asOf: "2026-05-01" },
        { id: "b", asOf: "2026-04-01" },
      ],
      now: NOW,
    });
    expect(summary.staleCount).toBe(0);
    expect(summary.verySaleCount).toBe(0);
    expect(summary.verySaleIds).toEqual([]);
    expect(summary.entries.every((e) => e.status === "fresh")).toBe(true);
  });

  test("(g) bucketizes per default 90/180 thresholds", () => {
    const summary = computeFreshness({
      competitors: [
        { id: "fresh-1", asOf: "2026-03-01" }, // ~82 days
        { id: "stale-1", asOf: "2025-12-01" }, // ~172 days
        { id: "verystale-1", asOf: "2024-01-01" }, // >850 days
      ],
      now: NOW,
    });
    expect(summary.entries.find((e) => e.id === "fresh-1")?.status).toBe("fresh");
    expect(summary.entries.find((e) => e.id === "stale-1")?.status).toBe("stale");
    expect(summary.entries.find((e) => e.id === "verystale-1")?.status).toBe("very-stale");
  });

  test("(h) staleCount includes both stale and very-stale", () => {
    const summary = computeFreshness({
      competitors: [
        { id: "fresh", asOf: "2026-04-01" },
        { id: "stale", asOf: "2025-12-01" },
        { id: "verystale", asOf: "2020-01-01" },
      ],
      now: NOW,
    });
    expect(summary.staleCount).toBe(2);
    expect(summary.verySaleCount).toBe(1);
  });

  test("(i) verySaleIds is the subset >180 days", () => {
    const summary = computeFreshness({
      competitors: [
        { id: "a", asOf: "2020-01-01" },
        { id: "b", asOf: "2026-04-01" },
        { id: "c", asOf: "2018-06-01" },
      ],
      now: NOW,
    });
    expect([...summary.verySaleIds].sort()).toEqual(["a", "c"]);
  });

  test("(j) meanAgeDays is rounded integer of the per-entry average", () => {
    const summary = computeFreshness({
      competitors: [
        { id: "a", asOf: "2026-05-12" }, // 10d
        { id: "b", asOf: "2026-05-02" }, // 20d
      ],
      now: NOW,
    });
    expect(summary.meanAgeDays).toBe(15);
  });

  test("(k) empty corpus → 0 entries, 0 mean, 0 counts", () => {
    const summary = computeFreshness({ competitors: [], now: NOW });
    expect(summary.entries).toEqual([]);
    expect(summary.meanAgeDays).toBe(0);
    expect(summary.staleCount).toBe(0);
    expect(summary.verySaleCount).toBe(0);
  });

  test("(l) future asOf clamps ageDays to 0 (not negative)", () => {
    const summary = computeFreshness({
      competitors: [{ id: "time-traveller", asOf: "2027-01-01" }],
      now: NOW,
    });
    expect(summary.entries[0]?.ageDays).toBe(0);
    expect(summary.entries[0]?.status).toBe("fresh");
  });

  test("(m) custom thresholds override the defaults", () => {
    const summary = computeFreshness({
      competitors: [{ id: "test", asOf: "2026-03-01" }], // ~82 days
      now: NOW,
      thresholds: { fresh: 30, stale: 60 }, // tighter — everything older than 60d is very-stale
    });
    expect(summary.entries[0]?.status).toBe("very-stale");
  });

  test("(n) invalid now throws a clear error", () => {
    expect(() =>
      computeFreshness({ competitors: [{ id: "x", asOf: "2026-01-01" }], now: "not-a-date" }),
    ).toThrow(/invalid now date/);
  });

  test("(o) invalid asOf threads through to a clear error naming the competitor id", () => {
    // The extractor would already filter invalid asOf out — this test
    // exercises the compute layer's direct contract for synthetic input.
    expect(() =>
      computeFreshness({
        competitors: [{ id: "broken-vendor", asOf: "not-a-date" }],
        now: NOW,
      }),
    ).toThrow(/broken-vendor.*not-a-date/);
  });

  test("(p) DEFAULT_THRESHOLDS is frozen + matches the documented values", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ fresh: 90, stale: 180 });
    expect(Object.isFrozen(DEFAULT_THRESHOLDS)).toBe(true);
  });

  test("(q) summary is deterministic — same input yields same output", () => {
    const input = {
      competitors: [
        { id: "a", asOf: "2025-01-01" },
        { id: "b", asOf: "2026-04-01" },
      ],
      now: NOW,
    };
    const s1 = computeFreshness(input);
    const s2 = computeFreshness(input);
    expect(s1).toEqual(s2);
  });

  test("(r) entries order matches input order", () => {
    const summary = computeFreshness({
      competitors: [
        { id: "z", asOf: "2026-04-01" },
        { id: "a", asOf: "2026-04-01" },
        { id: "m", asOf: "2026-04-01" },
      ],
      now: NOW,
    });
    expect(summary.entries.map((e) => e.id)).toEqual(["z", "a", "m"]);
  });
});
