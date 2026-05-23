// <!-- scope: human-approved interactive-model-cost-picker slice 3a (P0 in TASKS.md: pure flow-decision function over the slice-1+2 substrate, before slice 3b ships the readline-prompt CLI wrapper). -->
/**
 * `@minsky/tick-loop/cost-tier-picker-flow` — slice 3a of P0
 * `interactive-model-cost-picker`. Pure decision function that takes the
 * operator's environment state and returns ONE of three verdicts:
 *
 *   1. `{ kind: "skip", tier, summaryLine }` — the operator's
 *      `~/.minsky/config.json` already carries a valid `cost_tier`. The
 *      CLI prints a one-line summary and continues straight to the
 *      autonomous-run path (no prompt, no menu).
 *
 *   2. `{ kind: "use-default", tier, reason }` — the operator's config
 *      has no `cost_tier` AND the process is not running in a TTY
 *      (launchd, SSH-without-tty, CI). The CLI logs that the DEFAULT
 *      tier is being applied and proceeds without prompting. Matches
 *      the parent task's Pivot field verbatim.
 *
 *   3. `{ kind: "prompt", default }` — the operator's config has no
 *      `cost_tier` AND we have a TTY. Slice 3b's CLI wrapper renders
 *      the menu via {@link renderTierMenu}, loops on
 *      {@link parseUserSelection} until valid input arrives, then
 *      writes via {@link writeConfigPatchAtomic}.
 *
 * The decision is pure — no fs reads, no console output, no readline
 * prompt. Slice 3b consumes this verdict + the slice-2 surfaces to
 * implement the actual run. Splitting the decision from the I/O lets
 * every branching condition be unit-tested without simulating stdin /
 * stdout / process.env.
 *
 * Pattern: pure-decision-function (rule #2) — the I/O is the executor's
 * concern. Sibling: `cost-tier-picker.ts` (data), `cost-tier-picker-io.ts`
 * (menu/parser/writer). Source: TASKS.md `interactive-model-cost-picker`
 * § Details + § Pivot ("if interactive TTY detection is unreliable …
 * default to tier 2 (Opus+Sonnet) in non-interactive mode").
 * Anchor: Saltzer & Schroeder 1975 (least-surprise default — the
 * non-TTY path uses the same tier the menu defaults to, so the
 * operator sees the same chosen tier whether they ran with or without
 * a terminal); Hunt & Thomas 1999 *The Pragmatic Programmer* Tip 32
 * (crash early — an unknown `cost_tier` in config.json fails fast
 * with a verdict the CLI can show, not silently in the middle of an
 * 8h run).
 */

import type { CostTier } from "./cost-tier-picker.js";

import { getDefaultTier, pickTierById } from "./cost-tier-picker.js";

/**
 * The environment state the flow decider needs. Pure inputs only — no
 * fs handles, no streams. Slice 3b's CLI wrapper reads the actual
 * config.json + checks `process.stdout.isTTY` and passes the result
 * here.
 */
export type FlowEnvironment = {
  /**
   * The `cost_tier` field already present in `~/.minsky/config.json`,
   * OR null when no config exists yet, OR a string value the file
   * contained (which may be a recognised tier id, an obsolete value
   * from a future schema, or garbage from a corrupted file).
   */
  readonly existingCostTier: string | null;
  /**
   * Is the controlling process running in a TTY? Slice 3b reads
   * `process.stdout.isTTY && process.stdin.isTTY`.
   */
  readonly isTty: boolean;
};

/**
 * Discriminated union over the three flow verdicts. Slice 3b's CLI
 * branches on `verdict.kind`.
 */
export type FlowDecision =
  | {
      readonly kind: "skip";
      /** The valid tier the operator's config already carries. */
      readonly tier: CostTier;
      /** One-line summary the CLI prints before continuing. */
      readonly summaryLine: string;
    }
  | {
      readonly kind: "use-default";
      /** The DEFAULT tier the CLI writes + uses. */
      readonly tier: CostTier;
      /** Machine-readable reason; used for logs + tests. */
      readonly reason: "no-tty" | "config-has-unknown-tier";
      /** Human-readable note the CLI logs (visible-not-silent). */
      readonly noteLine: string;
    }
  | {
      readonly kind: "prompt";
      /** The DEFAULT tier shown in the prompt's `[default: ...]` hint. */
      readonly default: CostTier;
    };

/**
 * Pure flow decider. Branches on whether the operator's config has a
 * recognised tier + whether we have a TTY for a prompt.
 *
 * @otel-exempt pure decision over already-collected state; slice 3b's CLI wrapper carries the executor span (`cost-tier-picker.prompt` / `cost-tier-picker.skip` / `cost-tier-picker.use-default`)
 * @param env the {@link FlowEnvironment} captured by slice 3b's I/O reader
 * @returns the {@link FlowDecision} the executor branches on
 */
export function decidePickerFlow(env: FlowEnvironment): FlowDecision {
  // (1) The config carries a tier — most common steady-state.
  if (env.existingCostTier !== null) {
    const tier = pickTierById(env.existingCostTier);
    if (tier !== null) {
      return {
        kind: "skip",
        tier,
        summaryLine: formatSkipSummary(tier),
      };
    }
    // Config has a value but it's not a recognised tier — fall through
    // to use-default. This handles corrupted configs + schema drift.
    return {
      kind: "use-default",
      tier: getDefaultTier(),
      reason: "config-has-unknown-tier",
      noteLine: formatUnknownTierNote(env.existingCostTier, getDefaultTier()),
    };
  }
  // (2) No tier in config + no TTY → use the DEFAULT, log it.
  if (!env.isTty) {
    return {
      kind: "use-default",
      tier: getDefaultTier(),
      reason: "no-tty",
      noteLine: formatNoTtyNote(getDefaultTier()),
    };
  }
  // (3) No tier in config + TTY → prompt the operator.
  return { kind: "prompt", default: getDefaultTier() };
}

/**
 * Format the one-line summary for the "skip" branch.
 *   "Using tier: Opus+Sonnet (~$10/hr). Change: minsky config"
 *
 * @otel-exempt pure formatter — the executor span carries the rendered text as an attribute if needed
 */
function formatSkipSummary(tier: CostTier): string {
  const price = tier.estimatedUsdPerHour === 0 ? "$0/hr" : `~$${tier.estimatedUsdPerHour}/hr`;
  return `Using tier: ${tier.label.replace(/ \(DEFAULT\)$/, "")} (${price}). Change: minsky config`;
}

/**
 * Format the note line for the "use-default + no-tty" branch.
 *   "No TTY detected; applying default tier: Opus+Sonnet (~$10/hr)."
 *
 * @otel-exempt pure formatter — the executor span carries the rendered text as an attribute if needed
 */
function formatNoTtyNote(def: CostTier): string {
  const price = def.estimatedUsdPerHour === 0 ? "$0/hr" : `~$${def.estimatedUsdPerHour}/hr`;
  return `No TTY detected; applying default tier: ${def.label.replace(/ \(DEFAULT\)$/, "")} (${price}).`;
}

/**
 * Format the note line for the "use-default + unknown-tier" branch.
 *   "config.json has unknown cost_tier="...", falling back to default: Opus+Sonnet."
 *
 * @otel-exempt pure formatter — the executor span carries the rendered text as an attribute if needed
 */
function formatUnknownTierNote(unknownId: string, def: CostTier): string {
  return `config.json has unknown cost_tier="${unknownId}", falling back to default: ${def.label.replace(/ \(DEFAULT\)$/, "")}.`;
}
