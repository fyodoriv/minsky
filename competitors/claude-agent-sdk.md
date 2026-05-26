# Dependency-candidate (stub): Claude Agent SDK

<!-- STUB — needs deep research per task `competitor-deep-research-tier-s-2026-05`. -->

> Anthropic's official SDK for building agents on Claude — successor to claude-code-sdk. If mature in 2026, it's table-stakes for any Claude-first agent stack. Minsky already depends on Claude Code (the harness) and OMC (the persona layer); this SDK sits one level below — the programmatic primitives.

- **URL**: <https://github.com/anthropics/claude-agent-sdk> (presumed — needs verification)
- **Docs**: <https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk>
- **Status**: Active per Anthropic's agent ecosystem positioning (needs version-confirm 2026-05)
- **Pricing**: SDK is free; Anthropic API costs apply
- **Relationship**: **Dependency-candidate (pending deep research)** — likely already partially used through Claude Code

## What it is

Anthropic's official SDK for building autonomous agents on Claude. Provides primitives for tool definition, conversation management, subagent spawning, plan/act workflows, file editing primitives, MCP server hosting, and (presumably) the structured Skills loading mechanism that Claude Code uses. The SDK is the layer at which third parties build Claude-Code-shaped applications without rebuilding the harness from scratch.

If our understanding is correct, this SDK is *what Claude Code is built on*, exposed for external use. That makes it a likely dependency for any minsky component that needs to invoke Claude programmatically — replacing custom subprocess wrapping with a stable Anthropic-maintained API.

## Strengths (what we know / expect)

- **Anthropic-maintained** — long-term stability, ships in lockstep with Claude model releases
- **Native skill loading** — markdown skills with YAML frontmatter, same format as your existing skill library
- **Native MCP** — first-class MCP server support
- **Subagent spawning** — programmatic version of Claude Code's Task tool
- **Tool / function calling primitives** — typed, validated
- **Planning + thinking integration** — likely exposes extended-thinking and plan-mode

## Gaps vs minsky's vision (initial read — needs verification)

1. **Claude-only.** Wrong choice for the cross-model strategy. Minsky needs Claude + OpenAI + local model paths; the Claude Agent SDK only covers one.
2. **Single-task shape.** Like Claude Code, the SDK is for building agent-loops, not daemons.
3. **No fleet / autonomic loop.** Stays at the agent-runtime layer; doesn't replace minsky's MAPE-K supervisor or experiment store.
4. **Possibly Python-only or TS-only** — need to verify language coverage.

## OPEN: research questions for the deep write-up

1. **What is the SDK's current state in May 2026?** Released, GA, or still in preview? Latest version + changelog?
2. **Is it the right substrate for `novel/adapters/agent-runtime.claude.ts`** to replace minsky's current subprocess wrapping of `claude` CLI?
3. **How does it compose with OpenHands?** Could an OpenHands session use the Claude Agent SDK as its model adapter, getting Anthropic-maintained primitives instead of OpenHands' raw API calls?
4. **What does it do that we should stop duplicating?** Specifically: subagent spawning, MCP hosting, skill loading. If the SDK does these well, our equivalents are rule-#1 violations.
5. **License + governance** — Anthropic-owned. What's the lock-in risk if Anthropic deprecates or changes the SDK?

## Tentative verdict (pre-deep-research)

**Likely a partial dependency for the Claude-backend adapter, not the runtime layer.** OpenHands handles the cross-model runtime; the Claude Agent SDK handles the *Claude-specific* primitives more cleanly than minsky's current subprocess wrapping. Result: `novel/adapters/agent-runtime.openhands.ts` for the general case, `novel/adapters/agent-runtime.claude.ts` using Claude Agent SDK for Claude-only runs. The two coexist.

## Last reviewed

2026-05-22 — **STUB**. Deep research pending. Existence and version need confirming first.
