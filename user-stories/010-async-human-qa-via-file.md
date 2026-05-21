# Story 010 — Async human↔agent Q&A via `.minsky/qa-log.md`

> **Why this story exists.** Motivation bullet #7 in [README.md § "Why Minsky?"](../README.md#why-minsky): *"'let me know if you have questions' is a useless contract with an agent in another timezone"*. The operator-facing promise: agents drop questions into `.minsky/qa-log.md`, humans answer by editing the file, the agent picks up the answer via `fs.watch` and continues. No sync meeting, no 4-hour-blocked iteration, no daily DMs.

## Story

As a solo developer travelling for a week, I leave Minsky running on my home Mac. On Tuesday at 2am NYC time, the daemon hits an ambiguous design choice on a refactor task — should the new lockfile primitive use `proper-lockfile`'s default 5s retry, or the longer 30s retry that suits this project's slower CI? The agent doesn't guess. It appends to `.minsky/qa-log.md`:

```markdown
## Q: 2026-05-21T06:00:00Z — proper-lockfile retry interval (task: refactor-lockfile-primitive)
The new lock primitive can use proper-lockfile's default 5s retry OR a longer 30s retry.
Default suits most projects; 30s suits slower CI where contention is rare but recovery
should be patient. Which fits this project? (5s / 30s)
```

