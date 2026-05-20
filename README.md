# Minsky

> Point minsky at any repo. It works on your tasks 24/7 using AI agents. You sleep, it ships PRs.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## Getting started

```bash
# Install
git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install

# Run — starts the daemon (if needed), installs launchd persistence,
# and drops you into the live dashboard. Same command works on first run
# AND every run after: if a daemon is already running for this folder,
# you attach to it. Ctrl-C detaches; the daemon keeps running.
minsky

# Stop everything (zero ghost processes — kills runners + agent children)
minsky stop
```

That's it. Minsky reads your `TASKS.md`, picks the highest-priority task, spawns an AI agent (Devin, Claude, or local), and opens a PR. Repeats 24/7. Survives reboots.

### Picking up upstream fixes

When new fixes land on `main`, pull them in:

```bash
git pull
```

A post-merge git hook handles most of the redeploy work automatically:

| Change in the pull | Auto-runs on `git pull` |
|---|---|
| `pnpm-lock.yaml` or `package.json` | `pnpm install` (refreshes `dist/`) |
| `bin/minsky` (and your plist exists) | Regenerates the launchd plist (no daemon kill) |
| `distribution/systemd/*.{service,target}` | `systemctl --user daemon-reload` (Linux) |
| Any of the above | `pre-pr-lint --stage=fast` as advisory sanity check |

**What it does NOT auto-do:** restart the running daemon. The current iteration may be mid-spawn and killing it would waste compute, so picking up new daemon-loop behavior still requires:

```bash
minsky update   # graceful stop → pull → rebuild → restart from next iteration
```

Tracked as P0 `minsky-auto-restart-daemon-on-pull` in `TASKS.md` — the goal is to make `minsky update` redundant by having the daemon notice the sentinel between iterations and gracefully restart itself. Opt out of any auto-install behavior with `MINSKY_NO_AUTO_INSTALL=1` (one-shot) or `touch ~/.minsky/no-auto-install` (per-machine).

---

## What it actually does

1. Reads `TASKS.md` from your repo (the [tasks.md spec](https://github.com/tasksmd/tasks.md))
2. Picks the highest-priority task with complete rule-9 fields
3. Spawns Devin, Claude, or a local model (configurable per machine)
4. The agent implements the task on a feature branch
5. Opens a PR with a hypothesis self-grade
6. Records the iteration in `.minsky/experiment-store/`
7. Picks the next task. Repeats.

## What works today (honest)

| Capability | Status | Confidence |
|---|---|---|
| Pick tasks from TASKS.md and spawn agents | ✅ Works | High — 26+ iterations |
| Open PRs autonomously | ✅ Works | PR #644 opened by devin |
| Walk multiple repos (3 iterations per host) | ✅ Works | Per-host cap, fair scheduling |
| Dynamic watchdog (adapts to machine speed) | ✅ Works | p95 × 1.5 from history |
| Live dashboard (`minsky watch`) | ✅ Works | Stability %, iterations, human-help |
| Survive reboots (launchd KeepAlive) | ✅ Works | Auto-installed on first run |
| One-command update (`minsky update`) | ✅ Works | Stop → pull → rebuild → restart |
| Zero ghost processes on stop | ✅ Works | Kills runners + agent children |
| Per-machine agent config | ✅ Works | `~/.minsky/config.json` |
| Switch between Devin, Claude, local models | 🟡 Partial | Claude primary, Devin experimental |
| 8h unattended runs with >90% stability | 🟡 In progress | Currently ~24%, improving |
| Multi-file refactors | 🔴 Not yet | M2 milestone |
| GitHub Actions CI | 🔴 Not yet | M3 milestone |

## What it will NEVER do

- **Security-sensitive changes** — marked human-blocked, always
- **Destructive operations** (force push, delete, deploy) — hard-blocked
- **Architecture decisions** — files research tasks for humans
- **Run without your approval** — every PR is a draft, you review

## CLI reference

```bash
minsky                    # start-or-attach: daemon + auto-install persistence + dashboard
minsky watch              # attach to live dashboard (Ctrl-C detaches, daemon keeps running)
minsky status             # quick health: PID, uptime, stability %
minsky logs               # tail daemon log
minsky stop               # thorough shutdown (launchd + runners + agents)
minsky update             # stop → git pull → rebuild → restart from same spot
minsky doctor             # check host readiness (node, git, gh, config, agents)
minsky report             # baseline / delta against .minsky/metric-snapshots/
minsky benchmark          # run the cross-repo runner N times and report pass-rate
minsky init               # one-command bootstrap on any git repo
minsky uninstall          # full removal (dry-run by default; --force to delete)
minsky install-daemon     # install launchd plist (auto-done on first run)
minsky uninstall-daemon   # remove launchd plist only (preserves config + logs)
```

## Configuration

Per-machine config at `~/.minsky/config.json`:

```json
{
  "cloud_agent": "devin",
  "cloud_agent_model": "claude-opus-4-7-max",
  "default_host": "/path/to/your/repo"
}
```

| Agent | Cloud | Local | How brief is sent |
|---|---|---|---|
| `devin` | ✅ | — | `--prompt-file` |
| `claude` | ✅ | — | stdin |
| `aider` | — | ✅ | `--message-file` |

## Architecture (30 seconds)

```text
minsky (bash CLI shim)
  ↓
cross-repo-runner (minsky-run.mjs) — walks hosts, picks tasks, spawns agents
  ↓
Devin / Claude / Aider — the actual AI agent (pluggable)
  ↓
.minsky/ sidecar — config, experiment store, iteration records
```

## Principles

- **Soft by default** — scope-leak warns (doesn't halt), spawn-failed skips (doesn't stop)
- **Default by default** — every behavior ships as the default, not behind opt-in flags
- **Gradual improvement** — `minsky update` after every fix, daemon resumes from same spot
- **Honest metrics** — stability % computed from real data, not aspirational
- **Test the runtime, not just functions** — runtime invariants catch what 95% unit coverage misses

## Key files

| File | Purpose |
|---|---|
| `TASKS.md` | Work queue (tasks.md spec) |
| `MILESTONES.md` | Roadmap with exit criteria |
| `AGENTS.md` | Rules for AI agents |
| `DEPRECATED.md` | Features not to invest in |
| `vision.md` | The constitution (15 rules) |
| `competitors/` | Honest analysis of 6 competitors |

## Competitors (honest)

| Tool | Their advantage | Minsky's advantage |
|---|---|---|
| **Devin** ($20/mo) | Polished cloud UX | Self-hosted, 24/7 daemon, multi-agent, $0 local |
| **OpenHands** (OSS) | Higher SWE-bench | Daemon mode, budget mgmt, multi-repo |
| **Aider** (OSS) | Best local models | Minsky uses aider as its local backend |
| **Cursor Agent** | IDE integration | Headless, survives IDE close, multi-repo |

## Uninstall

```bash
# Preview what would be removed (safe — no deletion)
minsky uninstall

# Full removal: stops daemon, removes launchd plist, deletes ~/.minsky/
minsky uninstall --force
```

The host repo and its `.minsky/` experiment store (your iteration history) are not touched — those are your data. Only per-machine state under `~/.minsky/` and `~/Library/LaunchAgents/com.minsky.daemon.plist` are removed.

## License

MIT — see [LICENSE](./LICENSE).
