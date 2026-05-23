import { describe, expect, test } from "vitest";
import { type QaEntry, formatAnswer, formatQuestion, parseQaLog } from "./qa-log-format.js";

const TS_1 = "2026-05-23T10:00:00Z";
const TS_2 = "2026-05-23T10:15:00Z";
const TS_3 = "2026-05-23T10:30:00Z";

describe("qa-log-format — formatters", () => {
  test("formatQuestion produces the canonical 3-line block", () => {
    const out = formatQuestion("task-1", "claude", "Should I proceed?", TS_1);
    expect(out).toBe(`## Q: task-1 · ${TS_1}\n**from**: claude\n**asks**: Should I proceed?\n`);
  });

  test("formatAnswer produces the canonical 2-line block", () => {
    const out = formatAnswer("task-1", "Yes, ship it.", TS_2);
    expect(out).toBe(`## A: task-1 · ${TS_2}\nYes, ship it.\n`);
  });

  test("formatQuestion handles multiline question text", () => {
    const out = formatQuestion("task-2", "devin", "First line.\nSecond line.", TS_1);
    expect(out).toBe(
      `## Q: task-2 · ${TS_1}\n**from**: devin\n**asks**: First line.\nSecond line.\n`,
    );
  });
});

describe("qa-log-format — parser", () => {
  test("empty input → empty list", () => {
    expect(parseQaLog("")).toEqual([]);
  });

  test("single Q block parses with all 4 fields populated", () => {
    const text = formatQuestion("task-1", "claude", "Proceed?", TS_1);
    const entries = parseQaLog(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      kind: "question",
      taskId: "task-1",
      timestamp: TS_1,
      agent: "claude",
      question: "Proceed?",
    });
  });

  test("Q + A pair parses as two distinct entries with correct ordering", () => {
    const text = `${formatQuestion("task-1", "claude", "Proceed?", TS_1)}\n${formatAnswer("task-1", "Yes.", TS_2)}`;
    const entries = parseQaLog(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("question");
    expect(entries[1]?.kind).toBe("answer");
    if (entries[1]?.kind === "answer") {
      expect(entries[1].answer).toBe("Yes.");
      expect(entries[1].timestamp).toBe(TS_2);
    }
  });

  test("3 interleaved Q/A pairs parse in order with no cross-talk", () => {
    const text = [
      formatQuestion("task-1", "claude", "Q1?", TS_1),
      formatAnswer("task-1", "A1.", TS_1),
      formatQuestion("task-2", "devin", "Q2?", TS_2),
      formatAnswer("task-2", "A2.", TS_2),
      formatQuestion("task-3", "aider", "Q3?", TS_3),
      formatAnswer("task-3", "A3.", TS_3),
    ].join("\n");
    const entries = parseQaLog(text);
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.kind)).toEqual([
      "question",
      "answer",
      "question",
      "answer",
      "question",
      "answer",
    ]);
    expect(entries.map((e) => e.taskId)).toEqual([
      "task-1",
      "task-1",
      "task-2",
      "task-2",
      "task-3",
      "task-3",
    ]);
  });

  test("malformed Q header (no separator) is skipped, later blocks parse normally", () => {
    const text = [
      "## Q: malformed-no-separator",
      `## Q: task-1 · ${TS_1}`,
      "**from**: claude",
      "**asks**: ok?",
      "",
    ].join("\n");
    const entries = parseQaLog(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.taskId).toBe("task-1");
  });

  test("human-inserted noise between blocks is silently dropped", () => {
    const text = [
      formatQuestion("task-1", "claude", "Proceed?", TS_1),
      "Some random human note about the project, not part of any block.",
      "Maybe two lines.",
      "",
      formatAnswer("task-1", "Yes.", TS_2),
    ].join("\n");
    const entries = parseQaLog(text);
    // The noise lines fall after the asks: line, so they get absorbed
    // into the question body. The answer block still parses cleanly.
    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("question");
    expect(entries[1]?.kind).toBe("answer");
    if (entries[1]?.kind === "answer") {
      expect(entries[1].answer).toBe("Yes.");
    }
  });

  test("round-trip identity: parse ∘ format == identity on entries", () => {
    const originals: QaEntry[] = [
      {
        kind: "question",
        taskId: "task-1",
        timestamp: TS_1,
        agent: "claude",
        question: "Single line question?",
      },
      {
        kind: "answer",
        taskId: "task-1",
        timestamp: TS_2,
        answer: "Single line answer.",
      },
      {
        kind: "question",
        taskId: "task-2",
        timestamp: TS_2,
        agent: "devin",
        question: "Multiline question line 1\nLine 2\nLine 3",
      },
      {
        kind: "answer",
        taskId: "task-2",
        timestamp: TS_3,
        answer: "Multiline answer line 1\nLine 2",
      },
    ];
    const serialized = originals
      .map((e) =>
        e.kind === "question"
          ? formatQuestion(e.taskId, e.agent, e.question, e.timestamp)
          : formatAnswer(e.taskId, e.answer, e.timestamp),
      )
      .join("\n");
    const parsed = parseQaLog(serialized);
    expect(parsed).toEqual(originals);
  });

  test("Q with missing **asks** line still parses with empty question body", () => {
    const text = [`## Q: task-1 · ${TS_1}`, "**from**: claude", ""].join("\n");
    const entries = parseQaLog(text);
    expect(entries).toHaveLength(1);
    if (entries[0]?.kind === "question") {
      expect(entries[0].question).toBe("");
      expect(entries[0].agent).toBe("claude");
    }
  });

  test("A block before any Q (orphan answer) parses cleanly", () => {
    const text = formatAnswer("task-1", "Orphan answer.", TS_1);
    const entries = parseQaLog(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("answer");
  });
});
