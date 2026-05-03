# Competitor: CrewAI

- **URL**: <https://crewai.com> / <https://github.com/crewAIInc/crewAI>
- **Status**: Active, large adoption
- **Relationship**: **Competitor** — adjacent space, generic rather than coding-specific

## What it is

Open-source framework for orchestrating role-playing autonomous AI agents. Each agent has role/goal/backstory plus optional LLM, memory, tools. "Crews" combine agents and tasks. Includes planning agent, reasoning, shared memory (short-term/long-term/entity/contextual), agentic RAG, manager agent.

## Strengths

- **Mature role-play orchestration** — the canonical "describe an agent's role, give it a task, run a crew" pattern
- **Memory architecture** — short-term/long-term/entity/contextual is sophisticated
- **Agentic RAG built in** — knowledge sources, query rewriting
- **Hundreds of open-source tools** — broad tool library
- **Active community, large adoption**
- **Reasoning agents** — agents reflect, refine plans, inject plans into task descriptions

## Gaps (why we don't use it)

1. **Not coding-specific.** CrewAI is generic role-play orchestration — agents can do anything. We're optimized for software development specifically, leveraging Claude Code's tooling, file editing, git, MCP, etc.
2. **Not Claude Code-native.** Generic LLM framework; doesn't compose with Claude Code Max economy or OMC's persona set.
3. **Heavy framework, not substrate.** You build inside CrewAI; it owns the runtime.
4. **No tasks.md compatibility, no Watch, no constitutional layer, no self-improvement loop.**
5. **Memory architecture is opinionated** — we'd have to live with it. Minsky's approach is git + tasks.md + handoffs as the substrate, much lighter.

## What we extract or learn

- **Role/goal/backstory persona shape** — useful framing; cross-check with Bratman BDI
- **Multiple memory types** — note as a design pattern; we may need similar in `claude-handoff-spec` (short-term per-task vs long-term project-wide)
- **Manager agent pattern** — the multi-agent-systems-literature term for the dispatcher / coordinator role; validate that the supervisor pattern is well-tested
- **Reasoning loop** — "reflect, refine plan, inject" is good shape for any persona's intentions section

## Why we don't just use it

- Generic framework where we want a coding-specific stack
- Adopting it would replace OMC, MCP, Claude Code Max — violations of constitutional principle 1 across the board
- Memory architecture would compete with the git-and-files substrate we've chosen

## Pin / integration

Not a dependency. No adapter. Cross-reference for memory pattern ideas.

## Last reviewed

2026-05-03
