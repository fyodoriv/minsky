// Pins the verdict-notes visibility improvement + brief-prepend
// uncommitted-warning in bin/minsky-run.sh.
//
// History: 2026-05-28 monitoring round caught the daemon writing a
// 221-line `novel/adapters/a2a.ts` during one iteration (real file
// edits, real work, but broken imports — incomplete code). The agent
// never `git add`-ed the file. Subsequent iterations started fresh
// "Analyzing the task requirements..." while the prior file sat
// untracked in the worktree. TWO bugs surfaced:
//
//   1. Verdict notes said "agent exited cleanly without commits/PR/push
//      (no useful work)" — false. The agent HAD edited 1 file. The
//      operator couldn't tell from .minsky/iterations.jsonl that work
//      was happening; the dashboard showed pure no-progress.
//
//   2. The brief had NO mechanism to tell the next iteration about
//      prior uncommitted work — so each iteration re-explored from
//      scratch instead of building on the prior one.
//
// This PR fixes both: (a) verdict notes call out uncommitted work
// explicitly; (b) when the worktree has uncommitted changes, the brief
// is prepended with a notice telling the agent to inspect + commit/fix
// before doing anything else.
//
// Source-level pin: the bash source must contain the new
// uncommitted-work code paths. A live integration test would require
// driving a full iteration end-to-end (out of scope for unit gating);
// the source-level check is the practical gate, same shape as the
// supervisor-stays-alive-loop test.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUN_SH = join(REPO_ROOT, "bin", "minsky-run.sh");

describe("verdict-uncommitted-progress: visibility + brief-prepend", () => {
  test("verdict-notes branch for uncommitted-only progress exists", () => {
    // The bash must call `git status --porcelain` and emit a distinct
    // notes message when there are uncommitted changes but no commits.
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(/working_tree_changes=.*git -C "\$worktree" status --porcelain/);
    expect(src).toMatch(
      /agent edited \$\{working_tree_changes\} file\(s\) in worktree but did not commit/,
    );
  });

  test("verdict-notes ordering: commits-first, then uncommitted, then nothing", () => {
    // Order matters: when commits exist, that's the stronger signal.
    // Only if commits_count == 0 do we fall through to the
    // working_tree_changes check.
    const src = readFileSync(RUN_SH, "utf8");
    const commitsBranch = src.indexOf("no PR opened but agent committed");
    const uncommittedBranch = src.indexOf("did not commit (uncommitted progress");
    const noopBranch = src.indexOf("agent exited cleanly without commits/PR/push");
    expect(commitsBranch).toBeGreaterThan(0);
    expect(uncommittedBranch).toBeGreaterThan(0);
    expect(noopBranch).toBeGreaterThan(0);
    expect(commitsBranch).toBeLessThan(uncommittedBranch);
    expect(uncommittedBranch).toBeLessThan(noopBranch);
  });

  test("brief-prepend block inspects the worktree before spawning the agent", () => {
    // The brief-prepend code reads `git status --porcelain` and only
    // emits the notice when output is non-empty. This is the
    // continuation-hint mechanism that lets agents build on prior
    // iterations instead of restarting from scratch.
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(/worktree_for_brief="\$host\/\.worktrees\/daemon-\$\{task_id\}"/);
    expect(src).toMatch(
      /uncommitted_summary="\$\(git -C "\$worktree_for_brief" status --porcelain/,
    );
    expect(src).toMatch(/PRIOR-ITERATION UNCOMMITTED WORK IN THIS WORKTREE/);
  });

  test("brief-prepend notice is honest about the work potentially being broken", () => {
    // Pre-fix iteration's a2a.ts had broken imports (referenced a
    // non-existent @minsky/adapter-types package). The brief-prepend
    // MUST NOT tell the agent "the prior work is correct, keep going"
    // — it must instruct the agent to inspect first, then decide
    // commit-or-fix-or-restart.
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(/may be incomplete or broken/);
    expect(src).toMatch(/\\`cat\\`.*file_editor view.*\\`git diff\\`/);
    expect(src).toMatch(/commit \+ push.*OR.*\\`git restore\\`/);
  });

  test("brief-prepend skips the worktree-not-yet-created case (no prior iteration)", () => {
    // The prepend is gated on the worktree directory existing AND
    // having a `.git`. Fresh tasks (no prior iteration) skip the
    // prepend entirely so the brief isn't polluted with empty
    // "PRIOR-ITERATION" notices.
    const src = readFileSync(RUN_SH, "utf8");
    expect(src).toMatch(
      /if \[\[ -d "\$worktree_for_brief\/\.git" \]\] \|\| \[\[ -f "\$worktree_for_brief\/\.git" \]\]/,
    );
  });
});
