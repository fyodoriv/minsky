# Story 005 — Watch shows three numbers, never four

## Story

I raise my wrist. I see three things and only three things: tokens-remaining (color-coded), last-task-status, this-week's-constraint. In two seconds I know if the organism is alive and on track. I lower my wrist. If I needed more detail, I'd open the iPhone or laptop — but I almost never do, because the three numbers answer the question.

## Acceptance criteria

- The Watch glance widget shows exactly three values
- Tokens-remaining: numeric percentage with color (green >50%, yellow >20%, red ≤20%)
- Last-task-status: ✓ / ✗ / ⏳ glyph plus task title (truncated to ~25 chars)
- This-week's constraint: one short label (≤2 words)
- The widget refreshes within 60 seconds of underlying state change
- No notifications fire for routine state — only for events level ≥ user-set threshold

## Metric

- **Name**: `wrist_dwell_seconds_per_day`
- **Definition**: Total seconds per day the Apple Watch glance widget is foreground (proxied via Shortcut invocation count × estimated dwell)
- **Threshold**: ≤60 seconds/day (inverted — less is better)
- **Source**: `Observability` adapter — counts of the Shortcut's HTTP fetch hitting the local web app
- **Rationale**: If the user spends >1 minute/day on the Watch, the surface is too informative or the system is too unhealthy. Either is a problem.

## Integration test

- **File**: `user-stories/005-watch-three-numbers.test.ts` (forthcoming)
- **Setup**:
  - Mock the Apple Shortcut as a curl request to the local web app
  - Stub backend state covering all permutations of the three values
- **Action**: Hit the watch endpoint 10 times across varying states
- **Assert**:
  - Response payload has exactly 3 fields
  - Color codes match the threshold rules
  - Glyph mapping is correct
  - Constraint label ≤2 words
  - Refresh propagates state changes within 60s
  - Adding a 4th field to the response is rejected by a CI lint rule (deliberate constraint)

## Proof

- **Live**: Raise wrist; verify three values appear within 1 second of glance
- **Dashboard**: Web dashboard's "Watch payload" view shows current Watch JSON
- **Behavioral**: Daily wrist-dwell metric reads ≤60s sustained over a week

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: the Watch payload endpoint returns HTTP 200 with exactly 3 fields and refreshes within 60s of the underlying state change, sustained.
- **Blast radius**: a single Shortcut request / a single Watch glance. Never affects the loop's tick cadence, the supervisor, or any task already claimed.
- **Operator escape hatch**: a "fallback" Shortcut that pings `ntfy.sh` directly with the latest cached payload — bypasses the local web app entirely so the user can still see the three numbers if the dashboard is down.

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
- **Blocking**: P2 `watch-shortcuts`; depends on web app
- **Theoretical anchors**: Brendan Gregg USE / Tom Wilkie RED methodology (a small fixed set of vital signs); Beer's VSM (the wrist is System 5's read-out — Identity, the slowest-changing surface)
- **Design discipline**: A 4th number is forbidden by lint. If a new metric matters that much, one of the three must be replaced — not added. This is principled UX scarcity.

## Pattern conformance

- **Pattern**: Glanceable / ambient information display — Card, Mackinlay, Shneiderman, *Readings in Information Visualization*, Morgan Kaufmann, 1999, Ch. 1 — combined with Calm Technology — Weiser & Brown, "Designing Calm Technology", *PowerGrid Journal* 1995 (also Weiser, "The Computer for the 21st Century", *Scientific American* 265(3) 1991)
- **Conformance level**: full
- **Index row**: vision.md § "Pattern conformance index" row 45
- **Notes**: Three values, no chrome; the surface stays at the periphery of attention until needed. Inverted dwell metric (`wrist_dwell_seconds_per_day` ≤ 60 s) operationalises the calm-tech invariant: more attention to the read-out is a sign the surface or the system is failing. Cross-references row 12 (the Watch surface as the implementation locus); this row anchors the user-story specification.

## Security & privacy

Per constitutional rule #13 (vision.md § 13 — Security & privacy, second priority after performance).

- **Threat surface**: the Watch surface polls the dashboard-web endpoint for the three numbers. The polling response must not carry PII or data that leaks system state beyond the three intended values (`overnight_uptime_pct`, `tokens_remaining_pct`, `wrist_dwell_seconds_per_day`).
- **Localhost-only dashboard**: the dashboard-web endpoint from which the Watch surface reads binds to `127.0.0.1` (`dashboard-localhost-only-by-default`). An Apple Watch or iPhone reads via the Tailscale VPN, not a public-facing URL.
- **Minimal response surface**: the `/watch.json` endpoint returns exactly three numeric values and a timestamp. No task content, no repo paths, no API credentials appear in the response.
- **No PII in spans**: the Watch-surface refresh spans carry only the three metric values and the poll timestamp (`otel-no-pii-in-spans-lint`).
- **Threat model**: see `novel/dashboard-web/README.md` § Threat model (STRIDE-shaped, ≥5 lines; ships with slice 7 of `security-privacy-priority-substrate`).
