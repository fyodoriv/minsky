// <!-- scope: human-approved minsky-cli-context-aware-ux (operator 2026-05-08) -->
/**
 * Regression test for the round-trip-elimination invariant in
 * `envOverlayForAction` (bin/minsky.mjs). Slice of P0 task
 * `minsky-cli-context-aware-ux`.
 *
 * The `start-worker-local-llm` action is only ever chosen from the
 * `claude-exhausted-with-local-stack` scenario, which `planMinskyAction`
 * reaches ONLY when the context probe already found the local-LLM server
 * reachable. The overlay MUST set `MINSKY_LOCAL_LLM=1` so the spawn's
 * `maybeBootstrapLocalLlm` early-returns at its `MINSKY_LOCAL_LLM === "1"`
 * guard rather than re-running `detectLocalLlmStack` (a redundant
 * `127.0.0.1/v1/models` fetch the context layer already performed).
 */

import { describe, expect, it } from "vitest";
import { envOverlayForAction } from "../bin/minsky.mjs";

describe("envOverlayForAction — round-trip elimination", () => {
  it("threads MINSKY_LOCAL_LLM=1 for start-worker-local-llm so the spawn skips re-probing", () => {
    const overlay = envOverlayForAction("start-worker-local-llm");
    expect(overlay).toEqual({
      MINSKY_LLM_PROVIDER: "local-preferred",
      MINSKY_LOCAL_LLM: "1",
    });
  });

  it("returns no overlay for plain start-worker (claude path stays untouched)", () => {
    expect(envOverlayForAction("start-worker")).toEqual({});
  });

  it("returns no overlay for attach/doctor/logs/stop/bootstrap actions", () => {
    for (const id of [
      "attach-worker",
      "run-doctor",
      "run-logs",
      "stop-worker",
      "bootstrap-local-llm",
    ] as const) {
      expect(envOverlayForAction(id)).toEqual({});
    }
  });
});
