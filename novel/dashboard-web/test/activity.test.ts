import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadRecentSpans, parseSpan, takeRecentSpans } from "../src/activity.js";

describe("parseSpan", () => {
  test("parses a well-formed iteration span", () => {
    const line =
      '[span] tick-loop.iteration {"iteration.index":7,"iteration.status":"completed","task.id":"foo","iteration.reason":"daemon dry-run prompt for foo"}';
    expect(parseSpan(line)).toEqual({
      index: 7,
      status: "completed",
      taskId: "foo",
      reason: "daemon dry-run prompt for foo",
      provider: "",
    });
  });

  test("parses iteration.provider when set (slice 5 of local-llm-fallback)", () => {
    const line =
      '[span] tick-loop.iteration {"iteration.index":7,"iteration.status":"completed","task.id":"foo","iteration.reason":"x","iteration.provider":"local"}';
    const r = parseSpan(line);
    expect(r?.provider).toBe("local");
  });

  test("parses iteration.provider=claude", () => {
    const line =
      '[span] tick-loop.iteration {"iteration.index":7,"iteration.status":"completed","iteration.provider":"claude"}';
    expect(parseSpan(line)?.provider).toBe("claude");
  });

  test("missing iteration.provider falls back to empty string (back-compat)", () => {
    const line = '[span] tick-loop.iteration {"iteration.index":7,"iteration.status":"completed"}';
    expect(parseSpan(line)?.provider).toBe("");
  });

  test("returns null for non-span lines", () => {
    expect(parseSpan("[tick-loop] notifier wired")).toBeNull();
    expect(parseSpan("")).toBeNull();
    expect(parseSpan("random log line")).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    expect(parseSpan("[span] tick-loop.iteration {not json")).toBeNull();
    expect(parseSpan("[span] tick-loop.iteration ")).toBeNull();
  });

  test("tolerates missing optional fields (taskId, reason → empty strings)", () => {
    const line =
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"budget-paused"}';
    expect(parseSpan(line)).toEqual({
      index: 0,
      status: "budget-paused",
      taskId: "",
      reason: "",
      provider: "",
    });
  });

  test("returns null when required fields are missing or wrong type", () => {
    expect(parseSpan('[span] tick-loop.iteration {"iteration.status":"completed"}')).toBeNull(); // no index
    expect(
      parseSpan(
        '[span] tick-loop.iteration {"iteration.index":"seven","iteration.status":"completed"}',
      ),
    ).toBeNull(); // index wrong type
    expect(parseSpan('[span] tick-loop.iteration {"iteration.index":1}')).toBeNull(); // no status
  });
});

describe("takeRecentSpans", () => {
  test("returns the last N entries youngest-first", () => {
    const lines = [
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed"}',
      '[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed"}',
      '[span] tick-loop.iteration {"iteration.index":2,"iteration.status":"completed"}',
    ];
    const out = takeRecentSpans(lines, 2);
    expect(out.map((e) => e.index)).toEqual([2, 1]);
  });

  test("skips non-span lines while collecting", () => {
    const lines = [
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed"}',
      "[tick-loop] notifier wired",
      '[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed"}',
    ];
    expect(takeRecentSpans(lines, 5).map((e) => e.index)).toEqual([1, 0]);
  });

  test("returns [] for empty input", () => {
    expect(takeRecentSpans([], 5)).toEqual([]);
  });
});

describe("loadRecentSpans", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dashboard-activity-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("reads spans from a real file", () => {
    const path = join(tmp, "log");
    writeFileSync(
      path,
      [
        '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed","task.id":"a"}',
        '[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"budget-paused"}',
      ].join("\n"),
      "utf-8",
    );
    const out = loadRecentSpans(path, 10);
    expect(out).toHaveLength(2);
    expect(out[0]?.index).toBe(1);
    expect(out[1]?.index).toBe(0);
  });

  test("returns [] when the file is missing (graceful-degrade)", () => {
    expect(loadRecentSpans(join(tmp, "no-such-file"), 10)).toEqual([]);
  });
});
