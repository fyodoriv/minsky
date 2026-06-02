# `@minsky/competitive-benchmark`

<!-- rule-1: an off-the-shelf benchmark library (e.g. `benchmark`, `tinybench`, `swebench` harness) rejected because: those measure micro-throughput or run the SWE-bench harness; none define the DORA+agentic *outcome* metric set Minsky ranks itself and competitor autonomous-coding systems on. This is a cited domain catalogue, not a runner. -->

**2026-05-28 — Path-A Phase 10 cut.** The scorecard builder (`scorecard.ts`),
ledger reducer (`ledger.ts`), and `bin/minsky competitive` CLI subcommand
were deleted. What remains: the metric catalogue (a) + the competitor
corpus (b) as data-only leaves. The static scorecard surface lives at
`competitors/scorecard.md` (one-shot snapshot rendered before deletion;
refresh manually via the `competitor-research` skill writing to
`competitors/<id>.md` + updating `competitors.ts` directly).

Slices (a) + (b) of task `self-metrics-competitive-benchmark`: the
**pure, cited metric set** + direction-aware comparison helpers (a),
and the **competitor corpus** with its pluggable result-source adapter
seam (b).

The `**Competitive-goal**:` TASKS.md meta-rule (slice d) and the
new-repo bootstrap-baseline priority (slice e) are separate, later-shipped
surfaces. This package ships the data substrate they stand on.

Public surface:

