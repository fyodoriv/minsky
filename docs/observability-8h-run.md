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

## Full error list & external reporting — *(obs-error-capture-and-reporter)*

—

## Minsky vs competitors — *(obs-live-competitive-self-column)*

—

## The dashboard & browser verification — *(obs-browser-verified-run-dashboard)*

—
