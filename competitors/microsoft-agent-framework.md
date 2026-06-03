# Competitor: Microsoft Agent Framework (Microsoft)

> A toolkit for building multi-agent applications in .NET or Python — overlapping ambition with Minsky, but the wrong stack and the wrong shape.

- **URL**: <https://github.com/microsoft/agent-framework>
- **Status**: Active, v1.0 released April 2026, .NET + Python
- **Pricing**: Open source (the framework); you pay your own LLM API bills
- **Relationship**: **Competitor** — orchestrator-tier peer with an enterprise framing, the wrong stack, and the wrong shape

## What this is

Microsoft Agent Framework (MAF) is a toolkit you embed in an application to build, orchestrate, and deploy AI agents and multi-agent workflows. An *agent* here is the coding assistant or LLM-driven worker that does the actual task. You wire agents into a graph-based workflow — a declarative pipeline of steps — and the framework runs it with streaming output, checkpointing, human approval steps, and time-travel debugging (replay a run from a saved checkpoint).

MAF combines and supersedes two earlier Microsoft projects, Semantic Kernel and AutoGen. It ships built-in OpenTelemetry (OTEL) — the open standard for emitting traces, metrics, and logs — plus support for the Model Context Protocol (MCP) and an agent-to-agent (A2A) bridge. It is positioned as enterprise-grade: cost controls, audit logging, and policy-as-code for compliance.

**MAF subsumes AutoGen.** Microsoft folded AutoGen into MAF at v1.0 (April 2026). The AutoGen brand is retired, but its primitives — graph workflows (formerly GraphFlow), multi-agent planning (formerly MagenticOne), declarative pipelines — live on inside MAF. The wrap-feasibility analysis in this file is the canonical answer for both AutoGen and MAF.

## What this is not

- **Not a daemon.** A daemon is a background program that keeps running on your machine after you start it, surviving terminal close and restarting on crash. MAF is a framework you embed in an application; the application owns the agent loop in-process. Minsky is the daemon — you attach it to a repo and it runs around the clock.
- **Not a fleet walker.** MAF runs one graph workflow on one input, then stops at the terminal node. Minsky walks several repos in turn (a *cross-repo fleet*), picks the next task itself, and never stops.
- **Not coding-specific.** MAF targets general multi-agent applications. Minsky is solely the autonomous-coding outer loop.
- **Not a governance gate.** MAF defines workflow behaviour and ships compliance features. It has no equivalent of Minsky's *constitution* — the numbered, non-negotiable project rules in `vision.md` that gate every change.

## Strengths

- **Enterprise-grade observability** — built-in OpenTelemetry (OTEL), distributed tracing, structured event log.
- **Time-travel debugging** — checkpoint-based replay of a workflow run.
- **Human-in-the-loop** — first-class approval steps.
- **MCP and A2A** — agent-to-agent protocol support.
- **Graph workflows** — declarative agent pipelines with streaming output.
- **Cross-language** — .NET + Python with consistent APIs.
- **Microsoft-backed** — long-term maintenance assured.
- **Compliance-ready** — cost controls, audit logging, policy-as-code.

## Weaknesses vs Minsky's vision

1. **Wrong stack.** MAF is .NET and Python. Minsky is TypeScript-first, within the Claude Code ecosystem. Adopting MAF means abandoning the Anthropic stack entirely.
2. **Enterprise framing, not solo operator.** MAF is built for teams and business units negotiating resources, with enterprise identity systems and audit. That is heavy for one developer running work on their own machine.
3. **No subscription economy.** MAF assumes per-API-call billing. It does not compose with a flat Claude Code Max subscription quota.
4. **No opinionated personas.** MAF gives you a framework, not a curated set of roles. A *persona* is a role the agent takes on (researcher, planner, implementer, QA); Minsky ships a mature 32-persona set (via OMC, Oh My Claude Code — the plugin that gives a Claude Code session its specialist roles), MAF does not.
5. **Heavy install surface.** MAF spreads across many subpackages — `agent-framework-core`, `agent-framework-foundry`, `agent-framework-anthropic`, and more.
6. **No TASKS.md, no Watch surface, no self-improvement loop, no constitution.** MAF has no plain-text Markdown to-do list at a repo root for an operator to edit, no glanceable Watch surface (the ambient at-a-glance status display), no across-runs self-tuning layer, and no numbered-rules gate.

