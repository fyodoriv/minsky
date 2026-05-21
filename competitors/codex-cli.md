# Competitor: Codex CLI (OpenAI)

> OpenAI's terminal coding agent — overlapping problem space, adjacent execution model.

- **URL**: <https://github.com/openai/codex>
- **Status**: Active, early stage (launched 2025), OpenAI's CLI agent offering
- **Pricing**: Free (OSS). OpenAI API costs only.
- **Relationship**: **Competitor** — another CLI-first autonomous coding agent

## What it is

OpenAI's open-source CLI coding agent. Sandboxed execution (network-disabled by default). Uses OpenAI models (o3, o4-mini, GPT-4.1). Terminal-first, similar to Claude Code's `--print` mode. Can read, write, and execute code in a sandboxed environment.

## Strengths

- **OpenAI ecosystem** — native access to OpenAI's latest models (o3, o4-mini)
- **Sandboxed by default** — network disabled, filesystem restricted. Safer than most.
- **Open source** — Apache 2.0 (with some restrictions)
- **Simple CLI** — `codex "fix the bug in auth.ts"` is the entry point
- **Backed by OpenAI** — resources, visibility, ecosystem

## Weaknesses vs minsky's vision

1. **OpenAI-only** — only works with OpenAI models. No Claude, no local models.
2. **Early stage** — launched recently, less battle-tested than aider or Claude Code.
3. **No daemon mode** — single-shot task execution.
4. **No supervision** — no budget management, no watchdog, no restart.
5. **No task queue** — no TASKS.md processing.
6. **No multi-agent** — single agent.
7. **No self-improvement** — no MAPE-K, no prompt evolution.
8. **Limited model selection** — can't use Claude (the best coding model per most benchmarks).

## What we learn / steal

- **Default sandbox** — network-disabled by default is a strong security posture. Minsky's scope-leak detector is weaker.
- **Simple CLI UX** — `codex "do X"` is the simplest possible interface. Minsky should match this simplicity.

## Why choose minsky over Codex CLI

- Multi-model (Claude, Devin, local models — not locked to OpenAI)
- 24/7 daemon with supervision
- Task queue processing
- Multi-agent orchestration
- Self-improving

## Why choose Codex CLI over minsky

- If you're in the OpenAI ecosystem exclusively
- Simpler sandbox model
- Backed by OpenAI's resources

## Last reviewed

2026-05-18
