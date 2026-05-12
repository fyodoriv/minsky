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
  PYTHON_CANDIDATES,
  type WhichFn,
  buildModelProbe,
  buildProductionProbes,
  buildServerProbe,
  buildServerReadinessPoll,
  buildWhichProbe,
  modelCachePath,
  probePythonWithDefaults,
  selectPythonPath,
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

// ---- buildServerProbe — slice 61: kill-0 PID liveness guard -------------

describe("buildServerProbe — slice 61: live pid → pid in result, no start-mlx-server", () => {
  it("includes pid when server unreachable but process is alive (kill-0 succeeds)", async () => {
    const fetchFn: FetchFn = async () => {
      const e = Object.assign(new Error("ECONNREFUSED"), { cause: { code: "ECONNREFUSED" } });
      throw e;
    };
    const readFileSyncFn = (_path: string, _enc: "utf8") => "99999";
    const killFn = (_pid: number, _sig: number) => {
      /* kill-0 passes — process alive */
    };
    const probe = buildServerProbe({
      fetchFn,
      serverPidPath: "/tmp/fake.pid",
      readFileSyncFn,
      killFn,
    });
    const state = await probe();
    expect(state.reachable).toBe(false);
    expect(state.pid).toBe(99999);
  });

  it("omits pid when server unreachable and process is dead (kill-0 throws ESRCH)", async () => {
    const fetchFn: FetchFn = async () => {
      const e = Object.assign(new Error("ECONNREFUSED"), { cause: { code: "ECONNREFUSED" } });
      throw e;
    };
    const readFileSyncFn = (_path: string, _enc: "utf8") => "99999";
    const killFn = (_pid: number, _sig: number) => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    };
    const probe = buildServerProbe({
      fetchFn,
      serverPidPath: "/tmp/fake.pid",
      readFileSyncFn,
      killFn,
    });
    const state = await probe();
    expect(state.reachable).toBe(false);
    expect(state.pid).toBeUndefined();
  });

  it("omits pid when serverPidPath not provided (backward compat)", async () => {
    const fetchFn: FetchFn = async () => {
      const e = Object.assign(new Error("ECONNREFUSED"), { cause: { code: "ECONNREFUSED" } });
      throw e;
    };
    const probe = buildServerProbe({ fetchFn });
    const state = await probe();
    expect(state.reachable).toBe(false);
    expect(state.pid).toBeUndefined();
  });
});

// ---- selectPythonPath / probePythonWithDefaults (slice 5) ---------------

describe("selectPythonPath — first-hit picker", () => {
  it("returns the first candidate that existsSyncFn says exists", () => {
    const existsSyncFn = (p: string) => p === "/opt/homebrew/bin/python3.13";
    const picked = selectPythonPath(
      ["/opt/homebrew/bin/python3.12", "/opt/homebrew/bin/python3.13", "/usr/bin/python3"],
      existsSyncFn,
    );
    expect(picked).toBe("/opt/homebrew/bin/python3.13");
  });

  it("returns undefined when no candidate exists", () => {
    const picked = selectPythonPath(
      ["/opt/homebrew/bin/python3.12", "/usr/local/bin/python3.13"],
      () => false,
    );
    expect(picked).toBeUndefined();
  });

  it("handles an empty candidate list", () => {
    expect(selectPythonPath([], () => true)).toBeUndefined();
  });

  it("preserves candidate order (first-match wins even when later candidates also exist)", () => {
    // If both 3.12 and 3.13 exist on the host, we pin to 3.12 — slice 1's
    // canonical choice — to stay close to the operator's validated env.
    const picked = selectPythonPath(
      ["/opt/homebrew/bin/python3.12", "/opt/homebrew/bin/python3.13"],
      () => true,
    );
    expect(picked).toBe("/opt/homebrew/bin/python3.12");
  });
});

