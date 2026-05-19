// M1 Red-Green TDD acceptance tests.
//
// Each test represents one M1 task's acceptance criterion.
// TODAY: every test is RED (the feature doesn't exist yet).
// WHEN THE TASK SHIPS: the test goes GREEN.
// This is the TDD outer loop — write the failing test first,
// then implement until it passes.
//
// Pattern: Acceptance-TDD (Freeman & Pryce, GOOS, 2009).
// Rule #3: test-first, metric-first, doc-first.

import { execSync, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUNNER_BIN = join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs");

function makeHost(tasksMd?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "m1-tdd-"));
  execSync(
    "git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m 'chore: init'",
    { cwd: dir, stdio: "pipe" },
  );
  const md = join(dir, ".minsky");
  mkdirSync(join(md, "experiment-store", "cross-repo"), { recursive: true });
  mkdirSync(join(md, "experiments"), { recursive: true });
  writeFileSync(
    join(md, "repo.yaml"),
    "host_repo: test/m1\ntasks_md_path: TASKS.md\ncommit_format: 'feat: <DESCRIPTION>'\npre_commit_command: ''\nbranch_prefix: feat/\ndefault_branch: main\nhost_packages_path: src/\nignore_mechanism: global-ignore\n",
  );
  if (tasksMd) writeFileSync(join(dir, "TASKS.md"), tasksMd);
  return dir;
}

const COMPLIANT_TASK = `# Tasks\n\n## P0\n\n- [ ] \`red-green-task\` — test task\n  - **ID**: red-green-task\n  - **Tags**: p0\n  - **Hypothesis**: test\n  - **Success**: test passes\n  - **Pivot**: revert\n  - **Measurement**: echo ok\n  - **Anchor**: rule #9\n  - **Details**: do the thing\n  - **Files**: test.txt\n`;

// ─── Category: Spawn/Agent ──────────────────────────────────

describe("M1 TDD: spawn-agent", () => {
  test("devin spawn includes --permission-mode dangerous", () => {
    // Verifies: devin-spawn-missing-permission-mode-bypass
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8");
    const devinBlock = src.match(/if \(cmd === "devin"\)[\s\S]*?return \{/);
    expect(devinBlock).not.toBeNull();
    expect(devinBlock![0]).toContain("--permission-mode");
  });

  test("devin spawn uses --prompt-file not stdin", () => {
    // Verifies: devin --prompt-file fix
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8");
    expect(src).toContain("--prompt-file");
    expect(src).toContain("stdin: undefined");
  });

  test("dynamic timeout computed from history not hardcoded", () => {
    // Verifies: watchdog-timeout-kills-productive-devin + dynamic-timeouts
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8");
    expect(src).toContain("computeDynamicSettingsForHost");
    expect(src).toContain("dynamic-timeouts");
  });

  test("brief includes system-prompt overlay with PR instructions", () => {
    // Verifies: devin-spawn-no-pr-opened
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts"), "utf8");
    expect(src).toContain("renderSystemPromptOverlay");
    // The brief should include the overlay content
    expect(src).toContain("renderBrief");
    expect(src).toContain("---"); // separator between brief and overlay
  });
});

// ─── Category: Walker/Loop ──────────────────────────────────

describe("M1 TDD: walker-loop", () => {
  test("walker has per-host iteration cap", () => {
    // Verifies: walker-drains-one-host-forever
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8");
    expect(src).toContain("maxIterationsPerHost");
    expect(src).toContain("perHostCap");
  });

  test("spawn-failed skips to next host not halts walker", () => {
    // Verifies: walker skip-on-spawn-failed
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "src", "host-walker.ts"), "utf8");
    expect(src).not.toContain('if (inner === "spawn-failed") return "spawn-failed"');
  });

  test("iteration record includes verdict + duration + agent", () => {
    // Verifies: daemon-log-lacks-iteration-detail
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8");
    expect(src).toContain("iteration #${record.iteration}");
    expect(src).toContain("agent=${agent}");
    expect(src).toContain("verdict=${verdict}");
  });

  test("stability number computes from experiment store", () => {
    // Verifies: single-stability-number
    expect(existsSync(join(REPO_ROOT, "scripts", "stability-number.mjs"))).toBe(true);
  });
});

// ─── Category: CLI/UX ───────────────────────────────────────

describe("M1 TDD: cli-ux", () => {
  test("bin/minsky has watch subcommand", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("watch)");
    expect(src).toContain("RECENT ITERATIONS");
    expect(src).toContain("NEEDS HUMAN ACTION");
  });

  test("bin/minsky has smart auto-attach", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("_daemon_running_for_host");
    expect(src).toContain("attaching with watch");
  });

  test("minsky status shows stability %", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("Stability");
    expect(src).toContain("stability-number.mjs");
  });

  test("minsky watch shows git SHA for version tracking", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("rev-parse --short HEAD");
  });

  test("minsky watch shows human-help-needed section", () => {
    // The human-help logic is in render-watch-frame.sh (called by bin/minsky watch)
    // OR inline in bin/minsky depending on which version is active
    const shim = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    const render = existsSync(join(REPO_ROOT, "scripts", "render-watch-frame.sh"))
      ? readFileSync(join(REPO_ROOT, "scripts", "render-watch-frame.sh"), "utf8")
      : "";
    const combined = shim + render;
    expect(combined).toContain("scope-leak");
    expect(combined).toContain("spawn-failed");
    expect(combined).toContain("blocked");
    expect(combined).toContain("No human action needed");
  });
});

// ─── Category: Config/Setup ─────────────────────────────────

