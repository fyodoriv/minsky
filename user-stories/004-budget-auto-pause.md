# Story 004 — Token budget auto-pauses before the cliff

**Milestone(s)**: budget-guard-v0

## Story

You run Minsky — a background program that picks up to-do tasks from your code
projects and works on them on its own. Minsky drives a coding assistant (the
agent) such as Claude Code to do the actual work. That agent uses your paid
quota.

It's Wednesday afternoon. You have been heavy on Claude.ai today with long
planning conversations, so the shared quota is running low. By 3pm, Minsky's
budget guard — a small watchdog called `claude-budget-guard` — sees you are at
85% of the rolling 5-hour quota window and closing on the weekly cap.

The guard stops claiming new work, lets any work already in flight finish, and
sends you a notification: "Budget guard tripped, resuming at 5:42pm." At 5:42pm
the quota window resets and Minsky resumes on its own. You never hit a hard
HTTP 429 rate-limit error from the API.

## Acceptance criteria

- `claude-budget-guard` reads the `TokenMonitor` adapter (the wrapper that
  reports how much quota is left) every 60 seconds.
- At 70% of the 5-hour window: switch low-effort personas to Haiku. A persona
  is a role the agent takes on; low-effort roles can use a cheaper model.
- At 85% of the 5-hour window: stop claiming new work; let in-flight work
  finish.
- At the weekly-cap warning threshold: extend the sleep between wake-ups.
- After the window resets: resume on its own.
- Zero hard HTTP 429 rate-limit errors per week, sustained over 30 days.
- All thresholds configurable via `config/budget-guard.json`.

## Metric

- **Name**: `rate_limit_errors_per_week`
- **Definition**: Count of HTTP 429 responses the orchestrator observes from the
  Claude API in a calendar week.
- **Threshold**: 0 per week, sustained over the trailing 30 days.
- **Source**: `Observability` adapter — OpenTelemetry (OTEL) counter on the
  `claude_code.api` span error attribute.

## Integration test

- **File**: `user-stories/004-budget-auto-pause.test.ts` (forthcoming)
- **Setup**:
  - Mock `TokenMonitor` to return a programmable burn-rate curve.
  - Run the loop with steady task arrival.
- **Scenarios**:
  1. **Steady burn under threshold**: never pauses, no model switching.
  2. **Burn crosses 70%**: low-effort personas switch to Haiku within one
     iteration.
  3. **Burn crosses 85%**: new task claims pause within one poll interval; the
     in-flight iteration completes; the flag file `state/PAUSED-budget` is
     written.
  4. **Window resets**: the pause flag is cleared; the loop resumes within one
     poll interval.
- **Assert**: Each scenario reaches its expected state; zero 429s simulated.

## Proof

- **Live**: The status surface shows tokens-remaining changing color
  (green to yellow at 70%, red at 85%).
- **Dashboard**: A burn-rate chart shows actual vs. budget, with the threshold
  lines visible.
- **Notification**: A push fires on each threshold crossing and on auto-resume.
- **Audit**: 30 days of OTEL data shows zero 429s while the loop was running.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: zero HTTP 429 from `api.anthropic.com` per
  calendar week, sustained over 30 days, while `claude-budget-guard` is the only
  path that stops new claims.
- **Blast radius**: a single 5-hour window. Never affects already-finished
  tasks, session histories, or the loop's restart policy.
- **Operator escape hatch**: `claude-budget-guard --override-pause` from the CLI
  — logged with a reason and a timestamp; visible on the dashboard.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | TokenMonitor cache file disappears (Maciek crashes / fs cleanup) | `rm -f ~/.claude-monitor/cache.json` (dependency upstream-error) | `loud-crash-supervisor-restart` of token-monitor; budget-guard waits | Delete the cache; assert budget-guard reports `unknown` then recovers when the monitor restarts; never silently assumes "remaining = 100%". |
