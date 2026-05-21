// <!-- scope: human-approved runany-dynamic-model-or-local-fallback slice 1 (operator 2026-05-16 directive — unified pin>dynamic>local + multi-backend liveness) -->
/**
 * `@minsky/tick-loop/runany-provider-decision` — slice 1 of
 * `runany-dynamic-model-or-local-fallback`.
 *
 * The unified "pin > dynamic > local" decision for the zero-arg
 * run-anywhere entrypoint. Composes the two shipped pure deciders
 * (rule #1 — compose, don't reinvent):
 *   - `pickStrategicModel` (`claude-usage-aware-strategic-model-router`):
 *     operator pin + remaining-budget-banded model selection.
 *   - the local-llm fallback contract (`llm-provider-selector`): switch
 *     fully to the local stack when remote is unusable.
 *
 * New surface vs. the two it composes: a liveness signal across ALL
 * configured remote backends (not just claude). When every configured
 * remote backend probe is unreachable (or the budget is exhausted, which
 * the dynamic picker already handles), the decision switches fully +
 * automatically to `local` within ONE iteration and never returns a
 * wedged/hold state — `local` is the always-available last resort (the
 * catalog's tier-3 row). Because the function is pure and recomputed
 * each iteration, recovery to remote is automatic the first iteration a
 * remote backend probes reachable again.
 *
 * Decision order (first match wins — Pollack decision table, CACM 1962):
 *   1. operator pin  → honor verbatim, never override (`kind:"operator-pin"`)
 *   2. all remote backends down  → `local` (`kind:"local-fallback"`)
 *   3. otherwise  → delegate to `pickStrategicModel` by remaining budget
 *      (`kind:"dynamic"`; a budget-exhausted dynamic pick is still the
 *      local catalog row, so the daemon keeps running either way)
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision delegate** — Hughes 1989. Referentially
 *     transparent over its inputs (remaining, pin, backend liveness,
 *     hysteresis). No I/O, no clock, no env. Conformance: full.
 *   - **Strategy seam** — Gamma 1994. Composes `pickStrategicModel`
 *     (the dynamic strategy) behind the unified decision. Conformance:
 *     full.
 *   - **Decision table** — Pollack, *CACM* 1962. The body is the
 *     ordered table above; the first matching row fires. Conformance:
 *     full.
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | All remote backends down | every `remoteBackends[i].reachable === false` | switch to `local` in ≤1 iteration; `kind:"local-fallback"`; never `hold`/wedge | `runany-provider-decision.test.ts` |
 * | 2 | Operator pin set while all remote down | `operatorPin` set AND every backend down | honor the pin verbatim — the operator's explicit choice overrides liveness (rule #7 operator escape hatch) | `runany-provider-decision.test.ts` |
 * | 3 | Empty backend list (no remote configured) | `remoteBackends.length === 0` | treat as "no remote to fall back from" — defer to the dynamic picker (budget still gates local) | `runany-provider-decision.test.ts` |
 * | 4 | Remote recovers | a previously-down backend probes reachable | next iteration returns a remote model (dynamic) — automatic switchback; no flap state held here (hysteresis is the picker's job) | `runany-provider-decision.test.ts` |
 * | 5 | Unknown pin (typo) | `operatorPin` not in catalog | graceful-degrade — `pickStrategicModel` ignores the bad pin and the dynamic walk runs (same as the picker's chaos row 5) | `runany-provider-decision.test.ts` |
 *
 * Steady-state hypothesis (rule #9):
 *   - pin set → pinned model in 100% of iterations regardless of budget/liveness
 *   - no pin, ≥1 remote reachable → model tracks remaining-budget bands
 *   - no pin, all remote down → `local` within ≤1 iteration, ≥95% local
 *     dispatch thereafter, 0 wedged/hold iterations
 *
 * @module tick-loop/runany-provider-decision
 */

import type { RemainingFractions } from "@minsky/token-monitor";

import { MODEL_CATALOG, type ModelCatalogEntry } from "./model-catalog.js";
import { type HysteresisState, pickStrategicModel } from "./strategic-model-router.js";

/**
 * Liveness of one configured remote backend (claude, or any future
 * remote provider). The wiring layer probes each configured backend and
 * passes the result array; the pure function only branches on
 * `reachable`.
 */
