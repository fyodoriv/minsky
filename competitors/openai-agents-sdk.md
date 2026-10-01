# Competitor: OpenAI Agents SDK (OpenAI)

> OpenAI's official framework for building agent apps. You write the agent, the handoffs between agents, and the guardrails; the SDK runs them in your own program. Minsky competes with it at the orchestrator tier — but the SDK assumes OpenAI models, while Minsky lets you bring any coding assistant.

- **URL**: <https://openai.github.io/openai-agents-python/>
- **GitHub**: <https://github.com/openai/openai-agents-python> (canonical Python) + <https://github.com/openai/openai-agents-js> (TypeScript port)
- **Status**: Active, v1.x stable since March 2026, Python + TypeScript
- **Pricing**: SDK is free (Apache 2.0); the OpenAI Tracing Dashboard requires an OpenAI Platform account; per-token usage billed at OpenAI's standard rates
- **Relationship**: **Competitor (orchestrator tier)** — listed as a peer in `competitors/README.md` § comparison matrix and vision.md § moats. It ships as a vendor SDK and couples tightly to OpenAI models, unlike Minsky's bring-your-own-agent matrix.

## What this is

OpenAI Agents SDK is OpenAI's official open-source library for building multi-step agent applications. It is the successor to the experimental Swarm framework (2024). You import it into your own program, wire up agents, and run them.

It is built from a few core pieces:

- **Agent** — a configured large language model plus instructions, tools, and handoff targets. This is the unit that does work.
- **Handoffs** — a first-class way for one agent to transfer control to another. This is the SDK's most distinctive piece; it is structurally similar to LangGraph's edges but explicitly typed at the boundary between agents.
- **Tools** — Python or TypeScript functions the agent can call. The SDK handles the marshalling and the model's tool-calling protocol.
- **Guardrails** — validation hooks that run before an agent acts (input guardrails) and after (output guardrails). They can reject or rewrite a response.
- **Tracing** — every agent run automatically sends trace data to OpenAI's Tracing Dashboard (cloud-hosted) by default. You can redirect it to an OpenTelemetry (OTEL) endpoint — the open standard for traces, metrics, and logs — through configuration.

It runs in one of two shapes:

- **In-process** — `from agents import Agent, Runner; Runner.run_sync(my_agent, "...")` in Python, or `import { Agent, run } from '@openai/agents'` in TypeScript. The SDK runs inside your application; the agent's state lives in memory for the length of one run.
- **OpenAI Platform** — agents can be registered and run through OpenAI's Realtime and Responses APIs, with their state managed in OpenAI's cloud.

The Python repository has 26k+ stars as of 2026-05-23. There is no published SWE-bench number; any benchmarks come from third-party evaluations.

## What this is not

- **Not a daemon.** A *daemon* is a background program that keeps running on your machine after you start it, survives the terminal closing, and restarts on crash. The SDK is an in-process library — you build an agent graph, run it, and it stops. It does not run around the clock. (Same shape as LangGraph and Microsoft Agent Framework.)
- **Not running as you by default.** Its canonical tracing path sends run data to OpenAI's cloud dashboard. Minsky runs on your own machine, as you, under your own credentials — what Minsky calls *operator-machine identity*, where the work shows up under the human who runs it.
- **Not a cross-repo fleet.** One `Runner.run_sync` call processes one task. There is no equivalent to Minsky walking several repositories in turn (a *host* is one code project Minsky works on; the *cross-repo fleet* is Minsky walking several hosts).
- **Not model-agnostic.** The canonical path assumes OpenAI models. Other models work only through compatibility shims that lose vendor-specific features.

## Strengths

