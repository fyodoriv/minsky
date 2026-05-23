import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TimeoutError, askHuman } from "./ask-human.js";
import { formatAnswer } from "./qa-log-format.js";

/**
 * Test-only fake watcher: emits "change" via direct invocation. Lets
 * us simulate "human saves the file" without depending on real
 * fs.watch (whose cross-OS event count differs).
 */
function makeFakeWatcher() {
  const listeners: Array<() => void> = [];
  const noop = (): void => undefined;
  return {
    factory: (_path: string, listener: () => void) => {
      listeners.push(listener);
      return {
        close: noop,
        on: noop,
        addListener: noop,
        once: noop,
        ref: noop,
        unref: noop,
        removeAllListeners: noop,
        // biome-ignore lint/suspicious/noExplicitAny: test-only fake
      } as any;
    },
    fire: () => {
      for (const l of listeners) l();
    },
  };
}

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ask-human-test-"));
  logPath = join(dir, "qa-log.md");
  writeFileSync(logPath, "");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("askHuman — happy path", () => {
  test("appends a Q block and resolves with A body when human appends matching A", async () => {
    const watcher = makeFakeWatcher();
    const askTs = "2026-05-23T10:00:00.000Z";
    const answerTs = "2026-05-23T10:05:00.000Z";

    const promise = askHuman("Should I proceed?", {
      taskId: "task-1",
      agent: "claude",
      qaLogPath: logPath,
      timeoutMs: 5000,
      now: () => new Date(askTs),
      watchImpl: watcher.factory,
    });

    // Wait a microtask so the Q is appended and watcher is armed.
    await new Promise((r) => setTimeout(r, 50));
    // Simulate the human appending an answer.
    appendFileSync(logPath, formatAnswer("task-1", "Yes, ship it.", answerTs));
    watcher.fire();

    const answer = await promise;
    expect(answer).toBe("Yes, ship it.");
  });

  test("Q block actually gets written to disk before waiting", async () => {
    const watcher = makeFakeWatcher();
    const askTs = "2026-05-23T10:00:00.000Z";

    const promise = askHuman("Should I proceed?", {
      taskId: "task-1",
      agent: "claude",
      qaLogPath: logPath,
      timeoutMs: 1000,
      now: () => new Date(askTs),
      watchImpl: watcher.factory,
    }).catch(() => null);

    await new Promise((r) => setTimeout(r, 50));
    const logContent = readFileSync(logPath, "utf8");
    expect(logContent).toContain("## Q: task-1 ·");
    expect(logContent).toContain("**from**: claude");
    expect(logContent).toContain("**asks**: Should I proceed?");
    await promise; // let it time out cleanly
  });
});

describe("askHuman — timeout", () => {
  test("rejects with TimeoutError when no answer arrives within timeoutMs", async () => {
    const watcher = makeFakeWatcher();

    const promise = askHuman("Will anyone answer?", {
      taskId: "task-2",
      agent: "claude",
      qaLogPath: logPath,
      timeoutMs: 200,
      watchImpl: watcher.factory,
    });

    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
  });

  test("TimeoutError message includes the taskId and budget", async () => {
    const watcher = makeFakeWatcher();
    try {
      await askHuman("Q", {
        taskId: "task-budget",
        agent: "devin",
        qaLogPath: logPath,
        timeoutMs: 150,
        watchImpl: watcher.factory,
      });
    } catch (err) {
      if (err instanceof TimeoutError) {
        expect(err.message).toContain("task-budget");
        expect(err.message).toContain("150ms");
        return;
      }
      throw err;
    }
    throw new Error("expected TimeoutError");
  });
});

describe("askHuman — matching logic", () => {
  test("ignores A blocks for other taskIds", async () => {
    const watcher = makeFakeWatcher();
    const askTs = "2026-05-23T10:00:00.000Z";

    const promise = askHuman("My question", {
      taskId: "task-mine",
      agent: "claude",
      qaLogPath: logPath,
      timeoutMs: 300,
      now: () => new Date(askTs),
      watchImpl: watcher.factory,
    });

    await new Promise((r) => setTimeout(r, 50));
    // Append an answer for a DIFFERENT task. Should not satisfy our await.
    appendFileSync(
      logPath,
      formatAnswer("task-other", "different task answer", "2026-05-23T10:05:00.000Z"),
    );
    watcher.fire();

    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
  });

  test("ignores A blocks with timestamps preceding the Q (stale answers)", async () => {
    const watcher = makeFakeWatcher();
    const askTs = "2026-05-23T10:00:00.000Z";
    // Pre-populate the log with an OLD answer for the same taskId.
    writeFileSync(logPath, formatAnswer("task-1", "old stale answer", "2026-05-23T09:00:00.000Z"));

    const promise = askHuman("My fresh question", {
      taskId: "task-1",
      agent: "claude",
      qaLogPath: logPath,
      timeoutMs: 300,
      now: () => new Date(askTs),
      watchImpl: watcher.factory,
    });

    watcher.fire();
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("askHuman — race condition", () => {
  test("resolves even if the human appends the answer BEFORE the watcher is armed", async () => {
    const watcher = makeFakeWatcher();
    const askTs = "2026-05-23T10:00:00.000Z";
    const answerTs = "2026-05-23T10:00:01.000Z";

    // Pre-write the answer; askHuman will run an immediate check
    // before the watcher fires, so it should still resolve.
    const promise = askHuman("Fast race?", {
      taskId: "task-race",
      agent: "claude",
      qaLogPath: logPath,
      timeoutMs: 500,
      now: () => new Date(askTs),
      watchImpl: watcher.factory,
    });
    // Append the answer with a timestamp AFTER askTs.
    appendFileSync(logPath, formatAnswer("task-race", "instant answer", answerTs));

    const answer = await promise;
    expect(answer).toBe("instant answer");
  });
});

describe("askHuman — debounce", () => {
  test("multiple rapid fs.watch events collapse into one re-read", async () => {
    const watcher = makeFakeWatcher();
    const askTs = "2026-05-23T10:00:00.000Z";
    const answerTs = "2026-05-23T10:00:01.000Z";

    const promise = askHuman("Debounce test?", {
      taskId: "task-debounce",
      agent: "claude",
      qaLogPath: logPath,
      timeoutMs: 1000,
      now: () => new Date(askTs),
      watchImpl: watcher.factory,
    });

    await new Promise((r) => setTimeout(r, 50));
    appendFileSync(logPath, formatAnswer("task-debounce", "debounce answer", answerTs));
    // Fire rapidly — debounce should collapse these into one re-read.
    watcher.fire();
    watcher.fire();
    watcher.fire();

    const answer = await promise;
    expect(answer).toBe("debounce answer");
  });
});
