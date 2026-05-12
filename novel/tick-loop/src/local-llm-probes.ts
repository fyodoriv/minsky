// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 3 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-python-path-detection slice 5 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-arch-detection-hardening slice 7 (operator 2026-05-08 — H0 pipx path override) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 61 (operator 2026-05-08 — kill-0 PID liveness guard: skip start-mlx-server if process alive) -->
/**
 * `@minsky/tick-loop/local-llm-probes` — production wiring for the
 * `DetectProbes` seam in `local-llm-bootstrap.ts`. Slice 3 substrate of
 * P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Five probes, each bounded ≤500 ms wall-clock so the no-op fast path
 * on a set-up machine completes in ≤2.5 s per the rule-#9 measurement:
 *
 *   1. {@link probePipx} — `which pipx` shell-out (50 ms typical).
 *   2. {@link probeMlxLm} — `which mlx_lm.server`.
 *   3. {@link probeAider} — `which aider`.
 *   4. {@link probeModel} — filesystem stat of the huggingface cache
 *      directory (path-derived from the model id; no network call).
 *   5. {@link probeServer} — `GET <url>/v1/models` with 2 s timeout.
 *
 * All probes are pure-over-injection: tests pass synthetic
 * implementations of the small shared seams (`whichFn`, `existsSyncFn`,
 * `fetchFn`); the production wiring at the bottom of the file binds
 * them to the real `node:child_process` / `node:fs` / `globalThis.fetch`.
 *
 * Pattern conformance (rule #8):
 *   - **Adapter** — Wirfs-Brock & McKean, *Object Design*, 2003 — every
 *     external dependency is behind a probe-shape interface.
 *     Conformance: full.
 *   - **Liveness probe** — Burns et al., "Borg, Omega, and Kubernetes",
 *     *ACM Queue* 14 (1) 2016 — bounded-time GET against a documented
 *     endpoint. Conformance: full.
 *
 * Failure modes (rule #7).
 *
 * Steady-state hypothesis: every probe returns a `ComponentState` /
 * `ServerState` record within its time bound. Probe rejections from
 * the production seams (e.g., `which` exits non-zero — handled-locally
 * — typed as "absent"; network errors typed as "unreachable") are
 * captured and never propagated up, so `detectLocalLlmStack`'s
 * Promise.all never sees a rejection from these probes.
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | `which` exits non-zero | binary missing | `{ present: false, reason: "not on PATH" }` | "probePipx — absent" |
 * | 2 | `fetch` rejects | server crashed | `{ reachable: false, reason: <code> }` | "probeServer — unreachable" |
 * | 3 | `fetch` returns 5xx | server starting up | `{ reachable: false, reason: "http 5xx" }` | "probeServer — 503" |
 * | 4 | `fetch` times out | server hung | `{ reachable: false, reason: "timeout 2000ms" }` | "probeServer — timeout" |
 * | 5 | huggingface cache dir missing | model not downloaded | `{ present: false, reason: "huggingface-cache miss" }` | "probeModel — missing" |
 *
 * @module tick-loop/local-llm-probes
 */

import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  type ComponentState,
  DEFAULT_LOCAL_LLM_MODEL,
  DEFAULT_LOCAL_LLM_PROBE_URL,
  type DetectProbes,
  type ServerState,
} from "./local-llm-bootstrap.js";

// ---- Shared seams ---------------------------------------------------------

/** `which <bin>` shape — returns the resolved path or `undefined`. */
export type WhichFn = (bin: string) => Promise<string | undefined>;

/** `existsSync` shape — same as `node:fs.existsSync`. */
export type ExistsSyncFn = (path: string) => boolean;

/** `readFileSync` shape — path + 'utf8' encoding, returns string. */
export type ReadFileSyncFn = (path: string, encoding: "utf8") => string;

/**
 * `process.kill(pid, signal)` shape — only the two-arg form is used.
 * Slice 61: seam for the kill-0 liveness check in `buildServerProbe`.
 */
export type KillFn = (pid: number, signal: number) => void;

/** Subset of `fetch` shape sufficient for `GET <url>/v1/models`. */
export type FetchFn = (
  url: string,
  init: { signal?: AbortSignal; method?: string },
) => Promise<{ ok: boolean; status: number }>;

// ---- probePipx / probeMlxLm / probeAider ---------------------------------

