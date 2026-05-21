/**
 * Tests for `@minsky/tick-loop/runany-provider-decision` — slice 1 of
 * `runany-dynamic-model-or-local-fallback`.
 *
 * Coverage strategy: the 5-row failure-mode chaos table from the module
 * JSDoc (rule #7) plus the 3-clause steady-state hypothesis (rule #9):
 *   - pin set → pinned model in 100% of iterations regardless of
 *     budget/liveness;
 *   - no pin, ≥1 remote reachable → model tracks remaining-budget bands;
 *   - no pin, all remote down → `local` within ≤1 iteration, ≥95% local
 *     dispatch thereafter, 0 wedged/hold iterations.
 */

import type { RemainingFractions } from "@minsky/token-monitor";
import { describe, expect, it } from "vitest";

import type { ModelCatalogEntry } from "./model-catalog.js";
import { type RemoteBackendLiveness, decideRunAnyProvider } from "./runany-provider-decision.js";

function mkRemaining(overrides: Partial<RemainingFractions> = {}): RemainingFractions {
  return {
    fivehour: 1,
    weekly: 1,
    monthly: 1,
    observedAt: "2026-05-16T00:00:00Z",
    ...overrides,
  };
}

const CLAUDE_UP: readonly RemoteBackendLiveness[] = [{ id: "claude", reachable: true }];
const CLAUDE_DOWN: readonly RemoteBackendLiveness[] = [
  { id: "claude", reachable: false, reason: "econnrefused" },
];
const ALL_DOWN: readonly RemoteBackendLiveness[] = [
  { id: "claude", reachable: false, reason: "econnrefused" },
  { id: "bedrock", reachable: false, reason: "timeout" },
];

describe("decideRunAnyProvider — chaos row 1: all remote backends down", () => {
  it("switches fully to local (kind=local-fallback, agent=local)", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: ALL_DOWN,
    });
    expect(out.agent).toBe("local");
    expect(out.kind).toBe("local-fallback");
    expect(out.model).toBe("local");
  });

  it("never returns a wedged/hold kind — local is the last resort", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining({ fivehour: 0, weekly: 0, monthly: 0 }),
      remoteBackends: ALL_DOWN,
    });
    expect(["operator-pin", "dynamic", "local-fallback"]).toContain(out.kind);
    expect(out.agent).toBe("local");
  });

  it("names the down backends + reasons in the reason string", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: ALL_DOWN,
    });
    expect(out.reason).toContain("claude(econnrefused)");
    expect(out.reason).toContain("bedrock(timeout)");
  });

  it("single-backend (claude only) down → local fallback", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: CLAUDE_DOWN,
    });
    expect(out.kind).toBe("local-fallback");
    expect(out.agent).toBe("local");
  });
});

describe("decideRunAnyProvider — chaos row 2: operator pin while all remote down", () => {
  it("honors the pin verbatim — pin overrides liveness", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: ALL_DOWN,
      operatorPin: "claude-sonnet-4-6",
    });
    expect(out.kind).toBe("operator-pin");
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("honors the pin verbatim — pin overrides exhausted budget", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining({ fivehour: 0, weekly: 0, monthly: 0 }),
      remoteBackends: CLAUDE_UP,
      operatorPin: "claude-opus-4-7",
    });
    expect(out.kind).toBe("operator-pin");
    expect(out.model).toBe("claude-opus-4-7");
  });
});

describe("decideRunAnyProvider — chaos row 3: no remote configured (empty list)", () => {
  it("empty backend list defers to the dynamic picker (full budget → top tier)", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: [],
    });
    expect(out.kind).toBe("dynamic");
    expect(out.model).toBe("claude-opus-4-7");
  });

  it("empty backend list + exhausted budget → dynamic picker degrades to local", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining({ fivehour: 0, weekly: 0, monthly: 0 }),
      remoteBackends: [],
    });
    expect(out.kind).toBe("dynamic");
    expect(out.agent).toBe("local");
  });
});

describe("decideRunAnyProvider — chaos row 4: remote recovers (automatic switchback)", () => {
  it("down → recovered yields a remote model the very next iteration", () => {
    const down = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: ALL_DOWN,
    });
    expect(down.kind).toBe("local-fallback");

    const recovered = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: CLAUDE_UP,
    });
    expect(recovered.kind).toBe("dynamic");
    expect(recovered.agent).toBe("claude");
  });

  it("partial recovery (≥1 backend reachable) is enough to leave local", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: [
        { id: "claude", reachable: false, reason: "down" },
        { id: "bedrock", reachable: true },
      ],
    });
    expect(out.kind).toBe("dynamic");
  });
});

