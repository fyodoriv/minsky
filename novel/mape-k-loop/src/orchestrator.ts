/**
 * `@minsky/mape-k-loop/orchestrator` — pure I/O orchestrator above
 * `tick(...)` (Kephart & Chess, "The Vision of Autonomic Computing",
 * *IEEE Computer* 2003).
 *
 * Where `tick(...)` runs one full M+A+P+E+K cycle over already-parsed inputs,
 * `orchestrate(...)` is the next layer up: it composes the tick with
 * (a) the rollout-draft shape the CLI will turn into a draft branch + PR, and
 * (b) the Knowledge writes the CLI will append to `constraints.md` and
 * (conditionally) `research.md`. NO direct I/O — same shape as `tick`; the
 * CLI wrapper (`bin/mape-k-orchestrator.mjs`) is the I/O boundary
 * (Martin, *Clean Architecture*, 2017).
 *
 * The orchestrator's only behavioural addition over `tick` is the
 * **rollout draft** that fires when `tick` returns `decision: 'rollout'`:
 * a synthesised `variantId / branchSlug / experimentYaml` triple the CLI
 * uses to open a DRAFT pull request. The draft NEVER auto-merges (rule #7 —
 * a load-bearing safety property).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:               MAPE-K orchestration layer per Kephart-Chess
 *                                2003 + pure-function-with-I/O-at-edge per
 *                                Martin 2017. Conformance: full.
 *   - `orchestrate(...)`:        Pure decision function. Conformance: full —
 *                                no I/O, clock injected, optimizer injected.
 *   - Rollout-draft shape:       Operator escape hatch (Beyer SRE 2016 Ch. 17)
 *                                — drafts are not auto-merged; a human review
 *                                gate is the load-bearing safety property.
 *                                Conformance: full.
 *
 * @module mape-k-loop/orchestrator
 */

import type { PromptOptimizer } from "@minsky/prompt-optimizer";

import type { ExecuteResult } from "./execute.js";
import { type TickEvent, type TickResult, tick } from "./index.js";
import type { VerdictLogEntry } from "./knowledge.js";
import type { Advisory, CiRun, ExperimentRecord, MonitorInput } from "./monitor.js";
import type { RolloutHistory } from "./sustained-gain.js";

/**
 * Draft variant payload the CLI turns into a draft branch + PR. The CLI is
 * responsible for git plumbing; this struct is pure data.
 */
export interface RolloutDraft {
  /** Variant id (kebab-case) — drives the branch slug. */
  readonly variantId: string;
  /** Suggested branch slug (`mape-k-rollout-<variantId>-<isoDate>`). */
  readonly branchSlug: string;
  /**
   * Full text of the `EXPERIMENT.yaml` to commit on the draft branch. Carries
   * the predicted gain (mean A/B score for the winning variant) so the rule-#9
   * pre-registration discipline holds across the rollout (Munafò et al. 2017).
   */
  readonly experimentYaml: string;
  /** The mutation rationale carried over from the Plan phase. */
  readonly mutation: string;
  /** Free-form rationale carried over from the Plan phase. */
  readonly rationale: string;
}

/** Knowledge-side writes the CLI appends to disk. */
export interface OrchestratorKnowledge {
  /** Markdown block to append to `constraints.md` (always non-empty). */
  readonly constraintsAppend: string;
  /**
   * Proposed amendment to `research.md` § "DSPy fit" (Munafò 2017
   * pre-registration drift) — `null` when MAE is below threshold.
   */
  readonly researchAmendmentProposal: string | null;
}

