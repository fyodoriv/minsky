---
name: dogfood
description: Start, stop, monitor, and health-check the Minsky-on-itself supervisor loop (the launchd / systemd-user units that run the tick-loop daemon against this repo). Use when the user says "start dogfooding", "stop the supervisor", "show me the dogfood logs", "is minsky running", or any phrase about the per-host supervisor lifecycle. Wraps the `pnpm dogfood:*` script family so the operator-side surface is one slash command.
allowed-tools: Bash, Read
---

# Dogfood

Operator-side wrapper for the Minsky-on-itself supervisor lifecycle (rule #12 — Scope discipline; user-stories/001-loop-runs-overnight.md). The supervisor is the launchd / systemd-user unit pair that runs the tick-loop daemon against this very repo, picking the next P0 task and emitting iteration spans.

## Subcommands

Pick the verb from the user's intent and run the corresponding `pnpm dogfood:*` script:

| User intent | Command |
|---|---|
| "start dogfooding", "load supervisor", "run minsky on itself" | `pnpm dogfood` |
| "is it running", "check supervisor", "status" | `pnpm dogfood:status` |
| "show logs", "stream logs", "tail" | `pnpm dogfood:logs` (Ctrl-C to exit) |
| "stop", "pause", "shut down" | `pnpm dogfood:stop` |
| "health check", "doctor" | `pnpm dogfood:doctor` |

## Rule #12 + safety

`pnpm dogfood` loads supervisors that drive the operator's actual `claude --print` (post-#148 — safe-rollout window closed). The `BudgetGuard.decide()` per-iteration call circuit-breaks when the 5h window crosses 85%, so the loop won't burn API tokens on an exhausted budget — but it WILL spawn real Claude when the window has room.

If the user explicitly wants the dry-run safety net (e.g., for a chaos test or a fresh-install smoke), have them edit `~/Library/LaunchAgents/com.minsky.tick-loop.plist` to add the `MINSKY_TICK_DRY_RUN=1` env-var key under `EnvironmentVariables`, then `pnpm dogfood` to reload. Re-document the procedure in the PR description if you ship a temporary dry-run override.

## What "running cleanly" looks like

After `pnpm dogfood`:

```text
$ pnpm dogfood:status
NNNNN  0  com.minsky.budget-guard
NNNNN  0  com.minsky.tick-loop
```

Both PIDs assigned, both exit codes `0`. If you see `-` instead of a PID, or a non-zero exit code, the unit is crash-looping — `pnpm dogfood:logs` (or read `.minsky/{tick-loop,budget-guard}.{out,err}.log`) and follow the troubleshooting flow in `dogfood-debug` (filed if useful, otherwise inline-debug per the live-fire pattern).

## Don't load on a stale build

`pnpm dogfood` doesn't run `pnpm install` or `pnpm typecheck` before loading. If the user asks to dogfood after pulling new commits, run `pnpm install && pnpm typecheck` first so the tick-loop daemon's `dist/` is fresh. If `dist/` is stale the daemon may exec node code that doesn't match the source — confusing to debug.

## Operator escape hatch

If the supervisor wedges (rare), the absolute escape is:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.minsky.tick-loop.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.minsky.budget-guard.plist
rm -f ~/Library/LaunchAgents/com.minsky.*.plist
```

Linux equivalent:

```bash
systemctl --user stop minsky-supervisor.target
systemctl --user disable minsky-supervisor.target
rm -f ~/.config/systemd/user/minsky-*.service ~/.config/systemd/user/minsky-supervisor.target
systemctl --user daemon-reload
```

After this, `pnpm dogfood` re-renders + re-loads from the source templates.

## Operator hint

Always print the four most useful follow-up commands after `pnpm dogfood` ships a GREEN status, so the user has the "now what" surface visible:

```text
- pnpm dogfood:logs    # tail -F both supervisor logs
- pnpm dogfood:status  # PID + exit-code check
- pnpm dogfood:stop    # bootout / systemctl stop
- pnpm dogfood:doctor  # read-only health probe
```