describe("M1 TDD: config-setup", () => {
  test("~/.minsky/config.json resolution chain exists", () => {
    // Verifies: per-machine config support
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8");
    expect(src).toContain("loadMinskyConfig");
    expect(src).toContain("config.json");
  });

  test.todo("minsky-init-one-command-bootstrap — npx minsky init works");
  test.todo("minsky-uninstall-clean-removal — minsky uninstall leaves zero residue");
});

// ─── Category: Task Queue ───────────────────────────────────

describe("M1 TDD: task-queue", () => {
  test("pickHostTask skips tasks with open PRs", () => {
    // Verifies: daemon-duplicate-work-detection precursor
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8");
    expect(src).toContain("listOpenPrBranches");
    expect(src).toContain("openPrBranches");
  });

  test.todo("daemon-task-rotation-on-completion — shipped tasks auto-removed");
  test.todo("daemon-priority-discipline-picktask-bug — Tags-aware priority picking");
});

// ─── Category: Brief Quality ────────────────────────────────

describe("M1 TDD: brief-quality", () => {
  test("brief includes FINAL STEP with git push + gh pr create", () => {
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts"), "utf8");
    expect(src).toContain("FINAL STEP");
    expect(src).toContain("gh pr create");
    expect(src).toContain("git push");
  });

  test("brief includes hypothesis from task block", () => {
    const src = readFileSync(join(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts"), "utf8");
    expect(src).toContain("Hypothesis");
  });
});

// ─── Category: PR Lifecycle ─────────────────────────────────

describe("M1 TDD: pr-lifecycle", () => {
  test.todo("cto-audit-pr-auto-merge — labeled PRs auto-merge when CI green");
  test.todo("daemon-pre-pr-lint-gate — daemon runs lints before opening PR");
  test.todo("daemon-fix-own-pr-on-ci-failure — daemon fixes failing CI on its PRs");
});

// ─── Category: Metrics/Observability ────────────────────────

describe("M1 TDD: metrics-observability", () => {
  test("full-coverage-report.mjs exists", () => {
    expect(existsSync(join(REPO_ROOT, "scripts", "full-coverage-report.mjs"))).toBe(true);
  });

  test("m1-metrics-dashboard.mjs exists", () => {
    expect(existsSync(join(REPO_ROOT, "scripts", "m1-metrics-dashboard.mjs"))).toBe(true);
  });

  test("m1-observability-plan.mjs exists", () => {
    expect(existsSync(join(REPO_ROOT, "scripts", "m1-observability-plan.mjs"))).toBe(true);
  });

  test("collect-metrics.mjs exists", () => {
    expect(existsSync(join(REPO_ROOT, "scripts", "collect-metrics.mjs"))).toBe(true);
  });

  test.todo("milestone-alignment-gate-enforcement — check-milestone-alignment.mjs exits 0");
  test.todo("weekly-lmarena-style-benchmark — scorecard JSON produced");
});

// ─── Category: Runtime Invariants ───────────────────────────

describe("M1 TDD: runtime-invariants", () => {
  test("runtime-invariants.ts exports checkRuntimeInvariants", () => {
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "src", "runtime-invariants.ts"),
      "utf8",
    );
    expect(src).toContain("export function checkRuntimeInvariants");
    expect(src).toContain("export const ALL_RUNTIME_INVARIANTS");
  });

  test("at least 5 runtime invariants defined", () => {
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "src", "runtime-invariants.ts"),
      "utf8",
    );
    const exports = src.match(/export const \w+: InvariantCheck/g) || [];
    expect(exports.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Category: Daemon Health ────────────────────────────────

describe("M1 TDD: daemon-health", () => {
  test("dynamic-timeouts module exists", () => {
    expect(
      existsSync(join(REPO_ROOT, "novel", "cross-repo-runner", "src", "dynamic-timeouts.ts")),
    ).toBe(true);
  });

  test("observer skill is machine-portable (no hardcoded paths)", () => {
    const src = readFileSync(
      join(REPO_ROOT, "skill-plugins", "observer", "minsky", "SKILL.md"),
      "utf8",
    );
    // Should use $MINSKY_REPO / <TARGET_REPO> placeholders, not ~/apps/tooling
    expect(src).toContain("$MINSKY_REPO");
    expect(src).toContain("<TARGET_REPO>");
  });

  test.todo("self-diagnose-on-start — invariants run at daemon boot");
  test.todo("daemon-network-resilience-detector — network loss pauses iteration timer");
});

// ─── Category: End-to-End Fixtures ──────────────────────────

describe("M1 TDD: fixture-driven e2e", () => {
  test("dry-run against fixture host picks task and writes experiment yaml", () => {
    const dir = makeHost(COMPLIANT_TASK);
    const out = execFileSync("node", [RUNNER_BIN, "--host", dir, "--once", "--no-live"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
    });
    expect(out).toContain("red-green-task");
    const exps = readdirSync(join(dir, ".minsky", "experiments")).filter((f) => f.endsWith(".yaml"));
    expect(exps.length).toBeGreaterThanOrEqual(1);
  });

  test("empty queue host exits cleanly", () => {
    const dir = makeHost("# Tasks\n\n## P0\n");
    const out = execFileSync("node", [RUNNER_BIN, "--host", dir, "--once", "--no-live"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
    });
    expect(out).toContain("empty-queue");
  });

  test("loop with max-iterations=1 produces exactly 1 iteration record", () => {
    const dir = makeHost(COMPLIANT_TASK);
    execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--loop", "--max-iterations=1", "--no-live", "--tick-interval-ms=0"],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
      },
    );
    const store = join(dir, ".minsky", "experiment-store", "cross-repo");
    const jsonls = readdirSync(store).filter((f) => f.endsWith(".jsonl"));
    expect(jsonls.length).toBeGreaterThanOrEqual(1);
    const lines = readFileSync(join(store, jsonls[0]!), "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });
});
