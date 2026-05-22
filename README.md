# Minsky

> A background daemon that runs AI coding agents against tasks in any git repo.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

Minsky watches over your git repo and improves it over time. It picks the next thing to fix, makes the fix on a feature branch, runs your tests, and opens a draft pull request for you to review. Then it picks the next thing. By default it keeps going until you stop it.

The methodology is rigorous — every change applies established software-engineering practices, each backed by a published literature citation ([see the full list](docs/PRACTICES.md)).

**New here?** Three reads, ~12 minutes total: this README → [vision.md § "What Minsky is"](vision.md#what-minsky-is) → [MILESTONES.md](MILESTONES.md). The full documentation map is at [docs/README.md](docs/README.md) — pick the reading path that matches your audience (newcomer, AI agent, operator, contributor).

**[Seven reasons you'd want this →](#why-minsky)** &nbsp;·&nbsp; Or skip to [getting started](#getting-started).

## Minsky's position

Minsky is an **orchestrator**, not an agent. It sits ABOVE Claude / Devin / Aider — managing the daemon lifecycle, MAPE-K loop, prompt evolution, multi-repo task queue, supervisor restart discipline. The agents are its inputs. Its peers are other orchestrators (MetaGPT, AutoGen, CrewAI, LangGraph), not the agents it composes.

A Minsky operator picks an agent (Claude vs Devin vs Aider) AND gets the orchestrator layer. The scorecard at [novel/competitive-benchmark/README.md](novel/competitive-benchmark/README.md) compares both axes: Minsky should beat other orchestrators on orchestrator metrics AND not regress vs the bare agent.

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

> **M1 progress** (as of 2026-05-22): `node scripts/m1-metrics-dashboard.mjs` reports **39 / 81 measurable M1 tasks passing** (~48%). The headline `v0.2.0` tag was an automatic minor-bump from a `feat:` commit — see [MILESTONES.md § M1](MILESTONES.md#m1--stable-measurable-one-command--v010) for the per-criterion status (✅ done / 🟡 partial / ❌ blocked).

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
| Self-heal common failures | 🟡 Partial (4 / 10) | Phase 1: stale-pid, stale-tsbuildinfo, stuck-command, worktree-missing-node-modules. Phase 2 (≥10 + MTTR <5min): `agents-can-self-heal-minsky-m1-13` |
| Fleet-wide stability reporting | 🟡 Partial | `scripts/fleet-stability-report.mjs` ships rollups; one 7d observation window pending |
| Clean uninstall | 🟡 Partial | `minsky uninstall --force` works end-to-end; bare-command interactive path open in P0 `minsky-uninstall-one-command-with-stop` |
| Switch between Devin, Claude, local models | 🟡 Partial | Claude primary; Devin blocked by `spawn-failed-exit-minus-one-silent-empty-stderr` (P0); local model (aider) dry-run only |
| 8h unattended runs with >90% stability | 🟡 In progress | Currently ~53% loop-uptime proxy; real ratio gated on the Devin spawn fix |
| `minsky report --baseline --delta` for repo improvement | 🟡 Partial | Commands wired; not yet validated end-to-end on a clean 8h fixture run |
| File-based human↔agent Q&A | 🔴 Not yet | P0 `minsky-human-comm-via-file` |
| `npx minsky` one-command install+run | 🔴 Not yet | P1 `minsky-npx-install-and-run` (gated on npm-registry publish) |
| `minsky submit-finding` → Minsky-self submission | 🔴 Not yet | `minsky-remote-task-submission` (M1.8) |
| Competitive benchmark scorecard (M1.10) | ✅ Done | `minsky competitive` writes `.minsky/competitive-scorecard.json` from `@minsky/competitive-benchmark` — 5 shared metrics × 5 published competitors (Devin, Claude Code, OpenHands, Cursor, Aider/SWE-agent on SWE-bench). M1.10 shape gate MET. Weekly auto-refresh of the scorecard via `com.minsky.weekly-competitive` (launchd) / `minsky-weekly-competitive.timer` (systemd). **Corpus is self-refreshing**: a separate weekly fire (`com.minsky.corpus-refresh-check`) runs `check-corpus-freshness.mjs` → `auto-file-corpus-refresh-tasks.mjs` to file `corpus-refresh-<id>` tasks for any reading older than 180 days; the `/competitor-research <url> --refresh` skill clears them. The quarterly `corpus-discover-quarterly` recurring task keeps the COMPETITOR LIST (not just readings) growing as new vendors launch. Live deltas accumulate as Minsky iterates. |
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

## Where to read next

The full documentation map is at **[docs/README.md](docs/README.md)**. It's organised by audience — pick the path that matches who you are.

Quick links by audience:

- **Newcomer** — this README → [vision.md § "What Minsky is"](vision.md#what-minsky-is) → [MILESTONES.md](MILESTONES.md). ~12 minutes total.
- **Installing on your repo** — [INSTALL.md](INSTALL.md). ~8 minutes.
- **AI agent working on this codebase** — [AGENTS.md](AGENTS.md) → [DEPRECATED.md](DEPRECATED.md) → [TASKS.md](TASKS.md).
- **Operator running Minsky in production** — [docs/edge-cases.md](docs/edge-cases.md), [docs/auto-merge.md](docs/auto-merge.md), [docs/local-llm-fallback.md](docs/local-llm-fallback.md).
- **Architecture deep-dive** — [ARCHITECTURE.md](ARCHITECTURE.md), [vision.md § "Pattern conformance index"](vision.md#pattern-conformance-index), [docs/PRACTICES.md](docs/PRACTICES.md).
- **Comparing Minsky to other tools** — [novel/competitive-benchmark/README.md](novel/competitive-benchmark/README.md), [competitors/](competitors/).
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md). Code in this repo is AI-authored.

About the name: Marvin Minsky (1927–2016), cognitive scientist, *The Society of Mind* (1986) — intelligence emerges from many simple specialised agents working together. The tool borrows the metaphor.

## License

MIT. See [LICENSE](LICENSE).
