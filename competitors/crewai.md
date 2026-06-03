# Competitor: CrewAI

> CrewAI is the most-adopted general-purpose framework for wiring AI agents into teams. It is Minsky's largest orchestrator-tier peer by adoption, but it sits next to Minsky rather than against it: CrewAI orchestrates agents for any task, while Minsky orchestrates agents only for coding.

- **URL**: <https://crewai.com> / <https://github.com/crewAIInc/crewAI>
- **Status**: Active open-source v1.0 GA (2025); CrewAI AMP enterprise platform; $18M total funding (Series A $12.5M, Insight Partners, Oct 2024); 48k GitHub stars.
- **Pricing**: Open-source core is free (`pip install crewai`); CrewAI AMP is a paid enterprise platform.
- **Relationship**: Competitor — orchestrator-tier peer. General-purpose multi-agent orchestration versus Minsky's coding-specific daemon.

## What this is

CrewAI is an open-source Python framework for orchestrating role-playing AI agents. You write Python, import `crewai`, define your agents and tasks, and call a function to run them. It is built from scratch, independent of LangChain.

Throughout this file, an **agent** is a coding (or task-doing) assistant that an orchestrator drives to do the actual work. Minsky is not an agent — it drives agents. A **daemon** is a background program that keeps running on your machine after you start it, surviving terminal close and restarting on crash. CrewAI is a framework, not a daemon: it runs when you call it and stops when the call ends.

CrewAI has three primary layers:

- **Agents** (`lib/crewai/src/crewai/agent/core.py`) — stateful objects defined by role, goal, and backstory, with an optional model, tools, and memory. The executor handles tool calls, error recovery, and streaming.
- **Crews** (`lib/crewai/src/crewai/crew.py`) — a composition of agents and tasks. `Crew.kickoff(inputs)` runs the orchestration. It supports sequential (default), hierarchical (with a manager agent), or custom processes. State flows between tasks through a shared `ExecutionContext`. Each `kickoff()` is a fresh run — agents keep no state between crew executions.
- **Flows** (`lib/crewai/src/crewai/flow/flow.py`) — event-driven state machines that CrewAI markets as the production architecture (CrewAI README, 2025). You define steps with `@start` / `@listen` / `@router` decorators and explicit state. Flows can embed Crews as units of work. They persist to SQLite by default; AMP swaps in distributed stores.

Memory is the substrate, not message-passing. The unified memory system (`lib/crewai/src/crewai/memory/unified_memory.py`) is hierarchical — scopes like `/project/alpha` or `/agent/researcher/findings` — with a model inferring scope automatically, and adaptive-depth recall scored on semantics, recency, and importance.

## What this is not

- **Not a daemon.** CrewAI is a Python framework you wrap your code in; each `kickoff()` is a fresh run. Minsky is an always-on daemon you attach to a project and walk away from.
- **Not coding-specific.** CrewAI is general-purpose multi-agent orchestration. Minsky is built solely for the autonomous-coding loop.
- **Not a head-to-head competitor.** This file is adjacent-tier analysis: what to learn from the dominant orchestrator framework, not whom to beat turn-for-turn.

## Strengths

