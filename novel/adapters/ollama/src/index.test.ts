import { describe, expect, it } from "vitest";

import type { LoadedModel } from "./index.js";
import { StubOllama } from "./index.js";

describe("StubOllama — recording & default responses", () => {
  it("records warm calls with default keep_alive 30m", async () => {
    const stub = new StubOllama();
    const result = await stub.warm("qwen3-coder:30b");
    expect(result).toEqual({ ok: true });
    expect(stub.calls).toEqual([{ op: "warm", modelId: "qwen3-coder:30b", keepAlive: "30m" }]);
  });

  it("records warm calls with explicit keep_alive", async () => {
    const stub = new StubOllama();
    await stub.warm("qwen3-coder:30b", "1h");
    expect(stub.calls[0]).toEqual({ op: "warm", modelId: "qwen3-coder:30b", keepAlive: "1h" });
  });

  it("records unload calls", async () => {
    const stub = new StubOllama();
    const result = await stub.unload("qwen3-coder:30b");
    expect(result).toEqual({ ok: true });
    expect(stub.calls).toEqual([{ op: "unload", modelId: "qwen3-coder:30b" }]);
  });

  it("returns the configured ps fixture and records the call", async () => {
    const fixture: LoadedModel[] = [
      {
        name: "qwen3-coder:30b",
        size: 45_157_287_968,
        sizeVram: 45_157_287_968,
        expiresAt: "2026-05-29T09:30:00Z",
      },
    ];
    const stub = new StubOllama({ psFixture: fixture });
    const result = await stub.ps();
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(fixture);
    expect(stub.calls).toEqual([{ op: "ps" }]);
  });

  it("returns an empty model list when no fixture is configured", async () => {
    const stub = new StubOllama();
    const result = await stub.ps();
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([]);
  });

  it("reset() clears recorded calls", async () => {
    const stub = new StubOllama();
    await stub.warm("qwen3-coder:30b");
    await stub.unload("qwen3-coder:30b");
    expect(stub.calls).toHaveLength(2);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
  });

  it("selfTest always returns green for the stub", async () => {
    const stub = new StubOllama();
    const result = await stub.selfTest();
    expect(result.status).toBe("green");
    expect(result.latencyMs).toBe(0);
  });

  it("preserves call order across mixed operations", async () => {
    const stub = new StubOllama();
    await stub.warm("qwen3-coder:30b");
    await stub.ps();
    await stub.unload("qwen3-coder:30b");
    expect(stub.calls.map((c) => c.op)).toEqual(["warm", "ps", "unload"]);
  });
});
