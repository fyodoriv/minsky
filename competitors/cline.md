# Competitor: Cline (Cline)

> Cline is an open-source VS Code extension that runs a coding assistant inside your editor, with you approving every step. It is the structural opposite of Minsky — Minsky is a background program you point at a repo and walk away from. We study Cline to learn from its features and its fast growth, not to compete with it or wrap it.

- **URL**: <https://github.com/cline/cline> / <https://cline.bot>
- **Status**: Active, Apache 2.0, one of the highest-installed agent extensions on the VS Code Marketplace (millions of installs); multiple releases per month.
- **Pricing**: Free (open source). You bring your own API key (Anthropic, OpenAI, OpenRouter, Bedrock, Vertex, or a local model via Ollama or LM Studio), or use the optional Cline-hosted billing layer.
- **Relationship**: **Reference** — a different surface from Minsky. Cline is an editor extension that keeps you in the loop and works one task at a time. Minsky is a daemon: a background program that keeps running on your machine after you start it, picks tasks on its own, and prepares drafts while you are away. Cline is neither a competitor at the same layer nor a dependency; the value is in what we learn from its choices.

## What this is

Cline is an open-source VS Code extension. It runs a coding assistant inside the editor, and you approve what it does as it goes.

First, a definition that this whole file relies on. The **agent** is the coding assistant that does the actual editing — here, Cline's own loop inside VS Code. Minsky is not an agent; it is a program that drives agents (Claude Code, Devin, Aider, OpenHands). This file compares Cline-the-agent to Minsky-the-orchestrator, which is why almost every contrast comes down to "in the editor, one task, you approve" versus "in the background, many tasks, you walk away".

Cline's defining features:

- **Plan/Act mode split** — the agent first proposes a plan (Plan mode). You review and approve it. Then the agent does the work (Act mode). A human stays in the loop by design.
- **MCP-native** — Cline was one of the earliest non-Anthropic adopters of the Model Context Protocol. Custom MCP servers plug in as tools, and the community publishes a marketplace of them.
- **Multi-model** — Anthropic, OpenAI, OpenRouter, Bedrock, Vertex, Gemini, and local models (Ollama, LM Studio) through one provider abstraction.
- **Built-in cost tracking** — per-task token and dollar accounting shown right in the UI.
- **Computer-use capable** — can drive a browser on models that support it (Anthropic Computer Use API).
- **VS Code-native diff review** — you review edits through the editor's own diff viewer, which is a far better review experience than a terminal diff.

Cline is distinct from Claude Code (terminal-native) and Cursor (a closed IDE with an embedded agent): it is open-source, VS Code-extension-shaped, and human-supervised by default.

## What this is not

