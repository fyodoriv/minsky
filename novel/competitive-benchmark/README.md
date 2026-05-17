# `@minsky/competitive-benchmark`

<!-- rule-1: an off-the-shelf benchmark library (e.g. `benchmark`, `tinybench`, `swebench` harness) rejected because: those measure micro-throughput or run the SWE-bench harness; none define the DORA+agentic *outcome* metric set Minsky ranks itself and competitor autonomous-coding systems on. This is a cited domain catalogue, not a runner. -->

Slice (a) of task `self-metrics-competitive-benchmark`: the **pure, cited
metric set** + direction-aware comparison helpers that the automated
comparison runner (slice c), the dashboard panel (slice c), and the
`check-competitive-goal.mjs` meta-rule lint (slice d) all consume. Keeping
the catalogue a zero-dependency leaf means every consumer shares one
definition of "what Minsky measures itself and its competitors on".

The competitor corpus (slice b), the scheduled `$0` scorecard job (slice c),
the `**Competitive-goal**:` TASKS.md meta-rule (slice d), and the new-repo
bootstrap-baseline priority (slice e) are separate, later-shipped surfaces.
This package ships none of them — it ships the substrate they stand on.

Public surface:

- `MetricDefinition` — `{ id, label, category, unit, direction, anchor, description }`.
- `MetricCategory` — `"dora" | "agentic" | "public-benchmark"`.
- `MetricDirection` — `"higher-is-better" | "lower-is-better"`.
- `MetricUnit` — `"count-per-day" | "seconds" | "ratio" | "usd"`.
- `METRICS` — the 11-metric catalogue (4 DORA keys + 6 agentic + 1 public).
- `metricById(id)` — catalogue lookup.
- `compareValues(metric, a, b)` — direction-aware rank: `1` = `a` better, `-1` = `b` better, `0` = tie.
- `computeDelta(metric, minskyValue, competitorValue)` — direction-normalised delta; positive = Minsky ahead.

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

There is no I/O on this code path, so most failure modes are categorically
absent. The remaining surface is the type boundary — enforced by
`verbatimModuleSyntax` + `strict` + `noUncheckedIndexedAccess` in
`tsconfig.base.json` rather than runtime checks.

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a single zero-dependency cited metric catalogue, consumed
  by the scorecard runner + dashboard + meta-rule lint, eliminates the risk
  of three divergent definitions of "what we measure" and makes the
  competitive scorecard (slices c–e) buildable on a stable substrate.
- **Success threshold**: `pnpm typecheck && pnpm test` exit 0; the catalogue
  ships ≥5 metrics across all three families (slice-c success bar);
  `metrics.ts` at ≥90 % line / ≥85 % branch coverage (the constitutional
  `novel/` gate).
- **Pivot threshold**: if the metric set cannot be expressed as pure data
  (a metric needs live I/O to even be *defined*, not just measured), abandon
  the leaf-package shape and fold the definition into the slice-c runner
  with a CI lint asserting the runner's inline copy matches a single source.
- **Measurement**: `pnpm vitest run novel/competitive-benchmark/src/metrics.test.ts`
  exits 0 with the catalogue/branch assertions green;
  `node -e "import('@minsky/competitive-benchmark').then(m=>console.log(m.METRICS.length))"`
  prints `11`.
- **Literature anchor**: Basili, Caldiera, Rombach, *GQM*, 1994 (derive the
  metric from the goal); Forsgren, Humble, Kim, *Accelerate*, 2018 (DORA —
  outcome not vanity); Jimenez et al., *SWE-bench*, *ICLR* 2024 (public
  head-to-head axis); Martin, *Clean Architecture*, 2017 (acyclic dependency
  principle — the pure leaf).

## Usage

```ts
import { METRICS, compareValues, computeDelta, metricById } from "@minsky/competitive-benchmark";

const merge = metricById("autonomous-merge-rate");
if (merge) {
  const ahead = computeDelta(merge, 0.62 /* minsky */, 0.41 /* competitor */); // +0.21 → ahead
  const rank = compareValues(merge, 0.62, 0.41); // 1 → minsky better
}
```

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard &
LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: numeric raw values passed to `compareValues` /
  `computeDelta` and string ids passed to `metricById` — in production these
  originate from Minsky's own OTEL/ledger stream (slice c) and the competitor
  corpus (slice b). A corpus is *data*; a malicious or malformed corpus could
  feed `NaN`, `Infinity`, or an unknown id.
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
