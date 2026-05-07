# Story 004 — Token budget auto-pauses before cliff

## Story

It's Wednesday afternoon. I've been heavy on Claude.ai today (long planning conversations). The shared bucket is dwindling. By 3pm, the loop's `claude-budget-guard` notices we're at 85% of the 5-hour window and approaching the weekly cap. It pauses new tick claims, lets in-flight tasks finish, and fires a notification: "Budget guard tripped, resuming at 5:42pm." At 5:42pm, the loop resumes automatically. I never hit a hard 429 from the API.

## Acceptance criteria

- `claude-budget-guard` reads `TokenMonitor` adapter every 60 seconds
- At 70% of 5-hour window: switch low-effort personas to Haiku
- At 85% of 5-hour window: pause new tick claims (in-flight finish)
- At weekly cap warning threshold: extend sleep cycles
- After window resets: auto-resume
- Zero hard 429 rate-limit errors per week sustained over 30 days
- All thresholds configurable via `config/budget-guard.json`

## Metric

- **Name**: `rate_limit_errors_per_week`
- **Definition**: Count of HTTP 429 responses observed by the orchestrator from Claude API in a calendar week
- **Threshold**: 0 per week, sustained over the trailing 30 days
- **Source**: `Observability` adapter — OTEL counter on the `claude_code.api` span error attribute

## Integration test

- **File**: `user-stories/004-budget-auto-pause.test.ts` (forthcoming)
- **Setup**:
  - Mock `TokenMonitor` to return a programmable burn-rate curve
  - Loop running with steady task arrival
- **Scenarios**:
  1. **Steady burn under threshold**: never pauses, no model switching
  2. **Burn crosses 70%**: low-effort personas switch to Haiku within one tick
  3. **Burn crosses 85%**: new tick claims pause within one poll interval; in-flight tick completes; flag file `state/PAUSED-budget` written
  4. **Window resets**: pause flag cleared; loop resumes within one poll interval
- **Assert**: Each scenario hits its expected state; zero 429s simulated

## Proof

- **Live**: Watch surface tokens-remaining color changes (green → yellow at 70%, red at 85%)
- **Dashboard**: Burn-rate chart shows actual vs. budget; threshold lines visible
- **Notification**: ntfy push on each threshold crossing and on auto-resume
- **Audit**: 30 days of OTEL data shows zero 429s while loop was running

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: zero HTTP 429 from `api.anthropic.com` per calendar week, sustained over 30 days, while `claude-budget-guard` is the only path that stops new claims.
- **Blast radius**: a single 5h window. Never affects already-finished tasks, session histories, or the loop's restart policy.
- **Operator escape hatch**: `claude-budget-guard --override-pause` from CLI — logged with reason and timestamp; visible on the dashboard.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | TokenMonitor cache file disappears (Maciek crashes / fs cleanup) | `rm -f ~/.claude-monitor/cache.json` (dependency upstream-error) | `loud-crash-supervisor-restart` of token-monitor; budget-guard waits | Delete the cache; assert budget-guard reports `unknown` then recovers when monitor restarts; never silently assumes "remaining = 100%". |
| 2 | TokenMonitor reports decreasing then jumps backward (clock skew or window-reset edge) | `libfaketime` past window-reset boundary (clock) | `graceful-degrade` | Skew across the boundary; assert no false-resume during pause, no negative-elapsed accounting. |
| 3 | Network drop to Anthropic API during pause (no `usage` poll) | `iptables -A OUTPUT -d api.anthropic.com -j DROP` (network) | `graceful-degrade` | Drop the route during pause; assert pause held until network returns + observed-remaining stable for ≥60s — never resume on stale data. |
| 4 | Two budget-guard processes accidentally run simultaneously | Start a second instance manually (concurrency violation) | `loud-crash-supervisor-restart` | Spawn duplicate; assert systemd's `RestartLimitIntervalSec` + flock on the flag file prevents both from writing concurrently; supervisor terminates the duplicate. |
| 5 | Pause flag exists but budget recovers (5h window resets cleanly) | Mock window-reset event from TokenMonitor (upstream signal) | `graceful-degrade` | Trigger reset; assert budget-guard removes the flag within the poll interval; OTEL counter `budget_guard.auto_resume` increments. |
| 6 | Threshold config file corrupted (invalid JSON) | Truncate / scramble `config/budget-guard.json` (upstream-malformed) | `loud-crash-supervisor-restart` | Corrupt the config; assert process exits with non-zero on startup; supervisor's restart-loop hits `RestartLimitInterval` and a level=critical notification fires. |
| 7 | `claude.ai` user spike consumes weekly cap independently | Simulate weekly-cap-warning event from TokenMonitor (upstream signal) | `circuit-break-and-notify` | Inject the event; assert long sleep cycles + a single notification at level=warn; no rapid retry-loop. |

## Status

- **Phase**: Specification
- **Blocking**: P1 `budget-guard-v0`; depends on `Observability` adapter
- **Theoretical anchor**: Google SRE error budgets (token-budget = error-budget); Maturana & Varela autopoiesis (homeostasis — the organism throttles its own metabolism to stay alive)
- **Risk**: Threshold values may need tuning based on observed reality; the first month should be conservative.

## Pattern conformance

- **Pattern**: Error-budget burn-rate alerting + graceful degradation — Beyer, Jones, Petoff, Murphy (eds.), *Site Reliability Engineering*, O'Reilly, 2016, Ch. 3 (error budgets) and Ch. 24 (overload / load-shedding)
- **Conformance level**: full
- **Index row**: vision.md § "Pattern conformance index" row 44
- **Notes**: The 70 % / 85 % / weekly-cap thresholds map directly to SRE burn-rate ladder; the model-downgrade (Sonnet to Haiku) is the load-shedding response. Cross-references the implementation at rows 10 and 26 (`@minsky/budget-guard` watchdog and `decide()` decision function); this row anchors the user-story specification.

## Security & privacy

Per constitutional rule #13 (vision.md § 13 — Security & privacy, second priority after performance).

- **Threat surface**: the BudgetGuard HTTP server exposes `/budget.json` and `/budget.flag` over the local network. A spoofed high-budget reading could prevent the supervisor from pausing when it should (Denial of Service via false signal).
- **Localhost-only binding**: the BudgetGuard HTTP server binds to `127.0.0.1` by default (companion to `dashboard-localhost-only-by-default`). Budget readings that arrive over anything other than the loopback interface are rejected.
- **No credentials in budget spans**: the budget decision spans carry only the decision label (`NORMAL` / `WARN` / `PAUSE`) and the remaining-budget percentage — never the API key or account identifier used to derive the reading (`otel-no-pii-in-spans-lint`).
- **Threat model**: see `novel/budget-guard/README.md` § Threat model (STRIDE-shaped, ≥5 lines; ships with slice 7 of `security-privacy-priority-substrate`).
