// Helper: heal-worktree-missing-node-modules
//
// Catalogued failure mode: `MODULE_NOT_FOUND` from biome/lefthook when a
// fresh worktree gets a pre-commit / pre-push hook before `pnpm install`
// has populated its `node_modules/`. Detect → run `pnpm install
// --prefer-offline`.
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-worktree-missing-node-modules detects and installs"
//   - "heal-worktree-missing-node-modules verify-fails gracefully"
//   - "heal-worktree-missing-node-modules is no-op outside a worktree"

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Result of running a child process. Matches Node's `child_process` shape. */
export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** Injected I/O seams. */
export type WorktreeMissingSeams = {
  /** Absolute path to the directory to check. */
  cwd: string;
  existsSyncFn: (path: string) => boolean;
  /** Synchronously execute a command. Tests inject a stub. */
  execFn: (
    command: string,
    args: readonly string[],
    options: { cwd: string },
  ) => ExecResult;
};

const isUnderWorktrees = (cwd: string): boolean =>
  cwd.includes("/.worktrees/");

export function detect(seams: WorktreeMissingSeams): DetectResult {
  if (!isUnderWorktrees(seams.cwd)) {
    return { present: false };
  }
  const packageJson = `${seams.cwd}/package.json`;
  const nodeModules = `${seams.cwd}/node_modules`;
  if (!seams.existsSyncFn(packageJson)) {
    return { present: false };
  }
  if (seams.existsSyncFn(nodeModules)) {
    return { present: false };
  }
  return {
    present: true,
    signal: "missing-node-modules",
    evidence: { cwd: seams.cwd, packageJson },
  };
}

export function apply(seams: WorktreeMissingSeams): ApplyResult {
  const result = seams.execFn(
    "pnpm",
    ["install", "--prefer-offline"],
    { cwd: seams.cwd },
  );
  if (result.exitCode !== 0) {
    return {
      applied: false,
      changedFiles: [],
      notes: `pnpm install failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`,
    };
  }
  return {
    applied: true,
    changedFiles: [`${seams.cwd}/node_modules`],
    notes: "pnpm install --prefer-offline succeeded",
  };
}

export function verify(seams: WorktreeMissingSeams): VerifyResult {
  // The catalogue signal was MODULE_NOT_FOUND from biome/lefthook —
  // verify by checking the binary that triggered the original failure.
  const biomePath = `${seams.cwd}/node_modules/.bin/biome`;
  if (!seams.existsSyncFn(biomePath)) {
    return { healed: false, residualSignal: "biome-missing-after-install" };
  }
  return { healed: true };
}
