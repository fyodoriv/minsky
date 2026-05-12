// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 57 (operator 2026-05-08) -->
/**
 * Integration tests for `detectLocalLlmStack` + `planLocalLlmBootstrap`
 * using a real temp filesystem for the model-cache probe.
 *
 * Addresses the Verification requirement from TASKS.md:
 *   "integration test on a clean /tmp/<scratch> HOME with pipx/mlx/aider/model
 *   selectively missing — assert the plan covers exactly the missing pieces."
 *
 * Design: the model probe uses the REAL `node:fs.existsSync` against a
 * directory created by `mkdtempSync`. Binary probes and the server probe
 * use injected mock seams (same technique as the unit tests). This makes
 * the model-detection path an authentic filesystem integration while
 * keeping the test hermetic — no binaries need to be installed and no
 * network calls are made.
 *
 * Pattern conformance (rule #8):
 *   - **Partial integration test** — Fowler, *Refactoring*, 2018 — isolate
 *     the I/O seam under test (real filesystem) while keeping unrelated I/O
 *     (network, subprocess) behind mocks. Conformance: full.
 *   - **Fixture-based setup/teardown** — xUnit Patterns, Meszaros 2007 —
 *     `beforeEach` creates a fresh temp dir; `afterEach` removes it.
 *     Conformance: full.
 *
 * Failure modes (rule #7).
 *
 * | # | Failure mode | Expected behavior |
 * |---|---|---|
 * | 1 | `mkdtempSync` fails (disk full) | test fails with OS error (acceptable — the test has no value on a full disk) |
 * | 2 | `rmSync` fails in afterEach | test passes but leaks temp dir (acceptable tradeoff — no test should block on cleanup) |
 * | 3 | model dir present but empty | probe returns `{ present: true }` (huggingface-cli creates the dir before writing; probe trusts dir existence per production contract) |
 *
 * @module tick-loop/local-llm-bootstrap-integration.test
 */

import { mkdirSync, mkdtempSync, existsSync as nodeExistsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_LLM_MODEL,
  detectLocalLlmStack,
  planLocalLlmBootstrap,
} from "./local-llm-bootstrap.js";
import {
  type FetchFn,
  type WhichFn,
  buildModelProbe,
  buildServerProbe,
  buildWhichProbe,
  modelCachePath,
} from "./local-llm-probes.js";

// ---- Shared test helpers -----------------------------------------------

/**
 * Build the five detection probes for integration tests. The model probe
 * uses the REAL `nodeExistsSync` pointed at `tempHome` — this is the
 * seam under integration test. The binary and server probes remain mocked
 * (injected) to keep the test hermetic.
 */
function buildIntegrationProbes(opts: {
  readonly whichFn: WhichFn;
  readonly fetchFn: FetchFn;
  readonly tempHome: string;
}) {
  return {
    probePipx: buildWhichProbe("pipx", opts.whichFn),
    probeMlxLm: buildWhichProbe("mlx_lm.server", opts.whichFn),
    probeAider: buildWhichProbe("aider", opts.whichFn),
    probeModel: buildModelProbe({ existsSyncFn: nodeExistsSync, home: opts.tempHome }),
    probeServer: buildServerProbe({ fetchFn: opts.fetchFn }),
  };
}

/** Returns the path as-if installed — all three binaries "present". */
const allBinariesPresent: WhichFn = async (bin) => `/usr/local/bin/${bin}`;
/** Simulates an empty PATH — all binaries "absent". */
const allBinariesAbsent: WhichFn = async () => undefined;
/** Server responds with HTTP 200. */
const serverUp: FetchFn = async () => ({ ok: true, status: 200 });
/** Server is not reachable (503 / connection refused). */
const serverDown: FetchFn = async () => ({ ok: false, status: 503 });

// ---- Integration tests --------------------------------------------------

