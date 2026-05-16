import { beforeEach, describe, expect, it, vi } from "vitest";
import { maybeBootstrapLocalLlm } from "../bin/minsky.mjs";
describe("maybeBootstrapLocalLlm — DI seam", () => {
  beforeEach(() => {
    // DI-seam tests exercise internal paths that prod guards (MINSKY_NO_AUTO_BOOTSTRAP,
    // MINSKY_LOCAL_LLM) short-circuit before they can be reached. Stub them away so
    // each test verifies the intended branch, not the ambient env.
    vi.stubEnv("MINSKY_NO_AUTO_BOOTSTRAP", "");
    vi.stubEnv("MINSKY_LOCAL_LLM", "");
    vi.stubEnv("MINSKY_LLM_PROVIDER", "");
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
});
