// Behavior tests for .claude/hooks/block-dangerous-bash.sh — every fixture
// pipes a PreToolUse JSON payload through the real hook script and asserts
// the exit code. Pins the incident class from 2026-06-10 (wholesale
// `git restore .` wipe + feature-branch checkout in the shared operator
// root) and the heredoc false-positive fix.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".claude",
  "hooks",
  "block-dangerous-bash.sh",
);

/** @param {string} command @param {"main"|"worktree"} treeKind */
function runHook(command, treeKind = "main") {
  const input = JSON.stringify({ tool_input: { command } });
  try {
    execFileSync("bash", [HOOK], {
      input,
      env: { ...process.env, BDB_TREE_KIND_OVERRIDE: treeKind },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (err) {
    return /** @type {{ status?: number }} */ (err).status ?? 1;
  }
}

const RESET_HARD = ["git", "reset", "--hard"].join(" ");

describe("block-dangerous-bash.sh wholesale-revert coverage", () => {
  it.each([
    ["git restore ."],
    ["git restore -- ."],
    ["git restore :/"],
    ["git restore --staged --worktree ."],
    ["git checkout HEAD -- ."],
    ["git checkout origin/main -- ."],
    [RESET_HARD],
    ["git stash drop"],
    ["git stash clear"],
  ])("blocks %s", (cmd) => {
    expect(runHook(cmd)).toBe(2);
  });

  it.each([
    ["git restore TASKS.md"],
    ["git restore scripts/foo.mjs docs/bar.md"],
    ["git restore --staged TASKS.md"],
    ["git stash show -p"],
    ["git stash pop"],
    ["git stash list"],
    ["git status --short"],
  ])("allows %s", (cmd) => {
    expect(runHook(cmd)).toBe(0);
  });
});

describe("block-dangerous-bash.sh operator-root branch-switch guard", () => {
  it.each([
    ["git checkout feat/npm-publish-scoped-fyodoriv"],
    ["git checkout -b feat/new-thing"],
    ["git checkout -B fix/redo"],
    ["git switch feat/new-thing"],
    ["git switch -c chore/cleanup"],
  ])("blocks %s in the main checkout", (cmd) => {
    expect(runHook(cmd, "main")).toBe(2);
  });

  it.each([
    ["git checkout feat/npm-publish-scoped-fyodoriv"],
    ["git checkout -b feat/new-thing"],
    ["git switch -c chore/cleanup"],
  ])("allows %s inside a worktree", (cmd) => {
    expect(runHook(cmd, "worktree")).toBe(0);
  });

  it.each([
    ["git checkout main"],
    ["git checkout master"],
    ["git checkout README.md"],
    ["cd /tmp/minsky-task-wt && git checkout -b feat/x"],
    ["git -C /tmp/minsky-task-wt checkout -b feat/x"],
    ["git worktree add /tmp/minsky-task-wt -b feat/x origin/main"],
  ])("allows %s even in the main checkout", (cmd) => {
    expect(runHook(cmd, "main")).toBe(0);
  });
});

describe("block-dangerous-bash.sh heredoc false-positive fix", () => {
  it("allows a heredoc whose BODY mentions forbidden commands", () => {
    const cmd = [
      "cat > /tmp/commit-msg.txt <<'EOF'",
      `docs: explain why ${RESET_HARD} is forbidden`,
      "",
      `A sibling session ran ${RESET_HARD} and git restore . in the`,
      "shared checkout, wiping uncommitted work.",
      "EOF",
      "git commit -F /tmp/commit-msg.txt",
    ].join("\n");
    expect(runHook(cmd)).toBe(0);
  });

  it("still blocks a forbidden command AFTER a heredoc ends", () => {
    const cmd = [
      "cat > /tmp/note.txt <<'EOF'",
      "harmless text",
      "EOF",
      RESET_HARD,
    ].join("\n");
    expect(runHook(cmd)).toBe(2);
  });

  it("still blocks a forbidden command BEFORE a heredoc", () => {
    const cmd = [
      RESET_HARD,
      "cat > /tmp/note.txt <<'EOF'",
      "harmless text",
      "EOF",
    ].join("\n");
    expect(runHook(cmd)).toBe(2);
  });
});
