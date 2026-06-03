# Competitor: SWE-agent (Princeton NLP)

> A research coding agent that proved a good interface beats a bigger model. Minsky uses its published SWE-bench scores as a benchmark to beat.

- **URL**: <https://github.com/SWE-agent/SWE-agent>
- **Status**: Active, research-oriented, MIT licensed
- **Pricing**: Free (OSS). Model costs only.
- **Relationship**: **Research benchmark** — Minsky measures itself against SWE-agent's published scores.

## What this is

SWE-agent is a research project from Princeton NLP. It takes one well-defined coding task — usually a GitHub issue plus a snapshot of a repository — and asks a coding assistant (such as Claude or GPT-4) to produce a patch that resolves it. It runs that single task to completion inside a Docker container, then stops.

Its key idea is the **Agent-Computer Interface (ACI)**: instead of handing the coding assistant a raw terminal, SWE-agent gives it a purpose-built shell, a paginated file viewer, and lint feedback on every edit. The team's finding is that this interface raises the resolve rate more than swapping in a stronger model. SWE-agent is built to run experiments on agent capability and to post strong scores on the SWE-bench benchmark, not to run on real repositories day to day.

## What this is not

- **Not a daemon.** It does not keep running in the background; it executes one task and exits. (A daemon is a background program that keeps running, survives terminal close, and restarts on crash — Minsky is one; SWE-agent is not.)
- **Not a task queue.** It works one benchmark problem at a time, with no list of pending work to walk.
- **Not a fleet runner.** It does not move across several repositories (a "host" here means one git repository Minsky works on).
- **Not self-improving.** Its prompts are tuned by hand by researchers, not by an automatic loop.
- **Not a one-line install.** It needs Docker plus configuration for the research harness, not a single `pip install`.

## Strengths

- **Academic rigor** — published research with reproducible benchmarks.
- **ACI innovation** — the Agent-Computer Interface is a genuine contribution to how agents interact with codebases.
- **SWE-bench competitive** — strong published scores on the standard benchmark.
- **Open source** — MIT, full transparency on methods.
- **Multi-LLM** — works with Claude, GPT-4, and other models.

## Weaknesses vs Minsky's vision

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
- **Published baselines** — SWE-agent's scores are the floor Minsky should beat.

## Why choose Minsky over SWE-agent

- Production-ready (daemon, supervision, budget, observability)
- Works on any repo (not just SWE-bench problems)
- 24/7 operation
- Multi-agent

## Why choose SWE-agent over Minsky

- Better for research/benchmarking
- Higher academic credibility
- Simpler architecture for understanding agent capabilities

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

## Should we wrap SWE-agent instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with one question: _if this is amazing at everything we do, why not wrap it and run it for 24h?_ The honest answer follows.

SWE-agent is an **agent** — the coding assistant that does the actual work, the same tier as Aider, OpenHands, and Claude Code. (Minsky is not an agent; it orchestrates agents.) So the real question is "wrap it as a swappable agent backend?", not "wrap the orchestrator?".

