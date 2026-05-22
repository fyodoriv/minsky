# Competitor: Cursor Agent (Anysphere)

> IDE-bound agent (inner loop) complementary to Minsky's outer loop (24/7 background daemon).

- **URL**: <https://cursor.com>
- **Status**: Active, massive adoption, VS Code fork with AI-native features
- **Pricing**: Free tier, Pro $20/mo, Business $40/mo
- **Relationship**: **Complementary** — minsky targets the outer loop; Cursor targets the inner loop (IDE)

## What it is

AI-native code editor (VS Code fork) with deep agent integration. Agent mode can autonomously implement features, fix bugs, refactor code — all within the IDE. Background agents run tasks while you work on other things. Tab completion, chat, and autonomous agent are seamlessly integrated.

## Strengths

- **IDE integration** — the agent lives in your editor, sees your cursor, understands your context
- **Background agents** — run tasks in parallel while you code (Cursor's agent-mode)
- **Massive adoption** — millions of developers, battle-tested on real codebases
- **Fast iteration** — Anysphere ships features weekly
- **Multi-model** — Claude, GPT-4, and custom models
- **Affordable** — $20/mo for Pro with generous usage

## Weaknesses vs minsky's vision

1. **IDE-bound** — can't run headless, no daemon mode, no CLI-only operation.
2. **No 24/7 supervision** — agents stop when you close the IDE.
3. **No task queue** — works on what you ask in the moment. No TASKS.md processing.
4. **No budget management** — no token economy awareness, no automatic pause.
5. **No cross-repo** — one project at a time.
6. **No self-improvement** — Anysphere improves Cursor; Cursor doesn't improve itself per-repo.
7. **Vendor lock-in** — proprietary editor. Your workflow depends on Anysphere's decisions.
8. **No competitive benchmarking** — doesn't measure itself against alternatives.

## What we learn / steal

- **Background agents** — Cursor's approach to "agent works while you do other things" is exactly minsky's daemon model, but IDE-bound. Minsky is the headless version.
- **Context awareness** — Cursor's agent sees your open files, cursor position, recent edits. Minsky's brief should include similar context from the repo structure.
- **UX simplicity** — "just works in the IDE" is a powerful model. Minsky's install should feel this effortless.

## Why choose minsky over Cursor Agent

- Headless — runs 24/7 without an IDE open
- Cross-repo task queue processing
- Budget management and supervision
- Self-improving
- Open source, no vendor lock-in

## Why choose Cursor Agent over minsky

- Better for interactive development (you're coding and the agent assists)
- IDE context awareness (sees your cursor, open files)
- More polished UX for daily coding
- Lower barrier — already in your editor

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                  | Value | Date       | Primary source                                                                                                                                                                                                                                       |
| ----------------------- | ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous-merge-rate` | 0.804 | 2026-02-09 | Pinna, Gong, Williams, Sarro, *Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance*, arXiv 2602.08915, 2026-02-09 — AIDev dataset, Cursor leads fix-task acceptance at 80.4%.                                            |

Note: The 80.4% is Cursor's fix-task acceptance rate per the AIDev
study, not an aggregate across all task types. The AIDev study reports
that no single agent leads every task category (Cursor excels at fixes,
Claude Code at docs and features, Codex broadly). Used here as the
autonomous-merge-rate proxy with the caveat documented in the citation.

## Last reviewed

2026-05-22
