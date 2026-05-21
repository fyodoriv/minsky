# Minsky

> A background daemon that runs AI coding agents against tasks in any git repo.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

Minsky watches over your git repo and improves it over time. It picks the next thing to fix, makes the fix on a feature branch, runs your tests, and opens a draft pull request for you to review. Then it picks the next thing. By default it keeps going until you stop it.

The methodology is rigorous — every change applies established software-engineering practices, each backed by a published literature citation ([see the full list](docs/PRACTICES.md)).

**[Seven reasons you'd want this →](#why-minsky)** &nbsp;·&nbsp; Or skip to [getting started](#getting-started).

## Getting started

**Through your AI agent.** Copy-paste:

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

**Manual:**

```bash
git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install && ./bin/minsky
```

Full install runbook: [INSTALL.md](INSTALL.md). Uninstall: [docs/uninstall.md](docs/uninstall.md).

## What it actually does

1. Reads `TASKS.md` from your **host** repo (the [tasks.md spec](https://github.com/tasksmd/tasks.md))
2. Picks the highest-priority task that's ready to work on (has the required fields filled in)
3. Spawns Devin, Claude, or a local AI model (configurable per machine)
4. The agent implements the task on a feature branch
5. Opens a draft pull request — including a self-graded report on whether the change moved the metric it predicted
6. Records the iteration in `.minsky/experiment-store/` (inside your repo, for the next run to learn from)
7. Picks the next task. Repeats.

> **What's a "host"?** A host is a single git repository that minsky operates on — picks tasks from its `TASKS.md`, spawns agents inside its worktree, opens PRs against its remote. Selected via `default_host` in `~/.minsky/config.json`, or `--host <path>` flag, or the current working directory by default. Multi-host mode (`--hosts-dir <parent>`) walks every git repo under one parent directory in round-robin (3 iterations per host per pass).

## Why Minsky?

Seven things you get with minsky running on a repo. Each links to a dedicated page with the full story (what the feature delivers, how it's measured, and how it's tested under stress).

- **Continuous, unattended improvement** — picks tasks, ships draft pull requests, never merges without you. ([details →](user-stories/001-loop-runs-overnight.md))
- **Finds new work for you to approve** *(can be turned off)* — after each fix, it audits the repo and proposes new tasks for your review. ([details →](user-stories/007-cto-audit-files-new-tasks.md))
- **Right model for each task** — Claude for prose, Devin for refactors, a local model for mechanical fixes (so cheap work stays cheap). ([details →](user-stories/008-per-task-backend-and-personas.md))
- **Refuses to reinvent the wheel** — every pull request has to cite the libraries it considered; if it skips the search, the build fails. ([details →](user-stories/009-forced-research-rule-1.md))
- **A tool that improves itself** — reads its own metrics, files tasks against its own weak spots, ships the fixes. ([details →](user-stories/003-mape-k-improves-prompts.md))
- **Keeps going when the cloud runs dry** — if your cloud-AI quota runs out, it falls back to a local model so the loop doesn't stall. ([details →](user-stories/004-budget-auto-pause.md))
- **Async Q&A across timezones** *(coming)* — agents leave questions in a file; you answer when you wake up. ([details →](user-stories/010-async-human-qa-via-file.md))

Safety is mechanical, not optional. Every pull request is a draft until you mark it ready. Every iteration passes 15 automatic checks — including a secret scanner, a "stay-in-your-lane" check that catches drive-by edits, and a security review. No agent can push directly to `main`. No pull request merges without your approval.

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
| File-based human↔agent Q&A | 🔴 Not yet | P0 `minsky-human-comm-via-file` |
| `npx minsky` one-command install+run | 🔴 Not yet | P1 `minsky-npx-install-and-run` |
| Multi-file refactors | 🔴 Not yet | M2 milestone |
| GitHub Actions CI | 🔴 Not yet | M3 milestone |

## What it won't do

Hard rules. Not "tries not to" — mechanically blocked.

- **Security-sensitive changes** — marked human-blocked, always
- **Destructive operations** (force push, delete, deploy) — hard-blocked
- **Architecture decisions** — files research tasks for humans
- **Merge anything without your approval** — every PR is a draft; you review and merge

## How Minsky works inside

The 30-second sketch:

```text
minsky (bash CLI shim)
  ↓
cross-repo-runner (minsky-run.mjs) — walks hosts, picks tasks, spawns agents
  ↓
Devin / Claude / Aider — the actual AI agent (pluggable)
  ↓
.minsky/ sidecar — config, experiment store, iteration records
```

Six distinctive mechanisms, each backed by file paths so any claim is auditable:

- **Multi-layer team of workers** — per-task backend selection (`novel/tick-loop/src/llm-provider-spawn-strategy.ts`) ships today; multi-persona pipelines per task are an M2 milestone tracked at `multi-persona-pipeline-handoff-spec`.
- **MAPE-K control loop** (Kephart & Chess 2003, IBM autonomic computing) — Monitor / Analyze / Plan / Execute over `.minsky/experiment-store/` knowledge.
- **Constitution = 18 rules, each enforced as a CI lint** — rule #1 (don't reinvent), #9 (hypothesis-driven), #12 (scope discipline), #17 (proactive healing), #18 (fake-data markers) are the load-bearing ones.
- **Soft-by-default failure modes** — Erlang let-it-crash + launchd / systemd outer supervisor; an iteration that scope-leaks or spawn-fails doesn't halt the loop.
- **Dynamic watchdog** (p95 from history) — `novel/cross-repo-runner/src/dynamic-timeouts.ts` re-derives the watchdog timeout every iteration; same code adapts to any machine.
- **Self-improvement on itself** — the daemon refactors the daemon; most P0s in this repo's `TASKS.md` were surfaced by daemon iterations.

## More

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — code in this repo is AI-authored; how to attest
- **[INSTALL.md](INSTALL.md)** — agent-readable install runbook
- **[docs/uninstall.md](docs/uninstall.md)** — full removal, daemon stop, sidecar cleanup
- **[docs/updating.md](docs/updating.md)** — `git pull` workflow, restart, sentinel
- **[docs/cli-reference.md](docs/cli-reference.md)** — every command, every flag, every env var
- **[docs/configuration.md](docs/configuration.md)** — `~/.minsky/config.json`, agent comparison
- **[docs/auto-merge.md](docs/auto-merge.md)** — periodic gate-and-merge for daemon PRs (ON for minsky itself, OFF for other repos)
- **[docs/dependabot.md](docs/dependabot.md)** — dependency-update policy, grouping, local merge gate
- **[docs/edge-cases.md](docs/edge-cases.md)** — empty queues, runtime limits, comm channels, crashes
- **[docs/PRACTICES.md](docs/PRACTICES.md)** — scientifically proven practices with citations
- **[vision.md](vision.md)** — the constitution (18 rules), pattern conformance index
- **[TASKS.md](TASKS.md)** — open tasks with rule-9 fields
- **[MILESTONES.md](MILESTONES.md)** — M1–M5 exit criteria
- **[DEPRECATED.md](DEPRECATED.md)** — retired features (don't invest in these)

About the name: Marvin Minsky (1927–2016), cognitive scientist, *The Society of Mind* (1986) — intelligence emerges from many simple specialised agents working together. The tool borrows the metaphor.

## License

MIT. See [LICENSE](LICENSE).
