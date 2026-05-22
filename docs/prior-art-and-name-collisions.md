# Prior art and name collisions

> "Minsky" is a popular name. This doc tells you which Minsky you found, and where this Minsky's ideas come from.

## Not to be confused with...

There are several pieces of software called "Minsky". This one — the [`fyodoriv/minsky`](https://github.com/fyodoriv/minsky) autonomous coding daemon — has zero overlap with any of them. If you arrived here looking for one of the projects below, you're in the wrong place; the links go to the right place.

| If you wanted... | You want | Not this |
|---|---|---|
| **Economic modelling, Steve Keen, Godley tables, stock-flow consistency** | [`highperformancecoder/minsky`](https://github.com/highperformancecoder/minsky) — system dynamics + economic modelling tool (Simulink-like graphical environment). 366★, active, ~7,851 commits, last release 2025-07. Named after the economist Hyman Minsky, NOT Marvin Minsky. | An autonomous AI coding daemon. |
| **Multilingual conversational AI for Indian languages** | [`minsky.app`](https://minsky.app/) — NeuroBridge Tech's LLM + speech recognition platform. | An autonomous coding daemon for git repos. |
| **A Peruvian open-source tech collective** | [`minskylab`](https://github.com/minskylab) on GitHub — 109 repos, mostly project-management and code-gen plugins (Plexo, blob, auto-rust, neocortex). | A daemon you run on your own machine. |
| **Human-in-the-loop workflow orchestration with progressive gates** | [`edobry/minsky`](https://github.com/edobry/minsky) — architectural sibling using organizational cybernetics. 5★, early-stage. Shares the "task queue + agent + feedback loop" shape but focuses on HITL coordination, not autonomous self-improvement. *We may end up cross-citing this project's vision.md as it matures.* | This project, which targets autonomous overnight runs. |
| **An enterprise / government cloud platform** | [`gov.minsky.io`](https://status.gov.minsky.io/) — a private platform. No public OSS overlap. | An open-source MIT daemon. |

If you actually wanted **this Minsky** — a background daemon that runs AI coding agents against `TASKS.md` in any git repo — see the main [README](../README.md).

The remainder of this doc documents the lineage of ideas this project builds on. Skip if you only needed the disambiguation above.

## Where this Minsky's ideas come from

This project is a synthesis of existing patterns, not a new idea. Every architectural decision traces to one of six lineages.

### 1. Society of Mind — the namesake

[Marvin Minsky](https://web.media.mit.edu/~minsky/), *The Society of Mind*, Simon & Schuster, **1986**. ISBN 0-671-60740-5.

The architectural metaphor: intelligence emerges from many simple, specialised agents working together. No single agent is intelligent; the *society* is. This project borrows the name and the shape — multi-persona pipelines, role-based decomposition, supervisor + worker layers. The same metaphor explicitly powers [CrewAI](https://github.com/CrewAIInc/crewAI) and [AutoGen's `SocietyOfMindAgent`](https://microsoft.github.io/autogen/).

### 2. Autonomic computing (MAPE-K) — the control loop

Jeffrey O. Kephart and David M. Chess, ["The Vision of Autonomic Computing"](https://www.cs.cmu.edu/~15849g/readings/kephart03.pdf), *IEEE Computer* 36(1), pp. 41–50, **January 2003**.

IBM's reference architecture for self-managing systems. Four phases (Monitor → Analyze → Plan → Execute) plus a Knowledge base. This project's iteration ledger (`.minsky/experiment-store/`) is the K; the runtime invariants are the Monitor; the proactive-healing rule (rule #17) is the Plan → Execute. See `vision.md` § 9 + § 17 for how MAPE-K maps to the daemon's iteration loop. *Status note: the substrate ships today; closed-loop A/B prompt tuning (the full MAPE-K) is still in specification — see [user-story-003](../user-stories/003-mape-k-improves-prompts.md).*

### 3. Viable System Model — the recursive structure

Stafford Beer, *Cybernetics and Management*, English Universities Press, **1959**; formalised in *Brain of the Firm*, Simon & Schuster, **1972**.

Viable systems are recursive: each level contains its own monitor/analyse/plan/execute loops. The whole survives because every part survives. This project's multi-repo fleet (one daemon walking N hosts in round-robin) is VSM applied to git repos. The same daemon shape that survives a single iteration must also survive a daemon restart, a host swap, a network blip — recursion all the way down.

### 4. Let-it-crash + supervision trees — the failure model

[Erlang/OTP](https://www.erlang.org/doc/system/sup_princ.md) supervision trees, Joe Armstrong et al., Ericsson, **1986–present**. Canonical: Armstrong, *Making Reliable Distributed Systems in the Presence of Software Errors*, PhD thesis, KTH, 2003.

Don't try to prevent failures; restart cleanly when they happen. This project's `launchd` / `systemd` outer supervisor + the daemon's per-iteration scope-leak detector + the rule #6 "soft-by-default" CI lint all stack to the same discipline. An iteration that scope-leaks or spawn-fails doesn't halt the loop; the supervisor kills, restarts, the next iteration tries again. Rule #6 in `vision.md` is the load-bearing instantiation.

### 5. Continuous-execution autonomous daemons — the operational ancestors

The closest functional precedents — daemons that ship code changes against many repos, on a schedule, without per-task human invocation:

| Project | What it does | What this Minsky takes / adds |
|---|---|---|
| **[Dependabot](https://github.com/dependabot/dependabot-core)** (2018) | Scheduled dependency-update bot; opens PRs autonomously across repos. | Takes: continuous daemon shape, multi-repo fleet, autonomous PR generation. Adds: task-driven (not just scheduled), self-improvement loop, constitutional CI gates. |
| **[OSS-Fuzz](https://github.com/google/oss-fuzz)** (Google, 2016) | Runs continuous fuzz tests on 850+ OSS projects, files bug issues, tracks fixes. | Takes: 24/7 execution, autonomous bug reporting, fleet-scale operation. Adds: code-generation (not just bug-finding), operator-controlled queue. |
| **[Renovate](https://github.com/renovatebot/renovate)** (2016) | Flexible dependency-update bot; multi-repo, custom rules, group updates. | Takes: schedule-driven daemon, monorepo + multi-repo support. Adds: feature work, not just version bumps. |
| **[semantic-release](https://github.com/semantic-release/semantic-release)** (2015) | Continuous version-management daemon; analyses commits, publishes packages. | Takes: deterministic-rule discipline. Adds: code generation. |
| **[Mergify](https://docs.mergify.com/)** (2018) | PR merge-queue manager; continuous, autonomous merge decisions. | Takes: continuous PR-management shape. Adds: actually writes the code. |

Dependabot is the closest analog by adoption + design; OSS-Fuzz is the closest by "daemon improves a codebase over time" framing. The novelty this Minsky adds is the *task-driven* surface — operators queue work in `TASKS.md`, the daemon picks tasks — instead of the schedule-driven or trigger-driven shapes of the predecessors.

### 6. Self-improving AI agents — the recent LLM lineage

| Paper | What it shows | What this Minsky borrows |
|---|---|---|
| **[Reflexion](https://arxiv.org/pdf/2303.11366)** — Shinn et al., *NeurIPS 2023* | LLM agents that reflect on task failures, store reflections in episodic memory, use them to guide future attempts. 91% pass@1 on HumanEval. | Episodic memory pattern for the daemon's iteration ledger (`.minsky/experiment-store/`); the "observe failure → reflect → adjust" loop. |
| **[DSPy](https://github.com/stanfordnlp/dspy)** — Khattab et al., 2023 | Declarative LM-pipeline framework; the compiler optimises prompts to maximise a metric. | Pattern for how the daemon could eventually auto-tune its own prompts in the closed-loop MAPE-K (the work tracked in user-story-003). |
| **[AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)** — Google DeepMind, 2024–2025 | Gemini-powered evolutionary coding agent; LLM generates, metrics evaluate, populations evolve. Discovered new algorithms; optimised Google Spanner heuristics. | Pattern for population-based code optimisation (a future direction, not yet implemented). |
| **[CrewAI](https://github.com/CrewAIInc/crewAI)** — 2023 | Multi-agent role-play framework. Explicitly cites Marvin Minsky's Society of Mind. | This Minsky is in the same conceptual family but ships as a daemon, not a framework. See [`competitors/crewai.md`](../competitors/crewai.md) for the full comparison. |
| **[AutoGen `SocietyOfMindAgent`](https://microsoft.github.io/autogen/)** — Microsoft, 2024 | Orchestrator that delegates sub-tasks to sub-agents. | Same Society-of-Mind lineage. Architectural cousin. |

## Architectural lineage at a glance

```text
Wiener 1948 (cybernetics — the original feedback-loop framing)
    ↓
Beer 1959 (Viable System Model — recursive viable systems)
    ↓
Marvin Minsky 1986 (Society of Mind — multi-agent emergence)
    ↓
Erlang/OTP 1986+ (let-it-crash + supervision trees)
    ↓
Kephart & Chess 2003 (MAPE-K — the canonical autonomic loop)
    ↓
Dependabot 2018 / OSS-Fuzz 2016 (continuous daemons that improve repos)
    ↓
Shinn et al. 2023 — Reflexion (LLM agents + episodic memory)
    ↓
DeepMind 2024 — AlphaEvolve (evolutionary autonomous code gen)
    ↓
*this Minsky* 2025–2026
```

This project is the 11th rung of a 70-year ladder. Nothing here is new; the combination is.

## What's distinctive vs every entry above

Reading the table top-to-bottom: every ancestor lacks at least one of these properties. This Minsky combines all five:

- **Daemon** (not framework) — runs 24/7 in the background on the operator's machine, surviving terminal close + reboots.
- **Operator-machine identity** — uses `~/.ssh`, `~/.gitconfig`, `~/.config/gh` directly; commits land as the operator. No SaaS sandbox, no Devbox, no credential vault.
- **Git-native task surface** — TASKS.md in the host repo is the operator's queue; no web UI, no Python file to import, no DSL.
- **Constitutional CI gates** — 17 iron rules each enforced by a deterministic CI lint (53 pre-pr-lint stages, 65 CI jobs). Not "best practices in docs".
- **Self-improving substrate** — `.minsky/experiment-store/` captures every iteration's outcome; the daemon files tasks against its own weak spots; closed-loop MAPE-K prompt tuning is the next step (user-story-003).

The competitive view of the same novel synthesis lives in [`competitors/README.md`](../competitors/README.md) (six moats + five honest gaps). This doc is the *historical* view — same substrate, different audience.

## Where this doc fits

- **Cold reader landing here**: you wanted disambiguation; the table at the top is the answer.
- **Curious reader**: the lineage section is a guided tour of the prior art.
- **Contributor proposing a new feature**: section 6 (self-improving AI agents) is the closest territory; check whether your idea is already shipped by Reflexion / DSPy / AlphaEvolve before claiming novelty (rule #1 — don't reinvent).
- **Operator wondering whether this Minsky is the right tool**: read [`competitors/README.md`](../competitors/README.md) for product-shape comparisons and [`README.md`](../README.md) for the tool itself. The disambiguation above tells you which Minsky this isn't; those docs tell you which tool this *is*.

## Last reviewed

2026-05-22 (initial — informed by the OpenHands + CrewAI deep dive in PR #726 + the namespace + prior-art research in PR #730).