describe("PYTHON_CANDIDATES — ordering contract", () => {
  it("lists apple-silicon-brew python3.12 before intel-brew paths", () => {
    // Operator's canonical machine is Apple Silicon + brew. Intel-brew
    // machines fall through after. See probePython JSDoc for rationale.
    const appleSilicon = PYTHON_CANDIDATES.indexOf("/opt/homebrew/bin/python3.12");
    const intelBrew = PYTHON_CANDIDATES.indexOf("/usr/local/bin/python3.12");
    expect(appleSilicon).toBeGreaterThanOrEqual(0);
    expect(intelBrew).toBeGreaterThanOrEqual(0);
    expect(appleSilicon).toBeLessThan(intelBrew);
  });

  it("includes both python3.12 and python3.13 for both brew layouts", () => {
    expect(PYTHON_CANDIDATES).toContain("/opt/homebrew/bin/python3.12");
    expect(PYTHON_CANDIDATES).toContain("/opt/homebrew/bin/python3.13");
    expect(PYTHON_CANDIDATES).toContain("/usr/local/bin/python3.12");
    expect(PYTHON_CANDIDATES).toContain("/usr/local/bin/python3.13");
  });

  it("falls through to system python3 as a last resort (graceful degrade)", () => {
    const systemPython = PYTHON_CANDIDATES.indexOf("/usr/bin/python3");
    const brewPython = PYTHON_CANDIDATES.indexOf("/opt/homebrew/bin/python3.12");
    expect(systemPython).toBeGreaterThan(brewPython);
  });
});

describe("probePythonWithDefaults — production wiring", () => {
  it("uses injected existsSyncFn and candidates", () => {
    const picked = probePythonWithDefaults({
      existsSyncFn: (p) => p === "/custom/python",
      candidates: ["/custom/python"],
    });
    expect(picked).toBe("/custom/python");
  });

  it("defaults to PYTHON_CANDIDATES when candidates is omitted", () => {
    // Stub existsSyncFn to only say yes to a known candidate; the
    // default candidate list must contain it for this to land.
    const picked = probePythonWithDefaults({
      existsSyncFn: (p) => p === "/usr/local/bin/python3.13",
    });
    expect(picked).toBe("/usr/local/bin/python3.13");
  });

  it("returns undefined when nothing exists (planner reads as pipx-default)", () => {
    const picked = probePythonWithDefaults({
      existsSyncFn: () => false,
      candidates: ["/x", "/y"],
    });
    expect(picked).toBeUndefined();
  });
});

// ---- buildProductionProbes integration ---------------------------------

describe("buildProductionProbes", () => {
  it("composes all 6 probes from the shared seams", async () => {
    const probes = buildProductionProbes({
      whichFn: async (bin) => `/usr/local/bin/${bin}`,
      existsSyncFn: () => true,
      fetchFn: async () => ({ ok: true, status: 200 }),
    });
    const [pipx, mlx, aider, huggingfaceCli, model, server] = await Promise.all([
      probes.probePipx(),
      probes.probeMlxLm(),
      probes.probeAider(),
      probes.probeHuggingfaceCli(),
      probes.probeModel(),
      probes.probeServer(),
    ]);
    expect(pipx.present).toBe(true);
    expect(mlx.present).toBe(true);
    expect(aider.present).toBe(true);
    expect(huggingfaceCli.present).toBe(true);
    expect(model.present).toBe(true);
    expect(server.reachable).toBe(true);
  });
});

// ---- H0: expectedPipxPath override (slice 7) ----------------------------

