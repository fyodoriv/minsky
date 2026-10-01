# Competitor: Goose

> Goose is an open-source coding assistant you run in your terminal or as a desktop app. Minsky could drive it as one of the coding assistants it points at your code — the way it already drives Claude, Devin, and Aider.

- **URL**: <https://github.com/aaif-goose/goose> (foundation org; previously `github.com/block/goose`)
- **Site**: <https://block.github.io/goose/>
- **Status**: Active, Apache 2.0. Originated at Block; governance donated to the Agentic AI Foundation (AAIF / Linux Foundation) in 2025. ~45.8k★ (`gh api repos/aaif-goose/goose --jq .stargazers_count`).
- **Pricing**: Free (OSS). Bring your own model API key, or use a provider-bundled plan.
- **Relationship**: **Competitor (agent-tier) + candidate wrap target.** In this document, "agent" means the coding assistant that does the actual work. Goose is an agent — the kind of inner-loop tool Minsky drives, not a peer to Minsky's outer loop. Minsky could add Goose as one more agent it points at your code, alongside Claude, Devin, and Aider.

## What this is

Goose is an open-source coding assistant for software-engineering tasks. You run it next to your code, tell it what to change, and it edits the files. It comes in two forms: a command-line tool and a desktop app with a graphical interface.

Goose works with many models — Anthropic, OpenAI, Google, Ollama, Databricks, OpenRouter, Bedrock, and others — through a built-in provider layer. It runs on macOS, Linux, and Windows. It is MCP-native: every capability is delivered as a Model Context Protocol server (Goose calls these "extensions"), so an existing MCP setup ports over with no rewiring.

Goose has four features worth naming, because each maps to something Minsky already has:

- **Recipes** — reusable task templates. A recipe is a YAML or Markdown file that bundles instructions, extensions, and sub-tasks. This is close to Minsky's skills and briefs.
- **Subagents and Tasks** — a way to split one job into smaller pieces. A sibling experimental project, "Goosetown," explores having several agents coordinate on the same task.
- **Execution model** — Goose runs on your machine against your real working tree. It trusts you, the operator, rather than locking everything inside a container. This is closer to Claude Code's terminal-native shape than to OpenHands' Docker-per-conversation shape.
- **Governance** — in 2025, Goose moved from Block to the Agentic AI Foundation (AAIF), a Linux Foundation project. That gives it vendor-neutral stewardship and an open contributor pipeline that survives any single sponsor. This is the change this file studies most closely.

In this document, "agent" means the coding assistant that does the editing — Goose here, or Claude Code, Devin, or Aider elsewhere. Minsky is not an agent. Minsky is the program that drives agents. Goose is one of the agents Minsky could drive.

## What this is not

- **Not an orchestrator.** Goose has no daemon — no background program that keeps running on your machine after you start it. It exits when the task finishes.
- **Not a task queue or a fleet walker.** Goose has no `TASKS.md`-equivalent (the plain-text Markdown to-do list Minsky reads to pick work). You, the operator, decide what it works on next. It does not walk several repositories in turn.
- **Not a self-improving system.** Goose has recipes, which are static templates. It has no across-session learning loop that records its own results and gets better over time.

### Published benchmark numbers

Goose publishes no standalone SWE-Bench Verified score of its own. Like every command-line or desktop agent, its score is whatever model you point it at — the tool is plumbing, and the model is the measured artifact. This matters for the decision below: swapping Minsky's agent backend for Goose inherits the chosen model's score; it does not add a new one. Block has published internal case studies on engineering productivity, but no reproducible benchmark Minsky's corpus can cite as a primary source.

## Strengths

- **MCP-native** — Goose extensions are MCP servers, so an existing MCP investment ports cleanly with no re-plumbing.
- **Multi-model first-class** — the provider layer is core to the design, not bolted on. It is the direct analogue to Minsky's `cloud_agent` / `local_agent` seam.
- **Foundation-governed (AAIF / Linux Foundation)** — the strongest long-term-maintenance signal in the category. Neutral stewardship survives a sponsor losing interest; a single-vendor OSS agent does not.
- **Recipes** — parameterized task templates, conceptually adjacent to Minsky's skills and briefs. Worth a direct technique comparison.
- **Desktop GUI** — lowers the barrier for teammates who do not live in a terminal. A distribution lever Minsky lacks.
- **Local-model and accelerator support** — Ollama and on-device accelerators (Apple silicon, CUDA) make a zero-cloud-token path viable, the same property Minsky's `--local` mode targets.

