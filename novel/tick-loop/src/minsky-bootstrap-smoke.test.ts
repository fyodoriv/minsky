import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeBootstrapLocalLlm } from "../bin/minsky.mjs";
describe("maybeBootstrapLocalLlm — DI seam", () => {
  // Sandbox the LLM-provider env so the DI-seam assertions test the seam,
  // not the ambient process env. Daemon workers export
  // MINSKY_LLM_PROVIDER=local-preferred / claude-only (see
  // `local-preferred-daemon-env-vars`); without this stub these tests
  // fail when the suite runs inside a daemon-spawned worker (the very
  // process the pre-push hook runs in). vi.stubEnv(name, undefined) is
  // the documented in-file pattern (biome `noDelete` forbids `delete`;
  // `= undefined` coerces to the string "undefined" in Node).
  beforeEach(() => {
    vi.stubEnv("MINSKY_LLM_PROVIDER", undefined);
    vi.stubEnv("MINSKY_LOCAL_LLM", undefined);
    vi.stubEnv("MINSKY_NO_AUTO_BOOTSTRAP", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns local-LLM env when detectFn reports server reachable", async () => {
    const fakeState = {
      server: { reachable: true, url: "http://127.0.0.1:1234" },
      pipx: { present: true },
      mlxLm: { present: true },
      aider: { present: true },
      huggingfaceCli: { present: true },
      model: { present: true },
    };
    const result = await maybeBootstrapLocalLlm({
      // biome-ignore lint/suspicious/noExplicitAny: DI seam — test overrides the detection fn
      detectFn: async () => fakeState as any,
    });
    expect(result).toMatchObject({ MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" });
  });

  it("returns empty env when detectFn reports server unreachable and claude probe reports healthy", async () => {
    const fakeState = {
      server: { reachable: false, reason: "connection refused" },
      pipx: { present: true },
      mlxLm: { present: true },
      aider: { present: true },
      huggingfaceCli: { present: true },
      model: { present: true },
    };
    const result = await maybeBootstrapLocalLlm({
      // biome-ignore lint/suspicious/noExplicitAny: DI seam — test overrides the detection fn
      detectFn: async () => fakeState as any,
      claudeProbeFn: async () => ({ verdict: "healthy", reason: "stub-healthy" }),
    });
    expect(result).toEqual({});
  });

  it("calls bootstrapFn and returns its result when claude probe reports hard-limit", async () => {
    // Slice 60: bootstrapFn seam lets tests verify the install-trigger path
    // without running a real 17 GB bootstrap. The sentinel value proves the
    // result flows through from bootstrapFn unchanged.
    const fakeState = {
      server: { reachable: false, reason: "connection refused" },
      pipx: { present: true },
      mlxLm: { present: true },
      aider: { present: true },
      huggingfaceCli: { present: true },
      model: { present: true },
    };
    const sentinel = { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
    let bootstrapCalled = false;
    const result = await maybeBootstrapLocalLlm({
      // biome-ignore lint/suspicious/noExplicitAny: DI seam — test overrides the detection fn
      detectFn: async () => fakeState as any,
      claudeProbeFn: async () => ({ verdict: "exhausted", reason: "stub-exhausted" }),
      bootstrapFn: async () => {
        bootstrapCalled = true;
        return sentinel;
      },
    });
    expect(bootstrapCalled).toBe(true);
    expect(result).toBe(sentinel);
  });

  it("Slice C: MINSKY_LLM_PROVIDER=claude-only is honored — skips local pre-flight even when server reachable", async () => {
    // vi.stubEnv (not `delete process.env`): biome `noDelete` forbids the
    // delete operator, and `process.env.X = undefined` is wrong in Node
    // (coerces to the string "undefined"). stubEnv(name, undefined)
    // deletes the var and unstubAllEnvs() restores the originals.
    vi.stubEnv("MINSKY_LLM_PROVIDER", "claude-only");
    vi.stubEnv("MINSKY_NO_AUTO_BOOTSTRAP", undefined);
    vi.stubEnv("MINSKY_LOCAL_LLM", undefined);
    try {
      let detectCalled = false;
      let bootstrapCalled = false;
      let probeCalled = false;
      const result = await maybeBootstrapLocalLlm({
        detectFn: async () => {
          detectCalled = true;
          // biome-ignore lint/suspicious/noExplicitAny: DI seam — bugged path (reachable server) must NOT be reached
          return { server: { reachable: true, url: "http://127.0.0.1:1234" } } as any;
        },
        bootstrapFn: async () => {
          bootstrapCalled = true;
          return { sentinel: "should-not-run" };
        },
        claudeProbeFn: async () => {
          probeCalled = true;
          return { verdict: "healthy", reason: "should-not-run" };
        },
      });
      expect(result).toEqual({ MINSKY_LLM_PROVIDER: "claude-only" });
      expect(detectCalled).toBe(false);
      expect(bootstrapCalled).toBe(false);
      expect(probeCalled).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
