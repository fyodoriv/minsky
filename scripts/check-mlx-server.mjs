#!/usr/bin/env node
// @ts-check
// `scripts/check-mlx-server.mjs` — local mlx-lm.server reachability probe.
// Slice 1 substrate of `local-llm-fallback-on-budget-pause` per TASKS.md.
//
// Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
//   - Liveness probe / readiness probe — Burns et al., "Borg, Omega, and
//     Kubernetes", *ACM Queue* 14(1) 2016 (the probe shape Kubernetes
//     formalised: a small HTTP GET against a documented endpoint with a
//     short timeout). Conformance: full.
//   - Bounded-time HTTP `GET` with abort signal — Stevens, *Advanced
//     Programming in the UNIX Environment*, Addison-Wesley 1992
//     (timeouts as the discipline that makes I/O safe). Conformance: full.
//
// Output contract (consumed by `LlmProviderSelectingSpawnStrategy` in
// slice 3 — a JSON line on stdout shaped like `LocalProbeResult` from
// `novel/tick-loop/src/llm-provider-selector.ts`):
//
//   { "reachable": true, "observedAtMs": 1714857600000 }
//   { "reachable": false, "observedAtMs": 1714857600000, "reason": "ECONNREFUSED" }
//   { "reachable": false, "observedAtMs": 1714857600000, "reason": "http 503" }
//   { "reachable": false, "observedAtMs": 1714857600000, "reason": "timeout 60000ms" }
//
// Exit code: 0 when reachable, 1 otherwise. Either way the JSON line is
// printed so the caller has the structured signal even on failure (rule #4
// — visible-not-silent). The slice-3 wiring layer reads stdout, parses
// JSON, and threads the result into `decideProvider(...)`.
//
// Usage:
//   node scripts/check-mlx-server.mjs [--url=URL] [--timeout-ms=N]
//
// Defaults:
//   --url=http://127.0.0.1:8080/v1/models
//   --timeout-ms=60000  (60s — matches the docs)
//
// Anchor: docs/local-llm-fallback.md § "How the daemon picks the provider"
// + `LocalProbeResult` shape in `novel/tick-loop/src/llm-provider-selector.ts`.

import process from "node:process";

const DEFAULT_URL = "http://127.0.0.1:8080/v1/models";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @typedef {{
 *   reachable: boolean,
 *   observedAtMs: number,
 *   reason?: string,
 * }} ProbeResult
 */

/**
 * Parse CLI args. Pure, exported for testing.
 *
 * @param {readonly string[]} argv
 * @returns {{ url: string, timeoutMs: number }}
 */
export function parseArgs(argv) {
  let url = DEFAULT_URL;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (const arg of argv) {
    if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else if (arg.startsWith("--timeout-ms=")) {
      const parsed = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) timeoutMs = parsed;
    }
  }
  return { url, timeoutMs };
}

/**
 * Classify a thrown error into a short reason string for the
 * `ProbeResult.reason` field. Pure, exported for testing.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function classifyError(err) {
  if (err === null || err === undefined) return "unknown";
  // node-fetch / undici style: `err.cause.code` or `err.code`
  /** @type {{ code?: string, name?: string, message?: string, cause?: { code?: string } } | null} */
  const e = /** @type {any} */ (err);
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === "string" && code.length > 0) return code;
  if (e?.name === "AbortError") return "abort";
  if (typeof e?.message === "string" && e.message.length > 0) {
    return e.message.slice(0, 80);
  }
  return "unknown";
}

/**
 * Probe the server. Returns a `ProbeResult`. Never throws — all errors
 * collapse to `{ reachable: false, reason: <classified> }`.
 *
 * The `fetchFn` and `now` seams let tests inject deterministic stubs.
 *
 * @param {{
 *   url: string,
 *   timeoutMs: number,
 *   fetchFn?: typeof fetch,
 *   now?: () => number,
 * }} opts
 * @returns {Promise<ProbeResult>}
 */
export async function probe(opts) {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  const observedAtMs = now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const resp = await fetchFn(opts.url, { signal: ac.signal, method: "GET" });
    if (resp.ok) return { reachable: true, observedAtMs };
    return { reachable: false, observedAtMs, reason: `http ${resp.status}` };
  } catch (err) {
    const reason =
      ac.signal.aborted && classifyError(err) === "abort"
        ? `timeout ${opts.timeoutMs}ms`
        : classifyError(err);
    return { reachable: false, observedAtMs, reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * CLI main — invoked when this script is run directly. Exported for tests.
 *
 * @param {{
 *   argv: readonly string[],
 *   stdout: { write: (s: string) => void },
 *   fetchFn?: typeof fetch,
 *   now?: () => number,
 * }} opts
 * @returns {Promise<number>} exit code
 */
export async function main(opts) {
  const args = parseArgs(opts.argv);
  const result = await probe({
    url: args.url,
    timeoutMs: args.timeoutMs,
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  opts.stdout.write(`${JSON.stringify(result)}\n`);
  return result.reachable ? 0 : 1;
}

// I/O boundary — only runs when this is the entry script.
if (import.meta.url === `file://${process.argv[1]}`) {
  main({
    argv: process.argv.slice(2),
    stdout: process.stdout,
  })
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      // rule #6 / Armstrong 2007: let it crash. The supervisor (the
      // caller) sees exit code 2 + the unhandled error on stderr.
      process.stderr.write(`check-mlx-server: ${err}\n`);
      process.exit(2);
    });
}
