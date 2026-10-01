// <!-- scope: human-approved runany-dynamic-model-or-local-fallback slice 3 (operator 2026-05-16 directive — the multi-backend liveness probe + TTL cache that the task's "Next" step + Pivot call for; wires `decideRunAnyProvider` into the run-anywhere entrypoint via `runany-resolve-model.mjs`). -->
// Runany backend liveness — the multi-backend remote-liveness probe and
// its TTL cache, plus the budget-snapshot → RemainingFractions adapter.
//
// This is the piece the task's "Next" step named (docs/run-anywhere.md
// § Status): "wire the decider + a multi-backend liveness probe into the
// run-anywhere entrypoint; probe-result cache (TTL ≥60s) per the task
// Pivot." The pure decision (`decideRunAnyProvider`) and the audit harness
// shipped in slices 1+2; this module + `runany-resolve-model.mjs` carry it
// the last mile into `bin/minsky-run.sh`.
//
// Source: parent task `runany-dynamic-model-or-local-fallback`,
// Acceptance (3) "full auto local fallback when all remote down/exhausted"
// + (4) "recover to remote" + Pivot ("cache probe results TTL ≥60s, probe
// only on a provider error or budget-band crossing").
//
// Pattern conformance (rule #8):
//   - Pure-function core with I/O at the edge (Martin 2017, Clean
//     Architecture) — every export here is referentially transparent over
//     its inputs; the network probe and the clock are INJECTED seams. The
//     real socket connect + `Date.now()` live in the CLI boundary
//     (`runany-resolve-model.mjs`), never here.
//   - Cache-with-TTL is memoisation over a clock (Michie 1968, "Memo
//     functions") — the cache is pure over `(now, lastProbedAt, ttl)`.
//   - Strategy seam (Gamma 1994) — `probe` is the injected strategy; the
//     fixtures swap in a deterministic probe so liveness is unit-tested
//     without a network.

/**
 * @typedef {import("./runany-provider-decision.mjs").RemoteBackendLiveness} RemoteBackendLiveness
 * @typedef {import("@minsky/token-monitor").RemainingFractions} RemainingFractions
 */

/**
 * One raw probe result for a single configured remote backend. Produced by
 * the injected probe seam; mapped to {@link RemoteBackendLiveness} by
 * {@link toRemoteBackends}.
 *
 * @typedef {Object} ProbeResult
 * @property {string} id Stable backend id (e.g. `"claude"`, `"bedrock"`).
 * @property {boolean} reachable `true` when the probe connected.
 * @property {string} [reason] Short cause string when unreachable.
 */

/**
 * A cached liveness snapshot for one backend — the last probe result plus
 * the clock reading at which it was taken. Pure data.
 *
 * @typedef {Object} CachedLiveness
 * @property {ProbeResult} result
 * @property {number} probedAtMs Epoch-ms (from the injected clock) of the probe.
 */

/** Default probe-cache TTL — 60s, the Pivot floor ("TTL ≥60s"). */
export const DEFAULT_PROBE_TTL_MS = 60_000;

/**
 * Map raw probe results onto the {@link RemoteBackendLiveness} shape
 * `decideRunAnyProvider` consumes. Pure; preserves input order. A `reason`
 * is only carried for unreachable backends (matches the decider's
 * `reason`-on-down convention).
 *
 * @param {readonly ProbeResult[]} results
 * @returns {RemoteBackendLiveness[]}
 */
export function toRemoteBackends(results) {
  return results.map((r) =>
    r.reachable
      ? { id: r.id, reachable: true }
      : { id: r.id, reachable: false, reason: r.reason ?? "down" },
  );
}

/**
 * Decide whether a cached liveness entry is still fresh. Pure over
 * `(now, probedAtMs, ttlMs)`. A `now` before `probedAtMs` (clock skew /
 * non-monotone wall clock) is treated as STALE — the safe default is to
 * re-probe rather than trust a future-dated cache entry (rule #6: degrade
 * loud, never silently trust bad state).
 *
 * @param {number} nowMs
 * @param {number} probedAtMs
 * @param {number} [ttlMs]
 * @returns {boolean}
 */
export function isFresh(nowMs, probedAtMs, ttlMs = DEFAULT_PROBE_TTL_MS) {
  const age = nowMs - probedAtMs;
  return age >= 0 && age < ttlMs;
}

