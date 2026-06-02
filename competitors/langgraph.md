# Competitor: LangGraph (LangChain)

> Graph-based state-machine runtime for stateful multi-agent workflows. Third-party benchmarks rate it the most mature workflow engine in the LangChain ecosystem.

- **URL**: <https://www.langchain.com/langgraph>
- **GitHub**: <https://github.com/langchain-ai/langgraph>
- **Status**: Active, v0.2.x, Python + JavaScript, LangChain ecosystem
- **Pricing**: Open-source core (MIT). LangGraph Cloud / LangGraph Studio require LangSmith subscription for hosted tracing + checkpoint storage.
- **Relationship**: **Competitor (orchestrator tier)** — different architecture, different distribution model. Listed as a peer in `competitors/README.md` § comparison matrix; pattern-conformance row 81 (vision.md) marks graph-based time-travel as a rejected-by-design property.

## What it is

LangGraph is an open-source library for building stateful, multi-actor applications with LLMs. It models agent workflows as a directed graph where nodes are agent functions and edges are state transitions. Built on top of LangChain primitives (LCEL, runnables, retrievers), so it inherits the full LangChain integration surface (200+ tools, 80+ chat models, every common vector store). Designed to be the "stateful workflow" runtime that LangChain itself isn't.

Three deployment shapes:

- **In-process Python (or JS)** — `pip install langgraph` and call `compile()` on a `StateGraph`. Runs in the host application; state lives in-memory or in a configured checkpointer (Postgres, SQLite, Redis).
- **LangGraph Studio** — local development environment with a web UI for visualizing graph runs, replaying past executions, and stepping through state transitions.
- **LangGraph Cloud** — hosted runtime with managed checkpointing, scaling, and tracing. Requires LangSmith subscription.

Core innovation: **checkpointer + thread_id model** — every super-step (one node transition) is persisted; you can replay from any prior super-step, branch the execution, or time-travel back to a known good state.

## Strengths

- **Time-travel debugging via checkpoints** — uncommon at the orchestrator tier; only Microsoft Agent Framework and LangGraph offer this.
- **Durable execution** — workflows survive process restarts via the checkpointer.
- **Thread_id model** — multi-tenant conversation state with a clean isolation boundary.
- **Tight LangChain ecosystem integration** — 200+ tools, 80+ models, every retriever, every vector store work out of the box.
- **Graph state visualization** — LangGraph Studio shows runs as you debug.
- **Documented benchmarks** — third-party AImultiple + JetThoughts evaluation: 62% complex-task success, 100% tool execution success.
- **Active community** — LangChain has the largest gravity in the Python LLM ecosystem; LangGraph inherits that.

## Gaps (why we don't use it)

