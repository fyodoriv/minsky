# How Minsky compares to other tools — full version

> Last updated 2026-05-23. The README has the 5-row summary; this is the full landscape.

The honest version. Each column is a real product the operator might pick instead.

Status of Minsky capabilities below: ✅ shipping today · 🟡 partial / in progress · 🔴 planned. M1 progress (2026-05-22): 39 / 81 measurable M1 tasks passing; see [MILESTONES.md § M1](../MILESTONES.md#m1--stable-measurable-one-command--v010) for the per-criterion view.

## Full capability table (15 rows × 5 competitors)

| Capability | Minsky | [OpenHands][oh] | [CrewAI][crewai] | [Devin][devin] | [Claude Code][cc] / [Aider][aider] |
|---|---|---|---|---|---|
| **Shape** | ✅ Daemon (background process) | Framework + runtime | Python framework (`pip install crewai`) | SaaS (Cognition Cloud + Devbox) | CLI tool |
| **Where it runs** | ✅ Operator's machine, operator's identity | Local Docker / Cloud / Enterprise K8s | Dev Python env / CrewAI AMP K8s | Cognition Cloud (Devbox per task) | Operator's terminal |
| **Credentials** | ✅ Reuses `~/.ssh`, `~/.gitconfig`, `~/.config/gh` directly — **zero provisioning** | Operator gives OpenHands a GitHub token | OSS: env vars. AMP: SaaS credential vault | Cognition-provisioned Devbox identity | Operator's terminal session |
| **Coding-specific?** | ✅ Yes — TASKS.md → PR is the whole loop | ✅ Yes — CodeAct paradigm | ❌ General-purpose; code execution deprecated | ✅ Yes — autonomous engineer | ✅ Yes — pair programming |
| **24/7 unattended** | ✅ Survives terminal close + reboots | ❌ Request-response (Enterprise: scheduled) | ❌ Stateless per `crew.kickoff()` | ✅ Cognition Cloud sessions | ❌ Interactive |
| **Cross-repo fleet** | ✅ Built-in (`--hosts-dir`) | 🟡 Enterprise tier only | 🟡 Partial (Flows chain Crews) | ❌ One repo per session | ❌ One repo at a time |
| **Constitutional rules / CI** | ✅ 18 iron rules + 53 lint stages + 65 CI jobs | ❌ LLM-advisory only | 🟡 Optional guardrails | 🟡 Cognition-internal policies | ❌ None |
| **Self-improvement (MAPE-K)** | 🟡 Substrate ships today (experiment-store + spec monitor + observer); closed-loop prompt tuning is spec-only ([user-story-003](../user-stories/003-mape-k-improves-prompts.md) status: Specification) | ❌ Static once shipped | ❌ One-shot reasoning per task | 🟡 Cognition-internal | ❌ None |
| **Operator queue** | ✅ `TASKS.md` (markdown in repo) | Web UI / CLI / integrations | Python code + AMP UI | Cognition app / Slack | Operator types into terminal |
| **Live dashboard** | ✅ `minsky watch` (stability, iterations, human-help) | ✅ Web UI | 🟡 AMP UI (paid) | ✅ Cognition app | ❌ |
| **Backend choice (Claude / Devin / local)** | 🟡 Claude primary; Devin blocked on spawn-exit issue; local (aider) dry-run only; OpenHands planned (approved 2026-05-22, blocked on OpenHands Agent Canvas CLI 2026-06-01) | ✅ 15+ LLMs via OpenAI-compatible APIs | ✅ LiteLLM | ❌ Devin-only | ✅ N/A (is the backend) |
| **Headline benchmark** | 🔴 None published yet ([gap filed](../TASKS.md)) | ✅ **65.8% SWE-bench Verified** (Apr 2025) | ❌ No coding benchmark | ✅ Scores in Cognition blog | ✅ Aider polyglot leaderboard |
| **Enterprise distribution** | 🔴 None ([gap filed](../TASKS.md)) | ✅ Agent Control Plane (May 2026) | ✅ AMP — **60% Fortune 500, 2B+ executions** | ✅ Devin Enterprise (Cognition Cloud / VPC) | ❌ No dedicated enterprise |
| **Funding signal** | None | $18.8M Series A (Madrona, Nov 2025) | $18M total (Insight Partners, Oct 2024) | $4B valuation | Anthropic-backed / OSS |
| **License** | MIT | MIT (core) + Polyform (enterprise) | MIT | Proprietary SaaS | Anthropic ToS / Apache-2.0 |

[oh]: ../competitors/openhands.md
[crewai]: ../competitors/crewai.md
[devin]: ../competitors/devin.md
[cc]: ../competitors/claude-code.md
[aider]: ../competitors/aider.md

## Where Minsky is uniquely strong

- **Operator-machine identity** — Minsky's commits land as you, with your SSH key, your gitconfig, your GitHub token. No credential provisioning, no SaaS sandbox, no token handoff. Every other orchestrator runs in a separate identity boundary (Devbox, AMP vault, Docker sandbox, fresh clone).
- **Constitution as deterministic CI** — 18 rules enforced as 53 pre-pr-lint stages and 65 CI jobs. Every PR an agent opens is gated by the same lint pipeline a human-authored PR would face. OpenHands / CrewAI / AutoGen / LangGraph / OpenAI Agents SDK rely on LLM-advisory prompts (LangGraph + OpenAI Agents SDK ship per-execution guardrails but not PR-level policy enforcement); none enforce policy at the gate level.
- **Self-improving substrate** — Minsky reads its own iteration ledger (`.minsky/experiment-store/`) and surfaces tasks against its own weak spots; the daemon refactors the daemon (most P0s in this repo were surfaced by daemon iterations on itself). Note: **closed-loop MAPE-K prompt tuning is in specification phase** ([user-story-003](../user-stories/003-mape-k-improves-prompts.md)); what ships today is the substrate (experiment-store + observer + spec monitor + task-filing audit), not the auto-tuning A/B test.
- **Cross-repo fleet at operator scale** — one Minsky daemon walks N hosts in round-robin (3 iterations per host per pass). OpenHands needs the Enterprise tier; CrewAI Crews are single-context.
- **TASKS.md as operator surface** — work queue is plain markdown in git. No web UI to log into, no Python file to import, no DSL to learn. Operators edit it like any other file; the daemon picks tasks up on the next iteration.

## Where Minsky has real tradeoffs

- **No headline benchmark yet** — OpenHands publishes 65.8% SWE-bench Verified; MetaGPT publishes 85.9% HumanEval; Augment Code publishes 65.4%. Minsky has no published score. Gap tracked at [`benchmark-minsky-via-claude-on-humaneval`](../TASKS.md). If your buyer asks "show me the number," that's a known gap.
- **Single-operator deployment shape today** — CrewAI ships AMP at Fortune 500 scale. OpenHands ships Enterprise Agent Control Plane. Devin ships Cognition Cloud + Devbox + customer VPC. Minsky has one production deployment (the operator's own machine). Gap tracked at [`enterprise-deployment-readiness-audit`](../TASKS.md). If you need SOC 2 audit logs + RBAC + IdP integration today, Minsky doesn't ship those.
- **Coding-specific by design** — CrewAI works for marketing, research, customer support, analytics. Minsky works for "merge code into a git repo." Tighter focus is the design choice — coding is what makes the constitution enforceable as CI, makes TASKS.md naturally version-controlled, makes the PR-shaped output measurable. But if your use case isn't shipping code, Minsky is the wrong tool.

## What we steal from each

- **OpenHands** — pluggable sandbox layer (Docker / Process / Remote); multi-task benchmark suite shape (Index = 5 tasks, not just SWE-bench); bring-your-own-agent framing.
- **CrewAI** — hierarchical memory architecture; manager agent / delegation pattern; event-driven Flows as an alternative to procedural cross-repo-runner.
- **Devin** — agent observability + replay tooling (Minsky's `.minsky/experiment-store/` is the embryonic version of this).
- **Aider** — git-aware repo editing UX; polyglot leaderboard discipline.

## One-paragraph summary

If you want a 24/7 daemon that walks your fleet of repos, uses your credentials, enforces 18 deterministic rules, and improves itself from its own iteration ledger — pick Minsky. If you want SWE-bench leadership today + a Docker-isolated sandbox + a web UI to watch the agent think — pick OpenHands. If you want general-purpose multi-agent orchestration + Fortune 500 deployment substrate — pick CrewAI. If you want a fully managed agent in Cognition's cloud + the highest single-task autonomy bar — pick Devin. If you want a focused CLI pair programmer — pick Claude Code or Aider.
