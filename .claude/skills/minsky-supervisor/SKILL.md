---
name: minsky-supervisor
description: Start, stop, monitor, and health-check the Minsky supervisor loop (the launchd / systemd-user units that run the tick-loop daemon against this repo). Use when the user says "start minsky", "stop the supervisor", "show me the minsky logs", "is minsky running", or any phrase about the per-host supervisor lifecycle. Wraps the `pnpm minsky:*` script family so the operator-side surface is one slash command. Renamed from `dogfood` 2026-05-26 per operator directive ("That's minsky first of all").
allowed-tools: Bash, Read
---

# Minsky supervisor

Operator-side wrapper for the Minsky supervisor lifecycle (rule #12 — Scope discipline; user-stories/001-loop-runs-overnight.md). The supervisor is the launchd / systemd-user unit pair that runs the tick-loop daemon against this very repo, picking the next P0 task and emitting iteration spans.

## Subcommands

Pick the verb from the user's intent and run the corresponding `pnpm minsky:*` script:

| User intent | Command |
|---|---|
| "start minsky", "load supervisor", "run minsky on itself" | `pnpm minsky:setup` |
| "is it running", "check supervisor", "status" | `pnpm minsky:status` |
| "show logs", "stream logs", "tail" | `pnpm minsky:logs` (Ctrl-C to exit) |
| "stop", "pause", "shut down" | `pnpm minsky:stop` |
| "health check", "doctor" | `pnpm minsky:doctor` |
| "open the dashboard", "show the UI" | `pnpm minsky:ui` (port 8181 by default) |

## Rule #12 + safety

`pnpm minsky:setup` loads supervisors that drive the operator's actual agent runtime (post-#148 — safe-rollout window closed). The `BudgetGuard.decide()` per-iteration call circuit-breaks when the 5h window crosses 85%, so the loop won't burn API tokens on an exhausted budget — but it WILL spawn the real backend (OpenHands by default, with claude/devin/aider as alternatives) when the window has room.

`pnpm minsky:setup` also installs the OpenHands Python SDK (`uv pip install openhands-ai` into `~/.minsky/openhands-venv`) on first run — operator directive 2026-05-26 "install openhands always" — so the default `cloud_agent: "openhands"` backend works out of the box. Idempotent on re-invocation.

If the user explicitly wants the dry-run safety net (e.g., for a chaos test or a fresh-install smoke), have them edit `~/Library/LaunchAgents/com.minsky.tick-loop.plist` to add the `MINSKY_TICK_DRY_RUN=1` env-var key under `EnvironmentVariables`, then `pnpm minsky:setup` to reload. Re-document the procedure in the PR description if you ship a temporary dry-run override.

## What "running cleanly" looks like

After `pnpm minsky:setup`:

```text
$ pnpm minsky:status
NNNNN  0  com.minsky.budget-guard
NNNNN  0  com.minsky.tick-loop
```

Both PIDs assigned, both exit codes `0`. If you see `-` instead of a PID, or a non-zero exit code, the unit is crash-looping — `pnpm minsky:logs` (or read `.minsky/{tick-loop,budget-guard}.{out,err}.log`) and follow the troubleshooting flow inline-debug per the live-fire pattern.

## Backward-compat aliases

The previous `pnpm dogfood:*` names are removed in favor of `pnpm minsky:*`. `./setup.sh --dogfood` still works as a deprecated alias for `./setup.sh --setup` (prints a one-line warning, removed 2026-06-26).

## Don't load on a stale build

`pnpm minsky:setup` doesn't run `pnpm install` or `pnpm typecheck` before loading. If the user asks to start the supervisor after pulling new commits, run `pnpm install && pnpm typecheck` first so the tick-loop daemon's `dist/` is fresh. If `dist/` is stale the daemon may exec node code that doesn't match the source — confusing to debug.

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

After this, `pnpm minsky:setup` re-renders + re-loads from the source templates.

## Operator hint

Always print the five most useful follow-up commands after `pnpm minsky:setup` ships a GREEN status, so the user has the "now what" surface visible:

```text
- pnpm minsky:logs    # structured tail of both supervisor logs (colored + span-pretty)
- pnpm minsky:status  # PID + exit-code check
- pnpm minsky:stop    # bootout / systemctl stop
- pnpm minsky:doctor  # read-only health probe
- pnpm minsky:ui      # dashboard at http://localhost:8181
```
