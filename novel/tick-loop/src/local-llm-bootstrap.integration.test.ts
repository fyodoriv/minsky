/**
 * Integration tests for the local-LLM bootstrap pipeline.
 *
 * Exercises `detectLocalLlmStack` + `planLocalLlmBootstrap` end-to-end
 * through `buildProductionProbes`, using injected seams (`whichFn`,
 * `existsSyncFn`, `fetchFn`) to simulate two synthetic HOME stubs without
 * spawning processes or making network calls.
 *
 * Two scenarios per the task Verification section:
 *
 *   1. Fully-absent HOME stub — nothing installed, server unreachable,
 *      Apple Silicon Rosetta shell without /opt/homebrew/ →
 *      7-step plan: install-arm-homebrew + install-pipx + install-mlx-lm +
 *      install-aider + install-huggingface-cli + download-model +
 *      start-mlx-server, in dependency order.
 *
 *      Without archState (vanilla absent machine) → 6-step plan (no
 *      install-arm-homebrew prefix).
 *
 *   2. Idempotent fast-path HOME stub — all binaries present, HF model cache
 *      present, server reachable → empty plan + ready=true returned in O(1)
 *      (the `isStackReady` short-circuit in `planLocalLlmBootstrap`).
 */

import { describe, expect, it } from "vitest";
import type { ArchState } from "./arch-probe.js";
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

// ---- Synthetic seams --------------------------------------------------------

/** Fully-absent HOME stub: no binary on PATH, no HF cache, server unreachable. */
const absentWhich: WhichFn = async () => undefined;
const absentExists: ExistsSyncFn = () => false;
const econnrefused: FetchFn = async () => {
  const e = Object.assign(new Error("ECONNREFUSED 127.0.0.1:8080"), {
    cause: { code: "ECONNREFUSED" },
  });
  throw e;
};

/** Fully-ready HOME stub: all binaries present, HF cache present, server up. */
const readyWhich: WhichFn = async (bin) => `/usr/local/bin/${bin}`;
const readyExists: ExistsSyncFn = () => true;
const fetchOk: FetchFn = async () => ({ ok: true, status: 200 });

/**
 * Apple Silicon hardware running a Rosetta (x86_64) shell with no
 * /opt/homebrew/ present. This is the trigger for `install-arm-homebrew`
 * (slice 6 of the task).
 */
const rosettaMissingBrew: ArchState = {
  shellArch: "x86_64",
  hardwareArch: "arm64",
  nativeBrewPath: undefined,
  intelBrewPath: "/usr/local/bin/brew",
  mismatch: true,
  needsNativeBrew: true,
};

// ---- Scenario 1a: absent HOME stub, no archState → 6-step plan -------------

