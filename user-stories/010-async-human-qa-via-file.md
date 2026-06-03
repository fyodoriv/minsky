# Story 010 — Async human-and-agent Q&A via `.minsky/qa-log.md`

**Milestone(s)**: M1.6

> When the coding assistant hits a real choice, it writes the question to a file and keeps working on other tasks. You answer the file whenever you wake up. It picks up your answer within half a second and resumes.

Minsky is a background program that picks tasks from a project's to-do list and asks a coding assistant — the agent — to do them. Sometimes the agent reaches a fork in the road: two valid ways to build the same thing, and the right one depends on a judgment only you can make. Guessing risks throwing away an hour of work. Blocking until you reply wastes the night.

This story defines a third option. The agent writes its question to a plain-text file, `.minsky/qa-log.md`, then moves on to other tasks. You answer by editing the same file in any editor. The agent watches the file and, within 500 milliseconds of your save, reads your answer and continues. No meeting, no four-hour block, no daily messages.

The plain term for "the file the agent watches" is a watched file: the agent registers a listener (`fs.watch`) so an edit-and-save wakes it without polling.

## Story

You are a solo developer travelling for a week. You leave Minsky running on your home Mac. Minsky is the background program; the agent is the coding assistant it drives (Claude, Devin, or a model on your own machine).

On Tuesday at 2am NYC time, the agent hits an ambiguous design choice on a refactor task. The new lockfile primitive can use `proper-lockfile`'s default 5-second retry, or a longer 30-second retry that suits this project's slower CI. The agent does not guess. It appends a question block to `.minsky/qa-log.md`:

```markdown
## Q: 2026-05-21T06:00:00Z — proper-lockfile retry interval (task: refactor-lockfile-primitive)
The new lock primitive can use proper-lockfile's default 5s retry OR a longer 30s retry.
Default suits most projects; 30s suits slower CI where contention is rare but recovery
should be patient. Which fits this project? (5s / 30s)
```

The agent pauses that one task and picks the next P0 task. It does not sit blocked on a single question. When you open your laptop at 6am PST Wednesday, a desktop notification reads "Minsky has 1 unanswered question". You open `.minsky/qa-log.md` and type your answer:

```markdown
## A: 2026-05-21T13:30:00Z — proper-lockfile retry interval
30s. CI here is slow.
```

Within 500 milliseconds the agent reads your answer and resumes the lockfile task. By 6:01am PST a draft pull request exists with your chosen retry value. The round trip cost you 90 seconds of attention.

## Acceptance criteria

