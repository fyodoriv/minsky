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

## Post-task CTO audit (rule #9 — compounding self-improvement)

After every successfully completed iteration that shipped real change (commit on the branch OR PR opened), the daemon can fire one extra `claude --print` invocation in CTO-mode to identify the next highest-leverage task and file it as a TASKS.md block. The substrate ships in `src/post-task-cto-audit.ts` — a pure brief builder + gate (no I/O); the daemon wire-in lands in a follow-up. The CTO-mode prompt header is data (the `CTO_PROMPT_HEADER` constant), tested verbatim, so brief drift surfaces in tests rather than silently in production. Disable per-iteration via `MINSKY_CTO_AUDIT=off`.

## Daemon brief (anti-noop guard)

The daemon's spawn-step receives a brief built by `buildDaemonBrief({taskId, tasksMdContent})` (pure function in `src/daemon.ts`, replacing the earlier `"daemon brief for ${taskId}"` placeholder). The brief embeds the picked task's TASKS.md block via `extractTaskBlock` plus an iteration directive that explicitly forbids 1-line "brief refresh" PRs (the noop pattern observed on supervisor iterations 87-93 of `cross-repo-ci-action`, 2026-05-05). When claude --print cannot ship a meaningful code change, the directive instructs it to output `noop, exiting` to stdout and skip the PR. Pure substrate; tested in `daemon.test.ts` (5 tests for `extractTaskBlock` + 4 for `buildDaemonBrief`).

## Relationship to `config/tick-loop.json` (the real tick-loop's backoff ladder)

The `scripts/check-tick-loop-backoff-schedule.mjs` lint gates a future `config/tick-loop.json` artefact whose `backoff_schedule` matches `ARCHITECTURE.md` L215's `5s → 30s → 5min` prose anchor. That config governs the *real* (non-mock) tick-loop's supervisor-respawn cadence — a different concern from this package, which is the in-process mock daemon for the smoke. The naming overlap is intentional: this mock daemon is the unit the real tick-loop's chaos-verification harness will exercise once the config-driven loop ships. The mock uses defaults (no config file) and exposes `budgetMs` + `maxTicks` directly via `SmokeOpts`.

## Chaos verification

For chaos verification, instantiate the fake with a `failureMode`:

```ts
const flaky = new TestFakeMockAnthropic({ failureMode: "http-5xx" });
const result = await tick({ taskId: "x", prompt: "y", client: flaky });
// result.status === 'failed'
```

## Daemon (real spawn after `tick-loop-daemon-real-spawn-flip`)

