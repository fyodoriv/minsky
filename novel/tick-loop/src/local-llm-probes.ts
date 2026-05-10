// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 3 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-python-path-detection slice 5 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-arch-detection-hardening slice 7 (operator 2026-05-08 — H0 pipx path override) -->
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

import { existsSync as nodeExistsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
 * @otel tick-loop.local-llm-probes.server
 */
export function buildServerProbe(opts: {
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: FetchFn;
}): () => Promise<ServerState> {
  const url = opts.url ?? DEFAULT_LOCAL_LLM_PROBE_URL;
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const fetchFn = opts.fetchFn ?? defaultFetchFn;
  return async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetchFn(url, { method: "GET", signal: ac.signal });
      if (resp.ok) {
        return { reachable: true, url };
      }
      return { reachable: false, url, reason: `http ${resp.status}` };
      // rule-6: handled-locally — typed fetch errors into short reason; planner only branches on reachable.
    } catch (err) {
      const reason = classifyFetchError(err, timeoutMs);
      return { reachable: false, url, reason };
    } finally {
      clearTimeout(timer);
    }
  };
}

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
   * Slice 19: when set AND `url` is undefined, the server probe URL is
   * built as `http://127.0.0.1:<port>/v1/models` instead of the default
   * 8080 URL. Lets the operator's `--port=<n>` flag detect a server
   * already running on the chosen port (idempotent fast path) so the
   * planner can skip the `start-mlx-server` step. Explicit `url` still
   * wins to preserve slice-1 callers' behavior.
   */
  readonly port?: number;
}): DetectProbes {
  const existsSyncFn = opts.existsSyncFn ?? nodeExistsSync;
  const probePipx: () => Promise<ComponentState> =
    opts.expectedPipxPath !== undefined
      ? buildExistsProbe(opts.expectedPipxPath, existsSyncFn)
      : buildWhichProbe("pipx", opts.whichFn);
  const serverUrl =
    opts.url ?? (opts.port !== undefined ? `http://127.0.0.1:${opts.port}/v1/models` : undefined);
  return {
    probePipx,
    probeMlxLm: buildWhichProbe("mlx_lm.server", opts.whichFn),
    probeAider: buildWhichProbe("aider", opts.whichFn),
    probeModel: buildModelProbe({
      ...(opts.modelId !== undefined ? { modelId: opts.modelId } : {}),
      ...(opts.existsSyncFn !== undefined ? { existsSyncFn: opts.existsSyncFn } : {}),
    }),
    probeServer: buildServerProbe({
      ...(serverUrl !== undefined ? { url: serverUrl } : {}),
      ...(opts.fetchFn !== undefined ? { fetchFn: opts.fetchFn } : {}),
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
