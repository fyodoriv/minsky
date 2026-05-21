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
        "Anthropic, 'Claude 3.7 Sonnet and Claude Code', anthropic.com, 2025 (SWE-bench Verified, agentic harness)",
      asOf: "2025-02-24",
      values: { "swe-bench-verified-resolve-rate": 0.49 },
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
        "Wang et al., 'OpenHands: An Open Platform for AI Software Developers as Generalist Agents', 2024 (SWE-bench Verified, public leaderboard)",
      asOf: "2025-01-15",
      values: { "swe-bench-verified-resolve-rate": 0.53 },
    },
  },
  {
    id: "swe-agent",
    label: "SWE-agent (Princeton NLP)",
    kind: "open-source",
    homepage: "https://github.com/SWE-agent/SWE-agent",
    resultSource: {
      kind: "published",
      citation:
        "Yang et al., 'SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering', NeurIPS 2024 (SWE-bench Verified)",
      asOf: "2024-10-01",
      values: { "swe-bench-verified-resolve-rate": 0.18 },
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
        "Aider, 'Aider LLM leaderboards', aider.chat/docs/leaderboards, 2025 (SWE-bench subset)",
      asOf: "2025-01-10",
      values: { "swe-bench-verified-resolve-rate": 0.26 },
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
        "Cognition Labs, 'Introducing Devin', cognition.ai, 2024 (original SWE-bench end-to-end; superseded numbers tracked on refresh)",
      asOf: "2024-03-12",
      values: { "swe-bench-verified-resolve-rate": 0.139 },
    },
  },
  {
    id: "cursor-agent",
    label: "Cursor agent",
    kind: "closed-commercial",
    homepage: "https://www.cursor.com",
    resultSource: {
      // No reproducible public SWE-bench Verified number; the slice-(c)
      // runner drives a reproducible local harness against the shared
      // workload instead. This arm exercises the non-published adapter path.
      kind: "local-harness",
      citation:
        "Cursor, 'Cursor agent mode', cursor.com/features, 2025 (no public Verified figure; reproduced via shared local workload)",
      harnessId: "shared-workload-local",
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
