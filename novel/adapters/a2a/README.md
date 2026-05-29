# `@minsky/a2a`

A2A (Agent-to-Agent) adapter — the interface Minsky's substrate uses to send tasks to, and stream lifecycle events from, an A2A-protocol agent. Adapter pattern (rule #2): one interface (`A2A`), one test fake (`StubA2A`), one real Strategy (`A2AOpenHands`).

## Scaffold status (2026-05-29)

`A2AOpenHands` is a **scaffold**. Its four verbs run against a deterministic in-process mock so the interface, the fake, and downstream consumers can be built and tested now; `selfTest()` returns `yellow` (scaffold present, real bridge pending) — never a false `green`. The real bridge — spawning Google's `a2a-python` SDK via `child_process` — ships when the OpenHands runtime lands, gated to **2026-06-01** per `competitors/openhands.md` and the `AGENT_MATRIX` `pendingExternalDep`. See the file header of `src/a2a.openhands.ts`.

## Pattern conformance

- **`A2A` interface** — Adapter (structural) + Strategy (behavioral) per Gamma, Helm, Johnson, Vlissides, _Design Patterns_, 1994. Conformance: full.
- **`StubA2A`** — test fake per Meszaros, _xUnit Test Patterns_, 2007 — records calls in-memory, returns fixed shapes. Conformance: full.
- **`A2AOpenHands`** — Strategy; `selfTest()` re-uses `SelfTestResult` from `@minsky/adapter-types` (leaf package per Martin, _Clean Architecture_, 2017 — acyclic dependency principle). Conformance: full (scaffold; mock bridge declared, not hidden).

## The four verbs

- `sendMessage(target, task) → taskId`
- `getTask(taskId) → A2ATask`
- `subscribeToTask(taskId) → AsyncIterable<A2ATaskEvent>`
- `listTasks(filter) → A2ATask[]`

Plus `selfTest()` for the `doctor` aggregation (`aggregateStatus()` from `@minsky/adapter-types`).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every verb returns a well-formed `A2ATask` / `A2ATaskEvent` shape, and `selfTest()` returns `yellow` (scaffold) — never a false `green` that would tell the operator a non-existent integration is healthy.
- **Blast radius**: a single adapter call. The adapter holds no shared state across calls; the mock bridge is pure.
- **Operator escape hatch**: callers swap to `StubA2A` (or any other `A2A` Strategy) without touching downstream code — the interface is the contract.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Real A2A bridge absent (pre-2026-06-01: no OpenHands runtime, no `a2a-python`) | `selfTest()` invoked before the real bridge ships | `circuit-break-and-notify` — return `yellow` with a message naming the 2026-06-01 dependency; never a false `green` | `novel/adapters/a2a/src/a2a.openhands.test.ts` "selfTest reports yellow (scaffold present, real bridge pending) — never a false green" |
| 2 | Bridge returns no task for a `getTask(id)` | bridge response missing the `task` field | `loud-crash-supervisor-restart` — `getTask` throws a named error (rule #6: the caller's supervisor decides retry vs escalate) rather than returning `undefined` as a fake task | `novel/adapters/a2a/src/a2a.openhands.test.ts` "getTask returns a well-formed A2ATask" asserts the happy path; the `=== undefined` guard throws on the fault path |
| 3 | Empty result set (no tasks / no events) | `listTasks` filter matches nothing; `subscribeToTask` stream closes immediately | `graceful-degrade` — return `[]` / yield nothing; never throw on emptiness | `novel/adapters/a2a/src/a2a.openhands.test.ts` "listTasks returns an array" + "subscribeToTask yields at least one lifecycle event" (the scaffold mock yields one; the empty case is the same code path with no rows) |
| 4 | Downstream wires the wrong implementation (real adapter where a deterministic fake is needed for a test) | a test or cold-start path needs no network | `graceful-degrade` — swap in `StubA2A`; its `selfTest()` is unconditionally `green` (no I/O) and `.calls` records the request shape | `novel/adapters/a2a/src/a2a.openhands.test.ts` "records each call in FIFO order with its args" + "selfTest is unconditionally green (no I/O)" |
| 5 | `selfTest()` itself throws (bridge spawn raises post-2026-06-01) | the real bridge's spawn/parse raises | `circuit-break-and-notify` — the `// rule-6: handled-locally` catch converts the crash into a `red` verdict so the doctor aggregation that calls it stays alive | `novel/adapters/a2a/src/a2a.openhands.test.ts` asserts the `yellow`/`red` selfTest contract; the catch is exercised once the real bridge can fault |
