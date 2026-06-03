# Story 005 — Watch shows three numbers, never four

**Milestone(s)**: M1.7

## Story

As the operator — the person who runs Minsky, the background program that
works on your code while you are away — I raise my wrist and check my Apple
Watch. I see three things, and only three things:

1. Tokens remaining, color-coded.
2. The status of the last task Minsky worked on.
3. This week's single biggest constraint.

In two seconds I know whether Minsky is alive and on track. Then I lower my
wrist. If I want more detail I open my iPhone or laptop. I almost never do,
because the three numbers already answer the question.

## Acceptance criteria

- The Watch glance widget shows exactly three values.
- Tokens-remaining: a numeric percentage with color (green > 50%, yellow
  > 20%, red ≤ 20%).
- Last-task-status: a ✓ / ✗ / ⏳ glyph plus the task title (truncated to
  ~25 characters).
- This-week's constraint: one short label (≤ 2 words).
- The widget refreshes within 60 seconds of an underlying state change.
- No notifications fire for routine state. Notifications fire only for events
  at or above the threshold the operator sets.

## Metric

- **Name**: `wrist_dwell_seconds_per_day`
- **Definition**: Total seconds per day the Apple Watch glance widget is in
  the foreground (proxied via Shortcut invocation count × estimated dwell).
- **Threshold**: ≤ 60 seconds/day (inverted — less is better).
- **Source**: the `Observability` adapter (a small wrapper that lets Minsky
  talk to one outside tool through a fixed interface) — it counts how often
  the Shortcut's HTTP fetch hits the local web app.
- **Rationale**: if the operator spends more than one minute per day on the
  Watch, the surface is showing too much or the system is too unhealthy.
  Either is a problem.

## Integration test

- **File**: `user-stories/005-watch-three-numbers.test.ts` (forthcoming).
- **Setup**:
  - Mock the Apple Shortcut as a curl request to the local web app.
  - Stub backend state covering all permutations of the three values.
- **Action**: Hit the Watch endpoint 10 times across varying states.
- **Assert**:
  - The response payload has exactly 3 fields.
  - Color codes match the threshold rules.
  - Glyph mapping is correct.
  - The constraint label is ≤ 2 words.
  - A state change propagates to the widget within 60 seconds.
  - Adding a 4th field to the response is rejected by a CI lint rule (a
    deliberate constraint).

## Proof

- **Live**: Raise wrist; verify the three values appear within 1 second of
  the glance.
- **Dashboard**: The web dashboard's "Watch payload" view shows the current
  Watch JSON.
- **Behavioral**: The daily wrist-dwell metric reads ≤ 60s, sustained over a
  week.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7) — the numbered, non-negotiable
project rule covering failure-mode verification.

- **Steady-state hypothesis**: the Watch payload endpoint returns HTTP 200
  with exactly 3 fields and refreshes within 60s of the underlying state
  change, sustained.
- **Blast radius**: a single Shortcut request, or a single Watch glance. It
  never affects the loop's tick cadence (one wake-up of the loop on its
  timer), the supervisor (the outer watchdog that restarts Minsky if it
  dies), or any task already claimed.
- **Operator escape hatch**: a "fallback" Shortcut that pings `ntfy.sh`
  directly with the latest cached payload. It bypasses the local web app
  entirely, so the operator can still see the three numbers if the dashboard
  is down.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Local web app down | `kill -9 $(pgrep -f minsky-dashboard-web)` (process death) | `circuit-break-and-notify` | Kill the web app; assert Shortcut returns the last-known-good cached payload + a `stale=true` flag, ntfy notification fires once. |