- **Mature role-play orchestration** — the canonical "role / goal / backstory → task → crew" pattern, proven at Fortune 500 scale.
- **Memory architecture** — short-term, long-term, entity, and contextual memory; model-analyzed hierarchical scopes; agentic retrieval-augmented generation (RAG) built in (query rewriting, knowledge sources).
- **Manager agent pattern** (`docs.crewai.com/en/learn/hierarchical-process`) — automatic or custom managers for delegation plus validation, well-tested in production (PwC, DocuSign).
- **Flows for deterministic orchestration** — event-driven state machines complement autonomous Crews. CrewAI evangelizes the combination as the production pattern.
- **Hundreds of open-source tools** (`crewai-tools`, now in the main repo) — file management, web scraping, vector databases, API integrations, DALL-E, Vision, Stagehand.
- **Reasoning agents** — agents reflect on a task's objectives, refine a plan, and inject the plan into the task description before executing.
- **CrewAI AMP (Agent Management Platform)** — a Kubernetes-native enterprise control plane: role-based access control (RBAC), audit logging, OAuth2 (Auth0 / Entra ID / Okta / Keycloak / WorkOS), Agent-to-Agent (A2A) protocol, triggers (Gmail / Drive / Outlook / Teams / OneDrive / HubSpot), and integrations.
- **Massive adoption** — 48k stars, 290 contributors, 2.6M weekly PyPI downloads, 100k+ certified developers via `learn.crewai.com`, **2 billion cumulative agentic executions (Jan 2026, 450M+/month)**, and **60% of Fortune 500** (per the CrewAI OSS 1.0 GA post).

## Weaknesses vs Minsky's vision

A **host** below means one code project (one git repository) that Minsky works on; walking several hosts in turn is its cross-repo fleet. The **operator** is the human who runs Minsky — you. **MAPE-K** is Minsky's self-improvement loop: Monitor, Analyze, Plan, Execute over a Knowledge base (Kephart & Chess, 2003). **TASKS.md** is the plain-text Markdown to-do list at a project's root that Minsky reads to pick work.

1. **Python framework, not a daemon** — you `pip install crewai`, import it, define Agent + Task + Crew classes, and call `crew.kickoff()`. It is stateless per execution. There is no background daemon that survives terminal close.
2. **Not coding-specific** — CrewAI does general-purpose orchestration, and code execution is deprecated (`CodeInterpreterTool` removed in favor of E2B / Modal sandboxes). GitHub integration is AMP-only and limited to issue and release actions; there is no native `git clone`, `commit`, pull-request creation, or diff analysis. The PwC case study (10% to 70% code-generation accuracy) needed custom tools plus a human in the loop, not out-of-the-box coding.
3. **No constitutional rules or deterministic CI enforcement** — Minsky's constitution is its 17 numbered, non-negotiable project rules. CrewAI's guardrails are optional (`docs.crewai.com/en/learn/guardrails`): no iron-rule constitution, no pre-execution linting layer. AMP adds audit logging, but it observes; it does not gate.
4. **No MAPE-K self-improvement loop** — CrewAI's "reasoning agents" reflect on plans, but one-shot per task. There is no closed loop where execution outcomes auto-tune prompts or policies. Once shipped, a crew is static.
5. **Cross-repo: partial** — Flows can orchestrate multiple Crews, but each Crew is scoped to one execution context. There is no native cross-repo parallelism and no fleet-aware walker that visits many hosts in turn.
6. **Operator surface is Python plus a web UI (AMP)** — Crews are code (`agents.yaml`, `tasks.yaml`, `crew.py`). Operators trigger runs through the AMP web UI, CLI, or external triggers. There is no version-controlled Markdown to-do list.
7. **Credential model differs** — the open-source core reads operator environment variables (`.env` files); AMP uses a centralized vault (OAuth2). Neither matches Minsky's operator-machine identity, where work runs as you, reading your `~/.gitconfig`, `~/.ssh`, and `~/.config/gh` directly with no credential provisioning.

## What we learn / steal

The agent backend Minsky orchestrates through a small wrapper file (an **adapter**) is called OMC below — Minsky's orchestrator over the coding agent. A **persona** is a role the agent takes on (researcher, planner, implementer, QA).

- **Memory architecture** — `unified_memory.py`'s hierarchical scopes plus adaptive-depth recall are more sophisticated than Minsky's git + TASKS.md substrate. Note it as a future design pattern for `claude-handoff-spec` (short-term per-task versus long-term project-wide).
- **Manager agent / delegation pattern** — a well-tested production shape. Minsky has no built-in delegation today; OMC handles persona routing.
- **Flows = event-driven orchestration** — Minsky's cross-repo-runner is procedural. Flows-style state machines might map to the MAPE-K phases more cleanly than the current procedural loop.
- **Reasoning agents** — "reflect on the task, refine the plan, inject it into the description" is a good shape for any persona's intentions section in OMC.
- **Skills registry** — analogous to the Model Context Protocol (MCP). Watch how they evolve and whether the community settles on one shape.