describe("decideRunAnyProvider — chaos row 5: unknown pin (typo) graceful-degrade", () => {
  it("unknown pin is ignored; the dynamic walk runs instead", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: CLAUDE_UP,
      operatorPin: "gpt-9-ultra",
    });
    expect(out.kind).toBe("dynamic");
    expect(out.model).toBe("claude-opus-4-7");
  });

  it("empty-string pin is treated as no pin", () => {
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: CLAUDE_UP,
      operatorPin: "",
    });
    expect(out.kind).toBe("dynamic");
  });
});

describe("decideRunAnyProvider — steady-state hypothesis (rule #9)", () => {
  it("pin set → pinned model in 100% of 100 iterations regardless of budget/liveness", () => {
    let pinnedCount = 0;
    for (let i = 0; i < 100; i++) {
      const frac = 1 - i / 100;
      const out = decideRunAnyProvider({
        remaining: mkRemaining({ fivehour: frac, weekly: frac, monthly: frac }),
        remoteBackends: i % 2 === 0 ? ALL_DOWN : CLAUDE_UP,
        operatorPin: "claude-sonnet-4-6",
      });
      if (out.kind === "operator-pin" && out.model === "claude-sonnet-4-6") pinnedCount++;
    }
    expect(pinnedCount).toBe(100);
  });

  it("no pin, ≥1 remote reachable → model tracks remaining-budget bands", () => {
    const top = decideRunAnyProvider({
      remaining: mkRemaining({ fivehour: 1, weekly: 1, monthly: 1 }),
      remoteBackends: CLAUDE_UP,
    });
    const mid = decideRunAnyProvider({
      remaining: mkRemaining({ fivehour: 0.4, weekly: 0.25, monthly: 0.2 }),
      remoteBackends: CLAUDE_UP,
    });
    const low = decideRunAnyProvider({
      remaining: mkRemaining({ fivehour: 0.05, weekly: 0.05, monthly: 0.05 }),
      remoteBackends: CLAUDE_UP,
    });
    expect(top.model).toBe("claude-opus-4-7");
    expect(mid.model).toBe("claude-sonnet-4-6");
    expect(low.agent).toBe("local");
  });

  it("no pin, all remote down → ≥95% local dispatch over 100 iters, 0 wedged", () => {
    let localCount = 0;
    let wedged = 0;
    for (let i = 0; i < 100; i++) {
      const frac = 1 - i / 100;
      const out = decideRunAnyProvider({
        remaining: mkRemaining({ fivehour: frac, weekly: frac, monthly: frac }),
        remoteBackends: ALL_DOWN,
      });
      if (out.agent === "local") localCount++;
      if (!["operator-pin", "dynamic", "local-fallback"].includes(out.kind)) wedged++;
    }
    expect(localCount).toBeGreaterThanOrEqual(95);
    expect(wedged).toBe(0);
  });
});

describe("decideRunAnyProvider — custom catalog passthrough", () => {
  it("local fallback prefers the highest-tier local row in the catalog", () => {
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
        recordedAt: "2026-05-16",
      },
      {
        id: "local-small",
        agent: "local",
        qualityTier: 3,
        costPer1MtokInput: 0,
        costPer1MtokOutput: 0,
        fivehourFloor: 0,
        weeklyFloor: 0,
        monthlyFloor: 0,
        recordedAt: "2026-05-16",
      },
      {
        id: "local-large",
        agent: "local",
        qualityTier: 4,
        costPer1MtokInput: 0,
        costPer1MtokOutput: 0,
        fivehourFloor: 0,
        weeklyFloor: 0,
        monthlyFloor: 0,
        recordedAt: "2026-05-16",
      },
    ];
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: ALL_DOWN,
      catalog,
    });
    expect(out.model).toBe("local-large");
    expect(out.kind).toBe("local-fallback");
  });

  it("synthesises a `local` row when the catalog has no local entry", () => {
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
        recordedAt: "2026-05-16",
      },
    ];
    const out = decideRunAnyProvider({
      remaining: mkRemaining(),
      remoteBackends: ALL_DOWN,
      catalog,
    });
    expect(out.model).toBe("local");
    expect(out.agent).toBe("local");
    expect(out.kind).toBe("local-fallback");
  });
});
