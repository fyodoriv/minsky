// @ts-check
// Tests for `check-tool-call-discipline.mjs`. Per Minsky vision rule #3
// (test-first). Uses vitest.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkTranscript, parseArgs } from "./check-tool-call-discipline.mjs";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "tool-call-discipline",
);

/**
 * @param {string} name
 * @returns {string}
 */
function loadFixture(name) {
  return readFileSync(resolve(FIXTURE_DIR, name), "utf8");
}

describe("checkTranscript", () => {
  it("flags qwen3-coder-style prose-only last turn (the canonical failure mode)", () => {
    const text = loadFixture("qwen3-coder-prose-only.jsonl");
    const result = checkTranscript(text);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]).toMatch(/forbidden prose pattern/);
    expect(result.violations[0]).toMatch(/let me examine/);
    expect(result.lastText).toMatch(/Let me examine/);
  });

  it("passes when the last turn contains a tool_use block", () => {
    const text = loadFixture("healthy-with-tool-use.jsonl");
    const result = checkTranscript(text);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("passes when the last text contains a terminal signal (PR URL)", () => {
    const text = loadFixture("terminal-pr-opened.jsonl");
    const result = checkTranscript(text);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags 'Now I'll do X' without tool_use", () => {
    const text = makeTurn([{ type: "text", text: "Now I'll add the new flag." }]);
    expect(checkTranscript(text).ok).toBe(false);
  });

  it("flags 'Let me check X' without tool_use", () => {
    const text = makeTurn([{ type: "text", text: "Let me check the existing test." }]);
    expect(checkTranscript(text).ok).toBe(false);
  });

  it("flags 'Let me verify X' without tool_use", () => {
    const text = makeTurn([{ type: "text", text: "Let me verify the regex compiles." }]);
    expect(checkTranscript(text).ok).toBe(false);
  });

  it("flags 'Let me look at X' without tool_use", () => {
    const text = makeTurn([{ type: "text", text: "Let me look at the parent commit." }]);
    expect(checkTranscript(text).ok).toBe(false);
  });

  it("flags 'I'll go ahead and X' without tool_use", () => {
    const text = makeTurn([{ type: "text", text: "I'll go ahead and add the lint." }]);
    expect(checkTranscript(text).ok).toBe(false);
  });

  it("flags 'I'm going to X' without tool_use", () => {
    const text = makeTurn([{ type: "text", text: "I'm going to fix that." }]);
    expect(checkTranscript(text).ok).toBe(false);
  });

  it("passes when text is generic prose without forbidden patterns", () => {
    const text = makeTurn([
      { type: "text", text: "Here is a summary of what shipped." },
      { type: "text", text: "The bug class is now closed." },
    ]);
    expect(checkTranscript(text).ok).toBe(true);
  });

  it("passes when text contains forbidden pattern BUT also a tool_use later in same turn", () => {
    const text = makeTurn([
      { type: "text", text: "Let me examine the file." },
      { type: "tool_use", name: "Read", input: { file_path: "/foo" } },
    ]);
    expect(checkTranscript(text).ok).toBe(true);
  });

  it("passes when text contains forbidden pattern BUT terminal signal present", () => {
    const text = makeTurn([
      {
        type: "text",
        text: "Let me check — PR opened at https://github.com/fyodoriv/minsky/pull/123 — all green.",
      },
    ]);
    expect(checkTranscript(text).ok).toBe(true);
  });

  it("passes when the transcript has no assistant entries", () => {
    const text = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
    expect(checkTranscript(text).ok).toBe(true);
  });

  it("passes when last turn is empty (edge case)", () => {
    const text = makeTurn([]);
    expect(checkTranscript(text).ok).toBe(true);
  });

  it("only examines the MOST RECENT turn (earlier prose-only turns don't fail)", () => {
    // Earlier prose-only turn (would fail if examined), but the LAST turn has tool_use — pass.
    const lines = [
      userEntry("first prompt"),
      assistantEntry([{ type: "text", text: "Let me examine the supervisor." }]),
      userEntry("tool_result placeholder"),
      assistantEntry([{ type: "tool_use", name: "Read", input: {} }]),
    ];
    const result = checkTranscript(lines.join("\n"));
    expect(result.ok).toBe(true);
  });

  it("skips malformed jsonl lines instead of crashing", () => {
    const lines = [
      userEntry("prompt"),
      "this is not valid json",
      "{ broken: json",
      assistantEntry([{ type: "tool_use", name: "Read", input: {} }]),
    ];
    expect(checkTranscript(lines.join("\n")).ok).toBe(true);
  });

  it("handles empty transcript", () => {
    expect(checkTranscript("").ok).toBe(true);
  });

  it("handles whitespace-only transcript", () => {
    expect(checkTranscript("   \n\n  \n").ok).toBe(true);
  });

  it("captures multi-block text in lastText for diagnostics", () => {
    const text = makeTurn([
      { type: "text", text: "Some preamble." },
      { type: "text", text: "Let me check the function." },
    ]);
    const result = checkTranscript(text);
    expect(result.ok).toBe(false);
    expect(result.lastText).toContain("Some preamble.");
    expect(result.lastText).toContain("Let me check the function.");
  });

  it("matches forbidden patterns case-insensitively", () => {
    const text = makeTurn([{ type: "text", text: "LET ME EXAMINE THE FILE." }]);
    expect(checkTranscript(text).ok).toBe(false);
  });
});

describe("parseArgs", () => {
  it("parses --transcript=/path", () => {
    expect(parseArgs(["--transcript=/tmp/foo.jsonl"])).toEqual({
      transcript: "/tmp/foo.jsonl",
      fromHookStdin: false,
    });
  });

  it("parses --from-hook-stdin", () => {
    expect(parseArgs(["--from-hook-stdin"])).toEqual({ fromHookStdin: true });
  });

  it("parses both", () => {
    expect(parseArgs(["--transcript=/x", "--from-hook-stdin"])).toEqual({
      transcript: "/x",
      fromHookStdin: true,
    });
  });

  it("returns empty parse for empty argv", () => {
    expect(parseArgs([])).toEqual({ fromHookStdin: false });
  });
});

// -------- Helpers ---------------------------------------------------------

/**
 * Build a jsonl transcript with one user entry + one assistant turn that
 * contains the given content blocks.
 *
 * @param {Array<{type: string, text?: string, name?: string, input?: object}>} blocks
 * @returns {string}
 */
function makeTurn(blocks) {
  const lines = [userEntry("test prompt"), assistantEntry(blocks)];
  return lines.join("\n");
}

/**
 * @param {string} text
 * @returns {string}
 */
function userEntry(text) {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

/**
 * @param {Array<{type: string, text?: string, name?: string, input?: object}>} blocks
 * @returns {string}
 */
function assistantEntry(blocks) {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: blocks },
  });
}
