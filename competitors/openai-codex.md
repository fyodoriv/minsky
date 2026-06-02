# Competitor: OpenAI Codex (GPT-5.5)

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
- Higher published SWE-bench Verified score (GPT-5.5 reproduced at 0.826 vs Minsky's no-baseline-yet; was codex-1 0.721 in 2025-05)
- Backed by OpenAI's resources (frontier-model R&D pipeline, ChatGPT integration)

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `swe-bench-verified-resolve-rate`   | 0.826 | 2026-04-23 | OpenAI, "Introducing GPT-5.5", openai.com/index/introducing-gpt-5-5/, 2026-04-23 (GPT-5.5 is the flagship model powering Codex; SWE-bench Verified 0.826 per the independently-reproduced vals.ai scaffold, corroborated by interestingengineering.com at 0.827, used over OpenAI's headline 0.887; OpenAI emphasised SWE-bench Pro 0.586 for this release) |

The corpus tracks the independently-reproduced SWE-bench **Verified** reading (0.826) rather than OpenAI's headline (0.887) because the M1.10 catalogue's `swe-bench-verified-resolve-rate` values reproducible numbers over vendor-self-reported ones (rule #4 — visible, not flattering). OpenAI shifted its own emphasis to SWE-bench Pro (0.586) for GPT-5.5, but the corpus continues tracking Verified for cross-competitor comparability.

### Reading history

| Date       | Model    | Verified | Source |
| ---------- | -------- | -------- | ------ |
| 2026-04-23 | GPT-5.5  | 0.826    | OpenAI, "Introducing GPT-5.5" (current reading) |
| 2025-05-16 | codex-1  | 0.721    | OpenAI, "Introducing Codex" (pass@1; pass@8 = 0.838; 23 instances excluded as not-runnable on internal infrastructure) |

## Last reviewed

2026-06-02 (refreshed to GPT-5.5 reading via `/competitor-research`; supersedes 2026-05-22 codex-1 reading)
