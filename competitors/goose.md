# Competitor (stub): Goose

<!-- STUB — needs deep research per task `competitor-deep-research-tier-s-2026-05`. -->

> Block's (Square's parent) open-source terminal coding agent. MCP-native. Multi-model. Direct OSS competitor to Claude Code's harness shape. Worth deep research because if Goose is competitive with Claude Code as a terminal agent, it could be an alternative or complement to OpenHands at minsky's runtime layer.

- **URL**: <https://github.com/block/goose>
- **Site**: <https://block.github.io/goose/>
- **Status**: Active, Apache 2.0, backed by Block (large financial-services engineering org)
- **Pricing**: Free (OSS). BYO model API key.
- **Relationship**: **Competitor (pending deep research)** — same shape as Claude Code / OpenHands at the runtime layer

## What it is

An open-source CLI agent for software-engineering tasks. MCP-native (Anthropic protocol; Goose calls them "extensions"). Multi-model — Anthropic, OpenAI, Google, Ollama, Databricks, OpenRouter, Bedrock, others. Has a "recipes" pattern (reusable task templates) and a subagent / Tasks abstraction. Cross-platform (macOS, Linux, Windows). Both CLI and desktop GUI variants.

Distinct from OpenHands in that Goose is more terminal-native and less sandbox-heavy — closer to Claude Code's shape than to OpenHands' Docker-runtime shape.

## Strengths (what we know)

- **MCP-native** — Goose extensions are MCP servers; your existing MCP investment ports cleanly
- **Block-backed** — long-term maintenance signal; not a single-developer side project
- **Multi-model first-class** — model-provider abstraction is core to the design, not bolted on
- **Recipes pattern** — close conceptually to minsky's skills + briefs; worth comparing
- **Desktop GUI** — for teammates who don't live in a terminal
- **Hardware accelerator support** — some models can run via local accelerators (Apple silicon, CUDA)

## Gaps vs minsky's vision (initial read)

1. **Single-task focused.** Like Claude Code, designed for one task at a time. Not a daemon.
2. **No queue / fleet.** TASKS.md-equivalent doesn't exist.
3. **No MAPE-K / experiment store** — no cross-run learning loop.
4. **No persona pipeline** — recipes are templates, not multi-step orchestration with feedback.
5. **No literature-citation / rule-#9 gate.**

## OPEN: research questions for the deep write-up

1. How does Goose's recipes + Tasks abstraction map to minsky's skills + brief curation? Same problem solved differently, or different problems?
2. Is there published benchmark data (SWE-Bench Verified or equivalent) for Goose vs. Claude Code vs. OpenHands?
3. What's Goose's sandbox model? Worktree-like, container-like, or trust-the-user?
4. Could Goose be a third runtime adapter alongside OpenHands and Claude Code, or is it redundant?
5. Block uses Goose internally — what scale of unattended use does Block actually run? (Their public talks / blog posts will tell us.)

## Tentative verdict (pre-deep-research)

**Strong competitor, worth a runtime A/B alongside OpenHands.** The MCP-native + multi-model + Block-backed combination is the closest OSS shape to "Claude Code we can depend on." Adoption decision depends on the runtime A/B data and whether Goose's recipes pattern adds anything minsky doesn't already have via skills.

## Last reviewed

2026-05-22 — **STUB**. Deep research pending.