The agent pauses this task and continues with the next P0 (it doesn't wait blocked-on-one-question — it picks another task). When I open my laptop at 6am PST Wednesday, a desktop notification reads "Minsky has 1 unanswered question". I open `.minsky/qa-log.md`, type my answer:

```markdown
## A: 2026-05-21T13:30:00Z — proper-lockfile retry interval
30s. CI here is slow.
```

Within 500ms (via `fs.watch`), the agent picks up the answer and resumes the lockfile task. By 6:01am PST, a draft PR exists with my chosen retry value. The whole round trip cost me 90 seconds of attention.

## Acceptance criteria

- Agent-side: `await askHuman(question, { taskId, timeoutMs })` appends a `## Q:` block to `.minsky/qa-log.md` AND returns the operator's answer string once a matching `## A:` block appears
- Human-side: editing `.minsky/qa-log.md` in any editor + saving triggers the agent's `fs.watch` listener within ≤500 ms
- Multi-agent safety: when 2 agents (multi-host mode) write Q-blocks concurrently, both land cleanly via `proper-lockfile` (no interleaved bytes, no lost questions)
- Default timeout: 4 hours. On timeout, the agent files a `**Blocked**: waiting-for-qa-answer-<iso-ts>` entry on the originating task in TASKS.md and moves on
- The dashboard's `minsky watch` surface shows the count of unanswered questions
- A desktop notification fires when ≥1 unanswered question is older than 1 hour (rate-limited to one push per hour to avoid spam)
- `.minsky/qa-log.md` is append-only by convention; an agent that observes an A-block matching its Q proceeds; the operator never deletes existing entries (history is preserved)
- A sibling `.minsky/qa-log.jsonl` is written alongside for structured agent reads (Q and A pairs as JSON lines for easy parsing); the Markdown is the human-facing surface
- The file lives inside the host repo's `.minsky/` directory (gitignored — the qa log is per-machine state, not source)

## Metric

- **Name**: `qa_round_trip_p90`
- **Definition**: 90th percentile latency (in seconds) from Q-block append to A-block detect, measured over Q/A pairs in the trailing 30 days. Outliers ≥4h are floored at the timeout value (4h × 3600 = 14400s) for percentile computation.
- **Threshold**: ≤14400s (4h) at p90, ≤1800s (30 min) at p50 for active operators (operators with ≥1 Q/A in the trailing 7d)
- **Source**: `Observability` adapter parsing `.minsky/qa-log.jsonl` for Q-timestamp and matching-A-timestamp pairs

## Integration test

- **File**: `user-stories/010-async-human-qa-via-file.test.ts` (new; ships in the same PR as this story)
- **Setup**:
  - Tmp repo at `test/fixtures/qa-log/` with an empty `.minsky/qa-log.md`
  - `askHuman` API mocked at the import boundary so the test can drive both sides synchronously
  - `fs.watch` instrumented via vitest's fake-timers
- **Action**: in parallel,
  - Agent task: `askHuman("test question", { taskId: "test-task", timeoutMs: 60_000 })`
  - Human task (separate vitest async block): after 250 ms, append `## A:` block to the file
- **Assert**:
  - Within 500 ms of the human-side append, the agent-side `askHuman` resolves with the answer string
  - `.minsky/qa-log.md` contains both the Q and A blocks with timestamps
  - `.minsky/qa-log.jsonl` contains 2 JSON lines: `{type:"Q", taskId, ts, body}` and `{type:"A", ts, body, replyToQ}`
  - Round-trip latency recorded in the iteration log (`qa_round_trip_ms=<n>`)
  - Concurrent Q-writes test: 2 `askHuman` calls within 10 ms; assert both Q-blocks land intact (no interleaving) and answer-resolution stays 1:1
  - Timeout test: `askHuman("timeout test", { timeoutMs: 250 })` resolves to a `TIMEOUT` sentinel after 250 ms AND files a `**Blocked**: waiting-for-qa-answer-<ts>` entry in the fixture's TASKS.md

## Proof

- **Live**: the dashboard's `minsky watch` shows the unanswered-question count
- **Dashboard**: per-week chart of Q/A round-trip p90 + total Q-count
- **Audit**: `.minsky/qa-log.md` is the human-readable audit log; `.minsky/qa-log.jsonl` is the machine-parseable log
- **Notification**: desktop ntfy push when ≥1 unanswered Q is older than 1 hour (rate-limited 1/hour)

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: every agent-side `askHuman` call resolves within `timeoutMs` (default 4h) to either an answer string OR a `TIMEOUT` sentinel + Blocked-marker filing. No leaked file watchers; no hung promises.
- **Blast radius**: a single task. If the qa-log channel fails (filesystem unavailable, lock contention forever), the failing task hits the timeout and files its `Blocked` marker; the loop continues with other tasks.
- **Operator escape hatch**: set `MINSKY_QA_LOG=off` in `~/.minsky/config.json` to disable the channel (agents fall back to the legacy `**Blocked**: needs-user-approval` marker pattern). Or: delete `.minsky/qa-log.md` to reset (the agent re-creates on next Q).

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Human answers with garbled Markdown (no matching A-block format) | upstream-malformed | `graceful-degrade` — agent ignores malformed A, keeps waiting until a valid A appears OR timeout | Inject malformed A-block; assert `askHuman` keeps polling; assert eventual valid A resolves |
| 2 | Two agents in multi-host mode write Q-blocks within 10ms | concurrency | `graceful-degrade` — both Q-blocks land via `proper-lockfile` | Spawn 2 askHuman calls; assert both Q-blocks intact in the file |
| 3 | Human deletes the qa-log.md mid-conversation | operator action | `loud-crash-supervisor-restart` — agent's fs.watch fires with `rename`; agent re-creates the file and re-emits its pending Q | Delete the file mid-test; assert agent recovers |
| 4 | `fs.watch` produces spurious events (macOS APFS quirk) | platform | `graceful-degrade` — agent debounces (50ms debounce window) | Trigger 100 spurious events; assert only 1 answer-resolution per real A-block |
| 5 | Agent timeout fires (4h) | operator absence | `circuit-break-and-notify` — file `**Blocked**: waiting-for-qa-answer-<ts>` on the originating task in TASKS.md; agent moves on | Set timeout=250 ms in test; assert timeout sentinel + Blocked-marker filing |
| 6 | qa-log.md and qa-log.jsonl drift out of sync (one file edited externally) | upstream-malformed | `loud-crash-supervisor-restart` — agent re-derives the JSONL from the Markdown on next start | Drop the JSONL; assert agent reconstructs on the next askHuman call |
| 7 | Disk full when agent tries to write Q-block | dependency upstream-error | `loud-crash-supervisor-restart` — fail the askHuman call with a clean error; the iteration's verdict reflects the failure | Fill disk; assert clean failure mode |
| 8 | Multi-line A-block (the human types a long answer with line breaks) | upstream | `graceful-degrade` — agent reads the full block until the next `## Q:` or EOF | Inject 50-line A-block; assert full answer captured |
| 9 | Conflicting A: 2 humans answer the same Q on 2 different machines syncing via Dropbox/iCloud | concurrency + operator | `graceful-degrade` — first-arriving A wins; second A is logged but ignored by the agent (the agent has already resumed) | Append 2 A-blocks to the same Q; assert agent picks the first, logs the second as `extra-A-for-resolved-Q-<ts>` (warn level) |
| 10 | Q-block written while the agent is in the middle of another iteration (the agent file-watcher missed the file-create event because watcher wasn't yet registered) | startup race | `graceful-degrade` — agent re-reads the file on every new task pick to catch any Q-blocks that pre-dated its watcher registration | Pre-write a Q-block before agent start; assert agent reads it on first iteration |

## Status

- **Phase**: NOT YET IMPLEMENTED. Tracked as P0 `minsky-human-comm-via-file` in `TASKS.md` (with rule-9 fields). This story is the spec the P0 task implements against. The integration test `user-stories/010-async-human-qa-via-file.test.ts` lands as a failing test (`it.todo` markers or a guarded `describe.skipIf(!process.env.MINSKY_QA_LOG_ENABLED)`) so the test suite remains green; the test activates when the P0 ships and the env flag flips on.
- **Blocking**: the P0 implementation. Sub-deliverables in the P0 body: (1) `askHuman` API in `novel/tick-loop/src/qa-log.ts`, (2) `fs.watch` listener with debouncing + recovery, (3) lock-file safety via `proper-lockfile`, (4) JSONL sidecar writer, (5) timeout + Blocked-marker filing path, (6) dashboard tile + ntfy integration.
- **Theoretical anchor**: Hayes-Roth 1985 *Blackboard Architecture* (specialists write partial solutions to a shared workspace; the qa-log is a single-channel blackboard). Composed with rule #16 (default by default — the channel is on by default; opt-out via `MINSKY_QA_LOG=off`).

## Pattern conformance

- **Pattern**: Blackboard architecture (Hayes-Roth, B., "A Blackboard Architecture for Control", *Artificial Intelligence* 26(3) 1985 — specialists write partial solutions to a shared workspace, a controller decides who acts next; here the human IS the controller, the agent IS the specialist, the qa-log IS the workspace). Composed with append-only event sourcing (Kleppmann *Designing Data-Intensive Applications* 2017 Ch. 11 — the log is the source of truth, derived projections are rebuildable).
- **Conformance level**: aspirational (not yet implemented; full conformance once the P0 ships and the integration test goes green)
- **Index row**: vision.md § "Pattern conformance index" — row TBD, to be added in the P0 PR that ships the implementation.

## Security & privacy

(Per vision.md rule #13.)

- **Trust boundary**: the human writes A-blocks to a file under their direct control. The agent reads the file and acts on the answer. Trust flows: human → file → agent. The file path (`.minsky/qa-log.md`) is gitignored — answers never leak into commits.
- **Secrets**: the qa-log is per-machine state, gitignored. If the operator pastes a secret into an A-block, `scripts/scan-secrets.mjs` running on next commit catches it as a separate failure mode — but the channel itself doesn't push qa-log content anywhere.
- **PII**: the operator owns the file; PII in their answers stays local.
- **Performance carve-out**: `fs.watch` is event-driven (effectively zero polling cost). If the macOS APFS quirk produces spurious events (chaos row 4), the debounce caps the agent-side wakeup rate at 20/sec — well below any meaningful cost. No security-vs-performance trade-off.
