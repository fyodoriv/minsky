/**
 * `HttpOllama` — Strategy implementation (Gamma et al., *Design
 * Patterns*, 1994) of the {@link Ollama} interface defined in
 * `./index.ts`. Talks to a local Ollama daemon via its documented HTTP
 * API (`/api/generate` for warm/unload, `/api/ps` for inspection).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Strategy of `Ollama`. Conformance: full.
 *   - HTTP shape:            Ollama's documented "Generate a completion"
 *                            and "List running models" endpoints
 *                            (https://github.com/ollama/ollama/blob/main/
 *                            docs/api.md). Conformance: full — empty
 *                            `prompt` + `keep_alive: "30m"` warms,
 *                            `keep_alive: 0` unloads, `GET /api/ps`
 *                            lists loaded models.
 *   - Graceful-degrade:      Transport-level errors (ECONNREFUSED,
 *                            non-2xx response, AbortController timeout)
 *                            return `{ ok: false, reason: '...' }`
 *                            rather than throwing; rule #7 (vision.md
 *                            § 7).
 *
 * Why fetch with an `AbortController` timeout: a network partition
 * mid-warm would otherwise hang the daemon indefinitely. Default
 * 30 s timeout per call; the supervisor decides whether to retry. The
 * timeout is per-call, not cumulative, so a slow but eventually-
 * successful warm doesn't get spuriously killed.
 *
 * Why no try/catch deeper than 1 level (rule #6): each public method
 * has exactly one `try { await this.fetchFn(...) } catch { return
 * { ok: false, ... } }` at the top level — the rejection is the
 * supervisor boundary ("let it crash AT the right boundary, not at
 * the wrong one" — Armstrong 2007). `selfTest()` reuses `ps()` so the
 * boundary is shared.
 *
 * Why an injectable `fetch`: Node 18+ exposes a global `fetch`; we
 * don't add a `node-fetch` dep (rule #1, plus the global is already
 * there). Tests inject a fetch-mock so the request shape is asserted
 * without a network. The seam is constructor-level (Martin 2017 — DI
 * at the edge).
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Strategy).
 *   - Armstrong, J., *Programming Erlang*, Pragmatic Bookshelf, 2007
 *     (let-it-crash supervision — the rejection is the supervisor
 *     boundary, not silently swallowed inside the function).
 *   - Ollama HTTP API docs (https://github.com/ollama/ollama/blob/
 *     main/docs/api.md) — endpoint names + payload shape + the
 *     `keep_alive` parameter semantics.
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (DI at the
 *     edge: the `fetch` seam is the only I/O, injected once).
 */

import type { SelfTestResult } from "@minsky/adapter-types";
import type { LoadedModel, Ollama, OllamaResult, PsResult } from "./index.js";

/** Subset of the global `fetch` shape we depend on. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Constructor options for {@link HttpOllama}.
 */
export interface HttpOllamaOpts {
  /**
   * Base URL of the Ollama daemon. Default `"http://localhost:11434"`.
   * Trailing slash is normalised away.
   */
  readonly baseUrl?: string;
  /**
   * Injectable `fetch` for testability. Defaults to the global `fetch`
   * (Node 18+ exposes one).
   */
  readonly fetchFn?: FetchLike;
  /**
   * Per-call timeout in milliseconds. Default `30000` (30 s). The
   * warm-from-cold load of `qwen3-coder:30b` empirically takes
   * ~15-30 s on an M3 Max; 30 s gives 2x headroom. Operators with
   * larger models or slower disks can raise this via the constructor.
   */
  readonly timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_WARM_KEEPALIVE = "30m";

/**
 * Strip the LiteLLM provider prefix (`ollama_chat/`, `ollama/`) from a
 * model id, returning the bare Ollama-side name. Ollama itself does
 * not understand `ollama_chat/`; that prefix is purely a LiteLLM
 * routing hint.
 *
 * @example
 *   stripLitellmPrefix("ollama_chat/qwen3-coder:30b")  // "qwen3-coder:30b"
 *   stripLitellmPrefix("ollama/qwen3-coder:30b")       // "qwen3-coder:30b"
 *   stripLitellmPrefix("qwen3-coder:30b")              // "qwen3-coder:30b"
 *
 * @otel-exempt pure string operation, covered by the caller's span
 */
export function stripLitellmPrefix(modelId: string): string {
  if (modelId.startsWith("ollama_chat/")) return modelId.slice("ollama_chat/".length);
  if (modelId.startsWith("ollama/")) return modelId.slice("ollama/".length);
  return modelId;
}

/**
 * Map an Ollama `/api/ps` `models[]` row (snake_case from the wire)
 * to our internal camelCase shape. Tolerates missing fields by
 * filling in defaults — the daemon may upgrade and add/remove fields,
 * but the load-bearing four are stable.
 *
 * @otel-exempt pure mapping, covered by the caller's span
 */
function mapModelRow(row: unknown): LoadedModel | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const r = row as Record<string, unknown>;
  if (typeof r["name"] !== "string") return undefined;
  return {
    name: r["name"],
    size: typeof r["size"] === "number" ? r["size"] : 0,
    sizeVram: typeof r["size_vram"] === "number" ? r["size_vram"] : 0,
    expiresAt: typeof r["expires_at"] === "string" ? r["expires_at"] : undefined,
  };
}

