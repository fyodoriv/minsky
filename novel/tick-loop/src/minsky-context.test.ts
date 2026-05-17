/**
 * Paired tests for `minsky-context.ts` — slice 1 of
 * `minsky-cli-context-aware-ux`.
 *
 * All probes are injected via synthetic fakes so the tests never spawn
 * processes or read real files (pure-over-injection pattern).
 */

import { describe, expect, it } from "vitest";
import {
  type ClaudeContextState,
  type ContextProbes,
  type GitContextState,
  type LocalLlmContextState,
  type MinskyContext,
  type QueueContextState,
  gatherMinskyContext,
} from "./minsky-context.js";

// ---- Helpers ----------------------------------------------------------------

function makeProbes(overrides: Partial<ContextProbes> = {}): ContextProbes {
  return {
    probeWorker: () => ({ alive: false }),
    probeLastIteration: () => undefined,
    probeClaudeState: async () => "unknown",
    probeLocalLlmState: async () => "not-running",
    probeGitState: async () => "clean",
    probePrStats: async () => ({ open: 0, conflicting: 0 }),
    probeQueueState: async () => "has-tasks",
    ...overrides,
  };
}

// ---- gatherMinskyContext — happy path ---------------------------------------

describe("gatherMinskyContext — worker alive", () => {
  it("returns alive: true with pid when PID file resolves to live process", async () => {
    const probes = makeProbes({ probeWorker: () => ({ alive: true, pid: 12345 }) });
    const ctx: MinskyContext = await gatherMinskyContext(probes);
    expect(ctx.workerState).toEqual({ alive: true, pid: 12345 });
  });
});

describe("gatherMinskyContext — worker stopped", () => {
  it("returns alive: false when no live PID found", async () => {
    const probes = makeProbes({ probeWorker: () => ({ alive: false }) });
    const ctx: MinskyContext = await gatherMinskyContext(probes);
    expect(ctx.workerState).toEqual({ alive: false });
  });
});

describe("gatherMinskyContext — last iteration age", () => {
  it("propagates lastIterationAgeMs from probeLastIteration", async () => {
    const probes = makeProbes({ probeLastIteration: () => 120_000 });
    const ctx: MinskyContext = await gatherMinskyContext(probes);
    expect(ctx.lastIterationAgeMs).toBe(120_000);
  });

  it("returns undefined when probeLastIteration returns undefined", async () => {
    const probes = makeProbes({ probeLastIteration: () => undefined });
    const ctx: MinskyContext = await gatherMinskyContext(probes);
    expect(ctx.lastIterationAgeMs).toBeUndefined();
  });
});

describe("gatherMinskyContext — claude state", () => {
  it.each<ClaudeContextState>(["healthy", "exhausted", "binary-missing", "unknown"])(
    "propagates claudeState: %s",
    async (state) => {
      const probes = makeProbes({ probeClaudeState: async () => state });
      const ctx: MinskyContext = await gatherMinskyContext(probes);
      expect(ctx.claudeState).toBe(state);
    },
  );
});

describe("gatherMinskyContext — local-LLM state", () => {
  it.each<LocalLlmContextState>(["running", "not-running"])(
    "propagates localLlmState: %s",
    async (state) => {
      const probes = makeProbes({ probeLocalLlmState: async () => state });
      const ctx: MinskyContext = await gatherMinskyContext(probes);
      expect(ctx.localLlmState).toBe(state);
    },
  );
});

describe("gatherMinskyContext — git state", () => {
  it.each<GitContextState>(["clean", "dirty", "unknown"])(
    "propagates gitState: %s",
    async (state) => {
      const probes = makeProbes({ probeGitState: async () => state });
      const ctx: MinskyContext = await gatherMinskyContext(probes);
      expect(ctx.gitState).toBe(state);
    },
  );
});

describe("gatherMinskyContext — PR stats", () => {
  it("propagates open and conflicting counts from probePrStats", async () => {
    const probes = makeProbes({ probePrStats: async () => ({ open: 5, conflicting: 2 }) });
    const ctx: MinskyContext = await gatherMinskyContext(probes);
    expect(ctx.prStats).toEqual({ open: 5, conflicting: 2 });
  });
});

describe("gatherMinskyContext — queue state", () => {
  it.each<QueueContextState>(["has-tasks", "empty", "unknown"])(
    "propagates queueState: %s",
    async (state) => {
      const probes = makeProbes({ probeQueueState: async () => state });
      const ctx: MinskyContext = await gatherMinskyContext(probes);
      expect(ctx.queueState).toBe(state);
    },
  );
});

// ---- gatherMinskyContext — timeout / graceful-degrade ----------------------

describe("gatherMinskyContext — probe timeout", () => {
  it("returns safe defaults when async probes hang past timeoutMs", async () => {
    const SLOW_MS = 600;
    const probes = makeProbes({
      probeClaudeState: () =>
        new Promise<ClaudeContextState>((resolve) => setTimeout(() => resolve("healthy"), SLOW_MS)),
      probeLocalLlmState: () =>
        new Promise<LocalLlmContextState>((resolve) =>
          setTimeout(() => resolve("running"), SLOW_MS),
        ),
      probeGitState: () =>
        new Promise<GitContextState>((resolve) => setTimeout(() => resolve("clean"), SLOW_MS)),
      probeQueueState: () =>
        new Promise<QueueContextState>((resolve) => setTimeout(() => resolve("empty"), SLOW_MS)),
    });
    // Use a 50 ms timeout so the 600 ms probes always time out.
    const ctx: MinskyContext = await gatherMinskyContext(probes, 50);
    expect(ctx.claudeState).toBe("unknown");
    expect(ctx.localLlmState).toBe("not-running");
    expect(ctx.gitState).toBe("unknown");
    expect(ctx.queueState).toBe("unknown");
    // prStats times out → safe default { open: 0, conflicting: 0 }
    expect(ctx.prStats).toEqual({ open: 0, conflicting: 0 });
  });

  it("uses safe defaults when probes reject (throw)", async () => {
    const probes = makeProbes({
      probeClaudeState: async () => {
        throw new Error("subprocess crashed");
      },
      probeGitState: async () => {
        throw new Error("git not found");
      },
    });
    const ctx: MinskyContext = await gatherMinskyContext(probes);
    expect(ctx.claudeState).toBe("unknown");
    expect(ctx.gitState).toBe("unknown");
  });
});
