/**
 * `NtfyNotifier` — Strategy implementation (Gamma et al., *Design
 * Patterns*, 1994) of the {@link Notifier} interface defined in
 * `./index.ts`. Posts each notification to ntfy.sh (or a self-hosted
 * ntfy server) via a single HTTP `POST /<topic>` call.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Strategy of `Notifier`. Conformance: full.
 *   - HTTP shape:            ntfy's documented "publish via HTTP" surface
 *                            (https://docs.ntfy.sh/publish/) — `Title`,
 *                            `Priority`, `Tags` headers + plain-text body.
 *                            Conformance: full.
 *   - Graceful-degrade:      Transport-level errors (network failure,
 *                            non-2xx response, rate-limited 429) return
 *                            `{ ok: false, reason: '...' }` rather than
 *                            throwing; rule #7 (vision.md § 7).
 *
 * Why ntfy: it's a thin pub/sub HTTP service with a free public tier and
 * a one-binary self-host story. The daemon never owns push-channel
 * infrastructure (rule #1 — push upstream first; the Strategy seam keeps
 * APNs / Pushover / webhook open as future Strategies).
 *
 * Why an injectable `fetch`: Node 18+ exposes a global `fetch`; we don't
 * add a `node-fetch` dep (rule #1, plus the global is already there).
 * Tests inject a fetch-mock so the request shape is asserted without a
 * network. The seam is constructor-level (Martin 2017 — DI at the edge).
 *
 * Why no try/catch deeper than 1 level (rule #6): `push()` has exactly
 * one `try { await fetch(...) } catch { return { ok: false, ... } }` at
 * the top level — the rejection is the supervisor boundary
 * ("let it crash AT the right boundary, not at the wrong one" —
 * Armstrong 2007). `selfTest()` reuses `push()` so the boundary is
 * shared.
 *
 * Auth (token): the constructor's `authToken` opt is plumbed into the
 * `Authorization: Bearer <token>` header. Caller is responsible for
 * keychain lookup (mirrors the `MaciekTokenMonitor` pattern of accepting
 * resolved values, never reaching for `~/.zshrc`).
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Strategy).
 *   - Armstrong, J., *Programming Erlang*, Pragmatic Bookshelf, 2007
 *     (let-it-crash supervision — the rejection is the supervisor
 *     boundary, not silently swallowed inside the function).
 *   - ntfy publish docs (https://docs.ntfy.sh/publish/) — header names
 *     `Title`, `Priority`, `Tags` and the priority value lattice (1..5).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (DI at the
 *     edge: the `fetch` seam is the only I/O, injected once).
 */

import type { SelfTestResult } from "@minsky/adapter-types";
import type { Notification, NotificationPriority, Notifier, PushResult } from "./index.js";

/**
 * Header name used to carry ntfy priority (`1`..`5`). Exported for tests
 * that assert request-shape via the injected `fetch` mock; production
 * callers should not need it.
 */
export const PRIORITY_HEADER = "Priority" as const;

/** Subset of the global `fetch` shape we depend on. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Constructor options for {@link NtfyNotifier}.
 */
export interface NtfyNotifierOpts {
  /**
   * The ntfy topic to publish to (e.g. `"minsky-fyodor"`).
   */
  readonly topic: string;
  /**
   * Server base URL. Defaults to `"https://ntfy.sh"`. For self-hosted,
   * pass the base of the deployment (e.g. `"https://ntfy.example.com"`).
   * Trailing slash is normalised away.
   */
  readonly serverBaseUrl?: string;
  /**
   * Optional bearer auth token. Required for authenticated topics on
   * self-hosted ntfy / private public-tier topics. Caller is responsible
   * for resolving this from the OS keychain (mirrors the token-monitor
   * pattern — the adapter never shells out to `security`).
   */
  readonly authToken?: string;
  /**
   * Injectable `fetch` for testability. Defaults to the global `fetch`
   * (Node 18+ exposes one). Tests pass a mock to assert request shape.
   */
  readonly fetchFn?: FetchLike;
}

