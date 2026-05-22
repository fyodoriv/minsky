# Minsky

> A background daemon that runs AI coding agents against tasks in any git repo.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

Minsky attaches to a git repo and improves it over time, using established software-engineering practices. It picks the next thing to fix, makes the fix on a feature branch, runs your tests, and opens a draft pull request for you to review. Then it picks the next thing — by default it runs until you stop it.

## Getting started

**Through your AI agent.** Copy-paste:

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

**Manual:**

```bash
git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install && ./bin/minsky
```

Full install runbook: [INSTALL.md](INSTALL.md). Uninstall: [docs/uninstall.md](docs/uninstall.md).

## Why Minsky

Seven things you get with Minsky running on a repo. Each links to the dedicated page with the full story (what the feature delivers, how it's measured, and how it's tested under stress).

- **Continuous, unattended improvement** — picks tasks, ships draft pull requests, never merges without you. ([details →](user-stories/001-loop-runs-overnight.md))
- **Finds new work for you to approve** *(can be turned off)* — after each fix, it audits the repo and proposes new tasks for your review. ([details →](user-stories/007-cto-audit-files-new-tasks.md))
- **Right model for each task** — Claude for prose, Devin for refactors, a local model for mechanical fixes (so cheap work stays cheap). ([details →](user-stories/008-per-task-backend-and-personas.md))
- **Refuses to reinvent the wheel** — every pull request has to cite the libraries it considered; if it skips the search, the build fails. ([details →](user-stories/009-forced-research-rule-1.md))
- **A tool that improves itself** — reads its own metrics, files tasks against its own weak spots, ships the fixes. ([details →](user-stories/003-mape-k-improves-prompts.md))
- **Keeps going when the cloud runs dry** — if your cloud-AI quota runs out, it falls back to a local model so the loop doesn't stall. ([details →](user-stories/004-budget-auto-pause.md))
- **Async Q&A across timezones** *(coming)* — agents leave questions in a file; you answer when you wake up. ([details →](user-stories/010-async-human-qa-via-file.md))

## How it works

