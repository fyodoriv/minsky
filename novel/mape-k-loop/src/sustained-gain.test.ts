import { describe, expect, it } from "vitest";

import { DEFAULT_WINDOW_DAYS, type RolloutHistoryEntry, sustainedGain } from "./sustained-gain.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const entry = (overrides: Partial<RolloutHistoryEntry> = {}): RolloutHistoryEntry => ({
  iteration: 1,
  ts: "2026-05-01T00:00:00Z",
  variantId: "rule-9-direct-answer",
  decision: "rollout",
  score: 0.8,
  ...overrides,
});

describe("sustainedGain", () => {
  it("returns false when there is no history within the window (cold start)", () => {
    const result = sustainedGain({
      winnerVariantId: "rule-9-direct-answer",
      history: [],
      now: new Date("2026-05-10T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no rollout history/);
  });

  it("returns false when the window only spans <7 d (insufficient evidence)", () => {
    const now = new Date("2026-05-08T00:00:00Z");
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 1, ts: "2026-05-05T00:00:00Z" }),
      entry({ iteration: 2, ts: "2026-05-07T00:00:00Z" }),
    ];
    const result = sustainedGain({
      winnerVariantId: "rule-9-direct-answer",
      history,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/window only spans/);
  });

  it("returns true when the same winner held for ≥7 d", () => {
    const now = new Date("2026-05-10T00:00:00Z");
    const earliest = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY).toISOString();
    const mid = new Date(now.getTime() - 4 * MS_PER_DAY).toISOString();
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 1, ts: earliest }),
      entry({ iteration: 2, ts: mid }),
      entry({ iteration: 3, ts: now.toISOString() }),
    ];
    const result = sustainedGain({
      winnerVariantId: "rule-9-direct-answer",
      history,
      now,
    });
    expect(result.ok).toBe(true);
  });

  it("returns false when a different variant won mid-window (swap)", () => {
    const now = new Date("2026-05-10T00:00:00Z");
    const earliest = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY).toISOString();
    const mid = new Date(now.getTime() - 3 * MS_PER_DAY).toISOString();
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 1, ts: earliest, variantId: "rule-9-direct-answer" }),
      entry({ iteration: 2, ts: mid, variantId: "rule-9-tighten-scope" }),
      entry({ iteration: 3, ts: now.toISOString(), variantId: "rule-9-direct-answer" }),
    ];
    const result = sustainedGain({
      winnerVariantId: "rule-9-direct-answer",
      history,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/winner swapped/);
  });

  it("ignores `rejected` entries (guard refusals are not measurements)", () => {
    const now = new Date("2026-05-10T00:00:00Z");
    const earliest = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY).toISOString();
    const mid = new Date(now.getTime() - 3 * MS_PER_DAY).toISOString();
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 1, ts: earliest }),
      entry({ iteration: 2, ts: mid, variantId: "rule-9-tighten-scope", decision: "rejected" }),
      entry({ iteration: 3, ts: now.toISOString() }),
    ];
    const result = sustainedGain({
      winnerVariantId: "rule-9-direct-answer",
      history,
      now,
    });
    expect(result.ok).toBe(true);
  });

  it("falls back gracefully on malformed timestamps (rule #7 — drop the row)", () => {
    const now = new Date("2026-05-10T00:00:00Z");
    const earliest = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY).toISOString();
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 1, ts: earliest }),
      entry({ iteration: 2, ts: "not-a-date" }),
      entry({ iteration: 3, ts: now.toISOString() }),
    ];
    const result = sustainedGain({ winnerVariantId: "rule-9-direct-answer", history, now });
    expect(result.ok).toBe(true);
  });

  it("respects a custom windowDays argument", () => {
    const now = new Date("2026-05-10T00:00:00Z");
    const earliest = new Date(now.getTime() - 3 * MS_PER_DAY).toISOString();
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 1, ts: earliest }),
      entry({ iteration: 2, ts: now.toISOString() }),
    ];
    const tight = sustainedGain({
      winnerVariantId: "rule-9-direct-answer",
      history,
      now,
      windowDays: 3,
    });
    expect(tight.ok).toBe(true);
  });
});
