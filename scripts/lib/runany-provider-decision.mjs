// <!-- scope: human-approved phase-11b-delete-tick-loop-multistep step 2 — ports the runany provider decision out of `novel/tick-loop/src/runany-provider-decision.ts` (deletion target) to `scripts/lib/`. Same decision-table contract, same 3 kinds (operator-pin / dynamic / local-fallback). -->
// Runany provider decision — the unified "pin > dynamic > local"
// decision for the zero-arg run-anywhere entrypoint.
//
// History: originally `novel/tick-loop/src/runany-provider-decision.ts`.
// Ported to .mjs / JSDoc in phase-11b step 2. NOTE: this IS consumed at
// runtime — `bin/minsky-run.sh` executes `scripts/runany-resolve-model.mjs`
// every iteration, which calls `decideRunAnyProvider`; the result
// overrides the config-sourced model for claude spawns. It also remains
// the audit reference for `scripts/runany-model-audit.mjs`.
//
// Source: parent task `runany-dynamic-model-or-local-fallback` slice 1.
//
// Decision order (first match wins — Pollack decision table, CACM 1962):
//   1. operator pin  → honor verbatim (`kind:"operator-pin"`)
//   2. all remote backends down  → `local` (`kind:"local-fallback"`)
//   3. otherwise  → delegate to `pickStrategicModel`
//      (`kind:"dynamic"`)

import { MODEL_CATALOG } from "./model-catalog.mjs";
import { pickStrategicModel } from "./strategic-model-router.mjs";

/**
 * @typedef {import("./model-catalog.mjs").ModelCatalogEntry} ModelCatalogEntry
 * @typedef {import("./strategic-model-router.mjs").HysteresisState} HysteresisState
 * @typedef {import("@minsky/token-monitor").RemainingFractions} RemainingFractions
 */

/**
 * Liveness of one configured remote backend.
 *
 * @typedef {Object} RemoteBackendLiveness
 * @property {string} id Stable backend id (e.g. `"claude"`).
 * @property {boolean} reachable `true` when the most recent probe succeeded.
 * @property {string} [reason] Short cause string when unreachable.
 */

/**
 * Input shape for {@link decideRunAnyProvider}.
 *
 * @typedef {Object} RunAnyProviderInput
 * @property {RemainingFractions} remaining
 * @property {readonly RemoteBackendLiveness[]} remoteBackends
 * @property {string} [operatorPin]
 * @property {readonly ModelCatalogEntry[]} [catalog]
 * @property {HysteresisState} [hysteresis]
 * @property {number} [hysteresisBand]
 */

/**
 * Output shape.
 *
 * @typedef {Object} RunAnyProviderDecision
 * @property {string} model
 * @property {"claude" | "local"} agent
 * @property {"operator-pin" | "dynamic" | "local-fallback"} kind
 * @property {string} reason
 */

/**
 * Pick the run-anywhere provider for the next iteration. Pure function.
 *
 * @otel tick-loop.runany-provider-decision.decide
 *
 * @param {RunAnyProviderInput} input
 * @returns {RunAnyProviderDecision}
 */
export function decideRunAnyProvider(input) {
  const catalog = input.catalog ?? MODEL_CATALOG;

  // Row 1 — operator pin honored verbatim.
  const pin = resolveOperatorPin(catalog, input);
  if (pin !== undefined) return pin;

  // Row 2 — every configured remote backend is down → switch fully to
  // local in ONE iteration. Never returns a wedged/hold state.
  if (allRemoteBackendsDown(input.remoteBackends)) {
    return localFallback(catalog, input.remoteBackends);
  }

  // Row 3 — dynamic: delegate to the budget-banded picker.
  /** @type {Parameters<typeof pickStrategicModel>[0]} */
  const pickInput = {
    remaining: input.remaining,
    catalog,
    ...(input.hysteresis === undefined ? {} : { hysteresis: input.hysteresis }),
    ...(input.hysteresisBand === undefined ? {} : { hysteresisBand: input.hysteresisBand }),
  };
  const dyn = pickStrategicModel(pickInput);
  return {
    model: dyn.model,
    agent: dyn.agent,
    kind: "dynamic",
    reason: `dynamic: ${dyn.reason}`,
  };
}

/**
 * Resolve the operator-pin row.
 *
 * @param {readonly ModelCatalogEntry[]} catalog
 * @param {RunAnyProviderInput} input
 * @returns {RunAnyProviderDecision | undefined}
 */
function resolveOperatorPin(catalog, input) {
  const pin = input.operatorPin;
  if (pin === undefined || pin.length === 0) return undefined;
  const picked = pickStrategicModel({ remaining: input.remaining, catalog, operatorPin: pin });
  if (picked.kind !== "operator-pin") return undefined;
  return {
    model: picked.model,
    agent: picked.agent,
    kind: "operator-pin",
    reason: picked.reason,
  };
}

/**
 * `true` when at least one remote backend is configured AND every one
 * of them is unreachable.
 *
 * @param {readonly RemoteBackendLiveness[]} backends
 * @returns {boolean}
 */
function allRemoteBackendsDown(backends) {
  return backends.length > 0 && backends.every((b) => b.reachable === false);
}

/**
 * Build the full-local fallback decision.
 *
 * @param {readonly ModelCatalogEntry[]} catalog
 * @param {readonly RemoteBackendLiveness[]} backends
 * @returns {RunAnyProviderDecision}
 */