## Why choose Minsky over CrewAI

- **Coding-specific by design** — git-native, with a TASKS.md surface and pull-request-shaped output. CrewAI's coding fit is a community template, not a built-in.
- **Daemon, not framework** — a 24/7 background process that survives terminal close and is fleet-aware. CrewAI is stateless per `kickoff()`.
- **Operator-machine identity** — Minsky uses the operator's `~/.ssh`, `~/.gitconfig`, and `~/.config/gh` directly. CrewAI's open-source core uses environment variables; CrewAI AMP uses a SaaS credential vault.
- **17-rule constitution + 53 pre-pr-lint stages + 65 CI jobs** — every iteration is deterministically gated. CrewAI's guardrails are optional and advisory.
- **MAPE-K substrate** — Minsky's experiment-store, observer, and specification monitor capture iteration outcomes and surface them as filed tasks the daemon works on the next iteration. The closed-loop A/B prompt tuning (full MAPE-K) is in the specification phase per [`user-story-003`](../user-stories/003-mape-k-improves-prompts.md): the substrate ships today, the full loop is forthcoming. CrewAI has neither.
- **Cross-repo fleet built-in** — Minsky walks N repos per pass. CrewAI Crews are single-execution-context.

## Why choose CrewAI over Minsky

- **General-purpose orchestration** — coding is one use case among many. Marketing, research, analytics, and customer support are all first-class.
- **Memory architecture** — hierarchical scopes and model-analyzed recall. Minsky uses git plus files (much lighter, but less sophisticated for multi-turn conversations).
- **Manager agent / delegation pattern** — built in. Minsky has nothing equivalent.
- **Hundreds of open-source tools** — a broad ecosystem out of the box. Minsky relies on MCP.
- **Enterprise distribution at Fortune 500 scale** — CrewAI AMP plus 2B executions plus 60% of Fortune 500 plus 100k certified developers. Minsky's enterprise gap is filed as `enterprise-deployment-readiness-audit`.
- **Reasoning agents** — a built-in plan-reflect-refine loop. Minsky has no equivalent.

## Scorecard readings

These benchmark values, dates, and sources are immutable data — copy them verbatim, never edit a cell.

| Benchmark                            | Value                              | Date     | Source                                                                                                                                          | Vendor-primary? |
| ------------------------------------ | ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Cumulative agentic executions        | **2 billion** (450M+/month)        | Jan 2026 | crewai.com/blog/lessons-from-2-billion-agentic-workflows                                                                                       | ✅ Vendor       |
| OSS 1.0 launch executions            | 1.4 billion                        | ~2025    | crewai.com/blog/crewai-oss-1-0---we-are-going-ga                                                                                              | ✅ Vendor       |
| PwC code generation accuracy         | 10% → 70%                          | 2026     | crewai.com/case-studies/pwc-accelerates-enterprise-scale-genai-adoption-with-crewai                                                            | ✅ Customer case study |
| Multi-agent latency (research task)  | 18.4s median                       | Apr 2026 | agent-harness.ai/blog/multi-agent-orchestration-frameworks-benchmark — vs LangGraph + AutoGen                                                  | ❌ Third-party  |
| Multi-agent cost (research task)     | $48.20 per 1k tasks                | Apr 2026 | agent-harness.ai (same source)                                                                                                                  | ❌ Third-party  |
| AgentGovBench governance score       | 13/48 (OSS) → 40/48 (with ACP)     | 2026     | agenticcontrolplane.com/blog/crewai-governance-scorecard                                                                                       | ❌ Third-party  |
| **HumanEval / MBPP / SWE-bench**     | **NOT FOUND**                      | —        | —                                                                                                                                              | —               |

