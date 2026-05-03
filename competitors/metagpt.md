# Competitor: MetaGPT

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

## Last reviewed

2026-05-03
