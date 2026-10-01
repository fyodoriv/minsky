# Competitor: AutoGen (Microsoft Research)

> Microsoft's multi-agent conversation framework — an orchestrator-tier peer, now folded into Microsoft Agent Framework but still the primary citation for the AutoGen-branded benchmark numbers.

- **URL**: <https://github.com/microsoft/autogen>
- **Paper**: arXiv 2308.08155 (2023) — "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework"
- **Status**: Brand retired — folded into [Microsoft Agent Framework](microsoft-agent-framework.md) at MAF v1.0 (April 2026); the AutoGen primitives (graph workflows, multi-agent planning, declarative pipelines) live on as MAF features.
- **Relationship**: **Competitor** — orchestrator-tier peer (it composes agents), but built on the wrong stack with an enterprise framing.

## What this is

AutoGen is a framework for building applications as conversations between several configurable agents — an "agent" here being the coding assistant or LLM-driven worker that does the actual task. You wire up assistant agents, user-proxy agents, and group-chat managers; they talk to each other, hand off work, and call tools until the task is done.

Its headline result is on multi-agent math reasoning: a conversation between a verifier-style assistant and an executor solves harder problems than a single GPT-4 call.

## What this is not

- **Not a daemon.** A daemon is a background program that keeps running on your machine after you start it. AutoGen is a conversation framework you build applications in. Minsky is the daemon that drives agents through a queue.
- **Not coding-specific.** AutoGen targets general multi-agent LLM applications. Minsky is solely the autonomous-coding outer loop.
- **Not a live product.** The AutoGen brand is retired into [Microsoft Agent Framework](microsoft-agent-framework.md). This file is kept only for the AutoGen-branded benchmark citations.

## Strengths

- **Multi-agent conversation primitive** — configurable agents with tool use and human-in-the-loop, composable into group chats.
- **Strong reasoning result** — MATH whole-test accuracy 69.48% vs GPT-4's 55.18% (Wu et al. 2023), the orchestrator-tier number Minsky's corpus tracks.
- **Microsoft-backed** — large adoption, an academic paper, real production usage, and AutoGenBench, a tool for reproducible per-model benchmarking.
- **Open source** — MIT-style licensing.

## Weaknesses vs Minsky's vision

These are the reasons Minsky does not build on AutoGen as substrate.

1. **Wrong stack.** AutoGen is a Python framework around generic LLM APIs. Minsky is Claude Code-native by design — Max subscription economy, OMC's persona system (a persona is a role the agent takes on), and native MCP and OpenTelemetry (OTEL).
2. **No 24/7 viability framing.** AutoGen is request-response: convene the agents, return a result. There is no long-running supervisor (the outer watchdog that restarts the program if it dies), no token-budget homeostasis, and no mid-session pause or resume.
3. **No self-improvement loop.** Agent configs are static prompts. There is no layer that watches its own performance and rewrites prompts over time.
4. **No constitutional grounding.** There is no vision-document layer, so behavior drift goes undetected.
5. **Heavy framework, not substrate.** AutoGen owns the runtime; you build inside it. Minsky is substrate-first.
6. **No TASKS.md compatibility.** TASKS.md is the plain-text Markdown to-do list at a project's root that Minsky reads to pick work. AutoGen's task representation is internal Python objects instead.

## What we learn / steal

- **Multi-agent conversation pattern** — validation that verifier/executor agent pairs beat single-agent calls on reasoning; relevant to the future `multi-persona-pipeline-handoff-spec` (M2).
- **AutoGenBench** — the reproducible per-model benchmark tool is the right shape for a `local-harness` result kind, should Minsky ever publish its own MATH/HumanEval runs.
- **Group-chat manager** — a lightweight orchestrator-of-orchestrators primitive worth noting for handoff design.

## Why choose Minsky over AutoGen

- **Coding-specific by design** — git-native, a TASKS.md surface, PR-shaped output. AutoGen targets general multi-agent applications, not the coding outer loop.
- **Daemon, not framework** — a 24/7 background process that survives terminal close. AutoGen is request-response: convene agents, return a result.
- **Self-improvement substrate** — Minsky observes its own iterations and feeds the results back. AutoGen's agent configs are static prompts.
- **Constitutional grounding** — Minsky's behavior is gated against a vision document. AutoGen has no equivalent layer, so behavior drift goes undetected.

## Why choose AutoGen over Minsky

