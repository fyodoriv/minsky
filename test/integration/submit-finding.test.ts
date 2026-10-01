/**
 * `minsky submit-finding` subcommand integration test (M1.8 substantive).
 *
 * Verifies the `bin/minsky submit-finding` subcommand:
 *   1. Requires `--message <text>`; exits 2 with actionable error otherwise.
 *   2. Rejects invalid `--priority` values.
 *   3. Inserts a well-formed rule-9 task block into the current repo's
 *      TASKS.md under the right priority header.
 *   4. The inserted block carries all 5 rule-9 fields (Hypothesis /
 *      Success / Pivot / Measurement / Anchor) with non-empty placeholder
 *      content (so the operator can edit later without the rule-9 lint
 *      failing pre-edit).
 *   5. The task ID is kebab-case-from-message with a numeric suffix
 *      (so two submissions of the same message produce distinct IDs).
 *
 * The full submit flow (`git checkout -b + git commit + gh pr create`)
 * is operator-staged — the subcommand prints next-steps but doesn't
 * execute git ops itself (so the operator can edit the block before
 * committing). This test pins the TASKS.md mutation behavior only.
 *
 * Hypothesis (rule #9): if these substrate invariants hold, an operator
 * running `minsky submit-finding --message "X"` in any minsky-aware
 * repo gets a well-shaped task block they can then commit + push +
 * open as a PR with no additional manual editing.
 * Success: every test below passes.
 * Pivot: if the inserted block fails `pnpm tasks-lint`, add the specific
 * lint failure mode as a new invariant here.
 * Measurement: this file (opt-in via MINSKY_RUN_INTEGRATION=1).
 * Anchor: user-stories/017-remote-task-submission.md § Acceptance
 * criterion §1; rule-9 lint at `scripts/check-rule-9-tasksmd-fields.mjs`.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const BIN_MINSKY = join(REPO_ROOT, "bin", "minsky");

const RUN_INTEGRATION =
  process.env["MINSKY_RUN_INTEGRATION"] === "1" ||
  process.env["CI"] === "true" ||
  process.env["VITEST_INTEGRATION"] === "1";

function makeFixtureTasksMd(): string {
  return [
    "# Tasks",
    "",
    "## P0",
    "",
    "- [ ] `existing-p0-task` — pre-existing P0 task",
    "  - **ID**: existing-p0-task",
    "  - **Tags**: p0",
    "",
    "## P2",
    "",
    "- [ ] `existing-p2-task` — pre-existing P2 task",
    "  - **ID**: existing-p2-task",
    "  - **Tags**: p2",
    "",
  ].join("\n");
}

function buildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
  };
}

describe.skipIf(!RUN_INTEGRATION)("minsky submit-finding (M1.8 substantive)", () => {
  test("requires --message; missing → exit 2 with actionable error", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-submit-test-"));
    writeFileSync(join(dir, "TASKS.md"), makeFixtureTasksMd());
    let exitCode = 0;
    let stderr = "";
    try {
      execSync(`bash "${BIN_MINSKY}" submit-finding`, {
        cwd: dir,
        encoding: "utf8",
        env: buildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      exitCode = e.status ?? 1;
      stderr = String(e.stderr ?? "");
    }
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--message <text> is required/);
  });

  test("rejects invalid --priority values", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-submit-test-"));
    writeFileSync(join(dir, "TASKS.md"), makeFixtureTasksMd());
    let exitCode = 0;
    let stderr = "";
    try {
      execSync(`bash "${BIN_MINSKY}" submit-finding --message "test finding" --priority p9`, {
        cwd: dir,
        encoding: "utf8",
        env: buildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      exitCode = e.status ?? 1;
      stderr = String(e.stderr ?? "");
    }
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--priority must be one of p0\|p1\|p2\|p3/);
  });

  test("refuses to insert when current dir has no TASKS.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-submit-test-"));
    let exitCode = 0;
    let stderr = "";
    try {
      execSync(`bash "${BIN_MINSKY}" submit-finding --message "test"`, {
        cwd: dir,
        encoding: "utf8",
        env: buildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      exitCode = e.status ?? 1;
      stderr = String(e.stderr ?? "");
    }
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/no TASKS\.md/);
  });

  test("inserts a well-formed rule-9 task block under default ## P2", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-submit-test-"));
    const tasksMdPath = join(dir, "TASKS.md");
    writeFileSync(tasksMdPath, makeFixtureTasksMd());
    execSync(`bash "${BIN_MINSKY}" submit-finding --message "the X probe is flaky on linux"`, {
      cwd: dir,
      encoding: "utf8",
      env: buildEnv(),
    });
    const updated = readFileSync(tasksMdPath, "utf8");
    // Inserted task block must contain all 5 rule-9 fields.
    expect(updated).toMatch(
      /- \[ \] `submit-the-x-probe-is-flaky-on-linux-\d+` — the X probe is flaky on linux/,
    );
    expect(updated).toMatch(/\*\*ID\*\*: submit-the-x-probe-is-flaky-on-linux-\d+/);
    expect(updated).toMatch(/\*\*Tags\*\*: auto-submitted,observation, p2/);
    expect(updated).toMatch(/\*\*Hypothesis\*\*: acting on `the X probe is flaky on linux`/);
    expect(updated).toMatch(/\*\*Success\*\*: a PR landing this finding's fix/);
    expect(updated).toMatch(/\*\*Pivot\*\*: if 2 attempts/);
    expect(updated).toMatch(/\*\*Measurement\*\*: `gh pr list/);
    expect(updated).toMatch(/\*\*Anchor\*\*: operator-submitted finding/);
    // Must be inserted UNDER ## P2 (default), not P0 or P3.
    const p2HeaderIdx = updated.indexOf("## P2");
    const insertedIdx = updated.indexOf("submit-the-x-probe-is-flaky-on-linux-");
    expect(insertedIdx).toBeGreaterThan(p2HeaderIdx);
    // Existing P2 task must STILL exist (no clobbering).
    expect(updated).toMatch(/existing-p2-task/);
    expect(updated).toMatch(/existing-p0-task/);
  });

  test("--priority p0 inserts under ## P0 instead of ## P2", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-submit-test-"));
    const tasksMdPath = join(dir, "TASKS.md");
    writeFileSync(tasksMdPath, makeFixtureTasksMd());
    execSync(
      `bash "${BIN_MINSKY}" submit-finding --message "urgent regression in module Y" --priority p0`,
      {
        cwd: dir,
        encoding: "utf8",
        env: buildEnv(),
      },
    );
    const updated = readFileSync(tasksMdPath, "utf8");
    const p0HeaderIdx = updated.indexOf("## P0");
    const p2HeaderIdx = updated.indexOf("## P2");
    const insertedIdx = updated.indexOf("submit-urgent-regression-in-module-y-");
    expect(insertedIdx).toBeGreaterThan(p0HeaderIdx);
    expect(insertedIdx).toBeLessThan(p2HeaderIdx);
  });

  test("two submissions of the same message produce DIFFERENT task IDs", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-submit-test-"));
    const tasksMdPath = join(dir, "TASKS.md");
    writeFileSync(tasksMdPath, makeFixtureTasksMd());
    execSync(`bash "${BIN_MINSKY}" submit-finding --message "duplicate message"`, {
      cwd: dir,
      encoding: "utf8",
      env: buildEnv(),
    });
    // Sleep briefly so the timestamp-suffix differs.
    execSync("sleep 1", { stdio: "pipe" });
    execSync(`bash "${BIN_MINSKY}" submit-finding --message "duplicate message"`, {
      cwd: dir,
      encoding: "utf8",
      env: buildEnv(),
    });
    const updated = readFileSync(tasksMdPath, "utf8");
    const matches = updated.match(/submit-duplicate-message-\d+/g) ?? [];
    // Two task blocks (each with `ID` + body refs) → expect at least 4 mentions
    // total, but uniqueness across the 2 IDs.
    const uniqueIds = [...new Set(matches)];
    expect(uniqueIds.length).toBe(2);
  });
});
