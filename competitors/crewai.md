# Competitor: CrewAI

> The dominant general-purpose multi-agent orchestration framework — Minsky's largest orchestrator-tier peer by adoption (60% Fortune 500, 2B+ executions). Adjacent rather than head-to-head: CrewAI is general-purpose, Minsky is coding-specific.

- **URL**: <https://crewai.com> / <https://github.com/crewAIInc/crewAI>
- **Status**: Active OSS v1.0 GA (2025); CrewAI AMP enterprise platform; $18M total funding (Series A $12.5M Insight Partners, Oct 2024); 48k GitHub stars.
- **Relationship**: **Competitor — orchestrator-tier peer**. General-purpose multi-agent orchestration vs Minsky's coding-specific daemon.

## What it is

Open-source **Python framework** (not a daemon) for orchestrating role-playing autonomous AI agents — built from scratch, independent of LangChain (per `lib/crewai/src/crewai/`). Three primary layers:

- **Agents** (`lib/crewai/src/crewai/agent/core.py`) — stateful Pydantic objects defined by role / goal / backstory, with optional LLM, tools, memory. The agent executor handles tool invocation, error recovery, streaming.
- **Crews** (`lib/crewai/src/crewai/crew.py`) — composition of agents and tasks. `Crew.kickoff(inputs)` runs the orchestration; supports sequential (default), hierarchical (with manager agent), or custom processes. State flows between tasks via a shared `ExecutionContext`. Each `kickoff()` is a fresh run — agents do NOT maintain state between crew executions.
- **Flows** (`lib/crewai/src/crewai/flow/flow.py`) — event-driven state machines positioned as the **production architecture** (CrewAI README, 2025). Use `@start` / `@listen` / `@router` decorators to define steps, with explicit Pydantic state. Flows can embed Crews as units of work. Persistence via SQLite by default; AMP replaces with distributed stores.

**Memory** is the substrate, not message-passing. The unified memory system (`lib/crewai/src/crewai/memory/unified_memory.py`) is hierarchical (scopes like `/project/alpha` or `/agent/researcher/findings`), LLM-analyzed for automatic scope inference, supports adaptive-depth recall with semantic + recency + importance scoring.

## Strengths

- **Mature role-play orchestration** — the canonical "role / goal / backstory → task → crew" pattern, proven at Fortune 500 scale.
- **Memory architecture** — short-term / long-term / entity / contextual memory; LLM-analyzed hierarchical scopes; agentic RAG built in (query rewriting, knowledge sources).
- **Manager agent pattern** (`docs.crewai.com/en/learn/hierarchical-process`) — automatic or custom managers for delegation + validation. Well-tested in production (PwC, DocuSign).
- **Flows for deterministic orchestration** — event-driven state machines complement autonomous Crews. The combination is the "production pattern" CrewAI evangelizes.
- **Hundreds of open-source tools** (`crewai-tools` now in the main repo) — file management, web scraping, vector DBs, API integrations, DALL-E, Vision, Stagehand.
- **Reasoning agents** — agents reflect on task objectives, refine plans, inject plans into descriptions before executing.
- **CrewAI AMP (Agent Management Platform)** — Kubernetes-native enterprise control plane: RBAC, audit logging, OAuth2 (Auth0 / Entra ID / Okta / Keycloak / WorkOS), A2A (Agent-to-Agent) protocol, triggers (Gmail / Drive / Outlook / Teams / OneDrive / HubSpot), integrations.
- **Massive adoption** — 48k stars, 290 contributors, 2.6M weekly PyPI downloads, 100k+ certified developers via `learn.crewai.com`, **2 billion cumulative agentic executions (Jan 2026, 450M+/month)**, **60% of Fortune 500** (per CrewAI OSS 1.0 GA post).

## Weaknesses vs Minsky's vision

