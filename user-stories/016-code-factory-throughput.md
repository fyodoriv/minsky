# Story 016 — Code-factory throughput at scale is falsifiable

**Milestone(s)**: M1

> **Why this story exists.** The "code factory" pillar of the vision — Minsky produces software 24/7 across a fleet of repos — was a claim with no measurement behind it. The cross-repo runner walks N hosts at K iterations/host, but nothing exercised `--hosts-dir` against a fleet of ≥5 repos and reported PRs/day, iterations/day, or draft-acceptance at scale. An unmeasured pillar is a marketing slogan, not an engineering claim. This story closes that gap: one command walks a fixture fleet, projects the observed outcomes to a 24h window, and writes two falsifiable rows to the competitive scorecard so the throughput claim can be confirmed or refuted.

## Story

As the operator I want to point Minsky at a fleet of repos and get a single, reproducible number for "how many PRs/day does this produce at scale" — so the "code factory" claim is something I can publish, A/B against a stability change, or watch regress.

I run:

```bash
minsky benchmark --throughput
```

The throughput runner:

1. **Fleet discovery** — walks `test-fixtures/throughput/` (override with `--hosts-dir`), taking the first `--fixture-hosts=N` (default 5) host directories that carry a `.git/` or a `TASKS.md`.
2. **Per-host iteration** — runs the cross-repo runner once per host. Dry-run by default (no agent spawn, no API budget); `--live` spawns real agents.
3. **Projection** — sums the observed wall-clock and PR-producing outcomes across the fleet and linearly projects them to the requested `--duration` window (default `24h`) — the DORA deployment-frequency shape.
4. **Scorecard write** — merges `minsky_throughput_prs_per_day`, `minsky_draft_acceptance_rate`, and `minsky_throughput_iterations_per_day` into `competitive-scorecard.json` under the `minsky-self` competitor.

`--json` emits the full report for piping into `jq` / a dashboard / a CI gate. The benchmark never pushes, never force-pushes, never deletes branches — dry-run mode plans only, and `--live` inherits the runner's existing safety invariants.

That's `minsky benchmark --throughput`. One command. Discover → iterate → project → record. The "code factory" pillar is now a number, not a slogan.

## Acceptance criteria

1. `minsky benchmark --throughput` discovers ≥1 fixture host under `test-fixtures/throughput/` (or `--hosts-dir`), runs one iteration per host, and writes a `competitive-scorecard.json`.
2. The scorecard carries `minsky_throughput_prs_per_day`, `minsky_draft_acceptance_rate` (∈ [0, 1]), and `minsky_throughput_iterations_per_day` under `competitors["minsky-self"].values`, each a non-negative number, plus an ISO-8601 `measured_at`.
3. `--fixture-hosts=N` walks exactly N hosts (capped at the fleet size); `--duration` accepts `24h | 90m | 3600s | <bare-seconds>` and rejects anything else with exit 2.
4. `--json` emits valid parseable JSON on stdout suitable for `jq` / CI gates / dashboards.
5. An empty fleet exits 2 with an actionable message naming the expected layout — never a zero-host "success" that silently fabricates a rate.
6. `--throughput` is a flag on the existing `benchmark` subcommand (rule #11 — no new subcommand); the `--throughput` token routes to `scripts/throughput-benchmark.mjs` and is consumed before forwarding.
7. The CLI documents itself: `minsky benchmark --throughput --help` prints a `Usage:` block listing `--fixture-hosts`, `--duration`, `--hosts-dir`, `--scorecard`, `--live`, and `--json`.

## Metric

- **Name**: `minsky_throughput_prs_per_day`
- **Definition**: PRs observed across the fixture fleet, linearly projected to a 24h window: `(prs_observed / observed_seconds) × 86400`, rounded. Companion metric `minsky_draft_acceptance_rate = prs_accepted / prs_observed` where "accepted" means the iteration produced a PR-candidate without scope-leak / force-push / destructive op.
- **Threshold**: Ship gate (this story): the benchmark produces a reproducible `competitive-scorecard.json` with both rows well-typed and non-negative (re-runs agree on shape). Pillar gate (the task Hypothesis): a `--live` fleet of ≥5 hosts over 24h reaches ≥10 PRs/day at ≥0.80 draft-acceptance; below that the pillar stays 🟡 until a stability ratchet ships.
- **Source**: `competitive-scorecard.json` `competitors["minsky-self"].values` written by `scripts/throughput-benchmark.mjs`; reproducibility is asserted by the integration test.

## Integration test

`test/integration/throughput-benchmark.test.ts` exercises the real script + the real `bin/minsky benchmark --throughput` wiring:

- The full 5-host fleet writes a scorecard with the three well-typed, non-negative rows + `measured_at`.
- `--fixture-hosts=3 --duration=90m` walks a subset and reports `duration_seconds == 5400`.
- `bin/minsky benchmark --throughput` routes to the throughput runner (asserts `fixture_hosts` is present and `pass_rate` is absent — proving the flag routed, not the plain benchmark).
- `--throughput --help` prints a `Usage:` block naming `--throughput`.
- An empty fleet exits 2 with `no fixture hosts`; a malformed `--duration=soon` exits 2 naming `--duration`.

The pure projection helpers (`aggregateThroughput`, `scaleToWindow`, `parseDuration`, `classifyHostOutcome`, `buildScorecardRows`, `parseArgs`, `formatThroughputSummary`) are unit-tested in `scripts/throughput-benchmark.test.mjs`.

## Proof

```bash
node scripts/throughput-benchmark.mjs --hosts-dir test-fixtures/throughput \
  --fixture-hosts=5 --duration=24h --json
# → {"fixture_hosts": 5, "duration_seconds": 86400,
#    "minsky_throughput_prs_per_day": <N>, "minsky_draft_acceptance_rate": <0..1>, ...}
```

## Failure modes

| Failure mode | Expected behavior | Chaos test |
|---|---|---|
| Empty / missing fleet directory | `graceful-degrade` — exit 2 with an actionable message, never a fabricated zero-host rate | `test/integration/throughput-benchmark.test.ts` ("rejects an empty fleet with exit 2") |
| Degenerate observed window (0s wall-clock) | `graceful-degrade` — `scaleToWindow` returns 0, never `Infinity` | `scripts/throughput-benchmark.test.mjs` ("zero observed window returns 0") |
| Malformed `--duration` spec | `graceful-degrade` — exit 2 naming `--duration`, never a silent default | `test/integration/throughput-benchmark.test.ts` ("rejects a malformed --duration") |
| Corrupt existing scorecard JSON | `loud-crash-supervisor-restart` — `JSON.parse` throws loudly rather than silently overwriting other competitors' rows | `scripts/throughput-benchmark.test.mjs` (scorecard-row contract pins the merge shape) |

**Blast radius**: a benchmark misfire affects only `competitive-scorecard.json` and the operator's terminal — no host repo is mutated in dry-run mode, and `--live` inherits the runner's existing push/force-push/branch-delete safety invariants. **Operator escape hatch**: pass `--scorecard /dev/null`-style throwaway path, or omit `--live` to keep the run side-effect-free.
