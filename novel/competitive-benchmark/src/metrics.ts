/**
 * `@minsky/competitive-benchmark` — the pure, cited metric set for
 * agentic-software-engineering performance (task `self-metrics-competitive-benchmark`
 * slice (a)).
 *
 * This module is **data + pure functions only**: the metric catalogue plus
 * the direction-aware comparison/delta helpers that the automated comparison
 * (`scripts/benchmark-run.mjs`, slice (c)) will consume. No I/O, no vendor
 * names in logic — the competitor corpus (slice (b)) is a separate adapter
 * seam so a competitor is *data, not code*.
 *
 * Pattern conformance (per vision.md § 8 / Pattern conformance index):
 *   - Metric catalogue:   Goal-Question-Metric — Basili, Caldiera, Rombach,
 *                          "The Goal-Question-Metric Approach",
 *                          *Encyclopedia of Software Engineering*, 1994
 *                          (every metric is derived from the competitive
 *                          goal, not chosen post-hoc). Conformance: full.
 *   - DORA four keys:     Forsgren, Humble, Kim, *Accelerate*, 2018
 *                          (outcome metrics, not vanity counts).
 *                          Conformance: full.
 *   - SWE-bench hook:     Jimenez, Yang, Wettig, Yao, Pei, Press,
 *                          Narasimhan, "SWE-bench: Can Language Models
 *                          Resolve Real-World GitHub Issues?", *ICLR* 2024
 *                          (public head-to-head resolve-rate). Conformance:
 *                          full (the metric definition; the score *source*
 *                          is the slice-(b) corpus adapter).
 *   - Direction-aware
 *     comparison:         status/score lattice — a total order per metric
 *                          where "better" is the metric's own direction
 *                          (Avizienis et al., *IEEE TDSC* 2004 — worst/best
 *                          aggregation over an ordered domain).
 *                          Conformance: full.
 *
 * Why a pure leaf (Martin, *Clean Architecture*, 2017 — acyclic dependency
 * principle): the scorecard runner, the dashboard panel, and the
 * `check-competitive-goal.mjs` lint all consume this catalogue. Keeping it a
 * zero-dependency leaf with no I/O means every consumer shares one
 * definition of "what minsky measures itself and its competitors on".
 */

/**
 * Whether a higher or a lower raw value is the better outcome for a metric.
 * The comparison/delta helpers normalise on this so callers never special-case
 * a metric's polarity.
 */
export type MetricDirection = "higher-is-better" | "lower-is-better";

/**
 * The three families the scorecard ranks on. `dora` = DORA four keys
 * (Forsgren/Humble/Kim 2018); `agentic` = autonomous-coding-specific
 * outcomes; `public-benchmark` = a reproducible public head-to-head hook.
 */
export type MetricCategory = "dora" | "agentic" | "public-benchmark";

/**
 * Unit of the raw value. `ratio` is a 0..1 fraction; `usd` is US dollars;
 * `seconds` is wall-clock; `count-per-day` is a frequency.
 */
export type MetricUnit = "count-per-day" | "seconds" | "ratio" | "usd";

/**
 * One metric in the competitive scorecard. Pure data — the value *source*
 * (minsky's OTEL/ledger stream, a competitor's published number) is the
 * slice-(c)/slice-(b) concern, deliberately absent here.
 */
export interface MetricDefinition {
  /** Stable kebab-case key used in `competitive-scorecard.json` and the lint. */
  readonly id: string;
  /** Human-readable label for the dashboard panel. */
  readonly label: string;
  /** Which scorecard family this metric belongs to. */
  readonly category: MetricCategory;
  /** Unit of {@link MetricDefinition.id}'s raw value. */
  readonly unit: MetricUnit;
  /** Whether higher or lower raw values are better. */
  readonly direction: MetricDirection;
  /** Primary-source citation justifying the metric (rule #5/#9 anchor). */
  readonly anchor: string;
  /** What the metric measures and why it steers the competitive goal. */
  readonly description: string;
}

