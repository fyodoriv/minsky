# Research: CrewAI `unified_memory.py` — hierarchical memory architecture

> This file exists to record the deep-dive evaluation of CrewAI's unified
> memory system (`lib/crewai/src/crewai/memory/unified_memory.py`) as a
> candidate pattern for the `claude-handoff-spec` M2 memory layer. It answers
> the four questions the `research-finding-hierarchical-memory-architecture`
> task pre-registered, then records a build/buy/adopt recommendation under
> Minsky rule #1 ("don't reinvent — evaluate before building from scratch").
> It is the source artefact behind any future `novel/claude-handoff-spec/src/memory.ts`
> interface design; the interface is NOT written here — only the decision of
> whether (and what shape of) interface to write is.

- **Subject**: `unified_memory.py`, CrewAI maintainers, github.com/crewAIInc/crewAI
- **Evaluated for**: `novel/claude-handoff-spec` M2 memory pattern
- **Decision rule**: Minsky rule #1 (GET → WRAP → CONTRIBUTE → ABSORB)
- **Sibling analysis**: [`competitors/crewai.md`](../competitors/crewai.md) § "What we learn / steal" bullet 1
- **Strategic context**: [`docs/strategic-review-2026-05-22-continue-or-wrap-more.md`](../docs/strategic-review-2026-05-22-continue-or-wrap-more.md)

## Q1: Scope syntax — `/project/<id>` and `/agent/<id>/<bucket>`

CrewAI's unified memory addresses every stored item by a **path-shaped scope
string**, not a flat key. Two scope families dominate:

- **Project scope** — `/project/<project-id>`. Memories that belong to a whole
  body of work, visible to every agent participating in that project. The
  CrewAI README example is `/project/alpha`.
- **Agent scope** — `/agent/<agent-id>/<bucket>`. Memories private to one agent
  (its `role`/`goal`/`backstory` identity), further partitioned by a named
  bucket. The documented example is `/agent/researcher/findings` — the
  `researcher` agent's accumulated findings.

The grammar is hierarchical and prefix-addressable: a recall against
`/project/alpha` can fan out into sub-scopes, and an agent scope is naturally a
child of the agent's identity. The scope string is the join key for recall —
the same way a filesystem path is the join key for `ls`.

**Mapping to Minsky's needs.** This grammar lines up almost 1:1 with Minsky's
three memory tiers that today live implicitly across git + `TASKS.md` +
`.minsky/experiment-store/`:

| CrewAI scope shape          | Minsky tier                          | Today's substrate                                  |
| --------------------------- | ------------------------------------ | -------------------------------------------------- |
| `/project/<id>`             | per-host (per-repo)                  | the repo's `TASKS.md` + git history                |
| `/agent/<id>/<bucket>`      | per-task (per-iteration agent run)   | the iteration's brief + worktree + PR body         |
| (no direct CrewAI analogue) | per-fleet (cross-repo, daemon-wide)  | `.minsky/experiment-store/cross-repo/*.jsonl`      |

The grammar is **portable** — it is just a string convention with a recall
join — and it survives the Minsky tier mapping without depending on any CrewAI
runtime type. The per-fleet tier (`/fleet/...`) is a clean additive extension
of the same grammar that CrewAI does not need but Minsky does.

## Q2: LLM-analyzed scope inference

CrewAI does not require the caller to declare a scope on every write. Instead
the memory system **infers the scope with an LLM** — it analyzes the memory
content (and the writing agent's identity/context) and decides which scope
string the item belongs to. A finding produced by the `researcher` agent while
working project `alpha` is auto-routed to (e.g.) `/agent/researcher/findings`
rather than the operator hand-labelling it. This is the "LLM-analyzed for
automatic scope inference" property called out in `competitors/crewai.md`.

**Trade-off.** The inference is convenience (operators never hand-declare
scopes) bought with non-determinism (the LLM can mis-route, and the routing is
not reproducible across runs). For Minsky this is the load-bearing tension:

- **rule #10 (deterministic enforcement)** forbids an LLM in any *load-bearing*
  gate. Scope inference is NOT a gate — it is a write-time convenience — so it
  is not a rule #10 violation per se. But a *load-bearing* recall (one whose
  result decides what the next iteration does) that silently depends on an LLM
  routing decision IS the kind of hidden non-determinism rule #10 exists to
  surface.
- The mitigation that keeps the grammar without the non-determinism: make scope
  inference an **advisory default with a deterministic override**. The caller
  MAY pass an explicit scope (deterministic, reproducible); when omitted, an
  LLM proposes one and the proposal is logged so the operator sees it. This is
  the same "compute → default → override" ladder rule #14b mandates for
  timeouts, applied to scope selection.

The inference algorithm itself (the prompt CrewAI feeds the LLM, the few-shot
exemplars) is CrewAI-internal and Pydantic-coupled — see Q3/Q4.

## Q3: Adaptive-depth recall scoring (semantic + recency + importance)

Recall is not a flat vector-similarity top-k. CrewAI scores candidate memories
on **three weighted signals** and adapts how deep it recalls based on the
query:

1. **Semantic** — embedding similarity between the query and the stored item
   (agentic RAG: query rewriting, knowledge sources).
2. **Recency** — newer memories score higher; an exponential/decay weighting so
   stale items fade without being deleted.
