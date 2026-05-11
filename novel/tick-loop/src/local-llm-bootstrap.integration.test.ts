/**
 * Integration test for the `detectLocalLlmStack` → `planLocalLlmBootstrap`
 * pipeline wired via the `buildProductionProbes` DI seams.
 *
 * Slice 51 of P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers the two scenarios from the task's Verification section:
 *   1. Fully-absent state — all `which` probes return undefined,
 *      model cache dir absent, server unreachable → 6-step plan in
 *      dependency order (no archState → no arm-homebrew step).
 *   2. Idempotent fast-path — everything present + server reachable
 *      → empty plan in O(1).
 *
 * These tests exercise the full probe→detect→plan pipeline through the
 * `whichFn` / `existsSyncFn` / `fetchFn` seams, not just the pure
 * decision functions. They catch wiring bugs that unit-only coverage
 * misses (e.g., `probeHuggingfaceCli` wired to the wrong binary name,
 * `probeModel` not threaded through `existsSyncFn`, etc.).
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_LLM_MODEL,
  detectLocalLlmStack,
  planLocalLlmBootstrap,
} from "./local-llm-bootstrap.js";
import {
  type ExistsSyncFn,
  type FetchFn,
  type WhichFn,
  buildProductionProbes,
} from "./local-llm-probes.js";

// ---- Scenario 1: fully-absent state -------------------------------------

describe("pipeline — fully-absent state → 6-step plan", () => {
  const whichFn: WhichFn = async () => undefined;
  const existsSyncFn: ExistsSyncFn = () => false;
  const fetchFn: FetchFn = async () => ({ ok: false, status: 503 });

  let state: Awaited<ReturnType<typeof detectLocalLlmStack>>;
  let plan: ReturnType<typeof planLocalLlmBootstrap>;

  it("detectLocalLlmStack assembles a fully-absent record via the seams", async () => {
    const probes = buildProductionProbes({
      whichFn,
      existsSyncFn,
      fetchFn,
    });
    state = await detectLocalLlmStack(probes);
    expect(state.pipx.present).toBe(false);
    expect(state.mlxLm.present).toBe(false);
    expect(state.aider.present).toBe(false);
    expect(state.huggingfaceCli.present).toBe(false);
    expect(state.model.present).toBe(false);
    expect(state.server.reachable).toBe(false);
  });

  it("planLocalLlmBootstrap produces a 6-step plan from the absent state", async () => {
    if (state === undefined) {
      const probes = buildProductionProbes({ whichFn, existsSyncFn, fetchFn });
      state = await detectLocalLlmStack(probes);
    }
    plan = planLocalLlmBootstrap(state);
    expect(plan.ready).toBe(false);
    expect(plan.steps.map((s) => s.type)).toEqual([
      "install-pipx",
      "install-mlx-lm",
      "install-aider",
      "install-huggingface-cli",
      "download-model",
      "start-mlx-server",
    ]);
  });

  it("plan dependency order: pipx precedes mlx-lm, aider, huggingface-cli", async () => {
    if (plan === undefined) {
      const probes = buildProductionProbes({ whichFn, existsSyncFn, fetchFn });
      state = await detectLocalLlmStack(probes);
      plan = planLocalLlmBootstrap(state);
    }
    const types = plan.steps.map((s) => s.type);
    const pipxIdx = types.indexOf("install-pipx");
    expect(pipxIdx).toBeLessThan(types.indexOf("install-mlx-lm"));
    expect(pipxIdx).toBeLessThan(types.indexOf("install-aider"));
    expect(pipxIdx).toBeLessThan(types.indexOf("install-huggingface-cli"));
  });

  it("plan dependency order: install-huggingface-cli precedes download-model", async () => {
    if (plan === undefined) {
      const probes = buildProductionProbes({ whichFn, existsSyncFn, fetchFn });
      state = await detectLocalLlmStack(probes);
      plan = planLocalLlmBootstrap(state);
    }
    const types = plan.steps.map((s) => s.type);
    expect(types.indexOf("install-huggingface-cli")).toBeLessThan(types.indexOf("download-model"));
  });

  it("download-model step uses huggingface-cli binary", async () => {
    if (plan === undefined) {
      const probes = buildProductionProbes({ whichFn, existsSyncFn, fetchFn });
      state = await detectLocalLlmStack(probes);
      plan = planLocalLlmBootstrap(state);
    }
    const downloadStep = plan.steps.find((s) => s.type === "download-model");
    expect(downloadStep?.command[0]).toBe("huggingface-cli");
    expect(downloadStep?.command).toEqual(["huggingface-cli", "download", DEFAULT_LOCAL_LLM_MODEL]);
  });

  it("start-mlx-server is the last step", async () => {
    if (plan === undefined) {
      const probes = buildProductionProbes({ whichFn, existsSyncFn, fetchFn });
      state = await detectLocalLlmStack(probes);
      plan = planLocalLlmBootstrap(state);
    }
    expect(plan.steps[plan.steps.length - 1]?.type).toBe("start-mlx-server");
  });
});

// ---- Scenario 2: idempotent fast-path -----------------------------------

describe("pipeline — idempotent fast-path → empty plan in O(1)", () => {
  const whichFn: WhichFn = async (bin) => `/usr/local/bin/${bin}`;
  const existsSyncFn: ExistsSyncFn = () => true;
  const fetchFn: FetchFn = async () => ({ ok: true, status: 200 });

  it("detectLocalLlmStack reports all components present + server reachable", async () => {
    const probes = buildProductionProbes({ whichFn, existsSyncFn, fetchFn });
    const state = await detectLocalLlmStack(probes);
    expect(state.pipx.present).toBe(true);
    expect(state.mlxLm.present).toBe(true);
    expect(state.aider.present).toBe(true);
    expect(state.huggingfaceCli.present).toBe(true);
    expect(state.model.present).toBe(true);
    expect(state.server.reachable).toBe(true);
  });

  it("planLocalLlmBootstrap returns empty plan + ready=true", async () => {
    const probes = buildProductionProbes({ whichFn, existsSyncFn, fetchFn });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);
    expect(plan.ready).toBe(true);
    expect(plan.steps).toHaveLength(0);
    expect(plan.totalEstimatedDurationMs).toBe(0);
    expect(plan.totalEstimatedDownloadMb).toBe(0);
  });
});

// ---- Scenario 3: huggingface-cli present but model absent ---------------
// Verifies the conditional install-huggingface-cli gate (slice 47):
// when huggingface-cli is already installed, the plan skips
// install-huggingface-cli and jumps straight to download-model.

describe("pipeline — huggingface-cli present, model absent → 2-step plan", () => {
  const whichFn: WhichFn = async (bin) =>
    bin === "huggingface-cli" ? "/opt/homebrew/bin/huggingface-cli" : undefined;
  const fetchFn: FetchFn = async () => ({ ok: false, status: 503 });

  it("skips install-huggingface-cli when it's already on PATH", async () => {
    const probes = buildProductionProbes({
      whichFn,
      existsSyncFn: () => false,
      fetchFn,
    });
    const state = await detectLocalLlmStack(probes);
    // huggingface-cli is present but pipx, mlx-lm, aider, model, server absent
    expect(state.huggingfaceCli.present).toBe(true);
    const plan = planLocalLlmBootstrap(state);
    expect(plan.steps.some((s) => s.type === "install-huggingface-cli")).toBe(false);
  });

  it("model-present fast-path: only start-mlx-server needed when all tools installed", async () => {
    // All tools present, model present, server not reachable → start only
    const allPresentWhich: WhichFn = async (bin) => `/usr/local/bin/${bin}`;
    const modelPresentExists: ExistsSyncFn = () => true;
    const serverDown: FetchFn = async () => ({ ok: false, status: 503 });

    const probes = buildProductionProbes({
      whichFn: allPresentWhich,
      existsSyncFn: modelPresentExists,
      fetchFn: serverDown,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);
    expect(plan.steps.map((s) => s.type)).toEqual(["start-mlx-server"]);
  });
});
