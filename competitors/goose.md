# Competitor: Goose

> Goose is the open-source, MCP-native terminal coding agent originally built by Block (Square's parent) and donated in 2025 to the Agentic AI Foundation (AAIF), a Linux Foundation project. This file applies the Five Pivot Questions framework to decide what Minsky absorbs from the most-starred agent CLI now under neutral foundation governance — and tests this task's Hypothesis that Goose's move to a foundation is a strategic signal Minsky should consider following.

- **URL**: <https://github.com/aaif-goose/goose> (foundation org; previously `github.com/block/goose`)
- **Site**: <https://block.github.io/goose/>
- **Status**: Active, Apache 2.0. Originated at Block; governance donated to the Agentic AI Foundation (AAIF / Linux Foundation) in 2025. ~45.8k★ (`gh api repos/aaif-goose/goose --jq .stargazers_count`).
- **Pricing**: Free (OSS). BYO model API key, or use a provider-bundled plan.
- **Relationship**: **Competitor (agent-tier) + candidate wrap target** — Goose is an inner-loop terminal/desktop agent in the same slot Minsky already fills with Claude / Devin / aider. It is not an orchestrator: no daemon, no queue, no cross-repo loop, no supervision. Minsky could wrap it as an additional cloud/local backend the way it wraps the others.

## What it is

An open-source agent for software-engineering tasks, available as both a CLI and a desktop GUI. MCP-native (Anthropic protocol; Goose calls MCP servers "extensions"). Multi-model — Anthropic, OpenAI, Google, Ollama, Databricks, OpenRouter, Bedrock, and others via a first-class provider abstraction. Cross-platform (macOS, Linux, Windows).

- **Recipes** — reusable, parameterized task templates (a YAML/markdown spec of instructions + extensions + sub-tasks). Conceptually close to Minsky's skills + briefs.
- **Subagents / Tasks** — a sub-agent abstraction for decomposing work; "Goosetown" is the experimental multi-agent sibling project exploring coordinated agents (the surface this task's Hypothesis flags as a possible overlap with Minsky's tick-loop).
- **Execution model** — runs on the operator's machine against the real working tree. Closer to Claude Code's terminal-native shape than to OpenHands' Docker-runtime-per-conversation shape — less sandbox-heavy, more trust-the-operator.
- **Governance** — the AAIF/Linux-Foundation donation is the defining 2025 change: vendor-neutral stewardship, open governance, a contributor pipeline that outlives any single sponsor. This is the strategic signal the task asks Minsky to evaluate against its own foundation-home question.

### Published benchmark numbers

Goose does not publish its own standalone SWE-Bench Verified number — like every CLI/desktop agent, its score is whatever model it is pointed at. The CLI is plumbing; the model is the measured artefact. This is the load-bearing distinction for Q5: replacing Minsky's agent backend with Goose would inherit the chosen model's score, not add a new one. Block has published internal-use case studies (engineering productivity at scale) but no reproducible benchmark Minsky's M1.10 corpus can cite as a primary source.

## Strengths

- **MCP-native** — Goose extensions are MCP servers; an existing MCP investment ports cleanly with zero re-plumbing.
- **Multi-model first-class** — the provider abstraction is core to the design, not bolted on; the direct analogue to Minsky's `cloud_agent` / `local_agent` seam.
- **Foundation-governed (AAIF / Linux Foundation)** — the strongest long-term-maintenance signal in the category: neutral stewardship survives a sponsor losing interest, where a single-vendor OSS agent does not.
- **Recipes pattern** — parameterized task templates, conceptually adjacent to Minsky's skills + brief curation; worth a direct technique comparison.
- **Desktop GUI** — lowers the barrier for teammates who don't live in a terminal; a distribution lever Minsky lacks.
- **Local-model + accelerator support** — Ollama and on-device accelerators (Apple silicon, CUDA) make a zero-cloud-token path viable, the same property Minsky's `--local` mode targets.

## Weaknesses vs Minsky's vision

1. **Single-task focused.** Like Claude Code, designed for one task at a time; not a persistent daemon.
2. **No queue / fleet.** No `TASKS.md`-equivalent; the operator is the scheduler. No round-robin over N repos.
3. **No MAPE-K / experiment store.** No across-session learning loop; recipes are templates, not an autonomic controller that records and improves on its own outcomes.
4. **No persona pipeline with feedback.** Recipes + subagents are decomposition primitives, not multi-step orchestration with a self-improvement loop.
5. **No constitution / deterministic enforcement.** No equivalent of the 17-rule `pnpm pre-pr-lint --stage=full` gate; conventions live in recipe prose, not in CI.
6. **Sandbox is trust-the-operator.** Weaker default-deny posture than OpenHands' Docker or Codex CLI's Landlock/Seatbelt; comparable to Claude Code.

## What we learn / steal

- **Foundation governance as a maintenance + trust signal** — the AAIF donation is the headline lesson and the subject of this task's Hypothesis (answered in Q3). It is a *positioning* and *longevity* technique, not a runtime one.
- **Recipes as a portable task-template format** — parameterized templates that bundle instructions + extensions + sub-tasks. Compare to Minsky's brief curation; the lesson is about *format portability*, not adopting Goose's runtime.
- **First-class provider abstraction** — Goose's provider layer is the clean shape Minsky's agent adapter seam already mirrors; confirms the design, nothing new to absorb.
- **Desktop GUI as an on-ramp** — a GUI lowers the onboarding tax for non-terminal users; a distribution idea for a future Minsky surface, not a core-loop change.

## Why choose Minsky over Goose

- 24/7 daemon with supervision, budget guard, and watchdog — outlives any one task; Goose exits when the task finishes.
- `TASKS.md` queue + cross-repo fleet — Goose is per-invocation, per-repo.
- MAPE-K across-session self-improvement — Goose has no experiment store or autonomic controller.
- Constitution-as-CI — 17 rules enforced deterministically; Goose has no equivalent gate.
- Operator-machine identity end-to-end — commits land as the operator with no token handoff.

## Why choose Goose over Minsky

- You want a polished single-task terminal **and** desktop agent today, with a GUI for non-terminal teammates.
- You want MCP-native extensions and a mature multi-model provider layer out of the box.
- You value vendor-neutral foundation governance (AAIF / Linux Foundation) over a single-maintainer or single-vendor project.
- You don't need a 24/7 orchestrator — the operator is happy to be the scheduler.

## Should we wrap Goose instead?

**Verdict: ADD as an optional agent backend (low priority), do NOT replace the orchestrator.** Goose fills exactly the agent-tier slot Minsky already abstracts behind `cloud_agent` / `local_agent`. Wrapping it is the rule-#1 / rule-#2 move (an adapter behind `novel/adapters/`), and it is cheap because Goose is MCP-native and accepts a one-shot prompt via its CLI. But it adds nothing to the orchestrator tier — no daemon, queue, supervision, fleet, or constitution — so it is an agent option, not a substrate. Priority is low because the existing three backends already cover the multi-model story; the only unique pull is the MCP-native extension model + the desktop GUI on-ramp. Goosetown (the multi-agent sibling) is worth re-checking at each refresh, but as of this review it is experimental coordination of *agents within one task*, not an across-session daemon — it does not encroach on Minsky's tick-loop.

## Five pivot questions

> The Five Pivot Questions framework closes the loop on the `## Should we wrap Goose instead?` analysis above with a structured, surface-by-surface decision. For Goose the sharpest question is Q3 — the task's Hypothesis is specifically about whether Goose's AAIF/Linux-Foundation move is a strategic signal Minsky should follow.

### 1. How is it different from Minsky?

Goose is an **agent-tier, MCP-native, multi-model terminal/desktop coding agent**; Minsky is an **orchestrator-tier 24/7 daemon** that drives agents (Claude, Devin, aider) on a `TASKS.md` queue across a fleet of repos, under a 17-rule constitution enforced by CI. The categories do not overlap: Goose is the kind of inner-loop agent Minsky *wraps*, the way it wraps the others. The defining structural differences are (a) the **loop** — Goose exits after one task; Minsky keeps walking the queue indefinitely under a watchdog; (b) the **reviewer** — Goose relies on a human (or recipe prose) for quality; Minsky substitutes a deterministic CI merge gate for that human; and (c) the **self-improvement substrate** — Goose has recipes (static templates); Minsky has MAPE-K (an across-session experiment store + autonomic controller that files its own improvement tasks). The one place Goose is ahead is *governance maturity*: it sits under a neutral foundation, where Minsky is a single-operator OSS project — which is exactly what Q3 examines.

### 2. What lessons can it give to us?

- **Foundation governance as a longevity + trust lever** (AAIF / Linux Foundation donation, 2025) — neutral stewardship is the strongest maintenance signal in the category and a credibility multiplier for adoption. This is the lesson the task's Hypothesis is built on; its strategic weight is assessed in Q3.
- **Recipes as a portable task-template format** — parameterized templates bundling instructions + extensions + sub-tasks. Minsky's brief curation solves the same problem; the lesson is *format portability* (a recipe could be importable as a Minsky brief), not adopting Goose's runtime. Traces to rule #1.
- **MCP-native extension model** — Goose treats every capability as an MCP server. Minsky already leans on MCP via agentbrew; Goose confirms the bet rather than adding anything new.
- **Desktop GUI as an onboarding on-ramp** — a GUI for non-terminal teammates lowers the install-time-to-first-iteration tax that Minsky's `agent-mediated-install` metric tracks. A distribution idea, not a core-loop change.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — but the task's Hypothesis (should Minsky seek a foundation home like Goose did?) was examined and the pivot threshold was NOT crossed, which is the point of asking.** Goose's AAIF/Linux-Foundation donation is a genuinely strong signal: it answers "will this project still be maintained in three years?" with foundation-grade governance, and it is a real credibility advantage Minsky cannot match as a single-operator project. But it does **not** force a Minsky vision change for three reasons: (a) **timing** — a foundation home is a maturity move for a project with an established user base and multiple corporate contributors; Minsky is pre-M1, with one operator and no external adopters, so a foundation donation now would add governance overhead with no contributor base to govern; (b) **scope** — foundation governance is an *organizational/distribution* property, not an architectural one; it changes who owns the repo, not the tick-loop, MAPE-K, identity model, or constitution; (c) **identity** — Minsky's core differentiator (the operator-machine-identity binding + the 17-rule constitution) is *strengthened* by single-operator ownership today and would not be helped by neutral governance until adoption justifies it. The defensible conclusion is **"a foundation home is a future option to revisit once Minsky has real external adopters and corporate contributors — not a present pivot."** A negative finding is logged inline here per the deep-research convention; this task's brief routes operator-facing vision questions centrally (the orchestrator maintains `ask-human.md`), so this doc-level verdict stands in for an `ask-human.md` note. The one thing that would re-open Q3: Minsky gaining ≥3 external corporate contributors, at which point neutral governance becomes worth the overhead. Recommendation: **absorb the recipe-portability + GUI-onramp lessons; no vision change; foundation-home decision deferred, not rejected.**

### 4. How can we improve our strategy based on this?

- **File the foundation-home decision as a deferred, condition-gated option, not a no** — Goose proves foundation governance is a strong longevity signal. Strategy move: keep "seek an AAIF/Linux-Foundation-style home" on the long-horizon roadmap, gated on a concrete trigger (≥3 external corporate contributors), rather than dismissing it. Traces to lesson §2.1 + Q3.
- **Make Goose recipes importable as Minsky briefs** — recipes and briefs solve the same problem in different formats. Strategy move: a thin recipe→brief importer (rule #2 adapter) lets Minsky absorb a recipe ecosystem without owning Goose's runtime. Traces to lesson §2.2 + rule #1.
- **Lower the credential/onboarding tax with a GUI-or-guided on-ramp** — Goose's desktop GUI is a measurable distribution lever. Strategy move: invest in `agent-mediated-install` time-to-first-iteration, the metric a GUI/guided path would move. Traces to lesson §2.4.
- **Lead positioning with "orchestrator, not agent" against foundation-backed agents too** — Goose's foundation backing makes the agent tier look more durable, but it is still agent-tier. Strategy move: pre-empt "isn't this just a foundation-backed terminal agent?" by leading the README with the daemon/queue/fleet/constitution properties no agent CLI (foundation-backed or not) has. Traces to §1.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Goose has no daemon/queue/loop; Goosetown coordinates agents *within* a task, not an across-session operator-machine loop. Nothing to replace.
- **MAPE-K**: KEEP — Goose ships recipes (static templates), not an across-session experiment store + autonomic controller. This is a Minsky moat.
- **adapters / agent backend**: ADD (low priority) — Goose is a clean candidate backend behind the existing `cloud_agent` / `local_agent` abstraction (MCP-native, accepts a one-shot prompt). Seam: the agent-spawn + brief-delivery step. Adds MCP-extension + desktop-GUI coverage; adds nothing to the orchestrator.
- **briefs / skills**: EVALUATE-TO-ABSORB — a recipe→brief importer is the one portability technique worth wrapping; absorb the format, not the runtime.
- **identity / `cross-repo-runner`**: KEEP — Goose runs single-repo, single-task; no fleet walker to replace.
- **constitution-as-CI / lint stack**: KEEP — Goose has no deterministic-rule enforcement; this is the layer that would make a Goose agent safe to run unattended.
- **corpus / scorecard**: KEEP — Goose carries no separate scorecard reading (its score is the model it points at); do NOT add a duplicate corpus entry (rule #4 — no fabricated/double-counted readings).
- **dashboard / TASKS.md surface**: KEEP — Goose has neither a fleet dashboard nor a queue surface.

**Total replace % across all surfaces: 0% orchestrator replacement** — one ADD (optional agent backend) and one EVALUATE-TO-ABSORB (recipe→brief importer); everything orchestrator-tier is KEEP. Headline for the operator: *nothing in the orchestrator to replace; Goose is a candidate additional agent backend and the source of one technique (recipe portability) to absorb; its biggest non-runtime lesson — foundation governance — is a deferred, condition-gated option, not a present pivot.*

## Scorecard readings

Goose carries no separate scorecard reading — its benchmark score is whatever model it is pointed at, and Block has published no reproducible standalone SWE-Bench number Minsky's corpus can cite as a primary source.

| Metric                            | Value | Date | Primary source |
| --------------------------------- | ----- | ---- | -------------- |
| `swe-bench-verified-resolve-rate` | n/a   | —    | No standalone Goose benchmark published; score is the chosen model's. The CLI is plumbing, the model is the measured artefact (see § "Published benchmark numbers"). |

This file intentionally does NOT add a `goose` corpus entry to `novel/competitive-benchmark/src/competitors.ts`: the corpus tracks one reading per published primary-source number (rule #4 — no fabricated or double-counted readings), and Goose has none of its own.

## Last reviewed

2026-06-02 — deepened from stub with `## Should we wrap Goose instead?` + `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-goose`. Updated the governance facts: Goose moved from Block to the Agentic AI Foundation (AAIF / Linux Foundation); org is now `aaif-goose/goose` (~45.8k★). Verdict: ADD Goose as an optional low-priority agent backend; absorb the recipe→brief portability technique; no vision change — the task's Hypothesis (should Minsky seek a foundation home?) was tested and the pivot threshold was NOT crossed (a foundation home is a deferred, condition-gated future option, not a present pivot; negative finding logged inline per this task's central-questions routing). Goosetown coordinates agents within a task, not an across-session daemon, so it does not encroach on the tick-loop.

Earlier reviews: 2026-05-22 (STUB — deep research pending).
