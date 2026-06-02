# Competitor: OpenAI Codex (codex-1)

> OpenAI's cloud-based autonomous software-engineering agent — overlapping problem space, parallel-task execution model.

- **URL**: <https://openai.com/index/introducing-codex/> (cloud agent), <https://github.com/openai/codex> (Codex CLI, open-source)
- **Status**: Active. Codex CLI launched 2025-04-16; cloud agent (codex-1) launched 2025-05-16.
- **Pricing**: Cloud agent — included with ChatGPT Pro / Enterprise / Business / Plus. Codex CLI — free (Apache 2.0); pays OpenAI API costs per token.
- **Relationship**: **Competitor** — closed-commercial cloud agent + open-source CLI; same problem class as Minsky (autonomous coding), different execution model (cloud sandbox vs operator-machine daemon).

## What it is

OpenAI's autonomous-coding offering has two surfaces:

- **Cloud agent (codex-1)** — launched 2025-05-16 as a "cloud-based software engineering agent that can work on many tasks in parallel". Powered by `codex-1`, a version of OpenAI o3 fine-tuned via reinforcement learning on real-world coding tasks. Each task runs in its own isolated cloud sandbox, no internet access; tested at 192k context / medium reasoning effort. **SWE-Bench Verified pass@1 = 0.721** (per OpenAI's launch post; 23 instances excluded as not-runnable on OpenAI's internal infrastructure); pass@8 = 0.838.
- **Codex CLI** — launched 2025-04-16, open-source (Apache-2.0) terminal agent on GitHub at `openai/codex`. Sandboxed execution, network-disabled by default. Uses OpenAI models (o3, o4-mini, GPT-4.1).

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

## Why choose minsky over OpenAI Codex

- Multi-model (Claude, Devin, local models — not locked to OpenAI; cloud + offline-capable)
- 24/7 daemon with supervision (not single-shot task spawns; Minsky outlives any one task)
- Task queue processing (TASKS.md as the operator surface; codex-1 is per-task)
- Operator-machine daemon (not cloud-sandboxed — runs against the operator's existing repos with their git identity, no per-task clone)
- Self-improving (MAPE-K loop + prompt evolution; codex-1 is a fine-tuned static model)

## Why choose OpenAI Codex over minsky

- If you're in the OpenAI ecosystem exclusively and want OpenAI's best in-house agent scaffolding
- For task-parallelism in cloud sandboxes (codex-1 runs many tasks in parallel against fresh clones — easier to fan out without operator-machine resources)
- Higher published SWE-Bench Verified pass@1 score (0.721 vs Minsky's no-baseline-yet)
- Backed by OpenAI's resources (frontier-model R&D pipeline, ChatGPT integration)

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `swe-bench-verified-resolve-rate`   | 0.721 | 2025-05-16 | OpenAI, "Introducing Codex", openai.com/index/introducing-codex/, 2025-05-16 (codex-1, pass@1; 23 SWE-Bench Verified instances excluded as not-runnable on internal infrastructure; 192k context, medium reasoning effort; pass@8 also published at 0.838) |

The corpus also tracks `pass@8 = 0.838` in the citation string but does not promote it to a separate metric — the M1.10 catalogue's `swe-bench-verified-resolve-rate` is pass@1 by convention (matching how the other competitors' readings are extracted).

The Pinna et al. AIDev study (arXiv 2602.08915) that supplies the [`github-copilot-coding-agent.md`](github-copilot-coding-agent.md), [`cursor-agent.md`](cursor-agent.md), and [`claude-code.md`](claude-code.md) PR-acceptance readings also measured Codex at 0.779 overall acceptance over 2,002 PRs (Table 1). The corpus keeps Codex's `swe-bench-verified-resolve-rate` (0.721, OpenAI-primary) rather than promoting the AIDev acceptance proxy, because OpenAI publishes a Verified number directly; Copilot has no such primary number, so its entry keys on the AIDev acceptance rate instead.

## Last reviewed

2026-05-22 (added to scorecard corpus via `/competitor-research`)
