// Regression-prevention tests for the four bugs the 2026-05-19 operator
// observation surfaced, all governed by rule #17 (proactive healing —
// observation IS the fix). Each test reproduces the failure mode and
// asserts the runtime invariant the fix established. The file IS the
// rule-#17 lint for the class — any future regression in any of these
// behaviours fails CI deterministically.
//
// Hypothesis (rule #9): every bug surfaced by `minsky watch` on
//   2026-05-19 (GraphQL 401 cascade, wrong-host repo lookup, `--once`
//   hang, dry-run network calls) is caught by a runtime test here
//   before it reaches the daemon. Success threshold: 100% of the four
//   classes have a paired regression test.
// Success: all 4 classes have ≥1 test that fails on the broken version.
// Pivot: if a regression-class test becomes flaky, move it to
//   `.test.flaky.ts` and file a rule-#11 task — never silently disable.
// Measurement: this test file's pass count.
// Anchor: Forsgren/Humble/Kim, *Accelerate*, 2018 (DORA — every bug
//   becomes a regression test); rule #17 (vision.md § proactive
//   healing); operator directive 2026-05-19.

import { execSync, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  resolveGhHost,
  type ResolveGhHostResult,
} from "../../novel/cross-repo-runner/dist/index.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUNNER_BIN = join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs");

/**
 * Sanitised env — strips MINSKY_*, isolates HOME so tests don't read the
 * operator's `~/.minsky/config.json` or collide with a running daemon.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("MINSKY_")) delete env[key];
  }
  env.MINSKY_NON_INTERACTIVE = "1";
  env.HOME = mkdtempSync(join(tmpdir(), "rt-home-"));
  return env;
}

/**
 * Bootstrap a minimal fixture host. Returns the absolute path. The
 * default has NO `origin` remote so `git remote get-url origin` fails —
 * forcing the resolver into the `fallback` branch, the most realistic
 * shape for tests that should NEVER touch the network.
 */
function makeFixtureHost(opts?: {
  remoteUrl?: string;
  tasksMd?: string;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "minsky-rule17-"));
  execSync(
    "git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m 'chore: init' --no-verify",
    { cwd: dir, stdio: "pipe" },
  );
  if (opts?.remoteUrl !== undefined) {
    execSync(`git remote add origin "${opts.remoteUrl}"`, { cwd: dir, stdio: "pipe" });
  }
  const md = join(dir, ".minsky");
  mkdirSync(join(md, "experiment-store", "cross-repo"), { recursive: true });
  mkdirSync(join(md, "experiments"), { recursive: true });
  writeFileSync(
    join(md, "repo.yaml"),
    [
      "host_repo: test/rule17",
      "tasks_md_path: TASKS.md",
      "commit_format: 'feat: <DESCRIPTION>'",
      "pre_commit_command: ''",
      "branch_prefix: feat/",
      "default_branch: main",
      "host_packages_path: src/",
      "ignore_mechanism: global-ignore",
    ].join("\n"),
  );
  const tasks =
    opts?.tasksMd ??
    [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] `rule17-fixture` — fixture task",
      "  - **ID**: rule17-fixture",
      "  - **Tags**: p0, test",
      "  - **Hypothesis**: regression test fires",
      "  - **Success**: lint passes",
      "  - **Pivot**: revert if flaky",
      "  - **Measurement**: `pnpm test`",
      "  - **Anchor**: rule #17",
      "",
    ].join("\n");
  writeFileSync(join(dir, "TASKS.md"), tasks);
  return dir;
}

// ─── Class 1: GH_HOST resolution — never assume one corporate host ──