## What we learn / steal

- **OTEL as a first-class concern, not a bolt-on.** MAF ships built-in distributed tracing and a structured event log. This validates Minsky's `novel/adapters/observability/` bet (rule #4; pattern-conformance row 24). Match MAF's OTEL span schema where cross-system compatibility is cheap, so a future bridge to a MAF-hosted agent emits comparable traces.
- **Checkpoint-based time-travel debugging.** MAF persists graph state per super-step for replay — the same durability primitive LangGraph exposes. Minsky's `.minsky/orchestrate.jsonl` is already event-sourced at the iteration boundary, so the replay capability is latent and free; keep matching the one-record-per-super-step granularity.
- **Graph-based declarative workflow expression** (formerly AutoGen GraphFlow, now MAF graph workflows). A declarative pipeline is a clean alternative to imperative orchestration for some flows. Note the *pattern* for the future `claude-handoff-spec` substrate design without adopting the runtime — the same play as adopting OTEL without adopting a vendor.
- **Framework gravity is a cautionary tale.** Once you embed MAF, the operator surface becomes .NET attributes and workflow YAML, not markdown. A framework that wants to own the agent loop in-process puts operator-machine identity (work runs as you) and the TASKS.md surface at risk. Minsky's daemon-not-framework choice (moat #1) is the deliberate inverse and must stay that way.

## Why choose Minsky over Microsoft Agent Framework

- **Coding-specific by design** — git-native, a TASKS.md surface, draft-PR output. MAF targets general multi-agent applications, not the coding outer loop.
- **A daemon, not a framework** — Minsky is a background program you attach to a repo; it runs around the clock and survives terminal close. MAF is a library your application embeds and triggers.
- **Subscription economy** — Minsky composes with a flat Claude Code Max quota. MAF assumes per-API-call billing.
- **A self-improvement substrate** — Minsky watches its own iterations across all prior runs on a host and feeds the results back. MAF's checkpoints persist one execution's state, not learning across runs.
- **A constitution + CI gate** — every change is gated against the numbered rules in `vision.md` before it can merge. MAF ships compliance features, not a PR-merge governance layer.

## Why choose Microsoft Agent Framework over Minsky

- **General-purpose multi-agent applications** — coding is one use case; MAF targets the broad space of multi-agent LLM applications.
- **Enterprise integration** — built-in identity, audit logging, cost controls, and policy-as-code for compliance-heavy teams.
- **Cross-language** — first-class .NET and Python with consistent APIs, for shops on the Microsoft stack.
- **Microsoft backing** — long-term maintenance, large adoption, and a mature observability story out of the box.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

MAF subsumes the retired AutoGen entry, so it inherits AutoGen's published benchmark reading in the corpus.

