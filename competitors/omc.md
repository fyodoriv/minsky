# Competitor: Oh My Claude Code (OMC)

- **URL**: <https://github.com/Yeachan-Heo/oh-my-claudecode>
- **Site**: <https://ohmyclaudecode.com>
- **Status**: Active, v4.13.x as of 2026-05, 31.3k GitHub stars, MIT licensed
- **Relationship**: **Dependency** — adopted as our `Orchestrator` layer

## What it is

Zero-config multi-agent orchestration plugin for Claude Code. 32 specialist agents (architect, executor, qa-tester, code-reviewer, designer, security-reviewer, debugger, verifier, test-engineer, tdd-guide, planner, critic, analyst, product-manager, product-analyst, quality-strategist, scientist, writer, vision, dependency-expert, and more). 40+ skills. Four execution modes (autopilot, ultrawork, team, ralph). Smart Haiku/Sonnet/Opus routing claiming 30-50% token savings. Architect verification gate.

## Strengths

- **Mature persona roster** — 32 agents, more comprehensive than we'd build from scratch
- **Multiple coordination modes** — sequential (autopilot), parallel (ultrawork), team-with-shared-task-list, relentless-verified (ralph)
- **Smart model routing built in** — Haiku for simple tasks, Opus for reasoning, automatic
- **Architect verification gate** — Ralph mode never says "done" until verified
- **Inter-agent messaging** — built into Team mode
- **Massive community** — 31k+ developers, 100+ articles, plugins ecosystem
- **MIT, free forever** — no licensing risk
- **Plugin distribution** — clean install via Claude Code marketplace

## Gaps (what Minsky adds above it)

1. **24/7 viability outside a session.** OMC is session-bound. No outer supervisor, no cross-session continuity, no auto-restart, no "ship while you sleep" beyond a single in-session Ralph loop.
2. **Token economy as a system constraint.** Smart routing optimizes per-call but is unaware of 5-hour windows or weekly caps; no auto-pause near limits; no error budget.
3. **MAPE-K loop / self-improvement.** OMC's architect verifies one task. It doesn't observe drift across tasks or rewrite agent prompts based on observed failures over weeks.
4. **Constitutional grounding.** No vision.md → no critique against a constitution → no detection of behavioral drift.
5. **DSPy-style prompt evolution.** Agents are static. No A/B variants tested against measurable metrics.
6. **tasks.md integration.** Internal "shared task list" is OMC-specific; not tasks.md-spec compatible. (We've proposed this upstream as a community contribution.)
7. **Mobile / Watch / remote.** Pure CLI with HUD; no iPhone, Watch, or remote control surface.
8. **Cross-repo Roam.** Project-scoped per session; doesn't roam between repos like tasks.md `/next-task` does.
9. **Theoretical grounding.** Empirically excellent but ad hoc — no published VSM/Hewitt/supervision-tree framing. Matters for long-term evolvability and for documentation/teachability.

## What we extract or learn

- **Persona roster** — adopt all 32; no need to write our own
- **Architect-verification gate** — extend the pattern to runtime specification monitoring at the meta-level (`claude-spec-monitor`)
- **Smart routing implementation** — borrow patterns for our `claude-budget-guard`
- **Plugin distribution model** — Minsky may itself eventually ship as a Claude Code plugin

## Why we don't just use it

We do, for the layer it covers. Minsky is the layer above. From `vision.md`:

> OMC handles "do this task well right now." Minsky handles "stay alive, on-budget, on-mission, and getting better, indefinitely."

OMC explicitly does not address the long-running viability layer; Minsky exists to fill that gap and curate OMC into a full stack with the supervisor, observability, mobile, and meta-improvement pieces.

## Pin / integration

- **Version**: v4.13.x (minor-floating; integration tests gate updates)
- **Adapter**: `novel/adapters/orchestrator.omc.ts` (forthcoming)
- **Replacement procedure**: write `orchestrator.<replacement>.ts`; switch the import; run integration tests

## Open issues we're tracking

- **Native tasks.md integration upstream** — file an issue proposing OMC `/team` mode optionally reads from `TASKS.md`. Tracked as P1 `omc-tasksmd-issue`.
- **Handoff persistence** — does OMC's shared task list persist to disk parseably? Determines bridge complexity. Tracked as P0 `research-omc-handoff-persistence`.

## Last reviewed

2026-05-03
