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
 * corpus ships a mix of `published` SWE-bench/HumanEval/MATH snapshots plus a
 * single `local-harness` descriptor (Agentless, the thesis-falsifier arm added
 * by `competitor-deep-research-tier-s-2026-05`) so the scorecard always has ≥4
 * even if a snapshot is later pruned for staleness, and so the falsifier runs
 * head-to-head against the published readings.
 *
 * Published resolve-rates are a **dated snapshot maintained as data** — the
 * slice-(c) corpus-refresh job rewrites `values`/`asOf` from the cited
 * source; no number here is load-bearing logic. Ordering is informational;
 * consumers key by `id`, never by index.
 *
 * No vendor here is Groq/xAI/Elon-affiliated; the {@link isExcludedVendor}
 * invariant is test-enforced over this array so a future edit cannot add one.
 *
 * OpenHands Index multi-task suite (task
 * `research-finding-multi-task-benchmark-suite`): the metric catalogue now
 * carries the five Index dimensions (issue-resolution / greenfield / frontend
 * / testing / info-gathering), each pinned to its originating public dataset
 * in `./metrics.ts`. A competitor's per-dimension reading is recorded in its
 * `values` ONLY when vendor-primary and cited — today the single such reading
 * is SWE-agent's `swe-bench-multimodal-resolve-rate: 0.12` (Yang et al. arXiv
 * 2410.03859, the published top reading on the frontend dimension). Other
 * dimensions stay absent (visible-not-silent, never a coerced zero) until a
 * competitor publishes a fixed absolute number.
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
        "SWE-bench Verified leaderboard (swebench.com, 'Bash Only' track), 'mini-swe-agent + Gemini 3 Pro', submitted 2026-02-26 (resolve rate 0.74 on the 500-instance Verified split using the SWE-agent team's minimal bash-only ReAct scaffold); primary statement at mini-swe-agent.com ('Gemini 3 Pro reaches 74% on SWE-bench verified with mini-swe-agent!'). mini-swe-agent is the SWE-agent project's current 100-line flagship scaffold; the 2024 NeurIPS SWE-agent + GPT-4 reading (full-split proxy, 0.125) it supersedes is retained in competitors/swe-agent.md for history. FRONTEND DIMENSION: SWE-agent holds the published SWE-bench Multimodal top reading (0.12 — best of all systems, vs 0.06 for the next best) per Yang et al., 'SWE-bench Multimodal: Do AI Systems Generalize to Visual Software Domains?', arXiv 2410.03859, ICLR 2025 ('SWE-agent's flexible language-agnostic features enable it to substantially outperform alternatives on SWE-bench M, resolving 12% of task instances compared to 6% for the next best system') — the only vendor-primary per-dimension OpenHands-Index-shape score in the corpus today.",
      asOf: "2026-02-26",
      values: {
        "swe-bench-verified-resolve-rate": 0.74,
        "swe-bench-multimodal-resolve-rate": 0.12,
      },
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
    label: "OpenAI Codex (GPT-5.5)",
    kind: "closed-commercial",
    homepage: "https://openai.com/index/introducing-gpt-5-5/",
    resultSource: {
      kind: "published",
      citation:
        "OpenAI, 'Introducing GPT-5.5', openai.com/index/introducing-gpt-5-5/, 2026-04-23 (GPT-5.5 is OpenAI's flagship model powering Codex as of this release; SWE-bench Verified resolve rate 0.826 per the independently-reproduced vals.ai scaffold (vals.ai/benchmarks/swebench, corroborated by interestingengineering.com at 0.827), used here over OpenAI's headline 0.887 because the corpus tracks reproducible readings; OpenAI emphasised SWE-bench Pro 0.586 for this release). Supersedes the codex-1 reading (0.721, openai.com/index/introducing-codex/, 2025-05-16). Codex CLI open-source repository at github.com/openai/codex.",
      asOf: "2026-04-23",
      values: { "swe-bench-verified-resolve-rate": 0.826 },
    },
  },
  {
    // stale-by-vendor (corpus-refresh-augment-code): the
    // `swe-bench-verified-resolve-rate` reading below stays pinned to its
    // original publication ON PURPOSE. Augment has NOT published a *new
    // SWE-bench Verified* submission (the gap exceeds the 365-day "4 vendor
    // cycles" threshold in the refresh task's Pivot clause). Their recent
    // benchmarking moved to a DIFFERENT split — Auggie CLI scored 51.80% on
    // Scale AI's SWE-bench *Pro* (379/731, Claude Opus 4.5 driver), per the
    // primary vendor post 'Auggie tops SWE-Bench Pro'. SWE-bench Pro is not
    // (yet) a registered metric in metrics.ts, so it is recorded in the
    // citation as evidence the vendor pivoted benchmarks rather than
    // silently restamping the old Verified `asOf` — masking staleness with a
    // re-stated number is worse than acknowledging it (Pivot clause + rule
    // #4 visibility).
    id: "augment-code",
    label: "Augment Code (Augment SWE-bench agent)",
    kind: "open-source",
    homepage: "https://github.com/augmentcode/augment-swebench-agent",
    resultSource: {
      kind: "published",
      citation:
        "Chen & Flaherty, '#1 open-source agent on SWE-Bench Verified by combining Claude 3.7 and O1', augmentcode.com/blog, 2025-03-31 (open-source SWE-bench Verified resolve rate 0.654 with Claude Sonnet 3.7 driver + OpenAI o1 ensembler; methodology: forked from Anthropic SWE-bench post + sequential-thinking MCP tool); reproducible open-source repo at github.com/augmentcode/augment-swebench-agent. STALE-BY-VENDOR: no new SWE-bench Verified submission since 2025-03-31; vendor's current flagship benchmark is SWE-bench Pro — Auggie CLI 51.80% (379/731, Claude Opus 4.5), 'Auggie tops SWE-Bench Pro', augmentcode.com/blog, 2026-02-04 (different split, not yet a registered metric — see metrics.ts).",
      asOf: "2025-03-31",
      values: { "swe-bench-verified-resolve-rate": 0.654 },
    },
  },
  {
    id: "github-copilot-coding-agent",
    label: "GitHub Copilot coding agent",
    kind: "closed-commercial",
    homepage: "https://github.com/newsroom/press-releases/coding-agent-for-github-copilot",
    resultSource: {
      kind: "published",
      citation:
        "GitHub, 'Vibe coding with GitHub Copilot: Agent mode and MCP support rolling out to all VS Code users', github.blog/news-insights/product-news, 2025-04-04 ('agent mode achieves a pass rate of 56.0% on SWE-bench Verified with Claude 3.7 Sonnet'); GitHub, 'GitHub Introduces Coding Agent For GitHub Copilot', github.com/newsroom/press-releases/coding-agent-for-github-copilot, 2025-05-19 (asynchronous coding agent launch — assign a GitHub issue to Copilot and the agent pushes commits to a draft PR, tracked via agent session logs).",
      asOf: "2025-04-04",
      values: { "swe-bench-verified-resolve-rate": 0.56 },
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
    // STALE-BY-VENDOR (corpus-refresh-metagpt Pivot, audited 2026-06-02): the
    // FoundationAgents/MetaGPT corpus metric (`humaneval-pass-at-1`) is the
    // ICLR-2024 headline; the `asOf` below stays at 2024-05-07 honestly rather
    // than being restamped with a fresh date. The vendor's most recent
    // publications carrying benchmark numbers are February 2025 — Atom of
    // Thoughts (arXiv:2502.12018) and Self-Supervised Prompt Optimization
    // (arXiv:2502.06855) — both >365 days before this audit, and neither
    // restates a comparable HumanEval/MBPP Pass@1 absolute for the MetaGPT
    // framework itself. Per the task Pivot ("if the vendor has not published a
    // new number in the last 365 days, mark stale-by-vendor and do NOT refresh
    // asOf — masking the staleness with a re-stated old number is worse than
    // acknowledging it"). Re-audit when FoundationAgents publishes a new
    // absolute coding-benchmark reading; see competitors/metagpt.md
    // § "Scorecard readings" for the dated vendor-publication trail.
    label: "MetaGPT (Foundation Agents — ICLR 2024)",
    kind: "open-source",
    homepage: "https://github.com/FoundationAgents/MetaGPT",
    resultSource: {
      kind: "published",
      citation:
        "Hong, Zhuge, Chen, Zheng, Cheng, Wang, Zhuge, Wang, Yau, Lin, Zhou, Ran, Xiao, Wu, Schmidhuber, 'MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework', arXiv 2308.00352, ICLR 2024 Oral (HumanEval Pass@1 = 0.859 — SoTA at publication; MBPP Pass@1 = 0.877; 28.2% relative improvement over GPT-4 on HumanEval via Standardized Operating Procedure-shaped multi-agent assembly line); reproducible at github.com/FoundationAgents/MetaGPT. Stale-by-vendor as of 2026-06-02: the framework's last absolute coding-benchmark reading remains the ICLR-2024 number; subsequent FoundationAgents papers (Atom of Thoughts arXiv:2502.12018, Self-Supervised Prompt Optimization arXiv:2502.06855, both Feb 2025) optimise workflow/prompt scaffolding and do not republish a MetaGPT-framework HumanEval/MBPP Pass@1 to refresh against.",
      asOf: "2024-05-07",
      values: { "humaneval-pass-at-1": 0.859 },
    },
  },
  {
    id: "autogen-microsoft",
    label: "AutoGen (Microsoft Research)",
    kind: "open-source",
    homepage: "https://github.com/microsoft/autogen",
    resultSource: {
      kind: "published",
      citation:
        "Wu, Bansal, Zhang, Wu, Li, Zhu, Wang, Saied, Awadallah, Yang, 'AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework', arXiv 2308.08155, 2023 (MATH whole-test accuracy = 69.48% with the multi-agent conversation framework vs GPT-4's 55.18%; AutoGen does not publish a headline HumanEval Pass@1 for stock models — HumanEval is run model-dependently via the AutoGenBench tool, so the MATH whole-test number is the orchestrator-tier primary reading). AutoGen was folded into Microsoft Agent Framework at MAF v1.0 (April 2026); the Wu et al. 2023 paper remains the primary citation for the AutoGen-branded benchmark numbers — see competitors/autogen.md for the post-merger redirect and the wrap-feasibility verdict.",
      asOf: "2023-08-16",
      values: { "math-whole-test-accuracy": 0.6948 },
    },
  },
  // ---- THESIS FALSIFIER (a method, not a product — runs head-to-head) -------
  // Per task `competitor-deep-research-tier-s-2026-05`: Agentless is the
  // load-bearing reference that pressure-tests Minsky's reason for existing
  // (does an autonomic loop + governance gate beat a fixed pipeline?). It is
  // the ONLY corpus arm that carries a `local-harness` descriptor rather than
  // a `published` snapshot, because it is a falsifier WE run ourselves against
  // the shared workload — not a vendor publishing a comparable Minsky-metric
  // number. The slice-(c) scorecard runner owns execution of `harnessId`; this
  // leaf only names the reproducible OpenAutoCoder/Agentless SWE-bench script.
  // Including it is mandatory regardless of any adoption verdict: a
  // reason-for-existing that cannot be falsified is not engineering (rule #9 /
  // Munafò et al. 2017 — pre-registration). See competitors/agentless.md
  // § "Five pivot questions" for the full Reference / thesis-falsifier verdict.
  {
    id: "agentless",
    label: "Agentless (OpenAutoCoder — fixed-pipeline thesis falsifier)",
    kind: "open-source",
    homepage: "https://github.com/OpenAutoCoder/Agentless",
    resultSource: {
      kind: "local-harness",
      citation:
        "Xia, Deng, Dunn, Zhang, 'Agentless: Demystifying LLM-based Software Engineering Agents', arXiv 2407.01489, 2024 (ICSE 2026; SWE-bench Lite resolve rate 27.33% at ~$0.34 average cost per issue with a GPT-4o driver — at publication the best-performing AND lowest-cost open-source entry, demonstrating a fixed localize→repair→validate pipeline rivals agent loops on bug-fix-shaped tasks). Reproducible harness scripts at github.com/OpenAutoCoder/Agentless; the slice-(c) runner invokes the harness against Minsky's M1.10 corpus head-to-head. This is the corpus's thesis-falsifier arm: it tests whether Minsky's orchestration + governance layer pays rent over a vanilla fixed pipeline, per rule #9 falsifiability.",
      harnessId: "agentless-swebench-lite",
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
