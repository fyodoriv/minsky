# Story 002 — Pause from iPhone

**Milestone(s)**: M1.6

## Story

You are at dinner. Your phone buzzes: Minsky — the background program that does coding work for you while you are away — is about to commit something you want to review first. You tap one Apple Shortcut on your iPhone. No laptop. No fiddling with a network tunnel.

Within 30 seconds the loop pauses cleanly. The task already in progress finishes its current step, and Minsky claims no new work. When you get home, you tap "resume" from the same Shortcut.

Two terms used below, defined once here:

- A **persona** is a role the agent takes on — researcher, planner, implementer, or QA. (The **agent** is the coding assistant Minsky drives to do the actual work — Claude Code, Devin, Aider, or OpenHands.) A graceful pause lets the current persona step finish before stopping.
- The **supervisor** is the outer watchdog that restarts Minsky if it dies and survives reboots. A pause must outlive a supervisor restart, so it is stored as a file on disk, not just in memory.

## Acceptance criteria

- One Apple Shortcut (no app to open) pauses the loop.
- One Apple Shortcut resumes it.
- The pause is graceful: the in-flight persona step finishes; no half-done state.
- The pause survives a supervisor restart, because the flag file on disk survives.
- The Watch surface shows the paused state right away.
- All of this works from anywhere, over the encrypted private network (Tailscale).

## Metric

- **Name**: `pause_latency_p95`
- **Definition**: 95th-percentile time from "pause Shortcut tapped" to "supervisor reports paused state, no new tick claims". A **tick** is one wake-up of the loop on its timer.
- **Threshold**: ≤30 seconds
- **Source**: `Observability` adapter — the span between the Shortcut HTTP request and the supervisor's state-change event.

## Integration test

- **File**: `user-stories/002-pause-from-iphone.test.ts` (forthcoming)
- **Setup**:
  - Tailscale up; Minsky web app reachable on the private network.
  - Loop running with 5 in-flight tasks queued.
  - Apple Shortcut JSON imported.
- **Action**: Send the Shortcut's HTTP request (`POST /pause`) over the private network, then send `POST /resume` 60 seconds later.
- **Assert**:
  - Paused state shows within 30 seconds (latency p95).
  - The in-flight persona step finishes (no abort mid-tool-call).
  - No new task is claimed during the pause window.
  - Resume returns the loop to active state within 30 seconds.
  - The `state/PAUSED` flag file is written, then removed, correctly.
  - The Watch surface JSON reflects the state change within one poll interval.

## Proof

- **Live**: The Watch surface shows "⏸ Paused" within seconds of the Shortcut tap.
- **Dashboard**: The web dashboard banner reads "Paused — tap to resume" with a timestamp.
- **Notification**: A confirmation ntfy push fires on every state transition.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: a `POST /pause` HTTP request from a device on the private network moves the supervisor to paused state, visible on the Watch within 30 seconds p95.
- **Blast radius**: the in-flight persona step (allowed to finish). No impact on the supervisor process, on ticks already complete, or on the loop's restart policy.
- **Operator escape hatch**: SSH to the machine running Minsky and run `rm state/PAUSED` to force a resume. An admin-token "force-resume" Shortcut walks the same path over the private network without SSH.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Tailscale connection drops between iPhone and host mid-pause-request | `tailscale down` on host (network partition) | `circuit-break-and-notify` | Down Tailscale; assert Shortcut surfaces an error to the user, retry-after-up succeeds, no half-pause state. |
| 2 | Web app crashes between request received and flag-file write | `kill -9 $(pgrep -f minsky-dashboard-web)` mid-request (process death) | `loud-crash-supervisor-restart` | Kill mid-request; assert paused state recovered from request log on restart OR clear "request lost" notification — never a silent half-pause. |
| 3 | Pause flag-file write succeeds but supervisor doesn't observe within 30s | Stub the fs-watcher to drop events (dependency upstream-error) | `circuit-break-and-notify` | Patch the watcher; assert OTEL span `pause.detection.latency` exceeds threshold and a notification fires — system flags the bug rather than swallowing it. |
| 4 | Resume request arrives during a tick that is itself recovering from a crash | Compose: kill tick-loop, then `POST /resume` before respawn completes (clock + process death) | `graceful-degrade` | Sequence the events; assert resume queued until current tick state stabilises, no stuck flag. |
| 5 | Two pauses within 5s (rapid double-tap) | Fire two `POST /pause` from the same device (request flood) | `graceful-degrade` | Double-fire; assert idempotency — second request acks the existing paused state, no extra ntfy notification. |
| 6 | ntfy push fails (upstream rate-limit / outage) | `iptables -A OUTPUT -d ntfy.sh -j DROP` during a state transition (network) | `graceful-degrade` | Drop ntfy.sh; assert state still changes, notification queued for retry, dashboard reflects state truth-of-source. |

OTEL is OpenTelemetry (OTEL), the open standard Minsky emits for traces, metrics, and logs.

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

(Operator directive 2026-05-06 — vision.md rule #13 "Security & privacy — second priority after performance".) Industry-standard primitives only; rule #1 (don't reinvent) applies.

- **Trust boundary**: this story's untrusted inputs are the operator's TASKS.md content + claude --print stdout (LLM output, treated as untrusted by default per OWASP LLM02). Trusted: the local filesystem + the launchd unit-file's environment. Anything that crosses the boundary (PR body emission, OTEL span content) passes through the secret-leak scanner (`scripts/scan-secrets.mjs`) and the no-PII span lint.
- **Secrets**: no API keys, tokens, or `.env` content in PR bodies, OTEL spans, or `.minsky/` logs. Floor: `scan-secrets` pre-commit + `secret-scanning-precommit-and-ci` (TASKS.md P0).
- **PII**: no email/IP/full-paths-with-username in OTEL span attributes. Floor: `otel-no-pii-in-spans-lint` (TASKS.md P0).
- **Sandbox**: the supervisor process's filesystem + network reach is restricted to what this story actually needs. Floor: `supervisor-sandbox-syscall-restriction` (TASKS.md P0); industry standard via systemd `ProtectSystem=strict` + `PrivateTmp=true` / launchd App Sandbox.
- **Performance carve-out**: when a security restriction would cost >10% on this story's load-bearing latency metric, the trade-off is documented in this section as a declared deviation with a numeric cost figure. Silent trade-offs are forbidden (vision.md rule #13's "performance-first carve-out" clause).
