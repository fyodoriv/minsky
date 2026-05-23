# Competitor: Microsoft Agent Framework

> Microsoft's enterprise agent framework — overlapping ambition, but C#/.NET stack and corporate framing.

- **URL**: <https://github.com/microsoft/agent-framework>
- **Status**: Active, v1.0 released April 2026, .NET + Python
- **Relationship**: **Competitor** — enterprise framing, wrong stack and shape

## What it is

Microsoft's comprehensive multi-language framework for building, orchestrating, and deploying AI agents and multi-agent workflows. Combines and supersedes Semantic Kernel and AutoGen. Graph-based workflows with streaming, checkpointing, human-in-the-loop, time-travel debugging. OpenTelemetry integration. MCP. A2A bridge support. Enterprise-grade.

## Strengths

- **Enterprise-grade observability** — built-in OpenTelemetry, distributed tracing, structured event log
- **Time-travel debugging** — checkpoint-based replay
- **Human-in-the-loop** — first-class approval workflows
- **MCP and A2A** — agent-to-agent protocol support
- **Graph workflows** — declarative agent pipelines with streaming
- **Cross-language** — .NET + Python with consistent APIs
- **Microsoft-backed** — long-term maintenance assured
- **Cost controls, audit logging, policy-as-code** — compliance-ready

## Gaps (why we don't use it)

1. **Wrong stack.** .NET and Python; we're TypeScript-first within the Claude Code ecosystem. Adopting MAF means abandoning the Anthropic stack entirely.
2. **Enterprise framing, not solo-organism.** Designed for teams of business units negotiating resources, with enterprise identity systems and audit. Heavy for a single developer.
3. **No Claude Code Max economy.** API-billing assumption; doesn't compose with subscription quotas.
4. **No persona/agent maturity matching OMC's 32-agent set** — provides framework, not opinionated personas.
5. **Heavy install surface** — agent-framework-core, agent-framework-foundry, agent-framework-anthropic, etc. Many subpackages.
6. **No tasks.md substrate, no Watch, no constitutional layer, no self-improvement loop.**

## What we extract or learn

- **OpenTelemetry as a first-class concern** — validates our `Observability` adapter approach. Match their span schema where it makes sense for cross-system compatibility.
- **Time-travel debugging via checkpoints** — interesting idea; defer for later but track. Could combine with git event-sourcing for free replay.
- **A2A bridge support** — standard protocol for agent-to-agent communication; relevant if we ever bridge to non-OMC agents.
- **Graph-based workflow expression** — alternative to imperative orchestration; cleaner for some pipelines. Note for `claude-handoff-spec` design.

## Why we don't just use it

Adopting MAF means:

- Abandoning Claude Code Max for API billing (constitutional violation — wrong economy)
- Abandoning OMC's mature persona set (constitutional violation — reinventing personas)
- Adopting .NET/Python instead of the JS/TS substrate we share with tasks.md
- Inheriting enterprise complexity unsuited to solo-dev organism

The opportunity cost is enormous. MAF is great for the use case it serves; we serve a different one.

## Should we wrap Microsoft Agent Framework instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: STRUCTURAL MISMATCH — do NOT wrap.** The orchestrator-tier wrap fails the moat threshold (≤3 of 6 moats survive); the agent-tier sub-cases are dominated by OpenHands per the [Path C reshape plan](../docs/plans/2026-05-22-path-c-openhands-reshape.md); the cross-cutting feature absorptions (OTEL schema, graph-workflow expression) are already underway via Minsky's existing `Observability` adapter and don't require a wrap to capture.

Context — **MAF subsumes AutoGen**. Microsoft folded AutoGen into Microsoft Agent Framework at v1.0 (April 2026); the AutoGen brand is retired but its primitives — graph workflows (formerly GraphFlow), multi-agent planning (formerly MagenticOne), declarative pipelines — live on in MAF. The wrap-feasibility analysis below is the canonical answer for both AutoGen and MAF.

### The 5 questions

**1. Architectural fit.** MAF assumes a .NET or Python process owns the agent loop in-process. Streaming + checkpointing + time-travel debugging are in-memory primitives anchored to a single workflow execution. Minsky's architecture is a *daemon walking N hosts in round-robin*, spawning a per-task agent process per iteration, with state persisted on the operator's filesystem. The shapes don't align — MAF expects to be the long-lived process; Minsky expects to spawn short-lived agent processes. **No clean architectural fit.**

**2. What we delegate.** Three plausible delegation targets, only one of which would actually shrink Minsky's surface:

- **Graph-workflow orchestration (formerly AutoGen GraphFlow, now MAF graph workflows)** — declarative DAGs replacing Minsky's imperative `cross-repo-runner` tick loop. *Possible but moot* — Minsky's tick loop is per-host round-robin (not a single-execution DAG), so the structural fit is wrong; and per the Path C plan, the agent-loop layer goes to OpenHands, not MAF.
- **Multi-agent planning (formerly MagenticOne, now MAF)** — sub-agent orchestration with critic + verifier. *Already covered by OpenHands' DelegateTool + TaskToolSet + AgentDefinition* per the Path C plan § "Personas / sub-agent layer". MAF is a more elaborate version of the same primitive that OpenHands already provides at less integration cost.
- **OTEL schema + observability** — first-class distributed tracing, structured event log. *Already adopted as pattern, not as dependency* — `novel/adapters/observability/` matches MAF's OTEL conventions where they make sense (existing pattern-conformance row 24).