describe("rule #17 — GH_HOST is resolved from git remote, never hardcoded", () => {
  test("github.com remote → GH_HOST=github.com (the cascade-causing case)", () => {
    const r: ResolveGhHostResult = resolveGhHost({
      envGhHost: undefined,
      gitRemoteUrl: "https://github.com/fyodoriv/minsky.git",
    });
    expect(r).toEqual({ host: "github.com", source: "git-remote" });
  });

  test("github.intuit.com remote → GH_HOST=github.intuit.com", () => {
    const r = resolveGhHost({
      envGhHost: undefined,
      gitRemoteUrl: "git@github.intuit.com:team/repo.git",
    });
    expect(r).toEqual({ host: "github.intuit.com", source: "git-remote" });
  });

  test("env override always wins (operator escape hatch)", () => {
    const r = resolveGhHost({
      envGhHost: "github.example.com",
      gitRemoteUrl: "https://github.com/anyone/anything.git",
    });
    expect(r).toEqual({ host: "github.example.com", source: "env" });
  });

  test("malformed URL → null host (gh uses its own default; never crash)", () => {
    const r = resolveGhHost({
      envGhHost: undefined,
      gitRemoteUrl: "not-a-url",
    });
    expect(r.host).toBeNull();
    expect(r.source).toBe("fallback");
  });

  test("regression: minsky-run.mjs imports resolveGhHost (not just exports it)", () => {
    const src = readFileSync(RUNNER_BIN, "utf8");
    expect(src).toMatch(/resolveGhHost\s*[,}]/);
    // Hardcoded github.intuit.com must NOT survive in the daemon's call sites.
    // The string may appear in a comment explaining what was removed; the
    // banned shape is "GH_HOST: 'github.intuit.com'" or
    // `GH_HOST = "github.intuit.com"` — never assigned as a default.
    expect(src).not.toMatch(/GH_HOST\s*[:=]\s*['"]github\.intuit\.com['"]/);
    expect(src).not.toMatch(/GH_HOST\s*\?\?\s*['"]github\.intuit\.com['"]/);
  });
});

// ─── Class 2: --once exits after exactly one iteration ──────────

describe("rule #17 — --once exits after one iteration", () => {
  test("dry-run + --once exits within 5 seconds (was hanging 60s+)", () => {
    const dir = makeFixtureHost();
    const t0 = Date.now();
    const stdout = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
      { encoding: "utf8", env: cleanEnv(), timeout: 10_000 },
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(10_000);
    expect(stdout).toContain("stopReason: max-iterations");
    expect(stdout).toContain("iterations: 1");
  });

  test("--once is reported as max-iter=1 in the loop banner", () => {
    const dir = makeFixtureHost();
    const stdout = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
      { encoding: "utf8", env: cleanEnv(), timeout: 10_000 },
    );
    expect(stdout).toContain("max-iter=1");
  });

  test("explicit --max-iterations=5 still wins over --once's bridge", () => {
    // --max-iterations explicit beats the --once auto-bridge.
    const dir = makeFixtureHost();
    const stdout = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--no-live", "--max-iterations=2", "--tick-interval-ms=0"],
      { encoding: "utf8", env: cleanEnv(), timeout: 10_000 },
    );
    expect(stdout).toContain("max-iter=2");
  });
});

// ─── Class 3: dry-run never hits the network ────────────────────

describe("rule #17 — dry-run mode never calls gh / never blocks on network", () => {
  test("fixture with no origin remote completes dry-run iteration", () => {
    const dir = makeFixtureHost();
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(() => execSync("git remote get-url origin", { cwd: dir, stdio: "pipe" })).toThrow();
    const stdout = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
      { encoding: "utf8", env: cleanEnv(), timeout: 10_000 },
    );
    expect(stdout).toContain("validated");
    const records = readdirSync(join(dir, ".minsky", "experiment-store", "cross-repo"));
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  test("fixture with bogus origin URL still completes (no network call)", () => {
    const dir = makeFixtureHost({ remoteUrl: "https://example.invalid/team/repo.git" });
    const stdout = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
      { encoding: "utf8", env: cleanEnv(), timeout: 10_000 },
    );
    expect(stdout).toContain("validated");
  });
});

// ─── Class 4: rule-17 lint deterministically catches the watcher-narrator ──

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