/** Argument bundle for `orchestrate`. */
export interface OrchestrateArgs {
  /** Verdict log assembled from `experiment-store/*.jsonl` + EXPERIMENT.yaml. */
  readonly verdictLog: readonly VerdictLogEntry[];
  /**
   * Tail of `novel/mape-k-loop/constraints.md` — the orchestrator currently
   * uses this only to detect cold-start (empty file → first run); future
   * versions will use it for category-level analysis. Kept in the surface
   * now so the CLI doesn't have to refactor when that lands.
   */
  readonly constraintsMdTail: string;
  /**
   * Map of skill-id → current prompt (read by the CLI from
   * `.claude/skills/<id>/SKILL.md`). The orchestrator picks the prompt
   * keyed by the top-constraint ruleId when present, else falls back
   * to a deterministic default.
   */
  readonly currentPrompts: Readonly<Record<string, string>>;
  /** Prompt optimizer Strategy (PR #58). Inject `StubPromptOptimizer` in tests. */
  readonly optimizer: PromptOptimizer;
  /** Append-only rollout history both Execute guards consume. */
  readonly history: RolloutHistory;
  /** Reference clock (injected for deterministic tests). */
  readonly now: Date;
  /**
   * Optional ingest-mode flag. When `true`, the orchestrator runs Monitor +
   * Knowledge but skips Plan/Execute entirely — used by the
   * `experiment-tracker-knowledge-ingestion` workflow to ingest verdicts
   * without trying to roll anything out (rule #7 — separation of concerns).
   */
  readonly ingestMode?: boolean;
  /**
   * Maximum number of rollout drafts the orchestrator may emit per call.
   * v0 plan emits ≤3 variants; this caps how many of those become drafts.
   * Default 1 (one rollout per orchestrator invocation — operator review
   * cadence is the constraint).
   */
  readonly maxRollouts?: number;
  /** Optional CI runs (only used when no top-constraint synthesised). */
  readonly ciRuns?: readonly CiRun[];
  /** Optional advisories (already parsed). */
  readonly advisories?: readonly Advisory[];
  /** Optional experiment records (already parsed). */
  readonly experimentRecords?: readonly ExperimentRecord[];
  /**
   * Optional async metric — when omitted, a deterministic default scores
   * variants by the length of their generated text (longer = lower score),
   * giving the CLI a sane default without a hard `metric` requirement.
   */
  readonly metric?: (output: string, input: Readonly<Record<string, unknown>>) => Promise<number>;
  /** Optional eval-set; defaults to a single synthetic prompt. */
  readonly evalSet?: readonly Readonly<Record<string, unknown>>[];
  /** Optional calibration drift threshold (forwarded to Knowledge). */
  readonly calibrationDriftThreshold?: number;
  /** Optional emit seam (forwarded to `tick`). */
  readonly emit?: (event: TickEvent) => void;
}

/** Outcome of `orchestrate(...)` — same data shape regardless of decision. */
export interface OrchestrateResult {
  /** The full `tick` result, untouched. */
  readonly tickResult: TickResult;
  /**
   * The draft to ship — present only when the tick decided `rollout` AND
   * `ingestMode` is false. The CLI uses this to open a draft branch + PR.
   */
  readonly rolloutDraft?: RolloutDraft;
  /** Knowledge-side writes (always present — Helland 2007 every tick logged). */
  readonly knowledge: OrchestratorKnowledge;
}

/** Default suffix used when the variant id can't be derived. */
export const DEFAULT_BRANCH_PREFIX = "mape-k-rollout";

/**
 * Compose `tick(...)` with the rollout-draft + Knowledge surfaces the CLI
 * needs to write to disk.
 *
 * Cold-start path (no verdicts AND no advisories AND no CI failures): tick
 * still runs (Knowledge logs a no-op); no rollout draft is emitted.
 *
 * Ingest-mode path (`ingestMode: true`): the orchestrator skips Plan/Execute
 * entirely — even if a constraint exists. Used by the experiment-tracker
 * ingestion workflow to update `constraints.md` without rolling anything out.
 *
 * Rollout-cap path (`maxRollouts: 0`): tick runs as usual; if it decides
 * `rollout`, the orchestrator suppresses the draft and records the
 * suppression in the constraints append.
 *
 * @otel mape-k-loop.orchestrate
 */
