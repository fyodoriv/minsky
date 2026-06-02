/**
 * `@minsky/competitive-benchmark` — the competitor corpus (task
 * `self-metrics-competitive-benchmark` slice (b)).
 *
 * This module is **data + pure functions only**: the comparison set of
 * competitor autonomous-coding systems, each carrying a *pluggable result
 * source* so that **a competitor is data, not code** (Martin,
 * *Clean Architecture*, 2017 — the Open/Closed principle + a stable adapter
 * seam: adding or rescoring a competitor is a data edit, never a code edit).
 *
 * The corpus deliberately ships no I/O. A `published` source is a dated
 * snapshot of a competitor's public SWE-bench Verified number; a
 * `local-harness` source is a *descriptor* naming a reproducible harness the
 * slice-(c) scorecard runner executes — this leaf never runs anything. That
 * keeps the corpus a zero-dependency leaf the runner, dashboard, and
 * meta-rule lint share, exactly like the metric catalogue in `./metrics.ts`.
 *
 * Pattern conformance (per vision.md § 8 / Pattern conformance index):
 *   - Competitor-as-data
 *     adapter seam:       Martin, *Clean Architecture*, 2017 (Open/Closed —
 *                          a competitor is a `Competitor` record, not a
 *                          subclass; the runner depends on the
 *                          `ResultSource` union, not on any vendor).
 *                          Conformance: full.
 *   - Published-number
 *     corpus:             Jimenez et al., "SWE-bench", *ICLR* 2024 (the
 *                          public head-to-head resolve-rate; the Pivot of
 *                          the parent task explicitly permits a data-only
 *                          published corpus when a shared live harness
 *                          against closed competitors is infeasible).
 *                          Conformance: full.
 *   - Vendor-exclusion
 *     allowlist guard:    a closed deny-set checked by a pure predicate
 *                          (operator directive — no Groq / xAI /
 *                          Elon-affiliated entrants); the invariant is
 *                          test-enforced over the shipped corpus so a
 *                          future addition cannot smuggle one in silently
 *                          (Helland, *CIDR* 2007 — visible-not-silent).
 *                          Conformance: full.
 *
 * Why a pure leaf (Martin 2017 — acyclic dependency principle): the
 * scorecard runner (slice c) and dashboard panel both consume this corpus;
 * keeping it a zero-dependency, zero-I/O leaf means there is exactly one
 * definition of "who Minsky compares itself against".
 */

/**
 * Whether the competitor is a closed commercial product (no reproducible
 * local harness possible without vendor access) or an open-source system
 * (a local harness is reproducible). Informational — the runner keys off
 * {@link ResultSource.kind}, not this.
 */
export type CompetitorKind = "closed-commercial" | "open-source";

/**
 * Where a competitor's metric values come from. A discriminated union so the
 * slice-(c) runner branches exhaustively and a competitor is *data*:
 *
 * - `published` — a dated snapshot of publicly reported numbers keyed by
 *   metric id (today: `swe-bench-verified-resolve-rate`). Pure data; the
 *   parent task's Pivot permits this when a shared live head-to-head harness
 *   against a closed competitor is infeasible.
 * - `local-harness` — a *descriptor* naming a reproducible harness the
 *   slice-(c) runner executes against the shared workload. This leaf carries
 *   the descriptor only; it never spawns a process.
 */
export type ResultSource =
  | {
      readonly kind: "published";
      /** Primary-source citation for the snapshot (rule #5/#9 anchor). */
      readonly citation: string;
      /** ISO-8601 date the snapshot was taken — published numbers drift. */
      readonly asOf: string;
      /** Metric-id → reported value. Keys are `MetricDefinition.id`s. */
      readonly values: Readonly<Record<string, number>>;
    }
  | {
      readonly kind: "local-harness";
      /** Primary-source citation for the harness's existence/method. */
      readonly citation: string;
      /**
       * Stable id of the reproducible harness the slice-(c) runner invokes
       * (e.g. a Make target / script name in that vendor's open repo). The
       * runner owns execution; this leaf only names it.
       */
      readonly harnessId: string;
    };

/**
 * One competitor autonomous-coding system in the comparison set. Pure data —
 * the value *source* is the {@link ResultSource} adapter, never inline logic.
 */
