// no-test: novel/dashboard-web is deprecated (docs/DEPRECATED.md §4) — "keep for now, do NOT add features"; existing files lack tests by policy
/**
 * `@minsky/dashboard-web` — concrete `GetValue` Strategies (rule #2 Adapter).
 *
 * `snapshotGetValue(snapshot)` reads a pre-fetched JSON map keyed by
 * `SuccessMetric.id`; the runner produces it via async OTEL / PromQL
 * queries. `constantGetValue(v)` smoke-tests the seam end-to-end without
 * a backend. `fetchOpenObserveSnapshot(opts)` is the live-read path —
 * issues read-only HTTP GETs against an OpenObserve PromQL instant-query
 * endpoint (`/api/default/prometheus/api/v1/query`) and returns a
 * `Snapshot` ready to feed `snapshotGetValue`. The async I/O happens
 * upstream of `createServer({ getValue })` so the per-render path stays
 * synchronous within the 500-ms budget.
 *
 * Anchor: rule #2 (every dep behind interface — value source is data,
 * not a hard import); Card & Mackinlay 1999 (live readings); OpenTelemetry
 * specification (CNCF 2020+); Prometheus HTTP API (instant-query response
 * shape — `status: "success" \| "error"`, `data.resultType`, `data.result`).
 */

import type { SuccessMetric } from "./metrics.js";
import type { GetValue } from "./render.js";

/** Snapshot map: metric id → current rendered value (string). */
export type Snapshot = Readonly<Record<string, string>>;

/** @otel-exempt pure data lookup, no I/O. */
export function snapshotGetValue(snapshot: Snapshot): GetValue {
  return (m: SuccessMetric) => {
    const v = snapshot[m.id];
    return v === undefined ? null : v;
  };
}

/** @otel-exempt pure data lookup, no I/O. */
export function constantGetValue(value: string): GetValue {
  return () => value;
}

/**
 * Map of `SuccessMetric.id` → PromQL expression to evaluate against
 * OpenObserve. Only the OTEL-backed success criteria appear here; metrics
 * whose formula is a shell command (e.g., `gh run list ...`) are
 * intentionally absent and fall through to `(stub)` per
 * `vision.md` § "Pattern conformance index" row 65.
 *
 * Pinned via `vision.md` § "Success criteria" rows 2, 5, 6, 9. Resilience
 * scout: the metric *names* (`token_count`, `supervisor_restart_to_claim_latency_seconds`,
 * `http_get_total{path="/watch.json"}`, `claude_code_api_errors_total`) are
 * the exact strings vision.md publishes; if `@minsky/observability` ever
 * emits under different names, the mismatch is the resilience-scout
 * follow-up filed at TASKS.md P3 (`otel-emission-name-audit`).
 */
export const OPENOBSERVE_PROMQL_BY_METRIC_ID: Readonly<Record<string, string>> = {
  "tokens-per-story":
    'sum(token_count{event="user_story.complete"}[30d]) / count(span{name="user_story.complete"}[30d])',
  mttr: "histogram_quantile(0.95, supervisor_restart_to_claim_latency_seconds[7d])",
  "wrist-dwell": 'count(http_get_total{path="/watch.json"}[1d]) * 2',
  "token-budget-honoring": 'sum(rate(claude_code_api_errors_total{status="429"}[7d]))',
  "loop-uptime": 'avg_over_time(up{service="minsky-tick-loop"}[30d])',
};

/**
 * Read-only fetch shape used by {@link fetchOpenObserveSnapshot}. Matches
 * the global `fetch` (typed loose so a mock — `vi.fn(async () => ...)` —
 * satisfies the contract without dragging `@types/node`'s built-in
 * fetch typing assumptions into the test.
 *
 * Read-only by construction: only HTTP GETs flow through here; the
 * Strategy never POSTs to OpenObserve (OpenObserve's write side is
 * handled by `@minsky/observability` via OTLP, never by the dashboard).
 */