| 2 | TokenMonitor reports decreasing then jumps backward (clock skew or window-reset edge) | `libfaketime` past window-reset boundary (clock) | `graceful-degrade` | Skew across the boundary; assert no false-resume during pause, no negative-elapsed accounting. |
| 3 | Network drop to Anthropic API during pause (no `usage` poll) | `iptables -A OUTPUT -d api.anthropic.com -j DROP` (network) | `graceful-degrade` | Drop the route during pause; assert the pause holds until the network returns and observed-remaining is stable for ≥60s — never resume on stale data. |
| 4 | Two budget-guard processes accidentally run at once | Start a second instance manually (concurrency violation) | `loud-crash-supervisor-restart` | Spawn a duplicate; assert systemd's `RestartLimitIntervalSec` + flock on the flag file stops both from writing at once; the supervisor terminates the duplicate. |
| 5 | Pause flag exists but budget recovers (5h window resets cleanly) | Mock a window-reset event from TokenMonitor (upstream signal) | `graceful-degrade` | Trigger the reset; assert budget-guard removes the flag within the poll interval; the OTEL counter `budget_guard.auto_resume` increments. |
| 6 | Threshold config file corrupted (invalid JSON) | Truncate / scramble `config/budget-guard.json` (upstream-malformed) | `loud-crash-supervisor-restart` | Corrupt the config; assert the process exits non-zero on startup; the supervisor's restart-loop hits `RestartLimitInterval` and a level=critical notification fires. |
| 7 | `claude.ai` user spike consumes the weekly cap independently | Simulate a weekly-cap-warning event from TokenMonitor (upstream signal) | `circuit-break-and-notify` | Inject the event; assert long sleep cycles plus a single notification at level=warn; no rapid retry-loop. |

## Status

- **Phase**: Specification
- **Blocking**: P1 `budget-guard-v0`; depends on the `Observability` adapter.
- **Theoretical anchor**: Google SRE error budgets (token-budget = error-budget);
  Maturana & Varela autopoiesis (homeostasis — the organism throttles its own
  metabolism to stay alive).
- **Risk**: Threshold values may need tuning against observed reality; the first
  month should be conservative.

## Pattern conformance

- **Pattern**: Error-budget burn-rate alerting + graceful degradation — Beyer,
  Jones, Petoff, Murphy (eds.), *Site Reliability Engineering*, O'Reilly, 2016,
  Ch. 3 (error budgets) and Ch. 24 (overload / load-shedding).
- **Conformance level**: full
- **Index row**: vision.md § "Pattern conformance index" row 44
- **Notes**: The 70% / 85% / weekly-cap thresholds map directly onto the SRE
  burn-rate ladder; the model-downgrade (Sonnet to Haiku) is the load-shedding
  response. Cross-references the implementation at rows 10 and 26
  (`@minsky/budget-guard` watchdog and `decide()` decision function); this row
  anchors the user-story specification.

## Security & privacy

(Operator directive 2026-05-06 — vision.md rule #13 "Security & privacy — second
priority after performance".) Industry-standard primitives only; rule #1 (don't
reinvent) applies.

- **Trust boundary**: this story's untrusted inputs are the operator's TASKS.md
  content + `claude --print` stdout (LLM output, treated as untrusted by default
  per OWASP LLM02). Trusted: the local filesystem + the launchd unit-file's
  environment. Anything that crosses the boundary (PR body emission, OTEL span
  content) passes through the secret-leak scanner (`scripts/scan-secrets.mjs`)
  and the no-PII span lint.
- **Secrets**: no API keys, tokens, or `.env` content in PR bodies, OTEL spans,
  or `.minsky/` logs. Floor: `scan-secrets` pre-commit +
  `secret-scanning-precommit-and-ci` (TASKS.md P0).
- **PII**: no email, IP, or full-paths-with-username in OTEL span attributes.
  Floor: `otel-no-pii-in-spans-lint` (TASKS.md P0).
- **Sandbox**: the supervisor process's filesystem + network reach is restricted
  to what this story actually needs. Floor:
  `supervisor-sandbox-syscall-restriction` (TASKS.md P0); industry standard via
  systemd `ProtectSystem=strict` + `PrivateTmp=true` / launchd App Sandbox.
- **Performance carve-out**: when a security restriction would cost >10% on this
  story's load-bearing latency metric, the trade-off is documented in this
  section as a declared deviation with a numeric cost figure. Silent trade-offs
  are forbidden (vision.md rule #13's "performance-first carve-out" clause).