describe("buildProductionProbes — expectedPipxPath override (slice 7 H0)", () => {
  // Slice 6 ships the install plan with `/opt/homebrew/bin/pipx` as the
  // arch-correct pipx path. But slice 1's pipx probe uses `which pipx`,
  // which on an Intel-brew-on-Apple-Silicon machine resolves to
  // `/usr/local/bin/pipx` and reports `present: true`. The planner then
  // skips install-pipx, and step 2 of the plan (`/opt/homebrew/bin/pipx
  // install mlx-lm`) fails at "command not found".
  //
  // H0: when `expectedPipxPath` is set, the pipx probe checks that
  // specific path via existsSync, ignoring whichFn. This lets the
  // planner correctly detect that arch-correct pipx doesn't exist and
  // schedule install-pipx.

  it("uses existsSync on expectedPipxPath when set (returns present when path exists)", async () => {
    const probes = buildProductionProbes({
      whichFn: async () => "/usr/local/bin/pipx",
      existsSyncFn: (p) => p === "/opt/homebrew/bin/pipx",
      expectedPipxPath: "/opt/homebrew/bin/pipx",
    });
    const pipx = await probes.probePipx();
    expect(pipx.present).toBe(true);
    expect(pipx.path).toBe("/opt/homebrew/bin/pipx");
  });

  it("reports absent when expectedPipxPath is set but file doesn't exist", async () => {
    // Operator's M3 Max Rosetta scenario: whichFn returns Intel pipx,
    // but we're asking about the arm64 pipx path.
    const probes = buildProductionProbes({
      whichFn: async () => "/usr/local/bin/pipx",
      existsSyncFn: (p) => p !== "/opt/homebrew/bin/pipx",
      expectedPipxPath: "/opt/homebrew/bin/pipx",
    });
    const pipx = await probes.probePipx();
    expect(pipx.present).toBe(false);
    expect(pipx.reason).toMatch(/\/opt\/homebrew\/bin\/pipx/);
  });

  it("falls back to whichFn when expectedPipxPath is undefined (slice-6 behavior)", async () => {
    // Backward compat: no override → slice 1's `which pipx` path.
    const probes = buildProductionProbes({
      whichFn: async () => "/usr/local/bin/pipx",
      existsSyncFn: () => false,
    });
    const pipx = await probes.probePipx();
    expect(pipx.present).toBe(true);
    expect(pipx.path).toBe("/usr/local/bin/pipx");
  });

  it("does NOT affect mlxLm or aider probes (they stay on whichFn)", async () => {
    // mlx_lm.server and aider are installed by pipx into
    // ~/.local/bin/ (pipx's default PIPX_BIN_DIR) regardless of which
    // pipx instance installed them. We only need to override the pipx
    // probe itself; mlx-lm and aider stay with `which`.
    const probes = buildProductionProbes({
      whichFn: async (bin) => `/usr/local/bin/${bin}`,
      existsSyncFn: () => false,
      expectedPipxPath: "/opt/homebrew/bin/pipx",
    });
    const [mlx, aider] = await Promise.all([probes.probeMlxLm(), probes.probeAider()]);
    expect(mlx.path).toBe("/usr/local/bin/mlx_lm.server");
    expect(aider.path).toBe("/usr/local/bin/aider");
  });
});

// ---- buildServerReadinessPoll (slice 62) --------------------------------

describe("buildServerReadinessPoll — reachable on first attempt", () => {
  it("returns { reachable: true, attempts: 1 } without calling sleepFn", async () => {
    let sleptMs = 0;
    const poll = buildServerReadinessPoll({
      serverProbeFn: async () => ({ reachable: true, url: "http://127.0.0.1:8080/v1/models" }),
      sleepFn: async (ms) => {
        sleptMs += ms;
      },
    });
    const result = await poll();
    expect(result).toEqual({ reachable: true, attempts: 1 });
    expect(sleptMs).toBe(0);
  });
});

describe("buildServerReadinessPoll — reachable on Nth attempt", () => {
  it("retries until reachable and returns the correct attempt count", async () => {
    let calls = 0;
    const poll = buildServerReadinessPoll({
      serverProbeFn: async () => {
        calls += 1;
        return calls >= 3
          ? { reachable: true, url: "http://127.0.0.1:8080/v1/models" }
          : { reachable: false, url: "http://127.0.0.1:8080/v1/models", reason: "ECONNREFUSED" };
      },
      sleepFn: async () => {},
    });
    const result = await poll();
    expect(result).toEqual({ reachable: true, attempts: 3 });
  });
});

describe("buildServerReadinessPoll — chaos-table row 1: timeout exhausted", () => {
  it("returns { reachable: false, attempts: maxAttempts } when never reachable", async () => {
    const poll = buildServerReadinessPoll({
      serverProbeFn: async () => ({
        reachable: false,
        url: "http://127.0.0.1:8080/v1/models",
        reason: "ECONNREFUSED",
      }),
      maxAttempts: 3,
      sleepFn: async () => {},
    });
    const result = await poll();
    expect(result).toEqual({ reachable: false, attempts: 3 });
  });
});

describe("buildServerReadinessPoll — sleepFn called between attempts only", () => {
  it("calls sleepFn with intervalMs between each failed attempt but not after success", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const poll = buildServerReadinessPoll({
      serverProbeFn: async () => {
        calls += 1;
        // Fail attempts 1-2, succeed on attempt 3.
        return calls >= 3
          ? { reachable: true, url: "http://127.0.0.1:8080/v1/models" }
          : { reachable: false, url: "http://127.0.0.1:8080/v1/models", reason: "ECONNREFUSED" };
      },
      maxAttempts: 5,
      intervalMs: 1234,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });
    await poll();
    // Attempt 1 fails → sleep. Attempt 2 fails → sleep. Attempt 3 succeeds → no sleep.
    expect(sleeps).toEqual([1234, 1234]);
  });
});