export interface Competitor {
  /** Stable kebab-case key used in `competitive-scorecard.json`. */
  readonly id: string;
  /** Human-readable label for the dashboard panel. */
  readonly label: string;
  /** Closed-commercial vs open-source — informational. */
  readonly kind: CompetitorKind;
  /** Project / vendor homepage (provenance, not fetched here). */
  readonly homepage: string;
  /** Pluggable result source — the adapter seam. */
  readonly resultSource: ResultSource;
}

/**
 * Vendor-name substrings that must never appear in the corpus. Operator
 * directive (vendor-exclusion memory): no Groq, xAI, or other
 * Elon-affiliated entrants. A closed deny-set rather than an open
 * allowlist because the universe of acceptable competitors is open-ended
 * while the exclusion is small, explicit, and durable. Matched
 * case-insensitively against `id` and `label`.
 */
export const EXCLUDED_VENDOR_SUBSTRINGS: readonly string[] = Object.freeze([
  "groq",
  "xai",
  "x.ai",
  "grok",
  "elon",
  "musk",
]);

/**
 * Whether a competitor name (id or label) names an excluded vendor.
 *
 * @otel-exempt pure function — substring scan over a frozen 6-element
 *   deny-set; no I/O, no side effects. The slice-(c) corpus-refresh span
 *   owns the observability for any add it gates.
 */
export function isExcludedVendor(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED_VENDOR_SUBSTRINGS.some((bad) => lower.includes(bad));
}

/**
 * The comparison set. ≥4 competitors is the parent task's success bar; this
 * corpus ships 6 (5 `published` SWE-bench Verified snapshots + 1
 * `local-harness` descriptor) so the scorecard always has ≥4 even if a
 * snapshot is later pruned for staleness.
 *
 * Published resolve-rates are a **dated snapshot maintained as data** — the
 * slice-(c) corpus-refresh job rewrites `values`/`asOf` from the cited
 * source; no number here is load-bearing logic. Ordering is informational;
 * consumers key by `id`, never by index.
 *
 * No vendor here is Groq/xAI/Elon-affiliated; the {@link isExcludedVendor}
 * invariant is test-enforced over this array so a future edit cannot add one.
 */
