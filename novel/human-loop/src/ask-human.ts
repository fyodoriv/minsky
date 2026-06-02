// <!-- pattern: not-applicable — askHuman is a thin async wrapper over fs.appendFile + fs.watch + parseQaLog; the architectural pattern (operator-machine-local Q/A channel) is documented in the parent task `minsky-human-comm-via-file` and this module's README. Sub-task 3 (CLI subcommand) will add a row to vision.md § Pattern conformance index for the dashboard pending-Q surface. -->
// Async `askHuman()` API for the human↔agent QA channel. Slice 2 of P0
// `minsky-human-comm-via-file`. Builds on sub-task 1's pure
// parser/serializer (`./qa-log-format.js`).
//
// Lifecycle:
//   1. Format the Q block with the timestamp + agent name.
//   2. Atomically append to `.minsky/qa-log.md` (fs.appendFile is
//      atomic for payloads under PIPE_BUF — 4KB on Linux, 512B on
//      POSIX. A Q block is well under that limit, so concurrent
//      appends don't interleave even without proper-lockfile.)
//   3. Watch the file for changes (fs.watch + debounce 100ms).
//   4. On each change, re-parse the log and look for the A block
//      whose taskId + timestamp succeeds the Q's timestamp.
//   5. Resolve with the A's body on match. Reject on timeout
//      (default 4h per the parent task spec).
//
// Rule #1 — Node's built-in fs.watch + fs.appendFile cover the
// minimal "ask, watch, branch" pattern. `chokidar` (popular fs
// watcher with cross-OS smoothing) is rejected for slice 2 because
// fs.watch is good enough for the macOS + Linux case; we can pivot
// to chokidar if fs.watch produces spurious events (parent task's
// Pivot field).
//
// Rule #6 — fs errors (qa-log unwritable, file deleted under us)
// propagate to the caller. The agent's caller decides whether to
// retry or fall back to the existing `**Blocked**: needs-user-approval`
// TASKS.md path.

import { type FSWatcher, promises as fs, watch as fsWatch } from "node:fs";
import { formatQuestion, parseQaLog, type QaEntry } from "./qa-log-format.js";

/** Options for {@link askHuman}. */
export interface AskHumanOpts {
  /** Task ID this question is asked about. Used to match Q ↔ A pairs. */
  taskId: string;
  /** Agent name (claude / devin / aider). Written into the Q's `**from**:` field. */
  agent: string;
  /** Absolute path to the qa-log Markdown file. Default `<host>/.minsky/qa-log.md`. */
  qaLogPath: string;
  /** Maximum time to wait for a matching A block, in ms. Default 4 hours. */
  timeoutMs?: number;
  /** Test-only: inject a clock. */
  now?: () => Date;
  /** Test-only: inject the fs.watch implementation. */
  watchImpl?: (path: string, listener: () => void) => FSWatcher;
}

/** Default timeout matches the parent task's "operator's working day" budget. */
const DEFAULT_TIMEOUT_MS = 4 * 3600 * 1000;

/** fs.watch can fire 2 events for a single save on macOS (FSEvents + atomic temp+rename). Debounce. */
const WATCH_DEBOUNCE_MS = 100;

/**
 * Append a question to the qa-log and wait for the human's answer.
 *
 * Returns the answer body as a string. Rejects with a TimeoutError if
 * no matching A block appears within `timeoutMs`. Rejects with fs
 * errors if the qa-log is unwritable or disappears under us.
 *
 * @otel-exempt slice 2 ships the async + fs.watch layer without OTEL
 *   instrumentation — sub-task 3 (`bin/minsky qa` + `minsky watch`
 *   dashboard wiring) will wrap this call in a `human-loop.ask_human`
 *   span when the dashboard subscribes to the QA channel.
 */
export async function askHuman(question: string, opts: AskHumanOpts): Promise<string> {
  const now = opts.now ?? (() => new Date());
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const watchImpl = opts.watchImpl ?? fsWatch;

  const askTimestamp = now().toISOString();
  const qBlock = formatQuestion(opts.taskId, opts.agent, question, askTimestamp);
  await appendToLog(opts.qaLogPath, qBlock);

  return await waitForAnswer({
    qaLogPath: opts.qaLogPath,
    taskId: opts.taskId,
    askTimestamp,
    timeoutMs,
    watchImpl,
  });
}

async function appendToLog(path: string, block: string): Promise<void> {
  // fs.appendFile is atomic for payloads under PIPE_BUF on POSIX. A
  // Q block is under 1KB in practice, well under PIPE_BUF (4KB on
  // Linux, 512B on POSIX). Concurrent appends from multiple agents
  // don't interleave. Multi-agent safety contract: each agent's
  // Q block lands as a single atomic write.
  await fs.appendFile(path, block, { encoding: "utf8" });
}

interface WaitOpts {
  qaLogPath: string;
  taskId: string;
  askTimestamp: string;
  timeoutMs: number;
  watchImpl: (path: string, listener: () => void) => FSWatcher;
}

function waitForAnswer(opts: WaitOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let debounceHandle: NodeJS.Timeout | null = null;

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      watcher.close();
      reject(
        new TimeoutError(`askHuman: no answer for task ${opts.taskId} within ${opts.timeoutMs}ms`),
      );
    }, opts.timeoutMs);

    const check = async (): Promise<void> => {
      if (settled) return;
      const answer = await findMatchingAnswer(opts.qaLogPath, opts.taskId, opts.askTimestamp);
      if (answer === null || settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      watcher.close();
      resolve(answer);
    };

    const watcher = opts.watchImpl(opts.qaLogPath, () => {
      if (debounceHandle !== null) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        debounceHandle = null;
        check().catch((err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          watcher.close();
          reject(err);
        });
      }, WATCH_DEBOUNCE_MS);
    });

    // Race: the answer may have been written between Q-append and
    // watcher-armed. Check once immediately.
    check().catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      watcher.close();
      reject(err);
    });
  });
}

async function findMatchingAnswer(
  qaLogPath: string,
  taskId: string,
  askTimestamp: string,
): Promise<string | null> {
  const text = await fs.readFile(qaLogPath, "utf8");
  const entries = parseQaLog(text);
  const answer = entries.find(
    (e): e is QaEntry & { kind: "answer" } =>
      e.kind === "answer" && e.taskId === taskId && e.timestamp > askTimestamp,
  );
  return answer ? answer.answer : null;
}

/** Thrown when {@link askHuman} times out waiting for an answer. */
export class TimeoutError extends Error {
  /** @otel-exempt error class constructor — synchronous, no I/O. */
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
