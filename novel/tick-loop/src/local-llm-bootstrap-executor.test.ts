/**
 * Paired tests for `local-llm-bootstrap-executor.ts`. Slice 2 of P0
 * task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from the executor's JSDoc:
 *   1. Operator declines confirm → `operator-declined`
 *   2. First step exits non-zero → stops at first failure
 *   3. Spawn rejects → captured as failure (no throw)
 *   4. Empty plan → `success: true, stepsRun: 0` fast path
 *   5. Non-TTY mode → runs without prompting via `confirmAlwaysYes`
 */

import { describe, expect, it, vi } from "vitest";
import {
  type ExecuteSpawnResult,
  type SpawnFn,
  confirmAlwaysNo,
  confirmAlwaysYes,
  executeBootstrapPlan,
  renderConfirmSummary,
} from "./local-llm-bootstrap-executor.js";
import type { BootstrapPlan } from "./local-llm-bootstrap.js";

// ---- Fixtures -------------------------------------------------------------

const samplePlan: BootstrapPlan = {
  ready: false,
  totalEstimatedDurationMs: 90_000,
  totalEstimatedDownloadMb: 17_500,
  steps: [
    {
      type: "install-pipx",
      description: "Install pipx",
      estimatedDurationMs: 30_000,
      command: ["brew", "install", "pipx"],
    },
    {
      type: "download-model",
      description: "Download model",
      estimatedDurationMs: 60_000,
      estimatedDownloadMb: 17_500,
      command: ["hf", "download", "x"],
    },
  ],
};

const emptyPlan: BootstrapPlan = {
  ready: true,
  totalEstimatedDurationMs: 0,
  totalEstimatedDownloadMb: 0,
  steps: [],
};

const okSpawn: SpawnFn = async (): Promise<ExecuteSpawnResult> => ({ exitCode: 0 });
const sink = (): void => {
  /* swallow */
};

// ---- chaos-table row 4: empty plan ---------------------------------------

describe("executeBootstrapPlan — chaos-table row 4: empty plan fast path", () => {
  it("returns success without prompting when plan is empty", async () => {
    const confirm = vi.fn(confirmAlwaysYes);
    const result = await executeBootstrapPlan(emptyPlan, {
      confirm,
      spawnFn: okSpawn,
      log: sink,
    });
    expect(result.success).toBe(true);
    expect(result.stepsRun).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
  });
});

// ---- chaos-table row 1: operator declines --------------------------------

describe("executeBootstrapPlan — chaos-table row 1: operator declines", () => {
  it("returns operator-declined without spawning any step", async () => {
    const spawnFn = vi.fn(okSpawn);
    const result = await executeBootstrapPlan(samplePlan, {
      confirm: confirmAlwaysNo,
      spawnFn,
      log: sink,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe("operator-declined");
    expect(result.stepsRun).toBe(0);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

// ---- chaos-table row 5: non-TTY auto-confirm -----------------------------

describe("executeBootstrapPlan — chaos-table row 5: non-TTY confirms automatically", () => {
  it("runs all steps when confirmAlwaysYes is used", async () => {
    const spawnFn = vi.fn(okSpawn);
    const result = await executeBootstrapPlan(samplePlan, {
      confirm: confirmAlwaysYes,
      spawnFn,
      log: sink,
    });
    expect(result.success).toBe(true);
    expect(result.stepsRun).toBe(2);
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });
});

// ---- chaos-table row 2: first step fails ---------------------------------

describe("executeBootstrapPlan — chaos-table row 2: first step fails", () => {
  it("stops at first non-zero exit and reports failedStep", async () => {
    let callCount = 0;
    const spawnFn: SpawnFn = async () => {
      callCount += 1;
      if (callCount === 1) {
        return { exitCode: 1, stderrTail: "brew: command not found" };
      }
      return { exitCode: 0 };
    };
    const result = await executeBootstrapPlan(samplePlan, {
      confirm: confirmAlwaysYes,
      spawnFn,
      log: sink,
    });
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("install-pipx");
    expect(result.stepsRun).toBe(1);
    expect(result.reason).toMatch(/exit code 1/);
    expect(result.reason).toMatch(/brew: command not found/);
  });
});

// ---- chaos-table row 3: spawn rejects -----------------------------------

describe("executeBootstrapPlan — chaos-table row 3: spawn rejects", () => {
  it("captures pre-spawn error (ENOENT) as a failed step (does not throw)", async () => {
    const spawnFn: SpawnFn = async () => {
      throw new Error("spawn ENOENT brew");
    };
    const result = await executeBootstrapPlan(samplePlan, {
      confirm: confirmAlwaysYes,
      spawnFn,
      log: sink,
    });
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("install-pipx");
    expect(result.reason).toMatch(/ENOENT/);
  });
});

// ---- renderConfirmSummary -----------------------------------------------

describe("renderConfirmSummary", () => {
  it("renders the empty-plan line for ready=true plans", () => {
    expect(renderConfirmSummary(emptyPlan)).toMatch(/already ready/);
  });

  it("includes the explanatory preamble + numbered steps + totals", () => {
    const out = renderConfirmSummary(samplePlan);
    expect(out).toMatch(/Claude appears to be exhausted/);
    expect(out).toMatch(/1\. Install pipx/);
    expect(out).toMatch(/2\. Download model/);
    expect(out).toMatch(/Proceed\?/);
    expect(out).toMatch(/~17\.1 GB download/);
  });

  it("omits the GB-download line when total download is zero", () => {
    const noDownloadPlan: BootstrapPlan = {
      ready: false,
      totalEstimatedDurationMs: 30_000,
      totalEstimatedDownloadMb: 0,
      steps: [
        {
          type: "start-mlx-server",
          description: "Start server",
          estimatedDurationMs: 30_000,
          command: ["mlx_lm.server"],
        },
      ],
    };
    expect(renderConfirmSummary(noDownloadPlan)).not.toMatch(/GB download/);
  });
});

// ---- log seam end-to-end -------------------------------------------------

describe("executeBootstrapPlan — log seam", () => {
  it("emits one progress line per step + tail summary", async () => {
    const lines: string[] = [];
    const log = (s: string): void => {
      lines.push(s);
    };
    await executeBootstrapPlan(samplePlan, {
      confirm: confirmAlwaysYes,
      spawnFn: okSpawn,
      log,
    });
    expect(lines.some((l) => l.includes("Install pipx"))).toBe(true);
    expect(lines.some((l) => l.includes("Download model"))).toBe(true);
    expect(lines.some((l) => l.includes("bootstrap complete"))).toBe(true);
  });
});

// ---- Empty-command-vector edge case --------------------------------------

describe("executeBootstrapPlan — empty command vector edge case", () => {
  it("captures empty argv as a failed step", async () => {
    const malformed: BootstrapPlan = {
      ready: false,
      totalEstimatedDurationMs: 0,
      totalEstimatedDownloadMb: 0,
      steps: [
        {
          type: "install-pipx",
          description: "Malformed",
          estimatedDurationMs: 0,
          command: [],
        },
      ],
    };
    const result = await executeBootstrapPlan(malformed, {
      confirm: confirmAlwaysYes,
      spawnFn: okSpawn,
      log: sink,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/empty command/);
  });
});
