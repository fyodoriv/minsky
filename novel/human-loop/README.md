# @minsky/human-loop

<!-- scope: human-approved sub-task `human-loop-qa-log-format` of P0 `minsky-human-comm-via-file`; tsconfig is mechanical boilerplate matching @minsky/sidecar-bootstrap shape. -->

<!-- rule-1: `chokidar` (popular fs watcher) + `proper-lockfile` (atomic file locking) + `@iarna/toml` (parser) + various Markdown libs (e.g., `mdast-util-from-markdown`) all rejected because: this slice is a pure parser for a hand-rolled section-header format (`## Q:` / `## A:` lines) — a 180-LOC regex-based parser is simpler than pulling in a full Markdown AST library that would parse the entire file. Sub-task 2 (`human-loop-ask-human-and-watcher`) WILL use `proper-lockfile` per the parent task's spec. -->

Human↔agent QA channel via an append-only Markdown file at `.minsky/qa-log.md` in the host repo. Agents write `## Q:` blocks and wait for the human to append `## A:` blocks; the human edits the file in any text editor.

Slice 1 of P0 `minsky-human-comm-via-file` (operator directive 2026-05-20: "as simple as creating a log or xml or whatever file where you leave questions and I leave answers"). This package currently ships **only the pure parser/serializer** — the async `askHuman()` + `fs.watch` + `proper-lockfile` layers ship in subsequent slices.

## Why this exists

Today minsky communicates with humans through three weak channels:

- `**Blocked**: needs-user-approval` markers in TASKS.md task bodies (humans grep)
- Draft PRs that the human reviews (delayed)
- `daemon.log` warnings (one-way, no acknowledgement)

None support fast back-and-forth Q&A. The QA channel is the operator's "ask, wait, branch on answer" surface — the agent writes a question and gets a synchronous answer within minutes, not days.

## What ships in slice 1

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

Pure functions only — no fs, no async, no fs.watch. The sub-task-2 `askHuman()` API will consume these exports as its protocol contract.

## What does NOT ship yet

- `askHuman(question, opts): Promise<string>` — sub-task 2 (`human-loop-ask-human-and-watcher`).
- `fs.watch` dedupe layer with cross-OS (macOS FSEvents vs Linux inotify) handling — sub-task 2.
- `proper-lockfile` integration for multi-agent safety — sub-task 2.
- `bin/minsky qa` subcommand — sub-task 3.
- `minsky watch` pending-Q count — sub-task 3.
- Brief template addition + README + vision.md row — sub-task 4.

## Failure modes & chaos verification

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Malformed `## Q:` header (no separator) | upstream-malformed | `graceful-degrade` — parser skips the block, later blocks parse normally; no throw | covered by `qa-log-format.test.ts` "malformed Q header (no separator) is skipped" |
| 2 | Human edits previous Q's body (inserts text between Q and A) | upstream-malformed | `graceful-degrade` — inserted lines fall after the `**asks**:` line, get absorbed into the question body; later A block still parses | covered by `qa-log-format.test.ts` "human-inserted noise between blocks is silently dropped" |
| 3 | Orphan A block (no matching Q) | edge case | `graceful-degrade` — A block parses with empty consumer-side context; the consuming `askHuman` (sub-task 2) ignores orphans | covered by `qa-log-format.test.ts` "A block before any Q (orphan answer) parses cleanly" |
| 4 | Missing `**asks**:` line on a Q block | upstream-malformed | `graceful-degrade` — question body is `""`; round-trip still works; consumer-side `askHuman` may decide to retry the ask | covered by `qa-log-format.test.ts` "Q with missing **asks** line still parses with empty question body" |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a pure parser module (`~180 LOC` including JSDoc) closes the format-stability half of the parent P0. The fs-watch + lockfile + async layers in subsequent slices build on top with a clean contract.
- **Success threshold**: `pnpm exec vitest run novel/human-loop/src/qa-log-format.test.ts --reporter=basic` exits 0 with ≥8 tests passing.
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
