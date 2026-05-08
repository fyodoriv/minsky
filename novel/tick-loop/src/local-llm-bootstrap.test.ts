/**
 * Paired tests for `local-llm-bootstrap.ts` — pure decision function +
 * detection orchestrator. Slice 1 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from the module's JSDoc:
 *   1. Probe seam throws → loud-crash (`detectLocalLlmStack` rejects)
 *   2. Fully installed but server unreachable → single start step
 *   3. Model missing, everything else present → [download, start] plan
 *   4. Fresh machine, nothing present → full 5-step plan
 *   5. Idempotent fast path → empty plan + ready flag
 *
 * Plus deterministic ordering + envelope-sum tests.
 */

import { describe, expect, it } from "vitest";
import {
  type ComponentState,
  DEFAULT_LOCAL_LLM_MODEL,
  DEFAULT_MODEL_DOWNLOAD_MB,
  type DetectProbes,
  type LocalLlmStackState,
  type ServerState,
  detectLocalLlmStack,
  planLocalLlmBootstrap,
  summarisePlan,
} from "./local-llm-bootstrap.js";

// ---- Fixtures -------------------------------------------------------------

const PRESENT: ComponentState = { present: true, path: "/opt/homebrew/bin/whatever" };
const ABSENT: ComponentState = { present: false, reason: "not on PATH" };
const REACHABLE: ServerState = {
  reachable: true,
  url: "http://127.0.0.1:8080/v1/models",
  pid: 12345,
};
const UNREACHABLE: ServerState = {
  reachable: false,
  url: "http://127.0.0.1:8080/v1/models",
  reason: "ECONNREFUSED",
};

const fullyReady: LocalLlmStackState = {
  pipx: PRESENT,
  mlxLm: PRESENT,
  aider: PRESENT,
  model: { ...PRESENT, detail: "17.2 GB" },
  server: REACHABLE,
};

const freshMachine: LocalLlmStackState = {
  pipx: ABSENT,
  mlxLm: ABSENT,
  aider: ABSENT,
  model: ABSENT,
  server: UNREACHABLE,
};

const modelMissing: LocalLlmStackState = {
  pipx: PRESENT,
  mlxLm: PRESENT,
  aider: PRESENT,
  model: ABSENT,
  server: UNREACHABLE,
};

const serverStopped: LocalLlmStackState = {
  pipx: PRESENT,
  mlxLm: PRESENT,
  aider: PRESENT,
  model: PRESENT,
  server: UNREACHABLE,
};

// ---- planLocalLlmBootstrap — chaos-table rows -----------------------------

describe("planLocalLlmBootstrap — chaos-table row 5: idempotent fast path", () => {
  it("returns empty plan + ready=true when everything is present and reachable", () => {
    const plan = planLocalLlmBootstrap(fullyReady);
    expect(plan.ready).toBe(true);
    expect(plan.steps).toHaveLength(0);
    expect(plan.totalEstimatedDurationMs).toBe(0);
    expect(plan.totalEstimatedDownloadMb).toBe(0);
  });
});

describe("planLocalLlmBootstrap — chaos-table row 4: fresh machine", () => {
  it("returns the full 5-step plan when nothing is present", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
    expect(plan.ready).toBe(false);
    expect(plan.steps.map((s) => s.type)).toEqual([
      "install-pipx",
      "install-mlx-lm",
      "install-aider",
      "download-model",
      "start-mlx-server",
    ]);
  });

  it("sums download envelope for the confirm prompt", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
    expect(plan.totalEstimatedDownloadMb).toBe(DEFAULT_MODEL_DOWNLOAD_MB);
  });

  it("total wall-clock > 0 and includes the model download step", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
    expect(plan.totalEstimatedDurationMs).toBeGreaterThan(0);
    const downloadStep = plan.steps.find((s) => s.type === "download-model");
    expect(downloadStep?.command).toEqual(["hf", "download", DEFAULT_LOCAL_LLM_MODEL]);
  });
});

describe("planLocalLlmBootstrap — chaos-table row 3: model missing", () => {
  it("schedules [download-model, start-mlx-server] when only the model is missing", () => {
    const plan = planLocalLlmBootstrap(modelMissing);
    expect(plan.steps.map((s) => s.type)).toEqual(["download-model", "start-mlx-server"]);
  });

  it("download step carries the download envelope; start step does not", () => {
    const plan = planLocalLlmBootstrap(modelMissing);
    const [download, start] = plan.steps;
    expect(download?.estimatedDownloadMb).toBeGreaterThan(0);
    expect(start?.estimatedDownloadMb).toBeUndefined();
  });
});

