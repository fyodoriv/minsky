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

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: ≥1 task closed per scheduler iteration (~5 min) and `systemctl --user is-active minsky-tick-loop` reports `active` with no >30s gap, sustained over the 8h window.
- **Blast radius**: a single tick / one task. Never the whole loop, never another user-story's flow.
- **Operator escape hatch**: tap the "pause" Shortcut (story 002). On-machine fallback: `touch state/PAUSED` (the same flag the supervisor honors within one scheduler iteration).

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | tick-loop process killed mid-tool-call | `kill -9 $(pgrep -f minsky-tick-loop)` (process death) | `loud-crash-supervisor-restart` | Kill mid-tick; assert `Restart=on-failure` respawns within MTTR < 5min and the lease is released so a re-claim happens. |
| 2 | OMC subagent hangs forever | `libfaketime` advances clock past per-step timeout (clock) | `loud-crash-supervisor-restart` | Wrap subagent with `timeout(1)`-style watchdog; assert reap + restart, no zombie. |
| 3 | Persona returns malformed handoff JSON | Inject a fixture handoff with missing required fields (upstream-malformed) | `circuit-break-and-notify` | Run with a malformed-handoff fixture; assert handoff-spec validator rejects, single notification, no infinite parse loop. |
| 4 | `tasks-mcp` server dies between claim and complete | `kill -9 $(pgrep -f tasks-mcp)` (process death) | `loud-crash-supervisor-restart` | Kill `tasks-mcp` mid-claim; assert lease expires within configured TTL; another agent / re-spawn re-claims the same task without duplication. |
| 5 | Network partition to `api.anthropic.com` | `iptables -A OUTPUT -d api.anthropic.com -j DROP` for 60s (network) | `circuit-break-and-notify` | Apply DROP for 60s; assert no 429 in OTEL stream, single notification, automatic resume on probe success. |
| 6 | Slow API response (200ms → 60s) | `tc qdisc add dev eth0 root netem delay 60s` (network latency) | `graceful-degrade` | Apply 60s netem delay; assert switch to Haiku per the 70% rule, OTEL span tagged `degraded=true`, no tick wedged. |
| 7 | Disk fills (logs / traces) | `dd if=/dev/zero of=/tmp/fill bs=1M count=$(($(df -m /tmp \| awk 'NR==2 {print $4}')-1))` (disk-full) | `loud-crash-supervisor-restart` | Fill disk; assert log rotation kicks in or process exits cleanly, supervisor restarts, no silent log corruption. |
| 8 | OS sleep / wake mid-tick (laptop closed) | `pmset sleepnow` on macOS / `systemctl suspend` on Linux (clock + process pause) | `graceful-degrade` | Suspend and resume; assert in-flight tick recovers via lease check, no double-execution, OTEL span shows resume gap. |
| 9 | Token budget exhausted mid-tick | Mock `TokenMonitor.remaining()` to return 0 (dependency upstream-error) | `circuit-break-and-notify` | Stub TokenMonitor at 0; assert pause new claims, in-flight finishes, single ntfy at level=warn. |
| 10 | Concurrent claim race (two agents pick same task) | Spawn two simulated agents claiming simultaneously (lease contention) | `graceful-degrade` | Two parallel `pick_task` calls; assert at most one wins via tasks-mcp's lease semantics, the loser picks the next task. |
| 11 | OTEL collector unreachable | `iptables -A OUTPUT -p tcp --dport 4317 -j DROP` (network) | `graceful-degrade` | Drop port 4317; assert spans are buffered then dropped per exporter policy, no tick blocks waiting for telemetry. |
| 12 | Clock skew (NTP-less laptop) | `libfaketime "+30m"` before launching tick-loop (clock) | `graceful-degrade` | Skew clock +30 min; assert no premature 5h-window reset, no negative-elapsed claim, supervisor logs the skew. |

Weekly production fault injection: `supervisor-setup` (P1) wires a low-stakes Sunday timer that picks one row at random and runs its chaos test against the live loop; failures escalate to a Watch-level notification.

## Status

- **Phase**: Specification (not yet implemented)
- **Blocking**: P1 tasks `supervisor-setup`, `budget-guard-v0` (see `TASKS.md`)
- **Theoretical anchor**: Armstrong supervision tree pattern (let-it-crash + supervisor restart)

## Pattern conformance

- **Pattern**: OTP supervision behaviour (one-for-one supervisor / let-it-crash) — Armstrong, *Programming Erlang*, 2007 — composed with periodic-task scheduling — Liu & Layland, "Scheduling Algorithms for Multiprogramming in a Hard Real-Time Environment", *JACM* 1973
- **Conformance level**: partial
- **Index row**: vision.md § "Pattern conformance index" row 41
- **Notes**: The supervisor primitive is systemd / launchd (POSIX), not BEAM — same deviation already declared at row 4. Tick cadence is minutes-to-hours, so respawn latency (~100 ms vs Erlang's microseconds) is invisible at the user-story's success threshold (`overnight_uptime_pct` ≥ 99 %).