- **Agent side**: `await askHuman(question, { taskId, timeoutMs })` appends a `## Q:` block to `.minsky/qa-log.md`, then returns the operator's answer string once a matching `## A:` block appears.
- **Human side**: editing `.minsky/qa-log.md` in any editor and saving triggers the agent's `fs.watch` listener within 500 ms or less.
- **Multi-agent safety**: when two agents (multi-host mode, where Minsky works on several repos in turn) write Q-blocks at the same time, both land cleanly via `proper-lockfile` — no interleaved bytes, no lost questions.
- **Default timeout**: 4 hours. On timeout, the agent files a `**Blocked**: waiting-for-qa-answer-<iso-ts>` entry on the originating task in `TASKS.md` (the project's plain-text to-do list) and moves on.
- The dashboard's `minsky watch` surface shows the count of unanswered questions.
- A desktop notification fires when at least one unanswered question is older than 1 hour. It is rate-limited to one push per hour to avoid spam.
- `.minsky/qa-log.md` is append-only by convention. An agent that sees an A-block matching its Q proceeds; the operator never deletes existing entries, so history is preserved.
- A sibling `.minsky/qa-log.jsonl` is written alongside for structured agent reads (Q and A pairs as JSON lines for easy parsing). The Markdown is the human-facing surface.
- The file lives inside the host repo's `.minsky/` directory. It is gitignored — the qa-log is per-machine state, not source.

## Metric

- **Name**: `qa_round_trip_p90`
- **Definition**: 90th-percentile latency, in seconds, from Q-block append to A-block detection, measured over Q/A pairs in the trailing 30 days. Outliers of 4 hours or more are floored at the timeout value (4h × 3600 = 14400s) for the percentile computation.
- **Threshold**: 14400s (4h) or less at p90; 1800s (30 min) or less at p50 for active operators (operators with at least 1 Q/A in the trailing 7 days).
- **Source**: the `Observability` adapter parsing `.minsky/qa-log.jsonl` for Q-timestamp and matching-A-timestamp pairs. An adapter is a small wrapper that lets Minsky read one outside format through a fixed interface.

## Integration test

- **File**: `user-stories/010-async-human-qa-via-file.test.ts` (new; ships in the same PR as this story).
- **Setup**:
  - Tmp repo at `test/fixtures/qa-log/` with an empty `.minsky/qa-log.md`.
  - `askHuman` mocked at the import boundary so the test can drive both sides synchronously.
  - `fs.watch` instrumented via vitest's fake timers.
- **Action**: in parallel,
  - Agent task: `askHuman("test question", { taskId: "test-task", timeoutMs: 60_000 })`.
  - Human task (separate vitest async block): after 250 ms, append a `## A:` block to the file.
- **Assert**:
  - Within 500 ms of the human-side append, the agent-side `askHuman` resolves with the answer string.
  - `.minsky/qa-log.md` contains both the Q and A blocks with timestamps.
  - `.minsky/qa-log.jsonl` contains 2 JSON lines: `{type:"Q", taskId, ts, body}` and `{type:"A", ts, body, replyToQ}`.
  - Round-trip latency is recorded in the iteration log (`qa_round_trip_ms=<n>`).
  - Concurrent Q-writes: 2 `askHuman` calls within 10 ms; assert both Q-blocks land intact (no interleaving) and answer-resolution stays 1:1.
  - Timeout: `askHuman("timeout test", { timeoutMs: 250 })` resolves to a `TIMEOUT` sentinel after 250 ms and files a `**Blocked**: waiting-for-qa-answer-<ts>` entry in the fixture's `TASKS.md`.

## Proof

- **Live**: the dashboard's `minsky watch` shows the unanswered-question count.
- **Dashboard**: a per-week chart of Q/A round-trip p90 plus the total Q-count.
- **Audit**: `.minsky/qa-log.md` is the human-readable audit log; `.minsky/qa-log.jsonl` is the machine-parseable log.
- **Notification**: a desktop ntfy push when at least one unanswered Q is older than 1 hour (rate-limited to 1 per hour).

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7) — the numbered, non-negotiable project rules.

- **Steady-state hypothesis**: every agent-side `askHuman` call resolves within `timeoutMs` (default 4h) to either an answer string or a `TIMEOUT` sentinel plus a Blocked-marker filing. No leaked file watchers; no hung promises.
- **Blast radius**: a single task. If the qa-log channel fails (filesystem unavailable, lock contention forever), the failing task hits the timeout and files its `Blocked` marker; the loop continues with other tasks.
- **Operator escape hatch**: set `MINSKY_QA_LOG=off` in `~/.minsky/config.json` to disable the channel (agents fall back to the legacy `**Blocked**: needs-user-approval` marker pattern). Or delete `.minsky/qa-log.md` to reset — the agent re-creates it on the next Q.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Human answers with garbled Markdown (no matching A-block format) | upstream-malformed | `graceful-degrade` — agent ignores the malformed A, keeps waiting until a valid A appears or timeout | Inject malformed A-block; assert `askHuman` keeps polling; assert eventual valid A resolves |
| 2 | Two agents in multi-host mode write Q-blocks within 10 ms | concurrency | `graceful-degrade` — both Q-blocks land via `proper-lockfile` | Spawn 2 askHuman calls; assert both Q-blocks intact in the file |
| 3 | Human deletes the qa-log.md mid-conversation | operator action | `loud-crash-supervisor-restart` — agent's fs.watch fires with `rename`; agent re-creates the file and re-emits its pending Q | Delete the file mid-test; assert agent recovers |
| 4 | `fs.watch` produces spurious events (macOS APFS quirk) | platform | `graceful-degrade` — agent debounces (50 ms debounce window) | Trigger 100 spurious events; assert only 1 answer-resolution per real A-block |
| 5 | Agent timeout fires (4h) | operator absence | `circuit-break-and-notify` — file `**Blocked**: waiting-for-qa-answer-<ts>` on the originating task in TASKS.md; agent moves on | Set timeout=250 ms in test; assert timeout sentinel plus Blocked-marker filing |
| 6 | qa-log.md and qa-log.jsonl drift out of sync (one file edited externally) | upstream-malformed | `loud-crash-supervisor-restart` — agent re-derives the JSONL from the Markdown on next start | Drop the JSONL; assert agent reconstructs on the next askHuman call |
| 7 | Disk full when agent tries to write Q-block | dependency upstream-error | `loud-crash-supervisor-restart` — fail the askHuman call with a clean error; the iteration's verdict reflects the failure | Fill disk; assert clean failure mode |
| 8 | Multi-line A-block (the human types a long answer with line breaks) | upstream | `graceful-degrade` — agent reads the full block until the next `## Q:` or EOF | Inject 50-line A-block; assert full answer captured |
| 9 | Conflicting A: 2 humans answer the same Q on 2 different machines syncing via Dropbox/iCloud | concurrency + operator | `graceful-degrade` — first-arriving A wins; second A is logged but ignored by the agent (the agent has already resumed) | Append 2 A-blocks to the same Q; assert agent picks the first, logs the second as `extra-A-for-resolved-Q-<ts>` (warn level) |
| 10 | Q-block written while the agent is mid-iteration (the file-watcher missed the file-create event because the watcher was not yet registered) | startup race | `graceful-degrade` — agent re-reads the file on every new task pick to catch Q-blocks that pre-dated its watcher registration | Pre-write a Q-block before agent start; assert agent reads it on the first iteration |

