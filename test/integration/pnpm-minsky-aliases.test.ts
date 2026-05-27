// Integration tests: `pnpm minsky:X` aliases delegate to `bin/minsky X`.
//
// Pre-2026-05-27 each `pnpm minsky:X` script had its own implementation
// in `package.json`, and a SECOND implementation in `bin/minsky`. The
// two drifted (PR #907 fixed `pnpm minsky:logs`; the parallel
// `bin/minsky logs` was the canonical). This task closes the remaining
// 5 (`setup`, `doctor`, `status`, `stop`, `ui`) by making every
// `pnpm minsky:X` a thin alias of `bin/minsky X`.
//
// Hypothesis (rule #9): every alias matches the regex
// `^bin/minsky\s+\w+(\s|$)` — delegate-only, no extra logic. The
// structural invariant prevents future drift.
//
// Success: this test file passes.
// Measurement: `pnpm exec vitest run
//   test/integration/pnpm-minsky-aliases.test.ts`.
// Anchor: rule #1 (one canonical implementation per concern); Krug
// *Don't Make Me Think* 2014 (one obvious path); operator session
// 2026-05-27 — operator directive after PR #907 ("Apply the same
// pattern for all other commands and file P0 tasks for that").

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * The 6 `pnpm minsky:*` scripts that must delegate to `bin/minsky <verb>`.
 * `logs` was consolidated in PR #907; this task closes the remaining 5.
 */
const ALIASES = [
  "minsky:setup",
  "minsky:doctor",
  "minsky:status",
  "minsky:stop",
  "minsky:ui",
  "minsky:logs",
] as const;

/**
 * Regex enforcing "delegate-only" shape — must start with `bin/minsky`,
 * followed by a single word (the verb), and optionally trailing args.
 * No leading env vars, no piped shell, no `&&`, no `||`.
 */
const DELEGATE_REGEX = /^bin\/minsky\s+\w+(\s|$)/;

describe("pnpm minsky:* alias delegation", () => {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));

  test.each(ALIASES)("`pnpm %s` is a thin alias of `bin/minsky <verb>`", (alias) => {
    const script = pkg.scripts[alias];
    expect(script, `expected package.json to define scripts.${alias}`).toBeDefined();
    expect(
      script,
      `${alias} must delegate to bin/minsky (not duplicate logic). Got: ${script}`,
    ).toMatch(DELEGATE_REGEX);
  });

  test("no `pnpm minsky:*` script reaches outside bin/minsky", () => {
    // Catch the legacy patterns: setup.sh, launchctl, systemctl,
    // distribution/run-*.sh — these belong inside bin/minsky now.
    const banned = [/setup\.sh/, /\blaunchctl\b/, /\bsystemctl\b/, /distribution\/run-/];
    for (const alias of ALIASES) {
      const script = pkg.scripts[alias];
      for (const re of banned) {
        expect(
          re.test(script),
          `${alias} contains a legacy substrate (${re}) — move that logic into bin/minsky ${alias.replace("minsky:", "")} instead. Got: ${script}`,
        ).toBe(false);
      }
    }
  });
});