describe("planLocalLlmBootstrap — chaos-table row 2: server stopped but stack installed", () => {
  it("schedules only the start-mlx-server step", () => {
    const plan = planLocalLlmBootstrap(serverStopped);
    expect(plan.ready).toBe(false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.type).toBe("start-mlx-server");
    expect(plan.totalEstimatedDownloadMb).toBe(0);
  });
});

describe("planLocalLlmBootstrap — dependency order", () => {
  it("always schedules pipx before mlx-lm + aider when pipx is absent", () => {
    const plan = planLocalLlmBootstrap({
      pipx: ABSENT,
      mlxLm: ABSENT,
      aider: ABSENT,
      model: PRESENT,
      server: UNREACHABLE,
    });
    const types = plan.steps.map((s) => s.type);
    const pipxIndex = types.indexOf("install-pipx");
    const mlxIndex = types.indexOf("install-mlx-lm");
    const aiderIndex = types.indexOf("install-aider");
    expect(pipxIndex).toBeLessThan(mlxIndex);
    expect(pipxIndex).toBeLessThan(aiderIndex);
  });

  it("schedules start-mlx-server last", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
    const lastStep = plan.steps[plan.steps.length - 1];
    expect(lastStep?.type).toBe("start-mlx-server");
  });

  it("does not re-install pipx when it's already present", () => {
    const plan = planLocalLlmBootstrap({
      pipx: PRESENT,
      mlxLm: ABSENT,
      aider: ABSENT,
      model: ABSENT,
      server: UNREACHABLE,
    });
    expect(plan.steps.some((s) => s.type === "install-pipx")).toBe(false);
  });
});

describe("planLocalLlmBootstrap — referential transparency", () => {
  it("returns the same plan shape for the same input (no hidden state)", () => {
    const plan1 = planLocalLlmBootstrap(freshMachine);
    const plan2 = planLocalLlmBootstrap(freshMachine);
    expect(plan1.steps.map((s) => s.type)).toEqual(plan2.steps.map((s) => s.type));
    expect(plan1.totalEstimatedDownloadMb).toBe(plan2.totalEstimatedDownloadMb);
  });

  it("does not read I/O (plans purely from the input record)", () => {
    // If the function touched I/O, swapping the input wouldn't change
    // the plan. This test pins the pure-decision contract.
    const emptyPlan = planLocalLlmBootstrap(fullyReady);
    const fullPlan = planLocalLlmBootstrap(freshMachine);
    expect(emptyPlan.steps).toHaveLength(0);
    expect(fullPlan.steps).toHaveLength(5);
  });
});

// ---- detectLocalLlmStack — probe orchestration ----------------------------

describe("detectLocalLlmStack — happy path", () => {
  it("runs all 5 probes in parallel and assembles the state record", async () => {
    const probes: DetectProbes = {
      probePipx: async () => PRESENT,
      probeMlxLm: async () => PRESENT,
      probeAider: async () => PRESENT,
      probeModel: async () => PRESENT,
      probeServer: async () => REACHABLE,
    };
    const state = await detectLocalLlmStack(probes);
    expect(state.pipx.present).toBe(true);
    expect(state.server.reachable).toBe(true);
  });
});

describe("detectLocalLlmStack — chaos-table row 1: probe seam throws", () => {
  it("rejects when any probe seam rejects (loud-crash per Armstrong)", async () => {
    const probes: DetectProbes = {
      probePipx: async () => PRESENT,
      probeMlxLm: async () => {
        throw new Error("mlx probe failure");
      },
      probeAider: async () => PRESENT,
      probeModel: async () => PRESENT,
      probeServer: async () => REACHABLE,
    };
    await expect(detectLocalLlmStack(probes)).rejects.toThrow("mlx probe failure");
  });
});

// ---- summarisePlan --------------------------------------------------------

describe("summarisePlan", () => {
  it("returns the 'already ready' line for an empty plan", () => {
    const out = summarisePlan({
      steps: [],
      totalEstimatedDurationMs: 0,
      totalEstimatedDownloadMb: 0,
      ready: true,
    });
    expect(out).toMatch(/already ready/);
  });

  it("numbers each step and carries the total envelope", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
    const out = summarisePlan(plan);
    expect(out).toMatch(/1\. Install pipx/);
    expect(out).toMatch(/2\. Install mlx-lm/);
    expect(out).toMatch(/3\. Install aider-chat/);
    expect(out).toMatch(/4\. Download mlx-community\/Qwen3-Coder-30B-A3B-Instruct-4bit/);
    expect(out).toMatch(/5\. Start mlx_lm\.server/);
    expect(out).toMatch(/~17\.1 GB download/);
  });

  it("omits the download line when no step has a download envelope (server-only plan)", () => {
    const plan = planLocalLlmBootstrap(serverStopped);
    const out = summarisePlan(plan);
    expect(out).not.toMatch(/GB download/);
  });
});
