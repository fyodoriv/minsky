import { describe, expect, it } from "vitest";

import {
  aggregateStatus,
  type RunABTestArgs,
  runABTestPure,
  StubPromptOptimizer,
  type Variant,
} from "./index.js";

const variantA: Variant = { id: "a", system: "you are A", user: "hi {{name}}" };
const variantB: Variant = { id: "b", system: "you are B", user: "hi {{name}}" };

describe("StubPromptOptimizer.runABTest", () => {
  it("scores every (variant × input) pair and picks the highest-mean winner", async () => {
    const stub = new StubPromptOptimizer();
    // Metric: B always scores 1; A always scores 0. B should win.
    const args: RunABTestArgs = {
      variants: [variantA, variantB],
      inputs: [{ name: "alice" }, { name: "bob" }],
      metric: async (output) => (output.startsWith("b:") ? 1 : 0),
    };
    const result = await stub.runABTest(args);

    expect(result.winnerId).toBe("b");
    expect(result.results).toHaveLength(4);
    expect(result.sustainedGainAt7d).toBe(false);
    expect(stub.callCount.get("a")).toBe(2);
    expect(stub.callCount.get("b")).toBe(2);
  });

  it("breaks ties by lowest variant id", async () => {
    const stub = new StubPromptOptimizer();
    const result = await stub.runABTest({
      variants: [variantB, variantA],
      inputs: [{ name: "x" }],
      metric: async () => 0.5, // every variant ties
    });
    expect(result.winnerId).toBe("a");
  });

  it("emits one EvalResult per (variant × input) pair, in iteration order", async () => {
    const stub = new StubPromptOptimizer();
    const result = await stub.runABTest({
      variants: [variantA, variantB],
      inputs: [{ k: 1 }, { k: 2 }, { k: 3 }],
      metric: async (output) => output.length,
    });
    expect(result.results).toHaveLength(6);
    const ids = result.results.map((r) => r.variantId);
    expect(ids).toEqual(["a", "a", "a", "b", "b", "b"]);
  });
});

describe("StubPromptOptimizer.structured", () => {
  it("returns the schema cast to T (echo fake) so call sites can assert shape", async () => {
    const stub = new StubPromptOptimizer();
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const got = await stub.structured<{ type: string }>({
      system: "S",
      user: "U",
      schema,
    });
    expect(got).toEqual(schema);
  });
});

describe("StubPromptOptimizer.selfTest", () => {
  it("returns green with a non-negative latency and an ISO-8601 timestamp", async () => {
    const stub = new StubPromptOptimizer();
    const r = await stub.selfTest();
    expect(r.status).toBe("green");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.lastCheck).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("aggregates with other green results to green via the shared lattice", async () => {
    const stub = new StubPromptOptimizer();
    const r1 = await stub.selfTest();
    const r2 = await stub.selfTest();
    expect(aggregateStatus([r1, r2])).toBe("green");
  });
});

describe("runABTestPure (kernel)", () => {
  it("rejects an empty `variants` list", async () => {
    await expect(
      runABTestPure(
        {
          variants: [],
          inputs: [{ k: 1 }],
          metric: async () => 1,
        },
        async () => ({ text: "", tokens: 0, traceId: "" }),
      ),
    ).rejects.toThrow(/variants.*non-empty/);
  });

  it("propagates the per-call token count + traceId into EvalResult", async () => {
    const result = await runABTestPure(
      {
        variants: [variantA],
        inputs: [{ k: 1 }],
        metric: async () => 1,
      },
      async () => ({ text: "stub", tokens: 42, traceId: "abc" }),
    );
    expect(result.results[0]?.tokens).toBe(42);
    expect(result.results[0]?.traceId).toBe("abc");
  });

  it("zero-input case still returns a deterministic winner (the first listed variant)", async () => {
    const result = await runABTestPure(
      {
        variants: [variantA, variantB],
        inputs: [],
        metric: async () => 1,
      },
      async () => ({ text: "", tokens: 0, traceId: "" }),
    );
    expect(result.winnerId).toBe("a");
    expect(result.results).toHaveLength(0);
  });
});

describe("StubPromptOptimizer constructor options", () => {
  it("uses a custom completion function when provided", async () => {
    const stub = new StubPromptOptimizer({
      completion: (vid) => `custom-${vid}`,
      tokensPerCall: 7,
    });
    const result = await stub.runABTest({
      variants: [variantA, variantB],
      inputs: [{ k: 1 }],
      metric: async (output) => (output === "custom-a" ? 1 : 0),
    });
    expect(result.winnerId).toBe("a");
    expect(result.results.every((r) => r.tokens === 7)).toBe(true);
  });
});
