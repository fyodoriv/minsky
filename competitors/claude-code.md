# Competitor: Claude Code (Anthropic)

> Anthropic's first-party coding agent — used by Minsky as a `cloud_agent` backend; also a primary direct competitor for autonomous-coding workflows.

- **URL**: <https://www.anthropic.com/claude-code>
- **Status**: Active, GA since Feb 2025
- **Pricing**: Pay-per-token via Anthropic API (Claude Sonnet / Opus pricing)
- **Relationship**: **Integration + Competitor** — Minsky uses Claude Code as a cloud agent (`cloud_agent: "claude"`); also competes as a standalone autonomous-coding product.

## What it is

Anthropic's coding agent — runs locally (CLI or VS Code extension), reads
your codebase, edits files, runs tests, submits PRs. Built natively on
the Claude API with first-party tooling (file ops, shell, web). Strong
performance on agentic coding benchmarks (SWE-bench Verified, AIDev
acceptance studies). Lowest-friction integration for teams already on
Claude.

## Strengths

- **SWE-bench Verified leader** — 0.49 resolve rate (Anthropic 2025-02-24, Claude 3.7 Sonnet + Claude Code agentic harness).
- **Documentation + features task strength** — 92.3% acceptance on docs, 72.6% on features per the AIDev study (Pinna et al. arXiv 2602.08915, 2026-02-09).
- **First-party tooling** — file ops, shell, web all built by Anthropic; no third-party adapter shims to maintain.
- **Local execution** — runs on the developer's machine; no cloud VM tax.
- **VS Code + CLI** — first-class IDE integration plus a scriptable CLI for automation.
- **Active development** — ships frequently with the Claude model cadence.

## Weaknesses vs Minsky's vision

1. **No 24/7 daemon** — Claude Code is interactive or scripted, not a persistent supervisor. No overnight unattended loop, no budget management, no automatic restart.
2. **No self-improvement** — no MAPE-K loop, no autonomous prompt optimization. Improves when Anthropic ships updates, not when it runs on your repo.
3. **Token cost scales with use** — heavy daily use can reach $100+/mo per developer on the Claude API. No local-model fallback.
4. **Single-agent** — one Claude per session. No brain+workers, no model routing, no multi-agent orchestration.
5. **No competitive benchmarking** — Anthropic publishes their own SWE-bench number; doesn't measure itself against alternatives in your context.
6. **No multi-repo support** — works on one repo at a time.

## What we learn / steal

- **First-party tool integration** — the cleanest tool-use UX in the agent market. Minsky's adapter pattern aims for the same separation between agent and tools.
- **SWE-bench as the public metric** — Anthropic publishes scores; the Minsky scorecard uses the same metric for direct comparison.
- **Pay-per-token transparency** — Claude Code's pricing model is transparent and predictable; Minsky's cost-per-merged-PR metric inherits this discipline.
- **Local execution** — Minsky's local-model fallback mode (aider + ollama) is the same philosophy.

## Why choose Minsky over Claude Code

- 24/7 daemon mode with budget management and supervision
- Multi-agent orchestration (Claude is one of several agents Minsky drives)
- Self-improving (MAPE-K loop on prompt evolution)
- Local-model fallback (zero token cost when on local models)
- Competitive self-benchmarking (Minsky measures itself against Claude Code, not just against Anthropic's own numbers)
- Multi-repo walker

## Why choose Claude Code over Minsky

- Best-in-class single-agent coding performance (highest SWE-bench)
- First-party Anthropic support
- Simpler — no daemon, no orchestration, just `claude` in your terminal
- VS Code integration out of the box
- Lower setup friction

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source                                                                                                                                                                                                                                                |
| ----------------------------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.49  | 2025-02-24 | Anthropic, *Claude 3.7 Sonnet and Claude Code*, anthropic.com, 2025-02-24 — SWE-bench Verified, agentic harness.                                                                                                                                              |
| `autonomous-merge-rate`             | 0.726 | 2026-02-09 | Pinna, Gong, Williams, Sarro, *Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance*, arXiv 2602.08915, 2026-02-09 — AIDev dataset, Claude Code features-task acceptance at 72.6% (it also leads documentation tasks at 92.3%). |
| `human-intervention-rate`           | 0.274 | 2026-02-09 | Inverse of autonomous-merge-rate per the same AIDev source.                                                                                                                                                                                                  |

Note: The autonomous-merge-rate of 0.726 is Claude Code's features-task
acceptance rate per the AIDev study, not an aggregate. The 0.923 docs
number is higher but features are the more demanding category, so 0.726
is used as the conservative proxy. If Anthropic publishes an aggregate
PR acceptance number across task types, replace this reading.

## Last reviewed

2026-05-22