export type FetchLike = (
  input: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

export interface OpenObserveStrategyOpts {
  /** Base URL of the OpenObserve daemon, e.g. `http://127.0.0.1:5080`. */
  readonly baseUrl: string;
  /** Org id; defaults to OpenObserve's `default` org. */
  readonly org?: string;
  /** Optional HTTP Basic auth (root user); defaults to none. */
  readonly basicAuth?: { readonly user: string; readonly password: string };
  /**
   * Per-metric PromQL expressions; defaults to
   * {@link OPENOBSERVE_PROMQL_BY_METRIC_ID}. Tests inject a smaller map
   * to exercise the seam.
   */
  readonly promqlByMetricId?: Readonly<Record<string, string>>;
  /** Injected `fetch`; defaults to the global. */
  readonly fetch?: FetchLike;
  /**
   * Format the numeric result string for rendering. Defaults to identity
   * (the PromQL response value is already a string).
   */
  readonly format?: (raw: string, metricId: string) => string;
}

/**
 * Parse one Prometheus instant-query response and return the scalar /
 * single-vector value as a string, or `null` if the response is empty,
 * malformed, or carries a non-success status.
 *
 * Pure: no I/O, only `JSON.parse` + shape inspection. Exposed for tests.
 *
 * @otel-exempt pure parser — no I/O, no clock dependency.
 */
export function parsePromqlInstantResponse(body: string): string | null {
  const data = parsePromqlSuccessData(body);
  if (data === null) return null;
  if (data.resultType === "scalar") return extractScalarValue(data.result);
  if (data.resultType === "vector") return extractVectorFirstValue(data.result);
  return null;
}

/** @otel-exempt pure parser helper, no I/O. */
function parsePromqlSuccessData(
  body: string,
): { readonly resultType: unknown; readonly result: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
    // rule-6: handled-locally — malformed PromQL JSON graceful-degrades to `(stub)` (chaos row 4)
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const root = parsed as { readonly status?: unknown; readonly data?: unknown };
  if (root.status !== "success") return null;
  if (root.data === null || typeof root.data !== "object") return null;
  return root.data as { readonly resultType: unknown; readonly result: unknown };
}

/** @otel-exempt pure parser helper, no I/O. */
function extractScalarValue(result: unknown): string | null {
  if (!Array.isArray(result) || result.length !== 2) return null;
  const v = result[1];
  return typeof v === "string" ? v : null;
}

/** @otel-exempt pure parser helper, no I/O. */
function extractVectorFirstValue(result: unknown): string | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  const first = result[0];
  if (first === null || typeof first !== "object" || !("value" in first)) return null;
  const valuePair = (first as { readonly value: unknown }).value;
  if (!Array.isArray(valuePair) || valuePair.length < 2) return null;
  const v = valuePair[1];
  return typeof v === "string" ? v : null;
}

/**
 * Issue one read-only HTTP GET against OpenObserve's PromQL instant-query
 * endpoint and return the raw value string (or `null` on any HTTP /
 * parse failure — graceful-degrade per rule #7).
 *
 * @otel dashboard-web.openobserve-query
 */
export async function queryOpenObservePromql(
  opts: OpenObserveStrategyOpts,
  promql: string,
): Promise<string | null> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const org = opts.org ?? "default";
  const url = `${stripTrailingSlash(opts.baseUrl)}/api/${encodeURIComponent(
    org,
  )}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
  const headers: Record<string, string> = {};
  if (opts.basicAuth !== undefined) {
    const token = btoaCompat(`${opts.basicAuth.user}:${opts.basicAuth.password}`);
    headers["Authorization"] = `Basic ${token}`;
  }
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { headers });
    // rule-6: handled-locally — network failure graceful-degrades to `(stub)` (chaos row 3)
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await res.text();
  return parsePromqlInstantResponse(body);
}

/**
 * Build a {@link Snapshot} by querying OpenObserve once per metric id in
 * `promqlByMetricId`. Issued in parallel; failed reads omit the entry
 * (the consumer's `snapshotGetValue` then renders `(stub)` for that row).
 *
 * @otel dashboard-web.openobserve-snapshot
 */
export async function fetchOpenObserveSnapshot(opts: OpenObserveStrategyOpts): Promise<Snapshot> {
  const map = opts.promqlByMetricId ?? OPENOBSERVE_PROMQL_BY_METRIC_ID;
  const fmt = opts.format ?? ((raw: string) => raw);
  const entries = await Promise.all(
    Object.entries(map).map(async ([metricId, promql]) => {
      const raw = await queryOpenObservePromql(opts, promql);
      if (raw === null) return null;
      return [metricId, fmt(raw, metricId)] as const;
    }),
  );
  const snapshot: Record<string, string> = {};
  for (const e of entries) {
    if (e !== null) snapshot[e[0]] = e[1];
  }
  return snapshot;
}

/**
 * Build a `GetValue` Strategy by combining {@link fetchOpenObserveSnapshot}
 * with {@link snapshotGetValue}. Async pre-fetch happens once at start
 * time so the per-render path stays synchronous.
 *
 * @otel dashboard-web.openobserve-strategy
 */
export async function openObserveGetValue(opts: OpenObserveStrategyOpts): Promise<GetValue> {
  const snap = await fetchOpenObserveSnapshot(opts);
  return snapshotGetValue(snap);
}

/** @otel-exempt pure string transform, no I/O. */
function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Base64 encoder for HTTP Basic auth — uses the global `btoa` if present
 * (browser / Node ≥18), otherwise falls back to `Buffer`. Pure helper.
 *
 * @otel-exempt pure string transform, no I/O.
 */
function btoaCompat(s: string): string {
  if (typeof globalThis.btoa === "function") return globalThis.btoa(s);
  // rule-6: handled-locally — Node-only fallback path.
  return Buffer.from(s, "utf8").toString("base64");
}
