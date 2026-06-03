# Competitor: Roo Code (RooCodeInc/Roo-Code)

> A fast-moving Cline fork (~24k★) built around custom modes and a sub-task orchestration pattern; this file uses it as the cleanest case study of the fork dilemma — the strategic trap Minsky's daemon-not-extension design sidesteps.

- **URL**: <https://github.com/RooCodeInc/Roo-Code>
- **Author**: Roo Code, Inc. (community-driven OSS; the project began as "Roo Cline", a fork of `cline/cline`).
- **Status**: **Task-asserted ARCHIVED (2026-05-15)** — the `competitor-add-roo-code` task block flags the repo as archived despite ~24k★. This entry treats that as a working hypothesis. It also records a status-verification trigger (see the Post-mortem section, "Verify before citing the archive as fact"), because a fork with this much momentum going archived is a strong claim worth re-checking against the live repo header before anyone cites it externally. Either way, the durable lesson holds: a fork inherits its upstream's death-mode risk.
- **Pricing**: Free (OSS, permissive license per the Cline lineage). You pay your own model and API cost. No hosted control plane.
- **Relationship**: **Post-mortem / lineage-risk reference.** Not a backend Minsky would wrap — it is an editor extension a human drives turn by turn, the wrong shape for Minsky's spawn-an-agent loop. And if archived, not a live competitor. Its trajectory illustrates the fork dilemma that Minsky's daemon-not-extension thesis avoids (Minsky moats #1, #6).

## What this is

Roo Code is a VS Code extension descended from Cline. It launched as "Roo Cline". It kept Cline's core loop — an agent (the coding assistant doing the actual work) that reads and edits files, runs terminal commands, and iterates inside the editor while the human approves each step — and added the features that became its identity.

There are three of them.

1. **Custom modes with per-mode autonomy.** Roo Code ships named operating modes — Architect for planning, Code for implementation, Ask for Q&A, Debug for fault-finding — and lets you define your own with scoped tool permissions and prompts. Each mode carries its own approval posture, so you can run "Code" mode with auto-approve while keeping "Architect" mode advisory. This per-mode autonomy is Roo Code's most-cited differentiator over base Cline.
2. **Boomerang-style task orchestration.** A parent task spawns specialized sub-tasks, each possibly in a different mode. The sub-task runs to completion, then control "boomerangs" back to the parent with the result. This is a single-editor, human-anchored take on the multi-agent decomposition that frameworks like CrewAI and MetaGPT pursue server-side.
3. **Fast feature cadence on top of Cline's base.** Because it forked a popular, well-shaped project, Roo Code shipped UX deltas — a mode marketplace, prompt customization, MCP integration, model flexibility — faster than building from scratch. That is the classic fork advantage.

The trajectory is the story this file is about. A fork gained real momentum (~24k★) by out-featuring its upstream on customization and orchestration, while sitting in the same architectural niche: an editor-extension pair-programmer the human drives turn by turn.

## What this is not

- Not a daemon (a background program that keeps running). Roo Code lives inside an open editor with an attending human.
- Not a work-selector. It does not pick its own next task from a list; the human points it at each task.
- Not a cross-repo fleet. It runs in one editor session, not across many repositories in turn.
- Not, per the task, a live product. It is flagged archived as of 2026-05-15 (verify before citing — see Post-mortem).

## Strengths

- **Customization as a product** — named modes plus user-defined modes plus scoped per-mode tool permissions is a genuinely good idea for matching autonomy to risk: advisory for planning, auto-approve for mechanical edits. Minsky's persona instinct (the OMC mode table in AGENTS.md) is convergent prior art. A persona is a role the agent takes on.
- **Boomerang task orchestration** — parent → sub-task → return is a clean, legible way to keep a long task on rails inside one editor session. It prefigures, in single-editor form, the spawn-and-collect shape Minsky uses across agents.
- **Fork velocity** — building on Cline let Roo Code ship customer-visible deltas quickly. The ~24k★ is real distribution and validates that the customization and orchestration deltas resonated.
- **Permissive OSS, model flexibility, and MCP** — like its lineage, Roo Code is bring-your-own-model and MCP-aware, so it composes with the broader tool ecosystem rather than locking users in.

## Weaknesses vs Minsky's vision

1. **Editor-extension pair-programmer, not a 24/7 daemon.** Roo Code runs inside VS Code and is driven by a human turn by turn. Even with auto-approve, the session is anchored to an open editor and an attending human. It does not run unattended across repos, does not select its own next task, and does not stay alive across machine restarts. Minsky runs as a daemon — a background program that keeps running — and its loop selects work from `TASKS.md`, the plain-text Markdown to-do list at a project's root (Minsky moat #6). This is the single load-bearing difference, the same niche mismatch as Cline.
2. **Per-mode autonomy is not bounded, falsifiable autonomy.** Roo Code's modes scope tool permissions and prompts. They do not impose a numeric pivot threshold (Minsky's rule #9, pre-registered hypothesis-driven development: every change states its hypothesis, success threshold, pivot threshold, measurement command, and literature anchor before code is written). Nor do they impose a constitution — the numbered, non-negotiable project rules — gated by deterministic CI (`pnpm pre-pr-lint --stage=full`). Autonomy posture is a UX setting, not a falsifiable contract (Minsky moat #3).
3. **No self-improvement substrate.** Roo Code does not observe its own outcome history and tune itself from it. There is no experiment store and no observer loop. Minsky runs a MAPE-K loop — Monitor, Analyze, Plan, Execute over a Knowledge base — that learns from its own iteration records (Minsky moat #4).
4. **No operator-machine identity or supervision tree.** Roo Code is an editor extension, not a process running as the operator (the human who runs it) with the operator's credentials under a let-it-crash supervisor — the outer watchdog that restarts the program if it dies. It has no notion of surviving process death and resuming work (Minsky moats #2, #6).
5. **Fork-lineage risk (the post-mortem thesis).** A fork's differentiation lives in the delta over upstream. When the upstream closes that gap, the fork's reason to exist shrinks — and the fork still inherits the architectural ceiling of the niche it forked into. Minsky did not fork an editor extension. It composes agent CLIs behind adapters — small wrapper files that let it talk to one outside tool through a fixed interface — and runs them as a supervised daemon, so it is exposed to neither side of the fork dilemma (Minsky moat #1).

## What we learn / steal

- **Per-mode autonomy posture is a good UX primitive.** Matching approval strictness to task risk — advisory planning versus auto-approve mechanical edits — is worth absorbing into Minsky's persona surface. The OMC mode table already gestures at this, and Roo Code is the citation that scoped per-mode permissions are a real ergonomic win.
- **Boomerang orchestration is convergent with spawn-and-collect.** Parent → sub-task → return validates Minsky's instinct to break a long task into bounded sub-runs and reassemble. Minsky does it across agent processes under a supervisor rather than across modes inside one editor, but the decomposition shape is the same.
- **The fork dilemma is the load-bearing lesson.** Roo Code is the household example that forking a popular tool buys velocity but not a moat. The delta over upstream is contestable, and the fork inherits the upstream's architectural ceiling. Minsky's antidote is to not fork into a crowded niche. It sits one tier up, as an orchestrator and daemon, and composes the agents below it (rule #1, don't reinvent — orchestrate).
- **MCP and model-flexibility are table stakes, not differentiation.** Roo Code, Cline, and most peers are all bring-your-own-model and MCP-aware. Minsky should treat these as baseline hygiene (already true via the adapter layer) and never claim them as a moat.

## Why choose Minsky over Roo Code

- **A 24/7 supervised daemon that selects its own work** from `TASKS.md` and runs unattended across repos, versus an editor extension a human drives turn by turn inside one editor.
- **Bounded, falsifiable autonomy** — rule #9 pivot thresholds and a 17-rule constitution gated by `pnpm pre-pr-lint --stage=full` — versus per-mode autonomy that scopes tool permissions but imposes no falsifiable contract.
- **MAPE-K self-improvement** — the system tunes itself from its own outcome history — versus a static extension with no observer or experiment loop.
- **Operator-machine identity and supervision tree** — runs as the operator, survives process death, recovers let-it-crash style — versus an editor extension with no unattended runtime.
- **Orchestrator-tier positioning** that composes agent CLIs behind adapters, versus a fork whose differentiation is a contestable feature-delta over a single upstream.

## Why choose Roo Code over Minsky

- If your need is **interactive, in-editor pair programming with rich mode customization** — advisory planning in one mode, auto-approve mechanical edits in another, Boomerang sub-tasks for long flows — Roo Code (if maintained) is a strong fit and Minsky is the wrong tool. Minsky is an unattended daemon, not an editor copilot.
- If you want **scoped per-mode tool permissions** as a first-class UX, Roo Code's mode system is a clean reference implementation.
- If the archive holds, there is no live-product reason to choose Roo Code today — verify status first per the Post-mortem trigger.

## Scorecard readings (mindshare/post-mortem reference — not wired into `novel/competitive-benchmark/src/competitors.ts`)

Roo Code is documented here as a post-mortem / lineage-risk reference. It is intentionally not added to the live M1.10 corpus (`competitors.ts`). The M1.10 scorecard compares Minsky against agent and orchestrator peers on shared capability metrics — SWE-bench Verified, HumanEval Pass@1, DORA, agentic. Roo Code publishes no vendor-primary reading on the M1.10 catalogue. Its headline number is a star count, and (per the task) the product is archived. Wiring it in would violate the validator's published-primary rule (rule #4 — visible, no fabricated readings). The values below are recorded for context only.

| Metric (context only — not an M1.10 metric id) | Value | Date | Primary source |
| --- | --- | --- | --- |
| GitHub stars | ~24,100 | 2026-06 | github.com/RooCodeInc/Roo-Code (repo header). |
| License | Permissive OSS (Cline lineage) | 2026-06 | github.com/RooCodeInc/Roo-Code (LICENSE). |
| Status | Task-asserted ARCHIVED | 2026-05-15 | `competitor-add-roo-code` task block; verify via `gh api repos/RooCodeInc/Roo-Code --jq .archived`. |

No capability number — SWE-bench, HumanEval, or agentic — with a Roo-Code-primary citation is recorded. That absence is itself the point: a popular editor-extension fork competes on mindshare and UX deltas, not on a measurable, vendor-published resolve rate on the shared catalogue.

## Should we wrap Roo Code instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with one question: if this is amazing at everything we do, why not wrap it and run for 24h? Here is the honest answer.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a wrap target. Roo Code is a VS Code extension driven turn by turn by a human, not a headless agent CLI Minsky can spawn the way it spawns `claude`, `devin`, or `aider` to run unattended on a repo. Its whole model — in-editor, human-attended, mode-scoped approvals — is the opposite of Minsky's spawn-an-agent-and-supervise loop. It is also (per the task) archived. |
| 2. **What we delegate** | Nothing structural. At most, the ideas — per-mode autonomy posture and Boomerang orchestration — are worth absorbing into Minsky's persona surface. But those are design patterns to steal, not a runtime to delegate to. |
| 3. **What we keep** | All 6 moats survive — daemon-not-framework, operator-machine identity, constitution plus CI, MAPE-K substrate, cross-repo fleet, `TASKS.md` surface. No wrap happens. |
| 4. **Net moat after wrap** | 6 of 6 (no wrap). The relevant action is lesson extraction (the fork dilemma; per-mode autonomy UX), not delegation. |
| 5. **Verdict** | **NO (ARCHIVED-PER-TASK + ARCHITECTURAL MISMATCH).** Do not wrap. Do absorb the fork-dilemma lesson into the rule-#1/#6 narrative — don't fork into a crowded niche; orchestrate above it — and note per-mode autonomy as a UX primitive worth matching. No P0 wrap task is filed. Verify archive status before citing it externally (Post-mortem trigger). |

**Trigger for re-evaluation**: if `gh api repos/RooCodeInc/Roo-Code --jq .archived` returns `false`, re-classify this file as a live lineage-risk reference (the fork-dilemma analysis is unchanged; only the status line updates) and file `corpus-refresh-roo-code`. Re-evaluation as a wrap target would only be warranted if Roo Code shipped a headless, unattended, cross-repo runtime with a vendor-published SWE-bench-shape resolve rate — that is, if it stopped being an editor-extension fork — which is not expected.

## Post-mortem

> Roo Code is flagged ARCHIVED (2026-05-15) by the task. This section records the death-mode thesis, what would survive, and an explicit trigger to verify the archive before citing it as fact.

- **What (the task says) died**: a high-momentum Cline fork (~24k★) whose identity was custom modes, per-mode autonomy, and Boomerang task orchestration — archived despite real distribution.
- **Root-cause hypothesis (the fork dilemma — an architectural and strategic ceiling, not a single funding event)**: a fork's reason to exist is the delta over its upstream. Roo Code's deltas — mode customization, scoped per-mode autonomy, Boomerang orchestration — were strong enough to win ~24k★, but they sit inside the same niche as Cline: an editor-extension pair-programmer the human drives turn by turn. Two pressures squeeze a fork in that position at once. First, **upstream catch-up**: when Cline (or the broader extension field — Continue, Copilot, Cursor's agent) absorbs the customization and orchestration ideas, the fork's differentiation gap narrows toward zero. Second, **niche ceiling**: even a fully differentiated extension is still bounded by the human-attended, single-editor architecture, which cannot become a 24/7 unattended fleet without ceasing to be the thing users adopted it for. A fork can win the feature race and still lose the architecture race.
- **Why this is structural, not a tuning problem (the guardrail for Minsky)**: more model capability or more modes makes the pair-programming experience better. It does not give an editor extension a place to put unattended, cross-repo, self-selected work. A fork that wants to escape the ceiling must re-architect into a different product — a daemon or orchestrator — at which point it is no longer "the Cline fork people starred." This is the same nowhere-to-put-the-next-capability trap that killed the one-shot generators (see `competitors/smol-developer.md`), expressed in the fork/extension dimension instead of the one-shot/incremental dimension.
- **What would survive (the re-framing)**: the ideas — per-mode autonomy posture and Boomerang task orchestration — survive as influential UX vocabulary and are visible in many agents' design. The fork-as-a-standalone-product is the part the thesis says cannot hold once upstream converges.
- **Lesson for Minsky (mandatory)**: Minsky's guardrail against this death mode is three-fold. First, don't fork into a crowded niche; orchestrate one tier above it (rule #1 — don't reinvent; compose existing agents behind adapters). Second, the daemon-not-extension architecture (rule #6 — a supervised loop that runs unattended on the live tree, not a human-attended editor session). Third, bounded falsifiable autonomy (rule #9 pivot thresholds). Minsky never bets its existence on a contestable feature-delta over a single upstream. Its moat is the orchestrator tier plus operator-machine identity plus the MAPE-K substrate — none of which an editor-extension fork can absorb without ceasing to be one.
- **Verify before citing the archive as fact**: a fork with this much momentum going archived is a strong claim. Before this archive status is cited externally, re-check the live repo header — `gh api repos/RooCodeInc/Roo-Code --jq '{archived,pushed_at,stargazers_count}'`. If `archived == false`, downgrade this file from post-mortem to a live lineage-risk reference (the fork-dilemma analysis still holds for a live fork; only the past-tense "died" framing changes), and file a `corpus-refresh-roo-code` task to update the status line.

## Five pivot questions

### 1. How is it different from Minsky?

Roo Code is an editor-extension pair-programmer (a Cline fork) that runs inside VS Code and is driven by a human turn by turn. It is differentiated by custom modes, per-mode autonomy, and Boomerang task orchestration. Minsky is an orchestrator-tier 24/7 daemon that selects its own work from `TASKS.md` and runs unattended across repos under a let-it-crash supervisor, composing agent CLIs (claude, devin, aider, openhands) behind adapters. Roo Code's autonomy is a per-mode UX posture; Minsky's autonomy is a bounded, falsifiable contract (rule #9 pivot thresholds, constitution gated by CI). They are not peers: Roo Code is a human-attended editor copilot (and, per the task, archived); Minsky is a supervised fleet improving existing code indefinitely.

### 2. What lessons can it give to us?

- **The fork dilemma** (Roo Code's whole trajectory) — forking a popular tool buys velocity but not a moat: the delta over upstream is contestable, and the fork inherits the upstream's architectural ceiling. This reinforces Minsky's rule #1 (don't reinvent — orchestrate one tier above the niche) and rule #6 (daemon-not-extension architecture).
- **Per-mode autonomy posture is a good UX primitive** (Roo Code's named and custom modes with scoped permissions) — matching approval strictness to task risk is worth absorbing into Minsky's persona surface (the OMC mode table). Steal the scoped-per-mode-permissions idea.
- **Boomerang orchestration is convergent with spawn-and-collect** (parent → sub-task → return) — validates Minsky's decompose-into-bounded-sub-runs instinct, expressed across agent processes under a supervisor rather than across modes inside one editor.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons confirm existing `vision.md` bets rather than challenge them. The fork-dilemma lesson strengthens rules #1/#6 (Minsky deliberately did not fork into the editor-extension niche). The per-mode autonomy lesson echoes the persona surface already in AGENTS.md. The Boomerang signal validates the spawn-and-collect decomposition instinct. None would force a rewrite of `vision.md § What Minsky is` or invalidate any of the 17 rules. A negative finding (no vision change; absorb the lessons) is recorded for the audit trail per the deep-research convention, with the recommendation: absorb the fork-dilemma lesson and the per-mode autonomy UX; no vision change.

### 4. How can we improve our strategy based on this?

- **Lead with "orchestrate above the niche, don't fork into it," citing the fork dilemma.** Roo Code is the household example of a fork that won the feature race inside a niche but stayed bounded by that niche's architecture. Strategy move: position Minsky's orchestrator tier and daemon architecture against the fork-into-a-crowded-niche path, citing Roo Code's trajectory — traces to lesson §2.1.
- **Adopt scoped per-mode autonomy posture explicitly in the persona surface.** Roo Code shows users want approval strictness matched to task risk. Strategy move: make Minsky's OMC mode table carry an explicit per-mode autonomy posture (advisory vs auto-approve) where it doesn't already — traces to lesson §2.2.
- **Treat MCP and model-flexibility as baseline hygiene, not a moat.** Roo Code, Cline, and most peers all have these. Strategy move: keep the moat narrative on the orchestrator tier (daemon, operator identity, MAPE-K, constitution) and never claim bring-your-own-model or MCP as differentiation — traces to lesson §2.3 (and the broader peer set).

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop** (one wake-up of the loop on its timer): KEEP — Roo Code has no work-selecting daemon; it is a human-attended editor extension.
- **MAPE-K**: KEEP — no self-improvement substrate exists in Roo Code.
- **adapters / context assembly**: KEEP — Roo Code is an extension, not a spawnable agent CLI; nothing to swap into the adapter layer. The per-mode autonomy idea is a UX pattern to absorb, not a component to import.
- **sandbox**: N/A — out of scope for an in-editor extension.
- **corpus / scorecard**: KEEP — intentionally not wired in (no vendor-primary capability reading on the M1.10 catalogue; archived per task); recorded as a post-mortem/lineage-risk reference only.
- **dashboard / `TASKS.md` surface**: KEEP — Minsky's self-selected-work surface has no analogue in a human-driven editor extension.

**Total replace % across all surfaces: 0%** (no AUGMENT, no REPLACE — everything KEEP or N/A). The headline for the operator: nothing to replace; one strong positioning lesson (the fork dilemma — orchestrate above the niche, don't fork into it) to absorb, plus a per-mode autonomy UX primitive worth matching, plus confirmation that the daemon-not-extension bet is the right side of a ceiling the editor-extension niche cannot escape.

## Last reviewed

2026-06-02 — first entry; `--post-mortem` mode per task `competitor-add-roo-code`. Status is task-asserted ARCHIVED (2026-05-15) — verify via `gh api repos/RooCodeInc/Roo-Code --jq .archived` before citing the archive externally. Verdict: ARCHIVED-PER-TASK/MISMATCH/NO wrap; absorb the fork-dilemma lesson (reinforces rules #1/#6) + per-mode autonomy UX primitive; no vision change (negative finding logged for the audit trail).
