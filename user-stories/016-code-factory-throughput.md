# Story 016 — Code-factory throughput at scale is falsifiable

**Milestone(s)**: M1

> **Why this story exists.** Minsky (the background program that works on your code while you are away) claims to be a "code factory": it runs around the clock across many code projects and produces software for you. That claim had no number behind it. Minsky can already walk several projects in turn — each project Minsky works on is a *host* (one git repository), and walking several hosts is a *cross-repo fleet* — but nothing measured what a fleet actually produces. This story adds one command that walks a test fleet, projects the result to a 24-hour day, and writes two checkable numbers to the competitive scorecard. After this, the "code factory" claim can be confirmed or proven wrong, not just asserted.

## Story

You are the operator — the person who runs Minsky. You point Minsky at a fleet of code projects and you want one reproducible number: how many pull requests per day does this produce at scale? You want a number you can publish, compare against a stability change, or watch for regressions.

You run one command:

```bash
minsky benchmark --throughput
```

The throughput runner does four things in order:

1. **Find the fleet.** It walks `test-fixtures/throughput/` (override with `--hosts-dir`) and takes the first `--fixture-hosts=N` host directories (default 5) that contain a `.git/` or a `TASKS.md`. A `TASKS.md` is the plain-text to-do list at a project's root that Minsky reads to pick work.
2. **Run one iteration per host.** One *iteration* is a single round of work: pick a task, ask the coding assistant to do it, capture the result, open a draft. By default the runner is a dry run — it does not start any coding assistant and spends no paid quota. Pass `--live` to run real coding assistants.
3. **Project to a day.** It adds up the observed wall-clock time and the pull-request outcomes across the fleet, then projects them linearly to the `--duration` window (default `24h`). This is the DORA deployment-frequency shape.
4. **Write the scorecard.** It merges three numbers — `minsky_throughput_prs_per_day`, `minsky_draft_acceptance_rate`, and `minsky_throughput_iterations_per_day` — into `competitive-scorecard.json` under the `minsky-self` competitor.

Pass `--json` to print the full report on stdout for piping into `jq`, a dashboard, or a CI gate. The benchmark never pushes, never force-pushes, and never deletes branches. Dry-run mode only plans, and `--live` inherits the runner's existing safety invariants.

That is `minsky benchmark --throughput`. One command. Find the fleet, run an iteration per host, project to a day, record the result. The "code factory" claim is now a number, not a slogan.

## Acceptance criteria

1. `minsky benchmark --throughput` finds at least one fixture host under `test-fixtures/throughput/` (or `--hosts-dir`), runs one iteration per host, and writes a `competitive-scorecard.json`.
2. The scorecard carries `minsky_throughput_prs_per_day`, `minsky_draft_acceptance_rate` (a value between 0 and 1), and `minsky_throughput_iterations_per_day` under `competitors["minsky-self"].values`. Each is a non-negative number, alongside an ISO-8601 `measured_at`.
3. `--fixture-hosts=N` walks exactly N hosts (capped at the fleet size). `--duration` accepts `24h | 90m | 3600s | <bare-seconds>` and rejects anything else with exit 2.
4. `--json` prints valid, parseable JSON on stdout, ready for `jq`, CI gates, or dashboards.
5. An empty fleet exits 2 with a clear message naming the expected layout. It never reports a zero-host "success" that silently invents a rate.
6. `--throughput` is a flag on the existing `benchmark` subcommand (rule #11 — no new subcommand). The `--throughput` token routes to `scripts/throughput-benchmark.mjs` and is consumed before forwarding.
7. The CLI documents itself: `minsky benchmark --throughput --help` prints a `Usage:` block listing `--fixture-hosts`, `--duration`, `--hosts-dir`, `--scorecard`, `--live`, and `--json`.

## Metric

- **Name**: `minsky_throughput_prs_per_day`
- **Definition**: pull requests observed across the fixture fleet, projected linearly to a 24-hour window: `(prs_observed / observed_seconds) × 86400`, rounded. The companion metric `minsky_draft_acceptance_rate = prs_accepted / prs_observed`, where "accepted" means the iteration produced a PR-candidate with no scope-leak (the agent changed files outside the ones the task declared), no force-push, and no destructive op.
- **Threshold**: Ship gate (this story): the benchmark produces a reproducible `competitive-scorecard.json` with both rows well-typed and non-negative, and re-runs agree on shape. Pillar gate (the task hypothesis): a `--live` fleet of at least 5 hosts over 24h reaches at least 10 PRs/day at a draft-acceptance rate of at least 0.80. Below that, the pillar stays 🟡 until a stability ratchet ships.
- **Source**: `competitive-scorecard.json` `competitors["minsky-self"].values`, written by `scripts/throughput-benchmark.mjs`. The integration test asserts reproducibility.

## Integration test

`test/integration/throughput-benchmark.test.ts` exercises the real script plus the real `bin/minsky benchmark --throughput` wiring:

- The full 5-host fleet writes a scorecard with the three well-typed, non-negative rows plus `measured_at`.
- `--fixture-hosts=3 --duration=90m` walks a subset and reports `duration_seconds == 5400`.
- `bin/minsky benchmark --throughput` routes to the throughput runner. It asserts `fixture_hosts` is present and `pass_rate` is absent — proving the flag routed, not the plain benchmark.
- `--throughput --help` prints a `Usage:` block naming `--throughput`.
- An empty fleet exits 2 with `no fixture hosts`. A malformed `--duration=soon` exits 2 naming `--duration`.

The pure projection helpers (`aggregateThroughput`, `scaleToWindow`, `parseDuration`, `classifyHostOutcome`, `buildScorecardRows`, `parseArgs`, `formatThroughputSummary`) are unit-tested in `scripts/throughput-benchmark.test.mjs`.

## Proof

```bash
node scripts/throughput-benchmark.mjs --hosts-dir test-fixtures/throughput \
  --fixture-hosts=5 --duration=24h --json
# → {"fixture_hosts": 5, "duration_seconds": 86400,
#    "minsky_throughput_prs_per_day": <N>, "minsky_draft_acceptance_rate": <0..1>, ...}
```

## Failure modes & chaos verification

The steady-state hypothesis: in dry-run mode the benchmark reads the fixture fleet, writes one well-typed scorecard, and mutates no host repo. The blast radius is small — see below. The escape hatch is to omit `--live` (keeping the run side-effect-free) or to pass a throwaway `--scorecard /dev/null`-style path.

| Failure mode | Expected behavior | Chaos test |
|---|---|---|
| Empty or missing fleet directory | `graceful-degrade` — exit 2 with a clear message, never a fabricated zero-host rate | `test/integration/throughput-benchmark.test.ts` ("rejects an empty fleet with exit 2") |
| Degenerate observed window (0s wall-clock) | `graceful-degrade` — `scaleToWindow` returns 0, never `Infinity` | `scripts/throughput-benchmark.test.mjs` ("zero observed window returns 0") |
| Malformed `--duration` spec | `graceful-degrade` — exit 2 naming `--duration`, never a silent default | `test/integration/throughput-benchmark.test.ts` ("rejects a malformed --duration") |
| Corrupt existing scorecard JSON | `loud-crash-supervisor-restart` — `JSON.parse` throws loudly rather than silently overwriting other competitors' rows | `scripts/throughput-benchmark.test.mjs` (scorecard-row contract pins the merge shape) |

**Blast radius**: a benchmark misfire affects only `competitive-scorecard.json` and the operator's terminal. No host repo is mutated in dry-run mode, and `--live` inherits the runner's existing push, force-push, and branch-delete safety invariants.
