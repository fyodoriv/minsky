// <!-- scope: human-approved slices 1-4 of `runany-dynamic-model-or-local-fallback` — the pure unified pin>dynamic>local decision and its bin wiring; the task block in TASKS.md anchors this. -->
/**
 * `@minsky/tick-loop/runany-model-resolver` — slice 1 of
 * `runany-dynamic-model-or-local-fallback`.
 *
 * The pure unified "pin > dynamic > local" decision for the run-anywhere
 * entrypoint. Composes the two shipped pure deciders and adds the one
 * piece neither covers — a liveness aggregation across *every* configured
 * remote backend, not just claude:
 *
 *   1. **pin** — operator pinned a model (`MINSKY_STRATEGIC_PIN_MODEL` /
 *      explicit flag). Honored verbatim; never overridden. Short-circuits
 *      before the liveness scan and the catalog walk.
 *   2. **all-remote-down** — every configured remote backend probed
 *      unreachable. Switch fully to local *regardless of budget*. This is
 *      the gap: {@link decideProvider}'s chaos-table row 1 keeps the
 *      daemon on claude when the network is down (a transient
 *      `ENETUNREACH` is deliberately NOT a hard-limit signal), so a
 *      fully-offline remote wedges forever. The run-anywhere contract
 *      requires the opposite: when nothing remote answers, run local.
 *   3. **dynamic** — delegate to {@link pickStrategicModel}: highest-
 *      quality model whose per-window budget floors fit. The picker
 *      already returns the local tier when the budget is exhausted, so
 *      "budget exhausted → local" needs no extra branch here.
 *
 * Recovery (acceptance 4) is implicit: the function is pure, so the next
 * call with any remote backend reachable skips step 2 and returns the
 * dynamic pick — no sticky state, no flap-suppression needed at this
 * layer (the spawn wrapper's switchback discipline handles flap).
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision delegate** — Hughes 1989. Referentially transparent
 *     over (remaining, remoteBackends, localProbeResult, pin, catalog,
 *     hysteresis). No I/O, no clock, no env. Conformance: full.
 *   - **Composite Strategy** — Gamma 1994. Composes
 *     {@link pickStrategicModel} (the budget→model strategy) under a
 *     liveness gate. Conformance: full.
 *
 * Steady-state hypothesis (rule #9):
 *   - pin set & in catalog → that model, 100% of calls, any budget/liveness.
 *   - no pin, ≥1 remote reachable → model tier tracks remaining-budget band.
 *   - no pin, all remote unreachable → local, in this very call (≤1
 *     "iteration" to switch), 0 wedged outputs (the function never
 *     returns a non-dispatchable result — local is the always-available
 *     last resort, bootstrapped by the daemon if absent).
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | All remote backends unreachable AND local probe also unreachable | every `remoteBackends[i].reachable === false` and `localProbeResult.reachable === false` | graceful-degrade — still return the local tier with `source: "all-remote-down"` and a reason noting the daemon must bootstrap local (per `minsky-cli-auto-bootstrap-local-llm`). Returning local (not a `hold`) keeps the run-anywhere entrypoint from wedging. | paired test |
 * | 2 | Empty `remoteBackends` list (no remote configured) | `remoteBackends.length === 0` | NOT treated as "all down" (vacuous-truth guard). Fall through to the dynamic picker — a local-only operator with no remotes still gets the budget-driven pick (which is local anyway). | paired test |
 * | 3 | Operator pin not in catalog | `operatorPin` set to an id no catalog row has | mirror {@link pickStrategicModel}: ignore the bogus pin, fall through to liveness+dynamic. A typo'd pin must not silently override; the dynamic path is the safe default. | paired test |
 * | 4 | Pin set while all remote down | `operatorPin` valid, every remote unreachable | pin wins — step 1 short-circuits before the liveness scan. "Operator pin overrides everything" (acceptance 1) is absolute. | paired test |
 *
 * @module tick-loop/runany-model-resolver
 */

import type { RemainingFractions } from "@minsky/token-monitor";

import type { LocalProbeResult } from "./llm-provider-selector.js";
import { MODEL_CATALOG, type ModelCatalogEntry } from "./model-catalog.js";
import { type HysteresisState, pickStrategicModel } from "./strategic-model-router.js";

/**
 * Liveness of one configured remote backend. The run-anywhere entrypoint
 * builds this list by probing every configured remote provider (claude
 * and any others) — not just claude. The pure resolver only branches on
 * `reachable`; `reason` is passed through into the decision's `reason`
 * for the operator-facing iteration log (rule #4 visible-not-silent).
 */
export interface RemoteBackendLiveness {
  /** Backend id, e.g. `"claude"`, `"openrouter"`. For the reason string. */
  readonly id: string;
  /** Whether the most recent probe of this backend succeeded. */
  readonly reachable: boolean;
  /** When unreachable: short cause (`"ENETUNREACH"`, `"http 503"`, `"quota-exhausted"`). */
  readonly reason?: string;
}

/**
 * Input for {@link resolveRunAnyModel}.
 */
export interface ResolveRunAnyModelInput {
  /** Continuous remaining-fractions per budget window. */
  readonly remaining: RemainingFractions;
  /**
   * Liveness of every configured remote backend. Empty list = no remote
   * configured (local-only operator) — NOT treated as "all down".
   */
  readonly remoteBackends: readonly RemoteBackendLiveness[];
  /** Most recent local-stack probe result. */
  readonly localProbeResult: LocalProbeResult;
  /** Operator pin (env `MINSKY_STRATEGIC_PIN_MODEL` / explicit flag). */
  readonly operatorPin?: string;
  /** Catalog override; defaults to {@link MODEL_CATALOG}. */
  readonly catalog?: readonly ModelCatalogEntry[];
  /** Hysteresis state for the dynamic picker. */
  readonly hysteresis?: HysteresisState;
  /** Hysteresis band for the dynamic picker (fractional). */
  readonly hysteresisBand?: number;
}