/**
 * TTL cache over the remote-liveness probe (the Pivot's "cache probe
 * results, TTL ≥60s; probe only on a provider error or budget-band
 * crossing"). Pure over its injected `clock` and `probe` seams — no
 * network, no `Date.now()` of its own. The real socket probe + clock are
 * supplied by the CLI boundary.
 *
 * Re-probe triggers (any one forces a fresh probe for ALL backends):
 *   - cache miss / first call;
 *   - any cached entry older than `ttlMs`;
 *   - `force === true` (the caller saw a provider error OR a budget-band
 *     crossing and wants a fresh read — the Pivot's two named triggers).
 *
 * @template {ProbeResult} P
 */
export class LivenessProbeCache {
  /**
   * @param {Object} deps
   * @param {() => number} deps.clock Epoch-ms clock seam.
   * @param {(ids: readonly string[]) => Promise<P[]> | P[]} deps.probe
   *   The injected probe — connects to each backend id and reports
   *   reachability. Swapped for a deterministic fixture in tests.
   * @param {number} [deps.ttlMs]
   */
  constructor(deps) {
    /** @type {() => number} */
    this._clock = deps.clock;
    /** @type {(ids: readonly string[]) => Promise<P[]> | P[]} */
    this._probe = deps.probe;
    /** @type {number} */
    this._ttlMs = deps.ttlMs ?? DEFAULT_PROBE_TTL_MS;
    /** @type {Map<string, CachedLiveness>} */
    this._cache = new Map();
  }

  /**
   * Return liveness for every configured backend id, using the cache when
   * every entry is fresh and `force` is false; otherwise re-probe all ids
   * and refresh the cache.
   *
   * @param {readonly string[]} ids
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<{ backends: RemoteBackendLiveness[], cacheHit: boolean }>}
   */
  async liveness(ids, opts = {}) {
    const now = this._clock();
    const force = opts.force === true;
    const allFresh =
      !force &&
      ids.length > 0 &&
      ids.every((id) => {
        const c = this._cache.get(id);
        return c !== undefined && isFresh(now, c.probedAtMs, this._ttlMs);
      });

    if (allFresh) {
      const cached = ids.map((id) => {
        const c = /** @type {CachedLiveness} */ (this._cache.get(id));
        return c.result;
      });
      return { backends: toRemoteBackends(cached), cacheHit: true };
    }

    const fresh = await this._probe(ids);
    const probedAt = this._clock();
    for (const r of fresh) this._cache.set(r.id, { result: r, probedAtMs: probedAt });
    return { backends: toRemoteBackends(fresh), cacheHit: false };
  }
}

/**
 * Adapt a `~/.minsky/token-monitor.json` snapshot (the on-disk shape
 * `bin/check-budget.sh` reads — `used` / `limit` / `weekly_consumed_fraction`
 * / optional `monthly_consumed_fraction`) into the continuous
 * {@link RemainingFractions} triple the strategic picker consumes. Pure;
 * clamps each fraction to `[0, 1]`. A missing / zero-limit snapshot maps to
 * full headroom (`1.0`) — the cold-start path picks the best tier, matching
 * `bin/check-budget.sh`'s "no data → NORMAL" default.
 *
 * @param {Object} [snapshot]
 * @param {number} [snapshot.used]
 * @param {number} [snapshot.limit]
 * @param {number} [snapshot.weekly_consumed_fraction]
 * @param {number} [snapshot.monthly_consumed_fraction]
 * @param {string} [snapshot.observedAt]
 * @returns {RemainingFractions}
 */
export function snapshotToRemaining(snapshot) {
  const s = snapshot ?? {};
  const used = num(s.used, 0);
  const limit = num(s.limit, 0);
  const fivehour = limit <= 0 ? 1 : clamp01(1 - used / limit);
  const weekly = clamp01(1 - num(s.weekly_consumed_fraction, 0));
  const monthly = clamp01(1 - num(s.monthly_consumed_fraction, 0));
  return {
    fivehour,
    weekly,
    monthly,
    observedAt: typeof s.observedAt === "string" ? s.observedAt : "",
  };
}

/**
 * Coerce a value to a finite number, falling back to `fallback`.
 *
 * @param {unknown} v
 * @param {number} fallback
 * @returns {number}
 */
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Clamp to `[0, 1]`; non-finite → 0.
 *
 * @param {number} v
 * @returns {number}
 */
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