| 2 | Tailscale routing degraded (high latency) | `tc qdisc add dev tailscale0 root netem delay 30s` (network latency) | `graceful-degrade` | Apply 30s delay; assert Shortcut times out at 5s with cached fallback, no spinning Watch UI. |
| 3 | State backend stale (>60s old data) | Block dashboard data refresh path (dependency upstream-error) | `graceful-degrade` | Freeze the data refresh; assert `stale=true` flag set on Watch payload, three values still rendered with last known good. |
| 4 | A 4th field is accidentally added to the payload | Code change adds a new key (upstream-malformed schema) | `loud-crash-supervisor-restart` of the response handler | Add a 4th key in a fixture; assert payload-shape test in CI fails (compile-time gate). If it ships, runtime validator throws and the response handler restarts; never serve a 4-field payload. |
| 5 | Cached fallback has been stale for >2h | Set cache mtime to `now - 3h` (clock + cache decay) | `circuit-break-and-notify` | Backdate the cache; assert Shortcut still returns 200 (with `stale=true` and age) and a notification fires recommending the user check the laptop. |
| 6 | Concurrent Shortcut requests (rapid wrist-raises) | Fire 10 requests in 1s (request flood) | `graceful-degrade` | Fire the burst; assert single shared backend fetch (debounced), no thundering herd hitting the data backend. |

## Status

- **Phase**: Specification
- **Blocking**: P2 `watch-shortcuts`; depends on the web app.
- **Theoretical anchors**: Brendan Gregg USE / Tom Wilkie RED methodology (a
  small fixed set of vital signs); Beer's VSM (the wrist is System 5's
  read-out — Identity, the slowest-changing surface).
- **Design discipline**: a 4th number is forbidden by lint. If a new metric
  matters that much, one of the three must be replaced — not added. This is
  principled UX scarcity.

## Pattern conformance

- **Pattern**: Glanceable / ambient information display — Card, Mackinlay,
  Shneiderman, *Readings in Information Visualization*, Morgan Kaufmann, 1999,
  Ch. 1 — combined with Calm Technology — Weiser & Brown, "Designing Calm
  Technology", *PowerGrid Journal* 1995 (also Weiser, "The Computer for the
  21st Century", *Scientific American* 265(3) 1991).
- **Conformance level**: full.
- **Index row**: vision.md § "Pattern conformance index" row 45.
- **Notes**: Three values, no chrome; the surface stays at the periphery of
  attention until needed. The inverted dwell metric
  (`wrist_dwell_seconds_per_day` ≤ 60 s) operationalises the calm-tech
  invariant: more attention to the read-out is a sign the surface or the
  system is failing. Cross-references row 12 (the Watch surface as the
  implementation locus); this row anchors the user-story specification.

## Security & privacy

(Operator directive 2026-05-06 — vision.md rule #13 "Security & privacy —
second priority after performance".) Industry-standard primitives only;
rule #1 (don't reinvent) applies.

- **Trust boundary**: this story's untrusted inputs are the operator's
  TASKS.md content + claude --print stdout (LLM output, treated as untrusted
  by default per OWASP LLM02). Trusted: the local filesystem + the launchd
  unit-file's environment. Anything that crosses the boundary (PR body
  emission, OTEL span content) passes through the secret-leak scanner
  (`scripts/scan-secrets.mjs`) and the no-PII span lint.
- **Secrets**: no API keys, tokens, or `.env` content in PR bodies, OTEL
  spans, or `.minsky/` logs. Floor: `scan-secrets` pre-commit +
  `secret-scanning-precommit-and-ci` (TASKS.md P0).
- **PII**: no email/IP/full-paths-with-username in OTEL span attributes.
  Floor: `otel-no-pii-in-spans-lint` (TASKS.md P0).
- **Sandbox**: the supervisor process's filesystem + network reach is
  restricted to what this story actually needs. Floor:
  `supervisor-sandbox-syscall-restriction` (TASKS.md P0); industry standard
  via systemd `ProtectSystem=strict` + `PrivateTmp=true` / launchd App
  Sandbox.
- **Performance carve-out**: when a security restriction would cost >10% on
  this story's load-bearing latency metric, the trade-off is documented in
  this section as a declared deviation with a numeric cost figure. Silent
  trade-offs are forbidden (vision.md rule #13's "performance-first carve-out"
  clause).
