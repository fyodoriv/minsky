// Every check-rule script that reads repo files accepts `--repo=<path>`
// (or `--repo <path>`), so a sibling repo can run the same gate on its own
// tree. Each case points the script at a fixture repo and asserts the
// result comes from the fixture, not from this checkout.
// Pattern: xUnit fresh fixture (Meszaros, *xUnit Test Patterns*, 2007).

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** @type {string[]} */
const dirs = [];

/** @param {Record<string, string>} files */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "check-rule-repo-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/**
 * @param {string} script
 * @param {string[]} args
 */
function run(script, args) {
  return spawnSync(process.execPath, [resolve(HERE, script), ...args], { encoding: "utf8" });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ONE_BAD_P0 = [
  "# Tasks",
  "",
  "## P0",
  "",
  "- [ ] `fixture-task` — a task with no rule-9 fields",
  "  - **ID**: fixture-task",
  "  - **Tags**: p0",
  "",
].join("\n");

describe("check-rule-9 --repo", () => {
  /** @type {((dir: string) => string[])[]} */
  const forms = [(dir) => [`--repo=${dir}`], (dir) => ["--repo", dir]];
  for (const form of forms) {
    test(`reads TASKS.md from the fixture (${form("X").join(" ")})`, () => {
      const dir = fixtureRepo({ "TASKS.md": ONE_BAD_P0 });
      const out = run("check-rule-9-tasksmd-fields.mjs", form(dir));
      expect(out.stdout).toContain("scanned 1 task block(s)");
      expect(out.stderr).toContain("fixture-task");
      expect(out.status).toBe(1);
    });
  }

  test("uses the fixture's .prereg-allowlist", () => {
    const dir = fixtureRepo({ "TASKS.md": ONE_BAD_P0, ".prereg-allowlist": "fixture-task\n" });
    const out = run("check-rule-9-tasksmd-fields.mjs", [`--repo=${dir}`]);
    expect(out.stdout).toContain("grandfathered=1, blocking=0");
    expect(out.status).toBe(0);
  });

  test("a repo with no .prereg-allowlist grandfathers nothing", () => {
    const dir = fixtureRepo({ "TASKS.md": "# Tasks\n" });
    const out = run("check-rule-9-tasksmd-fields.mjs", [`--repo=${dir}`]);
    expect(out.stdout).toContain("scanned 0 task block(s)");
    expect(out.status).toBe(0);
  });
});

describe("check-rule-13 --repo", () => {
  test("reads TASKS.md from the fixture", () => {
    const dir = fixtureRepo({ "TASKS.md": "# Tasks\n" });
    const out = run("check-rule-13-sibling-anchors.mjs", [`--repo=${dir}`]);
    expect(out.stdout).toContain("rule-13-sibling-anchors ok: 0 open sibling security P0s");
    expect(out.status).toBe(0);
  });
});

describe("check-rule-3 --repo", () => {
  test("reads the git diff from the fixture: code under novel/ without a doc fails", () => {
    const dir = fixtureRepo({ "TASKS.md": "# Tasks\n" });
    // Ignore the host's global git config (excludes, hooks) so the fixture commits are hermetic.
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    /** @param {...string} args */
    const git = (...args) =>
      spawnSync(
        "git",
        ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
        { env },
      );
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-qm", "base");
    mkdirSync(join(dir, "novel", "fixture-pkg", "src"), { recursive: true });
    writeFileSync(join(dir, "novel", "fixture-pkg", "src", "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-qm", "code without docs");
    const out = spawnSync(
      process.execPath,
      [resolve(HERE, "check-rule-3-doc-first.mjs"), `--repo=${dir}`],
      {
        encoding: "utf8",
        env: { ...process.env, RULE_3_DIFF_BASE: "HEAD~1" },
      },
    );
    expect(out.stderr).toContain("novel/fixture-pkg");
    expect(out.status).toBe(1);
  });
});
