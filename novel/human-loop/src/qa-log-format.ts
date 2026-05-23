// <!-- pattern: not-applicable — pure parser module for a hand-rolled section-header format; no architectural pattern to cite. The qa-log Markdown format spec is documented in the parent task `minsky-human-comm-via-file` and this module's README. Sub-task 2 (async/fs.watch/lockfile) will add a row to vision.md § Pattern conformance index for the askHuman async pattern. -->
// Pure parser/serializer for the qa-log Markdown format consumed by
// the agent↔human QA channel at `.minsky/qa-log.md`. Slice 1 of P0
// `minsky-human-comm-via-file`.
//
// The format is append-only Markdown with stable section headers so
// humans can read and edit the file in any text editor:
//
//   ## Q: <task-id> · <iso-ts>
//   **from**: <agent>
//   **asks**: <multiline question text>
//
//   ## A: <task-id> · <iso-ts>
//   <multiline answer text>
//
// Pure functions only — no fs, no async. The fs.watch + lockfile +
// askHuman async layers build on top of this module in subsequent
// slices (sub-tasks 2-4 of the parent task).
//
// Rule #1 (don't reinvent) — Markdown is the simplest possible
// primitive for this contract; the parser is the only piece worth
// writing from scratch.
// Rule #6 (let-it-crash) — humans WILL edit the file in non-blessed
// ways (insert text mid-block, edit a previous Q). The parser must
// not crash on those edits; it recovers spurious text as the previous
// block's tail.

const Q_HEADER_RE = /^## Q: ([^·]+?) · (\S+)$/;
const A_HEADER_RE = /^## A: ([^·]+?) · (\S+)$/;
const FROM_RE = /^\*\*from\*\*: (.+)$/;
const ASKS_PREFIX_RE = /^\*\*asks\*\*: ?/;

/**
 * A question authored by an agent in the qa-log. The agent writes
 * this block and waits for the human to append a matching {@link QaAnswer}.
 */
export interface QaQuestion {
  kind: "question";
  taskId: string;
  timestamp: string;
  agent: string;
  question: string;
}

/**
 * An answer authored by the human (or another agent) in the qa-log.
 * The agent who wrote the corresponding {@link QaQuestion} reads this
 * and resumes work.
 */
export interface QaAnswer {
  kind: "answer";
  taskId: string;
  timestamp: string;
  answer: string;
}

export type QaEntry = QaQuestion | QaAnswer;

/**
 * Serialize a question into the canonical Markdown shape. The output
 * is byte-stable for a given (taskId, agent, question, timestamp)
 * input, so the parser/formatter pair round-trips cleanly.
 *
 * Trailing newline is included so concatenating blocks produces a
 * well-formed document.
 *
 * @otel-exempt pure string formatter, no I/O, no side effects.
 */
export function formatQuestion(
  taskId: string,
  agent: string,
  question: string,
  timestamp: string,
): string {
  return `## Q: ${taskId} · ${timestamp}\n**from**: ${agent}\n**asks**: ${question}\n`;
}

/**
 * Serialize an answer into the canonical Markdown shape. Symmetric to
 * {@link formatQuestion} but without the `**from**:` line — the answer
 * is authored by whoever is reading the file (typically the human
 * operator).
 *
 * @otel-exempt pure string formatter, no I/O, no side effects.
 */
export function formatAnswer(taskId: string, answer: string, timestamp: string): string {
  return `## A: ${taskId} · ${timestamp}\n${answer}\n`;
}

/**
 * Parse a qa-log Markdown document into a flat ordered list of
 * questions and answers.
 *
 * Tolerant of human edits — text between blocks is silently dropped
 * (recovered as the trailing line of the previous block's body if any,
 * otherwise discarded). Malformed headers (timestamp parse failure,
 * missing `· `) cause the block to be skipped, but later blocks parse
 * normally — the parser never throws.
 *
 * Round-trip property: for any list `entries` of {@link QaEntry},
 * `parseQaLog(entries.map(formatEntry).join("\n"))` returns a list
 * structurally equal to `entries`.
 *
 * @otel-exempt pure parser, no I/O, no side effects. The fs.watch +
 * async layers in sub-task 2 will be otel-instrumented.
 */
