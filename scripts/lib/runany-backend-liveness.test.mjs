// <!-- scope: human-approved runany-dynamic-model-or-local-fallback slice 3 — paired tests for the liveness probe + TTL cache + snapshot adapter. -->
// Tests for runany-backend-liveness: the TTL cache (Pivot), the snapshot →
// RemainingFractions adapter, and the probe-result mapper. xUnit paired
// fixtures (Meszaros 2007); the clock + probe are injected so liveness is
// deterministic with no network.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROBE_TTL_MS,
  isFresh,
  LivenessProbeCache,
  snapshotToRemaining,
  toRemoteBackends,
} from "./runany-backend-liveness.mjs";

/**
 * A scriptable clock + probe pair for the cache fixtures.
 *
 * @param {import("./runany-backend-liveness.mjs").ProbeResult[][]} probeSeq
 */
function fixture(probeSeq) {
  let nowMs = 1_000_000;
  let calls = 0;
  const cache = new LivenessProbeCache({
    clock: () => nowMs,
    probe: () => {
      const r = probeSeq[Math.min(calls, probeSeq.length - 1)];
      calls += 1;
      return r ?? [];
    },
  });
  return {
    cache,
    /** @param {number} ms */
    advance: (ms) => {
      nowMs += ms;
    },
    get calls() {
      return calls;
    },
  };
}

describe("toRemoteBackends", () => {
  it("preserves order and carries reason only for down backends", () => {
    const out = toRemoteBackends([
      { id: "claude", reachable: true },
      { id: "bedrock", reachable: false, reason: "timeout" },
    ]);
    expect(out).toEqual([
      { id: "claude", reachable: true },
      { id: "bedrock", reachable: false, reason: "timeout" },
    ]);
  });

  it("defaults a missing reason to 'down'", () => {
    const out = toRemoteBackends([{ id: "x", reachable: false }]);
    expect(out[0]?.reason).toBe("down");
  });
});

describe("isFresh", () => {
  it("is fresh inside the TTL window", () => {
    expect(isFresh(1_059_999, 1_000_000, 60_000)).toBe(true);
  });

  it("is stale at exactly the TTL boundary", () => {
    expect(isFresh(1_060_000, 1_000_000, 60_000)).toBe(false);
  });

  it("treats a clock that moved backwards as stale (re-probe)", () => {
    expect(isFresh(999_000, 1_000_000, 60_000)).toBe(false);
  });

  it("defaults to the 60s Pivot floor", () => {
    expect(DEFAULT_PROBE_TTL_MS).toBe(60_000);
    expect(isFresh(1_050_000, 1_000_000)).toBe(true);
  });
});

describe("LivenessProbeCache — TTL behaviour (Pivot: cache, TTL ≥60s)", () => {
  it("probes once then serves from cache within the TTL", async () => {
    const f = fixture([[{ id: "claude", reachable: true }]]);
    const a = await f.cache.liveness(["claude"]);
    expect(a.cacheHit).toBe(false);
    f.advance(30_000);
    const b = await f.cache.liveness(["claude"]);
    expect(b.cacheHit).toBe(true);
    expect(f.calls).toBe(1);
  });

  it("re-probes after the TTL expires", async () => {
    const f = fixture([
      [{ id: "claude", reachable: true }],
      [{ id: "claude", reachable: false, reason: "401" }],
    ]);
    await f.cache.liveness(["claude"]);
    f.advance(61_000);
    const b = await f.cache.liveness(["claude"]);
    expect(b.cacheHit).toBe(false);
    expect(b.backends[0]?.reachable).toBe(false);
    expect(f.calls).toBe(2);
  });

  it("force re-probes inside the TTL (provider-error / band-cross trigger)", async () => {
    const f = fixture([
      [{ id: "claude", reachable: true }],
      [{ id: "claude", reachable: false, reason: "econnrefused" }],
    ]);
    await f.cache.liveness(["claude"]);
    const b = await f.cache.liveness(["claude"], { force: true });
    expect(b.cacheHit).toBe(false);
    expect(f.calls).toBe(2);
  });

  it("misses the cache when a new backend id appears", async () => {
    const f = fixture([
      [{ id: "claude", reachable: true }],
      [
        { id: "claude", reachable: true },
        { id: "bedrock", reachable: true },
      ],
    ]);
    await f.cache.liveness(["claude"]);
    const b = await f.cache.liveness(["claude", "bedrock"]);
    expect(b.cacheHit).toBe(false);
    expect(b.backends).toHaveLength(2);
  });
});

describe("snapshotToRemaining", () => {
  it("maps used/limit to fivehour remaining", () => {
    const r = snapshotToRemaining({ used: 300_000, limit: 1_000_000 });
    expect(r.fivehour).toBeCloseTo(0.7, 5);
  });

  it("maps weekly + monthly consumed fractions to remaining", () => {
    const r = snapshotToRemaining({
      used: 0,
      limit: 1_000_000,
      weekly_consumed_fraction: 0.8,
      monthly_consumed_fraction: 0.9,
    });
    expect(r.weekly).toBeCloseTo(0.2, 5);
    expect(r.monthly).toBeCloseTo(0.1, 5);
  });

  it("treats a missing/zero-limit snapshot as full headroom (cold start)", () => {
    const r = snapshotToRemaining(undefined);
    expect(r).toMatchObject({ fivehour: 1, weekly: 1, monthly: 1 });
  });

  it("clamps over-consumption to zero remaining", () => {
    const r = snapshotToRemaining({ used: 2_000_000, limit: 1_000_000 });
    expect(r.fivehour).toBe(0);
  });
});
