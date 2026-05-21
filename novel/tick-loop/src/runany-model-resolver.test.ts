/**
 * Tests for `@minsky/tick-loop/runany-model-resolver` — slice 1 of
 * `runany-dynamic-model-or-local-fallback`.
 *
 * Coverage: the three acceptance scenarios (pin / dynamic / all-remote-
 * down + recovery) plus the four chaos-table rows.
 */

import type { RemainingFractions } from "@minsky/token-monitor";
import { describe, expect, it } from "vitest";

import type { LocalProbeResult } from "./llm-provider-selector.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import { type RemoteBackendLiveness, resolveRunAnyModel } from "./runany-model-resolver.js";

function mkRemaining(overrides: Partial<RemainingFractions> = {}): RemainingFractions {
  return {
    fivehour: 1,
    weekly: 1,
    monthly: 1,
    observedAt: "2026-05-17T00:00:00Z",
    ...overrides,
  };
}

const REACHABLE_LOCAL: LocalProbeResult = { reachable: true, observedAtMs: 0 };
const UNREACHABLE_LOCAL: LocalProbeResult = {
  reachable: false,
  observedAtMs: 0,
  reason: "ECONNREFUSED",
};

function remote(id: string, reachable: boolean, reason?: string): RemoteBackendLiveness {
  return reason === undefined ? { id, reachable } : { id, reachable, reason };
}

describe("resolveRunAnyModel — scenario 1: operator pin overrides everything", () => {
  it("honors a valid pin at full budget", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
      operatorPin: "claude-sonnet-4-6",
    });
    expect(out.model).toBe("claude-sonnet-4-6");
    expect(out.source).toBe("operator-pin");
  });

  it("honors the pin even when budget is exhausted (would otherwise be local)", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining({ fivehour: 0, weekly: 0, monthly: 0 }),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
      operatorPin: "claude-opus-4-7",
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.source).toBe("operator-pin");
  });

  it("honors the pin even when ALL remote backends are down (chaos row 4)", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", false, "ENETUNREACH")],
      localProbeResult: UNREACHABLE_LOCAL,
      operatorPin: "claude-opus-4-7",
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.source).toBe("operator-pin");
  });

  it("ignores a pin that names no catalog row (chaos row 3)", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
      operatorPin: "gpt-9-ultra",
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.source).toBe("dynamic");
  });

  it("ignores an empty/whitespace pin", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
      operatorPin: "   ",
    });
    expect(out.source).toBe("dynamic");
  });
});

describe("resolveRunAnyModel — scenario 2: dynamic by remaining budget", () => {
  it("high budget band → tier-1 opus", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining({ fivehour: 0.9, weekly: 0.9, monthly: 0.9 }),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.agent).toBe("claude");
    expect(out.source).toBe("dynamic");
  });

  it("mid budget band → tier-2 sonnet", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining({ fivehour: 0.4, weekly: 0.4, monthly: 0.4 }),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(out.model).toBe("claude-sonnet-4-6");
    expect(out.source).toBe("dynamic");
  });

  it("low budget band → local (budget-exhausted-local source)", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining({ fivehour: 0.05, weekly: 0.05, monthly: 0.05 }),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(out.agent).toBe("local");
    expect(out.source).toBe("budget-exhausted-local");
  });
});

describe("resolveRunAnyModel — scenario 3: all remote down → local + recovery", () => {
  it("switches fully to local when every remote backend is unreachable", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [
        remote("claude", false, "ENETUNREACH"),
        remote("openrouter", false, "http 503"),
      ],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(out.agent).toBe("local");
    expect(out.source).toBe("all-remote-down");
    expect(out.reason).toContain("claude=ENETUNREACH");
    expect(out.reason).toContain("openrouter=http 503");
  });

  it("still returns local when local probe is also down (chaos row 1, no wedge)", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", false, "ETIMEDOUT")],
      localProbeResult: UNREACHABLE_LOCAL,
    });
    expect(out.agent).toBe("local");
    expect(out.source).toBe("all-remote-down");
    expect(out.reason).toContain("bootstrap local");
  });

  it("recovers to the dynamic remote pick once any backend is reachable again", () => {
    const down = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", false, "ENETUNREACH")],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(down.source).toBe("all-remote-down");

    const recovered = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", true)],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(recovered.agent).toBe("claude");
    expect(recovered.source).toBe("dynamic");
  });

  it("one reachable backend among many down → dynamic, NOT all-remote-down", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", false, "ENETUNREACH"), remote("openrouter", true)],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(out.source).toBe("dynamic");
  });

  it("empty backend list is NOT 'all down' — falls to dynamic (chaos row 2)", () => {
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [],
      localProbeResult: REACHABLE_LOCAL,
    });
    expect(out.source).toBe("dynamic");
    expect(out.model).toBe("claude-opus-4-7");
  });
});

describe("resolveRunAnyModel — custom catalog edges", () => {
  it("all-remote-down resolves the catalog's local row id (custom catalog)", () => {
    const catalog: readonly ModelCatalogEntry[] = [
      {
        id: "my-local-qwen",
        agent: "local",
        qualityTier: 3,
        costPer1MtokInput: 0,
        costPer1MtokOutput: 0,
        fivehourFloor: 0,
        weeklyFloor: 0,
        monthlyFloor: 0,
        recordedAt: "2026-05-17",
      },
    ];
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", false, "ENETUNREACH")],
      localProbeResult: REACHABLE_LOCAL,
      catalog,
    });
    expect(out.model).toBe("my-local-qwen");
    expect(out.agent).toBe("local");
  });

  it("all-remote-down falls back to synthetic 'local' when catalog has no local row", () => {
    const catalog: readonly ModelCatalogEntry[] = [
      {
        id: "claude-opus-4-7",
        agent: "claude",
        qualityTier: 1,
        costPer1MtokInput: 15,
        costPer1MtokOutput: 75,
        fivehourFloor: 0.5,
        weeklyFloor: 0.3,
        monthlyFloor: 0.2,
        recordedAt: "2026-05-17",
      },
    ];
    const out = resolveRunAnyModel({
      remaining: mkRemaining(),
      remoteBackends: [remote("claude", false, "ENETUNREACH")],
      localProbeResult: REACHABLE_LOCAL,
      catalog,
    });
    expect(out.model).toBe("local");
    expect(out.agent).toBe("local");
  });
});
