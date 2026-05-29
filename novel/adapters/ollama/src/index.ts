/**
 * Ollama adapter — interface (Adapter pattern, Gamma 1994) over the
 * local Ollama daemon's HTTP API, plus a `StubOllama` test fake
 * (Meszaros 2007) and an `HttpOllama` HTTP Strategy (sibling file
 * `./http.ts`).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral)
 *                            per Gamma, Helm, Johnson, Vlissides,
 *                            *Design Patterns*, 1994. Conformance: full.
 *   - `StubOllama`:          Test fake / spy hybrid per Meszaros, *xUnit
 *                            Test Patterns*, 2007 — records calls in-
 *                            memory and returns a fixed `{ ok: true }`
 *                            so tests can assert request shape without
 *                            a network. Conformance: full.
 *   - `Ollama.selfTest`:     Health-probe shape — re-uses
 *                            {@link SelfTestResult} from `@minsky/adapter-types`
 *                            (leaf package per Martin, *Clean Architecture*,
 *                            2017 — acyclic dependency principle).
 *
 * Why an ollama adapter (rule #2): the daemon's bash skeleton at
 * `bin/minsky-run.sh` needs two well-defined memory-management actions
 * around a daemon session (closes user-story 020):
 *   1. WARM the configured local model exactly once per daemon-start,
 *      before the first iteration's openhands spawn, so the cold-start
 *      tax (~15-30s loading ~42 GB into VRAM) is paid once instead of
 *      leaking into the first agent's reasoning latency.
 *   2. UNLOAD the model on graceful shutdown (SIGTERM/SIGINT trap), so
 *      the operator gets the wired RAM back the moment they stop
 *      iterating. The 24h-default `OLLAMA_KEEP_ALIVE` env var becomes a
 *      10-minute crash-safety net rather than the load-bearing default.
 *
 * Until this adapter shipped, both actions were possible only by
 * shelling `curl` from the bash runner — which would have put a vendor
 * name into business logic (rule #2 violation). This package puts the
 * `/api/generate`/`/api/ps` shape behind a typed interface; the bash
 * skeleton calls it through the thin `bin/cli.mjs` wrapper.
 *
 * Why HTTP Strategy with injected fetch (rule #7): Node 18+ exposes a
 * global `fetch`; we don't add a `node-fetch` dep (rule #1, plus the
 * global is already there). Tests inject a fetch-mock so the request
 * shape is asserted without a network. The seam is constructor-level
 * (Martin 2017 — DI at the edge).
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Adapter + Strategy).
 *   - Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test fake).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic
 *     dependency principle — `@minsky/adapter-types` is the leaf).
 *   - Armstrong, J., *Programming Erlang*, Pragmatic Bookshelf, 2007
 *     (let-it-crash AT the right boundary; transport-level errors map
 *     to `{ ok: false, reason }`, never to a thrown exception inside
 *     the daemon's iteration loop).
 *   - Ollama HTTP API docs (`/api/generate` § "Load a model"):
 *     https://github.com/ollama/ollama/blob/main/docs/api.md — empty
 *     `prompt` + `keep_alive: "30m"` warms; `keep_alive: 0` unloads.
 */

// Re-export the shared health-probe contract from the leaf types package so
// callers can keep doing `import { type SelfTestResult } from "@minsky/ollama"`
// without an extra dep declaration.
export type { SelfTestResult, SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/**
 * Result of `warm()` / `unload()`. `ok: false` carries a `reason` string
 * the caller logs; the Strategy never throws on transport-level errors
 * (graceful-degrade per rule #7 — a missed warm/unload must never
 * crash the daemon's iteration loop). 4xx/5xx and network errors all
 * map to `{ ok: false, reason: '...' }`.
 */
export interface OllamaResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * One row of `/api/ps`'s `models[]` array. Shape mirrors Ollama's
 * documented output; only the fields the daemon actually reads are
 * typed here. Future fields are accessible via the `_raw` escape hatch.
 */
export interface LoadedModel {
  readonly name: string;
  readonly size: number;
  readonly sizeVram: number;
  readonly expiresAt: string | undefined;
}

/**
 * Result of `ps()`. `models` is empty when nothing is loaded; the call
 * itself never fails because of an empty result — that's the steady-
 * state for an idle daemon.
 */
export interface PsResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly models: readonly LoadedModel[];
}

/**
 * Ollama adapter interface — Adapter pattern (Gamma et al., *Design
 * Patterns*, 1994). Strategy implementations live in sibling files
 * (e.g. {@link "./http".HttpOllama}).
 *
 * `selfTest()` follows the {@link SelfTestResult} contract; the
 * daemon's doctor aggregates across adapters via `aggregateStatus()`
 * from `@minsky/adapter-types`.
 */