3. **Importance** — an item-level salience weight (set at write time, or
   LLM-assigned), so a one-off detail does not outrank a load-bearing fact.

"Adaptive-depth" means the recall depth (how many items, how far down the
hierarchy) is a function of the query rather than a fixed `k` — a broad query
pulls a shallow wide set, a specific query drills one sub-scope deep.

**Mapping to Minsky.** Minsky's current "recall" is `git log` + reading
`TASKS.md` + the iteration brief — pure recency with no semantic or importance
weighting. The three-signal scoring is the genuinely novel capability CrewAI
has that Minsky lacks (the gap `competitors/crewai.md` § "Why choose CrewAI
over Minsky" bullet 2 acknowledges). The *scoring shape* (a weighted sum over
named signals) is portable and deterministic if the weights are fixed
constants and the semantic signal uses a pinned embedder. The *adaptive-depth*
part introduces query-dependent behaviour that must be measured before it is
trusted (rule #9 — pre-register the recall-quality metric before adopting).

## Q4: Persistence backend (embedder + vector store)

CrewAI's memory persistence is pluggable but ships sensible defaults:

- **Vector store / embedder** — agentic RAG over an embedding store. The
  roadmap (`competitors/crewai.md` § Roadmap) names **Qdrant Edge** as the
  v1.12.1 backend direction; OSS defaults have historically used a local
  embedding store. The embedder is configurable (LiteLLM-routed, so any
  OpenAI-compatible embedding model).
- **State persistence (Flows)** — **SQLite by default**
  (`lib/crewai/src/crewai/flow/persistence/sqlite.py`); CrewAI AMP swaps in a
  distributed Task Store + Context Store + Wharf DB (OTEL traces) for the
  enterprise tier.

**Mapping to Minsky.** A vector store is a heavyweight new dependency relative
to Minsky's "git + flat files" substrate, and it must enter through rule #2 (an
adapter interface `novel/adapters/<name>.ts` + a vendor impl +
`selfTest()` + a dependency-table row in `ARCHITECTURE.md`) — it cannot be
imported directly into business logic. The deterministic-by-default posture
argues for starting with the **scope grammar + three-signal scoring over the
EXISTING substrate** (git + jsonl experiment-store, recency-only at first) and
only adding a vector store behind an adapter once a recall-quality metric
justifies the dependency (preparation-PR pattern: instrument recall quality
first, then add the embedder against a measured baseline).

## Recommendation: adopt the GRAMMAR, defer the IMPLEMENTATION

Per the task's pre-registered Pivot ("if `unified_memory.py` depends heavily on
CrewAI-specific Pydantic shapes that don't transfer, the recommendation is
'adopt the SCOPE GRAMMAR not the impl'") — the deep-dive confirms exactly that
condition. The verdict:

- **ADOPT (now, portable):** the **scope grammar** `/project/<id>`,
  `/agent/<id>/<bucket>`, plus a Minsky-specific `/fleet/<id>` tier. It is a
  string convention with a recall join — zero CrewAI runtime coupling. This is
  the shape a future `novel/claude-handoff-spec/src/memory.ts` interface should
  encode (a `MemoryScope` type + a `recall(scope, query)` / `remember(scope,
  item, importance?)` contract), behind a rule #2 adapter so the backend stays
  swappable.
- **ADAPT (with rule #10 guard):** **LLM-analyzed scope inference** as an
  *advisory default with a deterministic explicit-scope override*, logged so
  the operator sees every inferred route. Never a load-bearing recall that
  silently depends on the LLM routing.
- **ADAPT (with rule #9 gate):** **three-signal recall scoring** (semantic +
  recency + importance) as fixed-weight deterministic scoring over the existing
  git + jsonl substrate first; add a vector-store embedder only after a
  preparation PR instruments recall quality and a measured baseline justifies
  the new dependency.
- **DO NOT ADOPT:** the `unified_memory.py` **implementation** itself — it is
  Pydantic-shaped and CrewAI-runtime-coupled (Agent/Crew/Flow objects), and
  Minsky is a TypeScript daemon, not a Python framework. Reimplementing the
  grammar in TS behind an adapter (rule #2) is the correct ABSORB step, not
  vendoring the Python.

**Next step (gated on M2 use cases, NOT done in this research PR):** when the
`claude-handoff-spec` M2 work begins, write `novel/claude-handoff-spec/src/memory.ts`
as the interface encoding the adopted grammar above, with a paired test, a
rule-2 adapter seam, a rule-4 OTEL span on recall, a rule-7 chaos section, and
a `vision.md` § "Pattern conformance index" row citing CrewAI's
`unified_memory.py` as the pattern source (hierarchical memory / agentic RAG;
Alexander et al. 1977 catalogue-by-artefact framing). That interface is
deliberately out of scope here because (per the Pivot) the grammar is what
survives, and the grammar is fully documented above — the interface is a
mechanical encoding of it once the M2 use cases pin the exact `recall`
signature.

## Anchor

- Minsky rule #1 (don't reinvent — CrewAI shipped this, evaluate before
  building from scratch).
- [`competitors/crewai.md`](../competitors/crewai.md) § "What we learn / steal"
  bullet 1 (memory architecture as a future design pattern for
  `claude-handoff-spec`).
- CrewAI maintainers, `lib/crewai/src/crewai/memory/unified_memory.py`,
  github.com/crewAIInc/crewAI.
