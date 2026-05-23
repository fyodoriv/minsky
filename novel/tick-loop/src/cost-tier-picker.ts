// <!-- scope: human-approved interactive-model-cost-picker slice 1 (P0 in TASKS.md: 6-tier brain+workers cost picker shown on first run; this slice ships the pure decision module). -->
/**
 * `@minsky/tick-loop/cost-tier-picker` — pure tier-definitions + decision
 * functions for the M1.3-related cost-transparency UX. Slice 1 of P0 task
 * `interactive-model-cost-picker`.
 *
 * The picker shows the operator 6 tiers (Opus+Opus, Opus+Sonnet, Sonnet+Sonnet,
 * Sonnet+local, local+local, Windsurf+Devin) at first-run when
 * `~/.minsky/config.json` lacks a `cost_tier` field. The operator picks once;
 * subsequent runs read the saved tier and skip the menu.
 *
 * Three pure surfaces in this slice:
 *
 *   1. {@link COST_TIERS} — readonly tuple of {@link CostTier} definitions.
 *      Each tier carries: id, label, brain/workers model identifiers, hourly
 *      cost estimate, recommended-for prose, and config-write field map.
 *
 *   2. {@link pickTierById} — pure lookup by id; returns null on unknown id.
 *      The CLI wrapper rejects unknown ids with a friendly error.
 *
 *   3. {@link tierToConfigPatch} — pure transformation: a tier id → the
 *      partial config.json patch the writer applies. The patch is a small
 *      shape `{ cost_tier, cloud_agent, cloud_agent_model, local_agent,
 *      local_agent_model }`. Slice 2 ships the atomic-write CLI; this slice
 *      keeps the transform pure so it can be unit-tested without disk I/O.
 *
 * Slice 2 ships the I/O surface (TTY detection, prompt rendering, atomic
 * config write); slice 3 wires it into `bin/minsky.mjs`'s no-args path;
 * slice 4 writes `docs/cost-tiers.md` with current published prices.
 *
 * Pattern: pure-decision-function-with-IO-at-edge (rule #2). The data IS
 * the documentation — anyone reading `COST_TIERS` sees every tier the
 * picker can produce without launching the picker.
 * Source: TASKS.md `interactive-model-cost-picker` § Details (the 6-tier
 * table + the recommended fallback for non-TTY contexts).
 * Anchor: Krug *Don't Make Me Think* 2014 (progressive disclosure — 6
 * tiers with one recommended default reduces the cognitive load of the
 * pick); Ries 2011 (validated learning — the chosen tier IS a user
 * preference signal we can learn from over time).
 */

/**
 * A cost tier presented to the operator on first-run. The id is the
 * stable key written to `~/.minsky/config.json`.
 */
export type CostTier = {
  /** Stable identifier persisted to config.json. */
  readonly id: CostTierId;
  /** One-line human label shown in the picker menu. */
  readonly label: string;
  /** Identifier of the brain agent (the planner). */
  readonly brainAgent: string;
  /** Identifier of the worker agent (per-task implementer). */
  readonly workersAgent: string;
  /** Rough $/hr estimate (USD). `0` for fully-local tiers. */
  readonly estimatedUsdPerHour: number;
  /** One-line "best for" recommendation shown next to the price. */
  readonly recommendedFor: string;
  /** Mapping the picker writes to config.json for this tier. */
  readonly configPatch: ConfigPatch;
};

export type CostTierId =
  | "opus-opus"
  | "opus-sonnet"
  | "sonnet-sonnet"
  | "sonnet-local"
  | "local-local"
  | "windsurf-devin";

/**
 * The subset of `~/.minsky/config.json` the picker writes. Other fields
 * are untouched by the slice-1 module.
 */
export type ConfigPatch = {
  readonly cost_tier: CostTierId;
  readonly cloud_agent: string | null;
  readonly cloud_agent_model: string | null;
  readonly local_agent: string | null;
  readonly local_agent_model: string | null;
};

/**
 * The 6-tier menu, in the order shown to the operator. Order matters
 * because the picker labels them `(1)`–`(6)` and tier `(2)` is the
 * recommended default (the prose hint in the menu prints "(DEFAULT)").
 *
 * Cost estimates are deliberately conservative — they're the
 * upper-bound of "typical 8h session" cost based on published provider
 * pricing as of the slice ship date. The estimates carry a `~` prefix
 * in display to set expectations.
 */
