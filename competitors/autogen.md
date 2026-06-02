# Competitor: AutoGen (Microsoft Research)

> Microsoft's multi-agent conversation framework — orchestrator-tier peer, now folded into Microsoft Agent Framework but still the primary citation for the AutoGen-branded benchmark numbers.

- **URL**: <https://github.com/microsoft/autogen>
- **Paper**: arXiv 2308.08155 (2023) — "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework"
- **Status**: Brand retired — folded into [Microsoft Agent Framework](microsoft-agent-framework.md) at MAF v1.0 (April 2026); the AutoGen primitives (graph workflows, multi-agent planning, declarative pipelines) live on as MAF features.
- **Relationship**: **Competitor** — orchestrator-tier peer (composes agents), wrong stack and enterprise framing

## What it is

A framework that builds LLM applications as conversations between multiple configurable agents (assistant agents, user-proxy agents, group-chat managers). The agents converse, delegate, and use tools to accomplish a task. AutoGen's headline result is on multi-agent math reasoning: a conversation between a verifier-style assistant and an executor solves harder problems than a single GPT-4 call.

## Strengths

- **Multi-agent conversation primitive** — configurable agents with tool use and human-in-the-loop, composable into group chats
- **Strong reasoning result** — MATH whole-test accuracy 69.48% vs GPT-4's 55.18% (Wu et al. 2023), the orchestrator-tier number Minsky's corpus tracks
- **Microsoft-backed** — large adoption, academic paper, real production usage; AutoGenBench tool for reproducible per-model benchmarking
- **Open source** — MIT-style licensing

## Gaps (why we don't use it as substrate)

1. **Wrong stack.** Python framework around generic LLM APIs. Minsky is Claude Code-native by design — Max subscription economy, OMC's persona system, native MCP and OTEL.
2. **No 24/7 viability framing.** AutoGen is request-response: convene agents, return result. No long-running supervisor, no token-budget homeostasis, no mid-session pause/resume.
3. **No self-improvement loop.** Agent configs are static prompts; no metacognitive layer that observes performance and rewrites prompts over time.
4. **No constitutional grounding.** No vision-document layer; behavior drift is undetected.
5. **Heavy framework, not substrate.** AutoGen owns the runtime; you build inside it. Minsky is substrate-first.
6. **No tasks.md compatibility** — its task representation is internal Python objects.

## What we extract or learn

- **Multi-agent conversation pattern** — validation that verifier/executor agent pairs beat single-agent calls on reasoning; relevant to the future `multi-persona-pipeline-handoff-spec` (M2)
- **AutoGenBench** — the reproducible per-model benchmark tool is the right shape for a `local-harness` result kind, should Minsky ever publish its own MATH/HumanEval runs
- **Group-chat manager** — a lightweight orchestrator-of-orchestrators primitive worth noting for handoff design

## Why we don't just use it

See [microsoft-agent-framework.md § "Should we wrap"](microsoft-agent-framework.md#should-we-wrap-microsoft-agent-framework-instead) — the canonical wrap-feasibility analysis covers both AutoGen and MAF (Microsoft folded AutoGen into MAF at v1.0). Summary: **STRUCTURAL MISMATCH — do NOT wrap.** Orchestrator-tier wrap fails the moat threshold (2 of 6 moats survive); agent-tier sub-case is dominated by OpenHands per the [Path C reshape plan](../docs/plans/2026-05-22-path-c-openhands-reshape.md).

## Pin / integration

Not a dependency. No adapter.

## Pattern conformance

- **Pattern AutoGen implements**: Multi-agent conversation / actor-style message passing across configurable agents — Hewitt, Bishop, Steiger, "A Universal Modular ACTOR Formalism for Artificial Intelligence", *IJCAI* 1973 (the actor model AutoGen's agent-conversation primitive instantiates) — combined with the verifier/executor reasoning pattern reported in Wu et al., "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework", arXiv 2308.08155, 2023
- **Conformance level**: full (in the pattern AutoGen implements)
- **How Minsky relates**: don't adopt — wrong stack (Python) and enterprise framing post-MAF-merger. Minsky borrows the multi-agent-conversation lesson for the future handoff-spec but binds it to Claude Code via OMC rather than to a Python+API runtime.
- **Index row**: see [microsoft-agent-framework.md](microsoft-agent-framework.md) (vision.md § "Pattern conformance index" row 49 — the post-merger canonical entity)

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                       | Value  | Date       | Primary source |
| ---------------------------- | ------ | ---------- | -------------- |
| `math-whole-test-accuracy`   | 0.6948 | 2023-08-16 | Wu, Bansal, Zhang, Wu, Li, Zhu, Wang, Saied, Awadallah, Yang, "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework", arXiv 2308.08155, 2023 (MATH whole-test accuracy = 69.48% with the multi-agent conversation framework vs GPT-4's 55.18%) |

**Why MATH and not HumanEval** (the `corpus-add-autogen-microsoft` Pivot): the M1.10 orchestrator-tier metric is `humaneval-pass-at-1`, but AutoGen does not publish a stock-model HumanEval headline — HumanEval is run model-dependently via the AutoGenBench tool, which would require a `local-harness` result kind (and a `harnessId`) rather than a `published` snapshot. The Wu et al. 2023 paper's primary headline is the MATH whole-test number, so the corpus adopts `math-whole-test-accuracy` as the orchestrator-tier math-reasoning sibling to `humaneval-pass-at-1` (MetaGPT) — exactly the Pivot path the task pre-registered. This keeps the corpus's primary-citation invariant intact (rule #4 visible — no fabricated HumanEval number, no third-party proxy).

## Should we wrap AutoGen instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

See [microsoft-agent-framework.md § "Should we wrap"](microsoft-agent-framework.md#should-we-wrap-microsoft-agent-framework-instead) for the 5-question analysis. Summary: **no** — framework-vs-daemon shape mismatch, 2/6 moats survive a hypothetical wrap, and the strongest sub-case is already dominated by OpenHands.

## Last reviewed

2026-06-02 — expanded from a redirect stub to a full research file via the `corpus-add-autogen-microsoft` task; the AutoGen-branded MATH 69.48% reading (Wu et al. arXiv 2308.08155) is added to the orchestrator-tier corpus on the `math-whole-test-accuracy` metric. The wrap-feasibility analysis remains canonical in [microsoft-agent-framework.md](microsoft-agent-framework.md) (AutoGen brand retired at MAF v1.0, April 2026).

Earlier reviews: 2026-05-23 — created as redirect when the wrap-feasibility-autogen task discovered the AutoGen→MAF merger.