## Weaknesses vs Minsky's vision

Minsky is an orchestrator: a background program you point at your code projects, which picks up to-do tasks and works on them on its own, around the clock, and hands you a draft to review. Measured against that role, Goose is missing the entire outer loop.

1. **Single-task focused.** Like Claude Code, Goose is built for one task at a time. There is no daemon.
2. **No queue or fleet.** No `TASKS.md`-equivalent. You are the scheduler, and there is no round-robin over many repos.
3. **No self-improvement loop or experiment store.** Recipes are templates, not a controller that records its own outcomes and improves on them. Minsky's MAPE-K loop (Monitor, Analyze, Plan, Execute over a Knowledge base — the self-improvement loop, after Kephart & Chess 2003) does this; Goose has no equivalent.
4. **No multi-step role pipeline with feedback.** Recipes and subagents are ways to split up work, not a chain of personas (researcher, planner, implementer, QA) wired to a self-improvement loop.
5. **No constitution or deterministic enforcement.** Goose has no equivalent of Minsky's 17 numbered project rules enforced by the `pnpm pre-pr-lint --stage=full` CI gate. Its conventions live in recipe prose, not in CI.
6. **Sandbox trusts the operator.** A weaker default-deny posture than OpenHands' Docker or Codex CLI's Landlock/Seatbelt. Comparable to Claude Code.

## What we learn / steal

- **Foundation governance as a maintenance and trust signal.** The AAIF donation is the headline lesson and the subject of this file's central question (answered in Q3). It is a *positioning* and *longevity* technique, not a runtime one.
- **Recipes as a portable task-template format.** Parameterized templates that bundle instructions, extensions, and sub-tasks. Compare to Minsky's brief curation. The lesson is *format portability*, not adopting Goose's runtime.
- **First-class provider abstraction.** Goose's provider layer is the clean shape Minsky's agent adapter seam already mirrors. It confirms the design; nothing new to absorb.
- **Desktop GUI as an on-ramp.** A graphical interface lowers the onboarding tax for non-terminal users. A distribution idea for a future Minsky surface, not a core-loop change.

## Why choose Minsky over Goose

- A daemon that runs around the clock with supervision, a budget guard, and a watchdog — it outlives any one task. Goose exits when the task finishes.
- A `TASKS.md` queue plus a cross-repo fleet. Goose works per-invocation, on one repo.
- A MAPE-K self-improvement loop across sessions. Goose has no experiment store or self-improving controller.
- A constitution enforced as CI — 17 rules checked deterministically. Goose has no equivalent gate.
- Operator-machine identity end-to-end — commits land as you, the operator, with no token handoff.

## Why choose Goose over Minsky

- You want a polished single-task agent today, in both a terminal and a desktop app, with a GUI for non-terminal teammates.
- You want MCP-native extensions and a mature multi-model provider layer out of the box.
- You value vendor-neutral foundation governance (AAIF / Linux Foundation) over a single-maintainer or single-vendor project.
- You do not need an around-the-clock orchestrator. You are happy to be the scheduler.

## Should we wrap Goose instead?

**Verdict: ADD as an optional agent backend (low priority). Do NOT replace the orchestrator.**

Goose fills exactly the agent-tier slot Minsky already abstracts behind `cloud_agent` / `local_agent`. Wrapping it is the natural move under rule #1 (don't reinvent what already exists) and rule #2 (talk to outside tools through an adapter — a small wrapper file under `novel/adapters/`). It is cheap, because Goose is MCP-native and accepts a one-shot prompt through its CLI.

But Goose adds nothing to the orchestrator tier — no daemon, queue, supervision, fleet, or constitution — so it is an agent option, not a substrate. Priority is low because the existing three backends already cover the multi-model story. The only unique pull is the MCP-native extension model plus the desktop-GUI on-ramp. Goosetown (the multi-agent sibling) is worth re-checking at each refresh, but as of this review it coordinates *agents within one task*, not an across-session daemon — so it does not encroach on Minsky's loop.