- **General-purpose multi-agent applications** — coding is just one use case; AutoGen targets the broad LLM-application space.
- **Proven multi-agent conversation primitive** — configurable agents, tool use, human-in-the-loop, composable group chats, all out of the box.
- **Microsoft backing and adoption** — a published paper, large community, real production usage, and the AutoGenBench benchmarking tool.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                       | Value  | Date       | Primary source |
| ---------------------------- | ------ | ---------- | -------------- |
| `math-whole-test-accuracy`   | 0.6948 | 2023-08-16 | Wu, Bansal, Zhang, Wu, Li, Zhu, Wang, Saied, Awadallah, Yang, "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework", arXiv 2308.08155, 2023 (MATH whole-test accuracy = 69.48% with the multi-agent conversation framework vs GPT-4's 55.18%) |

**Why MATH and not HumanEval** (the `corpus-add-autogen-microsoft` Pivot): the M1.10 orchestrator-tier metric is `humaneval-pass-at-1`, but AutoGen does not publish a stock-model HumanEval headline — HumanEval is run model-dependently via the AutoGenBench tool, which would require a `local-harness` result kind (and a `harnessId`) rather than a `published` snapshot. The Wu et al. 2023 paper's primary headline is the MATH whole-test number, so the corpus adopts `math-whole-test-accuracy` as the orchestrator-tier math-reasoning sibling to `humaneval-pass-at-1` (MetaGPT) — exactly the Pivot path the task pre-registered. This keeps the corpus's primary-citation invariant intact (rule #4 visible — no fabricated HumanEval number, no third-party proxy).

## Should we wrap AutoGen instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

See [microsoft-agent-framework.md § "Should we wrap"](microsoft-agent-framework.md#should-we-wrap-microsoft-agent-framework-instead) for the full 5-question analysis — it is canonical for both AutoGen and MAF, because Microsoft folded AutoGen into MAF at v1.0.

Summary: **STRUCTURAL MISMATCH — do NOT wrap.** A framework is the wrong shape to wrap behind Minsky's daemon. An orchestrator-tier wrap fails the moat threshold (only 2 of 6 moats survive), and the strongest sub-case — wrapping AutoGen at the agent tier — is already dominated by OpenHands per the [Path C reshape plan](../docs/plans/2026-05-22-path-c-openhands-reshape.md).

## Five pivot questions

### 1. How is it different from Minsky?

AutoGen is a **general-purpose Python framework** for composing configurable agents into conversations; Minsky is a **coding-specific, 24/7 daemon** that walks a fleet of existing repos and ships PR-shaped changes under a constitution. AutoGen is request-response — convene the agents, return the result — with no long-running supervisor, no TASKS.md-style durable queue, and no git-native PR output. They sit at adjacent tiers: AutoGen is an orchestrator-tier *framework* (a library an app is built with); Minsky is an orchestrator-tier *product* (a daemon you run).

### 2. What lessons can it give to us?

- **Verifier/executor agent pairs beat single-agent calls on reasoning.** The MATH 69.48% vs GPT-4 55.18% result validates the multi-agent conversation pattern. Relevant to the future `multi-persona-pipeline-handoff-spec` (M2).
- **Reproducible per-model benchmarking is the right shape.** AutoGenBench maps to a `local-harness` result kind should Minsky ever publish its own MATH/HumanEval runs.
- **A group-chat manager is a lightweight orchestrator-of-orchestrators.** Worth noting for handoff design.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons are borrowable-pattern level — none challenges `vision.md § What Minsky is` or any of the 17 rules, and none threatens the 6 moats. AutoGen is general-purpose Python orchestration with an enterprise framing post-MAF-merger; it does not subsume Minsky's coding-specific daemon loop, constitutional gate, operator-machine identity, or cross-repo fleet.

### 4. How can we improve our strategy based on this?

- **Carry the multi-agent-conversation lesson into the handoff spec** — bind verifier/executor pairing to Claude Code via OMC rather than to a Python+API runtime. Traces to the future `multi-persona-pipeline-handoff-spec` (M2) + rule #1.
- **Keep AutoGenBench in mind as the per-model benchmark shape** — if Minsky ever publishes its own MATH/HumanEval runs, use a `local-harness` result kind rather than borrowing a third-party number.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — AutoGen is request-response with no 24/7 cross-repo daemon and no TASKS.md-style durable queue. Nothing to replace.
- **self-improvement substrate**: KEEP — agent configs are static prompts; there is no online observe-tune loop over a running fleet.
- **adapters / agent backend**: DO-NOT-WRAP — AutoGen is a Python framework, not a spawnable headless coding-CLI backend. OpenHands remains the runtime wrap target.
- **constitution-as-CI / lint stack**: KEEP — AutoGen has no vision-document gate; this is what lets Minsky run unattended.
- **corpus / scorecard**: KEEP — record only the published MATH 69.48% reading; do not fabricate a HumanEval number or use a third-party proxy (rule #4).

**Total replace % across all surfaces: 0% replacement; 1 DO-NOT-WRAP (the agent backend — AutoGen is a framework, not a headless coding CLI).** Headline for the operator: *nothing in Minsky to replace; AutoGen is an adjacent-tier general-purpose framework whose best idea (verifier/executor conversation) Minsky borrows as a pattern rather than wrapping.*

## Pattern conformance

- **Pattern AutoGen implements**: Multi-agent conversation / actor-style message passing across configurable agents — Hewitt, Bishop, Steiger, "A Universal Modular ACTOR Formalism for Artificial Intelligence", *IJCAI* 1973 (the actor model AutoGen's agent-conversation primitive instantiates) — combined with the verifier/executor reasoning pattern reported in Wu et al., "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework", arXiv 2308.08155, 2023.
- **Conformance level**: full (in the pattern AutoGen implements).
- **How Minsky relates**: don't adopt — wrong stack (Python) and enterprise framing post-MAF-merger. Minsky borrows the multi-agent-conversation lesson for the future handoff-spec but binds it to Claude Code via OMC rather than to a Python+API runtime.
- **Index row**: see [microsoft-agent-framework.md](microsoft-agent-framework.md) (vision.md § "Pattern conformance index" row 49 — the post-merger canonical entity).

## Pin / integration

Not a dependency. No adapter.

## Last reviewed

2026-06-02 — expanded from a redirect stub to a full research file via the `corpus-add-autogen-microsoft` task; the AutoGen-branded MATH 69.48% reading (Wu et al. arXiv 2308.08155) is added to the orchestrator-tier corpus on the `math-whole-test-accuracy` metric. The wrap-feasibility analysis remains canonical in [microsoft-agent-framework.md](microsoft-agent-framework.md) (AutoGen brand retired at MAF v1.0, April 2026).

Earlier reviews: 2026-05-23 — created as redirect when the wrap-feasibility-autogen task discovered the AutoGen→MAF merger.
