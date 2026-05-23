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

Full install runbook: [INSTALL.md](./INSTALL.md). Uninstall: [docs/uninstall.md](docs/uninstall.md).

## Why Minsky

- **Continuous, unattended improvement** — picks tasks, ships draft pull requests, never merges without you. ([details →](user-stories/001-loop-runs-overnight.md))
- **Finds new work for you to approve** *(can be turned off)* — after each fix, it audits the repo and proposes new tasks for your review. ([details →](user-stories/007-cto-audit-files-new-tasks.md))
- **Right model for each task** — Claude for prose, Devin for refactors, a local model for mechanical fixes (so cheap work stays cheap). ([details →](user-stories/008-per-task-backend-and-personas.md))
- **Refuses to reinvent the wheel** — every pull request has to cite the libraries it considered; if it skips the search, the build fails. ([details →](user-stories/009-forced-research-rule-1.md))
- **A tool that improves itself** — reads its own metrics, files tasks against its own weak spots, ships the fixes. ([details →](user-stories/003-mape-k-improves-prompts.md))
- **Keeps going when the cloud runs dry** — if your cloud-AI quota runs out, it falls back to a local model so the loop doesn't stall. ([details →](user-stories/004-budget-auto-pause.md))
- **Async Q&A across timezones** *(coming)* — agents leave questions in a file; you answer when you wake up. ([details →](user-stories/010-async-human-qa-via-file.md))

One-line how-it-works: Minsky reads your `TASKS.md`, picks the highest-priority task, spawns Devin/Claude/Aider on a feature branch, opens a draft PR with self-graded metrics, records the iteration, loops. Full architecture + 7-step flow at [docs/README-v1-detailed.md § How it works](docs/README-v1-detailed.md#how-it-works).

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
| **Self-improvement (MAPE-K)** | 🟡 Substrate ships today (experiment-store + spec monitor + observer); closed-loop prompt tuning is spec-only ([user-story-003](user-stories/003-mape-k-improves-prompts.md) status: Specification) | ❌ Static once shipped | ❌ One-shot reasoning per task | 🟡 Cognition-internal | ❌ None |
| **Operator queue** | ✅ `TASKS.md` (markdown in repo) | Web UI / CLI / integrations | Python code + AMP UI | Cognition app / Slack | Operator types into terminal |
| **Live dashboard** | ✅ `minsky watch` (stability, iterations, human-help) | ✅ Web UI | 🟡 AMP UI (paid) | ✅ Cognition app | ❌ |
| **Backend choice (Claude / Devin / local)** | 🟡 Claude primary; Devin blocked on spawn-exit issue; local (aider) dry-run only; OpenHands planned (approved 2026-05-22, blocked on OpenHands Agent Canvas CLI 2026-06-01) | ✅ 15+ LLMs via OpenAI-compatible APIs | ✅ LiteLLM | ❌ Devin-only | ✅ N/A (is the backend) |
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
- **Constitution as deterministic CI** — 18 rules enforced as 53 pre-pr-lint stages and 65 CI jobs. Every PR an agent opens is gated by the same lint pipeline a human-authored PR would face. OpenHands / CrewAI / AutoGen / LangGraph / OpenAI Agents SDK rely on LLM-advisory prompts (LangGraph + OpenAI Agents SDK ship per-execution guardrails but not PR-level policy enforcement); none enforce policy at the gate level.
- **Self-improving substrate** — Minsky reads its own iteration ledger (`.minsky/experiment-store/`) and surfaces tasks against its own weak spots; the daemon refactors the daemon (most P0s in this repo were surfaced by daemon iterations on itself). Note: **closed-loop MAPE-K prompt tuning is in specification phase** ([user-story-003](user-stories/003-mape-k-improves-prompts.md)); what ships today is the substrate (experiment-store + observer + spec monitor + task-filing audit), not the auto-tuning A/B test.
- **Cross-repo fleet at operator scale** — one Minsky daemon walks N hosts in round-robin (3 iterations per host per pass). OpenHands needs the Enterprise tier; CrewAI Crews are single-context.
- **TASKS.md as operator surface** — work queue is plain markdown in git. No web UI to log into, no Python file to import, no DSL to learn. Operators edit it like any other file; the daemon picks tasks up on the next iteration.

### Where Minsky has real tradeoffs

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

## License

MIT — see [LICENSE](LICENSE). Where to read next: [docs/README.md](docs/README.md) (full audience-segmented map) · [INSTALL.md](./INSTALL.md) · [AGENTS.md](AGENTS.md) · [vision.md](vision.md) · [TASKS.md](TASKS.md). Positioning vs other orchestrators + name-disambiguation: [docs/README-v1-detailed.md § Minsky's position in the landscape](docs/README-v1-detailed.md#minskys-position-in-the-landscape). About the name: Marvin Minsky (1927–2016), *The Society of Mind* (1986) — intelligence emerges from many simple specialised agents working together.
