/**
 * Paired tests for `local-llm-probes.ts` — production probe wiring for
 * the local-LLM bootstrap. Slice 3 substrate of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from the module's JSDoc:
 *   1. `which` exits non-zero → `present: false, reason: "not on PATH"`
 *   2. `fetch` rejects → `reachable: false, reason: <code>`
 *   3. `fetch` returns 5xx → `reachable: false, reason: "http 5xx"`
 *   4. `fetch` times out → `reachable: false, reason: "timeout 2000ms"`
 *   5. huggingface cache dir missing → `present: false`
 *
 * Plus the `modelCachePath` pure helper.
 */

import { describe, expect, it } from "vitest";
import {
  type FetchFn,
  type WhichFn,
  buildModelProbe,
  buildProductionProbes,
  buildServerProbe,
  buildWhichProbe,
  modelCachePath,
} from "./local-llm-probes.js";

// ---- modelCachePath -----------------------------------------------------

describe("modelCachePath", () => {
  it("formats the canonical huggingface-hub directory name", () => {
    expect(modelCachePath("mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit", "/Users/x")).toBe(
      "/Users/x/.cache/huggingface/hub/models--mlx-community--Qwen3-Coder-30B-A3B-Instruct-4bit",
    );
  });

  it("replaces every '/' in the model id with '--'", () => {
    expect(modelCachePath("a/b/c", "/h")).toBe("/h/.cache/huggingface/hub/models--a--b--c");
  });
});

// ---- buildWhichProbe — chaos-table rows 1 -------------------------------

describe("buildWhichProbe — chaos-table row 1: binary absent", () => {
  it("returns absent when whichFn resolves undefined", async () => {
    const whichFn: WhichFn = async () => undefined;
    const probe = buildWhichProbe("pipx", whichFn);
    const state = await probe();
    expect(state.present).toBe(false);
    expect(state.reason).toBe("not on PATH");
  });

  it("returns present + path when whichFn resolves a string", async () => {
    const whichFn: WhichFn = async (bin) => `/opt/homebrew/bin/${bin}`;
    const probe = buildWhichProbe("aider", whichFn);
    const state = await probe();
    expect(state.present).toBe(true);
    expect(state.path).toBe("/opt/homebrew/bin/aider");
  });
});

// ---- buildModelProbe — chaos-table row 5 -------------------------------

describe("buildModelProbe — chaos-table row 5: cache missing", () => {
  it("returns absent when the cache directory does not exist", async () => {
    const probe = buildModelProbe({
      modelId: "x/y",
      existsSyncFn: () => false,
      home: "/h",
    });
    const state = await probe();
    expect(state.present).toBe(false);
    expect(state.reason).toBe("huggingface-cache miss");
  });

  it("returns present + path when the cache directory exists", async () => {
    const probe = buildModelProbe({
      modelId: "x/y",
      existsSyncFn: () => true,
      home: "/h",
    });
    const state = await probe();
    expect(state.present).toBe(true);
    expect(state.path).toBe("/h/.cache/huggingface/hub/models--x--y");
    expect(state.detail).toBe("x/y");
  });
});

// ---- buildServerProbe — chaos-table rows 2/3/4 -------------------------

describe("buildServerProbe — chaos-table row 2: fetch rejects with code", () => {
  it("returns unreachable + reason from the error code", async () => {
    const fetchFn: FetchFn = async () => {
      const e = new Error("ECONNREFUSED 127.0.0.1:8080") as Error & {
        cause: { code: string };
      };
      e.cause = { code: "ECONNREFUSED" };
      throw e;
    };
    const probe = buildServerProbe({ fetchFn });
    const state = await probe();
    expect(state.reachable).toBe(false);
    expect(state.reason).toBe("ECONNREFUSED");
  });
});

describe("buildServerProbe — chaos-table row 3: 5xx response", () => {
  it("returns unreachable when the server returns 503", async () => {
    const fetchFn: FetchFn = async () => ({ ok: false, status: 503 });
    const probe = buildServerProbe({ fetchFn });
    const state = await probe();
    expect(state.reachable).toBe(false);
    expect(state.reason).toBe("http 503");
  });
});

describe("buildServerProbe — chaos-table row 4: AbortError", () => {
  it("returns unreachable + 'timeout Nms' on AbortError", async () => {
    const fetchFn: FetchFn = async () => {
      const e = new Error("The operation was aborted") as Error & { name: string };
      e.name = "AbortError";
      throw e;
    };
    const probe = buildServerProbe({ fetchFn, timeoutMs: 1000 });
    const state = await probe();
    expect(state.reachable).toBe(false);
    expect(state.reason).toBe("timeout 1000ms");
  });
});

describe("buildServerProbe — happy path", () => {
  it("returns reachable + url when fetch returns ok=true", async () => {
    const fetchFn: FetchFn = async () => ({ ok: true, status: 200 });
    const probe = buildServerProbe({ fetchFn, url: "http://x:1/v1/models" });
    const state = await probe();
    expect(state.reachable).toBe(true);
    expect(state.url).toBe("http://x:1/v1/models");
  });
});

// ---- buildProductionProbes integration ---------------------------------

describe("buildProductionProbes", () => {
  it("composes all 5 probes from the shared seams", async () => {
    const probes = buildProductionProbes({
      whichFn: async (bin) => `/usr/local/bin/${bin}`,
      existsSyncFn: () => true,
      fetchFn: async () => ({ ok: true, status: 200 }),
    });
    const [pipx, mlx, aider, model, server] = await Promise.all([
      probes.probePipx(),
      probes.probeMlxLm(),
      probes.probeAider(),
      probes.probeModel(),
      probes.probeServer(),
    ]);
    expect(pipx.present).toBe(true);
    expect(mlx.present).toBe(true);
    expect(aider.present).toBe(true);
    expect(model.present).toBe(true);
    expect(server.reachable).toBe(true);
  });
});
