# Observability for an 8-hour self-run

> How to measure a `minsky`-on-itself run: uptime, throughput, cost per task,
> errors, speed, quality — and how Minsky compares to competitors. Every metric
> here is derived from data the daemon already writes, viewable with one
> command, and (where noted) verifiable in a browser.

This runbook is built up by the `obs-*` task suite in [TASKS.md](../TASKS.md).
Sections appear as each task lands; a `—` means "not implemented yet".

## Where a run's data lives

| Source | Written by | Contents |
|---|---|---|
| `.minsky/orchestrate.jsonl` | the conductor (`scripts/orchestrate.mjs`) | one heartbeat per tick: `ts`, `workerAlive`, `healed`, `merged[]`, `runId` |
| `.minsky/runany-restart-state.json` | the supervisor | `restartIndex`, `originMs`, `startMs` |
| `.minsky/experiment-store/cross-repo/<task>.jsonl` | the bash runner | per-iteration verdicts |
| `.minsky/failures/<ts>-<task>/` | `capture-failure.sh` | failure snapshots (ring-limited to 20) |
| `.minsky/runs/<run-id>/` | `scripts/run-summary.mjs` | **the consolidated per-run record** (below) |

Raw daemon stdout/stderr (`.minsky/tick-loop.{out,err}.log`) is intentionally
*not* inlined into the consolidated log — it has no per-line timestamp to
interleave faithfully. View it directly with `pnpm minsky:logs`.

## Run summary — uptime, restarts, throughput

`scripts/run-summary.mjs` reduces the structured ledgers into one
`.minsky/runs/<run-id>/run-summary.json` plus a timestamp-ordered
`.minsky/runs/<run-id>/run.log`.

```bash
# the latest run, human-readable
node scripts/run-summary.mjs

# machine-readable (used by the dashboard + competitive column)
node scripts/run-summary.mjs --run latest --json
node scripts/run-summary.mjs --run <run-id> --json
```

Fields today:

| Field | Meaning |
|---|---|
| `runId` | the supervised run this summary covers |
| `startedAt` / `endedAt` | first / last tick timestamp |
| `totalUptimeSec` | wall-clock from first to last tick |
| `longestUninterruptedSec` | longest span with no worker restart (heal event) |
| `restartCount` | worker restarts (heal events) during the run |
| `tasksMerged` | distinct PRs merged during the run |
| `tasksAttempted` | iterations attempted (populated once verdicts are wired) |

It graceful-degrades: a missing ledger yields `null` fields, never a crash.

Verify the math: `pnpm vitest run scripts/run-summary.test.mjs`.

## Cost per task & speed

`run-summary.json` carries two roll-ups (via `enrichSummary`):