## Five pivot questions

> These five questions close the loop on the wrap decision above with a structured, surface-by-surface answer. For Goose the sharpest one is Q3: should Minsky follow Goose's move to a Linux Foundation home?

### 1. How is it different from Minsky?

Goose is an agent: an MCP-native, multi-model coding assistant you run in a terminal or a desktop app. Minsky is an orchestrator: a background program that drives agents (Claude, Devin, Aider) through a `TASKS.md` queue across a fleet of repos, under 17 rules enforced by CI. The two do not overlap — Goose is the kind of inner-loop agent Minsky wraps. Three structural differences define the gap:

- **The loop.** Goose exits after one task. Minsky keeps walking the queue indefinitely under a watchdog.
- **The reviewer.** Goose relies on a human, or recipe prose, for quality. Minsky substitutes a deterministic CI merge gate for that human.
- **The self-improvement substrate.** Goose has recipes (static templates). Minsky has a MAPE-K loop — an across-session experiment store plus a self-improving controller that files its own improvement tasks.

The one place Goose is ahead is governance maturity: it sits under a neutral foundation, where Minsky is a single-operator OSS project. That is exactly what Q3 examines.

### 2. What lessons can it give to us?

- **Foundation governance as a longevity and trust lever** (AAIF / Linux Foundation donation, 2025). Neutral stewardship is the strongest maintenance signal in the category and a credibility multiplier for adoption. Its strategic weight is assessed in Q3.
- **Recipes as a portable task-template format** — parameterized templates that bundle instructions, extensions, and sub-tasks. Minsky's brief curation solves the same problem. The lesson is *format portability* (a recipe could be importable as a Minsky brief), not adopting Goose's runtime. Traces to rule #1.
- **MCP-native extension model** — Goose treats every capability as an MCP server. Minsky already leans on MCP, so Goose confirms the bet rather than adding anything new.
- **Desktop GUI as an onboarding on-ramp** — a GUI for non-terminal teammates lowers the install-time-to-first-iteration tax that Minsky's `agent-mediated-install` metric tracks. A distribution idea, not a core-loop change.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** But the central question — should Minsky seek a foundation home like Goose did? — was examined, and the pivot threshold was NOT crossed, which is the point of asking.

Goose's AAIF / Linux Foundation donation is a genuinely strong signal. It answers "will this project still be maintained in three years?" with foundation-grade governance, a real credibility advantage Minsky cannot match as a single-operator project. But it does not force a Minsky vision change, for three reasons:

- **Timing.** A foundation home is a maturity move for a project with an established user base and multiple corporate contributors. Minsky is pre-M1, with one operator and no external adopters. A foundation donation now would add governance overhead with no contributor base to govern.
- **Scope.** Foundation governance is an organizational and distribution property, not an architectural one. It changes who owns the repo, not the loop, the MAPE-K self-improvement loop, the identity model, or the constitution.
- **Identity.** Minsky's core differentiator — the operator-machine-identity binding plus the 17-rule constitution — is *strengthened* by single-operator ownership today. Neutral governance would not help it until adoption justifies it.

The defensible conclusion: a foundation home is a future option to revisit once Minsky has real external adopters and corporate contributors — not a present pivot. This negative finding is logged inline here per the deep-research convention. The one thing that would re-open Q3: Minsky gaining three or more external corporate contributors, at which point neutral governance becomes worth the overhead.

Recommendation: absorb the recipe-portability and GUI-on-ramp lessons; no vision change; the foundation-home decision is deferred, not rejected.

### 4. How can we improve our strategy based on this?