**Key finding**: CrewAI has not published vendor-primary HumanEval, MBPP, or SWE-bench scores. This keeps the `corpus-add-crewai` task in TASKS.md blocked, because Minsky's competitor-research validator rejects fabricated readings (per rule #4). The framework is general-purpose orchestrator-tier, not coding-specific — orthogonal to coding benchmarks rather than measurable against them.

The PwC case study above (10% to 70% on proprietary-language code generation) is the closest coding signal, but it measures CrewAI's ability to orchestrate agents that generate code, not CrewAI's own coding capability, and it required custom tools plus a human in the loop. Two events would unblock `corpus-add-crewai` (TASKS.md ~line 1948):

1. CrewAI publishes a vendor-primary coding benchmark on `crewai.com/blog`.
2. Minsky's competitor-research validator gains a new metric path for adoption metrics (`enterprise-adoption-percentile`), which would require extending the catalogue.

## Coding-task fit

CrewAI is not coding-specific. The signals:

- Code execution is deprecated (`CodeInterpreterTool` removed; use E2B or Modal sandboxes).
- GitHub integration (AMP-only) is API-level (`create_issue`, `update_issue`, `create_release`) — no `git clone`, `commit`, pull-request creation, or diff analysis.
- The community template `template_pull_request_review` (github.com/crewAIInc/template_pull_request_review) uses two agents to analyze pull-request diffs and post comments — but it is a community template, not a built-in.
- The PwC case study (10% to 70% proprietary-language code-generation accuracy, `crewai.com/case-studies/pwc-accelerates-enterprise-scale-genai-adoption-with-crewai`) measures CrewAI's ability to orchestrate code-generating agents, not CrewAI's own coding capability. It needed custom tools plus a human in the loop.

Against OpenHands (Docker sandbox plus CodeAct, designed for autonomous coding) and Aider (git-aware repo editing for pair-programming), CrewAI is general-purpose orchestration. Coding is a use case, not the primary design.

## Production architecture

- **Open-source core** (`pip install crewai`) — runs on a developer machine or any Python environment, in-process or async/await. No built-in security boundary; credentials live in operator environment variables or `.env`.
- **CrewAI AMP** (Agent Management Platform) — Kubernetes-native SaaS, deployable via Helm (`enterprise-docs.crewai.com/installation/installation`). Requires PostgreSQL 16.8+, S3-compatible storage, and a container registry. It builds crew-automation images inside the cluster and pushes them to a registry. Multi-tenant, with RBAC plus OAuth2 plus audit logging. Credentials live in a centralized vault, referenced by name.
- **State persistence** — Flows use SQLite by default (`lib/crewai/src/crewai/flow/persistence/sqlite.py`). AMP replaces this with a distributed Task Store (A2A state), a Context Store (conversation context), and a Wharf DB (OpenTelemetry (OTEL) traces).

## Adoption signals

- GitHub: **48,137 stars** (May 2026); **6,559 forks**; **290 contributors**; **2.65M weekly PyPI downloads**.
- Cumulative executions: **2 billion** (Jan 2026, 450M+/month). 60% of Fortune 500. 100k+ certified developers.
- Funding: **$18M total** — Series A $12.5M led by Insight Partners (Oct 2024); also boldstart, Craft Ventures, Earl Grey Capital, Andrew Ng, Dharmesh Shah (HubSpot co-founder). Valuation ~$100M (TechCrunch, Oct 2024).
- Customer logos (per `blog.crewai.com/lessons-from-2-billion-agentic-workflows/`): IBM, Microsoft, Procter & Gamble, Walmart, SAP, Adobe, PayPal, PwC, PepsiCo, Johnson & Johnson, US DoD, DocuSign, AB InBev, BDO, NTT Data, Experian.
- Press: CrewAI OSS v1.0 GA (2025); Series A (Oct 2024); NVIDIA NemoClaw partnership (Mar 2026); PwC case study (2026).