describe("integration — absent HOME stub, no archState: 6-step plan", () => {
  it("schedules the 6 install steps in dependency order", async () => {
    const probes = buildProductionProbes({
      whichFn: absentWhich,
      existsSyncFn: absentExists,
      fetchFn: econnrefused,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);

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

  it("plan totals include the model download envelope and positive duration", async () => {
    const probes = buildProductionProbes({
      whichFn: absentWhich,
      existsSyncFn: absentExists,
      fetchFn: econnrefused,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);

    expect(plan.totalEstimatedDownloadMb).toBeGreaterThan(0);
    expect(plan.totalEstimatedDurationMs).toBeGreaterThan(0);
    // start-mlx-server is always last
    expect(plan.steps[plan.steps.length - 1]?.type).toBe("start-mlx-server");
  });

  it("download-model step targets the pinned model id", async () => {
    const probes = buildProductionProbes({
      whichFn: absentWhich,
      existsSyncFn: absentExists,
      fetchFn: econnrefused,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);
    const downloadStep = plan.steps.find((s) => s.type === "download-model");

    expect(downloadStep?.command).toContain(DEFAULT_LOCAL_LLM_MODEL);
  });
});

// ---- Scenario 1b: absent HOME stub, Apple Silicon Rosetta → 7-step plan ----

describe("integration — absent HOME stub, Apple Silicon Rosetta: 7-step plan", () => {
  it("prepends install-arm-homebrew when needsNativeBrew=true", async () => {
    const probes = buildProductionProbes({
      whichFn: absentWhich,
      existsSyncFn: absentExists,
      fetchFn: econnrefused,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state, { archState: rosettaMissingBrew });

    expect(plan.ready).toBe(false);
    expect(plan.steps.map((s) => s.type)).toEqual([
      "install-arm-homebrew",
      "install-pipx",
      "install-mlx-lm",
      "install-aider",
      "install-huggingface-cli",
      "download-model",
      "start-mlx-server",
    ]);
  });

  it("step order is strictly dependency-aware end-to-end", async () => {
    const probes = buildProductionProbes({
      whichFn: absentWhich,
      existsSyncFn: absentExists,
      fetchFn: econnrefused,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state, { archState: rosettaMissingBrew });
    const types = plan.steps.map((s) => s.type);

    const brewIdx = types.indexOf("install-arm-homebrew");
    const pipxIdx = types.indexOf("install-pipx");
    const mlxIdx = types.indexOf("install-mlx-lm");
    const aiderIdx = types.indexOf("install-aider");
    const hfIdx = types.indexOf("install-huggingface-cli");
    const modelIdx = types.indexOf("download-model");
    const serverIdx = types.indexOf("start-mlx-server");

    expect(brewIdx).toBeLessThan(pipxIdx);
    expect(pipxIdx).toBeLessThan(mlxIdx);
    expect(pipxIdx).toBeLessThan(aiderIdx);
    expect(pipxIdx).toBeLessThan(hfIdx);
    expect(mlxIdx).toBeLessThan(modelIdx);
    expect(aiderIdx).toBeLessThan(modelIdx);
    expect(hfIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeLessThan(serverIdx);
  });

  it("install-arm-homebrew command wraps the installer with arch -arm64 + NONINTERACTIVE=1", async () => {
    const probes = buildProductionProbes({
      whichFn: absentWhich,
      existsSyncFn: absentExists,
      fetchFn: econnrefused,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state, { archState: rosettaMissingBrew });
    const brewStep = plan.steps.find((s) => s.type === "install-arm-homebrew");

    expect(brewStep?.command[0]).toBe("arch");
    expect(brewStep?.command[1]).toBe("-arm64");
    const shellCmd = brewStep?.command[brewStep.command.length - 1] ?? "";
    expect(shellCmd).toMatch(/NONINTERACTIVE=1/);
    expect(shellCmd).toMatch(/raw\.githubusercontent\.com\/Homebrew\/install/);
  });

  it("pipx step uses the arch-correct /opt/homebrew/bin/brew path", async () => {
    const probes = buildProductionProbes({
      whichFn: absentWhich,
      existsSyncFn: absentExists,
      fetchFn: econnrefused,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state, { archState: rosettaMissingBrew });
    const pipxStep = plan.steps.find((s) => s.type === "install-pipx");

    expect(pipxStep?.command).toEqual(["/opt/homebrew/bin/brew", "install", "pipx"]);
  });
});

// ---- Scenario 2: idempotent fast-path HOME stub → empty plan in O(1) -------

describe("integration — idempotent fast-path HOME stub: empty plan", () => {
  it("returns ready=true + 0 steps when all components are present and server is reachable", async () => {
    const probes = buildProductionProbes({
      whichFn: readyWhich,
      existsSyncFn: readyExists,
      fetchFn: fetchOk,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);

    expect(plan.ready).toBe(true);
    expect(plan.steps).toHaveLength(0);
    expect(plan.totalEstimatedDurationMs).toBe(0);
    expect(plan.totalEstimatedDownloadMb).toBe(0);
  });

  it("fast-path holds even when archState supplies needsNativeBrew=true (isStackReady short-circuits)", async () => {
    // Once the stack is ready, the arm-homebrew step is never scheduled
    // regardless of arch state — the planner's `isStackReady` guard runs
    // before `buildInstallSteps`.
    const probes = buildProductionProbes({
      whichFn: readyWhich,
      existsSyncFn: readyExists,
      fetchFn: fetchOk,
    });
    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state, { archState: rosettaMissingBrew });

    expect(plan.ready).toBe(true);
    expect(plan.steps).toHaveLength(0);
  });

  it("detected state record confirms all five components present + server reachable", async () => {
    const probes = buildProductionProbes({
      whichFn: readyWhich,
      existsSyncFn: readyExists,
      fetchFn: fetchOk,
    });
    const state = await detectLocalLlmStack(probes);

    expect(state.pipx.present).toBe(true);
    expect(state.mlxLm.present).toBe(true);
    expect(state.aider.present).toBe(true);
    expect(state.huggingfaceCli.present).toBe(true);
    expect(state.model.present).toBe(true);
    expect(state.server.reachable).toBe(true);
  });
});