- **Tracing Dashboard out of the box** — every run is automatically traceable in OpenAI's UI, comparable to LangSmith's role for LangChain. The default path needs no setup.
- **Handoffs primitive** — explicit, typed transfer of control between agents is uncommonly clean. Most frameworks treat this as a sub-case of message passing.
- **Guardrails primitive** — before-and-after validation hooks live at the SDK level, not just in user code. This is closer to framework-enforced than CrewAI's similar concept.
- **TypeScript port at full parity** — the JS SDK ships the same pieces at the same maturity. (LangGraph's JS port is only partial.)
- **Vendor maintenance assured** — OpenAI maintains it as part of its platform, so long-term continuity is not in question.
- **Production-grade reliability** — OpenAI's own teams use it; it is battle-tested on their cloud workloads.
- **Realtime API integration** — voice agents and multi-modal flows are first-class. Nothing in Minsky's orchestrator-tier peer set covers voice.

## Weaknesses vs Minsky's vision

1. **Model lock-in.** The canonical path assumes OpenAI models. Using Claude, Gemini, or DeepSeek means either writing a custom `ModelProvider` for each backend — not trivial — or routing through OpenAI-compatible-API wrappers. Those wrappers add latency and token-cost overhead and lose vendor-specific features (Claude's tool-use streaming, Gemini's multimodal interleaving). Minsky's bring-your-own-agent moat (its claude / devin / aider / openhands matrix) does not survive a clean wrap.
2. **In-process framework, not a daemon.** Same shape as LangGraph and Microsoft Agent Framework — you build the agent and handoff graph, you run it, and the SDK does not ship a 24/7 fleet daemon.
3. **Cloud-default tracing.** The OTEL redirect exists, but the canonical surface is OpenAI's cloud-hosted dashboard. The operator-machine-identity moat is at risk if that dashboard becomes the default visibility surface.
4. **No multi-repo fleet model.** A single `Runner.run_sync` call processes one task. There is no equivalent to the cross-repo round-robin pattern.
5. **No constitutional gates.** The Guardrails primitive validates one agent's output, not PR-level policy compliance. Minsky's 18-rule constitution — its numbered, non-negotiable project rules — has no analog.
6. **No knowledge that accumulates across runs.** Traces persist in the dashboard, but the SDK has no "across all prior runs, what should I learn?" loop — the same gap as LangGraph and Microsoft Agent Framework.

## What we learn / steal

- **Handoffs primitive** — explicit, typed transfer of control between agents is a clean pattern. Minsky filed it as `multi-persona-pipeline-handoff-spec` (M2), inspired by this primitive (cross-referenced in `novel/handoff-spec/`).
- **Guardrails-at-SDK-level pattern** — Minsky's `runtime-invariants.ts` (rule #3a) is the structural analog: a deterministic gate that runs before and after the agent. The pattern is already absorbed; the SDK just has a sharper name for it.
- **Tracing Dashboard UX as inspiration** — `minsky watch` should aim for the same "5-second comprehensibility" (per the Path C plan § "What stays distinctively Minsky"), but without the cloud dependency.

## Why a user would choose Minsky over OpenAI Agents SDK

- Bring any coding assistant — Claude, Devin, Aider, OpenHands — not just OpenAI models.
- Runs around the clock as a daemon, with budget management and automatic restart.
- Runs on your own machine, as you, with no cloud egress required.
- Walks several repositories in turn (the cross-repo fleet); the SDK processes one task per call.
- Enforces PR-level policy through its constitution and CI gates; the SDK only validates one agent's output.
- Studies its own results and improves across runs; the SDK has no equivalent loop.
- Stays TypeScript-first and open-source, aligned with the tasks.md and agentbrew substrate; the SDK assumes OpenAI's API conventions even in its JS port.

## Why a user would choose OpenAI Agents SDK over Minsky

- First-class voice and multi-modal agents through the Realtime API.
- Zero-setup tracing dashboard for any run.
- OpenAI maintains it as part of the platform — assured long-term continuity.
- Production-tested on OpenAI's own cloud workloads.
- Clean, typed handoffs between agents as a built-in framework primitive.

## Scorecard readings

OpenAI Agents SDK has no entry in the Minsky scorecard corpus (`novel/competitive-benchmark/src/competitors.ts`). The vendor publishes no SWE-bench number, and any benchmarks come from third-party evaluations. The one durable public figure is repository stars.

| Metric | Value | Date | Primary source |
| --- | --- | --- | --- |
| GitHub stars (Python repo) | 26k+ | 2026-05-23 | <https://github.com/openai/openai-agents-python> star count, read 2026-05-23. |
| SWE-bench resolve rate | none published | — | OpenAI publishes no SWE-bench number for the Agents SDK; benchmarks rely on third-party evaluation. |

## Should we wrap OpenAI Agents SDK instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: STRUCTURAL MISMATCH — do NOT wrap.** The pre-registered hypothesis in the wrap-feasibility task block predicted PARTIAL YES for the per-task execution layer (5/6 moats survive, free tracing dashboard, handoffs primitive). The honest analysis below shows the moat math is at-threshold, but the bring-your-own-agent collapse is the disqualifier, and the strongest sub-cases are already absorbed elsewhere.

### The 5 questions

**1. Architectural fit.** OpenAI Agents SDK runs in-process (Python or TypeScript), so the spawn shape *could* work — Minsky's daemon could call the SDK directly per task, similar to the planned OpenHands integration. The TypeScript port is at parity, which removes the Python/TS tax that disqualifies LangGraph. Fit is better than LangGraph or Microsoft Agent Framework. But fit alone is not enough — see question 2.

**2. What we delegate.** Three plausible targets, all weak:

- **Per-task agent execution + handoffs** — replace Minsky's per-task agent loop with the SDK. *Dominated by OpenHands* per the Path C plan: OpenHands' CodeAct loop has SWE-bench Verified 65.8%, a Docker sandbox, and 15+ LLM backends. The SDK has the handoffs primitive but ships no sandbox, so using it as the agent loop loses isolation.
- **Adapter layer + handoffs** — fold Minsky's claude / devin / aider / openhands adapter into the SDK's `Agent` + `handoffs` primitives. *Loses bring-your-own-agent* — the SDK is built around OpenAI's API conventions, so Claude and Gemini route through compatibility shims that lose vendor-specific features.
- **Tracing dashboard for `minsky watch`** — replace `minsky watch` with the OpenAI Tracing Dashboard. *Cloud-egress conflict* — the daemon's run data would flow to OpenAI's cloud, putting operator-machine identity at risk.

**3. What we keep.** Of Minsky's 6 moats, 2 are at risk under a hypothetical wrap (operator-machine identity, bring-your-own-agent). The other 4 (daemon-not-framework, constitution + CI, cross-repo fleet, TASKS.md surface) survive structurally.

**4. Net moat after wrap.** If Minsky wrapped the SDK at the adapter layer:

| Moat | Survives a hypothetical OpenAI Agents SDK wrap? | Why |
|---|---|---|
| Daemon, not framework | ✅ | Same as a LangGraph wrap — the daemon shell still runs continuously |
| Operator-machine identity | 🟡 | Survives if we explicitly avoid the OpenAI Tracing Dashboard; at risk if the canonical path stays cloud-default |
| Constitution + CI | ✅ | Unchanged — the SDK doesn't gate PRs |
| MAPE-K substrate | ✅ | Unchanged — the SDK doesn't compete with across-run knowledge |
| Cross-repo fleet | ✅ | Unchanged — `--hosts-dir` round-robin lives at the daemon layer |
| TASKS.md as operator surface | ✅ | Unchanged — the operator still edits markdown |
| *Bonus moat at risk: bring-your-own-agent* | ❌ | Lost — the adapter layer becomes OpenAI-API-conventioned; Claude/Gemini route through compat shims that lose vendor-specific features |

Net: **5 of 6 core moats survive** (above the ≥4-moat threshold), BUT the bring-your-own-agent capability — which is *the operator-facing feature* of the cloud_agent matrix — collapses. The moat-count rubric does not capture this fully: the matrix is operator-facing, while "MAPE-K substrate" is internal-facing. Losing an operator-facing capability costs more than losing an internal one.

**5. Verdict — STRUCTURAL MISMATCH.** Don't wrap. Three reasons sharper than the moat math conveys:

- **Bring-your-own-agent matrix collapse** is the operator-facing feature; the SDK is OpenAI-API-conventioned, and the compat-shim path for Claude and Gemini loses vendor-specific features.
- **Per-task agent loop sub-case is dominated by OpenHands** per the Path C plan (SWE-bench 65.8% + Docker sandbox + 15+ LLMs).
- **Tracing dashboard sub-case conflicts with operator-machine identity** — the canonical path is OpenAI-cloud-default, so replacing `minsky watch` with it would silently exfiltrate run data.

The strongest individual primitives the SDK offers — handoffs and guardrails — are already absorbed elsewhere: handoffs via the M2 `multi-persona-pipeline-handoff-spec` task, guardrails via `runtime-invariants.ts` (rule #3a).

### Trigger for re-evaluation

Re-run this analysis when ANY of these fire:

1. **The SDK adds first-class non-OpenAI model support** (Claude / Gemini / DeepSeek as full `Agent` providers with vendor-specific features preserved). The bring-your-own-agent collapse risk disappears; re-evaluate the adapter-layer wrap.
2. **The OpenAI Tracing Dashboard offers a self-hosted / zero-cloud-egress mode.** The operator-machine-identity risk drops; re-evaluate the dashboard sub-case.
3. **OpenHands' Path C wrap fails its pivot threshold** (`add-openhands-as-pluggable-backend` Pivot: <5pp SWE-bench delta). The per-task agent loop sub-case becomes a candidate for the SDK; re-evaluate.
4. **Anthropic and Google ship competing SDKs at parity** — then "vendor SDK" becomes a category, not a single product; re-evaluate the entire orchestrator-via-vendor-SDK shape.

## Five pivot questions

### 1. How is it different from Minsky?

OpenAI Agents SDK is an in-process framework: you build an agent-and-handoff graph and run it inside your own program, against OpenAI models, with traces flowing to OpenAI's cloud by default. Minsky is a daemon — a background program that keeps running on your machine. It wraps swappable coding assistants (OpenAI's models among them), walks an unattended cross-repo fleet, and commits under your own credentials. The SDK is a toolkit for building one agent app; Minsky is an integration that connects existing tools into a self-improving system you own and run.

### 2. What lessons can it give to us?

- **Typed handoffs are worth copying as a design.** Explicit, typed transfer of control between agents is cleaner than ad-hoc message passing. Minsky already filed this as the M2 `multi-persona-pipeline-handoff-spec` task.
- **Guardrails belong at the framework level, not just in user code.** Minsky's `runtime-invariants.ts` (rule #3a) is the same shape — a deterministic gate before and after the agent. The lesson reinforces keeping that gate framework-enforced.
- **A zero-setup trace view drives adoption.** The Tracing Dashboard's "5-second comprehensibility" is the bar `minsky watch` should hit — without the cloud dependency.

### 3. Are any of these lessons potentially vision-changing?

No vision-changing finding. All three lessons sit on top of Minsky's existing architecture and reinforce existing rules. The handoffs lesson is already filed as an M2 design task; the guardrails lesson reinforces rule #3a; the trace-UX lesson reinforces the existing `minsky watch` goal. None forces a rewrite of `vision.md § What Minsky is`, and none invalidates a rule. The one place the SDK could threaten the vision — first-class non-OpenAI model support — is captured above as an explicit re-evaluation trigger and remains hypothetical. This negative finding is recorded here for audit.

### 4. How can we improve our strategy based on this?

- **Ship the handoffs spec.** The M2 `multi-persona-pipeline-handoff-spec` design adoption is validated by the SDK's clean primitive; prioritize it over a framework wrap.
- **Keep guardrails framework-enforced.** Treat `runtime-invariants.ts` (rule #3a) as the non-negotiable before/after gate the SDK's guardrails confirm is the right shape.
- **Match the trace UX without the cloud.** Invest `minsky watch` toward dashboard-grade comprehensibility while keeping all run data on the operator's machine.

### 5. Can and should we cut corners by replacing part of Minsky with this?

No. Replacing the per-task agent loop loses the sandbox and is dominated by OpenHands (SWE-bench 65.8% + Docker sandbox + 15+ LLMs). Replacing the adapter layer collapses the bring-your-own-agent matrix, the operator-facing feature. Replacing `minsky watch` with the cloud-default Tracing Dashboard silently exfiltrates run data and breaks operator-machine identity. The two primitives worth taking — handoffs and guardrails — are already absorbed as design adoptions, not as a framework wrap. See the wrap-feasibility verdict above: STRUCTURAL MISMATCH.

## Pin / integration

Not a dependency. No adapter. The handoffs primitive concept is already filed as M2 `multi-persona-pipeline-handoff-spec` (filed for design adoption, not framework wrap). Watch for the evolution of non-OpenAI model support.

## Pattern conformance

- **Pattern OpenAI Agents SDK implements**: vendor-SDK orchestration with explicit typed handoffs. It combines the Agent + Handoffs pattern (its own innovation, not directly anchored in pre-LLM CS literature) with first-class tracing (CNCF OpenTelemetry specification, 2020+) and guardrail-driven pre/post-execution validation (Wynne & Hellesøy, *The Cucumber Book*, 2012 — the same shape as BDD acceptance gates).
- **Conformance level**: full (within the pattern it implements).
- **How Minsky relates**: don't adopt. Model lock-in conflicts with bring-your-own-agent; cloud-default tracing conflicts with operator-machine identity; the per-task agent loop sub-case is dominated by OpenHands. Minsky borrows the *handoffs primitive concept* (filed as M2 design adoption) and the *guardrail-at-substrate-level pattern* (already absorbed via `runtime-invariants.ts`) but rejects the SDK runtime.
- **Index row**: vision.md § "Pattern conformance index" — pending row addition (filed as task `vision-md-pattern-row-openai-agents-sdk` if not added in this PR).

## Last reviewed

2026-05-23 — initial deep-dive added per the wrap-feasibility-openai-agents-sdk P2 task. Wrap-feasibility verdict: STRUCTURAL MISMATCH; handoffs + guardrails patterns already absorbed elsewhere; no follow-up P0 task filed.