## Roadmap (next 6-12 months)

Based on releases (v1.13.0, v1.14.5) plus recent blog posts:

- **Flows hardening** — deeper Crew integration, long-running workflow persistence and resumption beyond SQLite.
- **LiteLLM model coverage** — Claude 4.5, Gemini 3.x, open weights (vLLM, Ollama, DeepSeek, Cerebras, Dashscope).
- **Memory + RAG improvements** — Qdrant Edge backend (v1.12.1), agentic RAG enhancements.
- **Enterprise features** — A2A protocol expansion, VPC deployment for regulated customers, deeper audit plus RBAC.
- **Crew Studio** — a browser-based UI for designing and testing crews.
- **Skills registry** — a registry, cache, CLI, and SDK for sharing and discovering agent skills (v1.14.5).
- **Triggers expansion** — Gmail, Drive, Outlook, Teams, OneDrive, and HubSpot triggers with sample payloads.
- **Integration toolkit** — call CrewAI automations or Amazon Bedrock Agents directly from crews.

## Should we wrap CrewAI instead?

> Per rule #1 (don't reinvent), every direct-competitor analysis must ask: if this competitor is amazing at everything we do, why not wrap it and let it run for 24h? Here is the honest answer.

**Verdict**: NO — structural mismatch. Do not file a P0 wrap proposal.

**Architectural fit**: CrewAI is a Python framework (`pip install crewai`), not a daemon. To use it from Minsky's daemon shell, we would spawn `python -m crewai.run ...` per task. CrewAI has no "watch a TASKS.md to-do list forever" mode, so we would build the task-picker and queue layer on top of CrewAI, not the other way around.

**What we would delegate to CrewAI**: multi-agent orchestration within one task (role / goal / backstory / crew composition).

**What we would keep**: the daemon shell, the TASKS.md surface, operator-machine identity, the constitution plus 53 lint stages plus 65 CI jobs, the MAPE-K substrate, and the cross-repo fleet — everything Minsky-distinctive.

**Why the wrap doesn't pay off**:

