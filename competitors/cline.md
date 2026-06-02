# Reference: Cline

> Cline is the fastest-growing open-source VSCode-based coding agent of 2025-2026 — MCP-native, multi-model, with a Plan/Act mode split. This file applies the Five Pivot Questions framework to decide what Minsky learns from it. Cline occupies the IDE-integrated, human-in-the-loop niche Minsky deliberately does not, and its growth curve is itself a lesson. The verdict (answered below) is **Reference — learn from its growth and feature choices; do not adopt or compete head-on; its surface (IDE extension, one task at a time, human-supervised) is the structural inverse of Minsky's daemon.**

- **URL**: <https://github.com/cline/cline>
- **Site**: <https://cline.bot>
- **Status**: Active, Apache 2.0, one of the highest-installed agent extensions on the VS Code Marketplace (millions of installs); multiple releases per month.
- **Pricing**: Free (OSS). User brings their own API key (Anthropic / OpenAI / OpenRouter / Bedrock / Vertex / local via Ollama or LM Studio), or uses the optional Cline-hosted billing layer.
- **Relationship**: **Reference** — different surface (IDE extension, human-supervised, single-task) from Minsky's unattended daemon. Not a competitor at the same layer and not a dependency; the value is in *what we learn* from its feature choices and adoption curve. Intentionally NOT added to `novel/competitive-benchmark/src/competitors.ts`: like every CLI/extension agent, its benchmark score is whatever model it is pointed at, and Cline publishes no standalone reproducible SWE-bench number Minsky's corpus can cite as a primary source (rule #4 — no fabricated or double-counted readings).

## What it is

An open-source VS Code extension that runs an autonomous coding agent inside the IDE. Defining features:

- **Plan/Act mode split** — the agent first proposes a plan (Plan mode), the human reviews/approves, then the agent executes (Act mode). Human-in-the-loop by design.
- **MCP-native** — one of the earliest non-Anthropic adopters of the Model Context Protocol; custom MCP servers plug in as tools, and the community publishes a marketplace of them.
- **Multi-model** — Anthropic, OpenAI, OpenRouter, Bedrock, Vertex, Gemini, and local models (Ollama / LM Studio) through a provider abstraction.
- **Built-in cost tracking** — per-task token and dollar accounting surfaced in the UI.
- **Computer-use capable** — can drive a browser on supported models (Anthropic Computer Use API).
- **VS Code-native diff UX** — reviews edits through the editor's native diff viewer, which is a materially better review affordance than a terminal diff.

Distinct from Claude Code (terminal-native) and Cursor (closed IDE with embedded agent) in being *open-source* AND *VS Code-extension-shaped* AND *human-supervised by default*.

## Strengths

- **MCP-native from early days** — an existing MCP investment ports with zero re-plumbing; the community MCP marketplace is a real ecosystem advantage.
- **Plan/Act mode separation** — a natural fit for a pre-registration discipline: the Plan step IS a hypothesis declaration before action (the same shape as Minsky's rule #9).
- **VS Code-native diff review** — superior human-review affordance to a terminal diff.
- **Built-in cost tracking** — accurate per-task accounting; Minsky tracks `cost-per-merged-pr` at the corpus level but lacks Cline's per-task in-the-moment surface.
- **Multi-model out of the box** — broad provider coverage including local models.
- **Very active development + huge install base** — the growth curve is the headline: Cline went from niche to one of the most-installed agent extensions in roughly a year, which is itself a distribution lesson.
- **Computer-use support** — browser automation on supported models, an edge on tasks Minsky punts to the `agent-browser` skill.

## Weaknesses vs Minsky's vision

1. **IDE-bound, not daemon-shaped.** Cline closes when VS Code closes. It is not a 24/7 unattended runner; the operator must be present in the editor.
2. **One task at a time.** No queue, no fleet, no multi-host round-robin walker. The operator is the scheduler.
3. **Human-in-the-loop by design.** Plan/Act requires approval; this is a feature for trust but the structural inverse of Minsky's "attach and walk away".
4. **No experiment store or MAPE-K.** Single-session; no cross-run learning or autonomic self-improvement.
5. **No persona pipeline.** A single agent loop, not a research → plan → implement → QA decomposition.
6. **No constitution / deterministic enforcement.** Conventions live in prompts and human review, not in a 17-rule `pnpm pre-pr-lint --stage=full` gate that gates every merge.

## What we learn / steal

- **Plan/Act as a pre-registration affordance** — Cline's Plan mode is, in effect, a hypothesis-declaration step before action. Minsky's rule #9 demands the same shape at task-pre-registration time; Cline shows it can be a *first-class UX surface*, not just a checklist.
- **Per-task cost tracking as an in-the-moment surface** — Minsky reports cost at the corpus level; Cline surfaces it per-task as the work happens. A candidate dashboard widget.
- **MCP-native as table stakes** — Cline's MCP marketplace shows the ecosystem value of being MCP-native early. Minsky already wraps MCP; the lesson is to keep that surface first-class.
- **Distribution via the IDE marketplace** — Cline's growth curve came from the VS Code Marketplace's discovery + one-click install. Minsky is daemon-shaped and will never be an extension, but the lesson — *lower the time-to-first-iteration and meet users where they already are* — applies to Minsky's `agent-mediated-install` time-to-first-iteration metric.

## Why choose Minsky over Cline

- 24/7 unattended daemon + queue + cross-repo fleet — Cline is IDE-bound and single-task; it stops when the editor closes.
- MAPE-K across-session self-improvement — Cline has no experiment store or learning loop.
- Constitution-as-CI (17 deterministic rules) — Cline relies on prompts + human review.
- Operator-machine identity with PR delivery on a walk-away cadence — Cline keeps the human in the loop by design.

## Why choose Cline over Minsky

- You want a human-in-the-loop coding agent inside your editor, with native diff review and Plan/Act approval gates.
- You want MCP-native extensions and broad multi-model support with one-click install.
- You want per-task cost visibility and a polished IDE UX, not a headless daemon.

## Should we adopt or wrap Cline instead?

No. Cline is at a different layer AND a different interaction model: an IDE extension that keeps the human in the loop and runs one task at a time. There is no headless / background mode that would turn it into a daemon-runtime alternative to OpenHands (the natural runtime backend Minsky already adopted) — Cline's value is precisely the in-editor, human-supervised experience, which is the inverse of Minsky's unattended posture. Wrapping it would mean stripping the property that makes it good. The disciplined answer is **learn from it, do not wrap it.**

## Five pivot questions

### 1. How is it different from Minsky?

Cline is a human-supervised, single-task, IDE-embedded agent. Minsky is an unattended, multi-task, cross-repo daemon with a self-improvement loop and a governance gate. The interaction models are inverses: Cline keeps the human in the loop (Plan/Act approval); Minsky's value is that the human attaches and walks away. They occupy different niches by design, not by accident.

### 2. What lessons can it give to us?

- **2.1 Plan/Act is a first-class pre-registration UX.** Surface the rule-#9 hypothesis declaration as a visible Plan step, not a hidden checklist. Traces to rule #9.
- **2.2 Per-task cost in-the-moment.** Add a per-task cost widget to the dashboard, complementing the corpus-level `cost-per-merged-pr`. Traces to rule #4 (everything visible).
- **2.3 MCP-native is table stakes; keep it first-class.** The MCP marketplace is real ecosystem value. Traces to rule #1 (reuse the ecosystem).
- **2.4 Distribution = lower time-to-first-iteration + meet users where they are.** The growth lesson maps onto Minsky's `agent-mediated-install` metric. Traces to the install-time user story.

### 3. Are any of these lessons potentially vision-changing?

**No.** Cline's lessons are UX and distribution refinements, not architectural ones. The Plan/Act surface, per-task cost widget, and MCP-first-class posture all sit *on top of* Minsky's existing architecture without changing the tick-loop, MAPE-K, identity model, or constitution. The one lesson that touches strategy — distribution — is an organizational/positioning property (lower time-to-first-iteration), and Minsky already tracks the metric it would move (`agent-mediated-install`). The structural difference (IDE extension + human-in-loop + single-task vs daemon + unattended + fleet) is exactly what makes Cline a Reference rather than a competitor or dependency: there is nothing to adopt that wouldn't break Minsky's reason for existing. The pre-registered Pivot for this stub was effectively "does deep research surface a daemon/background mode that makes Cline a runtime candidate?" — the answer is **no daemon mode exists**, so the Reference classification holds.

### 4. How can we improve our strategy based on this?

- **Surface the hypothesis as a visible Plan step** — make rule-#9 pre-registration a first-class UX affordance the way Cline makes Plan mode first-class. Traces to lesson §2.1.
- **Add a per-task cost widget** — complement corpus-level cost with in-the-moment per-task accounting on the dashboard. Traces to lesson §2.2.
- **Keep MCP first-class and watch the Cline MCP marketplace** — adopt community MCP servers that fit; do not rebuild what the ecosystem ships. Traces to lesson §2.3 + rule #1.
- **Invest in time-to-first-iteration** — the distribution lever Cline's growth proves; the metric is already defined (`agent-mediated-install`). Traces to lesson §2.4.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Cline has no daemon/queue/fleet; it is single-task, IDE-bound. Nothing to replace.
- **MAPE-K**: KEEP — no experiment store or across-session learning in Cline.
- **adapters / agent backend**: DO-NOT-WRAP — Cline has no headless/background mode; wrapping it would strip the in-editor human-supervised property that is its whole point. OpenHands remains the runtime backend.
- **dashboard / cost surface**: EVALUATE-TO-ABSORB — the per-task cost widget and the Plan/Act-as-pre-registration UX are the two techniques worth absorbing.
- **MCP surface**: KEEP + WATCH — Minsky is already MCP-native; watch the Cline MCP marketplace for community servers to reuse.
- **constitution-as-CI / lint stack**: KEEP — Cline relies on human review; this is the layer that lets Minsky run unattended.
- **corpus / scorecard**: KEEP (do NOT add) — Cline publishes no standalone reproducible benchmark number; adding a model-dependent reading would violate rule #4 (no fabricated/double-counted readings).
- **identity / fleet / TASKS.md surface**: KEEP — Cline is IDE-bound and single-task.

**Total replace % across all surfaces: 0% replacement; 1 DO-NOT-WRAP (the agent backend — wrapping would break Cline's defining property) + 2 EVALUATE-TO-ABSORB (per-task cost widget, Plan/Act-as-pre-registration UX).** Headline for the operator: *nothing in Minsky to replace; Cline is a Reference whose value is two UX lessons (visible Plan-step pre-registration, per-task cost) and a distribution lesson (time-to-first-iteration). Its IDE-extension, human-in-the-loop, single-task shape is the structural inverse of Minsky's daemon — adopting its runtime would break the thing that makes it good.*

## Scorecard readings

Cline carries no corpus entry. Its benchmark score is whatever driver model it is pointed at, and Cline publishes no standalone reproducible SWE-bench number Minsky's corpus can cite as a primary source. Adding a model-dependent reading would double-count the driver model already in the corpus (rule #4 — visible, no fabricated readings).

| Metric | Value | Date | Primary source |
| --- | --- | --- | --- |
| `swe-bench-verified-resolve-rate` | n/a | — | No standalone Cline benchmark published; score is the chosen driver model's. Like every extension/CLI agent, the tool is plumbing and the model is the measured artefact. |

## Last reviewed

2026-06-02 — deepened from stub with `## Should we adopt or wrap Cline instead?` + `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deep-research-tier-s-2026-05`. Verdict: REFERENCE — learn from Cline's UX (Plan/Act-as-pre-registration, per-task cost widget) and distribution (time-to-first-iteration) lessons; DO-NOT-WRAP the runtime (Cline has no headless/background mode; wrapping would strip its in-editor human-supervised property). No corpus entry (no standalone reproducible benchmark; rule #4). No vision change — Cline's IDE-extension, human-in-the-loop, single-task shape is the structural inverse of Minsky's daemon, which is exactly why it is a Reference and not a competitor or dependency.

Earlier reviews: 2026-05-22 (STUB — deep research pending).