## Status

- **Phase**: NOT YET IMPLEMENTED. Tracked as P0 `minsky-human-comm-via-file` in `TASKS.md` (with rule-9 fields). This story is the spec the P0 task implements against. The integration test `user-stories/010-async-human-qa-via-file.test.ts` lands as a failing test (`it.todo` markers or a guarded `describe.skipIf(!process.env.MINSKY_QA_LOG_ENABLED)`) so the test suite stays green; the test activates when the P0 ships and the env flag flips on.
- **Blocking**: the P0 implementation. Sub-deliverables in the P0 body: (1) `askHuman` API in `novel/tick-loop/src/qa-log.ts`, (2) `fs.watch` listener with debouncing plus recovery, (3) lock-file safety via `proper-lockfile`, (4) JSONL sidecar writer, (5) timeout plus Blocked-marker filing path, (6) dashboard tile plus ntfy integration.
- **Theoretical anchor**: Hayes-Roth 1985 *Blackboard Architecture* (specialists write partial solutions to a shared workspace; the qa-log is a single-channel blackboard). Composed with rule #16 (default by default — the channel is on by default; opt-out via `MINSKY_QA_LOG=off`).

## Pattern conformance

- **Pattern**: Blackboard architecture (Hayes-Roth, B., "A Blackboard Architecture for Control", *Artificial Intelligence* 26(3) 1985 — specialists write partial solutions to a shared workspace, a controller decides who acts next; here the human is the controller, the agent is the specialist, the qa-log is the workspace). Composed with append-only event sourcing (Kleppmann *Designing Data-Intensive Applications* 2017 Ch. 11 — the log is the source of truth, derived projections are rebuildable).
- **Conformance level**: aspirational (not yet implemented; full conformance once the P0 ships and the integration test goes green).
- **Index row**: vision.md § "Pattern conformance index" — row TBD, to be added in the P0 PR that ships the implementation.

## Security & privacy

(Per vision.md rule #13, security and privacy.)

- **Trust boundary**: the human writes A-blocks to a file under their direct control. The agent reads the file and acts on the answer. Trust flows human → file → agent. The file path (`.minsky/qa-log.md`) is gitignored — answers never leak into commits.
- **Secrets**: the qa-log is per-machine state, gitignored. If the operator pastes a secret into an A-block, `scripts/scan-secrets.mjs` running on the next commit catches it as a separate failure mode — but the channel itself does not push qa-log content anywhere.
- **PII**: the operator owns the file; PII in their answers stays local.
- **Sandbox**: the channel only reads and writes `.minsky/qa-log.md` and its `.jsonl` sidecar inside the host repo's gitignored `.minsky/` directory. It does not touch source files, run commands, or reach the network.
- **Performance carve-out**: `fs.watch` is event-driven (effectively zero polling cost). If the macOS APFS quirk produces spurious events (chaos row 4), the debounce caps the agent-side wakeup rate at 20/sec — well below any meaningful cost. No security-versus-performance trade-off.
