# Edge cases

What happens when things aren't normal.

## How long does it run?

**Forever, by default.** No built-in time limit. The daemon:

- Survives reboots — launchd / systemd respawn it on boot (`KeepAlive=true`)
- Survives crashes — supervisor respawns the daemon on any non-zero exit
- Survives terminal close — the parent process traps `SIGHUP` so closing your IDE doesn't kill it
- Survives token limits — when claude hits its quota, minsky auto-switches to local models and keeps going (tracked in P0 `runtime-token-limit-auto-pivot-local-and-back`)
- Survives empty queues — see below

The only ways to stop it: `minsky stop`, machine power-off, or `minsky uninstall`.

Cap explicitly with `--max-iterations=N` (default: `Infinity`) or `minsky --once` for one task.

## What if `TASKS.md` is empty or doesn't exist?

Minsky doesn't sit idle. Default flow is `--seed-on-empty` (on by default):

1. **`TASKS.md` missing** — `minsky init` creates a starter with the tasks.md spec headers and one example task.
2. **`TASKS.md` exists but no rule-#9-compliant tasks are left** — minsky runs a **CTO audit**: reads the repo (test count, lint health, doc coverage, dependency age, security warnings), proposes new tasks based on what it finds, writes them back to `TASKS.md`. Picks one and starts working.
3. **CTO audit produces zero tasks too** — minsky exits the iteration with `empty-queue` and waits for the next tick (default 5 min) before retrying.

Opt out with `--no-seed-on-empty` — minsky will halt cleanly when the queue runs dry.

## How does minsky talk to humans?

Three channels today:

1. **Draft PRs** — every task ships as a draft PR. The agent's PR body includes a `self-grade` block with hypothesis + measurement + risk.
2. **`Blocked` markers in `TASKS.md`** — when an agent encounters a step it can't safely automate (security-sensitive change, force push, vendor selection), it adds `**Blocked**: needs-user-approval — <reason>` to the task block and moves on. Grep `TASKS.md` for `Blocked` to see what's waiting on you.
3. **Daemon log** — `~/.minsky/daemon.log` tails warnings (`spawn-failed`, `scope-leak`, `gh 401`). View live via `minsky watch`.

**In flight: fast file-based Q&A** (P0 `minsky-human-comm-via-file`, see [user-stories/010-async-human-qa-via-file.md](../user-stories/010-async-human-qa-via-file.md)). A `.minsky/qa-log.md` file the agent writes questions to and watches for your answers. Edit the file in your normal editor and save; the agent picks up your answer within 500 ms. Designed for back-and-forth too quick for a PR review but too detailed for a TASKS.md `Blocked` field.

## What if the daemon crashes?

The launchd plist / systemd unit runs with `KeepAlive=true` — the supervisor respawns the daemon on any non-zero exit. State in `.minsky/` is preserved across restarts, so the next iteration resumes from where the crashed one left off (specifically: the next task in the queue; the in-flight task may be re-tried depending on its verdict).

Check the daemon log for the crash cause:

```bash
grep -E 'crash|fatal|FATAL' ~/.minsky/daemon.log | tail -5
```

If the daemon repeatedly crashes within seconds, launchd / systemd backs off (exponential retry) and eventually stops respawning to avoid a fork-bomb. Recover with `minsky stop && minsky` to reset the supervisor state.

## What if the network goes down mid-iteration?

- **Pre-spawn (task picker is reading TASKS.md, etc.)**: no network needed for picker; iteration proceeds.
- **During agent invocation**: the agent CLI sees the network error and exits. Iteration verdict = `spawn-failed`. Next tick re-tries the task.
- **During PR push**: `gh` commands fail; the agent records the failure but doesn't kill the daemon. Operator sees the unpushed branch when network returns.

Soft-by-default supervision means no single network blip wedges the loop.

## What if the cloud agent runs out of tokens?

Detected today; mid-run swap is P0. See [user-stories/004-budget-auto-pause.md](../user-stories/004-budget-auto-pause.md).

Today's behaviour: `novel/tick-loop/src/claude-exhaustion-state.ts` records the exhaustion. The next iteration falls back to local Ollama if configured. Resumes cloud when tokens return at the next budget-window reset.

## What if two daemons run on the same host?

Lock collision detection: each daemon writes a PID to `~/.minsky/daemon.pid`. A second daemon trying to start checks the existing PID; if it's alive, the second daemon exits with `daemon already running on this host`.

If the PID file is stale (process died without cleanup), the next `minsky` invocation detects it (`kill -0 $pid` fails), clears the stale file, and proceeds.

## What if I made changes in the host repo while the daemon was running?

The daemon spawns each iteration in a per-task worktree, so your `main` branch HEAD is never directly modified. Your uncommitted local changes on `main` are isolated from the daemon's work.

After the daemon opens a PR, you can:

- Review and merge it (your changes stay on top after merge)
- Close it (no impact on your work)
- Edit the branch yourself (the daemon won't re-touch it once the branch has commits the operator didn't make)

If you committed directly to `main` during a daemon iteration, the daemon's PR may have merge conflicts when you try to merge. The PR's local-gate-merge attempt detects this and surfaces it as a `merge-conflict` verdict; the operator resolves manually.
