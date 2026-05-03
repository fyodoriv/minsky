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

## Status

- **Phase**: Specification
- **Blocking**: P2 `watch-shortcuts`; depends on web app
- **Theoretical anchors**: Brendan Gregg USE / Tom Wilkie RED methodology (a small fixed set of vital signs); Beer's VSM (the wrist is System 5's read-out — Identity, the slowest-changing surface)
- **Design discipline**: A 4th number is forbidden by lint. If a new metric matters that much, one of the three must be replaced — not added. This is principled UX scarcity.