`runDaemon(opts)` (in `src/daemon.ts`) is the production daemon orchestrator that the supervisor (systemd / launchd) actually supervises. After sub-task 3/3 (`tick-loop-daemon-real-spawn-flip`), the production default is `ProcessSpawnStrategy` (real `claude --print` headless subprocess per iteration — brief on stdin, response on stdout per Claude Code's documented non-interactive flag; the earlier `--resume` default opened the interactive session picker and was fixed by `tick-loop-spawn-args-fresh-session`); dry-run is opt-in via the `MINSKY_TICK_DRY_RUN=1` env-var control surface.

The bash bootstrap `distribution/systemd/run-tick-loop.sh` `exec`s into `node novel/tick-loop/bin/tick-loop.mjs …` so the OS supervisor sees the node PID directly. The CLI reads `MINSKY_TICK_DRY_RUN` and picks `DryRunSpawnStrategy` (when `1` / `true`) or `ProcessSpawnStrategy` (default — real spawn). The CLI is the I/O boundary; `runDaemon` itself is pure given the injected seams (`tasksMdReader`, `pausedSentinelReader`, `budgetGuard`, `spawnStrategy`, `mockClient`, `now`, `sleep`, `emit`).

Run a 4-iteration tick (real spawn — requires `claude` on PATH):

```sh
bash distribution/systemd/run-tick-loop.sh --max-iterations=4 --tick-interval-ms=10
```

Run a 4-iteration dry-run (no subprocess fork — safe on any host):

```sh
MINSKY_TICK_DRY_RUN=1 bash distribution/systemd/run-tick-loop.sh --max-iterations=4 --tick-interval-ms=10
```

The supervisor unit files (`distribution/systemd/minsky-tick-loop.service`, `distribution/launchd/com.minsky.tick-loop.plist`) ship with `MINSKY_TICK_DRY_RUN=1` set during the safe rollout window. An operator drops that line / dict entry to flip to full real spawn — the production default is unset.

Architecture:

- `runDaemon` — the I/O orchestrator. Delegates to `runOneIteration` (PAUSED check → TASKS.md read → budget check → pick) and `runClaimedIteration` (claim → dry-run spawn → complete) so each step is independently testable and the cognitive-complexity cap holds (rule #6, biome ≤10).
- `pickTask` — pure parser; returns the first unblocked unclaimed P0/P1 task ID from a TASKS.md source string. A task is treated as blocked (and skipped) when its block contains either `**Blocked by**: <id>` (dependency blocker) OR `**Blocked**: <reason>` (external-constraint blocker — the operator's escape hatch per Beyer SRE 2016 Ch. 17, used for blocked-by-default actions like `needs-user-approval`). Both spellings are honored as of `tick-loop-picktask-honors-blocked-field` (closed PR landed 2026-05-04).
- `claim` — pure helper that returns the lease shape `{ taskId, leasedBy: '@minsky-tick-loop' }`. v0 is in-memory only; persistence to TASKS.md is the documented follow-up.
- `spawnTickDryRun` — the dry-run spawn step that calls the existing `tick(...)` with the injected `MockAnthropicClient`. v0's only spawn path.
- `notifier?: NotifierLike` — optional push-notification seam (rule #2, Gamma 1994 Adapter pattern). When injected, the daemon fires exactly one `push` per *transition* into `budget-paused` — debounced across consecutive paused iterations so the operator gets one Ntfy push per event, not one per tick. Recovery (any non-budget-paused status) re-arms the trigger; the next budget-paused transition fires a fresh push. `null` (default) disables the channel — the daemon still records the budget-paused span. Surfaced by `daemon-budget-pause-observability` (the first 2h live-on-itself run on 2026-05-04 needed `tail -f` to see budget-pause; with this seam wired, the operator's wrist sees it). Pairs with the `pauseReason: "operator" | "budget" | null` field on `/watch.json`'s envelope.

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

The Strategy is reachable via `runDaemon`'s optional `spawnStrategy?` opt; sub-task 3 (`tick-loop-daemon-real-spawn-flip`) **flipped the production default** so `bin/tick-loop.mjs` now constructs `ProcessSpawnStrategy` by default and `DryRunSpawnStrategy` when `MINSKY_TICK_DRY_RUN=1` is set. The v0 production guardrail (`dryRun: false` without an injected Strategy throws) is preserved — the CLI always injects a Strategy, but a misconfigured caller of `runDaemon` directly still hits the throw.

### Real `BudgetGuard` facade (sub-task 2/3 of `tick-loop-daemon-real-spawn`)

`novel/tick-loop/src/budget-guard-facade.ts` ships `fromRealBudgetGuard(guard)` — a thin Adapter (Gamma 1994) that wraps the real `BudgetGuard` from `@minsky/budget-guard` (whose public surface is `tick(): Promise<BudgetDecision>` per the watchdog idiom — Beyer SRE 2016 Ch. 3) behind the daemon's structural `BudgetGuardLike.decide()` shape. This is the **Pivot path** pre-registered in the task block: the real `BudgetGuard` exposes `tick()` rather than `decide()`, so the facade is the one-line bridge that keeps rule #2 intact (the daemon depends on the structural type, not on `@minsky/budget-guard` itself).

`bin/tick-loop.mjs` constructs the real `BudgetGuard` from a `MaciekTokenMonitor` (production — reads `~/.claude/projects/<cwd>/<session>.jsonl`, the same data Maciek's `claude-monitor` reads) or from a `StubTokenMonitor` (when `--dry-run` — a fresh full 5h window so the local smoke stays hermetic). The daemon never imports `@minsky/budget-guard` directly; the test in `daemon.test.ts` drives the facade against a fixture `StubTokenMonitor` to assert the circuit-break (≥85 % consumed) flips the iteration to `budget-paused`, and a fresh window completes normally.

### CLI env-var control surface

The CLI in `bin/tick-loop.mjs` is the I/O boundary for three optional channels — each is opt-in via env var and graceful-degrades when unset (rule #7):

- **`MINSKY_TICK_DRY_RUN=1|true`** — opt back to `DryRunSpawnStrategy` (no real `claude` spawn). Default: real spawn via `ProcessSpawnStrategy("claude --print")` per sub-task 3/3.
- **`MINSKY_NTFY_TOPIC=<topic>`** — wires `NtfyNotifier` into `runDaemon`'s `notifier?` seam. Edge-triggered debounce fires exactly one Ntfy push per *transition* into `budget-paused` (P1 `daemon-budget-pause-observability`, shipped #113). Optional `MINSKY_NTFY_SERVER` overrides the public ntfy.sh default for self-hosted; `MINSKY_NTFY_AUTH_TOKEN` is the bearer for authenticated topics. Without `MINSKY_NTFY_TOPIC` the daemon still records the budget-paused span — it just doesn't push anywhere.
- **`MINSKY_OTEL_ENDPOINT=http://host:5080`** — wires `OtelObservability` into the `emit` callback so every `tick-loop.iteration` `TickSpan` is forwarded to the OTLP backend (OpenObserve out of the box, post-#110). Closes the publisher half of the publish-then-read MAPE-K loop (P1 `daemon-otel-pipe`). Without the env var, the daemon writes the stdout line and skips OTEL — the dashboard's `OpenObserveStrategy` reads `(stub)` because the publisher never wired up. The CLI prints a hint line on each run so the operator sees whether each channel is wired (`[tick-loop] OTEL wired (endpoint=...)` or `[tick-loop] no OTEL wired (set MINSKY_OTEL_ENDPOINT to ...)`).