1. Reads `TASKS.md` from your host repo (the [tasks.md spec](https://github.com/tasksmd/tasks.md))
2. Picks the highest-priority task that's ready to work on
3. Spawns Devin, Claude, or a local AI model (configurable per machine)
4. The agent implements the task on a feature branch and runs your tests
5. Opens a draft pull request — with a self-graded report on whether the change moved the metric it predicted
6. Records the iteration in `.minsky/experiment-store/` (so the next run can learn from it)
7. Picks the next task. Repeats.

> **What's a "host"?** A host is a single git repo that Minsky operates on. Selected via `default_host` in `~/.minsky/config.json`, the `--host <path>` flag, or the current working directory. Multi-host mode (`--hosts-dir <parent>`) walks every git repo under one parent directory in round-robin (3 iterations per host per pass).

### Architecture (30 seconds)

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

- **Multi-layer team of workers** — per-task backend selection (`novel/tick-loop/src/llm-provider-spawn-strategy.ts`); multi-persona pipelines per task are an M2 milestone.
- **MAPE-K control loop** (Kephart & Chess 2003, IBM autonomic computing) — Monitor / Analyze / Plan / Execute over `.minsky/experiment-store/` knowledge.
- **Constitution = 17 rules, each enforced as a CI lint** — rules #1 (don't reinvent), #9 (hypothesis-driven), #12 (scope discipline), #17 (proactive healing) are the load-bearing ones. `pnpm pre-pr-lint --stage=full` runs 53 deterministic checks; CI runs 65 jobs.
- **Soft-by-default failure modes** — Erlang let-it-crash + launchd / systemd outer supervisor; an iteration that scope-leaks or spawn-fails doesn't halt the loop.
- **Dynamic watchdog** (p95 from history) — `novel/cross-repo-runner/src/dynamic-timeouts.ts` re-derives the watchdog timeout every iteration.
- **Self-improvement on itself** — the daemon refactors the daemon; most P0s in this repo's [TASKS.md](TASKS.md) were surfaced by daemon iterations.

Deeper dive: [ARCHITECTURE.md](ARCHITECTURE.md), [vision.md § "Pattern conformance index"](vision.md#pattern-conformance-index), [docs/PRACTICES.md](docs/PRACTICES.md).

## Safety

Hard rules — mechanically blocked, not "tries not to":

- **Every PR is a draft** until you mark it ready. No agent can merge.
- **No direct pushes to `main`** — every change goes through a feature branch and a PR you review.
- **Security-sensitive changes** — flagged human-blocked, always.
- **Destructive operations** (force push, branch delete, deploy) — hard-blocked at the daemon level.
- **Architecture decisions** — Minsky files a research task for you rather than guessing.
- **Stay-in-your-lane check** — every iteration runs a scope-leak detector + secret scanner + security review across 15 automatic gates before the PR can open.

## How Minsky compares to other tools

> The honest version. Each column is a real product the operator might pick instead.

Status of Minsky capabilities below: ✅ shipping today · 🟡 partial / in progress · 🔴 planned. M1 progress (2026-05-22): 39 / 81 measurable M1 tasks passing; see [MILESTONES.md § M1](MILESTONES.md#m1--stable-measurable-one-command--v010) for the per-criterion view.

| Capability | Minsky | [OpenHands][oh] | [CrewAI][crewai] | [Devin][devin] | [Claude Code][cc] / [Aider][aider] |
|---|---|---|---|---|---|
| **Shape** | ✅ Daemon (background process) | Framework + runtime | Python framework (`pip install crewai`) | SaaS (Cognition Cloud + Devbox) | CLI tool |
| **Where it runs** | ✅ Operator's machine, operator's identity | Local Docker / Cloud / Enterprise K8s | Dev Python env / CrewAI AMP K8s | Cognition Cloud (Devbox per task) | Operator's terminal |
| **Credentials** | ✅ Reuses `~/.ssh`, `~/.gitconfig`, `~/.config/gh` directly — **zero provisioning** | Operator gives OpenHands a GitHub token | OSS: env vars. AMP: SaaS credential vault | Cognition-provisioned Devbox identity | Operator's terminal session |
| **Coding-specific?** | ✅ Yes — TASKS.md → PR is the whole loop | ✅ Yes — CodeAct paradigm | ❌ General-purpose; code execution deprecated | ✅ Yes — autonomous engineer | ✅ Yes — pair programming |
| **24/7 unattended** | ✅ Survives terminal close + reboots | ❌ Request-response (Enterprise: scheduled) | ❌ Stateless per `crew.kickoff()` | ✅ Cognition Cloud sessions | ❌ Interactive |
| **Cross-repo fleet** | ✅ Built-in (`--hosts-dir`) | 🟡 Enterprise tier only | 🟡 Partial (Flows chain Crews) | ❌ One repo per session | ❌ One repo at a time |
| **Constitutional rules / CI** | ✅ 17 iron rules + 53 lint stages + 65 CI jobs | ❌ LLM-advisory only | 🟡 Optional guardrails | 🟡 Cognition-internal policies | ❌ None |
| **Self-improvement (MAPE-K)** | ✅ Daemon refines its own prompts/policies | ❌ Static once shipped | ❌ One-shot reasoning per task | 🟡 Cognition-internal | ❌ None |
| **Operator queue** | ✅ `TASKS.md` (markdown in repo) | Web UI / CLI / integrations | Python code + AMP UI | Cognition app / Slack | Operator types into terminal |
| **Live dashboard** | ✅ `minsky watch` (stability, iterations, human-help) | ✅ Web UI | 🟡 AMP UI (paid) | ✅ Cognition app | ❌ |
| **Backend choice (Claude / Devin / local)** | 🟡 Claude primary; Devin blocked on spawn-exit issue; local (aider) dry-run only | ✅ 15+ LLMs via OpenAI-compatible APIs | ✅ LiteLLM | ❌ Devin-only | ✅ N/A (is the backend) |
| **Headline benchmark** | 🔴 None published yet ([gap filed](TASKS.md)) | ✅ **65.8% SWE-bench Verified** (Apr 2025) | ❌ No coding benchmark | ✅ Scores in Cognition blog | ✅ Aider polyglot leaderboard |
| **Enterprise distribution** | 🔴 None ([gap filed](TASKS.md)) | ✅ Agent Control Plane (May 2026) | ✅ AMP — **60% Fortune 500, 2B+ executions** | ✅ Devin Enterprise (Cognition Cloud / VPC) | ❌ No dedicated enterprise |
| **Funding signal** | None | $18.8M Series A (Madrona, Nov 2025) | $18M total (Insight Partners, Oct 2024) | $4B valuation | Anthropic-backed / OSS |
| **License** | MIT | MIT (core) + Polyform (enterprise) | MIT | Proprietary SaaS | Anthropic ToS / Apache-2.0 |

[oh]: competitors/openhands.md
[crewai]: competitors/crewai.md
[devin]: competitors/devin.md
[cc]: competitors/claude-code.md
[aider]: competitors/aider.md

### Where Minsky is uniquely strong

- **Operator-machine identity** — Minsky's commits land as you, with your SSH key, your gitconfig, your GitHub token. No credential provisioning, no SaaS sandbox, no token handoff. Every other orchestrator runs in a separate identity boundary (Devbox, AMP vault, Docker sandbox, fresh clone).
- **Constitution as deterministic CI** — 17 rules enforced as 53 pre-pr-lint stages and 65 CI jobs. Every PR an agent opens is gated by the same lint pipeline a human-authored PR would face. OpenHands / CrewAI / AutoGen / LangGraph rely on LLM-advisory prompts; none enforce policy at the gate level.
- **Self-improving daemon** — Minsky reads its own iteration ledger (`.minsky/experiment-store/`) and tunes its own prompts / policies. The daemon refactors the daemon. Most P0s in this repo were surfaced by daemon iterations on itself.
- **Cross-repo fleet at operator scale** — one Minsky daemon walks N hosts in round-robin (3 iterations per host per pass). OpenHands needs the Enterprise tier; CrewAI Crews are single-context.
- **TASKS.md as operator surface** — work queue is plain markdown in git. No web UI to log into, no Python file to import, no DSL to learn. Operators edit it like any other file; the daemon picks tasks up on the next iteration.

### Where Minsky has real tradeoffs

Three tradeoffs an operator should weigh before picking Minsky:

- **No headline benchmark yet** — OpenHands publishes 65.8% SWE-bench Verified; MetaGPT publishes 85.9% HumanEval; Augment Code publishes 65.4%. Minsky has no published score. Gap tracked at [`benchmark-minsky-via-claude-on-humaneval`](TASKS.md). If your buyer asks "show me the number," that's a known gap.
- **Single-operator deployment shape today** — CrewAI ships AMP at Fortune 500 scale. OpenHands ships Enterprise Agent Control Plane. Devin ships Cognition Cloud + Devbox + customer VPC. Minsky has one production deployment (the operator's own machine). Gap tracked at [`enterprise-deployment-readiness-audit`](TASKS.md). If you need SOC 2 audit logs + RBAC + IdP integration today, Minsky doesn't ship those.
- **Coding-specific by design** — CrewAI works for marketing, research, customer support, analytics. Minsky works for "merge code into a git repo." Tighter focus is the design choice — coding is what makes the constitution enforceable as CI, makes TASKS.md naturally version-controlled, makes the PR-shaped output measurable. But if your use case isn't shipping code, Minsky is the wrong tool.

### What we steal from each

- **OpenHands** — pluggable sandbox layer (Docker / Process / Remote); multi-task benchmark suite shape (Index = 5 tasks, not just SWE-bench); bring-your-own-agent framing.
- **CrewAI** — hierarchical memory architecture; manager agent / delegation pattern; event-driven Flows as an alternative to procedural cross-repo-runner.
- **Devin** — agent observability + replay tooling (Minsky's `.minsky/experiment-store/` is the embryonic version of this).
- **Aider** — git-aware repo editing UX; polyglot leaderboard discipline.

### One-paragraph summary

If you want a 24/7 daemon that walks your fleet of repos, uses your credentials, enforces 17 deterministic rules, and improves itself from its own iteration ledger — pick Minsky. If you want SWE-bench leadership today + a Docker-isolated sandbox + a web UI to watch the agent think — pick OpenHands. If you want general-purpose multi-agent orchestration + Fortune 500 deployment substrate — pick CrewAI. If you want a fully managed agent in Cognition's cloud + the highest single-task autonomy bar — pick Devin. If you want a focused CLI pair programmer — pick Claude Code or Aider.

## Minsky's position in the landscape

Minsky is an **orchestrator**, not an agent. It sits ABOVE Claude / Devin / Aider — managing the daemon lifecycle, the MAPE-K loop, prompt evolution, the multi-repo task queue, supervisor restart discipline. The agents are its inputs. Its peers are other orchestrators (MetaGPT, AutoGen, CrewAI, LangGraph), not the agents it composes.

A Minsky operator picks an agent (Claude vs Devin vs Aider) AND gets the orchestrator layer. The scorecard at [novel/competitive-benchmark/README.md](novel/competitive-benchmark/README.md) compares both axes: Minsky should beat other orchestrators on orchestrator metrics AND not regress vs the bare agent. For the moat view of the same substrate, see [vision.md § "What Minsky uniquely does"](vision.md#what-minsky-uniquely-does-the-moat) and [`competitors/README.md`](competitors/README.md).

## Where to read next

The full documentation map is at **[docs/README.md](docs/README.md)**. Pick the path that matches who you are:

- **Newcomer** — [vision.md § "What Minsky is"](vision.md#what-minsky-is) → [MILESTONES.md](MILESTONES.md).
- **Installing on your repo** — [INSTALL.md](INSTALL.md).
- **AI agent working on this codebase** — [AGENTS.md](AGENTS.md) → [DEPRECATED.md](DEPRECATED.md) → [TASKS.md](TASKS.md).
- **Operator running Minsky in production** — [docs/edge-cases.md](docs/edge-cases.md), [docs/auto-merge.md](docs/auto-merge.md), [docs/local-llm-fallback.md](docs/local-llm-fallback.md).
- **Architecture deep-dive** — [ARCHITECTURE.md](ARCHITECTURE.md), [vision.md § "Pattern conformance index"](vision.md#pattern-conformance-index), [docs/PRACTICES.md](docs/PRACTICES.md).
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md). Code in this repo is AI-authored.

About the name: Marvin Minsky (1927–2016), cognitive scientist, *The Society of Mind* (1986) — intelligence emerges from many simple specialised agents working together. The tool borrows the metaphor.

## License

MIT. See [LICENSE](LICENSE).
