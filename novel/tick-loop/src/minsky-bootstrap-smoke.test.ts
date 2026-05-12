/**
 * Smoke test for `maybeBootstrapLocalLlm` using the `_opts.detectFn` seam.
 * Slice 54 of P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Verifies the fast path: when the local-LLM server is already reachable,
 * `maybeBootstrapLocalLlm` returns the env overlay without touching the
 * production detection stack (no pipx/mlx/claude probes).
 */

import { describe, expect, it } from "vitest";
import { maybeBootstrapLocalLlm } from "../bin/minsky.mjs";
import type { LocalLlmStackState } from "./local-llm-bootstrap.js";

describe("maybeBootstrapLocalLlm", () => {
  it("returns local-LLM env overlay when server is already reachable", async () => {
    const fakeState: LocalLlmStackState = {
      pipx: { present: true, path: "/opt/homebrew/bin/pipx" },
      mlxLm: { present: true, path: "/opt/homebrew/bin/mlx_lm" },
      aider: { present: true, path: "/Users/test/.local/bin/aider" },
      model: { present: true, path: "/Users/test/.cache/huggingface/qwen3" },
      server: { reachable: true, url: "http://127.0.0.1:8080/v1/models" },
    };

    const result = await maybeBootstrapLocalLlm({ detectFn: async () => fakeState });

    expect(result).toEqual({ MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" });
  });

  it("returns empty env when detectFn reports server unreachable (no bootstrap via seam)", async () => {
    // When detectFn is provided and server is unreachable, maybeBootstrapLocalLlm
    // returns {} immediately — it does not trigger the full install pipeline
    // (the production bootstrap path requires the live Claude probe which is
    // only reached when detectFn is absent).
    const result = await maybeBootstrapLocalLlm({
      detectFn: async () => ({
        server: { reachable: false, url: "http://127.0.0.1:8080/v1/models" },
      }),
    });

    expect(result).toEqual({});
  });
});
