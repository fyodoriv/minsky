# Competitor: SWE-agent (Princeton NLP)

> Princeton NLP's research-benchmark coding agent — Minsky measures against SWE-agent's published SWE-bench scores.

- **URL**: <https://github.com/SWE-agent/SWE-agent>
- **Status**: Active, research-oriented, MIT licensed
- **Pricing**: Free (OSS). Model costs only.
- **Relationship**: **Research benchmark** — minsky measures against SWE-agent's published scores

## What it is

Research agent from Princeton NLP. Pioneered the Agent-Computer Interface (ACI) concept — a custom shell + file viewer optimized for LLM code editing. Strong SWE-bench scores. Designed for research experiments on agent capabilities, not production use.

## Strengths

- **Academic rigor** — published research with reproducible benchmarks
- **ACI innovation** — the Agent-Computer Interface is a genuine contribution to how agents interact with codebases
- **SWE-bench competitive** — strong published scores on the standard benchmark
- **Open source** — MIT, full transparency on methods
- **Multi-LLM** — works with Claude, GPT-4, and other models

## Weaknesses vs minsky's vision

1. **Research, not production** — designed for benchmarking, not for running 24/7 on real repos.
2. **No daemon mode** — single-shot task execution only.
3. **No supervision, budget, or observability** — pure research tool.
4. **No task queue** — runs one benchmark problem at a time.
5. **Setup complexity** — Docker + config for the research harness. Not a `pip install`.
6. **No multi-agent** — single agent architecture.
7. **No self-improvement** — the agent's prompts are manually tuned by researchers.

## What we learn / steal

- **ACI concept** — the idea that the agent's interface to the computer should be purpose-built, not just a terminal. Minsky's brief structure is a lightweight version of this.
- **Benchmark methodology** — SWE-bench is the standard. Minsky's scorecard should run the same or comparable tasks.
- **Published baselines** — SWE-agent's scores are the floor minsky should beat.

## Why choose minsky over SWE-agent

- Production-ready (daemon, supervision, budget, observability)
- Works on any repo (not just SWE-bench problems)
- 24/7 operation
- Multi-agent

## Why choose SWE-agent over minsky

- Better for research/benchmarking
- Higher academic credibility
- Simpler architecture for understanding agent capabilities

## Should we wrap SWE-agent instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: _if this is amazing at everything we do, why not wrap it and run for 24h?_ Honest answer here. SWE-agent is **agent-tier** (per the skill's competitor taxonomy — the same tier as Aider / OpenHands / Claude Code), so the question is "wrap it as a pluggable agent backend?", not "wrap the orchestrator".

| Question | Output |
|---|---|
| 1. **Architectural fit** | Plausible as an **agent-tier backend**, but a poor fit for Minsky's brownfield-across-repos task distribution. SWE-agent is built around the SWE-bench problem shape — a GitHub issue + a repo snapshot + a Dockerised harness — and its flagship scaffold, **mini-swe-agent**, is an explicitly minimal ~100-line bash-only ReAct loop ("no tools, no special interface — just bash", `mini-swe-agent.com`). It runs one issue to completion inside a container; it has no daemon, no queue, no cross-repo loop, no budget guard, no supervision. It could slot behind Minsky's agent seam for the narrow case of "resolve one well-specified issue", but it does not host the tick-loop / MAPE-K / fleet layers. |
| 2. **What we delegate** | **The single-issue resolve step inside a sandbox** — the ACI shell + the bash-only ReAct loop that turns one issue into one patch. SWE-agent would own: the agent-computer-interface (its core contribution, NeurIPS 2024), the per-issue scaffold, and the SWE-bench-shaped evaluation harness. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface). SWE-agent has none of these — it is an inner-loop research scaffold Minsky could drive, not a competitor for the outer loop. Wrapping it as a backend would erode zero moats. |
| 4. **Net moat after wrap** | 6 of 6 (no orchestrator surface is delegated; SWE-agent would fill at most the agent-backend slot alongside Claude / Devin / Aider). The relevant action is technique absorption (the ACI design + the minimal-scaffold lesson), not a structural delegation. |
| 5. **Verdict** | **NO orchestrator wrap; agent-backend wrap is technically possible but NOT worth a P0 today.** SWE-agent's value to Minsky is its published SWE-bench baseline (already in the corpus) and its ACI / minimal-scaffold lessons — not its runtime. Adding it as a fourth pluggable backend would duplicate the issue-resolve capability Claude / Devin already cover, with a heavier Dockerised setup. No P0 wrap task is filed; the agent-backend option is recorded here for re-evaluation. |

