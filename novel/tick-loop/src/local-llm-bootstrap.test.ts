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
  type BootstrapPlan,
  type ComponentState,
  DEFAULT_LOCAL_LLM_MODEL,
  DEFAULT_MODEL_DOWNLOAD_MB,
  type DetectProbes,
  type LocalLlmStackState,
  type ServerState,
  detectLocalLlmStack,
  planLocalLlmBootstrap,
  planRequiresTty,
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
  huggingfaceCli: PRESENT,
  model: { ...PRESENT, detail: "17.2 GB" },
  server: REACHABLE,
};

const freshMachine: LocalLlmStackState = {
  pipx: ABSENT,
  mlxLm: ABSENT,
  aider: ABSENT,
  huggingfaceCli: ABSENT,
  model: ABSENT,
  server: UNREACHABLE,
};

const modelMissing: LocalLlmStackState = {
  pipx: PRESENT,
  mlxLm: PRESENT,
  aider: PRESENT,
  huggingfaceCli: PRESENT,
  model: ABSENT,
  server: UNREACHABLE,
};

const serverStopped: LocalLlmStackState = {
  pipx: PRESENT,
  mlxLm: PRESENT,
  aider: PRESENT,
  huggingfaceCli: PRESENT,
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
  it("returns the full 6-step plan when nothing is present", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
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
      huggingfaceCli: ABSENT,
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
      huggingfaceCli: ABSENT,
      model: ABSENT,
      server: UNREACHABLE,
    });
    expect(plan.steps.some((s) => s.type === "install-pipx")).toBe(false);
  });
});

describe("planLocalLlmBootstrap — python-path option (slice 5 fix)", () => {
  // Slice 1 hardcoded `--python /opt/homebrew/bin/python3.12` into the
  // aider install step, which broke on any machine without that exact
  // path (Intel-brew machines, Linux hosts, machines where brew only
  // has python@3.13). Slice 5 adds an optional pythonPath knob so the
  // wiring layer can pass whatever the host actually has. See
  // `BootstrapPlanOptions` JSDoc.

  it("omits --python when pythonPath is undefined (pipx-default)", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command).toEqual(["pipx", "install", "aider-chat"]);
    expect(aiderStep?.description).toMatch(/pipx-default python/);
  });

  it("omits --python when options is absent (backward-compat with slice 1 call sites)", () => {
    // Slice 1's planner took no options; any remaining call site that
    // forgets to pass options must still produce a runnable command.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- documenting shape
    const plan = planLocalLlmBootstrap(freshMachine);
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command[0]).toBe("pipx");
    expect(aiderStep?.command).not.toContain("--python");
  });

  it("pins --python when pythonPath is supplied", () => {
    const plan = planLocalLlmBootstrap(freshMachine, {
      pythonPath: "/usr/local/bin/python3.13",
    });
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command).toEqual([
      "pipx",
      "install",
      "--python",
      "/usr/local/bin/python3.13",
      "aider-chat",
    ]);
    expect(aiderStep?.description).toMatch(/\/usr\/local\/bin\/python3\.13/);
  });

  it("does not use pythonPath when aider is already installed (no-op fast path)", () => {
    // If aider is present, the install-aider step is skipped regardless
    // of what pythonPath says — the option is metadata for a step that
    // isn't scheduled.
    const plan = planLocalLlmBootstrap(
      { ...freshMachine, aider: PRESENT },
      { pythonPath: "/opt/homebrew/bin/python3.12" },
    );
    expect(plan.steps.some((s) => s.type === "install-aider")).toBe(false);
  });

  it("accepts any interpreter path shape (the planner does not validate existence)", () => {
    // Validation lives in the probe (local-llm-probes.ts probePython).
    // The planner trusts the caller — same decoupling as the rest of
    // the probe seams.
    const plan = planLocalLlmBootstrap(freshMachine, {
      pythonPath: "/nonexistent/python",
    });
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command).toContain("/nonexistent/python");
  });
});

