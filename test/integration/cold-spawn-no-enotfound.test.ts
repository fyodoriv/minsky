// Cold-spawn `bin/minsky` against a tmp MINSKY_REPO that has no
// `novel/cross-repo-runner/bin/minsky-run.mjs` (the Path A Phase 7
// gut state) and assert the shim NEVER emits a Node module-loader
// `Cannot find module` line.
//
// Security & privacy: N/A — fixtures use ephemeral tmpdirs, no
// credentials, no network, no user data. The shim invocations run
// in a cleanEnv() that strips all MINSKY_* vars.
//
// Hypothesis (rule #9): every code path that would `exec node
// "$RUNNER_BIN"` is guarded by an existence check that falls back
// to the bash runner. With the guard in place, a tmp repo that has
// `bin/minsky-run.sh` but no `.mjs` runs the bash runner; without
// the guard, `node` crashes with MODULE_NOT_FOUND.
// Success: stderr contains zero `Cannot find module` lines + exit
// code is anything except a Node loader crash (0 or graceful 1).
// Pivot: if the bash-runner fallback surfaces a behavior the .mjs
// runner uniquely provided, re-introduce a conditional Node path
// gated on `MINSKY_NODE_RUNNER=1` + file-exists check.
// Measurement: this test's pass/fail.
// Anchor: vision.md rule #6 (stay alive — no MODULE_NOT_FOUND crash
// loops); rule #11/#16 (default by default — bash runner is what
// works post Path A Phase 7); `docs/plans/2026-05-24-path-a-
// aggressive-cut.md` § Phase 7b.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

const GUARD_PATTERNS = [
  /\[\s*-[fxe]\s+"\$RUNNER_BIN"\s*\]/,
  /\[\[\s*-[fxe]\s+"\$RUNNER_BIN"\s*\]\]/,
  // Inline fallback to bash runner counts as the guard too.
  /BASH_RUNNER_BIN.*minsky-run\.sh/,
];

function isGuardLine(line: string): boolean {
  return GUARD_PATTERNS.some((pattern) => pattern.test(line));
}

function findUnguardedExecNodeLines(src: string): { line: number; text: string }[] {
  const lines = src.split("\n");
  const offenders: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/node "\$RUNNER_BIN"/.test(line)) continue;
    if (/^\s*#/.test(line)) continue;
    const lookbackStart = Math.max(0, i - 50);
    const guarded = lines.slice(lookbackStart, i).some(isGuardLine);
    if (!guarded) offenders.push({ line: i + 1, text: line.trim() });
  }
  return offenders;
}

function freshFakeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "cold-spawn-noenoent-"));
  // The bash runner — what the shim must fall back to.
  mkdirSync(join(repo, "bin"), { recursive: true });
  const bashRunner = join(repo, "bin", "minsky-run.sh");
  writeFileSync(
    bashRunner,
    ["#!/usr/bin/env bash", 'echo "stub bash runner invoked: $*"', "exit 0", ""].join("\n"),
  );
  chmodSync(bashRunner, 0o755);
  // novel/cross-repo-runner/bin/ exists but the .mjs DOES NOT — the
  // exact state of the operator's repo post Path A Phase 7 gut.
  mkdirSync(join(repo, "novel", "cross-repo-runner", "bin"), {
    recursive: true,
  });
  // bin/minsky's resolver also probes for a few sentinel files to
  // confirm we're "looking at a minsky repo". A throwaway AGENTS.md
  // satisfies the heuristic without pulling in real content.
  writeFileSync(join(repo, "AGENTS.md"), "# fake AGENTS.md for tests\n");
  return repo;
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("MINSKY_")) delete env[key];
  }
  env.MINSKY_NON_INTERACTIVE = "1";
  env.MINSKY_SKIP_DOCTOR = "1";
  env.HOME = mkdtempSync(join(tmpdir(), "cold-spawn-home-"));
  return env;
}

describe("cold-spawn: no MODULE_NOT_FOUND when .mjs runner is missing", () => {
  test("foreground default invocation falls back to bash runner instead of crashing", () => {
    const repo = freshFakeRepo();
    const env = cleanEnv();
    env.MINSKY_REPO = repo;
    // `--bash-runner` is supposed to be the explicit opt-in path —
    // the bug class is that the DEFAULT (no flag) path also crashes
    // with MODULE_NOT_FOUND when the .mjs is gone. We do not pass
    // --bash-runner here on purpose: the test pins the default
    // behaviour after the fix flips the default.
    const result = spawnSync(MINSKY_BIN, ["--host", repo], {
      encoding: "utf8",
      env,
      timeout: 15_000,
    });
    expect(result.stderr).not.toContain("Cannot find module");
    expect(result.stderr).not.toMatch(/MODULE_NOT_FOUND/);
    // Stub bash runner exits 0 — if the fallback fired, exit is 0.
    // If the shim hard-fails with a graceful "runner missing"
    // message, exit is 1 and stdout is empty. Either is acceptable;
    // a Node loader crash is not.
    expect([0, 1]).toContain(result.status);
  });

  test("--daemon path does not exec node against the missing .mjs", () => {
    // Daemon mode at line ~3088 of bin/minsky backgrounds `node
    // $RUNNER_BIN`; the parent script exits 0 immediately, but any
    // MODULE_NOT_FOUND fires in the parent's pre-fork code paths
    // (resolver, existence check). The test exercises the parent.
    const repo = freshFakeRepo();
    const env = cleanEnv();
    env.MINSKY_REPO = repo;
    env.MINSKY_DAEMON_LOG = join(env.HOME ?? "", ".minsky-daemon.log");
    env.MINSKY_DAEMON_PID = join(env.HOME ?? "", ".minsky-daemon.pid");
    env.MINSKY_STATE_DIR = join(env.HOME ?? "", ".minsky");
    const result = spawnSync(MINSKY_BIN, ["--daemon", "--host", repo], {
      encoding: "utf8",
      env,
      timeout: 15_000,
    });
    expect(result.stderr).not.toContain("Cannot find module");
    expect(result.stderr).not.toMatch(/MODULE_NOT_FOUND/);
  });

  test('source-level check: every `node "$RUNNER_BIN"` is guarded', () => {
    // Belt + suspenders: parse bin/minsky and verify every line
    // that contains `node "$RUNNER_BIN"` is either (a) preceded by
    // an existence check on the same path, or (b) commented out /
    // marked dead. Catches future regressions where someone adds a
    // new `exec node "$RUNNER_BIN"` without the guard.
    const src = readFileSync(MINSKY_BIN, "utf8");
    const offenders = findUnguardedExecNodeLines(src);
    expect(offenders).toEqual([]);
  });
});
