# Competitor: Devika (stitionai/devika)

> The first viral open-source "Devin alternative" — a coding agent that planned, researched the web, and wrote code from one instruction. Today it is a post-mortem, not a live competitor: it won mindshare but never became a maintained product.

- **URL**: <https://github.com/stitionai/devika> (read-mostly; the original agent loop's development has stalled)
- **Status**: **Semi-stale / development-stalled.** Devika went viral in March 2024 as the first prominent open-source clone of Devin and collected 19k+★ within weeks. Commit cadence collapsed within months. Per the task measurement `gh api repos/stitionai/devika --jq .pushed_at`, the last push is ~September 2025 (days-since > 180 at this entry's date), which crosses the `--post-mortem` threshold the task defines. The `archived` flag is `false`, so the repo is technically open, but the viral artifact — the plan → research → code agent loop — is no longer actively developed. There is no maintained roadmap and no successor product.
- **Pricing**: Free (MIT-licensed open source). You bring your own model API key — it supported Claude, GPT-4, and local models via Ollama, plus a search-API key for the web-browsing step. No commercial product, no hosted service.
- **Relationship**: **Research benchmark (post-mortem).** Devika is a citable lesson in one failure mode: a first-mover open-source clone goes viral on a famous proprietary product's demo, but never turns that mindshare into a maintained product. It is not a tool to adopt or a fleet to wrap.

## What this is

Devika (released March 2024 by Mufeed VH and the Stition.AI group) is an open-source "agentic AI software engineer." It was positioned as a free alternative to Cognition Labs' Devin, which had just gone viral.

You gave Devika one high-level instruction. It would then:

1. **Decompose** the goal into steps, in an "Agentic Planning" loop.
2. **Research** the web for relevant information, using a browsing sub-agent.
3. **Write code** toward the goal.
4. **Iterate**, showing its reasoning, plan, and browser activity in a bundled web UI (a Svelte frontend over a Python/Flask backend).

It was multi-model from the start (Claude, GPT-4, Groq-hosted models, and local models via Ollama). It shipped with its own in-repo chat and project view, rather than living inside an editor or terminal.

Its significance was timing and framing. It was the **first** prominent open-source project to package "an autonomous agent that takes a feature request and tries to deliver it" in direct response to Devin's reveal. It rode that wave to ~18-19k GitHub stars within weeks — one of the fastest open-source star curves of early 2024.

Architecturally it was a **single-project, single-goal app with a bundled UI**. It ran one goal at a time, in one process, behind a local web server. It produced code plus a reasoning transcript. It proved the Devin-style agent loop was forkable and self-hostable — but the original loop's development stalled within months, and the project never became a maintained system.

## What this is not

- **Not a daemon.** Devika is not a background program that keeps running on your machine around the clock. It runs one goal, then stops.
- **Not an orchestrator.** It drives one agent loop for one request. It does not sit above several agents (Claude, Devin, Aider, OpenHands) and pick the best one per task.
- **Not a fleet walker.** It works on one project. It has no concept of walking several code projects in turn.
- **Not a maintained product.** The original viral loop is no longer actively developed. Use a maintained successor (OpenHands, Aider, Cline) for real work.

## Strengths

- **First-mover open-source framing.** Devika was the canonical "open Devin" the moment Devin went viral. The 19k+★ reflects genuine, fast mindshare and real appetite for a self-hostable agentic engineer.
- **Self-hostable and multi-model from day one.** Claude / GPT-4 / Groq / local Ollama support meant no vendor lock-in and no cloud dependency — the inverse of Devin's closed cloud product.
- **Plan, web-research, and code in one loop.** The explicit decompose → browse → implement structure made the "agentic engineer" pattern legible and copyable. It included a real web-research step that many early clones lacked.
- **Bundled reasoning UI.** A Svelte frontend surfaced the agent's plan, step state, and browser activity. That gave a clearer "what is the agent thinking" view than a raw terminal log.
- **Permissive licence and clean fork target.** MIT-licensed and self-contained, it was widely cloned and studied as a reference for "how to structure an autonomous coding agent."

## Weaknesses vs Minsky's vision

First, two Minsky terms used below. A **daemon** is a background program that keeps running on your machine — it survives terminal close and restarts on crash. A **host** is one code project (one git repository) that Minsky works on. **Operator-machine identity** means the work runs as you, under your own git and SSH credentials. An **agent** is the coding assistant Minsky drives (Claude Code, Devin, Aider, or OpenHands) — Minsky is not an agent; it orchestrates agents.

1. **Not a daemon — a single-goal UI app.** Devika runs one goal at a time behind a local web server and a chat UI. It is not a background program that keeps working over your real repos around the clock. There is no overnight improvement loop, no restart-on-crash, and no budget management — the throttle that pauses work when it is using too much paid quota (Minsky moats #1 and #6, via `vision.md § Stay alive`). Devika runs until you stop it, then hands you code plus a transcript for one request.
2. **No operator-machine identity.** Devika has no concept of binding to your `~/.gitconfig` or `gh` identity, committing *as you*, or inheriting your ambient credentials. It writes files into a project workspace; it does not ship commits or pull requests as the operator across a fleet (Minsky moat #2).
3. **No cross-repo fleet.** One goal, one project, one process. There is no round-robin across several hosts, no durable task list spanning sessions, and no fleet-scale walker (Minsky moats #5 and #6).
4. **No self-improvement of its own pipeline.** Devika re-plans *within* one goal, but it has no loop that studies its own results over time and tunes its own prompts and strategy. (Minsky's version is the MAPE-K loop — Monitor, Analyze, Plan, Execute over a Knowledge base — which is its self-improvement loop, Minsky moat #4.) Devika re-plans for a request; it does not learn across requests.
5. **No constitution, no deterministic enforcement.** There is no enforced rule-set, no test-first or measure-first gate, and no pre-registered-hypothesis discipline. (Minsky's **constitution** is the numbered, non-negotiable project rules in `vision.md`.) Devika plans and writes code; it does not gate each change behind a verified, measurable result (Minsky moat #3; rules #3 and #9 — rule #9 is pre-registered hypothesis-driven development, the discipline that every change states its hypothesis, success threshold, pivot threshold, measurement command, and literature anchor before code is written).
6. **Development stalled — no maintained product.** The original viral loop is no longer actively developed. There is no maintained roadmap, no team continuity, and no successor. The open-source artifact is a *lesson source*, not a maintained dependency (Minsky rule #1, don't reinvent — adopt the lesson, not the abandoned code).

## What we learn / steal

- **Surface the agent's reasoning, not just its output.** Devika's bundled UI exposed the plan, step state, and browser activity — a genuine usability win. Minsky's equivalent is the plain-text `TASKS.md` to-do list it reads to pick work, plus the daemon's structured `orchestrate.jsonl` log and its OpenTelemetry (OTEL) spans — the open standard Minsky emits for traces, metrics, and logs (rule #4 — everything visible). The lesson confirms that *making the loop legible* is load-bearing, not cosmetic. Minsky already does this with a plain-markdown surface rather than a bespoke web UI.
- **First-mover mindshare is not durable usage.** Devika captured one of the fastest open-source star curves of 2024 by being *first* to package "open Devin," yet the project stalled within months. That 19k★-to-stalled trajectory is strong evidence for Minsky's bet that *maintenance and survival* — a daemon that stays alive on your machine under a constitution — beat a viral demo. Being first to a demo is not a moat; being the thing that still ships correct changes a year later is.
- **A bundled UI is a maintenance liability for a single maintainer.** Devika's Svelte+Flask stack was attractive for demos, but it is exactly the kind of surface that rots fastest when one maintainer's attention moves on. Minsky's choice of a plain-markdown surface plus a CLI — no dashboard language, no bespoke web app to maintain — is the inverse bet: fewer moving parts to keep alive (Minsky moat #6, the `TASKS.md` surface).
- **Multi-model and self-host are table stakes, not a moat.** Devika had Claude / GPT-4 / local-Ollama support from day one, and it did not save the project. Model-agnosticism is necessary — Minsky wraps every agent behind a fixed interface, called an **adapter**, per rule #2 — but it is not where durable differentiation lives. That lives in the orchestrator-tier moats: the constitution, the MAPE-K self-improvement loop, the cross-repo fleet, and operator identity.

## Why choose Minsky over Devika

- A daemon that runs around the clock, with budget management and restart-on-crash, versus a single-goal app that runs one request behind a local web server and stops.
- Ships correct *changes* into existing repos — commits and pull requests as the operator across a fleet — versus writing code into a single project workspace with no operator-identity binding.
- A cross-repo fleet across several hosts, with a durable, inspectable `TASKS.md` to-do list, versus one goal in one process behind a bespoke UI.
- A constitution plus deterministic CI enforcement (17 rules, `pnpm pre-pr-lint`) plus verify-and-measure discipline (rules #3 and #9), versus a plan-and-code loop with no rule-set, no gate, and no measured result.
- Maintained and agent-agnostic — it inherits the *maintained* agents' reliability through the rule #2 adapter wrapping — versus a stalled first-mover agent loop with a bundled Svelte/Flask UI that no one is maintaining.

## Why choose Devika over Minsky

Honest cases are now mostly historical, but:

- If you want to study the *first prominent open-source Devin clone* as a reference for the plan → web-research → code agent loop with a bundled reasoning UI. It is a clean, MIT-licensed fork target for that pattern.
- If you want a single self-hostable, multi-model "type a request, watch the agent plan, browse, and code in a web UI" demo for one project, want zero orchestration — no fleet, no daemon — and accept that the project is unmaintained. (For real work, a maintained successor — OpenHands, Aider, Cline — is the more honest choice.)

## Scorecard readings (lesson reference — not wired into `novel/competitive-benchmark/src/competitors.ts`)

Devika is documented as a **post-mortem lesson**, so it is intentionally NOT added to the live M1.10 corpus (`competitors.ts`). A development-stalled clone with no maintained benchmark line would skew the live scorecard's freshness signal, and the project never published a vendor-cited SWE-bench Verified or HumanEval reading (early "agentic engineer" clones were famous for demos, not published benchmark numbers). Per the no-fabrication rule (rule #4 — visible, no fabricated readings), no scorecard numbers are invented for it. Its measurable signal is **mindshare** (~19k★, a fast March-2024 peak) and the **stall** that followed — both recorded here for context, neither a benchmark metric on the M1.10 catalogue.

## Should we wrap Devika instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a *wrap target*. Devika is a single-goal agent with a bundled web UI, not a maintained, headless agent CLI for editing existing repos the way Minsky spawns `claude` / `devin` / `aider` / `openhands`. Its original loop's development is stalled, it has no stable headless spawn interface, and a stalled dependency is a survival liability (rule #6). |
| 2. **What we delegate** | Nothing structural. At most we would borrow the *surface-the-reasoning* UX idea — already covered by Minsky's inspectable `TASKS.md` + `orchestrate.jsonl` + OTEL spans (rule #4). |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, `TASKS.md` surface). No wrap happens; we extract a lesson. |
| 4. **Net moat after wrap** | 6 of 6 (no wrap). The relevant action is *lesson extraction*, not delegation. |
| 5. **Verdict** | **NO (STALLED + STRUCTURAL MISMATCH).** Do not wrap. The reliability that matters is delivered by the *maintained* agents Minsky already wraps behind an interface (rule #2); a stalled first-mover clone with a bundled UI adds maintenance risk and no orchestrator-tier capability. |

**Trigger for re-evaluation**: if Stition.AI or a community fork ships a *maintained*, self-hostable, headless agent CLI (not a bundled-UI loop) with a stable spawn interface and a code-shipping output, re-run this analysis as an agent-tier wrap candidate. Until then the artifact is a historical lesson source, not a backend.

## Post-mortem: why it stalled

- **Last meaningful state**: the original `devika` agent loop is no longer actively developed. `gh api repos/stitionai/devika --jq .pushed_at` returns a last push of ~September 2025 (days-since > 180 at this entry's date, crossing the task's `--post-mortem` threshold). **Archived flag**: `false` (the repo is technically open) — but feature development on the original viral loop effectively stopped within months of the March-2024 launch, and there is no maintained roadmap or successor product. **Maintainer trajectory**: the creators moved on to other work rather than productizing or maintaining the agent loop.
- **Root cause** (first-mover-without-durability, NOT architectural dead-end): Devika was a *fast, viral open-source response to a famous proprietary demo*, not a product with a business model or a maintenance commitment. Its purpose — proving that a self-hostable, multi-model Devin-style agent could exist — was largely served the moment it went viral. The plan → research → code loop was hard to make *reliably* useful on real-world tasks (the same gap the broader "agentic engineer" field hit in 2024: impressive demos, low real-world success rates). Without a team paid to grind on reliability, evaluation, and maintenance, the project stalled. This is the classic "first-mover open-source clone" outcome: the *concept* (open, self-hostable agentic engineer) propagated and was reimplemented by better-resourced projects (OpenHands/OpenDevin, SWE-agent, Aider, Cline), while the *original artifact* stalled because no one's job was to keep it reliable. It is *not* a case of the agentic-engineer architecture being proven wrong — that architecture is now ubiquitous — it is a case of a first-mover reference implementation never converting mindshare into a maintained product.
- **Evidence** (≥ 3 sources):
  1. The repository metadata itself — `gh api repos/stitionai/devika --jq '{archived, pushed_at, stargazers_count}'` reports `archived: false` with a last push of ~September 2025 and a star count in the ~19k range. A 19k+★ project whose substantive development stopped long before is the central observable of the post-mortem.
  2. The launch framing — Devika's own README and <https://github.com/stitionai/devika> position it explicitly as an open-source alternative to Devin, released in direct response to Cognition Labs' March-2024 reveal. The project's identity is bound to that first-mover moment rather than to a maintained roadmap.
  3. The field's documented trajectory — the broader "autonomous AI software engineer" cohort of 2024 (Devin, Devika, OpenDevin/OpenHands, SWE-agent) is well documented across the open-source and research ecosystem. Devika's early star peak followed by stall, while better-resourced successors (OpenHands, SWE-agent, Aider, Cline) continued to ship, is the divergence this post-mortem records.
- **Lesson for Minsky** (mandatory): Minsky's survival guardrail against *this* death mode — *"a first-mover open-source clone goes viral on a famous demo's coattails but stalls because no one owns its long-term reliability and maintenance"* — is **operator ownership + a verify-and-measure constitution + agent-agnostic wrapping**. Devika's users depended on a single small team's continued interest in a hard-to-make-reliable agent loop with a bundled UI to maintain. Minsky inverts this on three axes: (a) the daemon is owned and run by the *operator* on the operator's own machine (moat #2), so no upstream maintainer's attention shift can strand the workflow; (b) every wrapped agent (Claude, Devin, Aider, OpenHands) lives behind an adapter interface (rule #2), so Minsky inherits the *maintained* agents' reliability improvements instead of grinding on its own agent loop's reliability — the exact reliability treadmill Devika fell off; (c) the constitution forbids the impressive-demo-with-no-verified-outcome failure mode — rule #3 (test-first, measurable) and rule #9 (pre-registered hypothesis-driven development with a runnable measurement) mean a change only "counts" when an observable moves. The guardrails already exist; this post-mortem confirms they are load-bearing.

## Five pivot questions

### 1. How is it different from Minsky?

Devika is an **agent-tier, single-goal autonomous coding app with a bundled web UI**. Minsky is an **orchestrator-tier daemon** that runs around the clock, sits above agents, and ships *changes into existing repos* across a fleet. Devika's intent is to take one high-level request and plan/browse/code toward it behind a local web server, surfacing its reasoning in a UI. Minsky's intent is to keep a fleet of existing repos improving indefinitely under a constitution, composing whichever *maintained* agent is best and gating every change with a verified measurement. They are not peers — and unlike a live, maintained agent CLI, Devika is not even a viable wrap target, because its original loop's development has stalled and it exposes no stable headless spawn interface.

### 2. What lessons can it give to us?

- **Surface the agent's reasoning, not just its output** (Devika's bundled plan/step/browser UI). Making the loop legible to the operator is load-bearing. Minsky's equivalent is the inspectable `TASKS.md` surface + `orchestrate.jsonl` + OTEL (rule #4); the lesson confirms the instinct and validates Minsky's plain-markdown surface over a bespoke web app.
- **First-mover mindshare is not durable usage** (the 19k★-to-stalled trajectory). Being first to package "open Devin" won stars but not survival. This reinforces Minsky's focus on maintenance and staying-alive over a viral demo.
- **Don't own the agent-reliability treadmill — wrap the agents that do** (Devika fell off it; OpenHands/SWE-agent/Aider/Cline kept grinding). The reliability gap that stalled Devika is exactly what Minsky avoids by wrapping *maintained* agents behind an interface (rule #2) rather than building and maintaining its own agent loop.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons are *strategy/survival* level — they *confirm* existing `vision.md` commitments (the inspectable operator surface per rule #4, the maintenance-over-demo scope, the agent-agnostic wrapping per rule #2, and the verify-and-measure discipline of rules #3 and #9) rather than challenge them. Nothing here would force a rewrite of `vision.md § What Minsky is` or invalidate any of the 17 rules. Devika is a stalled, agent-tier, single-goal coding app; it neither subsumes Minsky's orchestrator layer nor threatens any moat. The operator-facing recommendation is "absorb the surface-the-reasoning lesson (already encoded via `TASKS.md` + OTEL), no vision change." A negative finding of this kind is the deep-research convention's expected output for a post-mortem; the orchestrator records operator questions centrally (this task does not edit `ask-human.md`).

### 4. How can we improve our strategy based on this?

- **Keep the maintenance-and-survival framing explicit in positioning.** Devika's stall is strong evidence that the durable lane is "ship correct, verified changes into existing repos under a constitution," not "be first to a viral agent demo." Strategy move: keep the README/competitor TL;DR foregrounding the daemon + cross-repo-maintenance + verify-and-ship moats — traces to lesson §2.2.
- **Keep wrapping maintained agents rather than owning an agent loop.** Devika fell off the reliability treadmill; better-resourced agents stayed on it. Strategy move: keep every agent behind the `novel/adapters` interface (rule #2) so Minsky inherits the maintained agents' reliability gains instead of grinding its own loop's reliability — traces to lesson §2.3.
- **Keep the operator surface plain and inspectable, not a bespoke UI.** Devika's Svelte/Flask UI was a maintenance liability that rotted when attention moved on. Strategy move: keep `TASKS.md` + structured logs + OTEL as the legible surface (rule #4) instead of a custom dashboard with its own upkeep cost — traces to lesson §2.1.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Devika runs one goal in one process behind a web server; it is not a cross-repo daemon. Nothing to replace.
- **MAPE-K**: KEEP — Devika re-plans within one goal but has no self-improvement substrate across runs.
- **adapters / context assembly**: KEEP — the only borrowable idea (surface-the-reasoning UX) is already covered by `TASKS.md` + `orchestrate.jsonl` + OTEL; Devika is not a maintained agent CLI to wrap as a backend.
- **sandbox**: N/A — out of Devika's scope.
- **corpus / scorecard**: KEEP — intentionally not wired in (stalled original, no primary published benchmark, demo-grade reliability); recorded as a lesson reference only.
- **dashboard / TASKS.md surface**: KEEP — Devika's bundled Svelte UI is the high-maintenance inverse of Minsky's plain, CI-gated `TASKS.md`.

**Total replace % across all surfaces: 0%** (every surface KEEP/N/A; the one borrowable instinct is already absorbed). The headline for the operator: *nothing to replace; the surface-the-reasoning lesson is already encoded via `TASKS.md` + OTEL, and the project is a post-mortem, not a backend.*

## Last reviewed

2026-06-02 — first entry; `--post-mortem` mode per task `competitor-add-devika` (last push ~September 2025, days-since > 180 crosses the post-mortem threshold). Verdict: first-mover open-source Devin clone whose original agent loop's development stalled; STALLED/NO wrap; surface-the-reasoning lesson already absorbed via the inspectable `TASKS.md` + `orchestrate.jsonl` + OTEL surface; no vision change (negative finding; orchestrator records operator questions centrally — this task does not edit `ask-human.md`).