describe("integration: detect + plan — real temp-HOME model probe, 4 scenarios", () => {
  let tempHome: string;

  beforeEach(() => {
    // Each test gets a fresh, empty temp directory as its HOME.
    tempHome = mkdtempSync(join(tmpdir(), "minsky-integration-test-"));
  });

  afterEach(() => {
    // Best-effort cleanup — failure is acceptable (test outcome is unchanged).
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // intentional no-op on cleanup failure
    }
  });

  it("scenario A (fresh machine): all 5 components absent → full 5-step plan", async () => {
    // Model directory does NOT exist in tempHome (created fresh by beforeEach).
    const probes = buildIntegrationProbes({
      whichFn: allBinariesAbsent,
      fetchFn: serverDown,
      tempHome,
    });

    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);

    expect(plan.ready).toBe(false);
    expect(plan.steps.map((s) => s.type)).toEqual([
      "install-pipx",
      "install-mlx-lm",
      "install-aider",
      "download-model",
      "start-mlx-server",
    ]);
  });

  it("scenario B (model missing): real FS probe returns absent → plan includes download", async () => {
    // Binaries present, server down, but model dir NOT created.
    const probes = buildIntegrationProbes({
      whichFn: allBinariesPresent,
      fetchFn: serverDown,
      tempHome,
    });

    const state = await detectLocalLlmStack(probes);
    expect(state.model.present).toBe(false);

    const plan = planLocalLlmBootstrap(state);
    expect(plan.ready).toBe(false);
    expect(plan.steps.map((s) => s.type)).toEqual(["download-model", "start-mlx-server"]);
  });

  it("scenario C (model present, server down): real FS dir → probe present → plan starts server only", async () => {
    // Create the model cache directory in the real temp filesystem.
    const modelDir = modelCachePath(DEFAULT_LOCAL_LLM_MODEL, tempHome);
    mkdirSync(modelDir, { recursive: true });

    const probes = buildIntegrationProbes({
      whichFn: allBinariesPresent,
      fetchFn: serverDown,
      tempHome,
    });

    const state = await detectLocalLlmStack(probes);
    // Integration assertion: real nodeExistsSync sees the directory we just created.
    expect(state.model.present).toBe(true);
    expect(state.model).toMatchObject({ path: modelDir });

    const plan = planLocalLlmBootstrap(state);
    expect(plan.ready).toBe(false);
    expect(plan.steps.map((s) => s.type)).toEqual(["start-mlx-server"]);
  });

  it("scenario D (fully ready): model dir present + server reachable → empty plan", async () => {
    mkdirSync(modelCachePath(DEFAULT_LOCAL_LLM_MODEL, tempHome), { recursive: true });

    const probes = buildIntegrationProbes({
      whichFn: allBinariesPresent,
      fetchFn: serverUp,
      tempHome,
    });

    const state = await detectLocalLlmStack(probes);
    const plan = planLocalLlmBootstrap(state);

    expect(plan.ready).toBe(true);
    expect(plan.steps).toHaveLength(0);
  });
});

describe("integration: modelCachePath → real filesystem interaction", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "minsky-integration-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // intentional no-op
    }
  });

  it("creates the exact huggingface cache path format that the probe expects", () => {
    const modelDir = modelCachePath(DEFAULT_LOCAL_LLM_MODEL, tempHome);
    const expected = join(
      tempHome,
      ".cache",
      "huggingface",
      "hub",
      "models--mlx-community--Qwen3-Coder-30B-A3B-Instruct-4bit",
    );
    expect(modelDir).toBe(expected);
    // Create + verify (real FS round-trip)
    mkdirSync(modelDir, { recursive: true });
    expect(nodeExistsSync(modelDir)).toBe(true);
  });

  it("model absent in fresh temp dir → probe returns absent", async () => {
    const probe = buildModelProbe({ existsSyncFn: nodeExistsSync, home: tempHome });
    const state = await probe();
    expect(state.present).toBe(false);
    if (!state.present) {
      expect(state.reason).toBe("huggingface-cache miss");
    }
  });

  it("model present in real temp dir → probe returns present with correct path", async () => {
    const modelDir = modelCachePath(DEFAULT_LOCAL_LLM_MODEL, tempHome);
    mkdirSync(modelDir, { recursive: true });

    const probe = buildModelProbe({ existsSyncFn: nodeExistsSync, home: tempHome });
    const state = await probe();
    expect(state.present).toBe(true);
    if (state.present) {
      expect(state.path).toBe(modelDir);
    }
  });
});