- **File the foundation-home decision as a deferred, condition-gated option, not a no.** Goose proves foundation governance is a strong longevity signal. Keep "seek an AAIF / Linux Foundation-style home" on the long-horizon roadmap, gated on a concrete trigger (three or more external corporate contributors), rather than dismissing it. Traces to §2 lesson 1 and Q3.
- **Make Goose recipes importable as Minsky briefs.** Recipes and briefs solve the same problem in different formats. A thin recipe-to-brief importer (a rule #2 adapter) lets Minsky absorb a recipe ecosystem without owning Goose's runtime. Traces to §2 lesson 2 and rule #1.
- **Lower the credential and onboarding tax with a GUI-or-guided on-ramp.** Goose's desktop GUI is a measurable distribution lever. Invest in the `agent-mediated-install` time-to-first-iteration metric — the one a GUI or guided path would move. Traces to §2 lesson 4.
- **Lead positioning with "orchestrator, not agent" against foundation-backed agents too.** Goose's foundation backing makes the agent tier look more durable, but it is still agent-tier. Pre-empt "isn't this just a foundation-backed terminal agent?" by leading the README with the daemon, queue, fleet, and constitution properties no agent CLI has, foundation-backed or not. Traces to §1.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **The loop**: KEEP — Goose has no daemon, queue, or loop. Goosetown coordinates agents *within* a task, not an across-session operator-machine loop. Nothing to replace.
- **MAPE-K self-improvement loop**: KEEP — Goose ships recipes (static templates), not an across-session experiment store plus self-improving controller. This is a Minsky moat.
- **Adapters / agent backend**: ADD (low priority) — Goose is a clean candidate backend behind the existing `cloud_agent` / `local_agent` abstraction (MCP-native, accepts a one-shot prompt). The seam is the agent-spawn and brief-delivery step. Adds MCP-extension and desktop-GUI coverage; adds nothing to the orchestrator.
- **Briefs / skills**: EVALUATE-TO-ABSORB — a recipe-to-brief importer is the one portability technique worth wrapping. Absorb the format, not the runtime.
- **Identity / `cross-repo-runner`**: KEEP — Goose runs single-repo, single-task. There is no fleet walker to replace.
- **Constitution-as-CI / lint stack**: KEEP — Goose has no deterministic-rule enforcement. This is the layer that would make a Goose agent safe to run unattended.
- **Corpus / scorecard**: KEEP — Goose carries no separate scorecard reading (its score is the model it points at). Do NOT add a duplicate corpus entry (rule #4 — no fabricated or double-counted readings).
- **Dashboard / `TASKS.md` surface**: KEEP — Goose has neither a fleet dashboard nor a queue surface.

**Total replace across all surfaces: 0% orchestrator replacement.** One ADD (an optional agent backend) and one EVALUATE-TO-ABSORB (a recipe-to-brief importer); everything orchestrator-tier is KEEP. The headline for you, the operator: nothing in the orchestrator to replace; Goose is a candidate additional agent backend and the source of one technique (recipe portability) to absorb; its biggest non-runtime lesson — foundation governance — is a deferred, condition-gated option, not a present pivot.

## Scorecard readings

Goose carries no separate scorecard reading. Its benchmark score is whatever model you point it at, and Block has published no reproducible standalone SWE-Bench number Minsky's corpus can cite as a primary source.

| Metric                            | Value | Date | Primary source |
| --------------------------------- | ----- | ---- | -------------- |
| `swe-bench-verified-resolve-rate` | n/a   | —    | No standalone Goose benchmark published; score is the chosen model's. The CLI is plumbing, the model is the measured artefact (see § "Published benchmark numbers"). |

This file intentionally does NOT add a `goose` corpus entry to `novel/competitive-benchmark/src/competitors.ts`: the corpus tracks one reading per published primary-source number (rule #4 — no fabricated or double-counted readings), and Goose has none of its own.

## Last reviewed

2026-06-02 — deepened from stub with `## Should we wrap Goose instead?` + `## Five pivot questions` per task `competitor-deepen-goose`. Updated the governance facts: Goose moved from Block to the Agentic AI Foundation (AAIF / Linux Foundation); org is now `aaif-goose/goose` (~45.8k★). Verdict: ADD Goose as an optional low-priority agent backend; absorb the recipe-to-brief portability technique; no vision change — the central question (should Minsky seek a foundation home?) was tested and the pivot threshold was NOT crossed (a foundation home is a deferred, condition-gated future option, not a present pivot; negative finding logged inline per this task's central-questions routing). Goosetown coordinates agents within a task, not an across-session daemon, so it does not encroach on the loop.

Earlier reviews: 2026-05-22 (STUB — deep research pending).
