# Competitor: OpenAI Agents SDK

> OpenAI's official agent framework — handoffs primitive, built-in tracing dashboard, production-grade reliability. Tight ecosystem coupling to OpenAI models is the constraint.

- **URL**: <https://openai.github.io/openai-agents-python/>
- **GitHub**: <https://github.com/openai/openai-agents-python> (canonical Python) + <https://github.com/openai/openai-agents-js> (TypeScript port)
- **Status**: Active, v1.x stable since March 2026, Python + TypeScript
- **Pricing**: SDK is free (Apache 2.0); the OpenAI Tracing Dashboard requires an OpenAI Platform account; per-token usage billed at OpenAI's standard rates
- **Relationship**: **Competitor (orchestrator tier)** — listed as a peer in `competitors/README.md` § comparison matrix and vision.md § moats. Different distribution model (vendor SDK) and tighter LLM coupling than Minsky's bring-your-own-agent matrix.

## What it is

OpenAI Agents SDK is OpenAI's official open-source library for building production-grade multi-step agent applications. Successor to the experimental Swarm framework (2024). Core primitives:

- **Agent** — a configured LLM + instructions + tools + handoff targets. The unit of execution.
- **Handoffs** — first-class primitive for one agent transferring control to another. The most distinctive primitive in the SDK; structurally similar to LangGraph's edges but explicitly typed at the agent boundary.
- **Tools** — Python or TypeScript functions the agent can call; SDK handles the marshalling and the model's tool-calling protocol.
- **Guardrails** — pre-execution validation hooks (input guardrails) + post-execution validation hooks (output guardrails) that can reject or rewrite an agent's response.
- **Tracing** — every agent run automatically emits trace spans to OpenAI's Tracing Dashboard (cloud-hosted) by default; can be redirected to OpenTelemetry endpoints via configuration.

Two deployment shapes:

- **In-process** — `from agents import Agent, Runner; Runner.run_sync(my_agent, "...")` in Python (or `import { Agent, run } from '@openai/agents'` in TS). Runs in the host application; state lives in-memory per run.
- **OpenAI Platform** — agents can be registered and run via OpenAI's Realtime / Responses APIs, with state managed cloud-side.

26k+ stars (Python repo) as of 2026-05-23. No published SWE-bench number; benchmarks rely on third-party evaluation.

## Strengths

- **Tracing Dashboard out of the box** — every run automatically traceable in OpenAI's UI; comparable to LangSmith's role for LangChain. No setup required for the default path.
- **Handoffs primitive** — explicit, typed agent-to-agent control transfer is uncommonly clean. Most frameworks treat this as a sub-case of message passing.
- **Guardrails primitive** — pre-execution + post-execution hooks at the SDK level (not just user code). Closer to "framework-enforced" than CrewAI's similar concept.
- **TypeScript port at functional parity** — unlike LangGraph (JS port partial), the OpenAI Agents JS SDK ships the same primitives at the same maturity.
- **Vendor maintenance assured** — OpenAI maintains it as part of their platform offering; long-term continuity is not in question.
- **Production-grade reliability** — used by OpenAI's own internal teams; battle-tested on their cloud workloads.
- **Realtime API integration** — voice agents, multi-modal flows are first-class; nothing in Minsky's orchestrator-tier peer set covers voice.

## Gaps (why we don't use it)

1. **Model lock-in.** The canonical SDK path assumes OpenAI models. Using Claude / Gemini / DeepSeek requires either (a) a custom `ModelProvider` implementation per backend — not trivial — or (b) routing through OpenAI's OpenAI-compatible-API wrappers, which add latency + token-cost overhead + lose vendor-specific features (Claude's tool-use streaming, Gemini's multimodal interleaving). The bring-your-own-agent moat (Minsky's claude / devin / aider / openhands matrix) doesn't survive a clean wrap.
2. **In-process framework, not a daemon.** Same shape as LangGraph and MAF — you build the agent + handoff graph; you run it; the SDK doesn't ship a 24/7 fleet daemon.
3. **OpenAI Tracing Dashboard as default path.** OTEL redirect exists but the canonical surface is OpenAI-cloud-hosted. Operator-machine identity moat at risk if Tracing Dashboard becomes the default visibility surface.
4. **No multi-repo fleet model.** A single `Runner.run_sync` call processes one task; the cross-repo round-robin pattern has no equivalent.
5. **No constitutional gates.** The Guardrails primitive validates individual agent outputs, not PR-level policy compliance. The 18-rule constitution has no analog.
6. **No across-session knowledge accumulation.** Traces persist in the dashboard but the SDK has no "across all prior runs, what should I learn?" primitive — same gap as LangGraph and MAF.

