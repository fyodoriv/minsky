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
- **Constitution = 17 rules, each enforced as a CI lint** — rule #1 (don't reinvent), #9 (hypothesis-driven), #12 (scope discipline), #17 (proactive healing) are the load-bearing ones. `pnpm pre-pr-lint --stage=full` runs 53 deterministic checks; CI runs 65 jobs.
- **Soft-by-default failure modes** — Erlang let-it-crash + launchd / systemd outer supervisor; an iteration that scope-leaks or spawn-fails doesn't halt the loop.
- **Dynamic watchdog** (p95 from history) — `novel/cross-repo-runner/src/dynamic-timeouts.ts` re-derives the watchdog timeout every iteration; same code adapts to any machine.
- **Self-improvement on itself** — the daemon refactors the daemon; most P0s in this repo's `TASKS.md` were surfaced by daemon iterations.

For the **competitive-position view** of the same substrate — the six moats that make Minsky distinctive vs CrewAI / AutoGen / LangGraph / MetaGPT / OpenAI Agents SDK — see [vision.md § "What Minsky uniquely does"](vision.md#what-minsky-uniquely-does-the-moat) and [`competitors/README.md`](competitors/README.md).

## How Minsky compares to other tools

> The honest version. Each column is a real product the operator might pick instead.

Minsky's peers are **orchestrators** (CrewAI, AutoGen, LangGraph, MetaGPT) — not agents (Claude Code, Cursor, Aider) — but operators often compare across tiers, so the table includes both. Per-competitor research files live in [`competitors/`](competitors/).

| Capability | Minsky | [OpenHands][oh] | [CrewAI][crewai] | [Devin][devin] | [Claude Code][cc] / [Aider][aider] |
|---|---|---|---|---|---|
| **Shape** | Daemon (background process) | Framework + runtime (FastAPI + sandbox) | Python framework (`pip install crewai`) | SaaS (Cognition Cloud + Devbox) | CLI tool |
| **Where it runs** | Operator's machine, operator's identity | Local Docker / Cloud SaaS / Enterprise K8s | Developer's Python env / CrewAI AMP K8s | Cognition Cloud (Devbox per task) | Operator's terminal |
| **Credentials** | Reuses `~/.ssh`, `~/.gitconfig`, `~/.config/gh` directly — **zero provisioning** | Operator gives OpenHands a GitHub token (system handles it) | OSS: env vars. AMP: SaaS credential vault | Cognition-provisioned Devbox identity | Operator's terminal session |
| **Coding-specific?** | Yes — TASKS.md → PR is the whole loop | Yes — CodeAct paradigm, autonomous coding | No — general-purpose orchestration; code execution deprecated | Yes — autonomous engineer | Yes — pair programming |
| **24/7 unattended** | Yes — survives terminal close, launchd / systemd KeepAlive | No — request-response (Enterprise Automations are scheduled) | No — stateless per `crew.kickoff()` | Yes — Cognition Cloud sessions | No — interactive |
| **Cross-repo fleet** | Built-in (`--hosts-dir` walks N repos) | Enterprise tier only (Automations) | Partial (Flows can chain Crews, no fleet walker) | One repo per session | One repo at a time |
| **Constitutional rules / deterministic CI** | 17 iron rules + 53 pre-pr-lint stages + 65 CI jobs | LLM-advisory only | Optional guardrails | Cognition-internal policies | None |
| **Self-improvement (MAPE-K)** | Yes — daemon refines its own prompts/policies | No (Index benchmarks models but doesn't auto-tune agents) | No (reasoning agents reflect per-task, not closed-loop) | Unclear (Cognition-internal) | No |
| **Operator queue** | `TASKS.md` (markdown in repo, version-controlled) | Web UI / CLI / Slack-GitHub integrations | Python code (`agents.yaml` + `crew.py`) + AMP UI | Cognition app / Slack | Operator types into terminal |
| **Headline benchmark** | None published yet ([gap filed][gap]) | **65.8% SWE-bench Verified** (Apr 2025) | Not coding-specific — no HumanEval/MBPP/SWE-bench | Disclosed scores in Cognition blog | Aider has its own polyglot leaderboard |
| **Enterprise distribution** | None — single operator today ([gap filed][gap-ent]) | OpenHands Enterprise (Agent Control Plane, May 2026) | CrewAI AMP — **60% of Fortune 500, 2B+ executions** | Devin Enterprise (Cognition Cloud / VPC) | Anthropic / OSS, no dedicated enterprise |
| **Funding signal** | None | $18.8M Series A (Madrona, Nov 2025) | $18M total (Insight Partners, Oct 2024) | $4B valuation (Cognition Labs) | Anthropic-backed / OSS |
| **License** | MIT | MIT (core) + Polyform Free Trial (enterprise dir) | MIT | Proprietary SaaS | Anthropic ToS / Apache-2.0 |

[oh]: competitors/openhands.md
[crewai]: competitors/crewai.md
[devin]: competitors/devin.md
[cc]: competitors/claude-code.md
[aider]: competitors/aider.md
[gap]: TASKS.md
[gap-ent]: TASKS.md

### Where Minsky is uniquely strong

- **Operator-machine identity** — Minsky's commits land as you, with your SSH key, your gitconfig, your GitHub token. No credential provisioning, no SaaS sandbox, no token handoff. Every other orchestrator runs in a separate identity boundary (Devbox, AMP vault, Docker sandbox, fresh clone).
- **Constitution as deterministic CI** — 17 rules enforced as 53 pre-pr-lint stages and 65 CI jobs. Every PR an agent opens is gated by the same lint pipeline a human-authored PR would face. OpenHands / CrewAI / AutoGen / LangGraph rely on LLM-advisory prompts; none enforce policy at the gate level.
- **Self-improving daemon** — Minsky reads its own iteration ledger (`.minsky/experiment-store/`) and tunes its own prompts / policies. The daemon refactors the daemon. Most P0s in this repo were surfaced by daemon iterations on itself.
- **Cross-repo fleet at operator scale** — one Minsky daemon walks N hosts in round-robin (3 iterations per host per pass). OpenHands needs the Enterprise tier; CrewAI Crews are single-context.
- **TASKS.md as operator surface** — work queue is plain markdown in git. No web UI to log into, no Python file to import, no DSL to learn. Operators edit it like any other file; the daemon picks tasks up on the next iteration.

### Where Minsky has real tradeoffs

Honesty matters more than marketing here. Three tradeoffs an operator should weigh:

- **No headline benchmark yet** — OpenHands publishes 65.8% SWE-bench Verified (Apr 2025); MetaGPT publishes 85.9% HumanEval; Augment Code publishes 65.4%. Minsky has no published score. The gap is tracked at [`benchmark-minsky-via-claude-on-humaneval`](TASKS.md) and successor tasks. Until that lands, an operator comparing Minsky-via-Claude to a bare Claude Code baseline can't show a number, only a qualitative narrative. If your buyer asks "show me the number," that's a known gap.
- **Single-operator deployment shape today** — CrewAI ships AMP at Fortune 500 scale (60% Fortune 500). OpenHands ships Enterprise Agent Control Plane (RBAC, audit, OAuth2). Devin ships Cognition Cloud + Devbox + customer VPC. Minsky has one production deployment (the operator's own machine). The gap is tracked at [`enterprise-deployment-readiness-audit`](TASKS.md). If your buyer requires SOC 2 audit logs + RBAC + IdP integration today, Minsky doesn't ship those.
- **Coding-specific by design** — CrewAI works for marketing, research, customer support, analytics. Minsky works for "merge code into a git repo." Tighter focus is the design choice — coding is what makes the constitution enforceable as CI, makes TASKS.md naturally version-controlled, makes the PR-shaped output measurable. But if your use case isn't shipping code, Minsky is the wrong tool. Use CrewAI Flows or AutoGen for generic orchestration; use Minsky for coding.

### What we steal from each

Each competitor's research file ([`competitors/<id>.md`](competitors/)) ends with a *What we learn / steal* section listing concrete ideas. Selected highlights:

- **OpenHands** — pluggable sandbox layer (Docker / Process / Remote); multi-task benchmark suite shape (Index = 5 tasks, not just SWE-bench); bring-your-own-agent framing (operator picks Claude Code / Codex / OpenHands inside one shell — structurally identical to Minsky's per-machine agent config).
- **CrewAI** — hierarchical memory architecture (short-term / long-term / entity / contextual with LLM-analyzed scopes); manager agent / delegation pattern; event-driven Flows as an alternative to procedural cross-repo-runner.
- **Devin** — Cognition's investment in agent observability + replay tooling (Minsky's `.minsky/experiment-store/` is the embryonic version of this).
- **Aider** — git-aware repo editing UX, polyglot leaderboard discipline (publishing a real benchmark on a public leaderboard before claiming the moat).

### One-paragraph summary

If you want a 24/7 daemon that walks your fleet of repos, uses your credentials, enforces 17 deterministic rules, and improves itself from its own iteration ledger — pick Minsky. If you want SWE-bench leadership today + a Docker-isolated sandbox + a web UI to watch the agent think — pick OpenHands. If you want general-purpose multi-agent orchestration for marketing / research / customer support + Fortune 500 deployment substrate — pick CrewAI. If you want a fully managed agent in Cognition's cloud + the highest single-task autonomy bar — pick Devin. If you want a focused CLI pair programmer — pick Claude Code or Aider.

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
