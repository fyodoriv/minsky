# Competitor: Roo Code (RooCodeInc/Roo-Code)

> A high-momentum Cline fork (~24k★) built around **custom modes + per-mode autonomy** ("Architect / Code / Ask / Debug" plus user-defined modes) and a **Boomerang-style task-orchestration** pattern that spawns sub-tasks and returns to the parent. This file exists because Roo Code is the cleanest case study of *the fork dilemma* — a fork can out-feature its upstream for a while, but it inherits the upstream's death-mode risk (an IDE-extension pair-programmer whose differentiation gap closes as the upstream catches up), which is the precise lineage risk Minsky's daemon-not-extension architecture is designed to sidestep. The post-mortem framing here is task-asserted (the `competitor-add-roo-code` block flags Roo Code as ARCHIVED as of 2026-05-15); the analysis is written to be load-bearing whether or not the archive holds, with an explicit status-verification trigger.

- **URL**: <https://github.com/RooCodeInc/Roo-Code>
- **Author**: Roo Code, Inc. (community-driven OSS; the project began as "Roo Cline", a fork of `cline/cline`).
- **Status**: **Task-asserted ARCHIVED (2026-05-15)** — the `competitor-add-roo-code` task block flags the repo as archived despite ~24k★. This entry treats that as the working hypothesis under `--post-mortem` mode AND records a status-verification trigger (see Post-mortem § "Verify before citing the archive as fact"), because a fork-with-momentum going archived is a strong claim worth re-checking against the live repo header before it is cited externally. Either way the lineage lesson — *a fork inherits its upstream's death-mode risk* — is the durable extract.
- **Pricing**: Free (OSS, permissive license per the Cline lineage); pay-your-own model/API cost. No hosted control plane.
- **Relationship**: **Post-mortem / lineage-risk reference** — not a backend Minsky would wrap (it is an IDE-extension pair-programmer, the wrong shape for Minsky's spawn-an-agent-CLI loop), and, if archived, not a live competitor. A fork whose trajectory illustrates the fork dilemma that Minsky's daemon-not-extension thesis avoids (Minsky moats #1, #6).

## What it is

Roo Code is a VS Code extension descended from Cline (it launched as "Roo Cline"). It kept Cline's core loop — an agent that reads/edits files, runs terminal commands, and iterates inside the editor with the human approving steps — and layered on the features that became its identity:

1. **Custom modes + per-mode autonomy.** Roo Code ships named operating modes (Architect for planning, Code for implementation, Ask for Q&A, Debug for fault-finding) and lets users define their own modes with scoped tool permissions and prompts. Each mode carries its own autonomy/approval posture, so a user can run "Code" mode with auto-approve while keeping "Architect" mode advisory. This per-mode autonomy framing is Roo Code's most-cited differentiator over base Cline.
2. **Boomerang-style task orchestration.** Roo Code popularized an orchestration pattern where a parent task spawns specialized sub-tasks (each potentially in a different mode), the sub-task runs to completion, and control "boomerangs" back to the parent with the result. This is a single-IDE, human-anchored take on the multi-agent decomposition that frameworks like CrewAI/MetaGPT pursue server-side.
3. **Aggressive feature cadence on top of Cline's base.** Because it forked a popular, well-shaped project, Roo Code could ship UX/feature deltas (mode marketplace, prompt customization, MCP integration, model flexibility) faster than building from scratch — the classic fork advantage.

The trajectory is the story the task asks about: a fork that gained real momentum (~24k★) by out-featuring its upstream on customization and orchestration, sitting in the same architectural niche as its upstream — an **IDE-extension pair-programmer the human drives turn-by-turn**.

## Strengths

- **Customization as a product** — named modes + user-defined modes + scoped per-mode tool permissions is a genuinely good UX idea for matching autonomy to risk (advisory for planning, auto-approve for mechanical edits). Minsky's persona/mode instinct (the OMC mode table in AGENTS.md) is convergent prior art worth noting.
- **Boomerang task orchestration** — parent→sub-task→return is a clean, legible decomposition for keeping a long task on-rails inside one editor session; it prefigures, in single-IDE form, the spawn-and-collect shape Minsky uses across agents.
- **Fork velocity** — building on Cline let Roo Code ship customer-visible deltas quickly; the ~24k★ is real distribution and validates that the customization/orchestration deltas resonated.
- **Permissive OSS + model flexibility + MCP** — like its lineage, Roo Code is bring-your-own-model and MCP-aware, so it composes with the broader tool ecosystem rather than locking users in.

## Weaknesses vs Minsky's vision

1. **IDE-extension pair-programmer, not a 24/7 daemon.** Roo Code runs inside VS Code and is driven by a human turn-by-turn (even with auto-approve, the session is anchored to an open editor and an attending human). It does not run unattended across repos, does not select its own next task from a queue, and does not stay alive across machine restarts. Minsky's tick-loop *selects* work from `TASKS.md` and runs as a supervised daemon 24/7 (Minsky moat #6). This is the single load-bearing difference and the same niche-mismatch as Cline.
2. **Per-mode autonomy ≠ bounded, falsifiable autonomy.** Roo Code's modes scope *tool permissions and prompts*; they do not impose a pre-registered hypothesis with a numeric pivot threshold (Minsky rule #9) or a constitution gated by deterministic CI (`pnpm pre-pr-lint --stage=full`). Autonomy posture is a UX setting, not a falsifiable contract (Minsky moat #3).
3. **No MAPE-K self-improvement substrate.** Roo Code does not observe its own outcome history and tune the system from it; there is no experiment store, no observer loop. Minsky's MAPE-K loop learns from its own iteration records (Minsky moat #4).
4. **No operator-machine identity / supervision tree.** Roo Code is an editor extension, not a process running as the operator with the operator's credentials under a let-it-crash supervisor. It has no notion of surviving process death and resuming work (Minsky moats #2, #6).
5. **Fork-lineage risk (the post-mortem thesis).** A fork's differentiation lives in the delta over upstream; when the upstream closes that gap, the fork's reason-to-exist shrinks — and the fork still inherits the *architectural* ceiling of the niche it forked into. Minsky did not fork an IDE extension; it composes agent CLIs behind adapters and runs them as a supervised daemon, so it is not exposed to either side of the fork dilemma (Minsky moat #1).

## What we learn / steal

- **Per-mode autonomy posture is a good UX primitive** — matching approval strictness to task risk (advisory planning vs auto-approve mechanical edits) is worth absorbing into Minsky's mode/persona surface; the OMC mode table already gestures at this, and Roo Code is the citation that scoped per-mode permissions are a real ergonomic win.
- **Boomerang orchestration is convergent with spawn-and-collect** — parent→sub-task→return validates Minsky's instinct to decompose a long task into bounded sub-runs and reassemble; Minsky does it across *agent processes* under a supervisor rather than across *modes* inside one editor, but the decomposition shape is the same.
- **The fork dilemma is the load-bearing lesson** — Roo Code is the household example that *forking a popular tool buys velocity but not a moat*: the delta over upstream is contestable, and the fork inherits the upstream's architectural ceiling. Minsky's antidote is to NOT fork into a crowded niche — it sits one tier up (orchestrator/daemon) and composes the agents below it (rule #1: don't reinvent — orchestrate).
- **MCP + model-flexibility are table stakes, not differentiation** — Roo Code, Cline, and most peers are all bring-your-own-model + MCP-aware; Minsky should treat these as baseline hygiene (already true via the adapter layer) and not claim them as a moat.

## Post-mortem

> Roo Code is flagged ARCHIVED (2026-05-15) by the task. This section records the death-mode thesis, what would survive, and an explicit trigger to verify the archive before citing it as fact.

- **What (the task says) died**: a high-momentum Cline fork (~24k★) whose identity was *custom modes + per-mode autonomy + Boomerang task orchestration*, archived despite real distribution.
- **Root-cause hypothesis (the fork dilemma, an architectural/strategic ceiling — not a single funding event)**: a fork's reason-to-exist is the delta over its upstream. Roo Code's deltas (mode customization, scoped per-mode autonomy, Boomerang orchestration) were strong enough to win ~24k★, but they sit *inside the same niche as Cline* — an IDE-extension pair-programmer the human drives turn-by-turn. Two pressures squeeze a fork in that position simultaneously: (a) **upstream catch-up** — when Cline (or the broader extension field: Continue, Copilot, Cursor's agent) absorbs the customization/orchestration ideas, the fork's differentiation gap narrows toward zero; and (b) **niche ceiling** — even a fully-differentiated extension is still bounded by the *human-attended, single-editor* architecture, which cannot become a 24/7 unattended fleet without ceasing to be the thing users adopted it for. A fork can win the feature race and still lose the architecture race.
- **Why this is structural, not a tuning problem (the guardrail for Minsky)**: more model capability or more modes makes the *pair-programming* experience better; it does not give an editor extension a place to put unattended, cross-repo, self-selected work. The fork that wants to escape the ceiling must re-architect into a different product (a daemon/orchestrator) — at which point it is no longer "the Cline fork people starred." This is the same nowhere-to-put-the-next-capability trap that killed the one-shot generators (see `competitors/smol-developer.md`), expressed in the fork/extension dimension instead of the one-shot/incremental dimension.
- **What would survive / the re-framing**: the *ideas* — per-mode autonomy posture and Boomerang task orchestration — survive as influential UX vocabulary and are visible in many agents' design. The *fork-as-a-standalone-product* is the part the thesis says cannot hold once upstream converges.
- **Lesson for Minsky (mandatory)**: Minsky's guardrail against *this* death mode is **don't fork into a crowded niche; orchestrate one tier above it** (rule #1 — don't reinvent, compose existing agents behind adapters) plus **the daemon-not-extension architecture** (rule #6 — a supervised loop that runs unattended on the live tree, not a human-attended editor session) plus **bounded falsifiable autonomy** (rule #9 pivot thresholds). Minsky never bets its existence on a contestable feature-delta over a single upstream; its moat is the orchestrator tier + operator-machine identity + MAPE-K substrate, none of which an IDE-extension fork can absorb without ceasing to be one.
- **Verify before citing the archive as fact**: a fork-with-momentum going archived is a strong claim. Before this archive status is cited externally, re-check the live repo header — `gh api repos/RooCodeInc/Roo-Code --jq '{archived,pushed_at,stargazers_count}'`. If `archived == false`, downgrade this file from post-mortem to a *live lineage-risk* reference (the fork-dilemma analysis still holds for a live fork; only the past-tense "died" framing changes), and file a `corpus-refresh-roo-code` task to update the status line.

## Why choose Minsky over Roo Code

- **A 24/7 supervised daemon that selects its own work** from `TASKS.md` and runs unattended across repos vs an IDE extension a human drives turn-by-turn inside one editor.
- **Bounded, falsifiable autonomy** (rule #9 pivot thresholds, a 17-rule constitution gated by `pnpm pre-pr-lint --stage=full`) vs per-mode autonomy that scopes tool permissions but imposes no falsifiable contract.
- **MAPE-K self-improvement** — the system tunes itself from its own outcome history — vs a static extension with no observer/experiment loop.
- **Operator-machine identity + supervision tree** (runs as the operator, survives process death, let-it-crash recovery) vs an editor extension with no unattended runtime.
- **Orchestrator-tier positioning** that composes agent CLIs behind adapters vs a fork whose differentiation is a contestable feature-delta over a single upstream.

## Why choose Roo Code over Minsky

- If your need is **interactive, in-editor pair programming with rich mode customization** — advisory planning in one mode, auto-approve mechanical edits in another, Boomerang sub-tasks for long flows — Roo Code (if maintained) is a strong fit and Minsky is the wrong tool (Minsky is an unattended daemon, not an editor copilot).
- If you want **scoped per-mode tool permissions** as a first-class UX, Roo Code's mode system is a clean reference implementation.
- (If the archive holds, there is no live-product reason to choose Roo Code today — verify status first per the Post-mortem trigger.)

## Scorecard readings (mindshare/post-mortem reference — not wired into `novel/competitive-benchmark/src/competitors.ts`)

Roo Code is documented here as a **post-mortem / lineage-risk reference**, intentionally NOT added to the live M1.10 corpus (`competitors.ts`). The M1.10 scorecard compares Minsky against agent/orchestrator peers on shared *capability* metrics (SWE-bench Verified, HumanEval Pass@1, DORA, agentic). Roo Code publishes **no vendor-primary reading on the M1.10 catalogue** — its headline number is a *star count*, and (per the task) the product is archived — so wiring it in would violate the validator's published-primary rule (rule #4 — visible, no fabricated readings). The values below are recorded for context only.

| Metric (context only — not an M1.10 metric id) | Value | Date | Primary source |
| --- | --- | --- | --- |
| GitHub stars | ~24,100 | 2026-06 | github.com/RooCodeInc/Roo-Code (repo header). |
| License | Permissive OSS (Cline lineage) | 2026-06 | github.com/RooCodeInc/Roo-Code (LICENSE). |
| Status | Task-asserted ARCHIVED | 2026-05-15 | `competitor-add-roo-code` task block; verify via `gh api repos/RooCodeInc/Roo-Code --jq .archived`. |

No capability number (SWE-bench / HumanEval / agentic) with a Roo-Code-primary citation is recorded, which is itself the point: a popular IDE-extension fork competes on mindshare and UX deltas, not on a measurable, vendor-published resolve rate on the shared catalogue.

## Should we wrap Roo Code instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a wrap target. Roo Code is a *VS Code extension* driven turn-by-turn by a human, not a headless agent CLI Minsky can spawn the way it spawns `claude`/`devin`/`aider` to run unattended on a repo. Its whole model (in-editor, human-attended, mode-scoped approvals) is the opposite of Minsky's spawn-an-agent-and-supervise loop. It is also (per the task) archived. |
| 2. **What we delegate** | Nothing structural. At most, the *ideas* — per-mode autonomy posture and Boomerang orchestration — are worth absorbing into Minsky's mode/persona surface, but those are design patterns to steal, not a runtime to delegate to. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface) — no wrap happens. |
| 4. **Net moat after wrap** | 6 of 6 (no wrap). The relevant action is *lesson extraction* (fork dilemma; per-mode autonomy UX), not delegation. |
| 5. **Verdict** | **NO (ARCHIVED-PER-TASK + ARCHITECTURAL MISMATCH).** Do not wrap. Do absorb the fork-dilemma lesson into the rule-#1/#6 narrative (don't fork into a crowded niche; orchestrate above it) and note per-mode autonomy as a UX primitive worth matching. No P0 wrap task is filed. Verify archive status before citing it externally (Post-mortem trigger). |

**Trigger for re-evaluation**: if `gh api repos/RooCodeInc/Roo-Code --jq .archived` returns `false`, re-classify this file as a *live lineage-risk* reference (fork-dilemma analysis unchanged; status line updated) and file `corpus-refresh-roo-code`. Re-evaluation as a *wrap target* would only be warranted if Roo Code shipped a headless, unattended, cross-repo runtime with a vendor-published SWE-bench-shape resolve rate — i.e. if it stopped being an IDE-extension fork — which is not expected.

## Five pivot questions

### 1. How is it different from Minsky?

Roo Code is an **IDE-extension pair-programmer** (a Cline fork) that runs inside VS Code and is driven by a human turn-by-turn, differentiated by **custom modes + per-mode autonomy + Boomerang task orchestration**. Minsky is an **orchestrator-tier 24/7 daemon** that *selects* its own work from `TASKS.md` and runs unattended across repos under a let-it-crash supervisor, composing agent CLIs (claude/devin/aider/openhands) behind adapters. Roo Code's autonomy is a per-mode UX posture; Minsky's autonomy is a bounded, falsifiable contract (rule #9 pivot thresholds, constitution gated by CI). They are not peers: Roo Code is a human-attended editor copilot (and, per the task, archived); Minsky is a supervised fleet improving existing code indefinitely.

### 2. What lessons can it give to us?

- **The fork dilemma** (Roo Code's whole trajectory) — forking a popular tool buys velocity but not a moat: the delta over upstream is contestable, and the fork inherits the upstream's architectural ceiling. Reinforces Minsky's rule #1 (don't reinvent — orchestrate one tier above the niche) and rule #6 (daemon-not-extension architecture).
- **Per-mode autonomy posture is a good UX primitive** (Roo Code's named/custom modes with scoped permissions) — matching approval strictness to task risk is worth absorbing into Minsky's mode/persona surface (the OMC mode table); steal the scoped-per-mode-permissions idea.
- **Boomerang orchestration is convergent with spawn-and-collect** (parent→sub-task→return) — validates Minsky's decompose-into-bounded-sub-runs instinct, expressed across agent processes under a supervisor rather than across modes inside one editor.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons *confirm* existing `vision.md` bets rather than challenge them — the fork-dilemma lesson strengthens rules #1/#6 (Minsky deliberately did not fork into the IDE-extension niche), the per-mode autonomy lesson echoes the mode/persona surface already in AGENTS.md, and the Boomerang signal validates the spawn-and-collect decomposition instinct. None would force a rewrite of `vision.md § What Minsky is` or invalidate any of the 17 rules. A negative finding (no vision change; absorb-the-lessons) is recorded for the audit trail per the deep-research convention, with the recommendation "absorb the fork-dilemma lesson + per-mode autonomy UX; no vision change."

### 4. How can we improve our strategy based on this?

- **Lead with "orchestrate above the niche, don't fork into it," citing the fork dilemma** — Roo Code is the household example of a fork that won the feature race inside a niche but stayed bounded by that niche's architecture. Strategy move: position Minsky's orchestrator-tier + daemon architecture *against* the fork-into-a-crowded-niche path, citing Roo Code's trajectory — traces to lesson §2.1.
- **Adopt scoped per-mode autonomy posture explicitly in the mode/persona surface** — Roo Code shows users want approval strictness matched to task risk. Strategy move: make Minsky's OMC mode table carry an explicit per-mode autonomy posture (advisory vs auto-approve) where it doesn't already — traces to lesson §2.2.
- **Treat MCP + model-flexibility as baseline hygiene, not a moat** — Roo Code/Cline/most peers all have these. Strategy move: keep the moat narrative on the orchestrator tier (daemon, operator identity, MAPE-K, constitution) and never claim bring-your-own-model/MCP as differentiation — traces to lesson §2.3 (and the broader peer set).

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Roo Code has no work-selecting daemon; it is a human-attended IDE extension.
- **MAPE-K**: KEEP — no self-improvement substrate exists in Roo Code.
- **adapters / context assembly**: KEEP — Roo Code is an extension, not a spawnable agent CLI; nothing to swap into the adapter layer. The per-mode autonomy idea is a UX pattern to absorb, not a component to import.
- **sandbox**: N/A — out of scope for an in-editor extension.
- **corpus / scorecard**: KEEP — intentionally not wired in (no vendor-primary capability reading on the M1.10 catalogue; archived per task); recorded as a post-mortem/lineage-risk reference only.
- **dashboard / TASKS.md surface**: KEEP — Minsky's self-selected-work surface has no analogue in a human-driven editor extension.

**Total replace % across all surfaces: 0%** (no AUGMENT, no REPLACE — everything KEEP/N/A). The headline for the operator: *nothing to replace; one strong positioning lesson (the fork dilemma — orchestrate above the niche, don't fork into it) to absorb, plus a per-mode autonomy UX primitive worth matching, plus confirmation that the daemon-not-extension bet is the right side of a ceiling the IDE-extension niche cannot escape.*

## Last reviewed

2026-06-02 — first entry; `--post-mortem` mode per task `competitor-add-roo-code`. Status is task-asserted ARCHIVED (2026-05-15) — verify via `gh api repos/RooCodeInc/Roo-Code --jq .archived` before citing the archive externally. Verdict: ARCHIVED-PER-TASK/MISMATCH/NO wrap; absorb the fork-dilemma lesson (reinforces rules #1/#6) + per-mode autonomy UX primitive; no vision change (negative finding logged for the audit trail).