export const COST_TIERS: readonly CostTier[] = [
  {
    id: "opus-opus",
    label: "Opus brain + Opus workers",
    brainAgent: "claude",
    workersAgent: "claude",
    estimatedUsdPerHour: 40,
    recommendedFor: "complex codebases, architecture-level work, multi-file refactors",
    configPatch: {
      cost_tier: "opus-opus",
      cloud_agent: "claude",
      cloud_agent_model: "claude-opus-4-7-max",
      local_agent: null,
      local_agent_model: null,
    },
  },
  {
    id: "opus-sonnet",
    label: "Opus brain + Sonnet workers (DEFAULT)",
    brainAgent: "claude",
    workersAgent: "claude",
    estimatedUsdPerHour: 10,
    recommendedFor: "most repos — balanced quality/cost",
    configPatch: {
      cost_tier: "opus-sonnet",
      cloud_agent: "claude",
      cloud_agent_model: "claude-sonnet-4-5",
      local_agent: null,
      local_agent_model: null,
    },
  },
  {
    id: "sonnet-sonnet",
    label: "Sonnet brain + Sonnet workers",
    brainAgent: "claude",
    workersAgent: "claude",
    estimatedUsdPerHour: 4,
    recommendedFor: "high-volume simple tasks, lint sweeps, doc cleanups",
    configPatch: {
      cost_tier: "sonnet-sonnet",
      cloud_agent: "claude",
      cloud_agent_model: "claude-sonnet-4-5",
      local_agent: null,
      local_agent_model: null,
    },
  },
  {
    id: "sonnet-local",
    label: "Sonnet brain + local workers",
    brainAgent: "claude",
    workersAgent: "aider",
    estimatedUsdPerHour: 2,
    recommendedFor: "budget-conscious operators with a capable local GPU",
    configPatch: {
      cost_tier: "sonnet-local",
      cloud_agent: "claude",
      cloud_agent_model: "claude-sonnet-4-5",
      local_agent: "aider",
      local_agent_model: "qwen3-coder-30b",
    },
  },
  {
    id: "local-local",
    label: "Local brain + local workers (zero cloud)",
    brainAgent: "aider",
    workersAgent: "aider",
    estimatedUsdPerHour: 0,
    recommendedFor: "offline, privacy-sensitive, or token-exhausted — full local stack",
    configPatch: {
      cost_tier: "local-local",
      cloud_agent: null,
      cloud_agent_model: null,
      local_agent: "aider",
      local_agent_model: "qwen3-coder-30b",
    },
  },
  {
    id: "windsurf-devin",
    label: "Windsurf + Devin workers",
    brainAgent: "windsurf",
    workersAgent: "devin",
    estimatedUsdPerHour: 8,
    recommendedFor: "existing Devin/Windsurf subscribers — subscription-flat",
    configPatch: {
      cost_tier: "windsurf-devin",
      cloud_agent: "devin",
      cloud_agent_model: null,
      local_agent: null,
      local_agent_model: null,
    },
  },
] as const;

/**
 * The id of the tier marked DEFAULT in the menu. Slice 2's non-TTY
 * fallback writes this tier when no operator input is possible.
 */
export const DEFAULT_TIER_ID: CostTierId = "opus-sonnet";

/**
 * Pure lookup by id. Returns null on unknown id so the CLI wrapper can
 * emit a friendly error instead of throwing inside the pure module.
 *
 * @otel-exempt pure data lookup over a frozen constant; no I/O, no model call, no spawn — instrumentation here would add noise without telling the operator anything they can't see from the picker menu itself
 * @param id the tier id, typically read from menu input or config.json
 * @returns the matching {@link CostTier}, or null if no tier has that id
 */
export function pickTierById(id: string): CostTier | null {
  return COST_TIERS.find((t) => t.id === id) ?? null;
}

/**
 * Pure transformation: tier id → config.json patch the writer applies.
 * Returns null on unknown id; slice 2's writer treats that as a no-op
 * (writes nothing, returns error). The patch is read-only — callers
 * spread it over the existing config rather than mutating.
 *
 * @otel-exempt pure data transformation, no I/O — slice 2's atomic config.json write is the right span surface for this concern (will carry `cost-tier-picker.write` with the chosen tier as a span attribute)
 * @param id the chosen tier id
 * @returns the partial config patch, or null on unknown id
 */
export function tierToConfigPatch(id: string): ConfigPatch | null {
  const tier = pickTierById(id);
  return tier ? tier.configPatch : null;
}

/**
 * The recommended default tier — slice 2's non-TTY path falls back to
 * this. Defined here (not at the call site) so the recommendation
 * remains a single source of truth.
 *
 * @otel-exempt pure constant resolver; the only failure mode is the constitution-level invariant breaking, which throws (rule #6) and surfaces on the call site's span — instrumentation here would double-count
 * @returns the {@link CostTier} marked as default
 * @throws if `DEFAULT_TIER_ID` doesn't match any tier in {@link COST_TIERS}
 *   (a constitution-level invariant; rule #6 — let it crash if the
 *   default disappears)
 */
export function getDefaultTier(): CostTier {
  const tier = pickTierById(DEFAULT_TIER_ID);
  if (!tier) {
    throw new Error(
      `cost-tier-picker invariant violated: DEFAULT_TIER_ID="${DEFAULT_TIER_ID}" not found in COST_TIERS`,
    );
  }
  return tier;
}
