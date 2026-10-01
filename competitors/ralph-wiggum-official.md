# Competitor: Anthropic's official ralph-wiggum plugin

> A plugin that keeps one coding session looping on a task until it is done — adopted as Minsky's inner-loop primitive, the per-iteration step.

- **URL**: <https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum>
- **Status**: Active, official Anthropic plugin
- **Pricing**: Free (ships in the Claude Code repository)
- **Origin**: Geoffrey Huntley's "Ralph technique" (named after Ralph Wiggum), formalized by Boris Cherny (Head of Claude Code) into an official plugin
- **Relationship**: **Dependency** — Minsky uses it as the inner-loop primitive

## What this is

ralph-wiggum is a small plugin for Claude Code, the coding assistant (the
agent — the assistant Minsky drives to do the actual work). The plugin makes
one assistant session keep working on a single task instead of stopping after
one answer.

It works through a Stop hook. A Stop hook is a piece of code that runs when the
assistant tries to exit. ralph-wiggum's hook catches that exit and feeds the
same prompt back in. The session loops on the task until one of two things
happens: the assistant prints a completion token you chose, or it hits a
maximum number of rounds.

You start it with one command inside a session:

```text
/ralph-loop "Your task description" --completion-promise "DONE" --max-iterations 50
```

`--completion-promise "DONE"` is the exit token: the loop stops once the
assistant outputs `DONE`. `--max-iterations 50` is the safety cap: the loop
stops after 50 rounds no matter what. The whole loop runs inside the current
session — no external shell loop is needed.

## What this is not

- Not a daemon (a background program that keeps running on your machine,
  survives terminal close, and restarts on crash). The loop dies when the
  session dies.
- Not a task picker. It has no `TASKS.md` (the plain-text to-do list at a
  project's root that Minsky reads to pick work). You hand it one task by hand.
- Not a self-improvement loop. It does not study its own results.
- Not a rival to Minsky. It is the smallest replaceable unit *inside* one
  Minsky iteration (one round of work: pick a task, ask an agent to do it,
  capture the result, open a draft).

## Strengths

- **Official Anthropic.** Ships in the Claude Code repository, so long-term
  maintenance is assured.
- **Elegant mechanism.** A Stop hook plus a prompt re-feed — minimal moving
  parts.
- **In-session.** The loop needs no outside supervision to run.
- **Configurable exit gate.** The `--completion-promise` token decides when the
  loop is done.
- **Bounded.** `--max-iterations` prevents a runaway loop.

## Weaknesses vs Minsky's vision

1. **Session-bound.** The loop dies when the session dies. There is no outer
   watchdog and no state carried between sessions. This is the gap Minsky's
   supervisor fills — the supervisor is the outer watchdog (systemd on Linux,
   launchd on macOS) that restarts Minsky if it dies and survives reboots.
2. **Context grows over long runs.** A long Ralph run fills the context window;
   pair it with `/compact` discipline.
3. **No safety rails beyond the iteration cap.** No rate-limit handling, no
   token-budget awareness, no circuit breaker for repeated failures. A
   third-party Ralph (frankbria/ralph-claude-code) adds these and is a possible
   upgrade path.
4. **One exit gate.** A single completion token. Richer gating (several
   criteria, weighted scoring) lives in Minsky's verification layer, not here.
5. **No structured handoffs.** It is a self-loop, not a pipeline of personas (a
   persona is a role the agent takes on — researcher, planner, implementer, QA).
   Minsky layers structured handoffs on top.

## What we learn / steal

- **Stop-hook re-feed as a loop primitive.** A loop can be a hook plus a prompt
  re-feed, with no external shell `while`. This is the clean reference shape for
  any future hook-based supervision logic Minsky writes — and it goes behind an
  adapter per rule #2 (a small wrapper file that lets Minsky talk to one outside
  tool through a fixed interface, so the tool can be swapped without touching the
  rest of the code).
- **`--completion-promise` forces testable tasks.** One explicit exit token
  makes a task description state how you know it is done. Minsky should make this
  discipline a first-class expectation in the `TASKS.md` `**Acceptance**:` /
  `**Success**:` field, so every task carries one observable exit condition.
- **`--max-iterations` as a bounded-termination guard.** The official plugin
  treats bounding the loop as non-negotiable. This validates Minsky's own
  backstop (`check-mape-k-tick-iteration-backstop.mjs`): an unbounded loop is a
  stability bug, not a config choice.
