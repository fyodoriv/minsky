# `@minsky/claude-handoff-spec`

<!-- scope: human-approved research-finding-manager-agent-delegation-pattern — package README for the delegation contract whose interface (delegation.ts) is the task's declared Touches; the package wrapper files (README, package.json, tsconfig, index barrel) ship in the same commit as the interface. -->

<!-- rule-1: CrewAI manager-agent delegation + OpenHands sub-agent delegation rejected because: both are LLM-coordination shapes bound to their own runtimes (CrewAI Crews / OpenHands Agent Canvas); Minsky needs a deterministic, serializable handoff CONTRACT (lintable per rule #10), not their orchestration runtimes. We extract the design lessons (research/delegation-patterns-comparison.md) and ship a type-only contract instead of vendoring either runtime. -->

The delegation contract Minsky's M2 `multi-persona-pipeline-handoff-spec`
implements. It is **types only** — it carries the `DelegationContract` family
(`DelegationBrief` / `DelegationResult` / `DelegationVerdict` / `DelegationShape`)
that lets one agent (or persona) hand a bounded sub-task to another, collect a
result, and decide whether to re-delegate.

The shape was chosen by comparing the two production-tested delegation patterns
that already exist — CrewAI's synchronous **manager agent** and OpenHands'
asynchronous **sub-agent** — in
[`research/delegation-patterns-comparison.md`](../../research/delegation-patterns-comparison.md).
The recommendation: adopt the **manager-agent shape first** (synchronous,
acyclic-by-construction, deterministic aggregation) and the **sub-agent shape
second** (async, inline-critic, bounded child context).

Public surface:

- `DelegationShape` — `"manager-sync" | "subagent-async"`.
- `DelegationVerdict` — `"accepted" | "revise" | "redelegate" | "failed"`.
- `DelegationBrief` — the serializable hand-off payload (`taskId`, `goal`, `context`, `expectedOutput`).
- `DelegationResult` — the summarized return (`taskId`, `verdict`, `summary`, `artifacts`).
- `DelegationContract` — the full contract (`shape`, `maxDepth`, `visited`, `critic`).

## Pattern conformance

- **Module shape** — delegation contract modeled on the CrewAI hierarchical
  process manager-agent pattern (CrewAI maintainers, hierarchical process docs),
  with the OpenHands sub-agent shape (issue `OpenHands/OpenHands#14374`) reserved
  as the second-iteration variant. **Conformance: full** for the synchronous
  baseline; the async fields (`critic`, `subagent-async`) are declared but their
  runtime is M2 second-iteration.
- **Supervisor framing** — the coordinator is a supervisor with a delegation
  policy (Armstrong, *Making reliable distributed systems in the presence of
  software errors*, 2003) — rule #6 (let-it-crash + supervisor-restart).
- **Deterministic handoff** — the brief and result are serializable, lintable
  data structures; the LLM routing decision is advisory, not load-bearing
  (rule #10). **Conformance: full.**
- **Leaf-package shape** — explicit dependencies per Wiggins,
  *The Twelve-Factor App*, 2011 (factor II). Zero internal Minsky deps; a viable
  leaf in the workspace DAG.

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: the package is types only — there is no runtime
  code, no I/O, no shared state. The `DelegationContract` family is a set of
  compile-time shapes; for any conforming literal, round-tripping a
  `DelegationBrief` / `DelegationResult` through `JSON.stringify` ∘ `JSON.parse`
  yields a value equal to the original.
- **Blast radius**: none at runtime. A malformed contract is rejected at
  compile time by `tsc --noEmit`; there is no process state to corrupt because
  the package does not execute.
- **Operator escape hatch**: not applicable — there is nothing to shut down.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | A future implementor changes the brief payload shape | API drift | Compile-time rejection of any consumer relying on the old shape; the shape pin fails | unit test in `novel/claude-handoff-spec/src/delegation.test.ts` pins `DelegationBrief` / `DelegationResult` / `DelegationShape` / `DelegationVerdict` via `expectTypeOf` + conforming-literal assertions |
| 2 | A coordinator delegates to a `taskId` already on the delegation path | cycle / re-delegation storm | The `visited` chain makes the cycle visible to the coordinator, which refuses the delegation | the `DelegationContract — cycle guard` test asserts `visited.includes(next)` is `true` for a repeated id and `false` for a fresh one |
| 3 | A non-JSON value sneaks into a brief via a `JSON.parse`'d boundary | upstream-malformed | The type system constrains the contract at compile time; a JSON edge is the consumer's responsibility to validate | the round-trip assertion in the `DelegationBrief` test fixture asserts JSON-stability; runtime consumers parsing JSON must validate before constructing a contract |

There is no I/O on this code path, so most failure modes are categorically
absent. The remaining surface is the type boundary, enforced by `strict` +
`verbatimModuleSyntax` + `noUncheckedIndexedAccess` in `tsconfig.base.json`.

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a type-only `DelegationContract` extracted from the two
  researched delegation shapes gives M2's `multi-persona-pipeline-handoff-spec` a
  deterministic, lintable handoff substrate without vendoring either vendor's
  LLM-coordination runtime.
- **Success threshold**: `pnpm typecheck && pnpm test` exit 0 with the contract
  shape pinned by ≥5 paired-test assertions; `research/delegation-patterns-comparison.md`
  has ≥4 level-2 (`##`) sections answering the 4 delegation questions for both vendors.
- **Pivot threshold**: if M2 use shows both delegation shapes require LLM-driven
  coordination that cannot be deterministically gated, the contract collapses to
  **deterministic handoff via TASKS.md sub-tasks** — the `brief` is already
  TASKS.md-block-shaped, so the pivot is a format-preserving collapse, not a
  rewrite (documented in the research file's recommendation section).
- **Measurement**: `pnpm typecheck && pnpm test` for the package;
  `grep -c "^## " research/delegation-patterns-comparison.md` ≥ 4.
- **Literature anchor**: rule #1 (don't reinvent — two vendors shipped this);
  Armstrong 2003 (supervisor framing); rule #10 (deterministic enforcement).

## Usage

```ts
import type {
  DelegationBrief,
  DelegationContract,
  DelegationResult,
} from "@minsky/claude-handoff-spec";

const contract: DelegationContract = {
  shape: "manager-sync",
  maxDepth: 3,
  visited: ["root-task"],
  critic: false,
};

const brief: DelegationBrief = {
  taskId: "write-migration",
  goal: "Add the v2 schema migration",
  context: ["schema lives in db/schema.sql"],
  expectedOutput: "a forward + rollback migration pair",
};
```