export async function orchestrate(args: OrchestrateArgs): Promise<OrchestrateResult> {
  const monitorInput = buildMonitorInput(args);
  const ingestMode = args.ingestMode === true;
  const maxRollouts = args.maxRollouts ?? 1;
  const basePrompt = pickBasePrompt(args.currentPrompts);
  const tickResult = await runTickFromArgs({ args, monitorInput, ingestMode, basePrompt });
  const knowledge: OrchestratorKnowledge = {
    constraintsAppend: tickResult.knowledgeWrites.constraintsAppend,
    researchAmendmentProposal: tickResult.knowledgeWrites.researchMdAmendmentProposal,
  };
  if (ingestMode) {
    return { tickResult, knowledge };
  }
  const draft = maybeBuildDraft({
    tickResult,
    maxRollouts,
    now: args.now,
    basePrompt,
  });
  if (draft === null) {
    return { tickResult, knowledge };
  }
  return { tickResult, rolloutDraft: draft, knowledge };
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

/** @otel-exempt pure helper of `orchestrate`. */
function buildMonitorInput(args: OrchestrateArgs): MonitorInput {
  return {
    ciRuns: args.ciRuns ?? [],
    advisories: args.advisories ?? [],
    experimentRecords: args.experimentRecords ?? [],
  };
}

/**
 * Derive the base prompt from the supplied skill prompts. v0: take the first
 * entry by alphabetical key; falls back to a deterministic default when
 * empty so cold-start ticks still produce a draft (Helland 2007 — the audit
 * trail must not have a hole on cold start).
 *
 * @otel-exempt pure helper of `orchestrate`.
 */
function pickBasePrompt(prompts: Readonly<Record<string, string>>): string {
  const keys = Object.keys(prompts).sort();
  if (keys.length === 0) return "you are a helpful assistant";
  const first = keys[0];
  if (first === undefined) return "you are a helpful assistant";
  const value = prompts[first];
  return typeof value === "string" && value.length > 0 ? value : "you are a helpful assistant";
}

interface RunTickInput {
  readonly args: OrchestrateArgs;
  readonly monitorInput: MonitorInput;
  readonly ingestMode: boolean;
  readonly basePrompt: string;
}

/**
 * Build the `TickArgs` for one orchestrator run, including the empty-input
 * shortcut for ingest mode (which still runs Knowledge over the verdictLog).
 *
 * @otel-exempt pure helper of `orchestrate`.
 */
async function runTickFromArgs(input: RunTickInput): Promise<TickResult> {
  const monitorInput = input.ingestMode
    ? { ciRuns: [], advisories: [], experimentRecords: [] }
    : input.monitorInput;
  const evalSet = input.args.evalSet ?? [{ task: "summarise the input concisely" }];
  const metric = input.args.metric ?? defaultMetric;
  const baseTickArgs = {
    monitorInput,
    verdictLog: input.args.verdictLog,
    history: input.args.history,
    evalSet,
    optimizer: input.args.optimizer,
    metric,
    basePrompt: input.basePrompt,
    now: input.args.now,
  };
  const withDrift =
    input.args.calibrationDriftThreshold === undefined
      ? baseTickArgs
      : { ...baseTickArgs, calibrationDriftThreshold: input.args.calibrationDriftThreshold };
  const withEmit =
    input.args.emit === undefined ? withDrift : { ...withDrift, emit: input.args.emit };
  return tick(withEmit);
}

/**
 * Default metric for the orchestrator. Deterministic and pure: the score is
 * 1 / (1 + completion-length) — shorter outputs win, biasing toward the
 * `direct-answer` mutation. Tests inject their own metric for explicit
 * preference.
 *
 * @otel-exempt pure helper of `orchestrate`.
 */
async function defaultMetric(
  output: string,
  _input: Readonly<Record<string, unknown>>,
): Promise<number> {
  return 1 / (1 + output.length);
}

interface DraftInput {
  readonly tickResult: TickResult;
  readonly maxRollouts: number;
  readonly now: Date;
  readonly basePrompt: string;
}

/**
 * Build a {@link RolloutDraft} when `tick` decided rollout AND the rollout
 * cap allows it. Returns `null` otherwise (no draft).
 *
 * @otel-exempt pure helper of `orchestrate`.
 */
function maybeBuildDraft(input: DraftInput): RolloutDraft | null {
  if (input.maxRollouts <= 0) return null;
  const decision = input.tickResult.rolloutDecision;
  if (decision === null) return null;
  if (decision.decision !== "rollout") return null;
  const winner = decision.winner;
  if (winner === null) return null;
  const dateIso = input.now.toISOString().slice(0, 10);
  const branchSlug = `${DEFAULT_BRANCH_PREFIX}-${winner.id}-${dateIso}`;
  const predictedGain = computePredictedGain(decision, winner.id);
  const experimentYaml = renderExperimentYaml({
    variantId: winner.id,
    mutation: winner.mutation,
    rationale: winner.rationale,
    predictedGain,
    dateIso,
    basePrompt: input.basePrompt,
  });
  return {
    variantId: winner.id,
    branchSlug,
    experimentYaml,
    mutation: winner.mutation,
    rationale: winner.rationale,
  };
}

/**
 * Mean A/B score for the winning variant — the predicted gain the
 * EXPERIMENT.yaml carries. Returns 0 when the variant has no recorded
 * scores (cold-start; the operator reads zero as "no signal yet").
 *
 * @otel-exempt pure helper of `orchestrate`.
 */
function computePredictedGain(decision: ExecuteResult, variantId: string): number {
  for (const m of decision.abMetrics) {
    if (m.variantId === variantId) return m.score;
  }
  return 0;
}

interface YamlInput {
  readonly variantId: string;
  readonly mutation: string;
  readonly rationale: string;
  readonly predictedGain: number;
  readonly dateIso: string;
  readonly basePrompt: string;
}

/**
 * Render the `EXPERIMENT.yaml` text for the draft branch. Mirrors the shape
 * of the repo's existing EXPERIMENT.yaml files — top-level `id` /
 * `hypothesis` / `success` / `pivot` / `measurement` / `anchor` /
 * `replay_windows_days`.
 *
 * @otel-exempt pure helper of `orchestrate`.
 */
function renderExperimentYaml(input: YamlInput): string {
  const safeMutation = escapeYamlBlock(input.mutation);
  const safeRationale = escapeYamlBlock(input.rationale);
  const safeBase = escapeYamlBlock(input.basePrompt.slice(0, 200));
  const gain = input.predictedGain.toFixed(4);
  return [
    `id: ${input.variantId}-${input.dateIso}`,
    "hypothesis: |",
    `  Applying the prompt mutation "${safeMutation}" to the base prompt`,
    `  ("${safeBase}") improves the A/B-eval score from baseline by ≥${gain}`,
    "  (Kohavi-Tang-Xu 2020 sustained-gain window: 7 d).",
    `  Rationale: ${safeRationale}`,
    "success: |",
    `  Mean A/B score over the post-rollout 7-day window remains ≥${gain}`,
    "  AND the oscillation guard (Ries 2011) does not fire on this variant.",
    "pivot: |",
    `  If the post-rollout score regresses below ${gain} in 7 consecutive`,
    "  daily replays, the rollout is reverted and the variant is added to",
    "  the oscillation log so it cannot be re-proposed within the lookback",
    "  window. Per Ries 2011 (build-measure-learn), failure is data, not loss.",
    "measurement: |",
    "  pnpm vitest run novel/mape-k-loop/src/orchestrator.test.ts --reporter=json \\",
    "    | jq -e '.numFailedTests == 0'",
    "anchor: |",
    '  Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003',
    "  (MAPE-K Execute primitive — A/B + sustained-gain + oscillation guards);",
    "  Kohavi, Tang, Xu, *Trustworthy Online Controlled Experiments*, Cambridge UP",
    "  2020, Ch. 3 (sustained-gain window — the rule-#9 success threshold);",
    '  Munafò et al., "A Manifesto for Reproducible Science", *Nature Human',
    "  Behaviour* 1, 0021, 2017 (pre-registration — predicted gain committed",
    "  before merge so post-hoc rationalisation is structurally impossible).",
    "replay_windows_days: [7, 30, 90]",
    "",
  ].join("\n");
}

/**
 * Escape a string so it is safe inside a `|`-block scalar in YAML — strip
 * newlines and trim whitespace. The resulting string is single-line and
 * ASCII-safe.
 *
 * @otel-exempt pure helper of `orchestrate`.
 */
function escapeYamlBlock(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/"/g, "'");
}
