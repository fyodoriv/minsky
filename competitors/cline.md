# Competitor (stub): Cline

<!-- STUB — needs deep research per task `competitor-deep-research-tier-s-2026-05`. -->

> Fastest-growing OSS VSCode-based coding agent in 2025-2026. MCP-native. Worth deep research because it occupies the IDE-integrated niche minsky doesn't, and because its growth curve suggests something we can learn from regardless of whether we adopt it.

- **URL**: <https://github.com/cline/cline>
- **Site**: <https://cline.bot>
- **Status**: Active, Apache 2.0, very high VSCode marketplace install count
- **Pricing**: Free (OSS). User brings their own API key (Anthropic / OpenAI / OpenRouter / Bedrock / local).
- **Relationship**: **Competitor (pending deep research)** — different surface (IDE extension) from minsky's daemon

## What it is

An open-source VSCode extension that runs an autonomous coding agent inside the IDE. Plan/Act modes (plan first, get approval, then act). MCP-native (one of the earliest non-Anthropic adopters). Computer-use capable on supported models. Built-in cost tracking. Multi-model. Reads diffs through VSCode's native diff viewer.

Distinct from Claude Code (terminal) and Cursor (closed IDE with embedded agent) in that it's *open-source* + *VSCode-extension-shaped*.

## Strengths (what we know)

- **MCP-native from early days** — supports custom MCP servers as tools, matches your existing MCP investment
- **Built-in cost tracking** — minsky should have this; cline does
- **Plan/Act mode separation** — natural fit for rule-#9 pre-registration (the "plan" step is the hypothesis declaration)
- **VSCode-native diff UX** — better review affordance than terminal diff
- **Multi-model out of the box** — Anthropic / OpenAI / OpenRouter / Bedrock / Ollama / LM Studio
- **Very active development** — multiple releases per month in 2025-2026
- **Computer-use support** — can drive a browser when the model supports it (Claude Sonnet 3.5+, Computer Use API)

## Gaps vs minsky's vision (initial read)

1. **IDE-bound, not daemon-shaped.** Closes when VSCode closes. Not a 24/7 unattended runner.
2. **One task at a time.** No queue, no fleet, no multi-host walker.
3. **No experiment store or MAPE-K** — single-session, no cross-run learning.
4. **No persona pipeline** — single agent loop, no research → plan → implement → QA decomposition.
5. **No literature-citation gate** — no rule-#1 enforcement.

## OPEN: research questions for the deep write-up

1. Does Cline have a headless / background mode that could turn it into a daemon-runtime alternative to OpenHands?
2. How does the Plan/Act model compare to OpenHands' plan/run/review on multi-step tasks? (Both occupy the same agent-runtime layer.)
3. What MCP servers does the Cline community publish that minsky could adopt?
4. Is the cost-tracking implementation accurate enough to copy or wire into minsky?
5. Does Cline's computer-use integration give it an edge on tasks that need browser automation (which minsky punts to `playwright-best-practices` skill + agent-browser)?

## Tentative verdict (pre-deep-research)

**Reference, not direct competitor or dependency.** It's at a different surface (IDE extension) and the daemon-vs-extension shape difference is structural. The interesting question is what we *learn* from its growth curve and feature choices (MCP-native, Plan/Act split, cost-tracking).

## Last reviewed

2026-05-22 — **STUB**. Deep research pending.