/**
 * Decision returned to the run-anywhere entrypoint.
 */
export interface ResolveRunAnyModelOutput {
  readonly model: string;
  readonly agent: "claude" | "local";
  /**
   * Why this model was chosen:
   *  - `operator-pin` — pin honored verbatim;
   *  - `all-remote-down` — every remote unreachable, forced local;
   *  - `budget-exhausted-local` — dynamic picker fell to the local tier;
   *  - `dynamic` — dynamic picker chose a remote model by budget.
   */
  readonly source: "operator-pin" | "all-remote-down" | "budget-exhausted-local" | "dynamic";
  readonly reason: string;
  /** Pass-through of the local probe state for the iteration span. */
  readonly localReachable: boolean;
}

/**
 * Resolve the model+agent for the next run-anywhere iteration. Pure.
 *
 * Order is the contract order: pin > all-remote-down > dynamic. The pin
 * short-circuit runs before the liveness scan and the catalog walk —
 * pinned runs do zero liveness/budget work (rule #9 round-trip
 * elimination: the run-anywhere entrypoint calls this every iteration;
 * a pinned operator pays nothing for the dynamic machinery).
 *
 * @otel tick-loop.runany-model-resolver.resolve
 */
export function resolveRunAnyModel(input: ResolveRunAnyModelInput): ResolveRunAnyModelOutput {
  const catalog = input.catalog ?? MODEL_CATALOG;
  const localReachable = input.localProbeResult.reachable;

  // Step 1 — operator pin. Verbatim, never overridden. Short-circuits
  // before any liveness/budget computation (acceptance 1; rule #9
  // skip-earlier gate).
  const pinned = resolveOperatorPin(catalog, input.operatorPin);
  if (pinned !== undefined) {
    return {
      model: pinned.id,
      agent: pinned.agent,
      source: "operator-pin",
      reason: `operator-pin: ${pinned.id} honored verbatim — budget/liveness not consulted`,
      localReachable,
    };
  }

  // Step 2 — all configured remote backends unreachable. Force local
  // regardless of budget. Vacuous-truth guard: an empty backend list is
  // a local-only operator, NOT "all down" (chaos row 2).
  if (input.remoteBackends.length > 0 && input.remoteBackends.every((b) => !b.reachable)) {
    const local = resolveLocalEntry(catalog);
    const downSummary = summariseDownBackends(input.remoteBackends);
    const bootstrapNote = localReachable
      ? "local reachable"
      : `local probe ${input.localProbeResult.reason ?? "unreachable"} — daemon will bootstrap local`;
    return {
      model: local.id,
      agent: local.agent,
      source: "all-remote-down",
      reason: `all-remote-down: ${downSummary}; switched fully to local (${bootstrapNote})`,
      localReachable,
    };
  }

  // Step 3 — dynamic by remaining budget. The picker returns the local
  // tier itself when the budget is exhausted, so "budget exhausted →
  // local" needs no extra branch.
  const pick = pickStrategicModel({
    remaining: input.remaining,
    catalog,
    ...(input.hysteresis === undefined ? {} : { hysteresis: input.hysteresis }),
    ...(input.hysteresisBand === undefined ? {} : { hysteresisBand: input.hysteresisBand }),
  });
  const source: ResolveRunAnyModelOutput["source"] =
    pick.agent === "local" ? "budget-exhausted-local" : "dynamic";
  return {
    model: pick.model,
    agent: pick.agent,
    source,
    reason: `${source}: ${pick.reason}`,
    localReachable,
  };
}

/**
 * Resolve the operator pin to a catalog entry, or `undefined` when the
 * pin is unset/empty or names no catalog row. Mirrors
 * {@link pickStrategicModel}'s pin semantics (chaos row 3 — a bogus pin
 * is ignored, not honored).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function resolveOperatorPin(
  catalog: readonly ModelCatalogEntry[],
  pin: string | undefined,
): ModelCatalogEntry | undefined {
  if (pin === undefined) return undefined;
  const trimmed = pin.trim();
  if (trimmed.length === 0) return undefined;
  return catalog.find((e) => e.id === trimmed);
}

/**
 * The always-available local last resort: the catalog's lowest-tier
 * `agent: "local"` row, or a synthetic `{ id: "local" }` when a custom
 * catalog has none. Used by the all-remote-down branch.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function resolveLocalEntry(catalog: readonly ModelCatalogEntry[]): {
  readonly id: string;
  readonly agent: "local";
} {
  const localRow = catalog.find((e) => e.agent === "local");
  return { id: localRow?.id ?? "local", agent: "local" };
}

/**
 * One-line summary of the down backends for the reason string. Caps the
 * list so the iteration span stays readable.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function summariseDownBackends(backends: readonly RemoteBackendLiveness[]): string {
  const maxListed = 4;
  const parts = backends.slice(0, maxListed).map((b) => `${b.id}=${b.reason ?? "unreachable"}`);
  const suffix = backends.length > maxListed ? ` (+${backends.length - maxListed} more)` : "";
  return `${parts.join(", ")}${suffix}`;
}