1. **CrewAI is general-purpose, not coding-specific.** Code execution is deprecated (`CodeInterpreterTool` removed; operators are pointed at E2B / Modal). Wrapping CrewAI still leaves us writing the git workflow, the test runner, and the pull-request-shaped output ourselves. CrewAI does not replace the model-as-coding-agent piece.
2. **CrewAI's role / goal / backstory plus memory architecture would have to be re-mapped to Minsky's task shape.** Minsky tasks are Markdown blocks with Hypothesis / Success / Pivot / Measurement / Anchor fields (per rule #9, pre-registered hypothesis-driven development: every change states those five fields before code is written). CrewAI's per-agent role/goal is not a 1:1 translation, so we would write an adapter layer.
3. **Net moat after the wrap is the same 6 moats as today**, plus CrewAI's `unified_memory.py` (genuinely better than our git + experiment-store). But the memory architecture is portable as a pattern, already filed as `research-finding-hierarchical-memory-architecture` for evaluation in `claude-handoff-spec` M2 work. We can steal the pattern without wrapping the framework.

**Honest conclusion**: CrewAI is the wrong shape to wrap. We get maximum value by stealing patterns (memory architecture, manager-agent delegation, Flows-style state machines — all filed as P3 research tasks in TASKS.md), not by replacing Minsky's orchestrator layer with CrewAI's framework.

The pivot scenario that would change this answer: CrewAI ships a coding-specific variant (`crewai-code` or similar) with a first-class git workflow, test runner, and pull-request-shaped output, OR its A2A protocol becomes the industry-standard agent-handoff format and Minsky benefits from speaking A2A natively. Either would re-open this analysis.

## Five pivot questions

### 1. How is it different from Minsky?

CrewAI is a general-purpose, stateless-per-run Python framework for composing role-playing agents into Crews and Flows. Minsky is a coding-specific, 24/7 daemon that walks a fleet of existing repos and ships pull-request-shaped changes under a constitution. The two intents are orthogonal. CrewAI's value is letting an application developer wire role/goal/backstory agents into a workflow that runs when called (`crew.kickoff(inputs)`). Minsky's value is that the operator attaches a fleet and walks away while the loop self-improves indefinitely. CrewAI has no "watch a TASKS.md to-do list forever" mode, no git-native pull-request output (code execution is deprecated; GitHub integration is AMP-only and API-level), and no closed-loop self-tuning — its reasoning agents reflect once per task and are static thereafter. They sit at adjacent tiers: CrewAI is an orchestrator-tier framework (a library you build an app with); Minsky is an orchestrator-tier product (a daemon you run).

### 2. What lessons can it give to us?

- **2.1 Hierarchical, model-analyzed memory is a real architecture, not a nicety.** `unified_memory.py`'s scoped recall (short-term, long-term, entity, contextual, with adaptive-depth scoring) is more sophisticated than Minsky's git + TASKS.md + experiment-store substrate. Worth evaluating as a design pattern for `claude-handoff-spec` (per-task short-term versus project-wide long-term). Traces to rule #1 (steal the pattern) plus the M2 handoff work.
- **2.2 Event-driven state machines (Flows) map cleanly to phased control loops.** CrewAI positions Flows (`@start` / `@listen` / `@router` plus explicit state) as the production architecture, with autonomous Crews embedded as units of work. Minsky's cross-repo-runner is procedural; a Flows-style state machine might express the MAPE-K phases (Monitor → Analyze → Plan → Execute) more legibly. Traces to rule #5 (named patterns) plus rule #8 (pattern conformance).
- **2.3 Manager-agent delegation is a proven production shape.** Automatic-or-custom manager agents that delegate and validate (PwC, DocuSign) is a battle-tested pattern Minsky has no built-in for (OMC handles persona routing). Traces to rule #1.

### 3. Are any of these lessons potentially vision-changing?

No vision-changing finding. All three lessons are engineering-discipline / borrowable-pattern level. None challenges `vision.md` § "What Minsky is" or any of the 17 rules, and none threatens the 6 moats. CrewAI is general-purpose orchestration with deprecated code execution and AMP-only, API-level GitHub access; it does not subsume Minsky's coding-specific daemon loop, its constitutional gate, operator-machine identity, or its cross-repo fleet. The framework-versus-product framing the task pre-registered resolves cleanly: Minsky is the product/daemon; CrewAI is a framework whose best ideas (hierarchical memory, Flows, manager-agent delegation) are portable as patterns Minsky can steal without wrapping. A no-vision-change finding is the expected output for a different-tier general-purpose framework. The one scenario that would re-open this is pre-registered in the wrap analysis above: a coding-specific CrewAI variant with first-class git/test/pull-request output, or A2A becoming the industry-standard handoff protocol.

### 4. How can we improve our strategy based on this?

- **Evaluate hierarchical memory for the handoff spec; don't rebuild it blind.** Keep the `research-finding-hierarchical-memory-architecture` task alive and scope a concrete experiment for `claude-handoff-spec` M2 (short-term per-task versus long-term project-wide scopes). Borrow the architecture as a pattern, not the framework. Traces to lesson §2.1 plus rule #1.
- **Consider a Flows-style state-machine framing for the MAPE-K phases.** When the procedural cross-repo-runner is next refactored, evaluate expressing the Monitor/Analyze/Plan/Execute phases as explicit state transitions (for legibility and resumability) rather than as straight-line procedure. Traces to lesson §2.2 plus rules #5 and #8.
- **Note manager-agent delegation as a future OMC routing shape.** If Minsky ever needs intra-task delegation, CrewAI's automatic/custom manager pattern is the proven reference to copy rather than invent. Traces to lesson §2.3 plus rule #1.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop** (the loop's wake-up on its timer): KEEP — CrewAI is stateless per `kickoff()` with no 24/7 cross-repo daemon and no TASKS.md-style durable queue. Nothing to replace.
- **MAPE-K**: KEEP — reasoning agents reflect once per task; there is no online observe-tune loop over a running fleet. Flows is borrowable as a framing (lesson §2.2), not a replacement for the MAPE-K substrate.
- **adapters / agent backend**: DO-NOT-WRAP — CrewAI is a Python framework, not a spawnable headless coding-CLI backend, and code execution is deprecated. Wrapping it still leaves us building the git workflow, test runner, and pull-request output ourselves (see "Should we wrap CrewAI instead?"). OpenHands remains the runtime wrap target.
- **memory / handoff substrate**: EVALUATE-TO-ABSORB — `unified_memory.py`'s hierarchical scopes are the one genuinely-better component; absorb it as a pattern for `claude-handoff-spec`, not by swapping in the framework.
- **constitution-as-CI / lint stack**: KEEP — CrewAI's guardrails are optional and advisory; this gate is what lets Minsky run unattended.
- **corpus / scorecard**: KEEP (do NOT add) — CrewAI has published no vendor-primary HumanEval/MBPP/SWE-bench score; the PwC 10% to 70% case measures orchestration, not agent capability. Adding a fabricated or adoption-proxy reading would violate rule #4 (this keeps `corpus-add-crewai` blocked, as documented above).
- **dashboard / TASKS.md surface / identity / fleet**: KEEP — the operator surface is Python plus an AMP web UI with a SaaS credential vault; none matches Minsky's version-controlled Markdown to-do list plus direct operator-machine identity.

