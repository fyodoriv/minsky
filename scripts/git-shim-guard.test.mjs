// Behavior tests for .claude/shims/git — every fixture invokes the shim
// directly (NOT real git) with controlled argv, asserts exit code, and
// confirms the shim sees argv (not prose) so quoted-string mentions of
// forbidden commands no longer trip a guard.
//
// Pins acceptance criteria (a)-(d) for `dangerous-bash-guard-script-
// indirect-gap`: indirect destructive git is blocked in the operator
// root; the same call passes in worktrees; safe subcommands pass
// everywhere; the quoted-string-mention FP class is gone.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHIM = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".claude",
  "shims",
  "git",
);

// macOS has `true` only at /usr/bin/true (no /bin/true). The shim
// passthrough path uses this binary as a no-op real-git stand-in so the
// "allows X" cases assert exit 0 without mutating any real git state.
const NO_OP_GIT = "/usr/bin/true";

/**
 * Run the shim with controlled argv. `realGit` defaults to /usr/bin/true
 * so "passes" cases don't actually mutate git state — the shim's job is
 * to decide block-vs-passthrough, and passthrough to a no-op exits 0.
 * Forbidden cases that DO reach the case-branch trigger emit_block
 * before the exec, so realGit is never invoked for them.
 * @param {string[]} args
 * @param {"main"|"worktree"} treeKind
 * @param {string} realGit
 */