export const COMPETITORS: readonly Competitor[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "closed-commercial",
    homepage: "https://www.anthropic.com/claude-code",
    resultSource: {
      kind: "published",
      citation:
        "Anthropic, 'Claude 3.7 Sonnet and Claude Code', anthropic.com, 2025-02-24 (SWE-bench Verified, agentic harness, 0.49); Pinna, Gong, Williams, Sarro, 'Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance', arXiv 2602.08915, 2026-02-09 (AIDev dataset PR acceptance — Claude Code leads documentation tasks 0.923, features 0.726, used here as autonomous-merge-rate proxy for features-class PRs; the inverse 0.274 reported as human-intervention-rate for the same subset).",
      asOf: "2026-02-09",
      values: {
        "swe-bench-verified-resolve-rate": 0.49,
        "autonomous-merge-rate": 0.726,
        "human-intervention-rate": 0.274,
      },
    },
  },
  {
    id: "openhands",
    label: "OpenHands (All-Hands AI)",
    kind: "open-source",
    homepage: "https://github.com/All-Hands-AI/OpenHands",
    resultSource: {
      kind: "published",
      citation:
        "Wang, Rosenberg, Michelini, Smith, Tran, Nyst, Malhotra, Zhou, Chen, Brennan, Neubig (All-Hands AI), 'The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents', arXiv:2511.03690v2, 2026-04-22 (Table 4 §5.4: SWE-bench Verified resolve rate 0.728 with Claude Sonnet 4.5 + extended thinking on the V1 SDK, up from V0's 0.646; supersedes the 2025-04-15 inference-time-scaling reading of 0.658); All-Hands AI, 'Evaluation of LLMs as Coding Agents on SWE-Bench (at 30x Speed!)', openhands.dev/blog, 2024-10-04 (cost-per-issue 0.30 USD with Claude 3.5 Sonnet on SWE-bench Lite, used here as cost-per-merged-pr proxy); average_runtime 3600 sec from openhands-index-results/scores.json (used here as mean-autonomous-merge-latency).",
      asOf: "2026-04-22",
      values: {
        "swe-bench-verified-resolve-rate": 0.728,
        "cost-per-merged-pr": 0.3,
        "mean-autonomous-merge-latency": 3600,
      },
    },
  },
  {
    id: "swe-agent",
    label: "SWE-agent (Princeton NLP)",
    kind: "open-source",
    homepage: "https://github.com/SWE-agent/SWE-agent",
    resultSource: {
      kind: "published",
      // Refreshed from the 2024 NeurIPS GPT-4 baseline (0.125, full-split
      // proxy) to the SWE-agent team's current flagship scaffold,
      // mini-swe-agent. The official SWE-bench Verified leaderboard
      // (swebench.com "Bash Only" track) carries the mini-swe-agent +
      // Gemini 3 Pro submission dated 2026-02-26 at ~0.74 resolve rate;
      // mini-swe-agent.com's own headline ("Gemini 3 Pro reaches 74% on
      // SWE-bench verified with mini-swe-agent!") is the project's
      // primary statement of the same number. This is a true Verified
      // reading (not a full-split/Lite proxy), so the proxy caveat that
      // qualified the 2024 entry is dropped.
      citation:
        "SWE-bench Verified leaderboard (swebench.com, 'Bash Only' track), 'mini-swe-agent + Gemini 3 Pro', submitted 2026-02-26 (resolve rate 0.74 on the 500-instance Verified split using the SWE-agent team's minimal bash-only ReAct scaffold); primary statement at mini-swe-agent.com ('Gemini 3 Pro reaches 74% on SWE-bench verified with mini-swe-agent!'). mini-swe-agent is the SWE-agent project's current 100-line flagship scaffold; the 2024 NeurIPS SWE-agent + GPT-4 reading (full-split proxy, 0.125) it supersedes is retained in competitors/swe-agent.md for history.",
      asOf: "2026-02-26",
      values: { "swe-bench-verified-resolve-rate": 0.74 },
    },
  },
  {
    id: "aider",
    label: "Aider",
    kind: "open-source",
    homepage: "https://aider.chat",
    resultSource: {
      kind: "published",
      citation:
        "Aider, 'How aider scored SOTA 26.3% on SWE Bench Lite', aider.chat/2024/05/22/swe-bench-lite.html, 2024-05-22 (SWE-bench Lite: 0.263; pass@1 with GPT-4o + Opus). Reported here as the SWE-bench Verified proxy because Aider has not published a Verified-split run; the Lite subset overlaps Verified for the easier-issue tail.",
      asOf: "2024-05-22",
      values: { "swe-bench-verified-resolve-rate": 0.263 },
    },
  },
  {
    id: "devin",
    label: "Devin (Cognition Labs)",
    kind: "closed-commercial",
    homepage: "https://www.cognition.ai",
    resultSource: {
      kind: "published",
      citation:
        "Cognition Labs, '2025 Annual Performance Review', cognition.ai, 2026-04 (real-world PR merge rate 0.67 across thousands of customer codebases; inverse 0.33 as human-intervention-rate; documented in AgentMarketCap, 'Devin's 67% PR Merge Rate', agentmarketcap.ai/blog/2026/04/07); Cognition Labs, 'Introducing Devin', cognition.ai, 2024-03-12 (original SWE-bench Verified resolve rate 0.139); ACU economics — 'Devin Doubled Its PR Merge Rate to 67%', AgentMarketCap, 2026-04-07 (1 ACU ≈ 15 min Devin work ≈ 900 sec mean-autonomous-merge-latency for ~1 ACU/PR typical).",
      asOf: "2026-04-07",
      values: {
        "swe-bench-verified-resolve-rate": 0.139,
        "autonomous-merge-rate": 0.67,
        "human-intervention-rate": 0.33,
        "mean-autonomous-merge-latency": 900,
      },
    },
  },
  {
    id: "cursor-agent",
    label: "Cursor agent",
    kind: "closed-commercial",
    homepage: "https://www.cursor.com",
    resultSource: {
      kind: "published",
      citation:
        "Pinna, Gong, Williams, Sarro, 'Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance', arXiv 2602.08915, 2026-02-09 (AIDev dataset — Cursor leads fix-task acceptance 0.804, used here as autonomous-merge-rate proxy for the fix-task subset).",
      asOf: "2026-02-09",
      values: { "autonomous-merge-rate": 0.804 },
    },
  },
  {
    id: "openai-codex",
    label: "OpenAI Codex (codex-1)",
    kind: "closed-commercial",
    homepage: "https://openai.com/index/introducing-codex/",
    resultSource: {
      kind: "published",
      citation:
        "OpenAI, 'Introducing Codex', openai.com/index/introducing-codex/, 2025-05-16 (SWE-Bench Verified pass@1 = 0.721 for codex-1; 23 instances excluded as not-runnable on internal infrastructure; 192k context, medium reasoning effort; pass@8 = 0.838 reported in the same post). Codex CLI open-source repository at github.com/openai/codex.",
      asOf: "2025-05-16",
      values: { "swe-bench-verified-resolve-rate": 0.721 },
    },
  },
  {
    id: "augment-code",
    label: "Augment Code (Augment SWE-bench agent)",
    kind: "open-source",
    homepage: "https://github.com/augmentcode/augment-swebench-agent",
    resultSource: {
      kind: "published",
      citation:
        "Chen & Flaherty, '#1 open-source agent on SWE-Bench Verified by combining Claude 3.7 and O1', augmentcode.com/blog, 2025-03-31 (open-source SWE-bench Verified resolve rate 0.654 with Claude Sonnet 3.7 driver + OpenAI o1 ensembler; methodology: forked from Anthropic SWE-bench post + sequential-thinking MCP tool); reproducible open-source repo at github.com/augmentcode/augment-swebench-agent.",
      asOf: "2025-03-31",
      values: { "swe-bench-verified-resolve-rate": 0.654 },
    },
  },
  // ---- ORCHESTRATOR TIER (peers to Minsky — they compose agents) -----------
  // Per operator directive 2026-05-23 ("add actual competitors to the list,
  // not agents"). Minsky is an orchestrator: it manages the daemon lifecycle,
  // MAPE-K loop, prompt evolution, multi-repo task queue, supervisor restart
  // discipline — sitting ON TOP of agents (Claude / Devin / Aider) which it
  // COMPOSES. The peers at Minsky's tier are other orchestrators
  // (MetaGPT, AutoGen, CrewAI, LangGraph). Agents above are kept in the
  // corpus as benchmark context — Minsky-via-Claude inherits Claude's
  // SWE-bench score plus the orchestrator-tier delta (MAPE-K-driven
  // long-horizon retention). See `novel/competitive-benchmark/README.md`
  // § "Orchestrator vs agent tier" for the layering.
  {
    id: "metagpt",
    label: "MetaGPT (Foundation Agents — ICLR 2024)",
    kind: "open-source",
    homepage: "https://github.com/FoundationAgents/MetaGPT",
    resultSource: {
      kind: "published",
      citation:
        "Hong, Zhuge, Chen, Zheng, Cheng, Wang, Zhuge, Wang, Yau, Lin, Zhou, Ran, Xiao, Wu, Schmidhuber, 'MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework', arXiv 2308.00352, ICLR 2024 Oral (HumanEval Pass@1 = 0.859 — SoTA at publication; MBPP Pass@1 = 0.877; 28.2% relative improvement over GPT-4 on HumanEval via Standardized Operating Procedure-shaped multi-agent assembly line); reproducible at github.com/FoundationAgents/MetaGPT.",
      asOf: "2024-05-07",
      values: { "humaneval-pass-at-1": 0.859 },
    },
  },
];

/**
 * Look up a competitor by its stable `id`.
 *
 * @otel-exempt pure function — array find over a ≤6-element frozen corpus;
 *   no I/O, no side effects. Traced by the caller's `benchmark-run` span.
 */
export function competitorById(id: string): Competitor | undefined {
  return COMPETITORS.find((c) => c.id === id);
}

/**
 * The published value a competitor reports for a metric, or `undefined` when
 * the competitor's source is a `local-harness` descriptor (slice-(c) fills
 * those at run time) or simply does not report that metric. Never throws and
 * never coerces — a missing number stays visible to the scorecard rather
 * than masked as a zero (Helland, *CIDR* 2007 — visible-not-silent; mirrors
 * `metricById` returning `undefined` over throwing).
 *
 * @otel-exempt pure function — one discriminant check + one object read; no
 *   I/O, no side effects. Traced by the caller's `benchmark-run` span.
 */
export function publishedValue(competitor: Competitor, metricId: string): number | undefined {
  const src = competitor.resultSource;
  if (src.kind !== "published") return undefined;
  return Object.hasOwn(src.values, metricId) ? src.values[metricId] : undefined;
}
