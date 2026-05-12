/**
 * Integration tests for `detectLocalLlmStack` → `planLocalLlmBootstrap`.
 *
 * Slice 65 of P0 task `minsky-cli-auto-bootstrap-local-llm`. Exercises the
 * full detection → planning pipeline with real fake-binary filesystem ops
 * in a controlled temp directory, satisfying the task's Verification clause:
 * "integration test on a clean /tmp/<scratch> HOME with pipx/mlx/aider/model
 * selectively missing — assert the plan covers exactly the missing pieces."
 *
 * Each test uses:
 *   - a real temp dir with fake executable stubs (chmod 755 shell scripts)
 *   - a custom whichFn that checks the temp bin dir
 *   - a custom existsSyncFn that controls model-cache presence without
 *     touching the real ~/.cache/huggingface tree
 *   - a custom fetchFn that simulates server reachable / not reachable
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_LLM_MODEL,
  detectLocalLlmStack,
  planLocalLlmBootstrap,
} from "./local-llm-bootstrap.js";
import { type FetchFn, buildProductionProbes, modelCachePath } from "./local-llm-probes.js";

// The directory the model probe checks (computed with the REAL homedir, since
// buildProductionProbes does not thread a custom home through). The custom
// existsSyncFn intercepts this path to control whether the test "sees" the model.
const MODEL_CACHE_DIR = modelCachePath(DEFAULT_LOCAL_LLM_MODEL, homedir());

// fetchFn stub that always rejects (server not running).
const serverDown: FetchFn = async () => {
  throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
};

// fetchFn stub that simulates a healthy mlx-lm.server response.
const serverUp: FetchFn = async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit" }] }),
  }) as Response;

describe("integration: detectLocalLlmStack + planLocalLlmBootstrap", () => {
  let scratchBin: string;
  let tempRoot: string;

  beforeEach(async () => {
    // Use a fixed reproducible path per test run to avoid accumulation on failure.
    tempRoot = join(
      process.env["TMPDIR"] ?? "/tmp",
      `minsky-integration-${process.pid}-${Date.now()}`,
    );
    scratchBin = join(tempRoot, "bin");
    await mkdir(scratchBin, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  /** Create a minimal fake executable in the scratch bin dir. */
  async function createFakeBin(name: string): Promise<string> {
    const p = join(scratchBin, name);
    await writeFile(p, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return p;
  }

  /** whichFn that looks only in scratchBin. */
  function makeWhichFn(): (bin: string) => Promise<string | undefined> {
    return async (bin: string) => {
      const p = join(scratchBin, bin);
      return existsSync(p) ? p : undefined;
    };
  }

  it("plans all 5 steps when nothing is installed (scratch empty, server down)", async () => {
    const state = await detectLocalLlmStack(
      buildProductionProbes({
        whichFn: makeWhichFn(),
        existsSyncFn: () => false, // model cache absent
        fetchFn: serverDown,
      }),
    );

    expect(state.pipx.present).toBe(false);
    expect(state.mlxLm.present).toBe(false);
    expect(state.aider.present).toBe(false);
    expect(state.huggingfaceCli.present).toBe(false);
    expect(state.model.present).toBe(false);
    expect(state.server.reachable).toBe(false);

    const plan = planLocalLlmBootstrap(state);
    const types = plan.steps.map((s) => s.type);
    expect(types).toContain("install-pipx");
    expect(types).toContain("install-mlx-lm");
    expect(types).toContain("install-aider");
    expect(types).toContain("install-huggingface-cli");
    expect(types).toContain("download-model");
    expect(types).toContain("start-mlx-server");
  });

  it("plans only start-mlx-server when tools + model present but server not running", async () => {
    // All four binaries present in scratch.
    await createFakeBin("pipx");
    await createFakeBin("mlx_lm.server");
    await createFakeBin("aider");
    await createFakeBin("huggingface-cli");

    const state = await detectLocalLlmStack(
      buildProductionProbes({
        whichFn: makeWhichFn(),
        existsSyncFn: (p) => p === MODEL_CACHE_DIR, // model present, nothing else
        fetchFn: serverDown,
      }),
    );

    expect(state.pipx.present).toBe(true);
    expect(state.mlxLm.present).toBe(true);
    expect(state.aider.present).toBe(true);
    expect(state.huggingfaceCli.present).toBe(true);
    expect(state.model.present).toBe(true);
    expect(state.server.reachable).toBe(false);

    const plan = planLocalLlmBootstrap(state);
    const types = plan.steps.map((s) => s.type);
    expect(types).not.toContain("install-pipx");
    expect(types).not.toContain("install-mlx-lm");
    expect(types).not.toContain("install-aider");
    expect(types).not.toContain("install-huggingface-cli");
    expect(types).not.toContain("download-model");
    expect(types).toContain("start-mlx-server");
  });

  it("returns empty plan when full stack is ready (server reachable)", async () => {
    await createFakeBin("pipx");
    await createFakeBin("mlx_lm.server");
    await createFakeBin("aider");
    await createFakeBin("huggingface-cli");

    const state = await detectLocalLlmStack(
      buildProductionProbes({
        whichFn: makeWhichFn(),
        existsSyncFn: (p) => p === MODEL_CACHE_DIR,
        fetchFn: serverUp,
      }),
    );

    expect(state.server.reachable).toBe(true);
    const plan = planLocalLlmBootstrap(state);
    expect(plan.steps).toHaveLength(0);
  });

  it("plans download-model + start-mlx-server when only model missing", async () => {
    await createFakeBin("pipx");
    await createFakeBin("mlx_lm.server");
    await createFakeBin("aider");
    await createFakeBin("huggingface-cli");

    const state = await detectLocalLlmStack(
      buildProductionProbes({
        whichFn: makeWhichFn(),
        existsSyncFn: () => false, // model absent
        fetchFn: serverDown,
      }),
    );

    expect(state.pipx.present).toBe(true);
    expect(state.mlxLm.present).toBe(true);
    expect(state.aider.present).toBe(true);
    expect(state.huggingfaceCli.present).toBe(true);
    expect(state.model.present).toBe(false);

    const plan = planLocalLlmBootstrap(state);
    const types = plan.steps.map((s) => s.type);
    expect(types).not.toContain("install-pipx");
    expect(types).not.toContain("install-mlx-lm");
    expect(types).not.toContain("install-aider");
    expect(types).not.toContain("install-huggingface-cli");
    expect(types).toContain("download-model");
    expect(types).toContain("start-mlx-server");
  });

  it("plans install-huggingface-cli + start-mlx-server when only hf-cli is missing (model cached)", async () => {
    await createFakeBin("pipx");
    await createFakeBin("mlx_lm.server");
    await createFakeBin("aider");
    // huggingface-cli intentionally absent

    const state = await detectLocalLlmStack(
      buildProductionProbes({
        whichFn: makeWhichFn(),
        existsSyncFn: (p) => p === MODEL_CACHE_DIR, // model present, nothing else
        fetchFn: serverDown,
      }),
    );

    expect(state.huggingfaceCli.present).toBe(false);
    expect(state.model.present).toBe(true);
    expect(state.pipx.present).toBe(true);

    const plan = planLocalLlmBootstrap(state);
    const types = plan.steps.map((s) => s.type);
    expect(types).not.toContain("install-pipx");
    expect(types).not.toContain("install-mlx-lm");
    expect(types).not.toContain("install-aider");
    expect(types).toContain("install-huggingface-cli");
    expect(types).not.toContain("download-model");
    expect(types).toContain("start-mlx-server");
  });

  it("plans install-aider when only aider is missing", async () => {
    await createFakeBin("pipx");
    await createFakeBin("mlx_lm.server");
    // aider NOT created
    await createFakeBin("huggingface-cli");

    const state = await detectLocalLlmStack(
      buildProductionProbes({
        whichFn: makeWhichFn(),
        existsSyncFn: (p) => p === MODEL_CACHE_DIR,
        fetchFn: serverDown,
      }),
    );

    expect(state.aider.present).toBe(false);
    expect(state.pipx.present).toBe(true);
    expect(state.mlxLm.present).toBe(true);

    const plan = planLocalLlmBootstrap(state);
    const types = plan.steps.map((s) => s.type);
    expect(types).not.toContain("install-pipx");
    expect(types).not.toContain("install-mlx-lm");
    expect(types).toContain("install-aider");
    expect(types).not.toContain("download-model");
    expect(types).toContain("start-mlx-server");
  });
});
