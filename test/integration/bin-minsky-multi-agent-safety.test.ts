// Multi-agent git safety for the `bin/minsky` start-up path.
//
// Before this fix, `bin/minsky` ran `git clean -fd` on every daemon start
// — the single command on the global multi-agent git safety ban list
// ("deletes other agents' untracked files"). It also reset the host to
// `default_branch` even after a graceful `minsky stop`, surprising
// developers working on feature branches.
//
// Hypothesis (rule #9): a graceful `minsky stop` followed by `minsky`
// preserves the working tree's branch + uncommitted files; a crashed
// shutdown (no sentinel) reverts to `default_branch` but STASHES
// uncommitted work with a recoverable label instead of deleting it.
// Success: every test below passes. Pivot: if stash is unsafe in any
// path (worktrees, submodules), refuse to start the daemon when dirty
// rather than silently destroy.
// Measurement: this test file.
// Anchor: rule #6 (stay alive — never by destroying state); rule #17
// (proactive healing — every observed multi-agent-safety violation is
// a P0 fix); `~/.config/devin/AGENTS.md` § "Git Safety (Multi-Agent)"
// — `git clean -fd` is on the explicit ban list.

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

/**
 * Build an isolated fixture host repo. The repo has:
 *   - a `main` branch with one initial commit
 *   - a `feat/work-in-progress` branch with an untracked file
 *
 * Returns the absolute path. Caller is responsible for cleanup (tmp dir).
 */
function makeFixtureHost(): { dir: string; untrackedPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "bin-minsky-safety-"));
  execSync(
    "git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m 'chore: init' --no-verify",
    { cwd: dir, stdio: "pipe" },
  );
  execSync("git checkout -b feat/work-in-progress", { cwd: dir, stdio: "pipe" });
  const untrackedPath = join(dir, "important-uncommitted.txt");
  writeFileSync(untrackedPath, "valuable work in progress — DO NOT DELETE\n");
  return { dir, untrackedPath };
}

/**
 * Invoke `bin/minsky reset-host-if-crashed` — the new pure entry point
 * that performs the auto-recovery. The script writes its decisions to
 * stdout in a parseable form (`action: keep|stash|reset`, `branch: …`,
 * `stash: <ref>`, …) so tests can assert WITHOUT having to start the
 * full daemon. Same code path the real daemon uses.
 */
function invokeReset(hostDir: string, sentinelPath: string): string {
  return execSync(
    `${MINSKY_BIN} reset-host-if-crashed --host "${hostDir}" --sentinel "${sentinelPath}"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("bin/minsky multi-agent safety — never `git clean -fd`", () => {
  test("graceful stop sentinel present → branch + untracked files PRESERVED", () => {
    const { dir, untrackedPath } = makeFixtureHost();
    const sentinel = join(dir, ".minsky", "graceful-stop");
    execSync(`mkdir -p "${dir}/.minsky"`);
    writeFileSync(sentinel, new Date().toISOString());

    const out = invokeReset(dir, sentinel);

    expect(out).toContain("action: keep");
    expect(existsSync(untrackedPath)).toBe(true);
    const branch = execSync("git branch --show-current", { cwd: dir, encoding: "utf8" }).trim();
    expect(branch).toBe("feat/work-in-progress");
  });

  test("no sentinel (crashed) + dirty tree → STASHES + resets to main + no data loss", () => {
    const { dir, untrackedPath } = makeFixtureHost();
    // No sentinel — simulates a crashed previous shutdown
    const sentinel = join(dir, ".minsky", "graceful-stop");

    const out = invokeReset(dir, sentinel);

    expect(out).toContain("action: stash-and-reset");
    // The untracked file MUST live in a stash, not be deleted
    expect(existsSync(untrackedPath)).toBe(false); // moved into stash
    const stashList = execSync("git stash list", { cwd: dir, encoding: "utf8" }).trim();
    expect(stashList).toMatch(/minsky auto-stash/);
    // We reset to main
    const branch = execSync("git branch --show-current", { cwd: dir, encoding: "utf8" }).trim();
    expect(branch).toBe("main");
    // The operator-recovery hint appears in stdout
    expect(out).toMatch(/stash:\s*stash@\{0\}/);
  });

  test("no sentinel + clean tree → resets branch only, no stash needed", () => {
    const { dir } = makeFixtureHost();
    // Don't leave any untracked files
    execSync("git clean -fd && rm -f important-uncommitted.txt", { cwd: dir, stdio: "pipe" });
    const sentinel = join(dir, ".minsky", "graceful-stop");

    const out = invokeReset(dir, sentinel);

    expect(out).toContain("action: reset-only");
    expect(out).not.toMatch(/minsky auto-stash/);
    const branch = execSync("git branch --show-current", { cwd: dir, encoding: "utf8" }).trim();
    expect(branch).toBe("main");
  });

  test("graceful stop sentinel present + dirty tree → preserved, never touched", () => {
    const { dir, untrackedPath } = makeFixtureHost();
    const sentinel = join(dir, ".minsky", "graceful-stop");
    execSync(`mkdir -p "${dir}/.minsky"`);
    writeFileSync(sentinel, new Date().toISOString());
    // Also add a tracked-but-modified file
    writeFileSync(join(dir, "tracked-edit.txt"), "edit");
    execSync("git add tracked-edit.txt && git commit -m 'feat: add tracked' --no-verify", {
      cwd: dir,
      stdio: "pipe",
    });
    writeFileSync(join(dir, "tracked-edit.txt"), "modified after commit");

    const out = invokeReset(dir, sentinel);

    expect(out).toContain("action: keep");
    expect(existsSync(untrackedPath)).toBe(true);
    const diff = execSync("git diff --stat", { cwd: dir, encoding: "utf8" });
    expect(diff).toContain("tracked-edit.txt");
  });

  test("bin/minsky has NO executable `git clean -fd` invocation (comments OK)", () => {
    // Structural lint: the exact byte sequence is forbidden in
    // EXECUTABLE bash lines of `bin/minsky` per the multi-agent safety
    // rules. Comments referencing the historical anti-pattern are
    // allowed (they're the rationale for the fix). If a future PR re-
    // introduces a real invocation, this test fires.
    const src = readFileSync(MINSKY_BIN, "utf8");
    const executableLines = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(executableLines).not.toMatch(/git\s+(?:-C\s+\S+\s+)?clean\s+-fd/);
  });
});