| Question | Output |
|---|---|
| 1. **Architectural fit** | Plausible as an **agent backend**, but a poor fit for Minsky's job of distributing tasks across many real repos. SWE-agent is built around the SWE-bench problem shape — a GitHub issue + a repo snapshot + a Dockerised harness — and its flagship scaffold, **mini-swe-agent**, is a deliberately minimal ~100-line bash-only ReAct loop ("no tools, no special interface — just bash", `mini-swe-agent.com`). It runs one issue to completion inside a container. It has no daemon, no queue, no cross-repo loop, no budget guard, no supervisor (the watchdog that restarts Minsky if it dies). It could slot behind Minsky's agent seam for the narrow case of "resolve one well-specified issue", but it cannot host the loop, self-improvement, or fleet layers. |
| 2. **What we delegate** | **The single-issue resolve step inside a sandbox** — the ACI shell plus the bash-only ReAct loop that turns one issue into one patch. SWE-agent would own its Agent-Computer Interface (its core contribution, NeurIPS 2024), its per-issue scaffold, and its SWE-bench-shaped evaluation harness. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution + CI, MAPE-K self-improvement substrate, cross-repo fleet, TASKS.md surface). SWE-agent has none of these — it is an inner-loop research scaffold Minsky could drive, not a competitor for the outer loop. Wrapping it as a backend would erode zero moats. |
| 4. **Net moat after wrap** | 6 of 6. No orchestrator surface is delegated; SWE-agent would fill at most the agent-backend slot alongside Claude, Devin, and Aider. The useful action is absorbing the technique (the ACI design plus the minimal-scaffold lesson), not a structural delegation. |
| 5. **Verdict** | **NO orchestrator wrap; an agent-backend wrap is technically possible but NOT worth a P0 today.** SWE-agent's value to Minsky is its published SWE-bench baseline (already in the corpus) and its ACI / minimal-scaffold lessons — not its runtime. Adding it as a fourth swappable backend would duplicate the issue-resolve capability Claude and Devin already cover, with a heavier Dockerised setup. No P0 wrap task is filed; the agent-backend option is recorded here for re-evaluation. |

**Trigger for re-evaluation**: re-run this analysis if either holds. (1) mini-swe-agent ships a daemon / queue / unattended `--watch` mode, contradicting its current "minimal single-issue scaffold" stance. (2) The SWE-bench Verified gap between mini-swe-agent and Minsky's chosen cloud backend (Claude / Devin) widens past ~10 points in mini-swe-agent's favour on the official `swebench.com` leaderboard — that would make SWE-agent's scaffold worth wrapping for its accuracy alone.

## Five pivot questions

### 1. How is it different from Minsky?

SWE-agent is an **agent-tier research scaffold**; Minsky is an **orchestrator** — a 24/7 background program that drives agents through a queue across repos. SWE-agent's stated goal (Yang, Jimenez, Wettig, Lieret, Yao, Narasimhan, Press, _SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering_, NeurIPS 2024) is to study how the **interface** between an LLM and a computer affects agent capability. Its core contribution is the Agent-Computer Interface (ACI), a purpose-built shell + file viewer, not an unattended production loop. Its current flagship, **mini-swe-agent**, doubles down on minimalism: ~100 lines of bash-only ReAct, deliberately no custom tools (`mini-swe-agent.com`).

The defining difference is the unit of work and the time horizon. SWE-agent resolves **one benchmark issue inside a container**. Minsky keeps a **fleet of repos improving without a human**, under a constitution enforced by CI. SWE-agent is the kind of inner-loop scaffold Minsky could wrap; it is not a peer for the outer loop.

### 2. What lessons can it give to us?

