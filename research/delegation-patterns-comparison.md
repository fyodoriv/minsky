# Delegation patterns: CrewAI manager agent vs OpenHands sub-agent

> Why this file exists: Minsky's M2 `multi-persona-pipeline-handoff-spec` needs a
> delegation contract — a way for one agent (or persona) to hand a bounded
> sub-task to another, collect the result, and decide whether to re-delegate.
> Rule #1 (don't reinvent the wheel) says: before designing one, evaluate the
> two production-tested shapes that already exist. CrewAI ships a synchronous
> **manager agent** inside its hierarchical process; OpenHands ships an
> asynchronous **sub-agent delegation** with an inline critic. This document
> compares both against the four hard questions any delegation contract must
> answer, then recommends which shape Minsky adopts first and which second.
> The deliverable that closes `research-finding-manager-agent-delegation-pattern`
> is the recommendation in the last section plus the interface it informs at
> [`novel/claude-handoff-spec/src/delegation.ts`](../novel/claude-handoff-spec/src/delegation.ts).

This is a research / decision document, not shipping orchestration code. It
anchors the `DelegationContract` type defined in `claude-handoff-spec` so a
future implementor can read the rationale next to the interface.

## The two reference designs

### CrewAI — manager agent (hierarchical process)

Source: `docs.crewai.com/en/learn/hierarchical-process`; CrewAI maintainers,
`lib/crewai/src/crewai/process.py` + `crew.py`, github.com/crewAIInc/crewAI.

A `Crew` configured with `Process.hierarchical` auto-spawns (or accepts a
custom) **manager agent**. The manager is an LLM agent whose job is *not* to do
the work but to **route, validate, and re-delegate**. On `kickoff()`:

1. The manager reads the goal and the roster of worker agents (each with a
   `role` / `goal` / `backstory`).
2. The manager **synchronously** picks a worker, hands it a task with the
   context it judges relevant, and **blocks** waiting for the worker's output.
3. The manager **validates** the worker's output against the task's
   `expected_output` description (LLM-judged), and either accepts it, asks the
   same worker to revise, or re-delegates to a different worker.
4. Results bubble up to the manager, which aggregates them into the crew's
   final answer.

The shape is a **tree with a single coordinating root**, executed
depth-first and synchronously. Delegation is an LLM decision at every node.

### OpenHands — sub-agent delegation (Agent Canvas Initiative)

Source: OpenHands Agent Canvas Initiative, GitHub issue
`OpenHands/OpenHands#14374`; OpenHands maintainers, `openhands/` multi-agent
roadmap, github.com/OpenHands/OpenHands.

A parent agent running its own loop can **spawn a sub-agent** for a specialized
sub-task (e.g. a "browse the web" or "write a migration" specialist). The
parent:

1. Emits a delegation action naming the sub-agent kind and the sub-task.
2. The sub-agent runs its **own independent loop** in its own context window
   (and, in the sandboxed variants, its own sandbox), **asynchronously** with
   respect to the parent's reasoning.
3. An **inline critic** verifies the sub-agent's result before it is folded
   back into the parent's context — the verification is a first-class step, not
   a side effect of the parent re-reading the output.
4. The sub-agent's *full* trajectory is not handed back; a **summarized result**
   (plus artifacts) is returned to the parent to keep the parent's context
   window bounded.

The shape is a **parent-spawns-child** call graph with context isolation and a
verification gate on the return edge.

The four hard questions any delegation contract must answer follow, each as its
own section, answered for both vendors.

## Question (i): sub-agent failure recovery

| Concern | CrewAI manager agent | OpenHands sub-agent |
|---|---|---|
| Who notices the failure | The manager, when the worker returns output that fails its `expected_output` validation, or raises | The inline critic on the return edge, plus the parent's loop |
| Recovery move | Manager re-delegates: same worker (revise) or different worker; bounded by `max_iter` on the manager | Parent re-spawns the sub-agent or escalates; sub-agent crash is isolated to the child context |
| Blast radius of a crash | The whole synchronous chain blocks until the manager's `max_iter` is exhausted, then the crew fails | Isolated to the child; parent keeps its context and can choose a different strategy |

