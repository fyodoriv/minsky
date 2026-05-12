import { afterEach, describe, expect, it, vi } from "vitest";
import { maybeBootstrapLocalLlm } from "../bin/minsky.mjs";
describe("maybeBootstrapLocalLlm — DI seam", () => {
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
});

describe("maybeBootstrapLocalLlm — bootstrapFn seam (slice 63)", () => {
  it("calls bootstrapFn and returns its env when claude probe reports hard-limit", async () => {
    const unreachableState = {
      server: { reachable: false, reason: "ECONNREFUSED" },
      pipx: { present: true },
      mlxLm: { present: true },
      aider: { present: true },
      huggingfaceCli: { present: true },
      model: { present: true },
    };
    const stubbedEnv = { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
    let bootstrapCalled = false;
    const result = await maybeBootstrapLocalLlm({
      // biome-ignore lint/suspicious/noExplicitAny: DI seam — test overrides the detection fn
      detectFn: async () => unreachableState as any,
      claudeProbeFn: async () => ({ verdict: "exhausted", reason: "stub-exhausted" }),
      bootstrapFn: async () => {
        bootstrapCalled = true;
        return stubbedEnv;
      },
    });
    expect(bootstrapCalled).toBe(true);
    expect(result).toMatchObject(stubbedEnv);
  });

  it("does NOT call bootstrapFn when claude probe reports transient-error", async () => {
    const unreachableState = {
      server: { reachable: false, reason: "ECONNREFUSED" },
      pipx: { present: true },
      mlxLm: { present: true },
      aider: { present: true },
      huggingfaceCli: { present: true },
      model: { present: true },
    };
    let bootstrapCalled = false;
    const result = await maybeBootstrapLocalLlm({
      // biome-ignore lint/suspicious/noExplicitAny: DI seam — test overrides the detection fn
      detectFn: async () => unreachableState as any,
      claudeProbeFn: async () => ({ verdict: "error", reason: "stub-transient" }),
      bootstrapFn: async () => {
        bootstrapCalled = true;
        return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
      },
    });
    expect(bootstrapCalled).toBe(false);
    expect(result).toEqual({});
  });
});

// ---- slice 64: env-var early-exit paths -----------------------------------

describe("maybeBootstrapLocalLlm — env escape hatches (slice 64)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns {} when MINSKY_NO_AUTO_BOOTSTRAP=1 without probing", async () => {
    vi.stubEnv("MINSKY_NO_AUTO_BOOTSTRAP", "1");
    let called = false;
    const result = await maybeBootstrapLocalLlm({
      bootstrapFn: async () => {
        called = true;
        return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
      },
    });
    expect(called).toBe(false);
    expect(result).toEqual({});
  });

  it("returns {} when MINSKY_LOCAL_LLM=1 (already opted in — skip re-bootstrap)", async () => {
    vi.stubEnv("MINSKY_LOCAL_LLM", "1");
    let called = false;
    const result = await maybeBootstrapLocalLlm({
      bootstrapFn: async () => {
        called = true;
        return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
      },
    });
    expect(called).toBe(false);
    expect(result).toEqual({});
  });

  it("calls bootstrapFn directly when MINSKY_LLM_PROVIDER=local-preferred (skips live probe)", async () => {
    vi.stubEnv("MINSKY_LLM_PROVIDER", "local-preferred");
    const stubbedEnv = { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
    let called = false;
    const result = await maybeBootstrapLocalLlm({
      bootstrapFn: async () => {
        called = true;
        return stubbedEnv;
      },
    });
    expect(called).toBe(true);
    expect(result).toMatchObject(stubbedEnv);
  });

  it("skips bootstrapFn when MINSKY_LLM_PROVIDER=local-preferred AND server reachable (slice 65 fast path)", async () => {
    vi.stubEnv("MINSKY_LLM_PROVIDER", "local-preferred");
    let called = false;
    const result = await maybeBootstrapLocalLlm({
      serverProbeFn: async () => ({ reachable: true, url: "http://127.0.0.1:8080/v1/models" }),
      bootstrapFn: async () => {
        called = true;
        return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
      },
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({ MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" });
  });
});

describe("maybeBootstrapLocalLlm — skip-earlier gate seam (slice 59)", () => {
  it("returns local-LLM env when serverProbeFn reports reachable (skips full detect)", async () => {
    const result = await maybeBootstrapLocalLlm({
      serverProbeFn: async () => ({ reachable: true, url: "http://127.0.0.1:8080/v1/models" }),
    });
    expect(result).toMatchObject({ MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" });
  });

  it("falls through to detectFn when serverProbeFn reports unreachable", async () => {
    const fakeState = {
      server: { reachable: true, url: "http://127.0.0.1:8080/v1/models" },
      pipx: { present: true },
      mlxLm: { present: true },
      aider: { present: true },
      huggingfaceCli: { present: true },
      model: { present: true },
    };
    const result = await maybeBootstrapLocalLlm({
      serverProbeFn: async () => ({ reachable: false, reason: "ECONNREFUSED" }),
      // biome-ignore lint/suspicious/noExplicitAny: DI seam — test overrides the detection fn
      detectFn: async () => fakeState as any,
    });
    expect(result).toMatchObject({ MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" });
  });
});
