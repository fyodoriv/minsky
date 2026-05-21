# Competitor: ComposioHQ Agent Orchestrator (AO)

> Closest "autonomy + dashboard" competitor to Minsky's substrate, but framed PR-by-PR rather than as a 24/7 daemon.

- **URL**: <https://github.com/ComposioHQ/agent-orchestrator>
- **Package**: `@aoagents/ao-cli`
- **Status**: Active, MIT licensed
- **Relationship**: **Competitor** — closest "autonomy + dashboard" combo, but PR-centric framing

## What it is

A full-automation orchestration system: multiple agents running in isolated Git worktrees, each with its own PR, supervised from a single dashboard. Pushes hardest of any tool we've evaluated past session management into autonomous PR handling — agents fix CI failures, respond to review comments, and manage PR lifecycle without per-edit approval.

## Strengths

- **True autonomy past session management** — agents persist long enough to handle CI failures and review comments, not just one prompt-response
- **Per-agent worktree isolation** — each agent works in its own Git worktree, no stepping on each other
- **Single dashboard** — supervisor view across all agents
- **Production-grade PR lifecycle** — fixes CI, responds to review comments, manages branch state
- **Fits CI/CD-shaped teams** — natural surface for engineering organizations

## Gaps (what Minsky differs on)

1. **PR-centric, not viability-centric.** AO optimizes for "merge this PR autonomously"; Minsky optimizes for "stay alive and useful for years." Different objective functions.
2. **No constitutional layer.** No vision-document grounding; no critique against a constitution.
3. **No self-improvement of agent prompts.** Agents don't evolve based on outcome metrics over time.
4. **No theoretical grounding** in cybernetic / VSM / supervision-tree literature; ad hoc engineering.
5. **No mobile / Watch surface.** Dashboard is desktop-bound.
6. **No token-economy awareness** for Claude Code Max subscription dynamics.
7. **Team / organizational framing.** Built for teams; not solo-developer-organism shaped.
8. **No tasks.md substrate.** Internal task representation.

## What we extract or learn

- **Worktree-per-agent isolation** — strong pattern; OMC's `team` mode does similar with shared task list. Reinforces that worktree isolation is canonical.
- **Autonomous PR lifecycle handling** — important capability for the operations layer; potentially addable as an OMC mode or as a Minsky persona that listens for review comments
- **Dashboard supervising multiple agents** — UI inspiration for our web dashboard
- **CI failure → autonomous fix** — useful pattern; should be in the persona repertoire

## Why we don't just use it

- Wrong objective (PR-centric vs viability-centric)
- Doesn't compose with Claude Code Max economy
- No solo-developer / mobile / Watch surface
- Adopting it would mean orienting the whole project around PR throughput — Minsky's whole framing is the long arc, not the next merge

## Pin / integration

Not a dependency. No adapter. Worth periodic re-review for patterns to extract.

## Pattern conformance

- **Pattern AO implements**: Multi-agent orchestration with isolated workspaces and a central supervisor / dashboard — Wooldridge, *An Introduction to MultiAgent Systems*, 2nd ed., Wiley, 2009, Ch. 6 (cooperative distributed problem solving); Ousterhout et al., "Sprite Network Operating System", *IEEE Computer* 1988 (per-agent isolation as the workspace primitive)
- **Conformance level**: full (in the pattern AO implements)
- **How Minsky relates**: don't adopt — the objective function differs (PR-throughput vs years-long viability). Minsky's worktree-per-agent inspiration is taken from OMC (row 50), not from AO directly.
- **Index row**: vision.md § "Pattern conformance index" row 46

## Last reviewed

2026-05-03