/**
 * Strategy implementation of {@link Ollama} backed by Ollama's HTTP API.
 */
export class HttpOllama implements Ollama {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: HttpOllamaOpts = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    // Fall back to the global `fetch` (Node 18+). The cast is the documented
    // way to take the global without introducing a node-fetch dep (rule #1).
    this.fetchFn = opts.fetchFn ?? (globalThis.fetch as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Run `fetch` with a per-call AbortController timeout. The signal
   * fires after `timeoutMs`; the caller's catch handler converts the
   * `AbortError` into the standard `{ ok: false, reason }` shape.
   *
   * @otel-exempt low-level helper; the caller's public method owns the span
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Pre-load `modelId` into VRAM by issuing `/api/generate` with an
   * empty prompt and a `keep_alive` of `"30m"` (or `keepAlive` if
   * passed). Ollama returns immediately once the model is resident.
   *
   * Never throws. Network-level errors and non-2xx responses map to
   * `{ ok: false, reason }`.
   *
   * @otel adapters.ollama.warm
   */
  async warm(modelId: string, keepAlive: string = DEFAULT_WARM_KEEPALIVE): Promise<OllamaResult> {
    const body = JSON.stringify({
      model: stripLitellmPrefix(modelId),
      prompt: "",
      keep_alive: keepAlive,
    });
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      // rule-6: handled-locally — fetch rejection is the supervisor boundary; per rule #7 (chaos table row ollama-down-at-warm), a missed warm must never crash the daemon — the caller logs the reason and continues with cold-start tax on the first agent spawn.
    } catch (err) {
      return { ok: false, reason: `network: ${errorMessage(err)}` };
    }
    if (!response.ok) {
      return { ok: false, reason: `http ${response.status}` };
    }
    return { ok: true };
  }

  /**
   * Evict `modelId` from VRAM immediately by issuing `/api/generate`
   * with `keep_alive: 0`. Ollama's response carries `"done_reason":
   * "unload"` on success.
   *
   * Never throws. The trap handler in `bin/minsky-run.sh` calls this
   * unconditionally on SIGTERM/SIGINT; a failed unload still allows
   * the runner to exit cleanly (the 10 m env-var safety net catches
   * the leak).
   *
   * @otel adapters.ollama.unload
   */
  async unload(modelId: string): Promise<OllamaResult> {
    const body = JSON.stringify({
      model: stripLitellmPrefix(modelId),
      keep_alive: 0,
    });
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      return { ok: false, reason: `network: ${errorMessage(err)}` };
    }
    if (!response.ok) {
      return { ok: false, reason: `http ${response.status}` };
    }
    return { ok: true };
  }

  /**
   * Return the currently-loaded model list via `GET /api/ps`. Empty
   * `models[]` is the steady-state for an idle daemon — not a failure.
   *
   * @otel adapters.ollama.ps
   */
  async ps(): Promise<PsResult> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${this.baseUrl}/api/ps`, { method: "GET" });
    } catch (err) {
      return { ok: false, reason: `network: ${errorMessage(err)}`, models: [] };
    }
    if (!response.ok) {
      return { ok: false, reason: `http ${response.status}`, models: [] };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (err) {
      return { ok: false, reason: `parse: ${errorMessage(err)}`, models: [] };
    }
    const rawModels =
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { models?: unknown }).models)
        ? (parsed as { models: unknown[] }).models
        : [];
    const models: LoadedModel[] = [];
    for (const row of rawModels) {
      const mapped = mapModelRow(row);
      if (mapped !== undefined) models.push(mapped);
    }
    return { ok: true, models };
  }

  /**
   * Health probe. Calls `ps()`; returns `green` on a 2xx with parseable
   * body, `red` on any transport failure. Mirrors the notifier
   * adapter's three-signal shape (yellow is reserved for future rate-
   * limit-class signals Ollama doesn't currently emit).
   *
   * @otel adapters.ollama.selfTest
   */
  async selfTest(): Promise<SelfTestResult> {
    const start = Date.now();
    const result = await this.ps();
    const latencyMs = Date.now() - start;
    if (result.ok) {
      return {
        status: "green",
        message: `ollama reachable (${result.models.length} model${result.models.length === 1 ? "" : "s"} loaded)`,
        latencyMs,
        lastCheck: new Date().toISOString(),
      };
    }
    return {
      status: "red",
      message: `ollama selfTest failed: ${result.reason ?? "unknown"}`,
      latencyMs,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Extract a string message from an unknown error value. Avoids the
 * `any` cast that `err.message` would imply when `err` is `unknown`.
 *
 * @otel-exempt utility, covered by the caller's span
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