- **Not a daemon.** Cline closes when VS Code closes. It does not keep running in the background; you must be present in the editor.
- **Not an orchestrator.** It has no task queue, no cross-repo fleet (Minsky's term for walking several repositories in turn), and no scheduler. You are the scheduler.
- **Not a head-to-head Minsky competitor.** Cline keeps a human in the loop on purpose; Minsky's whole value is that you attach and walk away. They sit in different niches by design. This file studies what to absorb, not how to beat it.
- **Not in Minsky's corpus.** The corpus is Minsky's dated, cited set of competitor benchmark numbers. Cline is intentionally left out of `novel/competitive-benchmark/src/competitors.ts`. Like every CLI or extension agent, its benchmark score is just whatever model you point it at, and Cline publishes no standalone reproducible SWE-bench number Minsky's corpus could cite as a primary source (rule #4 — no fabricated or double-counted readings).

## Strengths

- **MCP-native from early days.** An existing MCP investment ports with no re-plumbing, and the community MCP marketplace is a real ecosystem advantage.
- **Plan/Act mode separation.** The Plan step is, in effect, a hypothesis declared before action — the same shape as Minsky's rule #9 (pre-registered hypothesis-driven development: every change states its hypothesis, success threshold, and measurement before code is written).
- **VS Code-native diff review.** A better human-review experience than a terminal diff.
- **Built-in cost tracking.** Accurate per-task accounting. Minsky tracks `cost-per-merged-pr` across the whole corpus but lacks Cline's in-the-moment per-task surface.
- **Multi-model out of the box.** Broad provider coverage, including local models.
- **Very active development and a huge install base.** The growth curve is the headline: Cline went from niche to one of the most-installed agent extensions in roughly a year. That is a distribution lesson in itself.
- **Computer-use support.** Browser automation on models that support it — an edge on tasks Minsky hands off to the `agent-browser` skill.

## Weaknesses vs Minsky's vision

1. **Editor-bound, not daemon-shaped.** Cline closes when VS Code closes. It is not a 24/7 unattended runner; you must be present in the editor.
2. **One task at a time.** No queue, no fleet, no multi-repo walker. You are the scheduler.
3. **Human-in-the-loop by design.** Plan/Act requires your approval. That is a feature for trust, but it is the opposite of Minsky's "attach and walk away".
4. **No self-improvement loop.** Cline is single-session. It has no MAPE-K loop — Minsky's Monitor, Analyze, Plan, Execute cycle over a shared Knowledge base that studies past runs and improves the next ones — and no store of past experiments.
5. **No persona pipeline.** Cline is a single agent loop. It does not split work into roles the agent takes on in turn (researcher, planner, implementer, QA).
6. **No constitution or deterministic enforcement.** Conventions live in prompts and human review, not in a numbered set of non-negotiable rules checked by a `pnpm pre-pr-lint --stage=full` gate on every merge.

## What we learn / steal

- **Plan/Act as a pre-registration surface.** Cline's Plan mode is, in effect, a hypothesis declared before action. Minsky's rule #9 already demands the same shape; Cline shows it can be a first-class part of the UI, not just a checklist.
- **Per-task cost as an in-the-moment surface.** Minsky reports cost at the corpus level; Cline shows it per task as the work happens. A candidate for a Minsky dashboard widget.
- **MCP-native as table stakes.** Cline's MCP marketplace proves the ecosystem value of being MCP-native early. Minsky already wraps MCP; the lesson is to keep that surface first-class.
- **Distribution through the marketplace.** Cline's growth came from the VS Code Marketplace's discovery and one-click install. Minsky is daemon-shaped and will never be an extension, but the lesson holds: lower the time-to-first-iteration and meet users where they already are. It maps onto Minsky's `agent-mediated-install` metric.

## Why choose Minsky over Cline

- 24/7 unattended daemon, with a task queue and a cross-repo fleet. Cline is editor-bound and single-task; it stops when the editor closes.
- A MAPE-K loop that learns across sessions. Cline has no experiment store and no learning loop.
- A constitution enforced as CI (17 deterministic rules). Cline relies on prompts plus human review.
- Operator-machine identity (work runs as you, under your own git and SSH credentials) with PR delivery on a walk-away cadence. Cline keeps the human in the loop by design.

## Why choose Cline over Minsky

- You want a human-in-the-loop coding agent inside your editor, with native diff review and Plan/Act approval gates.
- You want MCP-native extensions and broad multi-model support with one-click install.
- You want per-task cost visibility and a polished editor UX, not a headless daemon.

## Should we wrap Cline instead?

No. Cline sits at a different layer and uses a different interaction model: an editor extension that keeps the human in the loop and runs one task at a time. There is no headless or background mode that would turn it into a daemon-runtime alternative to OpenHands (the runtime backend Minsky already adopted). Cline's value is precisely the in-editor, human-supervised experience — the inverse of Minsky's unattended posture. Wrapping it would mean stripping the very property that makes it good. The disciplined answer is: learn from it, do not wrap it.

## Five pivot questions

### 1. How is it different from Minsky?

Cline is a human-supervised, single-task, editor-embedded agent. Minsky is an unattended, multi-task, cross-repo daemon with a self-improvement loop and a governance gate. The interaction models are inverses: Cline keeps the human in the loop (Plan/Act approval); Minsky's value is that the human attaches and walks away. They occupy different niches by design, not by accident.

### 2. What lessons can it give to us?

- **2.1 Plan/Act is a first-class pre-registration UX.** Surface the rule-#9 hypothesis as a visible Plan step, not a hidden checklist. Traces to rule #9.
- **2.2 Per-task cost in the moment.** Add a per-task cost widget to the dashboard, alongside the corpus-level `cost-per-merged-pr`. Traces to rule #4 (everything visible).
- **2.3 MCP-native is table stakes; keep it first-class.** The MCP marketplace is real ecosystem value. Traces to rule #1 (don't reinvent — reuse the ecosystem).
- **2.4 Distribution means lower time-to-first-iteration and meeting users where they are.** The growth lesson maps onto Minsky's `agent-mediated-install` metric. Traces to the install-time user story.

### 3. Are any of these lessons potentially vision-changing?

No. Cline's lessons are UX and distribution refinements, not architectural ones. The Plan/Act surface, the per-task cost widget, and the MCP-first-class posture all sit on top of Minsky's existing architecture without changing the tick-loop (the control loop that wakes on a timer), MAPE-K, identity model, or constitution. The one lesson that touches strategy — distribution — is a positioning property (lower time-to-first-iteration), and Minsky already tracks the metric it would move (`agent-mediated-install`).

The structural difference (editor extension, human-in-loop, single-task versus daemon, unattended, fleet) is exactly what makes Cline a Reference rather than a competitor or dependency: there is nothing to adopt that would not break Minsky's reason for existing. The pre-registered pivot question for this research was, in effect, "does deep research surface a daemon or background mode that makes Cline a runtime candidate?" The answer is no — no daemon mode exists — so the Reference classification holds.

### 4. How can we improve our strategy based on this?

- **Surface the hypothesis as a visible Plan step.** Make rule-#9 pre-registration a first-class UX affordance the way Cline makes Plan mode first-class. Traces to lesson §2.1.
- **Add a per-task cost widget.** Complement the corpus-level cost figure with in-the-moment per-task accounting on the dashboard. Traces to lesson §2.2.
- **Keep MCP first-class and watch the Cline MCP marketplace.** Adopt community MCP servers that fit; do not rebuild what the ecosystem ships. Traces to lesson §2.3 and rule #1.
- **Invest in time-to-first-iteration.** This is the distribution lever Cline's growth proves; the metric is already defined (`agent-mediated-install`). Traces to lesson §2.4.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Cline has no daemon, queue, or fleet; it is single-task and editor-bound. Nothing to replace.
- **MAPE-K**: KEEP — Cline has no experiment store and no across-session learning.
- **adapters / agent backend**: DO-NOT-WRAP — Cline has no headless or background mode; wrapping it would strip the in-editor, human-supervised property that is its whole point. OpenHands remains the runtime backend.
- **dashboard / cost surface**: EVALUATE-TO-ABSORB — the per-task cost widget and the Plan/Act-as-pre-registration UX are the two techniques worth absorbing.
- **MCP surface**: KEEP + WATCH — Minsky is already MCP-native; watch the Cline MCP marketplace for community servers to reuse.
- **constitution-as-CI / lint stack**: KEEP — Cline relies on human review; this is the layer that lets Minsky run unattended.
- **corpus / scorecard**: KEEP (do NOT add) — Cline publishes no standalone reproducible benchmark number; adding a model-dependent reading would violate rule #4 (no fabricated or double-counted readings).
- **identity / fleet / TASKS.md surface**: KEEP — Cline is editor-bound and single-task.

**Total replace across all surfaces: 0% replacement; 1 DO-NOT-WRAP (the agent backend — wrapping would break Cline's defining property) plus 2 EVALUATE-TO-ABSORB (per-task cost widget, Plan/Act-as-pre-registration UX).** Headline for the operator: there is nothing in Minsky to replace. Cline is a Reference whose value is two UX lessons (a visible Plan-step pre-registration, per-task cost) and a distribution lesson (time-to-first-iteration). Its editor-extension, human-in-the-loop, single-task shape is the structural inverse of Minsky's daemon — adopting its runtime would break the thing that makes it good.

## Scorecard readings

Cline carries no corpus entry. Its benchmark score is whatever driver model it is pointed at, and Cline publishes no standalone reproducible SWE-bench number Minsky's corpus can cite as a primary source. Adding a model-dependent reading would double-count the driver model already in the corpus (rule #4 — visible, no fabricated readings).

| Metric | Value | Date | Primary source |
| --- | --- | --- | --- |
| `swe-bench-verified-resolve-rate` | n/a | — | No standalone Cline benchmark published; score is the chosen driver model's. Like every extension/CLI agent, the tool is plumbing and the model is the measured artefact. |

## Last reviewed

2026-06-02 — deepened from stub with `## Should we wrap Cline instead?` and `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deep-research-tier-s-2026-05`. Verdict: REFERENCE — learn from Cline's UX (Plan/Act-as-pre-registration, per-task cost widget) and distribution (time-to-first-iteration) lessons; DO-NOT-WRAP the runtime (Cline has no headless or background mode; wrapping would strip its in-editor, human-supervised property). No corpus entry (no standalone reproducible benchmark; rule #4). No vision change — Cline's editor-extension, human-in-the-loop, single-task shape is the structural inverse of Minsky's daemon, which is exactly why it is a Reference and not a competitor or dependency.

Earlier reviews: 2026-05-22 (STUB — deep research pending).
