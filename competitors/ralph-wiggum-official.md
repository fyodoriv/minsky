# Competitor / Dependency: Anthropic's official ralph-wiggum plugin

> Anthropic's official ralph-wiggum plugin — adopted as Minsky's `InnerLoop` primitive (the per-iteration step).

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

## Five pivot questions

Unlike the closed-commercial competitors, ralph-wiggum is an **adopted in-tree dependency** — the pivot questions are answered from the "do we keep depending on it?" angle, not the "should we wrap a rival?" angle. The deny-list lens of rule #1 still applies: every dependency must justify its continued presence each review.

### 1. How is it different from Minsky?

Ralph is the **per-session inner loop**; Minsky is the **cross-session outer loop**. The plugin's whole job is to keep one Claude Code session iterating on one task until a `--completion-promise` token is observed or `--max-iterations` is hit (Anthropic claude-code/plugins/ralph-wiggum; Geoffrey Huntley's "Ralph technique" post). It deliberately stops at the session boundary — it has no daemon, no `TASKS.md` queue, no budget economy, no MAPE-K self-improvement, no cross-repo fleet, and no constitution-enforcement CI. Minsky is the layer that survives session death (moat #1 daemon-not-framework), runs on the operator's identity (moat #2), is governed by a constitution it owns (moats #3, #4), self-improves (moat #5), and spans repos (moat #6). The relationship is compositional, not competitive: Ralph is the smallest replaceable unit *inside* one Minsky iteration.

### 2. What lessons can it give to us?

- **A single explicit completion token forces testable task descriptions** (`--completion-promise`) — already extracted (see `## What we extract or learn`): make this discipline explicit in the `TASKS.md` `**Acceptance**:` / `**Success**:` field so every task carries one observable exit condition, mirroring Ralph's exit gate.
- **The Stop-hook re-feed is a minimal-moving-parts loop primitive** — the official plugin shows a loop can be a hook + a prompt re-feed with no external bash `while`; this is the clean reference shape for any future hook-based supervision logic Minsky writes (behind `novel/adapters/` per rule #2).
- **`--max-iterations` as the bounded-termination guard** — validates Minsky's own tick-iteration backstop (`check-mape-k-tick-iteration-backstop.mjs`): an unbounded loop is a stability bug, and the official plugin treats bounding as non-negotiable, not optional.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding; the task hypothesis is confirmed.** The hypothesis predicted Q5 would be all-KEEP with no replace candidate and that Q2 might surface refinements from the official-plugin form. That is exactly what was observed: the three lessons are technique/discipline level (completion-token discipline, hook-loop shape, bounded termination) — none forces a rewrite of `vision.md § What Minsky is` or invalidates any of the 17 rules. Ralph being an *official* Anthropic plugin (vs Huntley's original bash loop) lowers the maintenance risk of the dependency but does not change Minsky's thesis. No vision-threat is emitted (the central `ask-human.md` channel records negative findings; the orchestrator owns that write per the deepen-existing convention).

### 4. How can we improve our strategy based on this?

- **Make the completion-token discipline a first-class `TASKS.md` field expectation** — strategy move traceable to lesson §2.1: every P0/P1 task should carry one observable `**Success**:`/`**Acceptance**:` exit condition, the queue-level analogue of Ralph's `--completion-promise`.
- **Keep the inner/outer-loop split explicit in positioning** — the cleanest articulation of Minsky's moat is "we are the outer loop around tools like Ralph"; lean on Ralph as the canonical inner-loop reference rather than re-explaining the loop primitive from scratch (traces to §1).
- **Treat bounded-termination as a stability invariant, not a config knob** — lesson §2.3: keep the tick-iteration backstop a deterministic gate so an unbounded loop can never ship, matching the official plugin's non-optional `--max-iterations`.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Ralph is the *inner* loop within one iteration; the outer cross-session tick-loop is precisely what Ralph lacks. Nothing to replace; the two compose.
- **MAPE-K**: KEEP — Ralph has no monitor/analyze/plan/execute self-improvement substrate; out of scope for a session-bound plugin.
- **adapters / InnerLoop**: ALREADY-ADOPTED — Ralph *is* the `inner-loop.ralph-wiggum.ts` implementation behind `novel/adapters/inner-loop.ts`. This is the one surface where the answer is "we already use it"; the replace-candidate is `frankbria/ralph-claude-code` only if we need extra safety rails (rate-limit handling, circuit breaker), which the outer supervisor currently provides instead.
- **sandbox**: N/A — Ralph runs inside the Claude Code session; sandboxing is the supervisor's concern.
- **corpus / scorecard**: N/A — Ralph is a dependency, not a benchmarked rival; it carries no scorecard reading.
- **dashboard / TASKS.md surface**: KEEP — Ralph has no task queue or Watch; these are Minsky differentiators.

**Total replace % across all surfaces: 0% net new** — the InnerLoop surface is *already* delegated to Ralph (the intended end-state), and every other surface is KEEP/N/A. The headline for the operator: *all-KEEP, no replace candidate; the dependency is healthy (official Anthropic plugin, low risk); absorb the completion-token discipline lesson into the task-field expectations.*

## Last reviewed

2026-06-02 — deepened with the Five Pivot Questions framework per task `competitor-deepen-ralph-wiggum-official`. Verdict: all-KEEP, no replace candidate; ralph-wiggum is the already-adopted `InnerLoop` dependency (official Anthropic plugin, low risk). Lesson to absorb: make the `--completion-promise`-style completion-token discipline a first-class `TASKS.md` `**Success**:`/`**Acceptance**:` expectation. No vision change; the negative finding is owned by the central `ask-human.md` channel per the deepen-existing convention.
