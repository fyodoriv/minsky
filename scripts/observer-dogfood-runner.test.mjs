// Tests for observer-dogfood-runner.mjs. Pattern: paired positive/negative
// fixtures over pure transforms (Meszaros 2007); the I/O seams (runMinsky,
// readRecords, appendLine) are stubbed so the orchestrator is exercised
// end-to-end without shelling out or touching the filesystem.

import { describe, expect, test } from "vitest";

import {
  buildLogLine,
  countFindings,
  countTasksFiled,
  FINDING_VERDICTS,
  parseRecords,
  runObserverDogfood,
} from "./observer-dogfood-runner.mjs";

const sampleJsonl = [
  JSON.stringify({ ts: "2026-06-02T09:00:00Z", verdict: "validated", pr_url: "https://x/1" }),
  JSON.stringify({ ts: "2026-06-02T09:05:00Z", verdict: "scope-leak", pr_url: null }),
  JSON.stringify({ ts: "2026-06-02T09:10:00Z", verdict: "spawn-failed", pr_url: "https://x/2" }),
  JSON.stringify({ ts: "2026-06-02T09:15:00Z", verdict: "empty-queue" }),
].join("\n");

describe("parseRecords", () => {
  test("empty text → empty records, zero dropped", () => {
    expect(parseRecords("")).toEqual({ records: [], dropped: 0 });
  });

  test("multi-line JSONL parses to typed records", () => {
    const { records, dropped } = parseRecords(sampleJsonl);
    expect(records).toHaveLength(4);
    expect(dropped).toBe(0);
    expect(records[1]).toMatchObject({ verdict: "scope-leak" });
  });

  test("blank lines and surrounding whitespace are skipped (not dropped)", () => {
    const { records, dropped } = parseRecords(`\n  \n${sampleJsonl}\n\n`);
    expect(records).toHaveLength(4);
    expect(dropped).toBe(0);
  });

  test("truncated mid-write line is dropped, not thrown (graceful-degrade)", () => {
    const { records, dropped } = parseRecords(`{"verdict":"validated"}\n{"verdict":"sco`);
    expect(records).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  test("non-object JSON (array / scalar) is counted as dropped", () => {
    const { records, dropped } = parseRecords(`[1,2,3]\n42\n{"verdict":"crash"}`);
    expect(records).toHaveLength(1);
    expect(dropped).toBe(2);
  });
});

describe("countFindings", () => {
  test("counts only FINDING_VERDICTS, ignores validated/empty-queue", () => {
    const { records } = parseRecords(sampleJsonl);
    expect(countFindings(records)).toBe(2); // scope-leak + spawn-failed
  });

  test("zero findings on an all-healthy run", () => {
    const { records } = parseRecords(
      [JSON.stringify({ verdict: "validated" }), JSON.stringify({ verdict: "empty-queue" })].join(
        "\n",
      ),
    );
    expect(countFindings(records)).toBe(0);
  });

  test("records without a string verdict are ignored", () => {
    expect(countFindings([{ verdict: 7 }, { foo: "bar" }, {}])).toBe(0);
  });

  test("FINDING_VERDICTS is the documented signal set", () => {
    expect([...FINDING_VERDICTS].sort()).toEqual([
      "crash",
      "rule-9-violation",
      "scope-leak",
      "spawn-failed",
      "stuck",
    ]);
  });
});

describe("countTasksFiled", () => {
  test("counts records with a real pr_url, ignores null/'null'/empty", () => {
    const { records } = parseRecords(sampleJsonl);
    expect(countTasksFiled(records)).toBe(2); // two non-null pr_url entries
  });

  test("string 'null' sentinel is not a filed task", () => {
    expect(countTasksFiled([{ pr_url: "null" }, { pr_url: "" }, { pr_url: "https://y" }])).toBe(1);
  });
});

describe("buildLogLine", () => {
  test("emits the {run, findings_count, new_tasks_filed} schema", () => {
    const line = buildLogLine({ run: "2026-06-02T09:00:00Z", findingsCount: 2, newTasksFiled: 1 });
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      run: "2026-06-02T09:00:00Z",
      findings_count: 2,
      new_tasks_filed: 1,
    });
  });

  test("includes records_read when provided", () => {
    const parsed = JSON.parse(
      buildLogLine({
        run: "2026-06-02T09:00:00Z",
        findingsCount: 0,
        newTasksFiled: 0,
        recordsRead: 4,
      }),
    );
    expect(parsed.records_read).toBe(4);
  });

  test("defaults run to an ISO timestamp when omitted", () => {
    const parsed = JSON.parse(buildLogLine({ findingsCount: 0, newTasksFiled: 0 }));
    expect(typeof parsed.run).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.run))).toBe(false);
  });

  test("produces no trailing newline (the appender owns the newline)", () => {
    const line = buildLogLine({ findingsCount: 0, newTasksFiled: 0 });
    expect(line.endsWith("\n")).toBe(false);
  });
});

