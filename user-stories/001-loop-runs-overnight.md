# Story 001 — Loop runs overnight without intervention

**Milestone(s)**: M1.1, M1.2, M1.4, M1.5

> Minsky works through the night on your code while you sleep, and hands you a drained to-do list and real commits in the morning.

Minsky is a background program that does coding work for you while you are away. It reads a plain-text to-do list, picks the most important unfinished item, asks a coding assistant to do it, and prepares a draft for you to review. This story describes that loop running unattended overnight.

This story is **Minsky working on itself**. A supervisor — the outer watchdog that keeps Minsky running and restarts it if it dies — starts the loop and keeps it alive. The supervisor is `systemd` on Linux (`distribution/systemd/minsky-tick-loop.service`) and `launchd` on macOS (`distribution/launchd/com.minsky.tick-loop.plist`). The loop reads `TASKS.md` (the plain-text Markdown to-do list at the project root), picks the next unblocked task, and ships work against this repo.

The cross-repo counterpart is [`user-stories/006-runner-on-any-repo.md`](006-runner-on-any-repo.md): the *same* supervisor, parameterised by `MINSKY_HOST_ROOT`, runs against any host repo (a code project Minsky works on) via `minsky bootstrap` + `minsky run`. Both stories describe one loop on two substrates. vision.md § "What Minsky is" frames this dual-purpose surface as the original Minsky vision.

Both stories are gated by **rule #12** (scope discipline, vision.md § "Scope discipline"). When the to-do list empties, the next move is stability work — not new functionality — unless the work is human-approved, market-research-only, or pre-registered as a rule-#9 experiment.

## Story

As a solo developer, I close my laptop at 11pm with the loop running. I sleep through the night. When I open the laptop at 7am, my `TASKS.md` is drained of P1-or-higher tasks and my git log holds meaningful commits. I never had to wake up to handle anything.

## Acceptance criteria

- The loop runs continuously for ≥8 hours without human input.
- Tasks of priority P1 or higher are processed in priority order.
- Failures do not halt the system. They are logged, and the loop continues.
- The token budget is respected — no rate-limit errors logged. (Token budget = the cap on how much paid model quota the loop may spend.)
- Mid-task interruption (for example, laptop sleep then wake) is recovered automatically.
- A morning notification summarizes the work done.

## Metric

- **Name**: `overnight_uptime_pct`
- **Definition**: Percentage of any 8-hour overnight window where the supervisor reports the loop in `active (running)` state, excluding intentional pause windows.
- **Threshold**: ≥99% over the trailing 30 days.
- **Source**: The `Observability` adapter (a small wrapper that lets Minsky read state through a fixed interface) querying the systemd active-state every 60s.

## Integration test

- **File**: `tests/iter-once.bats` + `tests/minsky-run.bats`. These cover the bash skeleton's overnight loop, which is the canonical implementation after the phase-11b deletion of `novel/tick-loop/`. The previous `user-stories/001-loop-runs-overnight.test.ts` drove the TypeScript daemon's `runDaemon` orchestrator. It was deleted in phase-11b step 3 when the TypeScript daemon's deletion began — the test imported `runDaemon`, `DryRunSpawnStrategy`, `TestFakeMockAnthropic`, `BudgetGuardLike`, `BudgetDecisionLike`, and `SpanRecorder`, all surfaces that exist only in the deletion-target package.
- **Setup**:
  - Seed `TASKS.md` with 20 trivial P2 tasks (deterministic outcomes).
  - Pin OMC to v4.13.x.
  - Mock the token monitor to report unconstrained budget. A separate test covers budget exhaustion.
- **Action**: Run the supervisor for 60 minutes — a compressed simulation of overnight. The bash skeleton's launchd `KeepAlive=true` provides the same overnight-survival behavior the TypeScript daemon's in-process loop did.
- **Assert**:
  - Supervisor reports healthy throughout (no gap longer than 30s).
  - At least 15 tasks completed (allowing for overhead).
  - Zero rate-limit errors in the OpenTelemetry (OTEL) stream — the open standard Minsky emits for traces, metrics, and logs.
  - Zero unrecovered crashes (recovered crashes are acceptable but must be logged).
  - Final `TASKS.md` has fewer P2-or-higher tasks than at the start.

## Proof

