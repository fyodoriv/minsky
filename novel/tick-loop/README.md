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

After every successfully completed iteration that shipped real change (commit on the branch OR PR opened), the daemon fires one extra `claude --print` invocation in CTO-mode to identify the next highest-leverage task and file it as a TASKS.md block. Substrate ships in `src/post-task-cto-audit.ts`: pure `buildCtoBrief` + `shouldRunCtoAudit` gate, plus the I/O wrapper `runCtoAudit({signals, spawn, lockPath})` with three composed seams — gate (skip when not warranted), no-recurse (CTO-mode never triggers another CTO-mode), and lock (one audit at a time per supervisor host). The CTO-mode prompt header is data (`CTO_PROMPT_HEADER` constant), tested verbatim, so brief drift surfaces in tests rather than silently in production. Disable per-iteration via `MINSKY_CTO_AUDIT=off`.

The daemon wire-in (sub-step c) is `RunDaemonOpts.ctoAudit?: CtoAuditSeam` on `runDaemon` — an opt-in object bundling `spawn`, `lock`, and `buildSignals` so the orchestrator stays free of git/gh I/O. After each iteration the loop calls `maybeRunCtoAudit`, which short-circuits when the seam is omitted or `iteration.status !== "completed"`, then dispatches into `runCtoAudit` and emits a `tick-loop.cto-audit` span describing the outcome (`ran` with `exit_code` + `duration_ms`, or `skipped` with `skip_reason`). Pre-existing supervisor daemons predating the seam keep working unchanged — the seam is opt-in, and `runDaemon` callers without `ctoAudit` see zero behaviour change. CLI-side construction (file-backed lock at `.minsky/cto-audit-lock/<taskId>` + git/gh signals collector populating `recentMainCommits` / `openWorkItems` / `prUrl` / `lintScores`) owns its own I/O surface and is intentionally a separate iteration.

### Branch + PR conventions (load-bearing for the pre-registered metric)

Every audit-spawned PR opens on a branch named `audit/<UTC-date>-<completed-task-id>` (e.g. `audit/2026-05-05-canonical-metric-list-per-repo`) and carries the label `minsky:cto-audit` (exported as `CTO_AUDIT_PR_LABEL` from `src/post-task-cto-audit.ts` and pinned by `post-task-cto-audit.test.ts` so brief drift surfaces in tests, not at measurement time). The pre-registered measurement command `gh pr list --label minsky:cto-audit ...` keys on this exact label; a missing label silently zeroes the success metric. The brief itself instructs the spawned audit to (1) idempotently `gh label create minsky:cto-audit` before the first PR if the label doesn't yet exist on the repo, and (2) pass `--label minsky:cto-audit` at `gh pr create` time so the metric sees the PR from the moment it's opened — not retroactively. The branch-name convention means the audit's lineage is grep-able from `gh pr list`: one audit per ship, encoded in the branch.

## Daily changelog (operator-readable narrative)

Once per UTC day the daemon fires a `claude --print` invocation in changelog-mode that authors a `CHANGELOG.md` section combining (a) merged PRs with summaries, (b) metric snapshots with explicit before/after Δ, (c) a one-paragraph narrative — substrate for `daily-changelog-for-humans`. The pure builder ships in `scripts/generate-changelog-entry.mjs` (`buildChangelogEntry` + `classifyDirection`, 24 paired tests); the I/O wrapper `runChangelog({today, readChangelog, spawn})` in `src/changelog-runner.ts` gates on `hasDateSection` so the same UTC date is never re-authored, and short-circuits when `MINSKY_CHANGELOG=off`.

