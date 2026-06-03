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

## Cost per task & speed — *(obs-cost-and-latency-per-task)*

—

## Result quality — *(obs-result-quality-score)*

—

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

**To turn on hosted Sentry** (the chosen default): create a project, then
`pnpm add -w @sentry/node` and export `SENTRY_DSN=<dsn>` for the daemon. With no
DSN the file strategy is used — no setup required.

## Minsky vs competitors — *(obs-live-competitive-self-column)*

—

## The dashboard & browser verification — *(obs-browser-verified-run-dashboard)*

—
