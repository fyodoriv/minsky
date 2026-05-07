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

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: a `POST /pause` HTTP request from a Tailscale-connected device transitions the supervisor to paused state visible to the Watch within 30s p95.
- **Blast radius**: the in-flight persona step (allowed to finish). No impact on the supervisor process, on other ticks already complete, or on the loop's restart policy.
- **Operator escape hatch**: SSH to the host and `rm state/PAUSED` to force resume. An admin-token "force-resume" Shortcut is the same path over Tailscale without SSH.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Tailscale connection drops between iPhone and host mid-pause-request | `tailscale down` on host (network partition) | `circuit-break-and-notify` | Down Tailscale; assert Shortcut surfaces an error to the user, retry-after-up succeeds, no half-pause state. |
| 2 | Web app crashes between request received and flag-file write | `kill -9 $(pgrep -f minsky-dashboard-web)` mid-request (process death) | `loud-crash-supervisor-restart` | Kill mid-request; assert paused state recovered from request log on restart OR clear "request lost" notification — never a silent half-pause. |
| 3 | Pause flag-file write succeeds but supervisor doesn't observe within 30s | Stub the fs-watcher to drop events (dependency upstream-error) | `circuit-break-and-notify` | Patch the watcher; assert OTEL span `pause.detection.latency` exceeds threshold and a notification fires — system flags the bug rather than swallowing it. |
| 4 | Resume request arrives during a tick that is itself recovering from a crash | Compose: kill tick-loop, then `POST /resume` before respawn completes (clock + process death) | `graceful-degrade` | Sequence the events; assert resume queued until current tick state stabilises, no stuck flag. |
| 5 | Two pauses within 5s (rapid double-tap) | Fire two `POST /pause` from the same device (request flood) | `graceful-degrade` | Double-fire; assert idempotency — second request acks the existing paused state, no extra ntfy notification. |
| 6 | ntfy push fails (upstream rate-limit / outage) | `iptables -A OUTPUT -d ntfy.sh -j DROP` during a state transition (network) | `graceful-degrade` | Drop ntfy.sh; assert state still changes, notification queued for retry, dashboard reflects state truth-of-source. |

## Status

- **Phase**: Specification
- **Blocking**: P1 task `supervisor-setup`; P2 task `watch-shortcuts`
- **Theoretical anchor**: Cybernetic feedback (Wiener) — the Watch is the user's nervous-system extension into the organism
- **Open question**: Does pausing-during-Ralph-mode wait for architect verification or interrupt? Default: wait. Document in `ARCHITECTURE.md` once implemented.

## Pattern conformance

- **Pattern**: Remote procedure call as the control surface — Birrell & Nelson, "Implementing Remote Procedure Calls", *ACM TOCS* 2(1) 1984 — combined with cooperative cancellation via a flag-file checkpoint per Stevens, *Advanced Programming in the UNIX Environment*, Addison-Wesley, 1992, Ch. 10 (signals, graceful shutdown)
- **Conformance level**: partial
- **Index row**: vision.md § "Pattern conformance index" row 42
- **Notes**: Pause is delivered as an HTTPS request over Tailscale (RPC at the wire) but consumed as a flag-file rather than a synchronous RPC return — the in-flight tick checks the flag at the next safe point and self-suspends. Birrell-Nelson's transparency property is intentionally weakened: the caller does not block until the loop has paused; the Watch surface is the eventual-consistency read-back.

## Security & privacy

Per constitutional rule #13 (vision.md § 13 — Security & privacy, second priority after performance).

- **Threat surface**: the Tailscale HTTP endpoint (`POST /pause`, `POST /resume`) is a remote control surface. A spoofed or replayed request could pause the supervisor at a critical moment or resume it unexpectedly.
- **Authentication**: requests over Tailscale inherit device-level authentication (Tailscale ACLs — the requesting device must be on the operator's tailnet). No additional credential is required for pause/resume; the attack surface is limited to devices the operator has authorised in their tailnet.
- **No PII in the pause payload**: the `POST /pause` and `POST /resume` request bodies carry no user data — the flag file written to `state/PAUSED` is a zero-byte sentinel. The ntfy push on state transition carries only the state label and timestamp.
- **Localhost-only dashboard**: the web app's main HTTP surface binds `127.0.0.1` (`dashboard-localhost-only-by-default`); the Tailscale endpoint is a separate, explicitly scoped service.
- **Threat model**: see `novel/dashboard-web/README.md` § Threat model (STRIDE-shaped, ≥5 lines; ships with slice 7 of `security-privacy-priority-substrate`).