- **Boris Cherny's "your second shift" framing** — a useful articulation for
  docs.
- **Origin story.** Geoffrey Huntley's bash-loop-named-after-Ralph-Wiggum is the
  canonical anecdote for the technique; cite it when explaining the loop.

## Why choose Minsky over ralph-wiggum

Ralph is the **per-session inner loop**; Minsky is the **cross-session outer
loop**. Ralph's whole job is to keep one session iterating on one task until the
`--completion-promise` token appears or `--max-iterations` is hit. It stops at
the session boundary on purpose. It has no daemon, no `TASKS.md` queue, no token
budget, no self-improvement loop, no cross-repo fleet, and no rule-enforcement
CI.

Minsky is the layer that survives session death, runs under your own identity
(work runs as you, under your own git and SSH credentials), is governed by its
own constitution (the numbered, non-negotiable project rules in `vision.md`),
self-improves, and walks several repos in turn. The two compose; they do not
compete.

## Why choose ralph-wiggum over Minsky

Reach for Ralph directly, not Minsky, when you want one session to grind on one
task that you are already watching. It is the smaller, simpler tool: one command,
no background process, no to-do list, no setup. If you do not need cross-session
continuity or a task queue, the inner loop alone is enough — and it is the exact
piece Minsky delegates to for that job.

## Scorecard readings

None. ralph-wiggum is an adopted dependency, not a benchmarked rival, so it
carries no scorecard reading (the scorecard is the dated, cited table of
competitor benchmark numbers).

## Should we wrap ralph-wiggum instead?

We already do. Ralph is the implementation behind Minsky's inner-loop adapter.

- **Adapter**: `novel/adapters/inner-loop.ts` (the interface);
  `inner-loop.ralph-wiggum.ts` (the implementation).
- **Replacement candidates**: `frankbria/ralph-claude-code` (third-party, more
  safety rails) if Minsky ever needs rate-limit handling or a circuit breaker
  the supervisor does not already provide; a custom implementation only if
  needed.
- **Risk**: Low — official plugin, standard mechanism.

Two open questions on the integration:

- How does `--max-iterations` interact with Minsky's token-budget pause? The
  supervisor may interrupt mid-iteration. Probably fine — the Stop hook simply
  will not fire again — but verify.
- Does the prompt re-feed protect or invalidate the prompt cache prefix? This
  affects token cost. Test in practice.

## Five pivot questions

ralph-wiggum is an **adopted in-tree dependency**, so these questions are
answered from the "do we keep depending on it?" angle, not the "should we wrap a
rival?" angle. The deny-list lens of rule #1 (don't reinvent) still applies:
every dependency must justify its presence each review.

### 1. How is it different from Minsky?