| Metric                       | Value  | Date       | Primary source |
| ---------------------------- | ------ | ---------- | -------------- |
| `math-whole-test-accuracy`   | 0.6948 | 2023-08-16 | Wu, Bansal, Zhang, Wu, Li, Zhu, Wang, Saied, Awadallah, Yang, "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework", arXiv 2308.08155, 2023 (MATH whole-test accuracy = 69.48% with the multi-agent conversation framework vs GPT-4's 55.18%) |

**Why MATH and not HumanEval**: the M1.10 orchestrator-tier metric is `humaneval-pass-at-1`, but AutoGen does not publish a stock-model HumanEval headline — HumanEval is run model-dependently via the AutoGenBench tool, which would need a `local-harness` result kind rather than a `published` snapshot. The Wu et al. 2023 paper's primary headline is the MATH whole-test number, so the corpus adopts `math-whole-test-accuracy` as the orchestrator-tier math-reasoning sibling to `humaneval-pass-at-1` (MetaGPT). This keeps the corpus's primary-citation invariant intact (rule #4, visible — no fabricated HumanEval number, no third-party proxy).

## Should we wrap Microsoft Agent Framework instead?

> Per rule #1 (don't reinvent), every direct-competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: STRUCTURAL MISMATCH — do NOT wrap.** The orchestrator-tier wrap fails the moat threshold (only 2 of 6 moats survive). The agent-tier sub-cases are dominated by OpenHands per the [Path C reshape plan](../docs/plans/2026-05-22-path-c-openhands-reshape.md). The cross-cutting feature absorptions (OTEL schema, graph-workflow expression) are already underway via Minsky's existing `Observability` adapter and don't require a wrap to capture.

The same verdict covers AutoGen, since Microsoft folded AutoGen into MAF at v1.0.

### The 5 questions

**1. Architectural fit.** MAF assumes a .NET or Python process owns the agent loop in-process. Its streaming, checkpointing, and time-travel debugging are in-memory primitives anchored to a single workflow execution. Minsky's architecture is the opposite: a daemon that walks N hosts in round-robin (a *host* is one repo Minsky works on), spawning a short-lived agent process per *iteration* (one round of pick-a-task, run an agent, capture the result, open a draft), with state persisted on the operator's filesystem. MAF expects to be the long-lived process; Minsky expects to spawn short-lived agent processes. **No clean architectural fit.**

**2. What we delegate.** Three plausible delegation targets, only one of which would actually shrink Minsky's surface:

- **Graph-workflow orchestration (formerly AutoGen GraphFlow, now MAF graph workflows)** — declarative DAGs replacing Minsky's imperative `cross-repo-runner` loop. *Possible but moot* — Minsky's loop is per-host round-robin, not a single-execution DAG, so the structural fit is wrong; and per the Path C plan, the agent-loop layer goes to OpenHands, not MAF.
- **Multi-agent planning (formerly MagenticOne, now MAF)** — sub-agent orchestration with a critic and verifier. *Already covered by OpenHands' DelegateTool + TaskToolSet + AgentDefinition* per the Path C plan § "Personas / sub-agent layer". MAF is a more elaborate version of the same primitive OpenHands already provides, at less integration cost.
- **OTEL schema + observability** — first-class distributed tracing and a structured event log. *Already adopted as a pattern, not a dependency* — `novel/adapters/observability/` matches MAF's OTEL conventions where they make sense (pattern-conformance row 24).

**3. What we keep.** All 6 moats — daemon-not-framework, operator-machine identity, constitution + deterministic CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface — survive structurally because MAF ships none of them. MAF is a framework you embed in your application; Minsky is a daemon you attach to your repo. The substitution doesn't happen — MAF doesn't compete with the daemon shell layer at all.

**4. Net moat after wrap.** If Minsky were to wrap MAF for the orchestrator layer (the most aggressive shape), the picture is bleak:

| Moat | Survives a hypothetical full MAF wrap? | Why |
|---|---|---|
| Daemon, not framework | ❌ | MAF IS the framework; the wrap turns Minsky into a MAF application |
| Operator-machine identity | 🟡 | Possible if MAF runs as the operator, but the .NET/Python runtime adds attack surface and identity-propagation work |
| Constitution + CI | ✅ | Minsky still gates the agent's PRs regardless of orchestration runtime |
| MAPE-K substrate | ❌ | MAF's graph workflows replace Minsky's loop substrate; the experiment-store + observer + spec-monitor layer is structurally orphaned |
| Cross-repo fleet | ❌ | MAF graph workflows are per-execution, not per-host-fleet; the `--hosts-dir` round-robin pattern has no equivalent |
| TASKS.md as operator surface | ❌ | MAF expects workflow YAML / .NET attributes; the operator-edits-markdown surface dies |

Net: **2 of 6 moats survive** (constitution + CI weakly, operator-machine identity partially). That is below the ≥4-moat "worth proposing as P0" threshold per the wrap-feasibility skill's calibration. The agent-layer-only sub-case is dominated by OpenHands per the Path C plan.

**5. Verdict — STRUCTURAL MISMATCH.** The architectural shape is wrong (framework vs daemon), the moat math is bleak (2/6), and the strongest sub-case (orchestrator wrap) is already dominated by OpenHands at the agent layer. **Do NOT wrap.** Keep extracting individual ideas (OTEL schema, graph-workflow expression for the future `claude-handoff-spec` substrate) without depending on the runtime.

### Trigger for re-evaluation

Re-run this analysis when ANY of these fire:

1. **Microsoft ships an MAF Daemon SKU** explicitly designed to "run me forever on a task queue against N repos as the operator". The architectural shape would change — re-evaluate.
2. **OpenHands' Path C wrap fails its pivot threshold** (per `add-openhands-as-pluggable-backend` Pivot: <5pp SWE-bench delta). Then the agent-tier wrap of MAF becomes the next candidate — re-evaluate the agent-layer sub-case specifically.
3. **The MAPE-K substrate ships closed-loop A/B prompt tuning** (L2 from `user-stories/003`) and Minsky's autonomic layer becomes structurally similar to MAF's graph-workflow checkpointing. Re-evaluate whether folding MAPE-K onto MAF's graph runtime is cheaper than maintaining Minsky's own.
4. **A 5th cloud agent is added** to `~/.minsky/config.json` via the MAF SDK. The per-machine matrix would expand and change the wrap-feasibility math.

## Five pivot questions

### 1. How is it different from Minsky?

MAF is a **cross-language framework you embed in an application** — `agent-framework-core` plus the foundry/anthropic subpackages, owned by a .NET or Python host process that runs the graph workflow in-process. Minsky is an **orchestrator-tier 24/7 TypeScript daemon** that attaches to N repos, drains TASKS.md, spawns a short-lived per-task agent process per iteration, and refuses to merge any agent's output that fails the 18-rule constitution. The defining structural difference is the outer loop, the fleet, and the gate: MAF's graph workflow runs when triggered and stops at the terminal node; Minsky never stops, walks `--hosts-dir` in round-robin, picks the next task itself, and self-governs.

MAF (via the former MagenticOne) models *one workflow's* multi-agent plan with a critic and verifier; Minsky models a *fleet's* task selection plus a CI merge gate. The closest overlap is MAF's checkpoint-based time-travel debugging — but that persists *one execution's* state, not state *across all prior runs on a host*, which is the MAPE-K substrate's job. The two are not peers: MAF is the kind of in-process workflow engine an orchestrator might embed, not an orchestrator itself.

### 2. What lessons can it give to us?

- **OTEL as a first-class concern, not a bolt-on** (MAF ships built-in distributed tracing + a structured event log) — confirms Minsky's `novel/adapters/observability/` bet (rule #4, pattern-conformance row 24). Lesson: match MAF's OTEL span schema where cross-system compatibility is cheap, so a future bridge to a MAF-hosted agent emits comparable traces.
- **Checkpoint-based time-travel debugging** (MAF persists graph state per super-step for replay) — structurally the same durability primitive LangGraph exposes. Lesson: Minsky's `.minsky/orchestrate.jsonl` is already event-sourced at the iteration boundary, so the replay capability is latent and free; keep matching the one-record-per-super-step granularity.
- **Graph-based declarative workflow expression** (formerly AutoGen GraphFlow, now MAF graph workflows) — declarative DAGs as an alternative to imperative orchestration. Lesson: note the *pattern* for the future `claude-handoff-spec` substrate design without adopting the runtime — the same play as adopting OTEL without adopting a vendor.
- **Folding AutoGen + Semantic Kernel into one framework is a cautionary tale about framework gravity** — once you embed MAF, the operator surface becomes .NET attributes / workflow YAML, not markdown. Lesson: a framework that wants to own the agent loop in-process puts operator-machine identity and the TASKS.md surface at risk; Minsky's daemon-not-framework choice (moat #1) is the deliberate inverse and must stay that way.

### 3. Are any of these lessons potentially vision-changing?

**No vision rewrite is forced today.** The task's Hypothesis was: *MAF (evolution of AutoGen + Magentic-One) is the enterprise-backed orchestrator competitor; Q5 should grade replace-loop-with-Magentic-One, and Q3 should answer whether Microsoft's roadmap forces Minsky to commit to a specific runtime or stay runtime-agnostic.* Examined against the pre-registered Pivot (*if Magentic-One's Orchestrator covers Minsky's MAPE-K layer, file a vision-threat for the MAPE-K module home*):

- **Magentic-One's Orchestrator does NOT cover the MAPE-K layer.** MAF's multi-agent planning (former MagenticOne) is a *per-execution* critic-plus-verifier over one workflow's sub-agents; MAPE-K's Monitor → Analyze → Plan → Execute loop (the experiment-store + observer + spec-monitor) runs *across all prior iterations on a host*. The pre-registered Pivot trigger — "covers Minsky's MAPE-K layer" — is **not met**, so the directive is exactly what the Pivot's inverse implies: **build MAPE-K ourselves, do not fold it onto Magentic-One.**
- **The runtime-commitment question (Q3) resolves to: stay runtime-agnostic.** Microsoft's roadmap (v1.0 graph workflows, checkpointing, A2A bridge) is an *in-process .NET/Python* commitment. Adopting it would force Minsky off the TypeScript substrate it shares with tasks.md + agentbrew, and off the Claude Code Max economy onto API billing — two constitutional violations. The honest answer: Microsoft's roadmap does NOT force Minsky to commit to a runtime; it reinforces the runtime-agnostic daemon shell that spawns whatever agent the operator configures.
- **The maximal version of the threat does not dissolve the moat.** Even a full MAF wrap leaves only 2 of 6 moats standing (per the § "Should we wrap" table) — and the strongest sub-case (agent-tier orchestration) is already dominated by OpenHands per the Path C plan. This is a negative finding (no vision-threat question filed), recorded here per this task's central-questions routing rather than by editing `ask-human.md`.

### 4. How can we improve our strategy based on this?

- **Pin the OTEL span-schema compatibility note** — keep matching MAF's OTEL conventions in `novel/adapters/observability/` where cheap, so a future bridge to a MAF-hosted agent is a thin adapter, not a rewrite. Traces to lesson §2.1.
- **Keep the iteration record at one-super-step-per-record** in `.minsky/orchestrate.jsonl` so MAF-style checkpoint replay/time-travel stays free if ever needed. Traces to lesson §2.2.
- **Treat "embed a framework that owns the agent loop" as an explicit anti-requirement** — the daemon-not-framework moat (#1) and the operator-edits-markdown surface (#6) are the two assets a MAF wrap would dissolve; name them as deliberate design choices so no future integration quietly adopts an in-process-framework shape. Traces to lesson §2.4 + Q3.
- **Watch the four re-evaluation triggers above** — they are the only conditions under which the wrap math changes; keeping them explicit is the cheap insurance. Traces to § "Trigger for re-evaluation".

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **loop**: KEEP — MAF has no daemon, no queue, no cross-repo round-robin; its graph workflow runs one execution and stops. The durability sub-case it tempts you with (checkpoint replay) is already covered by the event-sourced `.minsky/orchestrate.jsonl`.
- **MAPE-K**: KEEP (build ourselves) — Magentic-One's per-execution critic+verifier is not the across-runs autonomic loop; folding MAPE-K onto MAF's graph runtime imposes the .NET/Python tax and orphans the experiment-store + observer + spec-monitor layer. The pre-registered Pivot trigger ("covers MAPE-K") is not met.
- **adapters / agent backend**: N/A — MAF's agent-tier orchestration (former MagenticOne) is dominated by OpenHands' DelegateTool + TaskToolSet + AgentDefinition per the [Path C plan](../docs/plans/2026-05-22-path-c-openhands-reshape.md); adding MAF as a 5th `cloud_agent` would compete with an integration that's already cheaper.
- **sandbox**: N/A — MAF runs in-process; OS-level isolation stays Minsky's job.
- **constitution / merge gate**: KEEP — MAF defines workflow behaviour, not policy. The 18-rule constitutional gate (moat #3) has no analog; MAF's cost controls + audit logging are compliance features, not PR-merge governance.
- **cross-repo fleet**: KEEP — `--hosts-dir` round-robin (moat #5) has no MAF equivalent; a graph workflow runs on one input.
- **corpus / scorecard**: N/A — MAF is a benchmarked orchestrator-tier peer in `competitors/README.md`, intentionally a *competitor* record (it subsumes the retired AutoGen entry), not a dependency candidate; it stays in the M1.10 corpus denominator.
- **TASKS.md surface / fleet dashboard**: KEEP — operators edit markdown; MAF expects workflow YAML / .NET attributes, a steeper learning curve for the same delivery surface, and it has no fleet dashboard.

**Total replace % across all surfaces: 0% — STRUCTURAL MISMATCH.** The honest headline for the operator: *nothing in the orchestrator to replace; the two tempting sub-cases (checkpoint replay, Magentic-One multi-agent planning) are already absorbed — replay as event-sourcing over `.minsky/orchestrate.jsonl`, planning as the approved OpenHands Path C wrap; the .NET/Python stack tax plus the API-billing economy mismatch make a wrap a net negative (2/6 moats); the four re-evaluation triggers above are the only conditions that change the math.*

## Pin / integration

Not a dependency. No adapter. Watch their OTEL span schemas for compatibility.

## Pattern conformance

- **Pattern MAF implements**: Graph-based workflow orchestration of agents (declarative pipelines, checkpointing, human-in-the-loop) — van der Aalst & van Hee, *Workflow Management: Models, Methods, and Systems*, MIT Press, 2002 (workflow nets and the four perspectives) — combined with three-signal observability — OpenTelemetry specification, CNCF (2020+).
- **Conformance level**: full (in the pattern MAF implements).
- **How Minsky relates**: don't adopt — wrong stack (.NET / Python) and enterprise framing. Minsky borrows the OTEL-as-first-class-concern lesson (already row 24, `@minsky/observability`) but rejects the graph-workflow runtime in favour of MAPE-K (row 5) and OMC handoffs.
- **Index row**: vision.md § "Pattern conformance index" row 49.

## Last reviewed

2026-06-02 — deepened with the `## Five pivot questions` framework per task `competitor-deepen-microsoft-agent-framework`. Verdict: STRUCTURAL MISMATCH (0% replace across all surfaces). The pre-registered Pivot trigger (*Magentic-One's Orchestrator covers Minsky's MAPE-K layer → file a vision-threat for the MAPE-K module home*) is **not met** — Magentic-One is a per-execution critic+verifier, not the across-runs autonomic loop — so the directive is to **build MAPE-K ourselves**, not fold it onto Magentic-One. Q3 (runtime-commitment) resolves to **stay runtime-agnostic**: Microsoft's in-process .NET/Python roadmap does not force a runtime commitment; it reinforces the daemon-shell-spawns-any-agent shape. Negative finding — no vision-threat question filed (recorded inline per this task's central-questions routing rather than editing `ask-human.md`). The four re-evaluation triggers above remain the only conditions that change the wrap math.

Earlier reviews: 2026-05-23 — wrap-feasibility analysis added per rule #1 + the Phase 7 discipline encoded in `.claude/skills/competitor-research/SKILL.md`. AutoGen brand retired (Microsoft folded it into MAF v1.0, April 2026); MAF subsumes the AutoGen primitives and is the canonical entity for wrap analysis going forward. Verdict: STRUCTURAL MISMATCH (orchestrator-tier wrap fails moat threshold 2/6; agent-tier sub-case dominated by OpenHands per the Path C plan). 2026-05-03 — initial deep-dive (strengths, gaps, what we extract, why we don't use it).