**Total replace across all surfaces: 0% replacement; 1 DO-NOT-WRAP (the agent backend — CrewAI is a framework, not a headless coding CLI) plus 1 EVALUATE-TO-ABSORB (hierarchical memory as a handoff-spec pattern).** Headline for the operator: nothing in Minsky to replace. CrewAI is an adjacent-tier general-purpose framework whose best ideas (hierarchical memory, Flows, manager-agent delegation) Minsky steals as patterns rather than wrapping. The wrap doesn't pay off because CrewAI does not replace the model-as-coding-agent piece, and the 6-moat-after-wrap is the same 6 moats as today.

## Pattern conformance

- **Pattern CrewAI implements**: role-based multi-agent orchestration (role / goal / backstory / tools per agent; "crew" composition) — Wooldridge, *An Introduction to MultiAgent Systems*, 2nd ed., Wiley, 2009, Ch. 7 (methodologies for agent-oriented analysis and design).
- **Conformance level**: full (within the pattern CrewAI implements).
- **How Minsky relates**: don't adopt. Minsky is coding-specific and uses OMC for orchestration within the Anthropic stack. CrewAI's role-play orchestration occupies the same surface as OMC (vision.md row 50); adopting CrewAI would violate rule #1 across OMC, MCP, and Claude Code Max.
- **Index row**: vision.md § "Pattern conformance index" row 47.

## Last reviewed

2026-05-22 (deep-dive refresh — CrewAI AMP production architecture, 2B execution milestone, $18M funding, Flows / Crews distinction, coding-fit assessment, vendor-benchmark gating for `corpus-add-crewai`); 2026-05-22 wrap-feasibility analysis added per rule #1 plus operator directive; 2026-06-02 (`competitor-deepen-crewai`) — added "Five pivot questions" (Five Pivot Questions framework): verdict 0% replace, DO-NOT-WRAP the agent backend (framework, not a headless coding CLI), EVALUATE-TO-ABSORB hierarchical memory for `claude-handoff-spec`; no vision change (negative finding; the orchestrator records operator questions centrally — this task does not edit `ask-human.md`).