Ralph is the per-session inner loop; Minsky is the cross-session outer loop.
Ralph keeps one session iterating on one task until the `--completion-promise`
token appears or `--max-iterations` is hit (Anthropic claude-code/plugins/
ralph-wiggum; Geoffrey Huntley's "Ralph technique" post). It stops at the
session boundary on purpose: no daemon, no `TASKS.md` queue, no budget economy,
no self-improvement loop, no cross-repo fleet, no rule-enforcement CI. Minsky is
the layer that survives session death (moat #1, daemon-not-framework), runs on
the operator's identity (moat #2), is governed by a constitution it owns
(moats #3, #4), self-improves (moat #5), and spans repos (moat #6). The
relationship is
compositional, not competitive: Ralph is the smallest replaceable unit inside
one Minsky iteration.

### 2. What lessons can it give to us?

- **A single explicit completion token forces testable task descriptions**
  (`--completion-promise`) — already captured in "What we learn / steal": make
  this discipline explicit in the `TASKS.md` `**Acceptance**:` / `**Success**:`
  field so every task carries one observable exit condition, mirroring Ralph's
  exit gate.
- **The Stop-hook re-feed is a minimal-moving-parts loop primitive** — the
  official plugin shows a loop can be a hook plus a prompt re-feed with no
  external shell `while`. This is the clean reference shape for any future
  hook-based supervision logic Minsky writes (behind `novel/adapters/` per
  rule #2).
- **`--max-iterations` as the bounded-termination guard** — validates Minsky's
  own backstop (`check-mape-k-tick-iteration-backstop.mjs`): an unbounded loop
  is a stability bug, and the official plugin treats bounding as
  non-negotiable.

### 3. Are any of these lessons potentially vision-changing?

No. The task hypothesis is confirmed. The hypothesis predicted question 5 would
be all-KEEP with no replace candidate, and that question 2 might surface
refinements from the official-plugin form. That is what was observed: the three
lessons are technique- and discipline-level (completion-token discipline,
hook-loop shape, bounded termination). None forces a rewrite of `vision.md`
§ "What Minsky is" or invalidates any of the 17 rules. Ralph being an *official*
Anthropic plugin (versus Huntley's original bash loop) lowers the maintenance
risk of the dependency but does not change Minsky's thesis. No vision-threat is
emitted; negative findings are recorded on the central `ask-human.md` channel,
which the orchestrator owns per the deepen-existing convention.

### 4. How can we improve our strategy based on this?

- **Make the completion-token discipline a first-class `TASKS.md` field
  expectation** — traceable to lesson 2.1: every P0/P1 task should carry one
  observable `**Success**:` / `**Acceptance**:` exit condition, the queue-level
  analogue of Ralph's `--completion-promise`.
- **Keep the inner/outer-loop split explicit in positioning** — the cleanest
  articulation of Minsky's moat is "we are the outer loop around tools like
  Ralph". Lean on Ralph as the canonical inner-loop reference rather than
  re-explaining the loop primitive from scratch (traces to question 1).
- **Treat bounded-termination as a stability invariant, not a config knob** —
  lesson 2.3: keep the tick-iteration backstop a deterministic gate so an
  unbounded loop can never ship, matching the official plugin's non-optional
  `--max-iterations`.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Ralph is the inner loop within one iteration; the outer
  cross-session tick-loop is precisely what Ralph lacks. Nothing to replace; the
  two compose.
- **MAPE-K**: KEEP — Ralph has no Monitor/Analyze/Plan/Execute self-improvement
  substrate; out of scope for a session-bound plugin.
- **adapters / inner-loop**: ALREADY-ADOPTED — Ralph *is* the
  `inner-loop.ralph-wiggum.ts` implementation behind `novel/adapters/
  inner-loop.ts`. This is the one surface where the answer is "we already use
  it"; the replace candidate is `frankbria/ralph-claude-code` only if we need
  extra safety rails (rate-limit handling, circuit breaker), which the outer
  supervisor currently provides instead.
- **sandbox**: N/A — Ralph runs inside the session; sandboxing is the
  supervisor's concern.
- **corpus / scorecard**: N/A — Ralph is a dependency, not a benchmarked rival,
  so it carries no scorecard reading.
- **dashboard / `TASKS.md` surface**: KEEP — Ralph has no task queue or Watch;
  these are Minsky differentiators.

**Total replace across all surfaces: 0% net new.** The inner-loop surface is
*already* delegated to Ralph (the intended end-state), and every other surface
is KEEP or N/A. The headline for the operator: all-KEEP, no replace candidate;
the dependency is healthy (official Anthropic plugin, low risk); absorb the
completion-token discipline lesson into the task-field expectations.

## Pattern conformance

- **Pattern Ralph implements**: Read-Eval-Print Loop / fixed-point iteration
  with a bounded termination predicate — McCarthy, "Recursive Functions of
  Symbolic Expressions and Their Computation by Machine, Part I",
  *Communications of the ACM* 3(4) 1960 (the REPL and fixed-point iteration as
  the substrate of LISP); Knuth, *The Art of Computer Programming*,
  Addison-Wesley, 1968, Vol. 1 § 1.2.1 (bounded iteration discipline).
- **Conformance level**: full (in the pattern Ralph implements).
- **How Minsky relates**: adopt — Ralph is the inner-loop primitive
  (`novel/adapters/inner-loop.ts`). The outer Minsky supervisor wraps Ralph's
  per-session loop with cross-session continuity, token-budget awareness, and
  the MAPE-K self-improvement loop.
- **Index row**: `vision.md` § "Pattern conformance index" row 51.

## Last reviewed

2026-06-02 — deepened with the Five Pivot Questions framework per task
`competitor-deepen-ralph-wiggum-official`. Verdict: all-KEEP, no replace
candidate; ralph-wiggum is the already-adopted inner-loop dependency (official
Anthropic plugin, low risk). Lesson to absorb: make the
`--completion-promise`-style completion-token discipline a first-class
`TASKS.md` `**Success**:` / `**Acceptance**:` expectation. No vision change; the
negative finding is owned by the central `ask-human.md` channel per the
deepen-existing convention.
