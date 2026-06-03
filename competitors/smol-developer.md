# Competitor: Smol Developer (smol-ai/developer)

> A 2023 "your own junior developer" tool: hand it a product spec as one prompt, and it writes a whole new codebase in a single pass. It went viral, then went dormant — and that death is the cleanest proof that Minsky's opposite bet (improve real code one small step at a time) is load-bearing.

- **URL**: <https://github.com/smol-ai/developer>
- **Author**: Shawn "swyx" Wang (smol.ai)
- **Status**: **Dormant / effectively dead** — ~12k★, ~1k forks. The original thesis (one prompt → whole codebase) was abandoned. The project's own README pivoted to calling itself "the *first* agent that scaffolds a repo and then hands off to a more capable iterative agent," and smol-ai itself moved on to media work (AI News / Latent Space). No sustained product development; the repo is a historical reference, not a maintained tool. It is years past the 180-day post-mortem threshold.
- **Pricing**: Free (MIT, open source); you pay your own OpenAI API cost per generation.
- **Relationship**: **Post-mortem / thesis-falsifier reference.** Not a backend Minsky would wrap, and not a live competitor. It is a dead artifact whose failure validates Minsky's wager: improve existing code incrementally, don't regenerate it (Minsky moats #1, #4, #6).

## What this is

Smol Developer is a small 2023 Python script — the headline version was a few hundred lines — built on one idea: treat a plain-English product spec as the entire program, and treat the model as a one-shot compiler from spec to repo. You write a `prompt.md` describing the app you want. Then the script calls the model to plan the file tree, generate each planned file in a fresh call seeded with the shared spec, and write the files to disk.

First, a definition the rest of this file leans on. An **agent** here means a coding assistant that does the actual work — Claude Code, Devin, Aider, or OpenHands. Minsky is not an agent; Minsky orchestrates agents. Smol Developer is closer to a one-shot generator than to one of these iterative agents, and that distinction is the whole story.

The pitch — "a smol developer inside your IDE" / "your own junior developer" — was that the prompt is the source of truth and the code is a disposable, regenerable artifact. Change the prompt, re-run, get a new codebase. Two framings made it culturally important in mid-2023:

- **Prompt as source code.** Smol Developer popularized the idea that the durable asset is the spec, not the generated files. You iterate the `prompt.md`, not the `.py`. This is its most-cited idea — and the one that aged the worst.
- **Library, not app.** swyx pitched it as a building block ("a smol developer you embed and customize," later "the first step of a multi-agent pipeline") rather than a finished product. That framing anticipated the scaffold-then-hand-off pattern that survives in today's agents.

The trajectory is the lesson. A viral one-shot whole-codebase demo under-delivered on the iteration half of software — you don't write a codebase once, you change it ten thousand times — and the author re-cast it as a "first step / scaffolder" precisely because the one-shot thesis didn't carry past the first generation.

## What this is not

- Not a live competitor — it is dormant and unmaintained.
- Not an agent Minsky could spawn to edit an existing repo. Its model is regenerate-from-prompt, with no diff against the current tree.
- Not a wrap target. The relevant action is lesson extraction, not delegation (see the wrap verdict below).

## Strengths

- **Conceptual clarity and mindshare** — it crisply named "prompt as source of truth" at the moment the whole field was reaching for it. The ~12k★ and the "smol AI" brand were real distribution.
- **Minimalism as a feature** — the implementation was deliberately tiny and readable, which made it an excellent teaching artifact for how spec-to-code generation works under the hood. Minsky shares this "small custom core" instinct (rule #1, don't reinvent — the novel layer is intentionally a few hundred lines).
- **Honest re-framing toward scaffolding** — rather than keep selling one-shot autonomy, swyx re-cast the tool as a scaffolder that hands off to more capable agents. That re-framing is itself the lesson (see Post-mortem).
- **Parallel per-file generation** — generating each file in its own model call, seeded with the shared spec, was a clean parallel decomposition that prefigured the "fan-out then assemble" shape of later codebase generators.

## Weaknesses vs Minsky's vision

The frame for these weaknesses: **Minsky** is a background program — a **daemon**, meaning a program that keeps running in the background on your machine — that picks the most important unfinished task from a project's to-do list, asks an agent to do it, and prepares the result as a draft for you to review. The contrasts below all trace back to that.

1. **One-shot generation, not incremental improvement.** Smol Developer regenerates the codebase from the prompt. It has no concept of editing the code you already have against a changed requirement. Real software is overwhelmingly modification of existing code, not greenfield generation. Minsky's whole thesis is the inverse: small, supervised, falsifiable improvements to a real, living repo (Minsky moats #1, #6). This is the single load-bearing difference.
2. **No state across runs.** Each generation is independent — no memory of prior runs, no diff against the current tree, no preservation of human edits. Re-run and your hand-tuned changes are gone. Minsky operates on the actual git tree, commits incrementally, and never throws away working code.
3. **No daemon, no work-selection.** Smol Developer is a one-shot command-line tool a human invokes. It does not run unattended, does not pick its own next task, and does not stay alive. Minsky's loop selects the next task from `TASKS.md` — the plain-text Markdown to-do list at a project's root that Minsky reads to pick work — and runs around the clock (Minsky moat #6).
4. **No constitution, no deterministic enforcement.** There is no equivalent of Minsky's 17-rule constitution — the numbered, non-negotiable project rules in `vision.md` — gated by automated lints (`pnpm pre-pr-lint --stage=full`). Generated-code correctness is entirely the user's problem (Minsky moat #3).
5. **No self-improvement substrate.** The generator is static. There is no MAPE-K loop — Monitor, Analyze, Plan, Execute over a Knowledge base — that tunes the system from its own outcome history (Minsky moat #4).
6. **No operator-machine identity, no supervised loop.** Smol Developer runs as an ad-hoc script. It has no notion of running as the **operator** (the human who runs Minsky, under their own git and SSH credentials), no **supervisor** (the outer watchdog that restarts the program if it dies), and no let-it-crash recovery (Minsky moats #2, #6).

## What we learn / steal

- **One-shot-vs-incremental is the most valuable extract.** Smol Developer is the cleanest proof that generating a whole codebase in one pass is a demo, not a workflow, because software's cost lives in the ten-thousand later edits, not the first generation. Minsky's incremental thesis (rule #1, improve don't reinvent; rule #6, bounded surviving loop) is the antidote, and this competitor is the citation that the antidote is load-bearing.
- **"Prompt as source of truth" is half-right, and worth bounding.** The durable-spec idea survives in Minsky as `TASKS.md` plus `user-stories/*.md` plus `vision.md` — the specs are the durable asset. But Minsky never treats the code as disposable. It treats the spec as the thing to satisfy by editing the real tree. Steal the spec-centric framing; reject the regenerate-the-code corollary.
- **Scaffold-then-hand-off is a real pattern.** swyx's re-framing — Smol Developer as the first step that scaffolds, then hands off to a more capable iterative agent — prefigures Minsky's compose-existing-agents instinct (rule #1 plus the adapter layer). Minsky is itself a "hand off to the most capable agent" orchestrator. It just does so as a supervised daemon rather than a one-shot scaffolder.
- **Minimalism is a moat, not a constraint.** The tiny readable core is convergent evidence for Minsky's "small novel layer behind interfaces" design (rule #2). Worth noting as a shared instinct, not a thing to adopt wholesale.

## Post-mortem

> Smol Developer is not alive. This section records what died, why, and what survived as framing.

- **What died**: the central promise — write one prompt, get a whole working codebase, iterate by editing the prompt and regenerating. The project went dormant; the smol-ai org redirected energy toward media, and the original generator stopped being a maintained product.
- **Root cause (architectural dead-end, not a business or funding failure)**: one-shot generation cannot survive contact with an evolving codebase. The thesis assumed the code was disposable and regenerable from the spec, but real software is dominated by modification — fixing one bug, adding one field, refactoring one module — none of which a regenerate-from-scratch tool can do without destroying everything else. Within about a year the field moved to iterative, tool-using agents that read and edit existing files, run tests, and loop on feedback, precisely because that is the shape of real work. Smol Developer's own README pivot toward "scaffolder / first step of a pipeline" is the author conceding this: the one-shot generator's durable role shrank to bootstrapping an empty repo, after which a more capable iterative agent takes over.
- **Why the pivot was inevitable (the guardrail for Minsky)**: a one-shot generator has no place to put the second edit. The instant a human, or the world, changes a requirement, the tool's only move is to throw away the existing code and regenerate — which is unacceptable the moment there is any working code worth keeping. This is a structural property of the architecture, not a tuning problem. More capable models make the first generation better, but they do not give a regenerate-from-scratch tool a way to do incremental, edit-preserving change. The pivot to "scaffolder + hand-off" is the only stable equilibrium for the one-shot shape.
- **What survived / the re-framing**: the idea — prompt-as-source-of-truth, markdown-driven development, scaffold-then-hand-off — survives as influential framing and is visible in many later tools' design vocabulary. The product did not.
- **Lesson for Minsky (mandatory)**: Minsky's guardrail against this death mode is its incremental-improvement-on-a-real-tree architecture, plus rule #9 (pre-registered hypothesis-driven development — every change states its hypothesis, success threshold, pivot threshold, measurement command, and literature anchor before code is written) and rule #6 (stay alive — a bounded loop that operates on the live git tree and never discards working code). Minsky never regenerates a codebase. It makes one small, supervised, falsifiable change at a time against the actual repo, commits it, and survives. Smol Developer is the empirical case study that the one-shot shape has nowhere to put the second edit — and that "the field will move to more capable iterative agents" is not a market accident but the inevitable consequence of that architectural gap.

## Why choose Minsky over Smol Developer

- **Incremental edits on a real git tree** versus one-shot regeneration that discards your existing code on every run.
- **A daemon that runs around the clock and selects its own work** from `TASKS.md` versus a one-shot command-line tool a human invokes once per generation.
- **State and memory** — commits accumulate, human edits are preserved, the MAPE-K loop learns from outcomes — versus independent, memoryless runs.
- **Constitution plus deterministic CI enforcement** (17 rules, `pnpm pre-pr-lint --stage=full`) versus generated-code correctness being entirely the user's problem.
- **Bounded, falsifiable autonomy** (rule #9 pivot thresholds, rule #6 stay-alive) versus an abandoned one-shot generator whose own author re-cast it as merely "the first step."

## Why choose Smol Developer over Minsky

- If your need is **literally bootstrapping an empty repo from a spec, once** — a greenfield scaffold you will then take over by hand — the one-shot shape is a clean fit, and Minsky is overkill.
- If you want a **tiny, readable teaching artifact** for how spec-to-code generation works under the hood — Smol Developer's minimal core is an excellent reference, though dormant.
- There is no live-product reason to choose Smol Developer today; it is not maintained.

## Scorecard readings (mindshare/post-mortem reference — not wired into `novel/competitive-benchmark/src/competitors.ts`)

Smol Developer is documented here as a **post-mortem / thesis-falsifier reference**, intentionally NOT added to the live M1.10 corpus (`competitors.ts`). The M1.10 scorecard compares Minsky against agent and orchestrator peers on shared capability metrics (SWE-bench Verified, HumanEval Pass@1, DORA, agentic). Smol Developer published **no vendor-primary reading on the M1.10 catalogue** — its famous number is a star count, and the autonomous product is dead — so wiring it in would violate the validator's published-primary rule (rule #4, visible, no fabricated readings). The values below are recorded for context only.

| Metric (context only — not an M1.10 metric id) | Value | Date | Primary source |
| --- | --- | --- | --- |
| GitHub stars | ~12,000 | 2026-06 | github.com/smol-ai/developer (repo header). |
| License | MIT | 2023 | github.com/smol-ai/developer (LICENSE). |
| Status | Dormant — one-shot thesis abandoned | 2026-06 | github.com/smol-ai/developer (README pivot to "scaffolder / first step"); no sustained product development. |

No capability number (SWE-bench / HumanEval / agentic) is published for Smol Developer, which is itself the point: a viral one-shot generator competes on mindshare and on the idea, not on a measurable resolve rate.

## Should we wrap Smol Developer instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with one question: if this is amazing at everything we do, why not wrap it and run for 24h? Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a wrap target. Smol Developer is a one-shot greenfield generator, not an agent command-line tool Minsky can spawn the way it spawns `claude`/`devin`/`aider` to edit an existing repo. Its whole model (regenerate from prompt, no diff against current tree) is the opposite of Minsky's incremental-edit loop. It is also dormant and unmaintained. |
| 2. **What we delegate** | Nothing structural. At most, the scaffold-an-empty-repo niche could be a one-time bootstrap idea — but Minsky's agents already scaffold via normal edits, so there is nothing to delegate. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution + CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface) — no wrap happens. |
| 4. **Net moat after wrap** | 6 of 6 (no wrap). The relevant action is lesson extraction, not delegation. |
| 5. **Verdict** | **NO (DEAD + ARCHITECTURAL MISMATCH).** Do not wrap. Do absorb the one-shot-vs-incremental lesson into the rule-#1/#6/#9 narrative, and keep "improve the real tree, never regenerate it" as the contrast to Smol Developer's abandoned one-shot thesis. No P0 wrap task is filed. |

**Trigger for re-evaluation**: Smol Developer is dormant. Re-evaluation would only be warranted if the smol-ai org revived it as a maintained, incremental (edit-existing-code) agent with a published SWE-bench-shape resolve rate. That is not expected. Until then it is a post-mortem reference, not a backend.

## Five pivot questions

### 1. How is it different from Minsky?

Smol Developer is a **one-shot greenfield codebase generator** — give it a spec, it writes a whole new repo in a single pass, and you iterate by editing the spec and regenerating. Minsky is an **orchestrator-tier daemon that runs around the clock**, selects its own work from `TASKS.md`, and makes small, supervised, incremental edits to a real, living git tree, never discarding working code. Smol Developer treats the code as disposable and the prompt as source; Minsky treats the spec as the thing to satisfy by editing the actual repo. They are not peers: Smol Developer is a dormant bootstrap-an-empty-repo tool; Minsky is a supervised fleet improving existing code indefinitely.

### 2. What lessons can it give to us?

- **One-shot generation cannot survive an evolving codebase** (the project's own pivot from generator to "scaffolder / first step") — software cost lives in the ten-thousand later edits, none of which a regenerate-from-scratch tool can do without destroying everything else. This reinforces Minsky's incremental thesis (rule #1, improve don't reinvent) and rule #6 (operate on the live tree, never discard working code).
- **"Prompt as source of truth" is half-right** (Smol Developer's headline idea) — the durable asset is the spec, but the code is not disposable. Steal the spec-centric framing (Minsky's `TASKS.md` / `user-stories` / `vision.md` are the durable specs); reject the regenerate-the-code corollary.
- **Scaffold-then-hand-off is a real pattern** (swyx's "first step of a multi-agent pipeline" re-framing) — convergent with Minsky's compose-the-most-capable-agent instinct (rule #1 plus adapter layer), but Minsky does it as a supervised daemon, not a one-shot scaffolder.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons confirm existing `vision.md` bets rather than challenge them: the one-shot-vs-incremental lesson strengthens rules #1/#6/#9, the prompt-as-source lesson echoes the spec-driven discipline already in `TASKS.md` / `user-stories` / `vision.md`, and the scaffold-then-hand-off signal validates the compose-existing-agents thesis. None would force a rewrite of `vision.md § What Minsky is` or invalidate any of the 17 rules. A negative finding (no vision change; absorb-the-lesson) is recorded for the audit trail per the deep-research convention, with the recommendation "absorb the one-shot-vs-incremental lesson; no vision change."

### 4. How can we improve our strategy based on this?

- **Lead with "improve the real tree, never regenerate it," explicitly contra one-shot generation.** Smol Developer is the household example of one-shot codebase generation that the field walked away from. Strategy move: position Minsky's incremental, edit-preserving loop against that exact failure, citing Smol Developer's own pivot to "scaffolder / first step." Traces to lesson §2.1.
- **Foreground the durable-spec surface (`TASKS.md` / `user-stories` / `vision.md`) while rejecting disposable code.** "Prompt as source of truth" was the right half; the regenerate-the-code half is the trap. Strategy move: keep the spec-centric narrative but always pair it with "edits the actual repo, preserves working code." Traces to lesson §2.2.
- **Keep the compose-the-most-capable-agent story prominent.** Scaffold-then-hand-off is now an industry pattern; Minsky is a supervised, sustained version of it. Strategy move: foreground the adapter layer and agent-composition in the README and competitors corpus. Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop** (one wake-up of the loop on its timer): KEEP — Smol Developer has no work-selecting daemon; it is a one-shot human-invoked command-line tool.
- **MAPE-K**: KEEP — no self-improvement substrate exists in Smol Developer.
- **adapters / context assembly**: KEEP — Smol Developer's minimal core is convergent prior art, but Minsky's adapter layer plus live-tree editing already embodies the durable instinct; nothing to swap in.
- **sandbox**: N/A — out of scope for a one-shot generator.
- **corpus / scorecard**: KEEP — intentionally not wired in (no vendor-primary capability reading on the M1.10 catalogue; dormant product); recorded as a post-mortem reference only.
- **dashboard / TASKS.md surface**: KEEP — Minsky's durable-spec surface is the correct half of Smol Developer's "prompt as source" idea, already implemented without the disposable-code corollary.

**Total replace % across all surfaces: 0%** (no AUGMENT, no REPLACE — everything KEEP/N/A). The headline for the operator: nothing to replace; one strong positioning lesson (one-shot-vs-incremental) to absorb, plus confirmation that the durable-spec + incremental-edit bet is the right side of a death the field already lived through.

## Last reviewed

2026-06-02 — first entry; `--post-mortem` mode per task `competitor-add-smol-developer`. Verdict: dormant/dead (one-shot whole-codebase-generation thesis is an architectural dead-end — no place to put the second edit; author re-cast it as a "scaffolder / first step"); DEAD/MISMATCH/NO wrap; absorb the one-shot-vs-incremental lesson (reinforces rules #1/#6/#9), keep "improve the real tree, never regenerate it" positioning; no vision change (negative finding logged for the audit trail).
