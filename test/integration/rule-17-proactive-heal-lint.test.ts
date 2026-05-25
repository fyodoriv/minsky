// Integration tests for the rule-#17 proactive-heal lint
// (`scripts/check-rule-17-proactive-heal.mjs`).
//
// Extracted in PR #880 (phase-7b step 4) from the deleted
// `test/integration/proactive-healing-regressions.test.ts`. The rest of
// that file tested the TS cross-repo-runner binary's behaviour — that
// surface is going away in phase-7b step 5; the bash skeleton (`bin/
// minsky-run.sh`) is now the canonical iteration runner and its
// equivalent behaviours are covered by `tests/iter-once.bats` (24
// tests added by PR #875). The 3 tests preserved here verify the
// independent lint binary — they have no cross-repo-runner coupling.
//
// Source: rule #17 (vision.md § proactive healing — observation IS
// the fix); operator directive 2026-05-19 (the bug class that
// motivated the lint).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/**
 * Sanitised env — strips MINSKY_*, isolates HOME so tests don't read
 * the operator's `~/.minsky/config.json` or collide with a running
 * daemon.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("MINSKY_")) delete env[key];
  }
  env.MINSKY_NON_INTERACTIVE = "1";
  env.HOME = mkdtempSync(join(tmpdir(), "rule17-lint-home-"));
  return env;
}

describe("rule #17 — proactive-heal lint is wired and fires on bad PR bodies", () => {
  test("lint binary exists and is runnable", () => {
    const out = execFileSync(
      "node",
      [join(REPO_ROOT, "scripts/check-rule-17-proactive-heal.mjs"), "--diff-base=HEAD"],
      { encoding: "utf8", env: cleanEnv(), timeout: 10_000 },
    );
    expect(out).toContain("rule-17 ok");
  });

  test("lint fails on a 'watcher who narrates' summary file", () => {
    const summary = mkdtempSync(join(tmpdir(), "rule17-summary-"));
    const summaryPath = join(summary, "summary.txt");
    writeFileSync(
      summaryPath,
      [
        "=== observer summary ===",
        "spawn-failed × 3",
        "scope-leak × 2",
        "HTTP 401 from GraphQL",
        "(no fixes filed; will follow up next session)",
      ].join("\n"),
    );
    let exitCode = 0;
    try {
      execFileSync(
        "node",
        [join(REPO_ROOT, "scripts/check-rule-17-proactive-heal.mjs"), `--summary=${summaryPath}`],
        { encoding: "utf8", env: cleanEnv(), timeout: 10_000, stdio: "pipe" },
      );
    } catch (err: unknown) {
      const e = err as { status?: number };
      exitCode = e.status ?? 1;
    }
    expect(exitCode).toBeGreaterThan(0);
  });

  test("lint passes on summary with errors + healing evidence", () => {
    const summary = mkdtempSync(join(tmpdir(), "rule17-ok-"));
    const summaryPath = join(summary, "summary.txt");
    writeFileSync(
      summaryPath,
      [
        "spawn-failed surfaced × 1",
        "Filed `gh-auth-divergence` with **Blocked**: needs-operator-gh-auth-login",
        "Rolled out fix for the 401 cascade",
        "prs-opened: 1",
      ].join("\n"),
    );
    const out = execFileSync(
      "node",
      [join(REPO_ROOT, "scripts/check-rule-17-proactive-heal.mjs"), `--summary=${summaryPath}`],
      { encoding: "utf8", env: cleanEnv(), timeout: 10_000 },
    );
    expect(out).toContain("rule-17 ok");
  });
});