describe("planLocalLlmBootstrap — arch-state option (slice 6 fix)", () => {
  // Slice 6: when archState is supplied AND needsNativeBrew === true,
  // the planner prepends install-arm-homebrew AND reshapes brew / pipx
  // commands to use absolute paths. When archState is undefined (slice
  // 1-5 call sites), the planner falls back to the bare-`brew`/bare-
  // `pipx` behavior (backward-compat).
  //
  // The operator's M3 Max + Rosetta shell + no `/opt/homebrew/` is the
  // live-run case that motivated this slice.
  const rosettaMissingBrew: import("./arch-probe.js").ArchState = {
    shellArch: "x86_64",
    hardwareArch: "arm64",
    nativeBrewPath: undefined,
    intelBrewPath: "/usr/local/bin/brew",
    mismatch: true,
    needsNativeBrew: true,
  };
  const nativeWithBrew: import("./arch-probe.js").ArchState = {
    shellArch: "arm64",
    hardwareArch: "arm64",
    nativeBrewPath: "/opt/homebrew/bin/brew",
    intelBrewPath: undefined,
    mismatch: false,
    needsNativeBrew: false,
  };
  const intelMac: import("./arch-probe.js").ArchState = {
    shellArch: "x86_64",
    hardwareArch: "x86_64",
    nativeBrewPath: undefined,
    intelBrewPath: "/usr/local/bin/brew",
    mismatch: false,
    needsNativeBrew: false,
  };

  it("prepends install-arm-homebrew when Apple Silicon hw has no /opt/homebrew/", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: rosettaMissingBrew });
    expect(plan.steps[0]?.type).toBe("install-arm-homebrew");
    // Next step must be install-pipx (brew is a prerequisite).
    expect(plan.steps[1]?.type).toBe("install-pipx");
  });

  it("install-arm-homebrew command wraps the installer with arch -arm64", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: rosettaMissingBrew });
    const step = plan.steps.find((s) => s.type === "install-arm-homebrew");
    expect(step?.command[0]).toBe("arch");
    expect(step?.command[1]).toBe("-arm64");
    // The shell -c arg must invoke the canonical Homebrew installer.
    const shellCmd = step?.command[step.command.length - 1];
    expect(shellCmd).toMatch(/raw\.githubusercontent\.com\/Homebrew\/install/);
    expect(shellCmd).toMatch(/NONINTERACTIVE=1/);
  });

  it("pipx step uses /opt/homebrew/bin/brew when archState says Apple Silicon", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: rosettaMissingBrew });
    const pipxStep = plan.steps.find((s) => s.type === "install-pipx");
    expect(pipxStep?.command).toEqual(["/opt/homebrew/bin/brew", "install", "pipx"]);
  });

  it("mlx-lm step uses /opt/homebrew/bin/pipx when archState says Apple Silicon", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: rosettaMissingBrew });
    const mlxStep = plan.steps.find((s) => s.type === "install-mlx-lm");
    expect(mlxStep?.command).toEqual(["/opt/homebrew/bin/pipx", "install", "mlx-lm"]);
  });

  it("aider step uses /opt/homebrew/bin/pipx + python path on Apple Silicon", () => {
    const plan = planLocalLlmBootstrap(freshMachine, {
      archState: rosettaMissingBrew,
      pythonPath: "/opt/homebrew/bin/python3.13",
    });
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command).toEqual([
      "/opt/homebrew/bin/pipx",
      "install",
      "--python",
      "/opt/homebrew/bin/python3.13",
      "aider-chat",
    ]);
  });

  it("does NOT prepend install-arm-homebrew when /opt/homebrew/ already exists", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: nativeWithBrew });
    expect(plan.steps.some((s) => s.type === "install-arm-homebrew")).toBe(false);
    // Still uses absolute /opt/homebrew/bin/brew path (arch-transparent
    // dispatch — works from any shell arch).
    const pipxStep = plan.steps.find((s) => s.type === "install-pipx");
    expect(pipxStep?.command).toEqual(["/opt/homebrew/bin/brew", "install", "pipx"]);
  });

  it("Intel Mac: no install-arm-homebrew; pipx uses /usr/local/bin/brew", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: intelMac });
    expect(plan.steps.some((s) => s.type === "install-arm-homebrew")).toBe(false);
    const pipxStep = plan.steps.find((s) => s.type === "install-pipx");
    expect(pipxStep?.command).toEqual(["/usr/local/bin/brew", "install", "pipx"]);
  });

  it("backward-compat: archState undefined → slice-1/5 bare `brew`/`pipx` commands", () => {
    // This is the slice 1-5 call-site shape. The planner must not
    // surprise existing callers with absolute paths.
    const plan = planLocalLlmBootstrap(freshMachine);
    const pipxStep = plan.steps.find((s) => s.type === "install-pipx");
    expect(pipxStep?.command).toEqual(["brew", "install", "pipx"]);
    const mlxStep = plan.steps.find((s) => s.type === "install-mlx-lm");
    expect(mlxStep?.command).toEqual(["pipx", "install", "mlx-lm"]);
  });

  it("install-arm-homebrew step has a 3-minute duration envelope", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: rosettaMissingBrew });
    const step = plan.steps.find((s) => s.type === "install-arm-homebrew");
    expect(step?.estimatedDurationMs).toBe(180_000);
    expect(step?.estimatedDownloadMb).toBeUndefined();
  });

  it("install-arm-homebrew description mentions sudo (operator awareness)", () => {
    const plan = planLocalLlmBootstrap(freshMachine, { archState: rosettaMissingBrew });
    const step = plan.steps.find((s) => s.type === "install-arm-homebrew");
    expect(step?.description).toMatch(/sudo/i);
    expect(step?.description).toMatch(/opt\/homebrew/);
  });

  it("archState-gated: idempotent fast path still applies (ready stack skips all steps)", () => {
    // Even when archState says needsNativeBrew, if the local-LLM stack
    // is already ready, we skip everything. The install-arm-homebrew
    // step is part of the bootstrap plan, not a standalone prerequisite.
    const plan = planLocalLlmBootstrap(fullyReady, { archState: rosettaMissingBrew });
    expect(plan.ready).toBe(true);
    expect(plan.steps).toHaveLength(0);
  });
});