**3. What we keep.** All 6 moats — daemon-not-framework, operator-machine identity, constitution + deterministic CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface — survive structurally because MAF doesn't ship any of them. MAF is a *framework you embed in your application*; Minsky is *a daemon you attach to your repo*. The substitution doesn't happen — MAF doesn't compete with the daemon shell layer at all.

**4. Net moat after wrap.** If Minsky were to wrap MAF for the orchestrator layer (the most aggressive shape), the picture is bleak:

| Moat | Survives a hypothetical full MAF wrap? | Why |
|---|---|---|
| Daemon, not framework | ❌ | MAF IS the framework; the wrap turns Minsky into a MAF application |
| Operator-machine identity | 🟡 | Possible if MAF is configured to run as the operator, but the .NET/Python runtime adds attack surface and identity-propagation work |
| Constitution + CI | ✅ | Minsky still gates the agent's PRs regardless of orchestration runtime |
| MAPE-K substrate | ❌ | MAF's graph workflows replace Minsky's tick-loop substrate; the experiment-store + observer + spec-monitor layer is structurally orphaned |
| Cross-repo fleet | ❌ | MAF graph workflows are per-execution, not per-host-fleet; the `--hosts-dir` round-robin pattern has no equivalent |
| TASKS.md as operator surface | ❌ | MAF expects workflow YAML / .NET attributes; the operator-edits-markdown surface dies |

Net: **2 of 6 moats survive** (constitution+CI weakly, operator-machine identity partially). Below the ≥4-moat "worth proposing as P0" threshold per the wrap-feasibility skill's calibration. The Shape A (agent-layer only) sub-case is dominated by OpenHands per the Path C plan.

**5. Verdict — STRUCTURAL MISMATCH.** The architectural shape is wrong (framework vs daemon), the moat math is bleak (2/6), and the strongest sub-case (orchestrator wrap) is already dominated by OpenHands at the agent layer. **Do NOT wrap.** Continue extracting individual ideas (OTEL schema, graph-workflow expression for the future `claude-handoff-spec` substrate) without depending on the runtime.

### Trigger for re-evaluation

Re-run this analysis when ANY of these fire:

1. **Microsoft ships an MAF Daemon SKU** — explicitly designed for "run me forever on a task queue against N repos as the operator". Architectural shape would change; re-evaluate.
2. **OpenHands' Path C wrap fails the pivot threshold** (per `add-openhands-as-pluggable-backend` Pivot: <5pp SWE-bench delta). Then the agent-tier wrap of MAF becomes the next candidate — re-evaluate Shape A specifically.
3. **MAPE-K substrate ships closed-loop A/B prompt tuning (L2 from `user-stories/003`)** and Minsky's autonomic layer becomes structurally similar to MAF's graph-workflow checkpointing. Re-evaluate whether folding MAPE-K onto MAF's graph runtime is cheaper than maintaining our own.
4. **A 5th cloud agent is added to `~/.minsky/config.json` via the MAF SDK** — at that point, the wrap-feasibility math changes because the per-machine matrix expands.

## Pin / integration

Not a dependency. No adapter. Watch their OTEL span schemas for compatibility.

## Pattern conformance

- **Pattern MAF implements**: Graph-based workflow orchestration of agents (declarative pipelines, checkpointing, human-in-the-loop) — van der Aalst & van Hee, *Workflow Management: Models, Methods, and Systems*, MIT Press, 2002 (workflow nets and the four perspectives) — combined with three-signal observability — OpenTelemetry specification, CNCF (2020+)
- **Conformance level**: full (in the pattern MAF implements)
- **How Minsky relates**: don't adopt — wrong stack (.NET / Python) and enterprise framing. Minsky borrows the OTEL-as-first-class-concern lesson (already row 24, `@minsky/observability`) but rejects the graph-workflow runtime in favour of MAPE-K (row 5) and OMC handoffs.
- **Index row**: vision.md § "Pattern conformance index" row 49

## Last reviewed

2026-05-23 — wrap-feasibility analysis added per rule #1 + the Phase 7 discipline encoded in `.claude/skills/competitor-research/SKILL.md`. AutoGen brand retired (Microsoft folded it into MAF v1.0, April 2026); MAF subsumes the AutoGen primitives and is the canonical entity for wrap analysis going forward. Verdict: STRUCTURAL MISMATCH (orchestrator-tier wrap fails moat threshold 2/6; agent-tier sub-case dominated by OpenHands per the Path C plan).

Earlier reviews: 2026-05-03 (initial deep-dive — strengths, gaps, what we extract, why we don't use it).
