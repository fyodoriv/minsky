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

## Status

- **Phase**: Specification
- **Blocking**: P1 `budget-guard-v0`; depends on `Observability` adapter
- **Theoretical anchor**: Google SRE error budgets (token-budget = error-budget); Maturana & Varela autopoiesis (homeostasis — the organism throttles its own metabolism to stay alive)
- **Risk**: Threshold values may need tuning based on observed reality; the first month should be conservative.