1. **Python framework, not a daemon** — `pip install crewai`; you import `crewai`, define Agent + Task + Crew classes, call `crew.kickoff()`. Stateless per execution; no background daemon surviving terminal close.
2. **Not coding-specific** — general-purpose orchestration. **Code execution is deprecated** (`CodeInterpreterTool` removed in favor of E2B / Modal sandboxes). GitHub integration is AMP-only and limited to issue/release actions; no native `git clone` / `commit` / PR creation / diff analysis. The PwC case study (10%→70% code generation accuracy) required custom tools + human-in-the-loop, not out-of-the-box coding.
3. **No constitutional rules or deterministic CI enforcement** — guardrails are optional (`docs.crewai.com/en/learn/guardrails`); no iron-rule constitution, no pre-execution linting layer. AMP adds audit logging but it's observational, not gate-shaped.
4. **No MAPE-K self-improvement loop** — "reasoning agents" reflect on plans, but it's one-shot per task. No closed-loop where execution outcomes auto-tune prompts/policies. Static once shipped.
5. **Cross-repo: partial** — Flows can orchestrate multiple Crews, but each Crew is scoped to one execution context. No native cross-repo parallelism, no fleet-aware walker.
6. **Operator surface is Python + web UI (AMP)** — Crews are code (`agents.yaml`, `tasks.yaml`, `crew.py`). Operators trigger runs via AMP web UI, CLI, or external triggers. No version-controlled markdown queue.
7. **Credential model differs** — OSS reads operator env vars (`.env` files); AMP uses a centralized vault (OAuth2). Neither matches Minsky's "use the operator's `~/.gitconfig` + `~/.ssh` + `~/.config/gh` directly with no credential provisioning."

## Production architecture

- **OSS** (`pip install crewai`) — runs on developer machine or any Python environment. In-process or async/await execution. No built-in security boundary; credentials in operator env / `.env`.
- **CrewAI AMP** (Agent Management Platform) — Kubernetes-native SaaS, deployable via Helm (`enterprise-docs.crewai.com/installation/installation`). Requires PostgreSQL 16.8+, S3-compatible storage, container registry. Builds crew automation images inside the cluster + pushes to registry. Multi-tenant with RBAC + OAuth2 + audit logging. Credentials in centralized vault, referenced by name.
- **State persistence** — Flows use SQLite by default (`lib/crewai/src/crewai/flow/persistence/sqlite.py`). AMP replaces with distributed Task Store (A2A state) + Context Store (conversation context) + Wharf DB (OpenTelemetry traces).

## Coding-task fit

CrewAI is **not coding-specific**. Indicators:

- Code execution tool is deprecated (`CodeInterpreterTool` removed; use E2B or Modal sandboxes).
- GitHub integration (AMP-only) is API-level (`create_issue`, `update_issue`, `create_release`) — no `git clone`, `commit`, PR creation, or diff analysis.
- Community template `template_pull_request_review` (github.com/crewAIInc/template_pull_request_review) uses two agents to analyze PR diffs and post comments — but it's a community template, not a built-in.
- The PwC case study (10%→70% proprietary-language code generation accuracy, `crewai.com/case-studies/pwc-accelerates-enterprise-scale-genai-adoption-with-crewai`) **measures CrewAI's ability to orchestrate agents that generate code, not CrewAI's own coding capability**. Required custom tools + human-in-the-loop.

vs **OpenHands** (Docker sandbox + CodeAct, designed for autonomous coding) and **Aider** (git-aware repo editing for pair-programming), CrewAI is general-purpose orchestration. Coding is a use case, not the primary design.

## Recent benchmarks (since 2025)

| Benchmark                            | Value                              | Date     | Source                                                                                                                                          | Vendor-primary? |
| ------------------------------------ | ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Cumulative agentic executions        | **2 billion** (450M+/month)        | Jan 2026 | crewai.com/blog/lessons-from-2-billion-agentic-workflows                                                                                       | ✅ Vendor       |
| OSS 1.0 launch executions            | 1.4 billion                        | ~2025    | crewai.com/blog/crewai-oss-1-0---we-are-going-ga                                                                                              | ✅ Vendor       |
| PwC code generation accuracy         | 10% → 70%                          | 2026     | crewai.com/case-studies/pwc-accelerates-enterprise-scale-genai-adoption-with-crewai                                                            | ✅ Customer case study |
| Multi-agent latency (research task)  | 18.4s median                       | Apr 2026 | agent-harness.ai/blog/multi-agent-orchestration-frameworks-benchmark — vs LangGraph + AutoGen                                                  | ❌ Third-party  |
| Multi-agent cost (research task)     | $48.20 per 1k tasks                | Apr 2026 | agent-harness.ai (same source)                                                                                                                  | ❌ Third-party  |
| AgentGovBench governance score       | 13/48 (OSS) → 40/48 (with ACP)     | 2026     | agenticcontrolplane.com/blog/crewai-governance-scorecard                                                                                       | ❌ Third-party  |
| **HumanEval / MBPP / SWE-bench**     | **NOT FOUND**                      | —        | —                                                                                                                                              | —               |