**Trigger for re-evaluation**: if mini-swe-agent ships a daemon / queue / unattended `--watch` mode (contradicting its current "minimal single-issue scaffold" stance), OR if the SWE-bench Verified gap between mini-swe-agent and Minsky's chosen cloud backend (Claude / Devin) widens past ~10 points in mini-swe-agent's favour on the official `swebench.com` leaderboard, re-run this analysis — the second condition would make SWE-agent's scaffold worth wrapping for its accuracy alone.

## Five pivot questions

### 1. How is it different from Minsky?

SWE-agent is an **agent-tier research scaffold**; Minsky is an **orchestrator-tier 24/7 daemon** that drives agents on a queue across repos. SWE-agent's stated intent (Yang, Jimenez, Wettig, Lieret, Yao, Narasimhan, Press, _SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering_, NeurIPS 2024) is to study how the **interface** between an LLM and a computer affects agent capability — its core contribution is the Agent-Computer Interface (ACI), a purpose-built shell + file viewer, not an unattended production loop. Its current flagship, **mini-swe-agent**, doubles down on minimalism: ~100 lines of bash-only ReAct, deliberately no custom tools (`mini-swe-agent.com`). The defining structural difference is the unit of work and the time horizon: SWE-agent resolves **one benchmark issue inside a container**; Minsky keeps a **fleet of repos improving without a human**, under a constitution enforced by CI. SWE-agent is the kind of inner-loop scaffold Minsky could wrap; it is not a peer for the outer loop.

### 2. What lessons can it give to us?

