# `@minsky/tick-loop`

<!-- rule-1: an off-the-shelf mock-Anthropic harness (msw / nock / @anthropic-ai/sdk's vitest-mock helpers) rejected because: those tools mock the *transport*, not the daemon's tick cadence + supervisor-respawn semantics; we need a deterministic clock-injectable loop with a 4-mode chaos surface (5xx / network-timeout / malformed-output / lease-expiry) wired through the same OTEL sink @minsky/observability uses, so the in-process smoke is the *unit* the nightly self-hosted runner will run at full 60-min cadence (sub-task 3) — that's an integration daemon, not a transport mock, and the surface is small enough (≤4 KB src) that a workspace-local package beats the dependency-coverage cost (rule #2) of a fixture-only third-party harness. -->

Deterministic mock-tick daemon for the in-process 10-min smoke. Sub-task 2/3 of `first-integration-test` (parent tracker in `TASKS.md`).

Loops `claim → mock-anthropic-call → complete` on a configurable cadence; the test fake `TestFakeMockAnthropic` simulates 3+ chaos modes (5xx, network-timeout, malformed-output) for the supervisor-respawn boundary; OTEL spans flow through `@minsky/observability`'s sink shape (in v0 captured by `SpanRecorder` for in-process assertion).

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index):

- **Periodic-task scheduling** — Liu & Layland, "Scheduling Algorithms for Multiprogramming in a Hard Real-Time Environment", *JACM* 20 (1), 1973. The cadence model (N ticks within a wall-clock budget) is the classic periodic-task envelope: each tick has its own deadline; the loop halts at budget-exhaustion. **Conformance: full.**
- **Let-it-crash supervision** — Armstrong, *Programming Erlang*, Pragmatic Bookshelf, 2007. The mock client's chaos branches return failure shapes rather than throw; the supervisor (the caller of `runSmoke`) decides the respawn policy. The mock-client rejection path is mapped to a structured `status: 'failed'` at the `tick` boundary — let it crash AT the right boundary, not at the wrong one. **Conformance: full.**
- **Adapter (seam)** — Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994. `MockAnthropicClient` is the interface; `TestFakeMockAnthropic` is one implementation; production code will plug a real Anthropic-SDK adapter behind the same shape. **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every tick produces a `TickResult` with `status` ∈ `{completed, failed}` and emits exactly one span; the smoke runs N ≤ `maxTicks` ticks within `budgetMs` and reports `budgetExhausted: true` only when the wall-clock check halts the loop early.
- **Blast radius**: a single tick / a single smoke run. The daemon never spawns child processes (in-process only); the only side-effect surface is the optional `emit` sink.
- **Operator escape hatch**: `runSmoke` halts on budget-exhaustion or `maxTicks`; either bound is the kill-switch. The mock client interface is the only wire to the outside; replacing the test fake with a real Anthropic-SDK adapter is a one-line swap.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Mock-anthropic returns 5xx (`failureMode: 'http-5xx'`) | upstream-error (transient) | `tick` returns `status: 'failed'` with `output` containing `5xx`; supervisor (caller) sees a real respawn signal | covered by `tick respects mock-anthropic 5xx` test in `novel/tick-loop/src/index.test.ts` |
| 2 | Lease expiry mid-tick — mock client rejects with `Error('lease-expired')` | upstream-rejection (process-state) | `tick` catches at the boundary and returns `status: 'failed'` with `output: 'mock-client-rejected: lease-expired'`; never throws (Armstrong 2007 — let it crash AT the right boundary) | covered by `maps client rejection to status: 'failed' without throwing` test in `novel/tick-loop/src/index.test.ts` |
| 3 | Malformed-output (`failureMode: 'malformed-output'`) — 200 OK with garbage body | upstream-malformed | `tick` reports `status: 'completed'` (transport said 200 OK), but `output` is `<<<MALFORMED>>>`; downstream code MUST validate — rule #6: don't trust upstream | covered by `malformed-output mode returns success status with garbage payload` test fixture in `novel/tick-loop/src/index.test.ts` |
| 4 | Network-timeout (`failureMode: 'network-timeout'`) — delayed rejection | upstream-error (latency) | `tick` returns `status: 'failed'` with `output: 'network-timeout for task=…'` after the configured delay | covered manually by the network-timeout fixture in `TestFakeMockAnthropic`; assertion-level chaos test deferred until the fake's timeoutMs path drives a real fault-injection scenario |
| 5 | Wall-clock budget exhausted mid-smoke | resource-exhaustion (time) | `runSmoke` halts before the next tick fires; `budgetExhausted: true`; partial results returned (graceful degrade per rule #7) | covered by `halts when wall-clock budget is exhausted` test in `novel/tick-loop/src/index.test.ts` |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a deterministic mock-tick daemon with 3+ chaos-mode mocks reproduces user-story 001's P2-task-throughput Acceptance in <10 min CI wall-clock.
- **Success threshold**: ≥4 vitest tests pass; the 4-task smoke runs within budget; ≥1 OTEL span per task; chaos table has ≥3 rows.
- **Pivot threshold**: if the 4-task budget can't fit in 10 min CI, drop to single-task smoke + multi-task on self-hosted (sub-task 3).
- **Measurement**: `pnpm vitest run novel/tick-loop --reporter=json | jq -e '.numPassedTests >= 4 and .numFailedTests == 0'` exits 0.
- **Literature anchor**: Liu & Layland, *JACM* 1973 (periodic-task scheduling); Armstrong, *Programming Erlang*, 2007 (let-it-crash supervision).

## Usage

```ts
import {
  runSmoke,
  TestFakeMockAnthropic,
  SpanRecorder,
  parseFixtureTaskIds,
} from "@minsky/tick-loop";
import { readFileSync } from "node:fs";

const fixture = readFileSync("novel/tick-loop/test/fixtures/synthetic-tasks.md", "utf-8");
const taskIds = parseFixtureTaskIds(fixture);
const client = new TestFakeMockAnthropic();
const recorder = new SpanRecorder();

const result = await runSmoke({
  client,
  taskIds,
  budgetMs: 600_000, // 10 min
  maxTicks: 4,
  emit: (e) => recorder.record(e),
});

console.log(`${result.results.length} ticks; budgetExhausted=${result.budgetExhausted}`);
console.log(`${recorder.spans.length} spans recorded`);
```

## Relationship to `config/tick-loop.json` (the real tick-loop's backoff ladder)

The `scripts/check-tick-loop-backoff-schedule.mjs` lint gates a future `config/tick-loop.json` artefact whose `backoff_schedule` matches `ARCHITECTURE.md` L215's `5s → 30s → 5min` prose anchor. That config governs the *real* (non-mock) tick-loop's supervisor-respawn cadence — a different concern from this package, which is the in-process mock daemon for the smoke. The naming overlap is intentional: this mock daemon is the unit the real tick-loop's chaos-verification harness will exercise once the config-driven loop ships. The mock uses defaults (no config file) and exposes `budgetMs` + `maxTicks` directly via `SmokeOpts`.

## Chaos verification

For chaos verification, instantiate the fake with a `failureMode`:

```ts
const flaky = new TestFakeMockAnthropic({ failureMode: "http-5xx" });
const result = await tick({ taskId: "x", prompt: "y", client: flaky });
// result.status === 'failed'
```