- **The Agent-Computer Interface (ACI) as a first-class design surface** (NeurIPS 2024 paper § "Agent-Computer Interfaces"; the `swe_agent`/`tools` directories in the repo). The paper's central, falsifiable finding is that a purpose-built interface — a constrained shell, a paginated file viewer, lint-on-edit feedback — raises the resolve rate far more than swapping the underlying model. The lesson for Minsky: the **brief plus the agent's tool surface** are a measurable design seam, not an afterthought. Minsky's brief structure is already a lightweight ACI; treat it as one explicitly and measure changes to it the way SWE-agent measured ACI variants.
- **A minimal scaffold beats an elaborate scaffold** (mini-swe-agent's "Gemini 3 Pro reaches 74% on SWE-bench verified with mini-swe-agent!", `mini-swe-agent.com`). The team's own headline result comes from their _simplest_ scaffold, not their most elaborate one: a ~100-line bash-only ReAct loop on a strong model beats heavier harnesses. The lesson: Minsky should resist over-engineering the per-agent scaffold and let the model plus a clean tool surface do the work — consistent with rule #1 (don't reinvent) at the scaffold layer.
- **Benchmark-as-source-of-truth, with dated leaderboard submissions** (`swebench.com` "Bash Only" track; the dated 2026-02-26 submission cited in the Scorecard readings). SWE-agent publishes against a fixed, third-party Verified split and submits dated runs to an external leaderboard. This is rule #9 (pre-registered hypothesis-driven development — every change states its hypothesis, threshold, and measurement before code is written) and rule #4 (visible, not silent) practiced by the research project that _created_ the benchmark Minsky measures against. The lesson: keep citing SWE-bench Verified _from the official leaderboard_ rather than re-running an equivalent harness ourselves.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** The hypothesis behind this review was that SWE-agent's ACI framing might pressure how Minsky describes its agent-interface layer. On inspection it does not. The ACI is a _technique_ that lives inside the agent backend Minsky wraps, one level below the orchestrator surface that `vision.md § What Minsky is` defines. Absorbing a better tool surface or a more minimal scaffold sharpens the inner loop without touching any of the 17 rules or the "daemon-not-framework, drives agents under a constitution" identity. The benchmark-discipline lesson actively _confirms_ rules #9 and #4 rather than challenging them. Recommendation: **absorb the ACI, minimal-scaffold, and leaderboard-citation lessons; no vision change.**

### 4. How can we improve our strategy based on this?

- **Treat the brief / agent tool-surface as an explicit, measurable ACI seam.** SWE-agent's strongest result is that interface quality dominates model choice. Strategy move: name Minsky's brief-assembly + agent tool surface as a deliberate ACI, and measure changes to it against resolve rate the way SWE-agent measured ACI variants. Traces to lesson §2.1.
- **Default to the minimal scaffold; resist per-agent harness creep.** mini-swe-agent proves the simplest scaffold can be the best. Strategy move: keep Minsky's per-agent wrapper thin (brief in, patch + PR out) and put complexity in the _orchestrator_ (the moat), not the per-iteration scaffold (commodity). Traces to lesson §2.2.
- **Cite the official SWE-bench leaderboard as a free external benchmark.** SWE-agent maintains the canonical Verified split and a dated leaderboard. Strategy move: keep sourcing the M1.10 corpus reading from `swebench.com` rather than standing up our own harness (rule #1). Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop** (the loop that wakes on a timer to pick and run a task): KEEP — SWE-agent has no daemon, queue, or loop; mini-swe-agent runs one issue to completion. Nothing to replace.
- **MAPE-K** (the self-improvement loop — Monitor, Analyze, Plan, Execute over a Knowledge base): KEEP — no self-improvement substrate exists in SWE-agent.
- **adapters / agent backend** (the swappable wrapper that lets Minsky drive one coding assistant): AUGMENT (optional) — SWE-agent _could_ be added as a swappable agent backend behind `novel/adapters/`, but it duplicates the issue-resolve capability Claude and Devin already provide, with heavier Dockerised setup. The verdict is "possible, not worth a P0 today" (see § "Should we wrap?"). The more valuable AUGMENT is technique absorption: treat the brief + tool surface as a measurable ACI.
- **sandbox**: AUGMENT (technique) — SWE-agent's Dockerised per-issue environment is a reference design for a hardened sandbox seam, worth studying if Minsky's sandbox layer is built out. No replacement today.
- **corpus / scorecard**: KEEP + CITE — SWE-agent stays the research benchmark in the M1.10 corpus (`novel/competitive-benchmark/src/competitors.ts`); keep citing its official Verified leaderboard number rather than re-running the harness.
- **dashboard / TASKS.md surface**: KEEP — SWE-agent has neither a fleet dashboard nor a queue surface.

**Total replace across all surfaces: 0% orchestrator replacement.** No surface is delegated; the agent-backend option is AUGMENT-optional, everything else is KEEP or technique-AUGMENT. The headline for you: _nothing in the orchestrator to replace. SWE-agent's value is its ACI design lesson, its minimal-scaffold lesson, and its published SWE-bench baseline — all absorbed without a wrap._

## Last reviewed

2026-06-02
