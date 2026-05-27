// @ts-check
//
// Tests for `check-claude-hooks-installed.mjs`. Per Minsky vision rule #3
// (test-first) and rule #2 (the script's I/O lives behind injected seams so
// tests can be hermetic). Uses vitest.

import { describe, expect, it } from "vitest";
import { checkClaudeHooksInstalled } from "./check-claude-hooks-installed.mjs";

/**
 * A valid settings.json shape that passes every gate.
 */
const VALID_SETTINGS = JSON.stringify({
  $schema: "https://json.schemastore.org/claude-code-settings.json",
  hooks: {
    PostToolUse: [
      {
        matcher: "Write|Edit|MultiEdit",
        hooks: [
          {
            type: "command",
            command: "${CLAUDE_PROJECT_DIR}/.claude/hooks/post-edit.sh",
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-dangerous-bash.sh",
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-gate.sh",
          },
        ],
      },
    ],
  },
});

/**
 * Builder for a synthetic FS — pass `present` paths and an optional `texts`
 * map, get back the three injected seams.
 *
 * @param {{
 *   present: string[];
 *   executable?: string[];
 *   texts?: Record<string, string>;
 * }} input
 */
function makeFs(input) {
  const present = new Set(input.present);
  const executable = new Set(input.executable ?? input.present);
  const texts = input.texts ?? {};
  return {
    repoRoot: "/repo",
    fileExists: (/** @type {string} */ p) => present.has(p),
    fileExecutable: (/** @type {string} */ p) => executable.has(p),
    readText: (/** @type {string} */ p) => texts[p] ?? "",
  };
}

const ALL_REQUIRED = [
  "/repo/.claude/settings.json",
  "/repo/.claude/hooks/post-edit.sh",
  "/repo/.claude/hooks/stop-gate.sh",
  "/repo/.claude/hooks/block-dangerous-bash.sh",
];

describe("checkClaudeHooksInstalled", () => {
  it("passes when all required files exist + settings.json is well-shaped", () => {
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": VALID_SETTINGS },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails when .claude/settings.json is missing", () => {
    const fs = makeFs({
      present: ALL_REQUIRED.filter((p) => !p.endsWith("settings.json")),
    });
    const result = checkClaudeHooksInstalled(fs);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes(".claude/settings.json"))).toBe(true);
  });

  it("fails when post-edit.sh is missing", () => {
    const fs = makeFs({
      present: ALL_REQUIRED.filter((p) => !p.endsWith("post-edit.sh")),
      texts: { "/repo/.claude/settings.json": VALID_SETTINGS },
    });
    const result = checkClaudeHooksInstalled(fs);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("post-edit.sh"))).toBe(true);
  });

  it("fails when stop-gate.sh is missing", () => {
    const fs = makeFs({
      present: ALL_REQUIRED.filter((p) => !p.endsWith("stop-gate.sh")),
      texts: { "/repo/.claude/settings.json": VALID_SETTINGS },
    });
    const result = checkClaudeHooksInstalled(fs);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("stop-gate.sh"))).toBe(true);
  });

  it("fails when block-dangerous-bash.sh is missing", () => {
    const fs = makeFs({
      present: ALL_REQUIRED.filter((p) => !p.endsWith("block-dangerous-bash.sh")),
      texts: { "/repo/.claude/settings.json": VALID_SETTINGS },
    });
    const result = checkClaudeHooksInstalled(fs);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("block-dangerous-bash.sh"))).toBe(true);
  });

  it("fails when a hook script exists but is not executable", () => {
    const result = checkClaudeHooksInstalled({
      repoRoot: "/repo",
      fileExists: (p) => ALL_REQUIRED.includes(p),
      fileExecutable: (p) => p.endsWith("settings.json") || p.endsWith("post-edit.sh"),
      readText: () => VALID_SETTINGS,
    });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes("not executable: .claude/hooks/stop-gate.sh")),
    ).toBe(true);
    expect(
      result.violations.some((v) =>
        v.includes("not executable: .claude/hooks/block-dangerous-bash.sh"),
      ),
    ).toBe(true);
  });

  it("fails when settings.json is invalid JSON", () => {
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": "{ not: 'json' " },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.startsWith("invalid JSON"))).toBe(true);
  });

  it("fails when settings.json hooks block is missing", () => {
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": JSON.stringify({ permissions: {} }) },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("missing `hooks` object"))).toBe(true);
  });

  it("fails when PostToolUse event is missing", () => {
    const partial = JSON.parse(VALID_SETTINGS);
    partial.hooks.PostToolUse = undefined;
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": JSON.stringify(partial) },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("hooks[PostToolUse]"))).toBe(true);
  });

  it("fails when PreToolUse event is missing", () => {
    const partial = JSON.parse(VALID_SETTINGS);
    partial.hooks.PreToolUse = undefined;
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": JSON.stringify(partial) },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("hooks[PreToolUse]"))).toBe(true);
  });

  it("fails when Stop event is missing", () => {
    const partial = JSON.parse(VALID_SETTINGS);
    partial.hooks.Stop = undefined;
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": JSON.stringify(partial) },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("hooks[Stop]"))).toBe(true);
  });

  it("fails when PostToolUse matcher doesn't include Write|Edit|MultiEdit", () => {
    const partial = JSON.parse(VALID_SETTINGS);
    partial.hooks.PostToolUse[0].matcher = "Write"; // too narrow
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": JSON.stringify(partial) },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('matcher "Write|Edit|MultiEdit"'))).toBe(true);
  });

  it("fails when PreToolUse matcher isn't Bash", () => {
    const partial = JSON.parse(VALID_SETTINGS);
    partial.hooks.PreToolUse[0].matcher = "Write"; // wrong tool
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": JSON.stringify(partial) },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('matcher "Bash"'))).toBe(true);
  });

  it("fails when a hook entry has an empty command", () => {
    const partial = JSON.parse(VALID_SETTINGS);
    partial.hooks.Stop[0].hooks[0].command = "";
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: ALL_REQUIRED,
        texts: { "/repo/.claude/settings.json": JSON.stringify(partial) },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("empty command field"))).toBe(true);
  });

  it("reports multiple violations together", () => {
    const result = checkClaudeHooksInstalled(
      makeFs({
        present: [], // nothing exists
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(4);
  });
});