**Key finding**: CrewAI has **not** published vendor-primary HumanEval, MBPP, or SWE-bench scores. This keeps the `corpus-add-crewai` task in TASKS.md blocked (Minsky's competitor-research validator rejects fabricated readings per rule #4). The framework is orchestrator-tier general-purpose, not coding-specific — orthogonal to coding benchmarks rather than measurable against them.

## Adoption signals

- GitHub stars: **48,137** (May 2026); forks **6,559**; contributors **290**; weekly PyPI downloads **2.65M**.
- Cumulative executions: **2 billion** (Jan 2026, 450M+/month). 60% of Fortune 500. 100k+ certified developers.
- Funding: **$18M total** — Series A $12.5M led by Insight Partners (Oct 2024); also boldstart, Craft Ventures, Earl Grey Capital, Andrew Ng, Dharmesh Shah (HubSpot co-founder). Valuation ~$100M (TechCrunch, Oct 2024).
- Customer logos (per `blog.crewai.com/lessons-from-2-billion-agentic-workflows/`): IBM, Microsoft, Procter & Gamble, Walmart, SAP, Adobe, PayPal, PwC, PepsiCo, Johnson & Johnson, US DoD, DocuSign, AB InBev, BDO, NTT Data, Experian.
- Press: CrewAI OSS v1.0 GA (2025); Series A (Oct 2024); NVIDIA NemoClaw partnership (Mar 2026); PwC case study (2026).

## Roadmap (next 6-12 months)

Based on releases (v1.13.0, v1.14.5) + recent blog posts:

- **Flows hardening** — deeper Crew integration, long-running workflow persistence + resumption beyond SQLite.
- **LiteLLM model coverage** — Claude 4.5, Gemini 3.x, open weights (vLLM, Ollama, DeepSeek, Cerebras, Dashscope).
- **Memory + RAG improvements** — Qdrant Edge backend (v1.12.1), agentic RAG enhancements.
- **Enterprise features** — A2A protocol expansion, VPC deployment for regulated customers, deeper audit + RBAC.
- **Crew Studio** — browser-based UI for designing + testing crews.
- **Skills registry** — registry / cache / CLI / SDK for sharing + discovering agent skills (v1.14.5).
- **Triggers expansion** — Gmail, Drive, Outlook, Teams, OneDrive, HubSpot triggers with sample payloads.
- **Integration toolkit** — call CrewAI automations or Amazon Bedrock Agents directly from crews.

## What we learn / steal

- **Memory architecture** — `unified_memory.py`'s hierarchical scopes + adaptive-depth recall is more sophisticated than Minsky's git + TASKS.md substrate. Note as a future design pattern for `claude-handoff-spec` (short-term per-task vs long-term project-wide).
- **Manager agent / delegation pattern** — well-tested production shape. Minsky has no built-in delegation today; OMC handles persona routing.
- **Flows = event-driven orchestration** — Minsky's cross-repo-runner is procedural. Flows-style state machines might map to MAPE-K phases more cleanly than the current procedural loop.
- **Reasoning agents** — "reflect on task, refine plan, inject into description" is good shape for any persona's intentions section in OMC.
- **Skills registry** — analog to MCP. Watch how they evolve and whether the community standardizes around one shape.

## Why choose Minsky over CrewAI

- **Coding-specific by design** — git-native, TASKS.md surface, PR-shaped output. CrewAI's coding fit is a community template, not a built-in.
- **Daemon, not framework** — 24/7 background process, surviving terminal close, fleet-aware. CrewAI is stateless per `kickoff()`.
- **Operator-machine identity** — Minsky uses operator's `~/.ssh` + `~/.gitconfig` + `~/.config/gh` directly. CrewAI OSS uses env vars; CrewAI AMP uses a SaaS credential vault.
- **17-rule constitution + 53 pre-pr-lint stages + 65 CI jobs** — every iteration is deterministically gated. CrewAI's guardrails are optional + advisory.
- **MAPE-K substrate** — Minsky's experiment-store + observer + spec monitor capture iteration outcomes and surface them as filed tasks the daemon works on next iteration. The closed-loop A/B prompt tuning (full MAPE-K) is in specification phase per [`user-story-003`](../user-stories/003-mape-k-improves-prompts.md) — substrate ships today, full loop forthcoming. CrewAI has neither.
- **Cross-repo fleet built-in** — Minsky walks N repos per pass. CrewAI Crews are single-execution-context.

## Why choose CrewAI over Minsky

- **General-purpose orchestration** — coding is one use case among many. Marketing, research, analytics, customer support — all first-class.
- **Memory architecture** — hierarchical scopes, LLM-analyzed recall. Minsky uses git + files (much lighter, but less sophisticated for multi-turn conversations).
- **Manager agent / delegation pattern** — built in. Minsky has nothing equivalent.
- **Hundreds of OSS tools** — broad ecosystem out of the box. Minsky relies on MCP.
- **Enterprise distribution at Fortune 500 scale** — CrewAI AMP + 2B executions + 60% Fortune 500 + 100k certified devs. Minsky's enterprise gap is filed as `enterprise-deployment-readiness-audit`.
- **Reasoning agents** — built-in plan-reflect-refine loop. Minsky has no equivalent.

## Has CrewAI published a vendor-primary coding benchmark? (gates `corpus-add-crewai`)

**No.** CrewAI has not published HumanEval, MBPP, or SWE-bench scores. The PwC case study is the closest signal (10%→70% on proprietary-language code generation) but measures orchestration capability, not agent capability. The framework is general-purpose orchestration; coding benchmarks are orthogonal to its design.

**Implication**: `corpus-add-crewai` (TASKS.md ~line 1948) remains blocked. Possible unblocks:

1. CrewAI publishes a vendor-primary coding benchmark on `crewai.com/blog`.
2. Minsky's competitor-research validator gains a new metric path for adoption metrics (`enterprise-adoption-percentile`) — would require extending the catalogue.

## Pattern conformance

- **Pattern CrewAI implements**: Role-based multi-agent orchestration (role / goal / backstory / tools per agent; "crew" composition) — Wooldridge, *An Introduction to MultiAgent Systems*, 2nd ed., Wiley, 2009, Ch. 7 (methodologies for agent-oriented analysis and design).
- **Conformance level**: full (in the pattern CrewAI implements).
- **How Minsky relates**: don't adopt — Minsky is coding-specific and uses OMC for orchestration within the Anthropic stack. CrewAI's role-play orchestration occupies the same surface as OMC (vision.md row 50); adopting CrewAI would violate rule #1 across OMC + MCP + Claude Code Max.
- **Index row**: vision.md § "Pattern conformance index" row 47.

## Should we wrap CrewAI instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict**: NO — structural mismatch. Don't file a P0 wrap proposal.

**Architectural fit**: CrewAI is a Python framework (`pip install crewai`), not a daemon. To use CrewAI from Minsky's daemon shell, we'd have to spawn `python -m crewai.run ...` per task. CrewAI itself has no "watch a TASKS.md queue forever" mode — we'd be building the task-picker + queue layer on top of CrewAI, not the other way around.

**What we'd delegate to CrewAI**: multi-agent orchestration within one task (role / goal / backstory / crew composition).

**What we'd keep**: daemon shell, TASKS.md surface, operator-machine identity, constitution + 53 lint stages + 65 CI jobs, MAPE-K substrate, cross-repo fleet — i.e., everything Minsky-distinctive.

**Why the wrap doesn't pay off**:

1. **CrewAI is general-purpose, not coding-specific.** Code execution is deprecated (`CodeInterpreterTool` removed; operators are pointed at E2B / Modal). Wrapping CrewAI means we still need to write the git workflow, the test runner, the PR-shaped output ourselves. CrewAI doesn't replace the LLM-as-coding-agent piece.
2. **CrewAI's role / goal / backstory + memory architecture would have to be re-mapped to Minsky's task shape.** Minsky tasks are markdown blocks with Hypothesis / Success / Pivot / Measurement / Anchor fields (per rule #9). CrewAI's per-agent role/goal isn't a 1:1 translation; we'd be writing an adapter layer.
3. **Net moat after wrap = same 6 moats as today**, plus CrewAI's `unified_memory.py` (which is genuinely better than our git + experiment-store). But the memory architecture is portable as a pattern (already filed as `research-finding-hierarchical-memory-architecture` for evaluation in `claude-handoff-spec` M2 work). We can STEAL the pattern without wrapping the framework.

**Honest conclusion**: CrewAI is the wrong shape to wrap. We extract maximum value by stealing patterns (memory architecture, manager-agent delegation, Flows-style state machines — all filed as P3 research tasks in TASKS.md), not by replacing Minsky's orchestrator layer with CrewAI's framework.

The pivot scenario that would change this answer: if CrewAI publishes a coding-specific variant (`crewai-code` or similar) with first-class git workflow + test runner + PR-shaped output, OR if their A2A protocol becomes the industry-standard agent-handoff format and Minsky benefits from speaking A2A natively. Either would re-open this analysis.

## Last reviewed

2026-05-22 (deep-dive refresh — CrewAI AMP production architecture, 2B execution milestone, $18M funding, Flows / Crews distinction, coding-fit assessment, vendor-benchmark gating for `corpus-add-crewai`); 2026-05-22 wrap-feasibility analysis added per rule #1 + operator directive.
