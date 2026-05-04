# Competitor / Dependency: Anthropic's official ralph-wiggum plugin

- **URL**: <https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum>
- **Origin**: Geoffrey Huntley's "Ralph technique" (named after Ralph Wiggum), formalized by Boris Cherny (Head of Claude Code) into an official plugin
- **Status**: Active, official Anthropic plugin
- **Relationship**: **Dependency** — adopted as our `InnerLoop` primitive

## What it is

A Claude Code plugin that implements the Ralph technique using a Stop hook. The Stop hook intercepts Claude's exit attempts and feeds the same prompt back, creating a self-referential loop until a user-defined completion promise is observed.

Usage:

```text
/ralph-loop "Your task description" --completion-promise "DONE" --max-iterations 50
```

The loop happens inside the current session — no external bash loop required.

## Strengths

- **Official Anthropic** — long-term maintenance assured; ships in the Claude Code repo
- **Elegant mechanism** — Stop hook + prompt re-feed; minimal moving parts
- **In-session** — no need for external supervision for the loop itself
- **Configurable completion gate** — the `--completion-promise` token gates exit
- **Bounded** — `--max-iterations` prevents runaway

## Gaps

1. **Session-bound.** The loop dies when the Claude Code session dies. No outer supervision; no cross-session state. (This is the gap Minsky's outer supervisor fills.)
2. **In-session context accumulation.** Long Ralph runs grow the context window; combine with `/compact` discipline.
3. **No safety rails beyond max-iterations** — no rate-limit handling, no token-budget awareness, no circuit breaker for systematic failures. (frankbria's third-party Ralph adds these; consider as upgrade path.)
4. **Single completion gate** — one promise token. More sophisticated gating (multiple criteria, weighted scoring) is OMC's `architect-verification` job.
5. **No structured handoffs** — it's a self-loop, not a multi-persona pipeline. (OMC layers structured handoffs on top.)

## What we use it for

- **Inner loop primitive within a single task.** When a task has `**Tags**: relentless` or requires verify-before-done, OMC's Ralph mode (which uses this plugin under the hood) drives the loop.
- **Reference implementation** of the Ralph technique. Useful when we need to inspect mechanics or understand failure modes.

## What we extract or learn

- **Stop-hook-based loop pattern** — clean, minimal. Worth understanding for any future hook-based supervision logic.
- **`--completion-promise` discipline** — the explicit completion token forces task descriptions to be testable. We should make this discipline explicit in tasks.md `**Acceptance**:` field.
- **Boris Cherny's framing** ("your second shift") — useful articulation for marketing/docs
- **Origin story** — Geoffrey Huntley's bash-loop-named-after-Ralph-Wiggum is the canonical anecdote for the technique. Cite when explaining it.

## Pin / integration

- **Adapter**: `novel/adapters/inner-loop.ts` interface; `inner-loop.ralph-wiggum.ts` implementation
- **Replacement candidates**: frankbria/ralph-claude-code (third-party, more safety rails); custom (only if needed)
- **Risk**: Low — official plugin, standard mechanism

## Open questions

- How does `--max-iterations` interact with token-budget pause? (The supervisor may interrupt mid-iteration.) Probably fine — Stop hook just won't fire again — but verify.
- Does the plugin's prompt re-feed protect or invalidate the prompt cache prefix? Affects token economy. Test in practice.

## Pattern conformance

- **Pattern Ralph implements**: Read-Eval-Print Loop / fixed-point iteration with a bounded termination predicate — McCarthy, "Recursive Functions of Symbolic Expressions and Their Computation by Machine, Part I", *Communications of the ACM* 3(4) 1960 (the REPL and fixed-point iteration as the substrate of LISP); Knuth, *The Art of Computer Programming*, Addison-Wesley, 1968, Vol. 1 § 1.2.1 (bounded iteration discipline)
- **Conformance level**: full (in the pattern Ralph implements)
- **How Minsky relates**: adopt — Ralph is the `InnerLoop` primitive (`novel/adapters/inner-loop.ts`). The outer Minsky supervisor (row 4) wraps Ralph's per-session loop with cross-session continuity, token-budget awareness, and the MAPE-K self-improvement loop (row 5).
- **Index row**: vision.md § "Pattern conformance index" row 51

## Last reviewed

2026-05-03
