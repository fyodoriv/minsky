# Story 001 — Loop runs overnight without intervention

## Story

As a solo developer, I close my laptop at 11pm with the loop running, sleep through the night, and find my `TASKS.md` drained of P1+ tasks and meaningful commits in my git log when I open the laptop at 7am. I never had to wake up to handle anything.

## Acceptance criteria

- The loop runs continuously for ≥8 hours without human input
- Tasks of priority P1 or higher are processed in priority order
- Failures don't halt the system; they're logged and the loop continues
- Token budget is respected — no rate-limit errors logged
- Mid-task interruption (e.g., laptop sleep/wake) is recovered automatically
- A morning notification summarizes work done

## Metric

- **Name**: `overnight_uptime_pct`
- **Definition**: Percentage of any 8-hour overnight window where the supervisor reports the tick-loop in `active (running)` state, excluding intentional pause windows
- **Threshold**: ≥99% over the trailing 30 days
- **Source**: `Observability` adapter querying systemd active-state every 60s

## Integration test

- **File**: `user-stories/001-loop-runs-overnight.test.ts` (forthcoming)
- **Setup**:
  - Seed `TASKS.md` with 20 trivial P2 tasks (deterministic outcomes)
  - Pin OMC to v4.13.x
  - Mock token monitor to report unconstrained budget (separate test covers budget exhaustion)
- **Action**: Run supervisor for 60 minutes (compressed simulation of overnight)
- **Assert**:
  - Supervisor reports healthy throughout (no >30s gaps)
  - At least 15 tasks completed (allowing for overhead)
  - Zero rate-limit errors in OTEL stream
  - Zero unrecovered crashes (recovered crashes acceptable, must be logged)
  - Final `TASKS.md` has fewer P2+ tasks than start

## Proof

- **Live**: Watch surface shows green status for tokens-remaining metric throughout the window
- **Dashboard**: Web dashboard's "Uptime / 30d" tile reads ≥99%
- **Audit**: `git log --since="8 hours ago"` shows commits authored by the agent identity
- **Notification**: Single morning ntfy push summarizing tasks closed and tokens consumed

## Status

- **Phase**: Specification (not yet implemented)
- **Blocking**: P1 tasks `supervisor-setup`, `budget-guard-v0` (see `TASKS.md`)
- **Theoretical anchor**: Armstrong supervision tree pattern (let-it-crash + supervisor restart)