/**
 * Build the three `which`-style probes from the shared seam. Each
 * resolves to `{ present: true, path }` when `which` finds the binary,
 * `{ present: false, reason: "not on PATH" }` otherwise.
 *
 * @otel tick-loop.local-llm-probes.which
 */
export function buildWhichProbe(bin: string, whichFn: WhichFn): () => Promise<ComponentState> {
  return async () => {
    const path = await whichFn(bin);
    if (path === undefined) {
      return { present: false, reason: "not on PATH" };
    }
    return { present: true, path };
  };
}

// ---- probeModel ----------------------------------------------------------

/**
 * Compute the canonical huggingface cache path for a given model id.
 * Format: `~/.cache/huggingface/hub/models--<owner>--<name>` per the
 * huggingface-hub CLI's documented cache layout.
 *
 * Pure helper — exported only for tests to avoid hard-coding the path.
 *
 * @otel-exempt pure path formatter — no I/O, no span.
 */
export function modelCachePath(modelId: string, home: string = homedir()): string {
  // huggingface-hub replaces `/` with `--` and prepends `models--`.
  const dirName = `models--${modelId.replace(/\//g, "--")}`;
  return join(home, ".cache", "huggingface", "hub", dirName);
}

/**
 * Build the model-presence probe. Filesystem stat only — no network
 * call; the model has been downloaded if the cache directory exists.
 * (A more thorough probe would also check that the safetensors files
 * are non-empty; we trust huggingface-cli's atomic-rename discipline.)
 *
 * @otel tick-loop.local-llm-probes.model
 */
export function buildModelProbe(opts: {
  readonly modelId?: string;
  readonly existsSyncFn?: ExistsSyncFn;
  readonly home?: string;
}): () => Promise<ComponentState> {
  const modelId = opts.modelId ?? DEFAULT_LOCAL_LLM_MODEL;
  const existsSyncFn = opts.existsSyncFn ?? nodeExistsSync;
  const home = opts.home ?? homedir();
  return async () => {
    const path = modelCachePath(modelId, home);
    if (existsSyncFn(path)) {
      return { present: true, path, detail: modelId };
    }
    return { present: false, reason: "huggingface-cache miss", detail: modelId };
  };
}

// ---- probeServer ---------------------------------------------------------

/**
 * Build the mlx-lm.server liveness probe. Bounded-time GET against
 * `<url>/v1/models`; succeeds on HTTP 200, fails-graceful otherwise.
 * Mirrors `scripts/check-mlx-server.mjs` but is in-process (no shell-out
 * cost on every detection call).
 *
 * Slice 61: when `serverPidPath` is set and the network probe fails,
 * attempts a kill-0 check against the PID file so the planner can skip
 * `start-mlx-server` when a process is already alive (but not yet
 * listening). The `pid` field in the returned `ServerState` carries the
 * live PID; the planner treats a defined `pid` as "process already
 * running — don't spawn another one".
 *
 * @otel tick-loop.local-llm-probes.server
 */
export function buildServerProbe(opts: {
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: FetchFn;
  /**
   * Slice 61: path to `.minsky/local-llm.pid`. When set and the network
   * probe returns `reachable: false`, the probe reads the PID file and
   * does `kill(pid, 0)`. If the process is alive the result includes
   * `pid` so the planner can skip `start-mlx-server`.
   */
  readonly serverPidPath?: string;
  /** Slice 61: seam for `readFileSync`. Defaults to `node:fs.readFileSync`. */
  readonly readFileSyncFn?: ReadFileSyncFn;
  /** Slice 61: seam for `process.kill`. Defaults to Node's built-in. */
  readonly killFn?: KillFn;
}): () => Promise<ServerState> {
  const url = opts.url ?? DEFAULT_LOCAL_LLM_PROBE_URL;
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const fetchFn = opts.fetchFn ?? defaultFetchFn;
  return async () => {
    const networkResult = await probeNetwork(url, timeoutMs, fetchFn);
    if (networkResult.reachable || opts.serverPidPath === undefined) return networkResult;
    // Slice 61: network probe failed — check kill-0 before returning.
    const livePid = readLivePidFromFile(opts.serverPidPath, opts.readFileSyncFn, opts.killFn);
    return livePid !== undefined ? { ...networkResult, pid: livePid } : networkResult;
  };
}