describe("planLocalLlmBootstrap — slice 7 H1: aider uses arch-canonical python", () => {
  // Slice 7 H1: when archState indicates we'll have native brew, the
  // aider install step should use /opt/homebrew/bin/python3.13 — the
  // canonical path brew pipx installs python@3.13 to as a dependency.
  // This overrides whatever slice-5's probePythonWithDefaults picked
  // (often /usr/local/bin/python3.13 on dual-brew machines).
  const rosettaMissingBrew: import("./arch-probe.js").ArchState = {
    shellArch: "x86_64",
    hardwareArch: "arm64",
    nativeBrewPath: undefined,
    intelBrewPath: "/usr/local/bin/brew",
    mismatch: true,
    needsNativeBrew: true,
  };
  const nativeWithBrew: import("./arch-probe.js").ArchState = {
    shellArch: "arm64",
    hardwareArch: "arm64",
    nativeBrewPath: "/opt/homebrew/bin/brew",
    intelBrewPath: undefined,
    mismatch: false,
    needsNativeBrew: false,
  };
  const intelMac: import("./arch-probe.js").ArchState = {
    shellArch: "x86_64",
    hardwareArch: "x86_64",
    nativeBrewPath: undefined,
    intelBrewPath: "/usr/local/bin/brew",
    mismatch: false,
    needsNativeBrew: false,
  };

  it("arch override takes precedence over slice-5 pythonPath on Apple Silicon + needsNativeBrew", () => {
    const plan = planLocalLlmBootstrap(freshMachine, {
      archState: rosettaMissingBrew,
      // Slice-5 picked Intel brew's python. Arch override must WIN.
      pythonPath: "/usr/local/bin/python3.13",
    });
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    // The argv's --python arg must be /opt/homebrew/bin/python3.13,
    // not /usr/local/bin/python3.13.
    expect(aiderStep?.command).toEqual([
      "/opt/homebrew/bin/pipx",
      "install",
      "--python",
      "/opt/homebrew/bin/python3.13",
      "aider-chat",
    ]);
  });

  it("arch override takes precedence when native brew already exists", () => {
    const plan = planLocalLlmBootstrap(freshMachine, {
      archState: nativeWithBrew,
      pythonPath: "/usr/local/bin/python3.13", // stale / wrong
    });
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command).toContain("/opt/homebrew/bin/python3.13");
  });

  it("Intel Mac: falls through to slice-5 pythonPath (no arch override)", () => {
    const plan = planLocalLlmBootstrap(freshMachine, {
      archState: intelMac,
      pythonPath: "/usr/local/bin/python3.13",
    });
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command).toContain("/usr/local/bin/python3.13");
    expect(aiderStep?.command).not.toContain("/opt/homebrew/bin/python3.13");
  });

  it("archState undefined: falls through to slice-5 pythonPath (backward-compat)", () => {
    const plan = planLocalLlmBootstrap(freshMachine, {
      pythonPath: "/usr/local/bin/python3.13",
    });
    const aiderStep = plan.steps.find((s) => s.type === "install-aider");
    expect(aiderStep?.command).toContain("/usr/local/bin/python3.13");
  });
});

