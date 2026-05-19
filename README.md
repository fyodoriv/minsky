# Minsky

> Point minsky at any repo. It works on your tasks 24/7 using AI agents. You sleep, it ships PRs.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## Getting started

```bash
# Install
git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install

# Run (starts daemon + survives reboots + opens live dashboard)
minsky

# Monitor
minsky watch

# Update after fixes
minsky update

# Stop everything (zero ghost processes)
minsky stop

# Uninstall
minsky stop && minsky uninstall-daemon && rm -rf .minsky/
```

That's it. Minsky reads your `TASKS.md`, picks the highest-priority task, spawns an AI agent (Devin, Claude, or local), and opens a PR. Repeats 24/7. Survives reboots.

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
minsky                    # start daemon + auto-install persistence + open dashboard
minsky watch              # live dashboard (stability %, iterations, alerts)
minsky status             # quick health: PID, uptime, stability %
minsky logs               # tail daemon log
minsky stop               # thorough shutdown (launchd + runners + agents)
minsky update             # stop → git pull → rebuild → restart from same spot
minsky install-daemon     # install launchd plist (auto-done on first run)
minsky uninstall-daemon   # remove launchd plist
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

```
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

## License

MIT — see [LICENSE](./LICENSE).
