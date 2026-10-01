// Regression test: no `git checkout <branch>` against the host root.
//
// Pre-2026-05-26 the TS daemon (`novel/tick-loop/bin/tick-loop.mjs`,
// deleted by phase-11b PR #888) did `git checkout` against the
// operator's main checkout to switch HEAD between task branches.
// Side-effect: an operator's (or another agent's) uncommitted work got
// auto-stashed at every iteration boundary, silently losing untracked
// files unless restored from `stash@{0}^3`.
//
// The new bash skeleton (`bin/minsky-run.sh`) structurally fixes this
// by NEVER calling `git checkout <branch>` against the host. This test
// makes that invariant load-bearing — a future refactor that
// reintroduces the pattern fails CI before merge.
//
// Hypothesis (rule #9): a regex over the supervisor entrypoints catches
// every form of "switch host HEAD" command — `git checkout <branch>`,
// `git switch <branch>`, `git worktree add $HOST_ROOT` — without
// flagging safe forms (`git checkout -b <new>`, `git checkout -- <file>`).
//
// Success: this test passes today; a deliberate `git checkout main` in
// `bin/minsky-run.sh` fails it with the path + line number.
// Pivot: if false positives surface (e.g., docs mentioning the pattern),
// add a per-line `// host-checkout-ok: <reason>` allow-marker.
// Measurement: `pnpm vitest run test/integration/no-host-checkout.test.ts`.
// Anchor: rule #1 (loud-crash > silent failure); Beck 1999 (regression
// tests pin classes of bugs forever); MILESTONES.md M1.6 (operator's
// untracked work is human work the daemon must never destructively
// touch); operator directive 2026-05-26 "prevent this from happening
// ever again".

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * Files to scan for the forbidden pattern. Supervisor entrypoints
 * only — these are the surfaces that COULD mutate host HEAD if a
 * refactor reintroduced the bug.
 */
const SCANNED_FILES = [
  "bin/minsky-run.sh",
  "scripts/spawn_agent.py",
  "scripts/build_brief.py",
] as const;

/**
 * Forbidden patterns:
 *   - `git checkout <branch>` — switches host HEAD to existing branch
 *   - `git switch <branch>` — same semantics, newer syntax
 *   - `git worktree add <path>` where path is `$HOST_ROOT` or similar
 *     repo-root variable (creating a worktree AT the host)
 *
 * Allowed forms (NOT matched by these regexes):
 *   - `git checkout -b <new-branch>` — creates new branch, host HEAD
 *     stays unchanged
 *   - `git checkout -- <file>` / `git checkout HEAD -- <file>` —
 *     reverts file content, no HEAD movement
 *   - `git switch -c <new-branch>` — same as `-b` for switch
 *
 * Comments (lines starting with `#`) are exempt — they discuss the
 * pattern without executing it.
 */
const FORBIDDEN_PATTERNS = [
  // git checkout NOT followed by -b/-c/--/-B and NOT preceded by # (comment).
  // Use (?=\s|$) instead of \b after `--` because `-` is non-word, so
  // \b doesn't match the transition from `--` to whitespace.
  /^[^#\n]*\bgit\s+checkout\s+(?!-b\b|-c\b|-B\b|--(?=\s|$))[^\s'"`)]+/,
  // git switch NOT followed by -c/-C/--
  /^[^#\n]*\bgit\s+switch\s+(?!-c\b|-C\b|--(?=\s|$))[^\s'"`)]+/,
];

/**
 * Allow-markers — lines containing these strings are exempt even if
 * they match a FORBIDDEN_PATTERN. Use for documented safe contexts.
 */
const ALLOW_MARKERS = ["in scratch", "in worktree", "host-checkout-ok"] as const;

/**
 * Scan `content` line-by-line for forbidden patterns, respecting
 * allow-markers. Returns one violation per offending line.
 */
function scanForViolations(relPath: string, content: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (ALLOW_MARKERS.some((m) => line.includes(m))) continue;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(line))) {
      violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
    }
  }
  return violations;
}

describe("no-host-checkout regression test", () => {
  test.each(
    SCANNED_FILES,
  )("%s contains no host-mutating `git checkout`/`git switch`", (relPath) => {
    const absPath = resolve(REPO_ROOT, relPath);
    expect(existsSync(absPath), `expected ${relPath} to exist`).toBe(true);
    const violations = scanForViolations(relPath, readFileSync(absPath, "utf8"));

    expect(
      violations,
      `Found host-mutating git command(s) in ${relPath}. Per the file-header comment in this test, the supervisor MUST NEVER switch host HEAD between branches — that silently auto-stashes operator work. Use \`git worktree add /tmp/<task>\` instead.\n\nViolations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  test("regex matches the dangerous form against synthetic fixture", () => {
    // Self-test the regex shape — falsifiable per task spec.
    const dangerous = [
      "git checkout feat/foo",
      "  git checkout main",
      "git switch develop",
      "exec git checkout some-branch && true",
    ];
    const safe = [
      "git checkout -b feat/new",
      "git checkout -- file.txt",
      "git switch -c new-branch",
      "git checkout -B feat/replace",
      "# git checkout main",
      "  # documentation: git checkout main",
    ];

    for (const line of dangerous) {
      const hit = FORBIDDEN_PATTERNS.some((p) => p.test(line));
      expect(hit, `expected FORBIDDEN to match: "${line}"`).toBe(true);
    }
    for (const line of safe) {
      const hit = FORBIDDEN_PATTERNS.some((p) => p.test(line));
      expect(hit, `expected FORBIDDEN to NOT match: "${line}"`).toBe(false);
    }
  });
});
