// <!-- scope: P0 `local-worker-worktree-never-created` slice 1 (operator 2026-05-16 dogfood) -->

import { join } from "node:path";
import { workerBranchName, workerWorktreeName } from "./worker-config.js";

/**
 * Strategy seam (rule #2): git + fs are injected so the orchestration is
 * unit-testable without touching a real repo.
 */
export interface EnsureWorktreeDeps {
  /** True if `path` exists on disk (production: `fs.existsSync`). */
  readonly exists: (path: string) => boolean;
  /**
   * Run `git <args>` synchronously. MUST throw on a non-zero exit
   * (production: `child_process.execFileSync("git", args)`), so a failure
   * to establish the workspace is loud (rule #6 / Armstrong 2007).
   */
  readonly git: (args: readonly string[]) => void;
}

export interface EnsureWorktreeInput {
  /** Absolute path to the minsky repo checkout that owns `.git`. */
  readonly minskyHome: string;
  readonly workerId: number;
  readonly taskId: string;
  /** Base commit-ish for a fresh worktree branch. Default `origin/main`. */
  readonly baseRef?: string;
}

/**
 * Idempotently ensure the per-worker git worktree exists so the local
 * (aider / opencode) spawn can `cwd` into it.
 *
 * Why this exists: the **claude** spawn path gets a worktree for free via
 * `claude --worktree <name>` (Claude Code creates it). The **local** path
 * (`MINSKY_LLM_PROVIDER=local-preferred`) took the `--worktree` arg out of
 * the equation but still set the spawn `cwd` to
 * `<minskyHome>/.claude/worktrees/daemon-<id>-<taskId>` — a directory
 * **nothing ever created**. Every local iteration therefore spawned aider
 * into a missing (or stale-`gitdir`-pointer) directory and died at git
 * setup before the model ran. See P0 `local-worker-worktree-never-created`.
 *
 * The worktree is created with `git -C <minskyHome> worktree add` so its
 * `.git` file resolves to `<minskyHome>/.git/worktrees/<name>` — the
 * original failure was a leftover dir whose `gitdir:` pointed at a repo
 * root that no longer exists.
 *
 * @returns the absolute worktree directory (to be used as the spawn cwd).
 */
export function ensureWorktree(input: EnsureWorktreeInput, deps: EnsureWorktreeDeps): string {
  const name = workerWorktreeName({ workerId: input.workerId, taskId: input.taskId });
  const branch = workerBranchName({ workerId: input.workerId, taskId: input.taskId });
  const worktreeDir = join(input.minskyHome, ".claude", "worktrees", name);

  // Idempotent: a valid worktree from an earlier tick is reused as-is.
  if (deps.exists(join(worktreeDir, ".git"))) return worktreeDir;

  const base = input.baseRef ?? "origin/main";
  // Clear dead admin entries (e.g. from a pre-repo-move era) before
  // (re)adding, then force-create against minskyHome's repo.
  deps.git(["-C", input.minskyHome, "worktree", "prune"]);
  deps.git(["-C", input.minskyHome, "worktree", "add", "--force", "-B", branch, worktreeDir, base]);
  return worktreeDir;
}