**Read for Minsky**: CrewAI's "manager validates then re-delegates" maps
directly onto Minsky's existing **let-it-crash + supervisor-restart** discipline
(rule #6) — the manager *is* a supervisor with an LLM policy. OpenHands' context
isolation is stronger but assumes a sandbox layer Minsky does not yet have
(tracked separately at `research-finding-pluggable-sandbox-layer`).

## Question (ii): context handoff to the sub-agent

| Concern | CrewAI manager agent | OpenHands sub-agent |
|---|---|---|
| What context the child sees | Manager curates a relevant slice (LLM decision) | Parent passes an explicit sub-task brief; child starts a *fresh* context window |
| Context-window discipline | Shared / overlapping with the manager's window — grows with the chain | Bounded — child window is independent of parent window |
| Determinism of the handoff | Low — the manager's curation is an LLM judgment | Higher — the brief is an explicit, serializable payload |

**Read for Minsky**: OpenHands' explicit, serializable sub-task brief is the
better fit for Minsky's **deterministic-CI ethos** (rule #10) — a brief is a
data structure you can lint, not an LLM whim. This is why the
`DelegationContract` interface models the handoff as an explicit `brief` field
(a payload), not an implicit "the manager decides what to share".

## Question (iii): result aggregation

| Concern | CrewAI manager agent | OpenHands sub-agent |
|---|---|---|
| Where results combine | At the manager root, depth-first | At the parent, after the critic gate |
| Form of the returned result | Full worker output, LLM-summarized into the crew answer | Summarized result + artifacts (not the full trajectory) |
| Ordering guarantee | Synchronous → deterministic order | Asynchronous → order is whatever the parent's loop imposes |

**Read for Minsky**: synchronous aggregation (CrewAI) is the simpler baseline —
deterministic ordering means the result is reproducible, which the gate can
assert. Minsky's first delegation shape should aggregate synchronously; the
async/inline-critic shape is a second iteration once a baseline is proven.

## Question (iv): cycle detection (sub-agent re-delegating to the parent)

| Concern | CrewAI manager agent | OpenHands sub-agent |
|---|---|---|
| Can a child delegate back up | Workers cannot re-delegate to the manager in the default hierarchical process — the tree is acyclic by construction | Sub-agents *can* spawn further sub-agents; cycle prevention is the parent's responsibility |
| Default safety | Acyclic by design — the strongest guarantee | Requires an explicit depth bound / visited-set to stay acyclic |
| Failure mode if unguarded | None in the default shape | Unbounded recursion / re-delegation storm |

**Read for Minsky**: CrewAI's **acyclic-by-construction** tree is the safer
starting shape. Minsky's `DelegationContract` therefore carries an explicit
`maxDepth` and a `visited` chain so that even the second-iteration (async) shape
inherits the acyclic guarantee CrewAI gets for free.

## Recommendation: Minsky adopts the manager-agent shape first, the sub-agent shape second

**Pattern X (first):** the **synchronous, acyclic-by-construction manager-agent
tree** (CrewAI shape). It maps onto Minsky's existing supervisor discipline
(rule #6 — the manager is a supervisor with a delegation policy), aggregates
deterministically (which the gate can assert, rule #10), and is acyclic by
construction (no cycle-detection code needed for the baseline). The
`DelegationContract` interface encodes this as a root coordinator handing
bounded `briefs` to workers and collecting `DelegationResult`s synchronously.

**Pattern Y (second):** the **asynchronous sub-agent with an inline critic and
context isolation** (OpenHands shape). It is the right *second* iteration once
the synchronous baseline ships — it adds bounded child context windows and a
first-class verification gate, but it depends on (a) a sandbox abstraction
Minsky does not yet have (`research-finding-pluggable-sandbox-layer`) and (b)
explicit cycle detection (the `maxDepth` + `visited` fields the contract already
reserves). Shipping it before the synchronous baseline would add asynchrony and
context-isolation complexity with no proven baseline to compare against.

**Pivot guard (rule #9).** Both vendors lean on LLM-driven coordination (the
manager's routing decision; the critic's verification). Minsky's deterministic-CI
ethos does **not** reject that outright — the LLM decision is *advisory*, and the
**handoff itself is deterministic** (a serializable `brief` + a serializable
`DelegationResult`, both lintable). If, in M2 use, the LLM coordination proves
too non-deterministic to gate, the documented pivot is **deterministic handoff
via TASKS.md sub-tasks** — the parent files a sub-task block, the daemon picks it
up next iteration, and the "manager in the loop" collapses into the existing
task-queue substrate. The `DelegationContract` interface is shaped to survive
that pivot: a `brief` is already TASKS.md-block-shaped, and a `DelegationResult`
is already a filed-outcome shape.

**Anchors.** Rule #1 (don't reinvent — two vendors shipped this, evaluate before
building); rule #6 (let-it-crash + supervisor — the manager is a supervisor with
a policy; Armstrong, *Making reliable distributed systems in the presence of
software errors*, 2003); rule #10 (deterministic enforcement — the handoff is a
lintable data structure, the LLM decision is advisory); CrewAI hierarchical
process docs; OpenHands Agent Canvas Initiative issue #14374;
`competitors/crewai.md` § "What we learn / steal" bullet 2;
`competitors/openhands.md` § "What we learn / steal" bullet 4.