- `meanMergeLatencySec` — throughput-derived: total run wall-clock ÷ merged PRs.
- `meanCostPerMergedPr` + `costAttribution: "amortized"` — total run token-cost
  ÷ merged PRs. Amortized on purpose (a Claude session spans several tasks, so
  per-task token attribution would be false precision — the task's Pivot). The
  daemon supplies total run cost via `MINSKY_RUN_TOKEN_COST_USD`; absent → cost
  stays `null` (never fabricated).

```bash
node scripts/run-summary.mjs --run latest --json | jq '{meanMergeLatencySec, meanCostPerMergedPr, costAttribution}'
```

## Result quality

`meanQuality` ∈ [0,1] averages, per merged PR, only the signal components that
are present: first-push CI green, tests-added, no same-day revert, and (when
available) the PR self-grade. No signals for any merged PR → `null` (honest,
not a fake zero). Supplied to `enrichSummary` as `qualityByPr` keyed by PR
number; the daemon populates it from `gh` + the diff during a run.

```bash
node scripts/run-summary.mjs --run latest --json | jq '.meanQuality'
```

## Full error list & external reporting

Every sweep error a tick hits is captured — full, untruncated, and classified
— to `.minsky/runs/<run-id>/errors.jsonl`, and (when configured) shipped to an
external platform. The capture is wired at the single ledger chokepoint
(`appendOrchestrateLedger` in `scripts/orchestrate.mjs`), fire-and-forget and
fully guarded so it can never gate the loop (rule #6).

```bash
# the full error list for a run, as a JSON array
node scripts/export-run-errors.mjs --run latest --json | jq

# self-test the reporter (file strategy round-trip)
node scripts/error-reporter-selftest.mjs        # exits 0 on success
```

The reporter is a swappable adapter (`scripts/lib/error-reporter.mjs`, rule #2):

| Strategy | When | Behavior |
|---|---|---|
| `FileErrorReporter` | default / no DSN | appends classified records to `errors.jsonl` |
| `SentryErrorReporter` | `SENTRY_DSN` set | ships to Sentry **and** keeps the local file; falls back to file if `@sentry/node` isn't installed — never throws |

Each record is `{ ts, runId, taskId, class, message, stack?, exitCode?, durationMs? }`,
secret-redacted. `class` ∈ spawn-failed / lint-failed / timeout / gate-failed /
crash / unknown.

**To turn on hosted Sentry** (the chosen default): `@sentry/node` ships as an
**optional dependency**, so no install step — just set `SENTRY_DSN` in the
daemon's environment. We keep the DSN in a gitignored `.env` at the repo root;
load it at run launch (`set -a; . ./.env; set +a`) or via `node --env-file=.env`.
With no DSN the file strategy is used — no setup required, no `@sentry/node`
fetch failure is fatal (it's optional + graceful-degrade).

## Minsky vs competitors

`scripts/benchmark-run.mjs` maps the run summary onto 5 ledger-derivable
competitive metrics — `deploy-frequency`, `daemon-stability-pct`,
`autonomous-merge-rate`, `mean-autonomous-merge-latency`, `cost-per-merged-pr`
— and emits `.minsky/competitive-scorecard.json`: Minsky's own column plus a
direction-aware delta vs every competitor in the corpus that publishes the same
metric.

```bash
node scripts/benchmark-run.mjs --run latest \
  | jq '{nonNull: .minsky.nonNullMetrics, competitors: [.competitors[].id]}'
```

Small-n guard (rule #4): count-sensitive readings (latency, cost) are `null`
until the run has merged ≥ 5 PRs — an honest "n too small", never a misleading
point estimate. The curated `competitors/scorecard.md` snapshot is left intact;
the live head-to-head lives in this JSON and (PR F) the dashboard. The corpus is
read from `@minsky/competitive-benchmark`'s built `dist` — competitors stay pure
data (rule #2).

## The dashboard & browser verification

`scripts/render-run-report.mjs` renders ONE self-contained `report.html` for a
run — 7 tiles: uptime, tasks merged, mean cost/PR, mean latency, error count,
mean quality, and the Minsky-vs-competitor table — from `run-summary.json`,
`.minsky/competitive-scorecard.json`, and the run's `errors.jsonl`. A static
file (openable as `file://`), not a live server: a stable artifact beats a
flaky SSR (rule #6/#7).

```bash
node scripts/render-run-report.mjs --run latest   # writes .minsky/runs/<id>/report.html
```

**Verify it in a browser** (the merge gate):

```bash
node scripts/verify-dashboard-browser.mjs          # exits 0 when all 7 tiles render
```

It renders a demo report, asserts all 7 `data-tile` elements are present
(deterministic structural gate), then drives `agent-browser --auto-connect` to
actually open the page and confirm every tile is non-empty. The browser step is
best-effort — on a headless box it warns and the structural gate still holds. To
eyeball it yourself:

```bash
agent-browser --auto-connect open "file://$(node scripts/render-run-report.mjs --run latest)"
agent-browser eval "JSON.stringify([...document.querySelectorAll('[data-tile]')].map(e=>e.getAttribute('data-tile')))"
```