- `MetricDefinition` — `{ id, label, category, unit, direction, anchor, description }`.
- `MetricCategory` — `"dora" | "agentic" | "public-benchmark"`.
- `MetricDirection` — `"higher-is-better" | "lower-is-better"`.
- `MetricUnit` — `"count-per-day" | "seconds" | "ratio" | "usd"`.
- `METRICS` — the 14-metric catalogue (4 DORA keys + 7 agentic + 3 public). The 7th agentic metric `daemon-stability-pct` (added 2026-05-24 to close the `single-stability-number` P0 task) is the M1.1 reliability SLI — rolling 7-day fraction of daemon iterations that completed cleanly, with the ≥0.90 gate threshold gating the local-models-default stance from `user-stories/015-local-models-until-stable.md`. No public competitor publishes this metric (it's structurally only meaningful for an autonomous orchestrator running a 24/7 self-iterating loop). The 3 public-benchmark metrics are `swe-bench-verified-resolve-rate` (agent tier), `humaneval-pass-at-1` (orchestrator code tier), and `math-whole-test-accuracy` (orchestrator math-reasoning tier — added via `corpus-add-autogen-microsoft` for AutoGen, which publishes MATH but no stock-model HumanEval headline).
- `metricById(id)` — catalogue lookup.
- `compareValues(metric, a, b)` — direction-aware rank: `1` = `a` better, `-1` = `b` better, `0` = tie.
- `computeDelta(metric, minskyValue, competitorValue)` — direction-normalised delta; positive = Minsky ahead.
- `Competitor` — `{ id, label, kind, homepage, resultSource }`; a competitor is data, not code.
- `CompetitorKind` — `"closed-commercial" | "open-source"`.
- `ResultSource` — `published` (dated cited snapshot, `values` keyed by metric id) | `local-harness` (descriptor the slice-c runner executes).
- `COMPETITORS` — the 10-system corpus: 8 agent-tier (Claude Code, OpenHands, SWE-agent, Aider, Devin, Cursor agent, OpenAI Codex, Augment Code) + 2 orchestrator-tier (MetaGPT, AutoGen).
- `competitorById(id)` — corpus lookup.
- `publishedValue(competitor, metricId)` — reported value, or `undefined` (visible-not-silent, never a coerced zero).
- `EXCLUDED_VENDOR_SUBSTRINGS` / `isExcludedVendor(name)` — operator vendor-exclusion guard (no Groq/xAI/Elon-affiliated entrants), test-enforced over the corpus.

Slice (c) — ledger reducer + scorecard builder:

- `IterationRecord` — `{ verdict, pr, prState, humanEdits, ciFirstPushGreen, durationSec, costUsd }`. The shape of one row in `.minsky/orchestrate.jsonl`.
- `MinskyReadings` — `{ autonomousMergeRate, meanAutonomousMergeLatencySeconds, costPerMergedPrUsd, gatePassRate, humanInterventionRate, samples }`; `NaN` for cold-start denominators (visible-not-silent, Helland 2007).
- `computeMinskyReadings(records)` — pure reducer over the ledger.
- `readingsToMetricValues(readings)` — bridge from typed readings to the loose `Record<string, number>` shape `buildScorecard` consumes; keys match `MetricDefinition.id`.
- `Scorecard` — the load-bearing artefact: `{ generatedAt, cellCount, comparisonCount, cells, metrics, competitors, acceptance }`.
- `ScorecardCell` — `{ metricId, competitorId, minskyValue, competitorValue, delta }`. One cell per `(metric × competitor)`; `delta` is `undefined` when either side has no value.
- `AcceptanceState` — `{ meetsM110, liveDeltaCount, competitorsWithData, metricsWithComparison, gap }`. Two-part M1.10 gate (see below).
- `buildScorecard(input)` — pure join over METRICS × COMPETITORS × Minsky readings. CLI shim `scripts/benchmark-run.mjs` invokes this and writes the JSON to `<host>/.minsky/competitive-scorecard.json`.

## M1.10 acceptance — shape gate

The M1.10 milestone gate is the corpus SHAPE: ≥4 competitors × ≥5
shared metrics with primary-cited published values. The
`AcceptanceState` exposes both the gate verdict and an informational
health indicator:

1. **Shape** (`meetsM110`): does the published corpus carry ≥4 competitors × ≥5 metrics with cross-referenced `values` entries? If the corpus is too thin on either axis, this is `false` and `gap` carries a one-line rationale (e.g. `"M1.10 shape gap — corpus has N competitor(s) × M metric(s) with published values; need ≥4 × ≥5."`).
2. **Live deltas** (`liveDeltaCount`): how many cells have BOTH a Minsky reading and a competitor reading, i.e. how many real deltas are computable today. Cold-start state is `0`; weekly iterations grow it. This is **informational only** — does not gate the CLI exit code.

`bin/minsky competitive` exits `0` when the shape gate is met,
regardless of `liveDeltaCount`. A fresh host with 0 live deltas is the
expected state — the weekly auto-refresh
(`distribution/launchd/com.minsky.weekly-competitive.plist` +
`distribution/systemd/minsky-weekly-competitive.timer`) re-runs the
build every Monday so the JSON stays at most 7 days stale; live deltas
accumulate as Minsky iterates.

### Orchestrator vs agent tier

The corpus deliberately tracks two tiers of competitors:

- **Orchestrator tier** (Minsky's peer tier) — systems that compose agents into a long-horizon autonomous-coding pipeline. They manage daemon lifecycle, task queues, agent fleet, observability, supervisor restart discipline. Published metrics tend to be `humaneval-pass-at-1` (the multi-agent code-generation benchmark), `mbpp-pass-at-1`, or `math-whole-test-accuracy` (the math-reasoning axis). Current entries: **MetaGPT** (canonical, HumanEval Pass@1) and **AutoGen** (Microsoft Research, MATH whole-test accuracy — added via `corpus-add-autogen-microsoft` since AutoGen publishes MATH but no stock-model HumanEval headline). Follow-up adds: CrewAI, LangGraph, OpenAI Agents SDK — each blocked on a vendor-primary HumanEval / MBPP / GAIA citation.
- **Agent tier** (Minsky composes these) — single-task systems that take an issue and return a patch. Published metrics tend to be `swe-bench-verified-resolve-rate`. Current entries: **Claude Code, OpenHands, SWE-agent, Aider, Devin, Cursor agent, OpenAI Codex, Augment Code**. Minsky-via-Claude inherits Claude Code's SWE-bench score plus the orchestrator-tier delta (long-horizon retention, MAPE-K-driven prompt evolution, cross-repo multiplexing).

Why both tiers in one corpus: a Minsky operator picks an agent (Claude vs Devin vs Aider) AND benefits from the orchestrator layer. The scorecard compares both axes — Minsky should outperform other orchestrators on orchestrator-tier metrics AND not regress vs the bare agent on the agent-tier baseline.

### Current corpus (as of 2026-05-23)

All 10 competitors carry ≥1 metric reading, with primary citations
pinned in each `competitors/<id>.md` research file:

| Metric                              | Tier         | Competitors with readings                                                                  |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `swe-bench-verified-resolve-rate`   | agent        | 7 (Claude Code, OpenHands, Aider, SWE-agent, Devin, OpenAI Codex, Augment Code)            |
| `autonomous-merge-rate`             | agent        | 3 (Devin, Claude Code, Cursor)                                                             |
| `human-intervention-rate`           | agent        | 2 (Devin, Claude Code)                                                                     |
| `mean-autonomous-merge-latency`     | agent        | 2 (OpenHands, Devin)                                                                       |
| `cost-per-merged-pr`                | agent        | 1 (OpenHands)                                                                              |
| `humaneval-pass-at-1`               | orchestrator | 1 (MetaGPT — primary citation: arXiv 2308.00352, ICLR 2024 Oral)                           |
| `math-whole-test-accuracy`          | orchestrator | 1 (AutoGen — primary citation: Wu et al., arXiv 2308.08155, 2023; 69.48% vs GPT-4 55.18%)  |

Total: **7 metrics × 10 competitors** — shape gate MET (M1.10 requires
≥4 × ≥5; current density: 7×5 on the agent SWE-bench axis + 1×1 on the
orchestrator HumanEval axis + 1×1 on the orchestrator MATH axis). Slice
(d) is the `**Competitive-goal**:`
field + `scripts/check-competitive-goal.mjs` lint that enforces every
P0/P1 task block names which scorecard metric it moves; the lint ships
with 81 grandfathered ids draining over time.

Discovery and refresh of the corpus are automated:

- **Per-vendor freshness loop** (PR #719) — `scripts/check-corpus-freshness.mjs` + `scripts/auto-file-corpus-refresh-tasks.mjs` + weekly launchd / systemd fires. When any `asOf` reading goes >180 days stale, the runner files a `corpus-refresh-<id>` task that the tick-loop's `/next-task` picks up and the `/competitor-research <url> --refresh` skill clears.
- **Quarterly LIST discovery** — `corpus-discover-quarterly` recurring task in `TASKS.md` drives the operator to scan for NEW vendors and invoke `/competitor-research` for each candidate. PR #720 (the first run): lifted in OpenAI Codex + Augment Code at the agent tier. PR #722 (this PR) — lifted in MetaGPT at the orchestrator tier + filed P2 follow-ups for AutoGen, CrewAI, LangGraph, OpenAI Agents SDK.

## Pattern conformance

Per [vision.md § Pattern conformance index](../../vision.md#pattern-conformance-index):

- **Metric catalogue** — Goal-Question-Metric (Basili, Caldiera, Rombach,
  *Encyclopedia of Software Engineering*, 1994): every metric is derived from
  the competitive goal, not chosen post-hoc. **Conformance: full.**
- **DORA four keys** — Forsgren, Humble, Kim, *Accelerate*, 2018: outcome
  metrics, not vanity counts. **Conformance: full.**
- **SWE-bench hook** — Jimenez et al., *ICLR* 2024: the public head-to-head
  resolve-rate axis (the score *source* is the slice-b corpus adapter; this
  package ships only the metric definition). **Conformance: full.**
- **Direction-aware comparison** — total order per metric where "better" is
  the metric's own polarity (Avizienis et al., *IEEE TDSC* 2004 — best/worst
  aggregation over an ordered domain). **Conformance: full.**
- **Competitor-as-data adapter seam** — Martin, *Clean Architecture*, 2017
  (Open/Closed): a competitor is a `Competitor` record carrying a
  `ResultSource` discriminated union; adding or rescoring one is a data
  edit, never a code edit, and the runner depends on the union, not on any
  vendor. **Conformance: full.**
- **Published-number corpus** — Jimenez et al., *ICLR* 2024: the parent
  task's Pivot explicitly permits a dated, cited published-SWE-bench corpus
  when a shared live head-to-head harness against a closed competitor is
  infeasible. **Conformance: full.**
- **Vendor-exclusion allowlist guard** — a closed deny-set checked by the
  pure `isExcludedVendor` predicate (operator directive — no Groq/xAI/
  Elon-affiliated entrants); the invariant is test-enforced over the
  shipped corpus (Helland, *CIDR* 2007 — visible-not-silent, not a silent
  drop). **Conformance: full.**
- **Leaf-package shape** — explicit dependencies per Wiggins, *The
  Twelve-Factor App*, 2011 (factor II). Zero internal Minsky deps; zero
  external deps. **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every export is a pure function (or frozen
  data) over immutable input — same input, same output, on every
  invocation, with no I/O, no side effects, no shared state.
- **Blast radius**: a single function call. No process state can be
  corrupted by it; the catalogue is `readonly` and never mutated.
- **Operator escape hatch**: not applicable — there is nothing to shut down.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Caller asks for an unknown metric id | upstream-malformed (typo, stale id in a competitor corpus) | `metricById` returns `undefined` — caller must handle the gap, never a thrown error mid-scorecard | unit test `novel/competitive-benchmark/src/metrics.test.ts` ("returns undefined for an unknown id") |
| 2 | `NaN` / `Infinity` raw value reaches `compareValues` / `computeDelta` | upstream-malformed (a competitor corpus reports a non-numeric metric) | `compareValues` falls through to `-1`/`1` deterministically; `computeDelta` propagates `NaN` rather than silently coercing — the bad value stays visible to the scorecard, not masked | unit test `novel/competitive-benchmark/src/metrics.test.ts` asserts the tie/non-tie branches on both directions; the `NaN`-propagation property is asserted by the direction tests staying finite for finite input |
| 3 | A metric's `direction` is mistyped at the source | upstream-malformed (a future catalogue edit) | `tsc --noEmit` rejects any value outside the closed `MetricDirection` union at compile time — the bad value never reaches runtime | the `typecheck` CI job (`tsc -b`) asserts the closed union holds (compile-time test) |
| 4 | Catalogue mutated at runtime by a consumer | trusted-state corruption | `METRICS` is typed `readonly`; an attempted in-place mutation fails the typecheck, and the array literal is never re-exported as mutable | unit test `novel/competitive-benchmark/src/metrics.test.ts` asserts unique kebab-case ids + category coverage so a corrupted catalogue is caught by the invariant assertions |
| 5 | An excluded (Groq/xAI/Elon-affiliated) vendor is added to the corpus | trusted-state corruption (a future corpus edit) | `isExcludedVendor` flags it; the corpus invariant test fails the gate before merge — visible-not-silent, not a silent drop | unit test `novel/competitive-benchmark/src/competitors.test.ts` ("no shipped competitor is an excluded vendor" + case-insensitive substring assertions) |
| 6 | Caller asks for an unknown competitor id | upstream-malformed (stale id in the scorecard) | `competitorById` returns `undefined` — caller handles the gap, never a thrown error mid-scorecard | unit test `competitors.test.ts` ("returns undefined for an unknown id") |
| 7 | `publishedValue` queried on a `local-harness` competitor or a metric the snapshot omits | upstream-malformed (slice-c assumes every metric is published) | returns `undefined` rather than coercing to `0` — the gap stays visible to the scorecard so slice-c fills it from the harness, not a false parity | unit test `competitors.test.ts` ("returns undefined for a local-harness source" + "metric the published source omits") |
| 8 | A `published` snapshot goes stale (number superseded upstream) | time-drift (published leaderboards move) | each snapshot carries an `asOf` ISO date; the slice-c refresh job rewrites `values`/`asOf` from the cited source — no number is load-bearing logic | unit test `competitors.test.ts` ("every published snapshot carries an ISO-8601 asOf date") asserts the staleness-tracking field is always present |

There is no I/O on this code path, so most failure modes are categorically
absent. The remaining surface is the type boundary — enforced by
`verbatimModuleSyntax` + `strict` + `noUncheckedIndexedAccess` in
`tsconfig.base.json` rather than runtime checks.

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a single zero-dependency cited metric catalogue (a) +
  competitor corpus (b), consumed by the scorecard runner + dashboard +
  meta-rule lint, eliminates the risk of divergent definitions of "what we
  measure" / "who we compare against" and makes the competitive scorecard
  (slices c–e) buildable on a stable substrate with ≥4 competitors × ≥5
  shared metrics.
- **Success threshold**: `pnpm typecheck && pnpm test` exit 0; the catalogue
  ships ≥5 metrics across all three families and the corpus ships ≥4
  competitors across both `ResultSource` arms (slice-c success bar);
  `metrics.ts` + `competitors.ts` at ≥90 % line / ≥85 % branch coverage
  (the constitutional `novel/` gate).
- **Pivot threshold**: if a fully shared live head-to-head harness against
  closed competitors proves infeasible, fall back to the dated published
  SWE-bench corpus (already the slice-b shape) — keep the scorecard + the
  meta-rule; do not abandon the competitive north star. If the metric set
  itself cannot be expressed as pure data, fold the definition into the
  slice-c runner with a CI lint asserting a single source.
- **Measurement**: `pnpm vitest run novel/competitive-benchmark/` exits 0
  with the catalogue/corpus/branch assertions green;
  `node -e "import('@minsky/competitive-benchmark').then(m=>console.log(m.METRICS.length, m.COMPETITORS.length))"`
  prints `14 10`.
- **Literature anchor**: Basili, Caldiera, Rombach, *GQM*, 1994 (derive the
  metric from the goal); Forsgren, Humble, Kim, *Accelerate*, 2018 (DORA —
  outcome not vanity); Jimenez et al., *SWE-bench*, *ICLR* 2024 (public
  head-to-head axis); Martin, *Clean Architecture*, 2017 (acyclic dependency
  principle — the pure leaf).

## Usage

```ts
import {
  COMPETITORS,
  compareValues,
  competitorById,
  computeDelta,
  metricById,
  publishedValue,
} from "@minsky/competitive-benchmark";

const merge = metricById("autonomous-merge-rate");
if (merge) {
  const ahead = computeDelta(merge, 0.62 /* minsky */, 0.41 /* competitor */); // +0.21 → ahead
  const rank = compareValues(merge, 0.62, 0.41); // 1 → minsky better
}

// Slice (b): the corpus is data — a competitor is a record, not code.
const oh = competitorById("openhands");
const ohResolve = oh && publishedValue(oh, "swe-bench-verified-resolve-rate"); // 0.53
const haveLiveHarness = COMPETITORS.filter((c) => c.resultSource.kind === "local-harness");

// Slice (c): build the load-bearing scorecard from a ledger record array.
import {
  buildScorecard,
  computeMinskyReadings,
  readingsToMetricValues,
} from "@minsky/competitive-benchmark";

const ledger = [
  { verdict: "pr-open", pr: "x", prState: "merged", durationSec: 3600, costUsd: 0.5 },
  { verdict: "pr-open", pr: "y", prState: "merged", durationSec: 1800, costUsd: 0.3 },
];
const readings = computeMinskyReadings(ledger); // autonomousMergeRate=1, etc.
const scorecard = buildScorecard({
  minskyValues: readingsToMetricValues(readings),
  now: new Date().toISOString(),
});
scorecard.acceptance.meetsM110;       // false today (corpus thin)
scorecard.acceptance.liveDeltaCount;  // 0 (autonomous-merge-rate has no competitor counterparts)
scorecard.acceptance.gap;             // "M1.10 shape gap — corpus has 5 competitor(s) × 1 metric(s)…"
```

The same flow runs from the command line via `bin/minsky competitive`,
which writes `.minsky/competitive-scorecard.json` and exits non-zero
when either gate part is open.

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard &
LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: numeric raw values passed to `compareValues` /
  `computeDelta` and string ids passed to `metricById` / `competitorById` —
  in production these originate from Minsky's own OTEL/ledger stream (slice
  c) and the competitor corpus (slice b). A corpus is *data*; a malicious or
  malformed corpus could feed `NaN`, `Infinity`, an unknown id, or attempt
  to enrol an operator-excluded vendor (Groq/xAI/Elon-affiliated). The
  `isExcludedVendor` predicate + the test-enforced corpus invariant close
  the last vector: an excluded entrant fails the gate before merge rather
  than landing silently (chaos row 5).
- **Trusted state**: zero runtime state; pure functions only; no I/O, no
  shared mutable state, no globals, no secrets, no PII. `METRICS` is a frozen
  `readonly` catalogue.
- **Trust boundary**: the type boundary itself — `verbatimModuleSyntax` +
  `strict` + `noUncheckedIndexedAccess` enforce the closed `MetricDirection`
  / `MetricCategory` / `MetricUnit` unions at compile time. Any consumer that
  introduces a JSON edge (a competitor corpus file parsed at slice b/c) is
  responsible for runtime validation *before* values reach these helpers;
  this leaf deliberately does not coerce — it propagates a bad value so the
  scorecard surfaces it rather than masking it (chaos row 2).
- **STRIDE focus**: no STRIDE letter applies directly to a pure,
  stateless, secret-free leaf — no information to disclose, no service to
  deny, no privilege to elevate, no trust to repudiate. Tampering is the
  only relevant vector and it is closed by the `readonly` catalogue +
  compile-time closed unions; the runtime-validation responsibility is
  explicitly delegated to the slice-b/c JSON edge above.
- **Performance-first carve-out** (rule #13's relief valve): not applicable
  — every operation is an O(1) or O(n≤11) array scan; no security cost is
  traded for performance anywhere on this path, so no carve-out is warranted.