function runShim(args, treeKind = "main", realGit = NO_OP_GIT) {
  try {
    execFileSync("bash", [SHIM, ...args], {
      env: {
        ...process.env,
        BDB_TREE_KIND_OVERRIDE: treeKind,
        MINSKY_GIT_SHIM_REAL_GIT: realGit,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return 0;
  } catch (err) {
    return /** @type {{ status?: number }} */ (err).status ?? 1;
  }
}

describe("git-shim wholesale-revert coverage (operator root)", () => {
  it.each([
    [["reset", "--hard"]],
    [["reset", "--hard", "HEAD"]],
    [["restore", "."]],
    [["restore", "--", "."]],
    [["restore", ":/"]],
    [["restore", "--staged", "--worktree", "."]],
    [["checkout", "."]],
    [["checkout", "--", "."]],
    [["checkout", "HEAD", "--", "."]],
    [["clean", "-fd"]],
    [["clean", "-fdx"]],
    [["clean", "-f"]],
    [["stash", "drop"]],
    [["stash", "clear"]],
  ])("blocks %j in main checkout", (argv) => {
    expect(runShim(argv, "main")).toBe(2);
  });

  it.each([
    [["status", "--short"]],
    [["log", "--oneline", "-5"]],
    [["diff", "HEAD"]],
    [["restore", "TASKS.md"]],
    [["restore", "scripts/foo.mjs", "docs/bar.md"]],
    [["restore", "--staged", "TASKS.md"]],
    [["stash", "show", "-p"]],
    [["stash", "pop"]],
    [["stash", "list"]],
    [["checkout", "README.md"]],
    [["fetch", "--all"]],
    [["pull", "--ff-only"]],
    [["add", "TASKS.md"]],
  ])("allows %j in main checkout", (argv) => {
    expect(runShim(argv, "main")).toBe(0);
  });
});

describe("git-shim operator-root branch-switch guard", () => {
  it.each([
    [["checkout", "feat/npm-publish-scoped-fyodoriv"]],
    [["checkout", "-b", "feat/new-thing"]],
    [["checkout", "-B", "fix/redo"]],
    [["switch", "feat/new-thing"]],
    [["switch", "-c", "chore/cleanup"]],
    [["switch", "-C", "test/x"]],
  ])("blocks %j in main checkout", (argv) => {
    expect(runShim(argv, "main")).toBe(2);
  });

  it.each([
    [["checkout", "main"]],
    [["checkout", "master"]],
    [["checkout", "README.md"]],
    [["switch", "main"]],
  ])("allows %j even in main checkout (non-feature ref)", (argv) => {
    expect(runShim(argv, "main")).toBe(0);
  });

  it.each([
    [["checkout", "feat/new-thing"]],
    [["checkout", "-b", "feat/x"]],
    [["restore", "."]],
    [["reset", "--hard"]],
    [["clean", "-fd"]],
  ])("allows %j inside a worktree (per-agent isolation)", (argv) => {
    expect(runShim(argv, "worktree")).toBe(0);
  });
});

describe("git-shim --no-verify / hook-bypass guard", () => {
  it.each([
    [["commit", "--no-verify", "-m", "x"]],
    [["commit", "-m", "x", "--no-verify"]],
    [["tag", "--no-verify", "v1.0"]],
  ])("blocks %j", (argv) => {
    expect(runShim(argv, "main")).toBe(2);
  });

  it.each([
    [["commit", "-m", "feat: thing"]],
    [["commit", "-am", "fix: thing"]],
    [["tag", "v1.0"]],
  ])("allows %j", (argv) => {
    expect(runShim(argv, "main")).toBe(0);
  });
});

describe("git-shim quoted-string FP fix (argv-level, not prose)", () => {
  // The PreToolUse hook strips heredoc bodies but cannot strip quoted
  // argv tokens, so a legitimate commit/doc that MENTIONS a forbidden
  // command in a -m argument or filename trips it. The shim sees argv,
  // so quoted prose never reaches a guard branch — it only inspects
  // the SUBCMD and structural args.
  it.each([
    [["commit", "-m", "docs: explain why git reset --hard is forbidden"]],
    [["commit", "-m", "fix: remove the `git restore .` foot-gun"]],
    [["log", "--grep", "reset --hard"]],
    [["commit", "-F", "/tmp/commit-msg-mentioning-git-clean-fd.txt"]],
  ])("allows %j (forbidden text in argv values, not in shape)", (argv) => {
    expect(runShim(argv, "main")).toBe(0);
  });
});

describe("git-shim canonical task measurement (indirect via script)", () => {
  // The exact form named in the task's Measurement field: a script that
  // internally runs a wholesale revert. The shim shadows real git via
  // PATH, so when the script's `git restore .` resolves, the shim runs.
  it("blocks an indirect wholesale revert in main checkout", () => {
    const script = "/tmp/minsky-shim-evil-test.sh";
    execFileSync("bash", [
      "-c",
      `printf '#!/bin/sh\\ngit restore .\\n' > ${script} && chmod +x ${script}`,
    ]);
    const shimDir = path.dirname(SHIM);
    let exitCode = 0;
    try {
      execFileSync("bash", [script], {
        env: {
          ...process.env,
          BDB_TREE_KIND_OVERRIDE: "main",
          MINSKY_GIT_SHIM_REAL_GIT: NO_OP_GIT,
          PATH: `${shimDir}:${process.env["PATH"]}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      exitCode = /** @type {{ status?: number }} */ (err).status ?? 1;
    }
    expect(exitCode).toBe(2);
  });

  it("passes the same indirect call inside a worktree", () => {
    const script = "/tmp/minsky-shim-evil-test.sh";
    execFileSync("bash", [
      "-c",
      `printf '#!/bin/sh\\ngit restore .\\n' > ${script} && chmod +x ${script}`,
    ]);
    const shimDir = path.dirname(SHIM);
    const exitCode = (() => {
      try {
        execFileSync("bash", [script], {
          env: {
            ...process.env,
            BDB_TREE_KIND_OVERRIDE: "worktree",
            MINSKY_GIT_SHIM_REAL_GIT: NO_OP_GIT,
            PATH: `${shimDir}:${process.env["PATH"]}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        return 0;
      } catch (err) {
        return /** @type {{ status?: number }} */ (err).status ?? 1;
      }
    })();
    expect(exitCode).toBe(0);
  });
});