/**
 * Map our transport-agnostic {@link NotificationPriority} to ntfy's
 * documented numeric priority (1=min .. 5=max). Defaults map:
 *   - `'low'`    → 2 (one below default — quiet but still visible)
 *   - `'normal'` → 3 (ntfy default; client uses default sound/vibration)
 *   - `'high'`   → 5 (max; client uses urgent sound, bypasses DND on iOS)
 *
 * @otel-exempt pure mapping; trivial helper, covered by the caller's span
 */
function mapPriority(p: NotificationPriority | undefined): string {
  if (p === "low") return "2";
  if (p === "high") return "5";
  return "3";
}

/**
 * Strategy implementation of {@link Notifier} backed by ntfy's HTTP
 * publish surface.
 */
export class NtfyNotifier implements Notifier {
  private readonly topic: string;
  private readonly serverBaseUrl: string;
  private readonly authToken: string | undefined;
  private readonly fetchFn: FetchLike;

  constructor(opts: NtfyNotifierOpts) {
    this.topic = opts.topic;
    this.serverBaseUrl = (opts.serverBaseUrl ?? "https://ntfy.sh").replace(/\/+$/, "");
    this.authToken = opts.authToken;
    // Fall back to the global `fetch` (Node 18+). The cast is the documented
    // way to take the global without introducing a node-fetch dep (rule #1).
    this.fetchFn = opts.fetchFn ?? (globalThis.fetch as FetchLike);
  }

  /**
   * Build the URL the ntfy server publishes to. Exposed as a private
   * helper so the test mock can assert against a single canonical shape.
   *
   * @otel-exempt URL-builder helper; pure string concat, covered by `push()`'s span
   */
  private url(): string {
    return `${this.serverBaseUrl}/${this.topic}`;
  }

  /**
   * Build the request headers for one push. Body is sent as plain text
   * (ntfy's documented default — content-type defaults work).
   *
   * @otel-exempt header-builder; pure mapping over inputs, covered by `push()`'s span
   */
  private headers(n: Notification): Record<string, string> {
    const h: Record<string, string> = {
      Title: n.title,
      [PRIORITY_HEADER]: mapPriority(n.priority),
    };
    if (n.tags !== undefined && n.tags.length > 0) {
      h["Tags"] = n.tags.join(",");
    }
    if (this.authToken !== undefined && this.authToken.length > 0) {
      h["Authorization"] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  /**
   * Publish one notification. Returns `{ ok: true }` on a 2xx response,
   * `{ ok: false, reason }` on any non-2xx response or transport-level
   * error. Never throws — the daemon must continue ticking even when
   * push fails (rule #7 graceful-degrade).
   *
   * @otel adapters.notifier.push
   */
  async push(n: Notification): Promise<PushResult> {
    let response: Response;
    try {
      response = await this.fetchFn(this.url(), {
        method: "POST",
        headers: this.headers(n),
        body: n.body,
      });
      // rule-6: handled-locally — fetch rejection is the supervisor boundary; per rule #7 (chaos table rows ntfy.sh-down / network-partition / rate-limited), a missed push must never crash the daemon — the caller logs the reason and continues.
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `network: ${reason}` };
    }
    if (!response.ok) {
      return { ok: false, reason: `http ${response.status}` };
    }
    return { ok: true };
  }

  /**
   * Health probe. Sends a single low-priority push with a deterministic
   * title; returns `green` on a 2xx, `yellow` on rate-limit (429 — the
   * service is up but we're throttled; the dashboard should show this
   * as a soft-fail), `red` on any other failure. Mirrors the OTEL
   * adapter's three-signal selfTest shape but uses the lattice for
   * graceful-degrade semantics.
   *
   * @otel adapters.notifier.selfTest
   */
  async selfTest(): Promise<SelfTestResult> {
    const start = Date.now();
    const result = await this.push({
      title: "minsky.notifier.selfTest",
      body: "selfTest probe",
      priority: "low",
      tags: ["white_check_mark"],
    });
    const latencyMs = Date.now() - start;
    if (result.ok) {
      return {
        status: "green",
        message: "ntfy adapter accepted push",
        latencyMs,
        lastCheck: new Date().toISOString(),
      };
    }
    const reason = result.reason ?? "unknown";
    const status = reason.startsWith("http 429") ? "yellow" : "red";
    return {
      status,
      message: `ntfy adapter selfTest failed: ${reason}`,
      latencyMs,
      lastCheck: new Date().toISOString(),
    };
  }
}