## What we extract or learn

- **Handoffs primitive** — explicit typed agent-to-agent control transfer is a clean pattern; filed as `multi-persona-pipeline-handoff-spec` (M2) inspired by this primitive (cross-referenced in `novel/handoff-spec/`).
- **Guardrails-at-SDK-level pattern** — Minsky's `runtime-invariants.ts` (rule #3a) is the structural analog: a deterministic gate that runs before/after the agent. The pattern is already absorbed; the SDK's name for it is sharper.
- **Tracing Dashboard UX as inspiration** — `minsky watch` should aim for the same "5-second comprehensibility" UX (per the Path C plan § "What stays distinctively Minsky"), without the cloud dependency.

## Why we don't just use it

Adopting OpenAI Agents SDK as Minsky's orchestrator would mean:

- **Abandoning bring-your-own-agent** as a first-class capability — the 4-row `~/.minsky/config.json` matrix (claude / devin / aider / openhands) becomes a 1-row OpenAI matrix, with the other 3 routed through compatibility shims that lose vendor-specific features.
- **Adopting OpenAI Tracing Dashboard** as the default observability surface — operator-machine identity moat at risk; the explicit cloud egress becomes a constitutional gate operators must opt in or out of.
- **Trading the daemon shell for an event-driven framework** — same shape mismatch as LangGraph and MAF.
- **Switching the orchestrator tier from TypeScript-first to OpenAI-API-first** — even the JS port assumes OpenAI's API conventions. The constitutional alignment with tasks.md + agentbrew (TypeScript-first OSS substrate) weakens.

The opportunity cost is large for a moat that's not closed by the SDK (the SDK adds the handoffs primitive — which Minsky already has filed as a M2 task — and the tracing dashboard — which Minsky's `minsky watch` can match without cloud egress).

## Should we wrap OpenAI Agents SDK instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: STRUCTURAL MISMATCH — do NOT wrap.** The pre-registered hypothesis in the wrap-feasibility task block predicted PARTIAL YES for the per-task execution layer (5/6 moats survive, free tracing dashboard, handoffs primitive). The honest analysis below shows the moat math is at-threshold but the bring-your-own-agent collapse is the disqualifier, and the strongest sub-cases are already absorbed elsewhere.

### The 5 questions

**1. Architectural fit.** OpenAI Agents SDK runs in-process (Python or TypeScript), so the spawn-shape COULD work — Minsky's daemon could call the SDK directly per-task, similar to the planned OpenHands integration. The TypeScript port is at parity, eliminating the Python/TS tax that disqualifies LangGraph. *Fit is better than LangGraph or MAF.* But the architectural-fit assessment alone isn't enough — see question 2.

**2. What we delegate.** Three plausible targets:

- **Per-task agent execution + handoffs** — replace Minsky's per-task agent loop with OpenAI Agents SDK. *Dominated by OpenHands* per the Path C plan — OpenHands' CodeAct loop has SWE-bench Verified 65.8%, Docker sandbox, multi-LLM (15+ backends). The OpenAI Agents SDK has the handoffs primitive but doesn't ship a sandbox; using it as the agent loop loses isolation.
- **Adapter layer + handoffs** — fold Minsky's claude/devin/aider/openhands adapter into the SDK's `Agent` + `handoffs` primitives. *Loses bring-your-own-agent* — the SDK is OpenAI-API-conventioned; Claude/Gemini routed through compat shims lose vendor-specific features.
- **Tracing dashboard for `minsky watch`** — replace `minsky watch` with OpenAI Tracing Dashboard. *Cloud-egress conflict* — operator-machine identity moat at risk; the daemon's run data would flow to OpenAI's cloud.

**3. What we keep.** Of Minsky's 6 moats, 2 are at risk under a hypothetical wrap (operator-machine identity, bring-your-own-agent). The other 4 (daemon-not-framework, constitution+CI, cross-repo fleet, TASKS.md surface) survive structurally.

**4. Net moat after wrap.** If Minsky wrapped OpenAI Agents SDK at the adapter layer:

| Moat | Survives a hypothetical OpenAI Agents SDK wrap? | Why |
|---|---|---|
| Daemon, not framework | ✅ | Same as LangGraph wrap — daemon shell still runs continuously |
| Operator-machine identity | 🟡 | Survives if we explicitly avoid OpenAI Tracing Dashboard; at risk if the canonical path stays cloud-default |
| Constitution + CI | ✅ | Unchanged — SDK doesn't gate PRs |
| MAPE-K substrate | ✅ | Unchanged — SDK doesn't compete with across-session knowledge |
| Cross-repo fleet | ✅ | Unchanged — `--hosts-dir` round-robin is at the daemon layer |
| TASKS.md as operator surface | ✅ | Unchanged — operator still edits markdown |
| *Bonus moat at risk: bring-your-own-agent* | ❌ | Lost — adapter layer becomes OpenAI-API-conventioned; Claude/Gemini routed through compat shims lose vendor-specific features |

Net: **5 of 6 core moats survive** (above the ≥4-moat threshold), BUT the bring-your-own-agent capability that's actually *the operator-facing feature* of the cloud_agent matrix collapses. The moat-count rubric doesn't fully capture this — the matrix IS operator-facing, while "MAPE-K substrate" is internal-facing. Losing operator-facing capability is more costly than losing internal substrate.

**5. Verdict — STRUCTURAL MISMATCH.** Don't wrap. Three sharper reasons than the moat math conveys:

- **Bring-your-own-agent matrix collapse** is the operator-facing feature; the SDK is OpenAI-API-conventioned and the compat-shim path for Claude/Gemini loses vendor-specific features.
- **Per-task agent loop sub-case dominated by OpenHands** per Path C plan (which has SWE-bench 65.8% + Docker sandbox + 15+ LLMs).
- **Tracing dashboard sub-case conflicts with operator-machine identity** — the canonical path is OpenAI-cloud-default; replacing `minsky watch` with it would silently exfiltrate run data.

The strongest individual primitives the SDK offers (handoffs, guardrails) are already absorbed elsewhere — handoffs via the M2 `multi-persona-pipeline-handoff-spec` task, guardrails via `runtime-invariants.ts` (rule #3a).

### Trigger for re-evaluation

Re-run this analysis when ANY of these fire:

1. **OpenAI Agents SDK adds first-class non-OpenAI model support** (Claude / Gemini / DeepSeek as full `Agent` providers with vendor-specific features preserved). The bring-your-own-agent collapse risk disappears; re-evaluate the adapter-layer wrap.
2. **OpenAI Tracing Dashboard offers a self-hosted / zero-cloud-egress mode**. Operator-machine identity risk drops; re-evaluate the dashboard sub-case.
3. **OpenHands' Path C wrap fails the pivot threshold** (`add-openhands-as-pluggable-backend` Pivot: <5pp SWE-bench delta). The per-task agent loop sub-case becomes a candidate for OpenAI Agents SDK; re-evaluate.
4. **Anthropic + Google ship competing SDKs at SDK parity** — then "vendor SDK" becomes a category, not a single product; re-evaluate the entire orchestrator-via-vendor-SDK shape.

## Pin / integration

Not a dependency. No adapter. Handoffs primitive concept already filed as M2 `multi-persona-pipeline-handoff-spec` (filed for design adoption, not framework wrap). Watch for non-OpenAI model support evolution.

## Pattern conformance

- **Pattern OpenAI Agents SDK implements**: Vendor-SDK orchestration with explicit typed handoffs — combines the Agent + Handoffs pattern (own innovation, not directly anchored in pre-LLM CS literature) with first-class tracing (CNCF OpenTelemetry specification, 2020+) + guardrail-driven pre/post-execution validation (Wynne & Hellesøy, *The Cucumber Book*, 2012 — same shape as BDD acceptance gates).
- **Conformance level**: full (in the pattern OpenAI Agents SDK implements).
- **How Minsky relates**: don't adopt — model lock-in conflicts with bring-your-own-agent, cloud-default tracing conflicts with operator-machine identity, per-task agent loop sub-case dominated by OpenHands. Minsky borrows the *handoffs primitive concept* (filed as M2 design adoption) + the *guardrail-at-substrate-level pattern* (already absorbed via `runtime-invariants.ts`) but rejects the SDK runtime.
- **Index row**: vision.md § "Pattern conformance index" — pending row addition (filed as task `vision-md-pattern-row-openai-agents-sdk` if not added in this PR).

## Last reviewed

2026-05-23 — initial deep-dive added per the wrap-feasibility-openai-agents-sdk P2 task. Wrap-feasibility verdict: STRUCTURAL MISMATCH; handoffs + guardrails patterns already absorbed elsewhere; no follow-up P0 task filed.
