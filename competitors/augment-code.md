# Competitor: Augment Code (Augment SWE-bench agent)

> Augment's open-source SWE-bench agent — the #1 published open-source agent on SWE-bench Verified at the time of its submission. Pure agent-scaffolding research, not a full IDE product.

- **URL**: <https://github.com/augmentcode/augment-swebench-agent> (open-source agent); <https://www.augmentcode.com> (Augment IDE product surface)
- **Status**: Active. Open-source agent repo created 2025-03-28; last pushed 2025-06-09; 872 stars / 154 forks at first scan. Augment Code (the commercial IDE product, "Cosmos" / "CLI") is separately active with subscription pricing.
- **Pricing**: Open-source agent — free, MIT-style OSS. Commercial product — subscription tiers on `augmentcode.com/pricing`.
- **Relationship**: **Competitor** — agent scaffolding research (the SWE-bench agent itself) overlaps Minsky's space directly; the commercial Augment IDE is adjacent (VS Code / JetBrains / Neovim extension, not a 24/7 daemon).

## What it is

Two distinct surfaces:

- **`augmentcode/augment-swebench-agent`** — a standalone agent scaffolding (Python, 99.4% by language) that runs against SWE-bench Verified. Achieved **65.4% resolve rate on SWE-bench Verified** with Claude Sonnet 3.7 as the core driver + OpenAI o1 as the ensembler (published 2025-03-31). Forked from Anthropic's own SWE-bench blog post architecture; the main delta vs Anthropic's published approach was using Anthropic's sequential-thinking MCP tool to fill in the "planning" gap left out of Anthropic's post + o1 ensembling.
- **Augment Code (commercial)** — IDE product with retrieval-aware context engine, available in VS Code, JetBrains, Neovim. Different surface; the OSS agent above is the public benchmark artifact.

## Strengths

- **Open-source agent at SOTA** — at submission, the highest published OSS agent on SWE-bench Verified (65.4%); the implementation is fully reproducible from the GitHub repo.
- **Hybrid model ensembling** — Sonnet 3.7 as driver + o1 as ensembler is a non-obvious design choice that the team documented.
- **Honest about benchmark limitations** — the launch post explicitly enumerates SWE-bench's weaknesses (Python-only, smaller-than-prod codebases, descriptive-task framing) and says "scores are largely driven by foundation model quality".
- **Production focus** — the commercial product layers in Linear / Jira / Notion / Google Search / Slack integrations + memory of developer feedback, none of which SWE-bench evaluates.

## Weaknesses vs Minsky's vision

1. **Not a 24/7 daemon** — the OSS agent is a benchmark runner (Docker per task, fresh clone); doesn't persist or self-supervise.
2. **No operator-machine identity** — runs in Docker containers against fresh clones, not against the operator's existing repos with their git identity.
3. **OpenAI dependency** — the published 65.4% uses o1 as the ensembler, so it's not a Claude-pure path; replacing o1 changes the published number.
4. **Single-task framing** — designed for SWE-bench's per-issue resolve-or-fail evaluation; no TASKS.md-style multi-task queue, no work-stealing across tasks.
5. **No self-improvement** — the system architecture is static (forked from Anthropic's blog); no MAPE-K, no prompt-evolution loop, no specification monitor.
6. **No safety substrate** — no scope-leak detector, no budget management, no watchdog kill-switch beyond Docker timeout.

## What we learn / steal

- **Sequential-thinking MCP for planning** — Augment found Anthropic's `sequential-thinking` MCP filled the same role as Anthropic's unpublished planning tool. Minsky's Researcher/Manager personas already use a similar shape; the validator that the LLM's output is structured (vs free-text "thinking") is the substrate.
- **Honest benchmark-limitation framing** — the launch post's "this benchmark leans toward small-bug fixes; task descriptions are unrealistically LLM-friendly" is a model for how Minsky's own competitive-benchmark README should caveat published numbers.
- **Open-source reproducibility as a marketing artifact** — Augment shipped the agent source the same day they announced the score. That's the credibility move. The Minsky `bin/minsky competitive` JSON + competitors.ts citations is the same shape, applied to the corpus instead of an agent.

## Why choose Minsky over Augment Code

- 24/7 operator-machine daemon (not a benchmark runner): Minsky outlives any one task; Augment's OSS agent is per-task.
- Multi-task queue: TASKS.md is the operator surface, not a single SWE-bench issue per spawn.
- Self-improving: MAPE-K + prompt evolution; Augment's published 65.4% is a fixed architecture.
- Multi-vendor: not locked to Sonnet+o1 ensembling; Minsky's adapter substrate works with Claude, Devin, aider+local.
- Operator-machine git identity: Augment runs in Docker against fresh clones; Minsky commits as the operator into their existing repos.

## Why choose Augment Code over Minsky

- For SWE-bench-style isolated task running: the published 65.4% Verified resolve rate is a reproducible baseline.
- Honest model: open-source, well-documented architecture, no marketing fog around the benchmark approach.
- Commercial product is mature (VS Code / JetBrains / Neovim extensions; Linear/Jira/Notion integrations; memory of developer feedback over time).
- If you want a benchmarkable agent scaffolding to study rather than a 24/7 system to operate.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `swe-bench-verified-resolve-rate`   | 0.654 | 2025-03-31 | Chen & Flaherty, "#1 open-source agent on SWE-Bench Verified by combining Claude 3.7 and O1", augmentcode.com/blog, 2025-03-31 (Claude Sonnet 3.7 driver + o1 ensembler; methodology forked from Anthropic SWE-bench post + sequential-thinking MCP; reproducible at github.com/augmentcode/augment-swebench-agent) |

## Last reviewed

2026-05-22 (added to scorecard corpus via `/competitor-research`)