describe("runObserverDogfood", () => {
  test("composes run → read → count → append and decides PR on findings>0", async () => {
    /** @type {string[]} */
    const hostsRun = [];
    /** @type {Array<[string, string]>} */
    const appended = [];
    const summary = await runObserverDogfood({
      hostDir: "/host",
      logPath: "/tmp/log.jsonl",
      run: "2026-06-02T09:00:00Z",
      runMinsky: async (h) => {
        hostsRun.push(h);
        return { stdout: "", stderr: "", code: 0 };
      },
      readRecords: async () => sampleJsonl,
      appendLine: async (p, l) => {
        appended.push([p, l]);
      },
    });
    expect(hostsRun).toEqual(["/host"]);
    expect(summary.findingsCount).toBe(2);
    expect(summary.newTasksFiled).toBe(2);
    expect(summary.recordsRead).toBe(4);
    expect(summary.shouldOpenPr).toBe(true);
    expect(appended).toHaveLength(1);
    const [path, line] = appended[0] ?? ["", ""];
    expect(path).toBe("/tmp/log.jsonl");
    expect(JSON.parse(line).findings_count).toBe(2);
  });

  test("shouldOpenPr is false when the run surfaces zero findings", async () => {
    const summary = await runObserverDogfood({
      hostDir: "/host",
      logPath: "/tmp/log.jsonl",
      run: "2026-06-02T10:00:00Z",
      runMinsky: async () => ({ stdout: "", stderr: "", code: 0 }),
      readRecords: async () => JSON.stringify({ verdict: "validated" }),
      appendLine: async () => {
        /* no-op: this case does not assert on the appended line */
      },
    });
    expect(summary.findingsCount).toBe(0);
    expect(summary.shouldOpenPr).toBe(false);
  });

  test("empty store (host never ran) → zero findings, still appends a record", async () => {
    /** @type {string[]} */
    const lines = [];
    const summary = await runObserverDogfood({
      hostDir: "/host",
      logPath: "/tmp/log.jsonl",
      run: "2026-06-02T11:00:00Z",
      runMinsky: async () => ({ stdout: "", stderr: "", code: 0 }),
      readRecords: async () => "",
      appendLine: async (_p, l) => {
        lines.push(l);
      },
    });
    expect(summary.recordsRead).toBe(0);
    expect(summary.shouldOpenPr).toBe(false);
    expect(lines).toHaveLength(1);
  });

  test("a non-zero iteration exit is surfaced, not swallowed", async () => {
    const summary = await runObserverDogfood({
      hostDir: "/host",
      logPath: "/tmp/log.jsonl",
      runMinsky: async () => ({ stdout: "", stderr: "boom", code: 1 }),
      readRecords: async () => JSON.stringify({ verdict: "crash" }),
      appendLine: async () => {
        /* no-op: this case does not assert on the appended line */
      },
    });
    expect(summary.iterationCode).toBe(1);
    expect(summary.findingsCount).toBe(1);
  });

  test("propagates runMinsky rejections (let-it-crash, rule #6)", async () => {
    await expect(
      runObserverDogfood({
        hostDir: "/host",
        logPath: "/tmp/log.jsonl",
        runMinsky: async () => {
          throw new Error("minsky unavailable");
        },
        readRecords: async () => "",
        appendLine: async () => {
          /* no-op: this case does not assert on the appended line */
        },
      }),
    ).rejects.toThrow(/minsky unavailable/);
  });
});