export interface RemoteBackendLiveness {
  /** Stable backend id (e.g. `"claude"`). */
  readonly id: string;
  /** `true` when the most recent probe of this backend succeeded. */
  readonly reachable: boolean;
  /** Short cause string when `reachable === false` (for the iteration log). */
  readonly reason?: string;
}

/**
 * Input shape for {@link decideRunAnyProvider}.
 */
export interface RunAnyProviderInput {
  /** Continuous remaining-fractions per window (token-monitor helper output). */
  readonly remaining: RemainingFractions;
  /**
   * Liveness of every configured remote backend. Empty = no remote
   * configured (the budget-banded picker still governs local).
   */
  readonly remoteBackends: readonly RemoteBackendLiveness[];
  /** Operator-literal pin (env `MINSKY_STRATEGIC_PIN_MODEL`). Honored verbatim. */
  readonly operatorPin?: string;
  /** Optional catalog override; defaults to {@link MODEL_CATALOG}. */
  readonly catalog?: readonly ModelCatalogEntry[];
  /** Hysteresis state forwarded to the dynamic picker. */
  readonly hysteresis?: HysteresisState;
  /** Hysteresis band forwarded to the dynamic picker. */
  readonly hysteresisBand?: number;
}

/**
 * Output shape — what the run-anywhere wiring layer consumes.
 */
export interface RunAnyProviderDecision {
  readonly model: string;
  readonly agent: "claude" | "local";
  readonly kind: "operator-pin" | "dynamic" | "local-fallback";
  readonly reason: string;
}

/**
 * Pick the run-anywhere provider for the next iteration. Pure function;
 * see the module JSDoc for the decision-table contract and the
 * failure-mode chaos table.
 *
 * @otel tick-loop.runany-provider-decision.decide
 */
export function decideRunAnyProvider(input: RunAnyProviderInput): RunAnyProviderDecision {
  const catalog = input.catalog ?? MODEL_CATALOG;

  // Row 1 — operator pin honored verbatim (delegated to the picker,
  // which validates the pin against the catalog). A valid pin wins over
  // budget AND liveness: the operator's explicit choice is final.
  const pin = resolveOperatorPin(catalog, input);
  if (pin !== undefined) return pin;

  // Row 2 — every configured remote backend is down → switch fully to
  // local in ONE iteration. Never returns a wedged/hold state.
  if (allRemoteBackendsDown(input.remoteBackends)) {
    return localFallback(catalog, input.remoteBackends);
  }

  // Row 3 — dynamic: delegate to the budget-banded picker. A
  // budget-exhausted pick is still the local catalog row, so the daemon
  // keeps running either way; recovery to remote is automatic the next
  // iteration a backend probes reachable AND budget allows.
  const dyn = pickStrategicModel({
    remaining: input.remaining,
    catalog,
    ...(input.hysteresis === undefined ? {} : { hysteresis: input.hysteresis }),
    ...(input.hysteresisBand === undefined ? {} : { hysteresisBand: input.hysteresisBand }),
  });
  return {
    model: dyn.model,
    agent: dyn.agent,
    kind: "dynamic",
    reason: `dynamic: ${dyn.reason}`,
  };
}

/**
 * Resolve the operator-pin row. Returns the pinned decision when the pin
 * maps to a catalog entry; `undefined` otherwise (graceful-degrade — the
 * caller falls through to the dynamic walk, mirroring the picker's
 * unknown-pin chaos row).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function resolveOperatorPin(
  catalog: readonly ModelCatalogEntry[],
  input: RunAnyProviderInput,
): RunAnyProviderDecision | undefined {
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
 * `true` when at least one remote backend is configured AND every one of
 * them is unreachable. An empty list means "no remote configured" — not
 * "all remote down" — so the dynamic picker still governs.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function allRemoteBackendsDown(backends: readonly RemoteBackendLiveness[]): boolean {
  return backends.length > 0 && backends.every((b) => b.reachable === false);
}

/**
 * Build the full-local fallback decision. Prefers the catalog's
 * lowest-tier local row; synthesises a `local` entry when the catalog
 * has none (the always-available last resort — never `hold`).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function localFallback(
  catalog: readonly ModelCatalogEntry[],
  backends: readonly RemoteBackendLiveness[],
): RunAnyProviderDecision {
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