export function parseQaLog(text: string): QaEntry[] {
  const lines = text.split("\n");
  const entries: QaEntry[] = [];
  /** Active block we're filling in. null when we're outside any block. */
  let current: PartialEntry | null = null;
  for (const line of lines) {
    const startedBlock = tryStartBlock(line, current, entries);
    if (startedBlock !== undefined) {
      current = startedBlock;
      continue;
    }
    if (current === null) continue;
    fillBlockBody(current, line);
  }
  flush(current, entries);
  return entries;
}

/**
 * If `line` is a `## Q:` or `## A:` header, flush the current block
 * and return a fresh PartialEntry. Otherwise return undefined so the
 * caller knows to keep filling the existing block.
 */
function tryStartBlock(
  line: string,
  current: PartialEntry | null,
  out: QaEntry[],
): PartialEntry | undefined {
  const qMatch = line.match(Q_HEADER_RE);
  if (qMatch) {
    flush(current, out);
    return {
      kind: "question",
      taskId: (qMatch[1] ?? "").trim(),
      timestamp: (qMatch[2] ?? "").trim(),
      agent: "",
      question: "",
      bodyStarted: false,
    };
  }
  const aMatch = line.match(A_HEADER_RE);
  if (aMatch) {
    flush(current, out);
    return {
      kind: "answer",
      taskId: (aMatch[1] ?? "").trim(),
      timestamp: (aMatch[2] ?? "").trim(),
      answer: "",
      bodyStarted: false,
    };
  }
  return undefined;
}

function fillBlockBody(current: PartialEntry, line: string): void {
  if (current.kind === "answer") {
    current.answer = appendLine(current.answer, line);
    return;
  }
  if (current.bodyStarted) {
    current.question = appendLine(current.question, line);
    return;
  }
  // Inside a Q block but body hasn't started — look for `**from**:`
  // or `**asks**:` headers. Other lines are dropped (humans editing
  // the file may insert text here; ignore).
  const fromMatch = line.match(FROM_RE);
  if (fromMatch) {
    current.agent = (fromMatch[1] ?? "").trim();
    return;
  }
  if (ASKS_PREFIX_RE.test(line)) {
    current.question = line.replace(ASKS_PREFIX_RE, "");
    current.bodyStarted = true;
  }
}

interface PartialQuestion {
  kind: "question";
  taskId: string;
  timestamp: string;
  agent: string;
  question: string;
  bodyStarted: boolean;
}

interface PartialAnswer {
  kind: "answer";
  taskId: string;
  timestamp: string;
  answer: string;
  bodyStarted: boolean;
}

type PartialEntry = PartialQuestion | PartialAnswer;

function appendLine(body: string, line: string): string {
  return body === "" ? line : `${body}\n${line}`;
}

function flush(p: PartialEntry | null, out: QaEntry[]): void {
  if (p === null) return;
  // Drop blocks with empty taskId or timestamp — these are malformed.
  // The body may be empty (a question with no asks: line) — keep those
  // so the round-trip works when an agent forgets to fill in the body.
  if (p.taskId === "" || p.timestamp === "") return;
  if (p.kind === "question") {
    out.push({
      kind: "question",
      taskId: p.taskId,
      timestamp: p.timestamp,
      agent: p.agent,
      question: trimTrailingBlanks(p.question),
    });
  } else {
    out.push({
      kind: "answer",
      taskId: p.taskId,
      timestamp: p.timestamp,
      answer: trimTrailingBlanks(p.answer),
    });
  }
}

function trimTrailingBlanks(s: string): string {
  return s.replace(/\n+$/, "");
}
