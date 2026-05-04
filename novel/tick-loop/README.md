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

## Daemon (v0, dry-run only)

`runDaemon(opts)` (in `src/daemon.ts`) is the production daemon orchestrator that the supervisor (systemd / launchd) actually supervises. v0 ships **dry-run only** — passing `dryRun: false` throws. Real subprocess spawning (`child_process.spawn('claude', …)`) is deferred to the follow-up `tick-loop-daemon-real-spawn` per the parent task's pre-registered scope guard.

The bash bootstrap `distribution/systemd/run-tick-loop.sh` `exec`s into `node novel/tick-loop/bin/tick-loop.mjs --dry-run …` so the OS supervisor sees the node PID directly. The CLI is the I/O boundary; `runDaemon` itself is pure given the injected seams (`tasksMdReader`, `pausedSentinelReader`, `budgetGuard`, `mockClient`, `now`, `sleep`, `emit`).

Run a 4-iteration dry-run:

```sh
bash distribution/systemd/run-tick-loop.sh --max-iterations=4 --tick-interval-ms=10
```

Architecture:

- `runDaemon` — the I/O orchestrator. Delegates to `runOneIteration` (PAUSED check → TASKS.md read → budget check → pick) and `runClaimedIteration` (claim → dry-run spawn → complete) so each step is independently testable and the cognitive-complexity cap holds (rule #6, biome ≤10).
- `pickTask` — pure parser; returns the first unblocked unclaimed P0/P1 task ID from a TASKS.md source string.
- `claim` — pure helper that returns the lease shape `{ taskId, leasedBy: '@minsky-tick-loop' }`. v0 is in-memory only; persistence to TASKS.md is the documented follow-up.
- `spawnTickDryRun` — the dry-run spawn step that calls the existing `tick(...)` with the injected `MockAnthropicClient`. v0's only spawn path.

### Daemon failure modes

The daemon extends the parent table above with three v0 rows:

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 6 | `state/PAUSED` sentinel present | operator-pause (operator escape hatch — Beyer SRE 2016 Ch. 17) | iteration short-circuits with `status: 'paused'`; loop continues so resume is automatic when sentinel disappears | `honors state/PAUSED sentinel within 1 iteration` test in `novel/tick-loop/src/daemon.test.ts` |
| 7 | TASKS.md missing (ENOENT) | resource-absent (file-not-found) | one `status: 'missing-tasks-md'` iteration, then loop exits with `stoppedReason: 'missing-tasks-md'`; rule-6: handled-locally — graceful-exit at the read boundary; other read errors propagate up to the supervisor | `graceful exit on missing TASKS.md (ENOENT)` test in `novel/tick-loop/src/daemon.test.ts` |
| 8 | Budget-guard circuit-break (`action: 'circuit-break-and-notify'`) | error-budget-exhaustion (Beyer SRE 2016 Ch. 3) | iteration short-circuits with `status: 'budget-paused'` and `reason` containing the budget-guard's diagnostic; loop continues so the daemon resumes when the 5h window rolls over | `budget-guard circuit-break skips iteration with logged advisory` test in `novel/tick-loop/src/daemon.test.ts` |

Each row carries a deterministic vitest assertion in `novel/tick-loop/src/daemon.test.ts`. The 13 paired daemon tests run in <1 s on any CI runner.

### SpawnStrategy seam (sub-task 1/3 of `tick-loop-daemon-real-spawn`)

`novel/tick-loop/src/spawn-strategy.ts` introduces the `SpawnStrategy` interface (rule #2 adapter pattern, Wirfs-Brock & McKean 2003) — the seam test-mode + production-mode share for the per-iteration spawn step. Two v0 implementations:

- **`DryRunSpawnStrategy`** — synthetic, mirrors v0's existing dry-run output. Production stays defaulted to this (no Strategy injected → `runDaemon` falls back to the legacy `tick(...)` path, so all 13 daemon tests pass UNCHANGED).
- **`ProcessSpawnStrategy`** — `node:child_process.spawn` with the brief written to stdin, last-4KB stdout/stderr tails captured (bounded log capture per rule #7), and `AbortSignal` honoured. Never throws on non-zero exit; the `exitCode` surfaces in the result so the daemon's supervisor (`Restart=on-failure`) is the let-it-crash boundary (Armstrong 2007), NOT the Strategy.

The Strategy is reachable via `runDaemon`'s optional `spawnStrategy?` opt; sub-task 3 (`tick-loop-daemon-real-spawn-flip`) flips the production default. Until then, `dryRun: false` without an injected Strategy still throws — the v0 production guardrail.