The brief the daemon hands the spawn (`CHANGELOG_PROMPT_HEADER`) points at `pnpm changelog:today` (shipped #185 — `scripts/changelog-today.mjs`) as the canonical one-line pipeline rather than re-spelling `gh pr list` → JSON authorship → renderer-pipe inline. Rule #2 — one source of truth; the operator CLI IS the command, so brief edits don't drift from the substrate the operator already manually verifies. The `--json` shape is still available for narrative-override flows: render the JSON, edit the `narrativeOverride` field, pipe through `node scripts/generate-changelog-entry.mjs`.

The daemon wire-in is `RunDaemonOpts.changelog?: ChangelogSeam` on `runDaemon` — opt-in, mirrors the CTO-audit shape (one helper, one span, one opts field). After each iteration the loop calls `maybeRunChangelog`, which skips fast on operator-quiet states (`paused`, `budget-paused`, `missing-tasks-md`) but still fires on `failed` iterations because the cadence is per-day (PRs may merge from human work the daemon never saw). The `tick-loop.changelog` span carries `ran` (with `exit_code` + `duration_ms`) or `skipped` (with `skip_reason`). Per-iteration idempotency lives in the `shouldRunChangelog` gate inside the wrapper, so the daemon may safely call this every tick.

The metric-snapshot leg of the same task ships in `src/snapshot-runner.ts` (pure gate `shouldRunSnapshot` + `runSnapshot` I/O wrapper, 17 paired tests) and is wired into `runDaemon` through a separate `RunDaemonOpts.snapshot?: SnapshotSeam` opt — `{ capture, snapshotExists }`. The two seams share a calendar but **not a gate**: a manually-authored CHANGELOG.md must not suppress snapshot writes, otherwise day-(N+1)'s Δ rendering loses its baseline. `maybeRunSnapshot` skips on `paused` / `budget-paused` / `missing-tasks-md` but fires on `completed` and `failed` alike (the snapshot file is the per-day "this happened" record day-(N+1)'s changelog depends on). The `tick-loop.snapshot` span carries `ran` (with `exit_code` + `duration_ms`) or `skipped` (with `skip_reason` — `env-off` or `already-captured`). Production binding spawns `pnpm changelog:snapshot --date <date>` (shipped #188) wired through `createFileBackedSnapshotExists` + `createPnpmSnapshotCapture` in `src/snapshot-cli-wiring.ts` and constructed under the `MINSKY_CHANGELOG_ENABLE` umbrella in `bin/tick-loop.mjs`.

The metrics-render leg of the sibling task `canonical-metric-list-per-repo` (Acceptance (3) "daemon refreshes daily") ships in `src/metrics-render-runner.ts` (pure gate `shouldRunMetricsRender` + `runMetricsRender` I/O wrapper, 14 paired tests) and is wired into `runDaemon` through a separate `RunDaemonOpts.metricsRender?: MetricsRenderSeam` opt — `{ render, getLastRenderedDate }`. Independent of the snapshot seam: a snapshot-capture failure (gh rate-limit, network) must NOT suppress today's `METRICS.md` render — yesterday's snapshot still produces a usable file (visible-not-silent, Helland 2007). `maybeRunMetricsRender` skips on `paused` / `budget-paused` / `missing-tasks-md` but fires on `completed` and `failed` alike. The gate compares the file's mtime-formatted UTC date to `today` so exactly one render lands per UTC day across many iterations; `null` (genesis case — METRICS.md not yet authored) flows through to render. The `tick-loop.metrics-render` span carries `ran` (with `exit_code` + `duration_ms`) or `skipped` (with `skip_reason` — `env-off` or `already-rendered`). The production binding spawning `pnpm metrics:render --date <date>` (shipped slice 3/N of `canonical-metric-list-per-repo`) is wired through `createFileBackedLastRenderedDate` + `createPnpmMetricsRender` in `src/metrics-render-cli-wiring.ts` and constructed under the existing `MINSKY_CHANGELOG_ENABLE` umbrella in `bin/tick-loop.mjs` — twin of `snapshot-cli-wiring`, keeping `bin/tick-loop.mjs` thin (the bin only decides opt-in and forwards the `METRICS.md` path / repo root).

## Daemon brief (anti-noop guard)

The daemon's spawn-step receives a brief built by `buildDaemonBrief({taskId, tasksMdContent})` (pure function in `src/daemon.ts`, replacing the earlier `"daemon brief for ${taskId}"` placeholder). The brief embeds the picked task's TASKS.md block via `extractTaskBlock` plus an iteration directive that explicitly forbids 1-line "brief refresh" PRs (the noop pattern observed on supervisor iterations 87-93 of `cross-repo-ci-action`, 2026-05-05). When claude --print cannot ship a meaningful code change, the directive instructs it to output `noop, exiting` to stdout and skip the PR. Pure substrate; tested in `daemon.test.ts` (5 tests for `extractTaskBlock` + 4 for `buildDaemonBrief`).

The brief also carries a **priority-discipline gate** (operator dogfood 2026-05-05): the brief lists open `p0`-tagged tasks (via the new `extractOpenP0TaskIds` pure helper) and instructs claude to abort with `noop, exiting — priority discipline: '<picked>' is not the highest-priority unclaimed P0; should pick '<first-p0>' instead` when the picked task isn't among them. Carve-out: explicit `**Pick-next**: yes` operator override on the picked block, when no open P0 carries `Pick-next: yes`. The gate is belt-and-suspenders for the architectural picker fix filed as `daemon-priority-discipline-picktask-bug` (which teaches `pickTask` itself to consult `**Tags**:`). 7 paired tests including the literal misordering pattern, override carve-out, and claimed/blocked filters.

A third **pre-PR lint-stack gate** (slice 2 of `daemon-pre-pr-lint-gate`) mandates that the spawned `claude --print` runs `pnpm pre-pr-lint` (the canonical script in `scripts/run-pre-pr-lint-stack.mjs` — same one CI's `needs:` aggregator imports, rule #10) on its branch before invoking `gh pr create`. Failures trigger up to 3 daemon-side fix attempts (each failure is a `claude --print` retry with the failing-step name in the brief, not an operator-side cleanup PR); persistent red after 3 attempts forces `noop, exiting — pre-pr-lint-failures: <step>` instead of opening a known-red PR. Pre-registered metric (TASKS.md `daemon-pre-pr-lint-gate`): rolling 30d pass-rate ≥80% on daemon-authored PRs (vs the ~0% baseline observed across iterations 87+, where every PR needed at least one operator cleanup commit).

The brief also carries a fourth **optimization-discipline gate** (operator directive 2026-05-05) that directs claude to spend ≤30s per iteration identifying ONE measurable optimization to the daemon's own loop — eligible candidates include brief-shrinking, cached-prompt extension, skip-earlier gates, log-line dedup, and round-trip elimination. Anti-vanity guard: the optimization must be measurable in tokens, wall-time, or eliminated round-trip count; vague "cleaner code" optimizations are rejected. If no optimization is feasible this iteration, the brief requires an explicit `optimization: none-this-iteration: <reason>` line in the iteration reason — silence is failure (Beyer SRE 2016 Ch. 6). Substrate slice of `daemon-self-optimize-speed-tokens` (P0); follow-ups land per-iteration cost spans + a `daemon-iteration-cost-regression` self-diagnose invariant.

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

The CLI in `bin/tick-loop.mjs` is the I/O boundary for five optional channels — each is opt-in via env var and graceful-degrades when unset (rule #7):

- **`MINSKY_TICK_DRY_RUN=1|true`** — opt back to `DryRunSpawnStrategy` (no real `claude` spawn). Default: real spawn via `ProcessSpawnStrategy("claude --print")` per sub-task 3/3.
- **`MINSKY_NTFY_TOPIC=<topic>`** — wires `NtfyNotifier` into `runDaemon`'s `notifier?` seam. Edge-triggered debounce fires exactly one Ntfy push per *transition* into `budget-paused` (P1 `daemon-budget-pause-observability`, shipped #113). Optional `MINSKY_NTFY_SERVER` overrides the public ntfy.sh default for self-hosted; `MINSKY_NTFY_AUTH_TOKEN` is the bearer for authenticated topics. Without `MINSKY_NTFY_TOPIC` the daemon still records the budget-paused span — it just doesn't push anywhere.
- **`MINSKY_OTEL_ENDPOINT=http://host:5080`** — wires `OtelObservability` into the `emit` callback so every `tick-loop.iteration` `TickSpan` is forwarded to the OTLP backend (OpenObserve out of the box, post-#110). Closes the publisher half of the publish-then-read MAPE-K loop (P1 `daemon-otel-pipe`). Without the env var, the daemon writes the stdout line and skips OTEL — the dashboard's `OpenObserveStrategy` reads `(stub)` because the publisher never wired up. The CLI prints a hint line on each run so the operator sees whether each channel is wired (`[tick-loop] OTEL wired (endpoint=...)` or `[tick-loop] no OTEL wired (set MINSKY_OTEL_ENDPOINT to ...)`).
- **`MINSKY_CTO_AUDIT_ENABLE=1|true`** — opt in to post-task CTO audits (sub-step (d/e/f) of `post-task-cto-audit`). When set, the CLI constructs the `CtoAuditSeam` `runDaemon` expects: the daemon's existing `spawnStrategy` is reused as `CtoAuditSpawn` (structurally compatible per task spec sub-step (a)); the lock is file-backed at `<MINSKY_HOME>/.minsky/cto-audit-lock/<id>` so the cap-1-per-task contract (sub-step f) survives daemon restart; signals are collected from `git log` + `gh issue/pr list` with rule-#7 graceful-degrade (offline / rate-limit yields zero counts, not a crash). The CLI also runs an `ensureCtoAuditLabel` preflight before entering the tick loop — it idempotently `gh label create`s `minsky:cto-audit` on the current repo (outcome `created` / `exists` / `skipped-degraded` is logged as `[tick-loop] cto-audit label preflight: ...`) so the audit's first PR-create doesn't fail with "label not found" and the pre-registered measurement query (`gh pr list --label minsky:cto-audit ...`) sees audit PRs from the moment they open. **Supervisor default: ON** — both `distribution/systemd/minsky-tick-loop.service` and `distribution/launchd/com.minsky.tick-loop.plist` ship with `MINSKY_CTO_AUDIT_ENABLE=1` set so the daemon actually fires the audit after every successfully-completed iteration that shipped a real change. Without this flip the pre-registered measurement command (`gh pr list --label minsky:cto-audit ...`) returns 0 forever and the hypothesis is unfalsifiable. The audit's per-iteration gate (`shouldRunCtoAudit`) still respects `MINSKY_CTO_AUDIT=off` for ad-hoc skips even when the seam is wired; the cap-1-per-task file-backed lock + the noop-iteration gate keep the firing rate well under the rule-#9 pivot trigger of >5 audits/day. At supervisor startup the bin script also runs a `detectCtoAuditEnvDrift` comparator (in `cto-audit-cli-wiring.ts`) that reads the source plist (`distribution/launchd/com.minsky.tick-loop.plist`) and compares its `EnvironmentVariables` dict against `process.env`; the load-bearing `drift-stale-install` outcome (source enables `MINSKY_CTO_AUDIT_ENABLE=1` but the live env doesn't) is logged as a loud `[tick-loop] WARN cto-audit env drift ...` line that names the reinstall command (`pnpm dogfood:install` + `launchctl kickstart -k gui/$(id -u)/com.minsky.tick-loop`). Without this comparator, install drift between the checked-in plist and `~/Library/LaunchAgents/com.minsky.tick-loop.plist` silently zeroes the pre-registered measurement query for as long as it takes the operator to notice — PR #214's wire-status announcement only surfaces the same condition on the *next* restart, while this drift check fires at the current boot.
- **`MINSKY_CHANGELOG_ENABLE=1|true`** — opt in to the daily changelog runner (acceptance criterion (3) of `daily-changelog-for-humans`). When set, the CLI constructs the `ChangelogSeam` `runDaemon` expects: the daemon's existing `spawnStrategy` is reused as `ChangelogSpawn` (structurally compatible per task spec sub-step (a)); `readChangelog` is file-backed via `createFileBackedChangelogReader(<MINSKY_HOME>/CHANGELOG.md)` with ENOENT graceful-degrade (a fresh checkout pre-genesis still fires — the runner authors the genesis entry). The same env var ALSO opts in the per-day `SnapshotSeam`: `snapshotExists` is file-backed at `<MINSKY_HOME>/.minsky/metric-snapshots/<date>.json` (the JSON file IS the per-day "this happened" record — rule #2 data-not-code), and `capture` spawns `pnpm changelog:snapshot --date <date>` (the producer CLI shipped #188) with bounded 4 KB stdout/stderr tails (rule #7). The two seams share the umbrella because wiring the changelog author without the per-day writer is incoherent: tomorrow's Δ rendering reads the JSON `loadSnapshot` writes today, so opting in one without the other guarantees a missing baseline. **Supervisor default: ON** — both `distribution/systemd/minsky-tick-loop.service` and `distribution/launchd/com.minsky.tick-loop.plist` ship with `MINSKY_CHANGELOG_ENABLE=1` set so the daemon actually fires the daily section under the live supervisor. Both seams' per-iteration gates still respect `MINSKY_CHANGELOG=off` for ad-hoc skips; idempotency comes from the `## YYYY-MM-DD` H2 header in CHANGELOG.md (changelog leg) and the snapshot file's presence on disk (snapshot leg) — one source of truth per leg, rule #2 — so leaving the flag on across many iterations is safe by design (exactly one spawn per UTC date for each leg).
