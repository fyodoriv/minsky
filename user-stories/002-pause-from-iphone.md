# Story 002 — Pause from iPhone

## Story

I'm at dinner. My phone buzzes — the agent is about to commit something I want to review first. I tap a Shortcut on my iPhone (no laptop, no tunnel-fiddling). Within 30 seconds, the loop pauses cleanly: the in-flight task finishes its current persona step and the system enters a paused state with no new tasks claimed. When I get home, I tap "resume" from the same Shortcut.

## Acceptance criteria

- A single Apple Shortcut (no app to open) can pause the loop
- A single Apple Shortcut can resume it
- Pause is graceful: in-flight persona step completes, no half-done state
- Pause persists across supervisor restarts (the flag file survives)
- The Watch surface reflects paused state immediately
- All of this works from anywhere over Tailscale

## Metric

- **Name**: `pause_latency_p95`
- **Definition**: 95th-percentile time from "pause Shortcut tapped" to "supervisor reports paused state, no new tick claims"
- **Threshold**: ≤30 seconds
- **Source**: `Observability` adapter — span between Shortcut HTTP request and supervisor state-change event

## Integration test

- **File**: `user-stories/002-pause-from-iphone.test.ts` (forthcoming)
- **Setup**:
  - Tailscale up; minsky web app reachable on tailnet
  - Loop running with 5 in-flight tasks queued
  - Apple Shortcut JSON imported
- **Action**: Simulate the Shortcut HTTP request (`POST /pause`) over the tailnet, then `POST /resume` 60s later
- **Assert**:
  - Paused state reflected within 30s (latency p95)
  - In-flight persona step completes (no abort mid-tool-call)
  - No new task claimed during pause window
  - Resume returns the loop to active state within 30s
  - `state/PAUSED` flag file written/removed correctly
  - Watch surface JSON reflects the state change within one poll interval

## Proof

- **Live**: Watch surface shows "⏸ Paused" within seconds of the Shortcut tap
- **Dashboard**: Web dashboard banner reads "Paused — tap to resume" with timestamp
- **Notification**: A confirmation ntfy push fires on every state transition

## Status

- **Phase**: Specification
- **Blocking**: P1 task `supervisor-setup`; P2 task `watch-shortcuts`
- **Theoretical anchor**: Cybernetic feedback (Wiener) — the Watch is the user's nervous-system extension into the organism
- **Open question**: Does pausing-during-Ralph-mode wait for architect verification or interrupt? Default: wait. Document in `ARCHITECTURE.md` once implemented.
