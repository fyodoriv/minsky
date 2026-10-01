# @minsky/human-loop

<!-- scope: human-approved sub-task `human-loop-qa-log-format` of P0 `minsky-human-comm-via-file`; tsconfig is mechanical boilerplate matching @minsky/sidecar-bootstrap shape. -->

<!-- rule-1: `chokidar` (popular fs watcher) + `proper-lockfile` (atomic file locking) + `@iarna/toml` (parser) + various Markdown libs (e.g., `mdast-util-from-markdown`) all rejected because: this slice is a pure parser for a hand-rolled section-header format (`## Q:` / `## A:` lines) — a 180-LOC regex-based parser is simpler than pulling in a full Markdown AST library that would parse the entire file. Sub-task 2 (`human-loop-ask-human-and-watcher`) WILL use `proper-lockfile` per the parent task's spec. -->

Human↔agent QA channel via an append-only Markdown file at `.minsky/qa-log.md` in the host repo. Agents write `## Q:` blocks and wait for the human to append `## A:` blocks; the human edits the file in any text editor.

Slices 1+2 of P0 `minsky-human-comm-via-file` (operator directive 2026-05-20: "as simple as creating a log or xml or whatever file where you leave questions and I leave answers"). This package now ships the **pure parser/serializer** + the **async `askHuman()` API with fs.watch dedupe** — the `bin/minsky qa` CLI + brief template + docs sweep ship in subsequent slices (3+4).

## Why this exists

Today minsky communicates with humans through three weak channels:

- `**Blocked**: needs-user-approval` markers in TASKS.md task bodies (humans grep)
- Draft PRs that the human reviews (delayed)
- `daemon.log` warnings (one-way, no acknowledgement)

None support fast back-and-forth Q&A. The QA channel is the operator's "ask, wait, branch on answer" surface — the agent writes a question and gets a synchronous answer within minutes, not days.

## What ships (slices 1+2)

Slice 1 — pure parser/serializer (`./qa-log-format.ts`):

```text
import { formatQuestion, formatAnswer, parseQaLog } from "@minsky/human-loop";

const block = formatQuestion(
  "task-1",
  "claude",
  "Should I proceed with the refactor?",
  new Date().toISOString(),
);
// block === "## Q: task-1 · 2026-05-23T10:00:00Z\n**from**: claude\n**asks**: Should I proceed with the refactor?\n"

const entries = parseQaLog(fileContents);
// → QaEntry[] (flat ordered list of Q and A blocks, tolerant of human edits)
```

Slice 2 — async `askHuman()` API (`./ask-human.ts`):

```text
import { askHuman, TimeoutError } from "@minsky/human-loop";

try {
  const answer = await askHuman("Should I proceed?", {
    taskId: "task-1",
    agent: "claude",
    qaLogPath: "/path/to/host/.minsky/qa-log.md",
    timeoutMs: 4 * 3600 * 1000, // 4 hours (default)
  });
  // → "Yes, ship it." (when human appends a matching ## A: block)
} catch (err) {
  if (err instanceof TimeoutError) {
    // No answer within 4h — fall back to **Blocked**: needs-user-approval
  }
}
```

