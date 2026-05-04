# Competitor: Microsoft Agent Framework

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

## Pin / integration

Not a dependency. No adapter. Watch their OTEL span schemas for compatibility.

## Pattern conformance

- **Pattern MAF implements**: Graph-based workflow orchestration of agents (declarative pipelines, checkpointing, human-in-the-loop) — van der Aalst & van Hee, *Workflow Management: Models, Methods, and Systems*, MIT Press, 2002 (workflow nets and the four perspectives) — combined with three-signal observability — OpenTelemetry specification, CNCF (2020+)
- **Conformance level**: full (in the pattern MAF implements)
- **How Minsky relates**: don't adopt — wrong stack (.NET / Python) and enterprise framing. Minsky borrows the OTEL-as-first-class-concern lesson (already row 24, `@minsky/observability`) but rejects the graph-workflow runtime in favour of MAPE-K (row 5) and OMC handoffs.
- **Index row**: vision.md § "Pattern conformance index" row 49

## Last reviewed

2026-05-03