- **Live**: The Watch surface shows green status for the tokens-remaining metric throughout the window.
- **Dashboard**: The web dashboard's "Uptime / 30d" tile reads ≥99%.
- **Audit**: `git log --since="8 hours ago"` shows commits authored by the agent identity.
- **Notification**: A single morning ntfy push summarizes tasks closed and tokens consumed.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: At least 1 task is closed per scheduler iteration (one wake-up of the loop on its timer, here ~5 min — the control-loop period), and `systemctl --user is-active minsky-tick-loop` reports `active` with no gap longer than 30s, sustained over the 8h window.
- **Blast radius**: a single iteration / one task. Never the whole loop, and never another user-story's flow.
- **Operator escape hatch**: tap the "pause" Shortcut (story 002). On-machine fallback: `touch state/PAUSED` (the same flag the supervisor honors within one scheduler iteration).

The "Expected behavior" column names a verdict — a fixed label for how the loop must respond:

- `loud-crash-supervisor-restart` — crash loudly and let the supervisor restart, rather than retry silently (the let-it-crash stance, Armstrong 2007).
- `circuit-break-and-notify` — stop trying, send one notification, resume on recovery.
- `graceful-degrade` — keep going at reduced capability.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | tick-loop process killed mid-tool-call | `kill -9 $(pgrep -f minsky-tick-loop)` (process death) | `loud-crash-supervisor-restart` | Kill mid-iteration; assert `Restart=on-failure` respawns within MTTR < 5min and the lease is released so a re-claim happens. |
| 2 | OMC subagent hangs forever | `libfaketime` advances clock past per-step timeout (clock) | `loud-crash-supervisor-restart` | Wrap subagent with `timeout(1)`-style watchdog; assert reap + restart, no zombie. |
| 3 | Persona returns malformed handoff JSON | Inject a fixture handoff with missing required fields (upstream-malformed) | `circuit-break-and-notify` | Run with a malformed-handoff fixture; assert handoff-spec validator rejects, single notification, no infinite parse loop. (A persona is a role the agent takes on — researcher, planner, implementer, QA.) |
| 4 | `tasks-mcp` server dies between claim and complete | `kill -9 $(pgrep -f tasks-mcp)` (process death) | `loud-crash-supervisor-restart` | Kill `tasks-mcp` mid-claim; assert lease expires within configured TTL; another agent / re-spawn re-claims the same task without duplication. |
| 5 | Network partition to `api.anthropic.com` | `iptables -A OUTPUT -d api.anthropic.com -j DROP` for 60s (network) | `circuit-break-and-notify` | Apply DROP for 60s; assert no 429 in OTEL stream, single notification, automatic resume on probe success. |
| 6 | Slow API response (200ms → 60s) | `tc qdisc add dev eth0 root netem delay 60s` (network latency) | `graceful-degrade` | Apply 60s netem delay; assert switch to Haiku per the 70% rule, OTEL span tagged `degraded=true`, no iteration wedged. |
| 7 | Disk fills (logs / traces) | `dd if=/dev/zero of=/tmp/fill bs=1M count=$(($(df -m /tmp \| awk 'NR==2 {print $4}')-1))` (disk-full) | `loud-crash-supervisor-restart` | Fill disk; assert log rotation kicks in or process exits cleanly, supervisor restarts, no silent log corruption. |
| 8 | OS sleep / wake mid-iteration (laptop closed) | `pmset sleepnow` on macOS / `systemctl suspend` on Linux (clock + process pause) | `graceful-degrade` | Suspend and resume; assert in-flight iteration recovers via lease check, no double-execution, OTEL span shows resume gap. |
| 9 | Token budget exhausted mid-iteration | Mock `TokenMonitor.remaining()` to return 0 (dependency upstream-error) | `circuit-break-and-notify` | Stub TokenMonitor at 0; assert pause new claims, in-flight finishes, single ntfy at level=warn. |
| 10 | Concurrent claim race (two agents pick same task) | Spawn two simulated agents claiming simultaneously (lease contention) | `graceful-degrade` | Two parallel `pick_task` calls; assert at most one wins via tasks-mcp's lease semantics, the loser picks the next task. |
| 11 | OTEL collector unreachable | `iptables -A OUTPUT -p tcp --dport 4317 -j DROP` (network) | `graceful-degrade` | Drop port 4317; assert spans are buffered then dropped per exporter policy, no iteration blocks waiting for telemetry. |
| 12 | Clock skew (NTP-less laptop) | `libfaketime "+30m"` before launching tick-loop (clock) | `graceful-degrade` | Skew clock +30 min; assert no premature 5h-window reset, no negative-elapsed claim, supervisor logs the skew. |