/**
 * The cited metric set. ≥5 shared metrics is the slice-(c) success bar;
 * this catalogue ships 15 across all three families so the scorecard never
 * has fewer than five comparable axes against any competitor whose corpus
 * (slice (b)) reports a subset. The 6 public-benchmark axes include the
 * OpenHands Index multi-task suite — five dimensions (issue-resolution,
 * greenfield, frontend, testing, info-gathering), each pinned to its
 * originating public dataset, so a single SWE-bench headline can no longer
 * mask a dimension where an agent fails.
 *
 * Ordering is informational (DORA → agentic → public-benchmark); consumers
 * key by `id`, never by index.
 */
export const METRICS: readonly MetricDefinition[] = [
  // --- DORA four keys (Forsgren/Humble/Kim 2018) ---------------------------
  {
    id: "deploy-frequency",
    label: "Deployment frequency",
    category: "dora",
    unit: "count-per-day",
    direction: "higher-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 1)",
    description:
      "Merged-PR/deploy events per day — how often the system ships change autonomously.",
  },
  {
    id: "lead-time-for-changes",
    label: "Lead time for changes",
    category: "dora",
    unit: "seconds",
    direction: "lower-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 2)",
    description: "Wall-clock from task-pick to merged change — speed of the build-measure loop.",
  },
  {
    id: "change-fail-rate",
    label: "Change failure rate",
    category: "dora",
    unit: "ratio",
    direction: "lower-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 3)",
    description: "Fraction of merged changes that cause a regression or require a hotfix.",
  },
  {
    id: "mttr",
    label: "Mean time to restore",
    category: "dora",
    unit: "seconds",
    direction: "lower-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 4)",
    description: "Wall-clock from regression detected to regression resolved.",
  },
  // --- Agentic-task outcomes ----------------------------------------------
  {
    id: "autonomous-merge-rate",
    label: "Autonomous merge rate",
    category: "agentic",
    unit: "ratio",
    direction: "higher-is-better",
    anchor: "Doerr, Measure What Matters, 2018 (outcome KR, not activity)",
    description: "Fraction of picked tasks that reach a merged PR with no human intervention.",
  },
  {
    id: "mean-autonomous-merge-latency",
    label: "Mean autonomous-merge latency",
    category: "agentic",
    unit: "seconds",
    direction: "lower-is-better",
    anchor: "Ries, The Lean Startup, 2011 (cycle-time of build-measure-learn)",
    description: "Mean wall-clock from task-pick to autonomous merge, over merged tasks only.",
  },
  {
    id: "cost-per-merged-pr",
    label: "Cost per merged PR",
    category: "agentic",
    unit: "usd",
    direction: "lower-is-better",
    anchor: "Doerr, Measure What Matters, 2018 (efficiency KR)",
    description: "Total model + infra spend divided by merged-PR count — economic efficiency.",
  },
  {
    id: "gate-pass-rate",
    label: "Gate pass rate",
    category: "agentic",
    unit: "ratio",
    direction: "higher-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (deployment-pipeline reliability)",
    description: "Fraction of first PR submissions that pass the full verify gate without a retry.",
  },
  {
    id: "regression-escape-rate",
    label: "Regression escape rate",
    category: "agentic",
    unit: "ratio",
    direction: "lower-is-better",
    anchor: "Basili, Caldiera, Rombach, GQM, 1994 (defect-escape metric)",
    description: "Fraction of merged PRs whose regression is caught only after merge.",
  },
  {
    id: "human-intervention-rate",
    label: "Human intervention rate",
    category: "agentic",
    unit: "ratio",
    direction: "lower-is-better",
    anchor: "Doerr, Measure What Matters, 2018 (autonomy KR)",
    description: "Fraction of tasks that required a human edit, unblock, or manual merge.",
  },
  {
    // 2026-05-24: added to close out the `single-stability-number` P0 task
    // (M1). Operator's headline reliability number — "how reliable is
    // minsky right now?". Computed from `.minsky/experiment-store/cross-repo/*.jsonl`
    // by `scripts/stability-number.mjs`; 7-day rolling clean-exit fraction
    // (validated iteration / total iteration). Distinct from `change-fail-rate`
    // (which is about merged-PR regressions) and `mttr` (restore time after
    // regression): this metric is about the autonomous LOOP'S reliability —
    // does the daemon survive iterations? The M1.1 stability target gates on
    // this at ≥0.90 (story 015 / `local-models-stability-gate-90-percent`).
    // No public competitor publishes this — competitors don't run a 24/7
    // self-iterating loop, so the metric is structurally only meaningful for
    // an autonomous orchestrator like Minsky. Listed here so the scorecard
    // surface advertises it as the (currently unrivalled) reliability axis.
    id: "daemon-stability-pct",
    label: "Daemon stability (7d clean-exit fraction)",
    category: "agentic",
    unit: "ratio",
    direction: "higher-is-better",
    anchor:
      "Beyer et al., Site Reliability Engineering, O'Reilly 2016, Ch. 4 (SLI / SLO — service-level indicator); Forsgren, Humble, Kim, Accelerate, 2018 (change-fail-rate analogue at the iteration-loop layer)",
    description:
      "Rolling 7-day fraction of daemon iterations that completed cleanly (validated verdict, no spawn-fail / crash / timeout). The reliability SLI for the autonomous loop. Computed from `.minsky/experiment-store/cross-repo/*.jsonl` via `scripts/stability-number.mjs`. The M1.1 milestone target is ≥0.90.",
  },
  // --- Public benchmark hook (Jimenez et al. 2024) ------------------------
  {
    id: "swe-bench-verified-resolve-rate",
    label: "SWE-bench Verified resolve rate",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor: "Jimenez et al., SWE-bench, ICLR 2024 (Verified split resolve-rate)",
    description:
      "Fraction of SWE-bench Verified instances resolved — the public head-to-head axis.",
  },
  // --- Orchestrator-tier benchmark hook (Chen et al. 2021 / MetaGPT ICLR 2024) ---
  // Added 2026-05-23 to widen the corpus to actual orchestrator competitors
  // (CrewAI, AutoGen, LangGraph, MetaGPT) per operator directive "add actual
  // competitors to the list, not agents". Orchestrators publish code-
  // generation benchmark numbers in HumanEval Pass@1 form (a tighter
  // per-task slice than SWE-bench Verified); agents are AT THE LAYER BELOW
  // Minsky's tier (Minsky composes agents — Minsky is a peer to
  // orchestrators, not to agents). See `competitors/README.md` for the
  // tier distinction.
  {
    id: "humaneval-pass-at-1",
    label: "HumanEval Pass@1",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor:
      "Chen et al., 'Evaluating Large Language Models Trained on Code', arXiv 2107.03374, 2021 (HumanEval — 164 hand-written Python tasks; pass@k is the unbiased estimator); MetaGPT ICLR 2024 (Hong, Zhuge et al., arXiv 2308.00352 — the canonical orchestrator-tier reporting convention)",
    description:
      "Fraction of HumanEval tasks the orchestrator's pipeline resolves on first attempt. The orchestrator-tier counterpart to swe-bench-verified-resolve-rate — multi-agent frameworks (MetaGPT, AutoGen, CrewAI) publish this, single-agent systems (Claude Code, Devin, Aider) publish SWE-bench Verified.",
  },
  // --- Orchestrator-tier math-reasoning hook (Hendrycks et al. MATH / AutoGen 2023) ---
  // Added 2026-06-02 via the `corpus-add-autogen-microsoft` task's Pivot
  // path: AutoGen (Microsoft Research, Wu et al. arXiv 2308.08155) does NOT
  // publish a headline HumanEval Pass@1 number — its primary code/reasoning
  // result is the MATH whole-test accuracy (69.48% overall vs GPT-4's
  // 55.18%). HumanEval is run model-dependently via the AutoGenBench tool, so
  // there is no AutoGen-on-stock-models HumanEval headline to cite without a
  // `local-harness` run. The MATH number is the orchestrator-tier math-
  // reasoning counterpart to humaneval-pass-at-1: both are public head-to-head
  // axes a multi-agent orchestrator can publish without a per-instance harness.
  // The Pivot's rationale (TASKS.md `corpus-add-autogen-microsoft`): adopting
  // MATH as a sibling unlocks future per-orchestrator math-reasoning compares.
  {
    id: "math-whole-test-accuracy",
    label: "MATH whole-test accuracy",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor:
      "Hendrycks, Burns, Kadavath, Arora, Basart, Tang, Song, Steinhardt, 'Measuring Mathematical Problem Solving With the MATH Dataset', NeurIPS 2021 Datasets and Benchmarks (the 12,500-problem competition-math benchmark); Wu, Bansal, Zhang, Wu, Li, Zhu, Wang, Saied, Awadallah, Yang, 'AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework', arXiv 2308.08155, 2023 (the orchestrator-tier reporting convention — AutoGen 69.48% whole-test accuracy vs GPT-4 55.18%)",
    description:
      "Fraction of the MATH dataset's whole-test split the orchestrator's pipeline solves. The orchestrator-tier counterpart to humaneval-pass-at-1 — multi-agent frameworks that target reasoning (AutoGen) publish this where a stock-model HumanEval headline is unavailable (HumanEval being model-dependent via the AutoGenBench tool).",
  },
  // --- OpenHands Index multi-task suite (All-Hands AI, 2026) ----------------
  // Added via task `research-finding-multi-task-benchmark-suite`. The
  // OpenHands Index (index.openhands.dev) reports per-task scores across FIVE
  // dimensions instead of a single SWE-bench headline; a single number masks
  // WHERE an agent fails (Card & Mackinlay 1999 — a glanceable multi-axis
  // surface beats one aggregate). The five dimensions, each pinned to its
  // originating public benchmark so the metric definition is reproducible and
  // primary-cited (the score *source* stays the slice-(b) corpus adapter):
  //   1. issue-resolution → swe-bench-verified-resolve-rate (already above)
  //   2. greenfield       → commit0-library-resolve-rate
  //   3. frontend         → swe-bench-multimodal-resolve-rate
  //   4. testing          → swt-bench-test-generation-rate
  //   5. info-gathering   → gaia-resolve-rate
  // Ids name the originating benchmark (Commit0, SWE-bench Multimodal,
  // SWT-Bench, GAIA), never "the OpenHands Index", because the Index is a
  // *reporting harness* over these public datasets — the metric is the
  // dataset's resolve/generation rate, which any orchestrator can publish
  // without re-running OpenHands' harness (rule #1 — don't reinvent the
  // benchmark; cite the dataset). See `novel/competitive-benchmark/README.md`
  // § "OpenHands Index multi-task suite" for the dimension→dataset table and
  // `competitors/openhands.md` § "What we learn / steal" for the rationale.
  {
    id: "commit0-library-resolve-rate",
    label: "Commit0 library-from-scratch resolve rate",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor:
      "Zhao, Jiang, Lee, Chiu, Cardie, Gallé, Rush, 'Commit0: Library Generation from Scratch', arXiv 2412.01769, 2024 (54 Python libraries built from an API spec + interactive unit tests — the greenfield long-horizon axis; validated by running the provided unit-test suite); adopted as the OpenHands Index 'greenfield' dimension (All-Hands AI, 'OpenHands Index Three Months Out', openhands.dev/blog/openhands-index-3-months-out, 2026-05-11)",
    description:
      "Fraction of Commit0's library-from-scratch tasks an agent fully implements (all interactive unit tests pass). The greenfield / long-horizon dimension of the OpenHands Index — distinct from swe-bench-verified-resolve-rate, which patches an EXISTING repo; Commit0 generates a whole library from a spec.",
  },
  {
    id: "swe-bench-multimodal-resolve-rate",
    label: "SWE-bench Multimodal resolve rate",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor:
      "Yang et al., 'SWE-bench Multimodal: Do AI Systems Generalize to Visual Software Domains?', arXiv 2410.03859, ICLR 2025 (617 task instances from 17 JavaScript front-end / data-viz / diagramming libraries, each carrying ≥1 image; top systems resolve as few as 12.2%, exposing the visual-reasoning gap); adopted as the OpenHands Index 'frontend' dimension (All-Hands AI, openhands.dev/blog/openhands-index-3-months-out, 2026-05-11)",
    description:
      "Fraction of SWE-bench Multimodal instances resolved — the front-end / visual-software dimension of the OpenHands Index. Unlike swe-bench-verified-resolve-rate (Python, text-only), each instance requires visual reasoning over an image in the problem statement or test.",
  },
  {
    id: "swt-bench-test-generation-rate",
    label: "SWT-Bench test-generation rate",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor:
      "Mündler, Müller, He, Vechev, 'SWT-Bench: Testing and Validating Real-World Bug-Fixes with Code Agents', arXiv 2406.12952, NeurIPS 2024 (the agent must generate a reproducing test that FAILS on the buggy code and PASSES after the golden fix — the inverse of SWE-bench's resolve task; Lite = 276 samples, Verified subset derived from SWE-bench-Verified); adopted as the OpenHands Index 'testing' dimension (All-Hands AI, openhands.dev/blog/openhands-index-3-months-out, 2026-05-11)",
    description:
      "Fraction of SWT-Bench issues for which an agent generates a valid reproducing test (fails pre-fix, passes post-fix). The testing dimension of the OpenHands Index — measures test-writing capability, the discipline Minsky's constitution rule #3 (test-first) forces, distinct from issue resolution.",
  },
  {
    id: "gaia-resolve-rate",
    label: "GAIA general-assistant resolve rate",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor:
      "Mialon, Fourrier, Swift, Wolf, LeCun, Scialom, 'GAIA: a benchmark for General AI Assistants', arXiv 2311.12983, 2023 (466 multi-step questions requiring reasoning, multi-modality, web browsing, and tool use; humans score 92% vs 15% for GPT-4 + plugins — the info-gathering / tool-use axis); adopted as the OpenHands Index 'info gathering' dimension (All-Hands AI, openhands.dev/blog/openhands-index-3-months-out, 2026-05-11)",
    description:
      "Fraction of GAIA questions answered correctly — the information-gathering / tool-use dimension of the OpenHands Index. Measures web-browse + multi-tool synthesis, the orchestrator-tier skill an autonomous loop needs but a single-patch SWE-bench number never surfaces.",
  },
];