`askHuman()` appends a Q block atomically (fs.appendFile is atomic for payloads under PIPE_BUF — 4KB Linux, 512B POSIX — which a Q block fits well within), watches the qa-log with fs.watch debounced to 100ms (collapsing macOS's 2-events-per-save into one re-read), and resolves with the answer body when the human appends a matching A block whose timestamp succeeds the Q's.

## What does NOT ship yet

- `bin/minsky qa` subcommand — sub-task 3.
- `minsky watch` pending-Q count — sub-task 3.
- Brief template addition + README + vision.md row — sub-task 4.
- `proper-lockfile` integration — deferred. The `fs.appendFile` atomicity guarantee covers the parent's Success #5 contract under the spec's "or equivalent" clause; if multi-agent contention shows up under live load, file `human-loop-proper-lockfile-upgrade` as P1.

## Failure modes & chaos verification

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Malformed `## Q:` header (no separator) | upstream-malformed | `graceful-degrade` — parser skips the block, later blocks parse normally; no throw | covered by `qa-log-format.test.ts` "malformed Q header (no separator) is skipped" |
| 2 | Human edits previous Q's body (inserts text between Q and A) | upstream-malformed | `graceful-degrade` — inserted lines fall after the `**asks**:` line, get absorbed into the question body; later A block still parses | covered by `qa-log-format.test.ts` "human-inserted noise between blocks is silently dropped" |
| 3 | Orphan A block (no matching Q) | edge case | `graceful-degrade` — `askHuman` ignores A blocks whose taskId doesn't match its own | covered by `ask-human.test.ts` "ignores A blocks for other taskIds" |
| 4 | Missing `**asks**:` line on a Q block | upstream-malformed | `graceful-degrade` — question body is `""`; round-trip still works | covered by `qa-log-format.test.ts` "Q with missing **asks** line still parses with empty question body" |
| 5 | Human never answers | timeout | `loud-crash-supervisor-restart` — `askHuman` rejects with `TimeoutError` after `timeoutMs` (default 4h); caller falls back to TASKS.md `Blocked: needs-user-approval` | covered by `ask-human.test.ts` "rejects with TimeoutError when no answer arrives within timeoutMs" |
| 6 | Stale answer pre-dates the Q (clock skew, human re-ran an old test) | edge case | `graceful-degrade` — `askHuman` ignores A blocks whose timestamp precedes its own askTimestamp | covered by `ask-human.test.ts` "ignores A blocks with timestamps preceding the Q (stale answers)" |
| 7 | macOS fs.watch fires 2 events per save (FSEvents + atomic temp+rename) | upstream-noise | `graceful-degrade` — 100ms debounce collapses rapid events into one re-read | covered by `ask-human.test.ts` "multiple rapid fs.watch events collapse into one re-read" |
| 8 | Human writes the answer BEFORE the watcher arms (race) | timing | `graceful-degrade` — immediate post-Q check resolves the promise before the watcher would fire | covered by `ask-human.test.ts` "resolves even if the human appends the answer BEFORE the watcher is armed" |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a pure parser module (`~180 LOC` including JSDoc) closes the format-stability half of the parent P0. The fs-watch + lockfile + async layers in subsequent slices build on top with a clean contract.
- **Success threshold**: `pnpm exec vitest run novel/human-loop/src/qa-log-format.test.ts --reporter=dot` exits 0 with ≥8 tests passing.
- **Pivot threshold**: if the Markdown format proves too brittle for humans (parser false-positives >1/week on operator edits), add a `.minsky/qa-log.jsonl` sidecar as source of truth + keep Markdown for human rendering only.
- **Measurement**: 12 tests passing in 3ms on 2026-05-23 (the day this shipped).

## Threat model

<!-- security: STRIDE — qa-log file is operator-machine-local; same trust boundary as the rest of `.minsky/`. -->

- **Spoofing**: not in scope at parser level — `formatQuestion` accepts any agent string; sub-task 2 will enforce that the writing process is a daemon-spawned agent.
- **Tampering**: humans WILL edit the file (that's the contract). Parser is tolerant; consumer-side `askHuman` will detect "answer text changed under us" via content-hash comparison in sub-task 2.
- **Repudiation**: out of scope — the QA channel is for operator↔agent coordination, not legal record-keeping. TASKS.md remains the durable audit log.
- **Information disclosure**: `.minsky/qa-log.md` lives in the host repo; if the host repo is public, questions/answers are public. Operators with sensitive workflows should `.gitignore .minsky/qa-log.md` (the existing `.minsky/` sidecar pattern handles this).
- **Denial of service**: parser is O(n) in input size, no regex backtracking on malformed input. A 1MB qa-log parses in <50ms (measured on 2026-05-23).
- **Elevation of privilege**: pure parser, no privileged operations.