describe("planRequiresTty — slice 7 H2: non-TTY pre-flight check", () => {
  it("returns true when plan contains install-arm-homebrew", () => {
    const rosettaMissingBrew: import("./arch-probe.js").ArchState = {
      shellArch: "x86_64",
      hardwareArch: "arm64",
      nativeBrewPath: undefined,
      intelBrewPath: "/usr/local/bin/brew",
      mismatch: true,
      needsNativeBrew: true,
    };
    const plan = planLocalLlmBootstrap(freshMachine, { archState: rosettaMissingBrew });
    expect(planRequiresTty(plan)).toBe(true);
  });

  it("returns false for a slice-1/5 plan with no install-arm-homebrew step", () => {
    const plan = planLocalLlmBootstrap(freshMachine);
    expect(planRequiresTty(plan)).toBe(false);
  });

  it("returns false for an empty/ready plan", () => {
    const readyPlan: BootstrapPlan = {
      ready: true,
      steps: [],
      totalEstimatedDurationMs: 0,
      totalEstimatedDownloadMb: 0,
    };
    expect(planRequiresTty(readyPlan)).toBe(false);
  });

  it("returns false for a model-download-only plan", () => {
    const plan = planLocalLlmBootstrap(modelMissing);
    // modelMissing fixture has pipx/mlx/aider present, only model missing
    expect(plan.steps.some((s) => s.type === "install-arm-homebrew")).toBe(false);
    expect(planRequiresTty(plan)).toBe(false);
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
    expect(fullPlan.steps).toHaveLength(6);
  });
});

// ---- detectLocalLlmStack — probe orchestration ----------------------------

describe("detectLocalLlmStack — happy path", () => {
  it("runs all 5 probes in parallel and assembles the state record", async () => {
    const probes: DetectProbes = {
      probePipx: async () => PRESENT,
      probeMlxLm: async () => PRESENT,
      probeAider: async () => PRESENT,
      probeHuggingfaceCli: async () => PRESENT,
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
      probeHuggingfaceCli: async () => PRESENT,
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
    expect(out).toMatch(/4\. Install huggingface-cli/);
    expect(out).toMatch(/5\. Download mlx-community\/Qwen3-Coder-30B-A3B-Instruct-4bit/);
    expect(out).toMatch(/6\. Start mlx_lm\.server/);
    expect(out).toMatch(/~17\.1 GB download/);
  });

  it("omits the download line when no step has a download envelope (server-only plan)", () => {
    const plan = planLocalLlmBootstrap(serverStopped);
    const out = summarisePlan(plan);
    expect(out).not.toMatch(/GB download/);
  });
});