Weekly production fault injection: `supervisor-setup` (P1) wires a low-stakes Sunday timer that picks one row at random and runs its chaos test against the live loop. Failures escalate to a Watch-level notification.

### Coverage manifest

The 12 failure-mode rows above are mapped to their existing tests (or the deferred self-hosted path) by `user-stories/001-coverage-manifest.test.ts`. The manifest is the load-bearing decomposition of the original `first-integration-test` task — sub-task 1/3. It asserts that ≥80% of rows are either `covered` (an existing test in the repo) or `self-hosted` (deferred to the nightly self-hosted runner declared in sub-task 3). See `TASKS.md` `**ID**: first-integration-test-coverage-manifest`.

## Status

- **Phase**: Implemented. The integration test `user-stories/001-loop-runs-overnight.test.ts` drives the real `runDaemon` orchestrator (post-`tick-loop-daemon-real-spawn-flip`) against a synthetic TASKS.md fixture, with `DryRunSpawnStrategy` injected — the same Strategy the production CLI selects when `MINSKY_TICK_DRY_RUN=1`. It asserts a 4-task drain, ≥1 OTEL `tick-loop.iteration` span per task, exactly 1 morning summary push, and wall-clock <5 min. The chaos-coverage manifest (`user-stories/001-coverage-manifest.test.ts`) keeps row classifications: rows whose failure axis is OS-level (process death, network partition, disk-full, NTP, OS-suspend) stay `self-hosted` because they cannot run inside vitest; rows whose failure axis is in-process (handoff-malformed, budget-guard, 5xx upstream) stay `covered` against their existing in-process tests. The integration test itself does not change the manifest — it is the real-daemon driver the parent task brief calls for, exercising the same `runDaemon` orchestrator the supervisor invokes in production.
- **Blocking**: none (the test landed). The OS-level rows depend on `first-integration-test-nightly-self-hosted` (sub-task 3/3 of `first-integration-test`).
- **Theoretical anchor**: Armstrong supervision tree pattern (let-it-crash + supervisor restart).

## Pattern conformance

- **Pattern**: OTP supervision behaviour (one-for-one supervisor / let-it-crash) — Armstrong, *Programming Erlang*, 2007 — composed with periodic-task scheduling — Liu & Layland, "Scheduling Algorithms for Multiprogramming in a Hard Real-Time Environment", *JACM* 1973.
- **Conformance level**: partial.
- **Index row**: vision.md § "Pattern conformance index" row 41.
- **Notes**: The supervisor primitive is systemd / launchd (POSIX), not BEAM — the same deviation already declared at row 4. Iteration cadence is minutes-to-hours, so respawn latency (~100 ms vs Erlang's microseconds) is invisible at the user-story's success threshold (`overnight_uptime_pct` ≥ 99%).

## Security & privacy

This section ties the story to rule #13 ("Security & privacy — second priority after performance"; operator directive 2026-05-06). Use industry-standard primitives only; rule #1 (don't reinvent) applies.

- **Trust boundary**: This story's untrusted inputs are the operator's TASKS.md content and `claude --print` stdout (LLM output, treated as untrusted by default per OWASP LLM02). Trusted: the local filesystem and the launchd unit-file's environment. Anything that crosses the boundary (PR body emission, OTEL span content) passes through the secret-leak scanner (`scripts/scan-secrets.mjs`) and the no-PII span lint.
- **Secrets**: No API keys, tokens, or `.env` content in PR bodies, OTEL spans, or `.minsky/` logs. Floor: `scan-secrets` pre-commit + `secret-scanning-precommit-and-ci` (TASKS.md P0).
- **PII**: No email, IP, or full-paths-with-username in OTEL span attributes. Floor: `otel-no-pii-in-spans-lint` (TASKS.md P0).
- **Sandbox**: The supervisor process's filesystem and network reach is restricted to what this story actually needs. Floor: `supervisor-sandbox-syscall-restriction` (TASKS.md P0); industry standard via systemd `ProtectSystem=strict` + `PrivateTmp=true` / launchd App Sandbox.
- **Performance carve-out**: When a security restriction would cost >10% on this story's load-bearing latency metric, the trade-off is documented in this section as a declared deviation with a numeric cost figure. Silent trade-offs are forbidden (rule #13's "performance-first carve-out" clause).
