# Competitor: MetaGPT

> Foundation-Agents' multi-role coding-agent framework — closest conceptual match, but Python-stacked and not 24/7-aligned.

- **URL**: <https://github.com/FoundationAgents/MetaGPT>
- **Paper**: ICLR 2024 — "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"
- **Status**: Active, large adoption
- **Relationship**: **Competitor** — closest conceptual match, but wrong stack

## What it is

A Python framework that simulates a "software company" of LLM agents: Product Manager, Architect, Project Manager, Engineer, QA. Takes a one-line requirement and outputs user stories, competitive analysis, requirements, data structures, APIs, and code. Tagline: "Code = SOP(Team)" — the system materializes Standard Operating Procedures and applies them to teams of LLMs.

## Strengths

- **Most direct conceptual analog** to Minsky's persona-driven philosophy
- **Roles already match** — PM/Architect/Engineer/QA/etc. mirror what we'd want
- **Battle-tested** — academic paper, large GitHub adoption, real production usage
- **One-line requirement → full project** — proves the autonomous-team paradigm works
- **Open source** — MIT-style licensing

## Gaps (why we don't use it as substrate)

1. **Wrong stack.** Python framework around generic GPT models. Minsky is Claude Code-native by design — to use Max subscription economy, OMC's persona system, native MCP and OTEL, the whole Anthropic ecosystem.
2. **No 24/7 viability framing.** MetaGPT is request-response: requirement in, project out. No long-running supervisor, no token-budget homeostasis, no mid-session pause/resume.
3. **No self-improvement loop.** Roles are static prompts; no metacognitive layer that observes performance and rewrites agent prompts over time.
4. **No constitutional grounding.** No vision-document layer; behavior drift is undetected.
5. **Heavy framework, not substrate.** MetaGPT owns the runtime; you build inside it. Minsky is the opposite — substrate-first, integrating tools others maintain.
6. **No mobile/Watch/remote** for solo developers running things on personal hardware.
7. **No tasks.md compatibility** — its task representation is internal Python objects.

## What we extract or learn

- **Role taxonomy** — MetaGPT's PM/Architect/Engineer/QA mapping is near-canonical; cross-check against OMC's 32 agents to find gaps
- **SOP framing** — "Code = SOP(Team)" is a useful aphorism for the human-readable task description discipline
- **Competitive analysis output** — MetaGPT auto-generates competitor analysis as part of project bootstrap; consider whether our `competitors/` folder generation could be agent-assisted
- **Validation that the persona-driven paradigm works** — reduces our risk by ~one academic paper

## Why we don't just use it

Stack incompatibility is fatal. We'd lose:

- Claude Code Max economy (MetaGPT bills per token via API)
- OMC's 32-agent maturity
- Native MCP and OTEL
- The tasks.md substrate

Adopting MetaGPT would mean rebuilding our orchestration, observability, and economy layers from scratch — exactly what `vision.md` principle 1 forbids.

## Pin / integration

Not a dependency. No adapter.

## Pattern conformance

- **Pattern MetaGPT implements**: Simulated software company / Standard Operating Procedure role-play across PM / Architect / Engineer / QA roles — Hong et al., "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework", *ICLR* 2024 (the primary paper) — anchored in the older organisational-design pattern of the chief-programmer team — Brooks, *The Mythical Man-Month*, Addison-Wesley, 1975, Ch. 3 ("The Surgical Team")
- **Conformance level**: full (in the pattern MetaGPT implements)
- **How Minsky relates**: don't adopt — Minsky shares the persona-driven paradigm but binds it to Claude Code via OMC (row 50) rather than to a Python+GPT runtime. The conceptual lineage is acknowledged; the substrate is incompatible.
- **Index row**: vision.md § "Pattern conformance index" row 48

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `humaneval-pass-at-1`               | 0.859 | 2024-05-07 | Hong, Zhuge, Chen, Zheng et al., "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework", arXiv 2308.00352, ICLR 2024 Oral (HumanEval Pass@1 = 85.9%, SoTA at publication; 28.2% relative improvement over GPT-4; methodology: Standardized Operating Procedure-shaped multi-agent assembly line) |

MetaGPT also published `mbpp-pass-at-1 = 0.877` in the same paper, which is tracked in the citation string but not yet promoted to a separate metric in the M1.10 catalogue. Promotion path: add `mbpp-pass-at-1` if a second orchestrator-tier competitor publishes the same metric (avoid single-source metrics per rule #9 — vanity-metrics forbidden).

## Last reviewed

2026-05-23 (added to scorecard corpus via `/competitor-research` as the first orchestrator-tier competitor)
