// Tests for heal-worktree-missing-node-modules
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import * as healMissing from "./heal-worktree-missing-node-modules.js";
import type {
  ExecResult,
  WorktreeMissingSeams,
} from "./heal-worktree-missing-node-modules.js";

type ExecCall = { command: string; args: readonly string[]; cwd: string };

function makeSeams(
  cwd: string,
  files: Set<string>,
  execImpl: (call: ExecCall) => ExecResult,
): { seams: WorktreeMissingSeams; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const seams: WorktreeMissingSeams = {
    cwd,
    existsSyncFn: (path) => files.has(path),
    execFn: (command, args, options) => {
      const call = { command, args, cwd: options.cwd };
      calls.push(call);
      const result = execImpl(call);
      // Test fixtures may create files in the response — simulate
      // pnpm install populating node_modules/.
      if (result.exitCode === 0) {
        files.add(`${options.cwd}/node_modules`);
        files.add(`${options.cwd}/node_modules/.bin/biome`);
      }
      return result;
    },
  };
  return { seams, calls };
}

const success: ExecResult = { exitCode: 0, stdout: "", stderr: "" };

describe("heal-worktree-missing-node-modules", () => {
  // scenario: "heal-worktree-missing-node-modules detects and installs"
  test("detects, applies, verifies under a worktree", () => {
    const cwd = "/host/.worktrees/feature-x";
    const files = new Set([`${cwd}/package.json`]);
    const { seams, calls } = makeSeams(cwd, files, () => success);

    const detected = healMissing.detect(seams);
    expect(detected.present).toBe(true);
    if (detected.present) {
      expect(detected.signal).toBe("missing-node-modules");
    }

    const applied = healMissing.apply(seams);
    expect(applied.applied).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("pnpm");
    expect(calls[0]?.args).toEqual(["install", "--prefer-offline"]);
    expect(calls[0]?.cwd).toBe(cwd);

    expect(healMissing.verify(seams)).toEqual({ healed: true });
  });

  // scenario: "heal-worktree-missing-node-modules verify-fails gracefully"
  test("verify returns healed:false when biome is still missing after install", () => {
    const cwd = "/host/.worktrees/feature-x";
    const files = new Set([`${cwd}/package.json`]);
    // Stub: exit 0 but don't materialize the biome binary.
    const { seams } = makeSeams(cwd, files, () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));
    // Override the auto-population behavior: remove biome after exec adds it.
    const realExec = seams.execFn;
    seams.execFn = (cmd, args, opts) => {
      const result = realExec(cmd, args, opts);
      files.delete(`${opts.cwd}/node_modules/.bin/biome`);
      return result;
    };

    healMissing.apply(seams);
    expect(healMissing.verify(seams)).toEqual({
      healed: false,
      residualSignal: "biome-missing-after-install",
    });
  });

  test("apply returns applied:false when pnpm install exits non-zero", () => {
    const cwd = "/host/.worktrees/feature-x";
    const files = new Set([`${cwd}/package.json`]);
    const { seams } = makeSeams(cwd, files, () => ({
      exitCode: 1,
      stdout: "",
      stderr: "network unreachable",
    }));
    const applied = healMissing.apply(seams);
    expect(applied.applied).toBe(false);
    expect(applied.notes).toContain("network unreachable");
  });

  // scenario: "heal-worktree-missing-node-modules is no-op outside a worktree"
  test("returns present:false outside a worktree even if node_modules is missing", () => {
    const cwd = "/host"; // NOT under .worktrees/
    const files = new Set([`${cwd}/package.json`]);
    const { seams } = makeSeams(cwd, files, () => success);
    expect(healMissing.detect(seams).present).toBe(false);
  });

  test("returns present:false when node_modules already exists", () => {
    const cwd = "/host/.worktrees/feature-x";
    const files = new Set([
      `${cwd}/package.json`,
      `${cwd}/node_modules`,
    ]);
    const { seams } = makeSeams(cwd, files, () => success);
    expect(healMissing.detect(seams).present).toBe(false);
  });

  test("returns present:false when package.json is missing", () => {
    const cwd = "/host/.worktrees/feature-x";
    const files = new Set<string>();
    const { seams } = makeSeams(cwd, files, () => success);
    expect(healMissing.detect(seams).present).toBe(false);
  });
});