function localFallback(catalog, backends) {
  const localRow = [...catalog]
    .filter((e) => e.agent === "local")
    .sort((a, b) => b.qualityTier - a.qualityTier)[0];
  const downIds = backends.map((b) => `${b.id}(${b.reason ?? "down"})`).join(",");
  return {
    model: localRow?.id ?? "local",
    agent: "local",
    kind: "local-fallback",
    reason: `local-fallback: all remote backends down [${downIds}] — switched fully to local`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Recover-probe flip-back (runtime-token-limit-auto-pivot-local-and-back).
//
// `decideRunAnyProvider` answers "which provider this iteration?" forward —
// it drops to local in ≤1 iteration when remote is down/exhausted. But once a
// run is on local, the forward decision keeps returning local for as long as
// the budget snapshot / backend liveness reads stale-down. `decideRecoverFlip-
// Back` answers the SEPARATE, smaller question: "having dropped to local at
// `localSinceMs`, and seeing this recover-probe verdict, should the run flip
// BACK to remote NOW?" It is the hysteresis gate around the forward decision —
// pure, no I/O, so the bash runner only does the probe I/O and the persistence.
//
// Decision (anti-flap, Schmidt et al. 2000 "Pattern-Oriented Software
// Architecture vol.2" — debounce; Beyer SRE 2016 — flap suppression):
//   - hold local until BOTH the minimum dwell has elapsed AND N consecutive
//     good probes have accrued (a single transient good probe never flips);
//   - any bad probe resets the consecutive-good counter to 0 (transient-fail-
//     no-flip);
//   - when both gates pass, flip back to remote — the caller then re-pins to
//     `MINSKY_STRATEGIC_PIN_MODEL` (pin-precedence) or lets the forward
//     decider re-pick.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Anti-flap defaults. Conservative: a full minute of dwell plus two
 * consecutive good probes before a flip-back. The Pivot widens these
 * (dwell↑, goodProbesNeeded≥3) if the recover-probe still oscillates.
 */
export const DEFAULT_RECOVER_DWELL_MS = 60_000;
export const DEFAULT_RECOVER_GOOD_PROBES = 2;

/**
 * Input shape for {@link decideRecoverFlipBack}. All numbers; no I/O. The
 * caller (`scripts/runany-resolve-model.mjs`) reads the persisted `local_since`
 * marker, runs the cheap remote recover-probe, and threads the results here.
 *
 * @typedef {Object} RecoverFlipBackInput
 * @property {"local" | "remote"} currentMode The mode the run is in right now.
 * @property {boolean} probeOk Did this iteration's remote recover-probe succeed?
 * @property {number} nowMs Epoch-ms clock reading (injected — pure).
 * @property {number} localSinceMs Epoch-ms when the run dropped to local. `0`/absent ⇒ never dropped.
 * @property {number} [dwellMs] Minimum ms on local before a flip-back is allowed. Default {@link DEFAULT_RECOVER_DWELL_MS}.
 * @property {number} [goodProbesNeeded] Consecutive good probes required. Default {@link DEFAULT_RECOVER_GOOD_PROBES}.
 * @property {number} [priorGoodProbes] Consecutive good probes accrued BEFORE this one (the persisted counter).
 */

/**
 * Output shape. `flipBack` is the only actionable bit; the rest is ledger
 * fuel (the caller stamps `reason` + `goodProbes` into the persisted marker
 * and the `provider-mode-transition` record).
 *
 * @typedef {Object} RecoverFlipBackDecision
 * @property {boolean} flipBack `true` ⇒ switch the run back to remote this iteration.
 * @property {number} goodProbes The updated consecutive-good-probe counter (persist this).
 * @property {string} reason Short machine-readable cause.
 */

/**
 * Pure recover-probe flip-back decision (anti-flap, dwell + N-consecutive-good).
 *
 * @otel tick-loop.runany-provider-decision.recover-flip-back
 *
 * @param {RecoverFlipBackInput} input
 * @returns {RecoverFlipBackDecision}
 */
export function decideRecoverFlipBack(input) {
  const dwellMs = input.dwellMs ?? DEFAULT_RECOVER_DWELL_MS;
  const goodProbesNeeded = input.goodProbesNeeded ?? DEFAULT_RECOVER_GOOD_PROBES;
  const priorGood = Number.isFinite(input.priorGoodProbes)
    ? Math.max(0, /** @type {number} */ (input.priorGoodProbes))
    : 0;

  // Not on local ⇒ nothing to recover. Counter stays parked at 0.
  if (input.currentMode !== "local") {
    return { flipBack: false, goodProbes: 0, reason: "not-on-local" };
  }

  // A bad probe resets the consecutive-good counter — the heart of anti-flap.
  if (input.probeOk !== true) {
    return { flipBack: false, goodProbes: 0, reason: "probe-bad-reset" };
  }

  // This is a good probe — accrue it.
  const goodProbes = priorGood + 1;

  // Dwell gate: never flip before the run has spent the minimum time on local
  // (suppresses a fast remote-flap that would oscillate the run every probe).
  const dwellElapsed = input.nowMs - input.localSinceMs;
  if (input.localSinceMs <= 0 || dwellElapsed < dwellMs) {
    return { flipBack: false, goodProbes, reason: "dwell-not-elapsed" };
  }

  // Consecutive-good gate: require N good probes in a row.
  if (goodProbes < goodProbesNeeded) {
    return { flipBack: false, goodProbes, reason: "awaiting-consecutive-good-probes" };
  }

  // Both gates pass — flip back. The caller re-pins or lets the forward
  // decider re-pick; the counter is consumed (reset to 0 for the next cycle).
  return {
    flipBack: true,
    goodProbes: 0,
    reason: `recover-flip-back: ${goodProbes} good probe(s) ≥ ${goodProbesNeeded}, dwell ${Math.round(
      dwellElapsed / 1000,
    )}s ≥ ${Math.round(dwellMs / 1000)}s`,
  };
}