- **The Agent-Computer Interface (ACI) as a first-class design surface** (NeurIPS 2024 paper § "Agent-Computer Interfaces"; the `swe_agent`/`tools` directories in the repo) — the paper's central, falsifiable finding is that a purpose-built interface (a constrained shell, a paginated file viewer, lint-on-edit feedback) raises resolve rate far more than swapping the underlying model. The portable lesson for Minsky: the **brief + the agent's tool surface** are a measurable design seam, not an afterthought. Minsky's brief structure is already a lightweight ACI; the lesson is to treat it as one explicitly and measure changes to it the way SWE-agent measured ACI variants.
- **Minimal scaffold beats elaborate scaffold** (mini-swe-agent's "Gemini 3 Pro reaches 74% on SWE-bench verified with mini-swe-agent!", `mini-swe-agent.com`) — the team's own headline result comes from their _simplest_ scaffold, not their most elaborate one. A ~100-line bash-only ReAct loop on a strong model beats heavier harnesses. The lesson: Minsky should resist over-engineering the per-agent scaffold and let the model + a clean tool surface do the work — consistent with rule #1 (don't reinvent) at the scaffold layer.
- **Benchmark-as-source-of-truth and dated leaderboard submissions** (`swebench.com` "Bash Only" track; the dated 2026-02-26 submission already cited in the Scorecard readings) — SWE-agent publishes against a fixed, third-party Verified split and submits dated runs to an external leaderboard. This is rule #9 (pre-registered HDD) and rule #4 (visible, not silent) practiced by the research project that _created_ the benchmark Minsky measures against. The lesson: keep citing SWE-bench Verified _from the official leaderboard_ rather than re-running an equivalent harness ourselves.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** The Hypothesis behind this task was that SWE-agent's ACI framing might pressure how Minsky describes its agent-interface layer. On inspection it does not: the ACI is a _technique_ that lives inside the agent backend Minsky wraps, one level below the orchestrator surface that `vision.md § What Minsky is` defines. Absorbing a better tool surface or a more minimal scaffold sharpens the inner loop without touching any of the 17 rules or the "daemon-not-framework, drives agents under a constitution" identity. The benchmark-discipline lesson actively _confirms_ rules #9 and #4 rather than challenging them. A negative finding is recorded here in the doc per the deep-research convention (this task's brief routes operator questions centrally rather than into this file); recommendation: **absorb the ACI + minimal-scaffold + leaderboard-citation lessons, no vision change.**

### 4. How can we improve our strategy based on this?

- **Treat the brief / agent tool-surface as an explicit, measurable ACI seam** — SWE-agent's strongest result is that interface quality dominates model choice. Strategy move: name Minsky's brief-assembly + agent tool surface as a deliberate ACI, and measure changes to it against resolve rate the way SWE-agent measured ACI variants. Traces to lesson §2.1.
- **Default to the minimal scaffold; resist per-agent harness creep** — mini-swe-agent proves the simplest scaffold can be the best. Strategy move: keep Minsky's per-agent wrapper thin (brief in, patch + PR out) and put complexity in the _orchestrator_ (the moat), not the per-iteration scaffold (commodity). Traces to lesson §2.2.
- **Cite the official SWE-bench leaderboard as a free external benchmark** — SWE-agent maintains the canonical Verified split and a dated leaderboard. Strategy move: keep sourcing the M1.10 corpus reading from `swebench.com` rather than standing up our own harness (rule #1). Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — SWE-agent has no daemon / queue / loop; mini-swe-agent runs one issue to completion. Nothing to replace.
- **MAPE-K**: KEEP — no self-improvement / monitor-analyze-plan-execute substrate exists in SWE-agent.
- **adapters / agent backend**: AUGMENT (optional) — SWE-agent _could_ be added as a pluggable agent backend behind `novel/adapters/`, but it duplicates the issue-resolve capability Claude / Devin already provide with heavier Dockerised setup, so the verdict is "possible, not worth a P0 today" (see § "Should we wrap?"). The more valuable AUGMENT is technique absorption: treat the brief + tool surface as a measurable ACI.
- **sandbox**: AUGMENT (technique) — SWE-agent's Dockerised per-issue environment is a reference design for a hardened sandbox seam, worth studying if Minsky's sandbox layer is built out; no replacement today.
- **corpus / scorecard**: KEEP + CITE — SWE-agent stays the research benchmark in the M1.10 corpus (`novel/competitive-benchmark/src/competitors.ts`); keep citing its official Verified leaderboard number rather than re-running the harness.
- **dashboard / TASKS.md surface**: KEEP — SWE-agent has neither a fleet dashboard nor a queue surface.

**Total replace % across all surfaces: 0% orchestrator replacement** (no surface is delegated; the agent-backend option is AUGMENT-optional, everything else KEEP / technique-AUGMENT). The headline for the operator: _nothing in the orchestrator to replace; SWE-agent's value is its ACI design lesson, its minimal-scaffold lesson, and its published SWE-bench baseline — all absorbed without a wrap._

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source                                                                                                                                                                                                                                  |
| ----------------------------------- | ----- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.74  | 2026-02-26 | SWE-bench Verified leaderboard (`swebench.com`, "Bash Only" track), _mini-swe-agent + Gemini 3 Pro_, submitted 2026-02-26 (resolve rate 0.74 on the 500-instance Verified split); primary statement at `mini-swe-agent.com`.                     |
| `swe-bench-multimodal-resolve-rate` | 0.12  | 2024-10-04 | Yang et al., _SWE-bench Multimodal: Do AI Systems Generalize to Visual Software Domains?_, arXiv 2410.03859, ICLR 2025 — "SWE-agent's flexible language-agnostic features enable it to substantially outperform alternatives on SWE-bench M, resolving 12% of task instances compared to 6% for the next best system." The **frontend** dimension of the OpenHands Index 5-task suite (`research-finding-multi-task-benchmark-suite`); SWE-agent holds the published top reading, making it the only vendor-primary per-dimension Index-shape score in the corpus today. |

This is the **frontend** axis of the OpenHands Index multi-task suite
(issue-resolution / greenfield / frontend / testing / info-gathering — see
`novel/competitive-benchmark/README.md` § "OpenHands Index multi-task
suite"). SWE-bench Multimodal (617 JavaScript front-end / data-viz /
diagramming instances, each carrying ≥1 image) exposes the visual-reasoning
gap a text-only SWE-bench Verified number masks: even the top system clears
only 12%.

Note: this reading was refreshed (2026-06-02) from the original 2024
NeurIPS baseline to the SWE-agent team's current flagship scaffold,
**mini-swe-agent** — a ~100-line minimal bash-only ReAct agent. The
project's documented headline is "Gemini 3 Pro reaches 74% on SWE-bench
verified with mini-swe-agent!" (`mini-swe-agent.com`), and the same run
appears as a dated submission (2026-02-26) on the official SWE-bench
Verified "Bash Only" leaderboard at `swebench.com`. Unlike the prior
entry, this is a true **Verified-split** number, so the previous
full-split/Lite proxy caveat no longer applies.

Superseded reading (history): SWE-agent + GPT-4, resolve rate 0.125 on
the 2,294-instance full SWE-bench split — Yang, Jimenez, Wettig, Lieret,
Yao, Narasimhan, Press, _SWE-agent: Agent-Computer Interfaces Enable
Automated Software Engineering_, NeurIPS 2024. That figure was carried
as a Verified proxy (cross-referenced against the Aider leaderboard,
`aider.chat/2024/06/02/main-swe-bench.html`, which listed SWE-agent +
GPT-4 at 12.5%) until the project shipped mini-swe-agent and a
Verified-split number became available.

## Last reviewed

2026-06-02