export interface Ollama {
  /**
   * Pre-load `modelId` into VRAM. Issues `/api/generate` with an empty
   * prompt and `keep_alive` (default `"30m"`). The empty prompt means
   * no tokens are generated; Ollama returns immediately once the model
   * is resident.
   *
   * @param modelId The Ollama model id (e.g. `"qwen3-coder:30b"`).
   *   Note: when minsky's config uses the LiteLLM-prefixed form like
   *   `"ollama_chat/qwen3-coder:30b"`, strip the prefix BEFORE passing
   *   to this method — Ollama itself doesn't know about the
   *   `ollama_chat/` LiteLLM prefix. The HTTP Strategy does this strip
   *   automatically; callers passing the LiteLLM id work transparently.
   * @param keepAlive Optional Ollama `keep_alive` value (e.g. `"30m"`,
   *   `"1h"`). Defaults to `"30m"`, which is well above typical
   *   iteration cadence. Pass a longer value via `MINSKY_OLLAMA_WARM_KEEPALIVE`
   *   if you're running unusually long iterations.
   */
  warm(modelId: string, keepAlive?: string): Promise<OllamaResult>;

  /**
   * Evict `modelId` from VRAM immediately by issuing `/api/generate`
   * with `keep_alive: 0`. Ollama's response carries `"done_reason":
   * "unload"` on success.
   *
   * @param modelId Same shape rules as `warm()`.
   */
  unload(modelId: string): Promise<OllamaResult>;

  /**
   * Return the currently-loaded model list via `/api/ps`. Used by the
   * metric script (`scripts/measure-ollama-idle-memory.sh`) to verify
   * unload actually fired post-shutdown.
   */
  ps(): Promise<PsResult>;

  /**
   * Health probe — calls `ps()` and returns `green` on transport
   * success, `red` on transport failure. Mirrors the notifier
   * adapter's three-signal selfTest shape.
   */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * One recorded call to {@link StubOllama}. Discriminated union so test
 * assertions can narrow on `op` without `any` casts.
 */
export type StubOllamaCall =
  | { readonly op: "warm"; readonly modelId: string; readonly keepAlive: string }
  | { readonly op: "unload"; readonly modelId: string }
  | { readonly op: "ps" };

/**
 * In-memory `Ollama` for tests. Records every call's payload in order
 * (FIFO — first call is `calls[0]`) and returns fixed responses.
 * Pattern: test fake per Meszaros, *xUnit Test Patterns*, 2007.
 *
 * `selfTest()` always returns `green` with `latencyMs: 0` — the stub
 * has no I/O so any other status would be a lie.
 *
 * `psResult` defaults to an empty `models[]` list; tests that want to
 * assert "model X was loaded before shutdown" pass a fixture into the
 * constructor.
 *
 * @example
 *   const stub = new StubOllama();
 *   await daemonLifecycle.start({ ollama: stub });
 *   expect(stub.calls).toContainEqual({ op: "warm", modelId: "qwen3-coder:30b", keepAlive: "30m" });
 */
export class StubOllama implements Ollama {
  private readonly recorded: StubOllamaCall[] = [];
  private readonly psFixture: readonly LoadedModel[];

  constructor(opts?: { readonly psFixture?: readonly LoadedModel[] }) {
    this.psFixture = opts?.psFixture ?? [];
  }

  /**
   * @otel-exempt test fake — production callers never invoke this; recording is the test's seam, not a span source
   */
  get calls(): readonly StubOllamaCall[] {
    return this.recorded;
  }

  /**
   * @otel-exempt test fake — records in-memory and returns a fixed shape
   */
  // biome-ignore lint/suspicious/useAwait: test fake — async signature is the Ollama interface contract; no await is intentional (no I/O)
  async warm(modelId: string, keepAlive = "30m"): Promise<OllamaResult> {
    this.recorded.push({ op: "warm", modelId, keepAlive });
    return { ok: true };
  }

  /**
   * @otel-exempt test fake — records in-memory and returns a fixed shape
   */
  // biome-ignore lint/suspicious/useAwait: test fake — async signature is the Ollama interface contract; no await is intentional (no I/O)
  async unload(modelId: string): Promise<OllamaResult> {
    this.recorded.push({ op: "unload", modelId });
    return { ok: true };
  }

  /**
   * @otel-exempt test fake — records in-memory and returns the fixture
   */
  // biome-ignore lint/suspicious/useAwait: test fake — async signature is the Ollama interface contract; no await is intentional (no I/O)
  async ps(): Promise<PsResult> {
    this.recorded.push({ op: "ps" });
    return { ok: true, models: this.psFixture };
  }

  /**
   * @otel-exempt test fake — no I/O; the green status is unconditional by design
   */
  // biome-ignore lint/suspicious/useAwait: test fake — async signature is the Ollama interface contract; no await is intentional (no I/O)
  async selfTest(): Promise<SelfTestResult> {
    return {
      status: "green",
      message: "StubOllama — no I/O; recorded calls available via .calls",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Drop all recorded calls. Useful between test cases when the same
   * fixture is reused.
   *
   * @otel-exempt test fake — purely test-side mutation; spans here would be noise
   */
  reset(): void {
    this.recorded.length = 0;
  }
}

// Re-export the HTTP Strategy from the sibling module so consumers can
// `import { HttpOllama } from "@minsky/ollama"` without reaching for
// the `/http` subpath (mirrors `@minsky/notifier`'s pattern).
export { HttpOllama, type HttpOllamaOpts, type FetchLike } from "./http.js";