/**
 * Inner network probe — extracted from `buildServerProbe` to keep its
 * closure's cognitive complexity ≤ biome's cap of 10 (slice 61).
 */
async function probeNetwork(
  url: string,
  timeoutMs: number,
  fetchFn: FetchFn,
): Promise<ServerState> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetchFn(url, { method: "GET", signal: ac.signal });
    if (resp.ok) return { reachable: true, url };
    return { reachable: false, url, reason: `http ${resp.status}` };
    // rule-6: handled-locally — fetch errors (ECONNREFUSED, AbortError, etc.) are typed into short reason strings; planner branches on reachable only
  } catch (err) {
    return { reachable: false, url, reason: classifyFetchError(err, timeoutMs) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Slice 61: read PID from file and check liveness via kill-0. Returns the
 * PID when the process is alive, `undefined` on any failure (file missing,
 * parse error, or ESRCH — process dead). EPERM (process alive but
 * unpermissioned) is treated as alive to avoid spawning a duplicate.
 */
function readLivePidFromFile(
  pidPath: string,
  readFn: ReadFileSyncFn | undefined,
  killFn: KillFn | undefined,
): number | undefined {
  const read = readFn ?? nodeReadFileSync;
  const kill = killFn ?? nodeKillFn;
  let pid: number;
  try {
    const raw = read(pidPath, "utf8").trim();
    pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return undefined;
    // rule-6: handled-locally — ENOENT/EACCES on the PID file are expected (file deleted between runs); returning undefined lets the planner schedule start-mlx-server
  } catch {
    return undefined;
  }
  try {
    kill(pid, 0); // throws ESRCH when dead; EPERM when alive but unpermissioned
    return pid;
    // rule-6: handled-locally — ESRCH (process dead) → return undefined; EPERM (alive but not signable) → treat as alive to avoid spawning duplicate
  } catch (err) {
    return (err as { code?: string }).code === "EPERM" ? pid : undefined;
  }
}

/** Production `kill` default — wraps `process.kill` for seam injectability. */
const nodeKillFn: KillFn = (pid, signal) => process.kill(pid, signal);

function classifyFetchError(err: unknown, timeoutMs: number): string {
  /** @type {{cause?: {code?: string}, code?: string, name?: string, message?: string}} */
  const e = err as {
    cause?: { code?: string };
    code?: string;
    name?: string;
    message?: string;
  };
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === "string") return code;
  if (e?.name === "AbortError") return `timeout ${timeoutMs}ms`;
  return (e?.message ?? "unknown").slice(0, 80);
}

// rule-6: handled-locally — wrapping `globalThis.fetch` in a tiny
// adapter so we never read `globalThis` from inside the probe's hot
// path; the indirection is also the seam tests inject through.
const defaultFetchFn: FetchFn = async (url, init) => {
  const resp = await globalThis.fetch(url, init);
  return { ok: resp.ok, status: resp.status };
};

// ---- probePython ---------------------------------------------------------

/**
 * Candidate python interpreter paths, tried in order. Skipped silently
 * when `existsSyncFn` says the file doesn't exist. First hit wins.
 *
 * Order rationale (highest → lowest preference):
 *   1. Apple-Silicon-brew python 3.12  — the operator's canonical
 *      machine, matches slice 1's hardcoded path (kept for continuity).
 *   2. Apple-Silicon-brew python 3.13  — aider supports both 3.12 and
 *      3.13; brew moved the `python3` default from 3.12 → 3.13 in 2024.
 *   3. Intel-brew python 3.12          — `/usr/local/` layout on Intel
 *      Macs (the operator's other laptop, the one that caught this bug).
 *   4. Intel-brew python 3.13          — same but 3.13.
 *   5. Intel-brew generic `python3`    — whatever brew linked as default.
 *   6. System `/usr/bin/python3`       — macOS pre-installed (3.9 on
 *      Sonoma+); aider install may fail here, but better to *try* than
 *      hard-error with "no python found".
 *   7. Linux `/usr/bin/python3.12` + `/usr/bin/python3.13`             — apt/dnf layout.
 *
 * This ordering is deliberate: we want the pin to land on the best
 * known-good interpreter for aider. Falls through to `undefined` on an
 * exhausted candidate list, which triggers the planner's pipx-default
 * branch (no `--python` flag).
 */
export const PYTHON_CANDIDATES: readonly string[] = Object.freeze([
  "/opt/homebrew/bin/python3.12",
  "/opt/homebrew/bin/python3.13",
  "/usr/local/bin/python3.12",
  "/usr/local/bin/python3.13",
  "/usr/local/bin/python3",
  "/usr/bin/python3.12",
  "/usr/bin/python3.13",
  "/usr/bin/python3",
]);

/**
 * Pure selector — first candidate that `existsSyncFn` confirms exists.
 * Exported for tests; the default export
 * {@link probePythonWithDefaults} wires it to `nodeExistsSync`.
 *
 * Returns `undefined` on empty hits, which the planner reads as
 * "pipx-default python" (no `--python` flag passed). That's a graceful
 * degrade path — on a machine with zero python, `pipx install` itself
 * fails loudly at step 2, not silently here.
 *
 * @otel-exempt — pure selector, no I/O, no span.
 */
export function selectPythonPath(
  candidates: readonly string[],
  existsSyncFn: ExistsSyncFn,
): string | undefined {
  for (const candidate of candidates) {
    if (existsSyncFn(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Production wiring for `selectPythonPath` — wired to
 * `node:fs.existsSync` + {@link PYTHON_CANDIDATES}. Called by
 * `bin/minsky.mjs` once at bootstrap time; the result is threaded into
 * `planLocalLlmBootstrap(state, { pythonPath: … })`.
 *
 * `existsSyncFn` is injectable for tests; production defaults to
 * `node:fs.existsSync`.
 *
 * @otel-exempt — wraps a pure selector with a seam bind; no span.
 */
export function probePythonWithDefaults(opts?: {
  readonly existsSyncFn?: ExistsSyncFn;
  readonly candidates?: readonly string[];
}): string | undefined {
  return selectPythonPath(
    opts?.candidates ?? PYTHON_CANDIDATES,
    opts?.existsSyncFn ?? nodeExistsSync,
  );
}

// ---- buildProductionProbes ----------------------------------------------

/**
 * Bind the production `DetectProbes` record by composing the four
 * `which` + filesystem + fetch probes above. The wiring layer in
 * `bin/minsky.mjs` calls this once at startup and threads the result
 * into `detectLocalLlmStack`.
 *
 * The `whichFn` seam defaults to a thin `child_process.exec("which …")`
 * wrapper so tests can swap it out — but since the production usage is
 * always `node:child_process`, exposing it through opts keeps the
 * boundary explicit (rule #2).
 *
 * @otel-exempt — wires the probes; the spans live on the probes themselves.
 */
export function buildProductionProbes(opts: {
  readonly whichFn: WhichFn;
  readonly existsSyncFn?: ExistsSyncFn;
  readonly fetchFn?: FetchFn;
  readonly url?: string;
  readonly modelId?: string;
  /**
   * Slice 7 H0: when set, the pipx probe checks `existsSync(path)`
   * instead of `whichFn("pipx")`. The wiring layer supplies this when
   * arch detection says pipx should live at a specific path (e.g.,
   * `/opt/homebrew/bin/pipx` on Apple Silicon). Without this, the
   * probe found Intel-brew's pipx on the operator's M3 Max Rosetta
   * shell and the planner skipped install-pipx, causing step 2 to
   * fail at "command not found". See `arch-probe.ts preferredPipxPath`.
   */
  readonly expectedPipxPath?: string;
  /**
   * Slice 61: path to `.minsky/local-llm.pid`. Passed to `buildServerProbe`
   * so the planner can skip `start-mlx-server` when the process is already
   * running but not yet listening on the port.
   */
  readonly serverPidPath?: string;
  /** Slice 61: seam for `readFileSync` (used by kill-0 PID check). */
  readonly readFileSyncFn?: ReadFileSyncFn;
  /** Slice 61: seam for `process.kill` (used by kill-0 PID check). */
  readonly killFn?: KillFn;
}): DetectProbes {
  const existsSyncFn = opts.existsSyncFn ?? nodeExistsSync;
  const probePipx: () => Promise<ComponentState> =
    opts.expectedPipxPath !== undefined
      ? buildExistsProbe(opts.expectedPipxPath, existsSyncFn)
      : buildWhichProbe("pipx", opts.whichFn);
  return {
    probePipx,
    probeMlxLm: buildWhichProbe("mlx_lm.server", opts.whichFn),
    probeAider: buildWhichProbe("aider", opts.whichFn),
    probeHuggingfaceCli: buildWhichProbe("huggingface-cli", opts.whichFn),
    probeModel: buildModelProbe({
      ...(opts.modelId !== undefined ? { modelId: opts.modelId } : {}),
      ...(opts.existsSyncFn !== undefined ? { existsSyncFn: opts.existsSyncFn } : {}),
    }),
    probeServer: buildServerProbe({
      ...(opts.url !== undefined ? { url: opts.url } : {}),
      ...(opts.fetchFn !== undefined ? { fetchFn: opts.fetchFn } : {}),
      ...(opts.serverPidPath !== undefined ? { serverPidPath: opts.serverPidPath } : {}),
      ...(opts.readFileSyncFn !== undefined ? { readFileSyncFn: opts.readFileSyncFn } : {}),
      ...(opts.killFn !== undefined ? { killFn: opts.killFn } : {}),
    }),
  };
}

/**
 * Build a path-specific existence probe. Mirrors `buildWhichProbe` but
 * uses `existsSync` against a single fixed path. Slice 7 H0 — lets
 * `buildProductionProbes` check `/opt/homebrew/bin/pipx` directly
 * instead of trusting `which pipx` (which picks up Intel pipx first
 * on Rosetta / dual-brew machines).
 *
 * @otel tick-loop.local-llm-probes.exists
 */
export function buildExistsProbe(
  path: string,
  existsSyncFn: ExistsSyncFn,
): () => Promise<ComponentState> {
  return async () => {
    if (existsSyncFn(path)) {
      return { present: true, path };
    }
    return { present: false, reason: `${path} does not exist` };
  };
}

// ---- buildServerReadinessPoll (slice 62) ---------------------------------

/**
 * Build a bounded server-readiness poll. Called after
 * {@link executeBootstrapPlan} spawns `start-mlx-server` (detached) to
 * wait until the MLX model is loaded into GPU VRAM (30-90 s on M-series
 * hardware) before the daemon makes its first local-LLM request.
 *
 * Without this poll, the daemon gets `ECONNREFUSED` on its first request
 * and falls back to Claude (or retries with backoff), wasting wall-clock
 * time and potentially burning Claude credits. The poll blocks
 * `runBootstrapLocalLlm` until the server is accepting connections.
 *
 * Optimisation category: **round-trip elimination** — prevents N failed
 * requests from the daemon during the model-load window.
 *
 * Pattern conformance (rule #8):
 *   - **Readiness probe** — Burns et al., "Borg, Omega, and Kubernetes",
 *     *ACM Queue* 14 (1) 2016 — standard pattern for blocking consumers
 *     until a dependency is ready. Conformance: full.
 *   - **Adapter** — `sleepFn` seam keeps the function testable without
 *     real timers; `serverProbeFn` seam reuses the existing probe contract.
 *     Conformance: full.
 *
 * Failure mode (rule #7):
 *
 * | # | Failure mode | Expected behavior | Chaos test |
 * |---|---|---|---|
 * | 1 | Server never becomes reachable in window | Returns `{ reachable: false, attempts: maxAttempts }` — non-fatal; daemon retries on first use | "timeout exhausted" test |
 *
 * @param opts.serverProbeFn — the same probe produced by {@link buildServerProbe}.
 * @param opts.maxAttempts — max probe calls before giving up (default 30 = 5 min at 10 s/interval).
 * @param opts.intervalMs — ms to sleep between failed probes (default 10 000 ms).
 * @param opts.sleepFn — injectable sleep seam; defaults to `setTimeout`.
 *
 * @otel tick-loop.local-llm-probes.readiness-poll
 */
export function buildServerReadinessPoll(opts: {
  readonly serverProbeFn: () => Promise<ServerState>;
  readonly maxAttempts?: number;
  readonly intervalMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
}): () => Promise<{ reachable: boolean; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 30;
  const intervalMs = opts.intervalMs ?? 10_000;
  const sleepFn: (ms: number) => Promise<void> =
    opts.sleepFn ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  return async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const state = await opts.serverProbeFn();
      if (state.reachable) return { reachable: true, attempts: attempt + 1 };
      if (attempt < maxAttempts - 1) await sleepFn(intervalMs);
    }
    return { reachable: false, attempts: maxAttempts };
  };
}