1. **Python (or JavaScript) framework, not a daemon.** You build the graph; you run the graph. LangGraph doesn't ship a 24/7 daemon walking N repos. The closest equivalent is LangGraph Cloud's scheduled triggers, which are cloud-side and require LangSmith.
2. **In-process state management, not across-session knowledge accumulation.** LangGraph's checkpointer is per-execution: each thread_id is its own conversation. There's no built-in primitive for "across all my prior runs, what should I learn?" — that's Minsky's MAPE-K substrate, which LangGraph doesn't provide.
3. **LangSmith default tracing.** OpenTelemetry support exists but the canonical LangChain tracing path goes through LangSmith, which is hosted and adds a cloud dependency. Operator-machine identity is at risk if LangSmith becomes the only path.
4. **Graph DSL adds operator cognitive load.** Operators define the workflow graph in code; Minsky's operators edit TASKS.md in markdown. The graph DSL is a steeper learning curve for the same delivery surface.
5. **No cross-repo fleet model.** A LangGraph workflow runs on one input; the cross-repo round-robin (Minsky moat #5) has no equivalent.
6. **No constitutional gates.** LangGraph workflows define behavior, not policy. The 18-rule constitutional enforcement model (Minsky moat #3) has no analog.

## What we extract or learn

- **Graph-state pattern for MAPE-K** — LangGraph's state-machine model (nodes = pure functions, edges = state transitions, checkpoints between supersteps) IS structurally similar to MAPE-K's Monitor → Analyze → Plan → Execute phases. We could adopt the *pattern* without depending on the framework. Filed as `mape-k-graph-state-pattern-adoption` (P3).
- **Time-travel debugging via checkpointing** — interesting for autonomic-loop replay; defer for now. Combine with git event-sourcing (Minsky's `.minsky/orchestrate.jsonl` is already event-sourced) for free replay later. Tracked in `competitors/README.md` § "What we extract or learn" row 51.
- **Thread_id isolation pattern** — `experiment-store/cross-repo/<host>/*.jsonl` already follows the same multi-tenant shape; per-host == per-thread. The pattern is already absorbed.

## Why we don't just use it

Adopting LangGraph would mean:

- **Abandoning TypeScript orchestration tier** for Python (LangGraph JS is partial; the ecosystem gravity is on Python). Constitutional violation — Minsky's substrate is TS to share with tasks.md + agentbrew.
- **Adopting LangSmith as a default tracing dependency** to get the full feature set. Operator-machine-identity moat at risk.
- **Inheriting LangChain's framework gravity** — LangChain wants to be in your dependency chain at the orchestrator layer; once you adopt it, the operator surface is LangChain idioms, not Minsky's `bin/minsky` + TASKS.md.
- **Trading the daemon shell for an event-driven runtime.** LangGraph workflows run when triggered; Minsky's daemon runs continuously and drains TASKS.md. The shapes are different at the most fundamental level.

We extract the graph-state PATTERN (already done as MAPE-K's design inspiration) without depending on the framework. Same shape as how we adopted OTEL.

## Should we wrap LangGraph instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: STRUCTURAL MISMATCH — do NOT wrap. The graph-state PATTERN, however, is already absorbed in MAPE-K's design (pattern adoption ≠ framework wrap).** The pre-registered hypothesis in the wrap-feasibility-langgraph task block predicted PARTIAL YES (≥5 surviving moats). The honest analysis below shows the architectural mismatch is sharper than the moat-count suggests, and the strongest sub-case (graph-state pattern absorption) doesn't require wrapping LangGraph at all.

### The 5 questions

**1. Architectural fit.** LangGraph runs in-process Python (the canonical surface; the JS port is partial). LangGraph Cloud adds LangSmith as a tracing dependency. Minsky runs as a TypeScript daemon attached to N repos on the operator's machine. There's no Python long-running daemon shape in LangGraph — the closest equivalent is LangGraph Cloud's scheduled triggers, which violate operator-machine identity. **No clean architectural fit at the runtime layer.**

**2. What we delegate.** Three plausible targets:

- **Graph-state substrate for MAPE-K** — LangGraph's checkpointer + thread_id model substitutes for Minsky's tick-loop iteration recording. *Doesn't require a wrap* — the graph-state pattern is already MAPE-K's design inspiration (per ARCHITECTURE.md § "Theoretical foundations"). We use the pattern; LangGraph doesn't see our state.
- **Multi-step agent workflow per task** — LangGraph as the per-task agent engine. *Dominated by OpenHands* per the Path C plan — OpenHands' CodeAct loop + DelegateTool + TaskToolSet covers the per-task multi-step workflow with lower integration cost. Adding LangGraph as a 5th cloud_agent would compete with the OpenHands wrap that's already approved.
- **Cross-task state passing via thread_id** — LangGraph's thread_id model for sharing state across iterations on the same task. *Already covered by `experiment-store/cross-repo/<host>/*.jsonl`* — the pattern is multi-tenant per-host JSONL streams.

**3. What we keep.** Of Minsky's 6 moats, only one (MAPE-K substrate) has any structural overlap with LangGraph. Daemon-not-framework, operator-machine identity, constitution+CI, cross-repo fleet, and TASKS.md surface all survive a hypothetical LangGraph wrap because LangGraph doesn't compete on any of those axes.

**4. Net moat after wrap.** If Minsky wrapped LangGraph as the MAPE-K substrate:

| Moat | Survives a hypothetical LangGraph wrap? | Why |
|---|---|---|
| Daemon, not framework | 🟡 | LangGraph is embedded in the daemon as a state engine; the daemon shell still runs continuously |
| Operator-machine identity | 🟡 | Survives if we explicitly avoid LangSmith; at risk if the canonical LangChain path becomes LangSmith-required |
| Constitution + CI | ✅ | Unchanged — LangGraph doesn't gate PRs |
| MAPE-K substrate | ❌ | This IS the wrap target — by definition our substrate becomes LangGraph's runtime |
| Cross-repo fleet | ✅ | Unchanged — `--hosts-dir` round-robin is at the daemon layer, not the state layer |
| TASKS.md as operator surface | ✅ | Unchanged — operator still edits markdown; LangGraph nodes read it |

Net: **4-5 of 6 moats survive** depending on how strictly you count "MAPE-K substrate" as the moat itself vs the discipline it implements. Right at the threshold for "worth proposing as P0".

But the threshold check is necessary, not sufficient. The architectural mismatch (Python framework vs TypeScript daemon) imposes a permanent integration tax that the moat math doesn't capture. And the strongest sub-case (graph-state pattern) is absorbable without the framework — same shape as OTEL.

**5. Verdict — STRUCTURAL MISMATCH (and PATTERN-ALREADY-ABSORBED).** Don't wrap. The Python/TypeScript split is a permanent integration tax; the LangSmith default-tracing path threatens operator-machine identity; the graph-state pattern is already absorbed in MAPE-K's design without a runtime dependency. The wrap-feasibility hypothesis (PARTIAL YES) is refined by the architectural analysis to: *yes, the moat math works, but the integration cost is too high vs the pattern-only path*. Continue extracting individual LangGraph ideas (checkpoint-based replay, thread_id isolation pattern) without depending on the runtime.

### Trigger for re-evaluation

Re-run this analysis when ANY of these fire:

1. **LangGraph ships a stable TypeScript port at feature parity** — eliminates the Python-vs-TS integration tax. Re-evaluate the wrap shape.
2. **LangGraph decouples from LangSmith** — explicit "zero cloud egress" deployment shape documented. Operator-machine identity risk drops; re-evaluate.
3. **MAPE-K L2 closed-loop A/B prompt tuning starts shipping** (per `user-stories/003`) and the implementation cost exceeds 4 weeks. Then folding MAPE-K's graph state onto LangGraph's runtime becomes a defensible bypass.
4. **OpenHands' Path C wrap fails the pivot threshold** (`add-openhands-as-pluggable-backend` Pivot: <5pp SWE-bench delta). Then LangGraph at the orchestrator layer becomes a candidate for the second-best wrap shape — re-evaluate.

## Five pivot questions

### 1. How is it different from Minsky?

LangGraph is an **in-process workflow library**: you define a `StateGraph` in Python (the canonical surface; the JS port is partial), `compile()` it, and *run* it on an input. Minsky is an **orchestrator-tier 24/7 TypeScript daemon** that attaches to N repos, drains TASKS.md, and refuses to merge any agent's output that fails the 18-rule constitution. The defining structural difference is the *outer loop and the gate*: a LangGraph workflow runs when triggered and stops at the terminal node; Minsky never stops, picks the next task itself, and self-governs. LangGraph models *one workflow's* state transitions; Minsky models a *fleet's* task selection plus a CI merge gate. LangGraph's checkpointer is the closest thing to overlap — it persists every super-step so you can replay or time-travel — but it persists *one execution's* state per `thread_id`, not *across all prior runs on a host*, which is the MAPE-K substrate's job. The two are not peers: LangGraph is the kind of inner-loop state engine an orchestrator might embed, not an orchestrator.

### 2. What lessons can it give to us?

- **Checkpoint-per-super-step as the durability primitive** (LangGraph docs § "Persistence", § "Time travel") — every node transition is persisted to a checkpointer (Postgres / SQLite / Redis), so a workflow survives process restart and can replay from any prior step. Lesson: Minsky's tick-loop durability story should be *event-sourced at the iteration boundary*, which `.minsky/orchestrate.jsonl` already is — confirmation that the append-only-log bet was right, and a concrete shape (one record per super-step) to keep matching.
- **Graph-state as the MAPE-K shape** (LangGraph models nodes = pure functions, edges = state transitions) — structurally identical to MAPE-K's Monitor → Analyze → Plan → Execute phases. Lesson: adopt the *pattern* (already done in MAPE-K's design per ARCHITECTURE.md § "Theoretical foundations") without the framework — same play as adopting OTEL without adopting a vendor.
- **`thread_id` as the multi-tenant isolation boundary** (LangGraph docs § "Threads") — each conversation/run gets its own state namespace. Lesson: Minsky's `experiment-store/cross-repo/<host>/*.jsonl` already follows this shape (per-host == per-thread); the pattern is absorbed, not pending.
- **LangSmith-default tracing is a cautionary tale, not a model to copy** — LangGraph's canonical observability path routes through hosted LangSmith. Lesson: a framework that makes the hosted-cloud path the *default* tracing surface puts operator-machine identity at risk; Minsky's OTEL-first, local-by-default choice (rule #4) is the deliberate inverse and must stay that way.

### 3. Are any of these lessons potentially vision-changing?

**No vision rewrite is forced today.** The task's Hypothesis was: *LangGraph's checkpoint + resumption primitives are the most relevant prior art for the tick-loop durability story; Q5 evaluates replace-tick-loop-with-LangGraph viability.* Examined against the pre-registered Pivot (*if LangGraph's adoption cost > the gain from replacing the tick-loop, keep the current implementation*):

- **The durability lesson is already absorbed without the framework.** `.minsky/orchestrate.jsonl` is event-sourced; the checkpoint-replay pattern that LangGraph implements is the pattern Minsky already runs (Fowler 2005 event-sourcing + van der Aalst 2002 workflow nets — see § "Pattern conformance"). Absorbing the *pattern* does not require depending on the *runtime*.
- **The maximal version of the threat does not dissolve the moat.** Even if Minsky folded MAPE-K's state onto LangGraph's checkpointer, it would gain durable replay (a simplification) but would NOT gain cross-repo task selection, the TASKS.md operator surface, operator-machine identity, the budget guard, or — most importantly — the **constitution + CI merge gate** (moats #3–#6). LangGraph is a state engine; it supplies no governance and no fleet layer.
- **Adoption cost exceeds the gain (Pivot satisfied → keep current implementation).** The Python-vs-TypeScript split is a permanent integration tax, and the LangSmith-default tracing path threatens operator-machine identity. The gain (durable replay) is already available via event-sourcing. So the Pivot threshold — *adoption cost > replacement gain* — is **crossed**, and the directive is exactly what the Pivot pre-registered: **keep the current tick-loop implementation.** This is a negative finding (no vision-threat question filed), recorded here per this task's central-questions routing rather than by editing `ask-human.md`.

### 4. How can we improve our strategy based on this?

- **Keep the iteration record one-super-step-per-record** — match LangGraph's checkpoint granularity in `.minsky/orchestrate.jsonl` so a future replay/time-travel feature is free (the log is already the checkpointer). Traces to lesson §2.1.
- **Pre-write the "fold, don't pivot" plan for MAPE-K durability** — record *now* (this file) that if MAPE-K ever needs durable replay, the answer is event-sourcing over the existing JSONL, not a LangGraph runtime dependency. Traces to lesson §2.2 + Q3. Keeps a future agent from over-reacting to a "LangGraph has checkpoints" observation.
- **Treat LangSmith-default tracing as an explicit anti-requirement** — keep OTEL-first + local-by-default (rule #4) as a deliberate design choice the docs name, so no future integration quietly adopts a hosted-cloud default tracing path. Traces to lesson §2.4.
- **Watch the TypeScript-port + LangSmith-decoupling triggers** — the two re-evaluation triggers below are the only conditions under which the wrap math changes; keeping them explicit is the cheap insurance. Traces to § "Trigger for re-evaluation".

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — LangGraph has no daemon / queue / cross-repo loop; it runs one workflow on one input and stops. The durability sub-case it tempts you with is already covered by the event-sourced `.minsky/orchestrate.jsonl`.
- **MAPE-K**: KEEP (pattern already absorbed) — the graph-state shape inspired MAPE-K's design, but folding MAPE-K onto LangGraph's runtime imposes the Python/TS tax for a durability gain we already have. *Watch*: if MAPE-K L2 closed-loop tuning (user-stories/003) ever exceeds ~4 weeks to build, re-open the fold question.
- **adapters / agent backend**: N/A — LangGraph is a workflow engine, not an agent runtime; the per-task multi-step workflow is dominated by OpenHands' CodeAct loop (the approved Path C wrap), so adding LangGraph as a 5th `cloud_agent` would compete with an integration that's already cheaper.
- **sandbox**: N/A — LangGraph runs in-process; OS-level isolation stays Minsky's job.
- **constitution / merge gate**: KEEP — LangGraph defines behaviour (the graph), not policy. The 18-rule constitutional gate (moat #3) has no analog.
- **cross-repo fleet**: KEEP — `--hosts-dir` round-robin (moat #5) has no LangGraph equivalent; a workflow runs on one input.
- **corpus / scorecard**: N/A — LangGraph is a benchmarked orchestrator-tier peer in `competitors/README.md`, intentionally a *competitor* record, not a dependency-candidate; it stays in the M1.10 corpus denominator.
- **TASKS.md surface / fleet dashboard**: KEEP — operators edit markdown; LangGraph's graph DSL is a steeper learning curve for the same delivery surface, and it has no fleet dashboard.

**Total replace % across all surfaces: 0% — STRUCTURAL MISMATCH.** The honest headline for the operator: *nothing in the orchestrator to replace; the one tempting sub-case (durable checkpoint replay) is already absorbed as an event-sourcing pattern over `.minsky/orchestrate.jsonl`; the Python/TS integration tax plus the LangSmith-default tracing risk make a wrap a net negative; the two re-evaluation triggers (a feature-parity TS port, a LangSmith decoupling) are the only conditions that change the math.*

## Pin / integration

Not a dependency. No adapter. Graph-state pattern absorbed via MAPE-K design (pattern, not framework). Watch their checkpointer + thread_id evolution for relevant ideas to extract.

## Pattern conformance

- **Pattern LangGraph implements**: Graph-based stateful workflow orchestration with checkpoint-based replay — van der Aalst & van Hee, *Workflow Management: Models, Methods, and Systems*, MIT Press, 2002 (workflow nets + the four perspectives) — combined with event-sourcing for state recovery (Fowler, M., *Event Sourcing*, martinfowler.com, 2005).
- **Conformance level**: full (in the pattern LangGraph implements).
- **How Minsky relates**: don't adopt — wrong stack (Python first), wrong distribution (in-process framework not daemon), LangSmith dependency conflict. Minsky borrows the graph-state pattern (already absorbed in MAPE-K's Monitor → Analyze → Plan → Execute design — vision.md § "Theoretical foundations") + the checkpoint-replay pattern (`.minsky/orchestrate.jsonl` is event-sourced for this) but rejects the framework runtime.
- **Index row**: vision.md § "Pattern conformance index" row 81 (graph-based time-travel — rejected-by-design).

## Last reviewed

2026-06-02 — deepened with the `## Five pivot questions` framework per task `competitor-deepen-langgraph`. Verdict: STRUCTURAL MISMATCH (0% replace across all surfaces); the durable-checkpoint sub-case is already absorbed as event-sourcing over `.minsky/orchestrate.jsonl`, so the pre-registered Pivot (*adoption cost > replacement gain → keep current tick-loop*) is crossed and the directive is to KEEP the current implementation. Negative finding — no vision-threat question filed (recorded inline per this task's central-questions routing rather than editing `ask-human.md`). Two explicit re-evaluation triggers remain: a feature-parity LangGraph TypeScript port, and a documented LangSmith decoupling.

Earlier reviews: 2026-05-23 — initial deep-dive added per the wrap-feasibility-langgraph P2 task. Wrap-feasibility analysis: STRUCTURAL MISMATCH; graph-state pattern absorbed without wrap; no follow-up P0 task filed (the predicted PARTIAL YES refined to STRUCTURAL MISMATCH by the architectural-tax analysis).