/**
 * Look up a metric definition by its stable `id`.
 *
 * @otel-exempt pure function — no I/O, no side effects; a wrapping span over
 *   an array find would be empty noise. The scorecard runner that calls this
 *   inside its already-traced `benchmark-run` span owns the observability.
 */
export function metricById(id: string): MetricDefinition | undefined {
  return METRICS.find((m) => m.id === id);
}

/**
 * Direction-aware comparison of two raw values for one metric. Returns `1`
 * when `a` is the better outcome, `-1` when `b` is, `0` when they tie —
 * always in "higher rank = better", regardless of the metric's polarity.
 *
 * @otel-exempt pure function — total order over two numbers; no I/O, no
 *   side effects. Traced by the caller's `benchmark-run` span.
 */
export function compareValues(metric: MetricDefinition, a: number, b: number): -1 | 0 | 1 {
  if (a === b) return 0;
  const aIsBetter = metric.direction === "higher-is-better" ? a > b : a < b;
  return aIsBetter ? 1 : -1;
}

/**
 * Direction-normalised delta between minsky's value and a competitor's for
 * one metric. A **positive** result always means minsky is ahead; a
 * **negative** result always means behind — the sign is meaningful without
 * the caller knowing the metric's polarity.
 *
 * @otel-exempt pure function — single subtraction with a sign flip; no I/O,
 *   no side effects. Traced by the caller's `benchmark-run` span.
 */
export function computeDelta(
  metric: MetricDefinition,
  minskyValue: number,
  competitorValue: number,
): number {
  const raw = minskyValue - competitorValue;
  return metric.direction === "higher-is-better" ? raw : -raw;
}
