// <!-- scope: human-approved phase-11b-delete-tick-loop-multistep step 2 — ports the runany provider decision out of `novel/tick-loop/src/runany-provider-decision.ts` (deletion target) to `scripts/lib/`. Same decision-table contract, same 3 kinds (operator-pin / dynamic / local-fallback). -->
// Runany provider decision — the unified "pin > dynamic > local"
// decision for the zero-arg run-anywhere entrypoint.
//
// History: originally `novel/tick-loop/src/runany-provider-decision.ts`.
// Ported to .mjs / JSDoc in phase-11b step 2. The bash runner doesn't
// consume this directly (it hard-codes openhands); this module survives
// as the lint-only audit reference for `scripts/runany-model-audit.mjs`.
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
