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

import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUNNER_BIN = join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs");

/** Sanitized env for spawned subprocesses — strips all MINSKY_* vars
 *  so tests don't inherit the operator's daemon config or a running
 *  daemon's state. Prevents cross-contamination in parallel CI runs. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("MINSKY_")) delete env[key];
  }
  env.MINSKY_NON_INTERACTIVE = "1";
  // Point HOME to a temp dir so tests don't read ~/.minsky/config.json
  env.HOME = mkdtempSync(join(tmpdir(), "m1-home-"));
  return env;
}

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

const COMPLIANT_TASK =
  "# Tasks\n\n## P0\n\n- [ ] `red-green-task` — test task\n  - **ID**: red-green-task\n  - **Tags**: p0\n  - **Hypothesis**: test\n  - **Success**: test passes\n  - **Pivot**: revert\n  - **Measurement**: echo ok\n  - **Anchor**: rule #9\n  - **Details**: do the thing\n  - **Files**: test.txt\n";

// ─── Category: Spawn/Agent ──────────────────────────────────

describe("M1 TDD: spawn-agent", () => {
  test("devin spawn includes --permission-mode dangerous", () => {
    // Verifies: devin-spawn-missing-permission-mode-bypass
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
    const devinBlock = src.match(/if \(cmd === "devin"\)[\s\S]*?return \{/);
    expect(devinBlock).not.toBeNull();
    expect(devinBlock?.[0]).toContain("--permission-mode");
  });

  test("devin spawn uses --prompt-file not stdin", () => {
    // Verifies: devin --prompt-file fix
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
    expect(src).toContain("--prompt-file");
    expect(src).toContain("stdin: undefined");
  });

  test("dynamic timeout computed from history not hardcoded", () => {
    // Verifies: watchdog-timeout-kills-productive-devin + dynamic-timeouts
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
    expect(src).toContain("computeDynamicSettingsForHost");
    expect(src).toContain("dynamic-timeouts");
  });

  test("brief includes system-prompt overlay with PR instructions", () => {
    // Verifies: devin-spawn-no-pr-opened
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts"),
      "utf8",
    );
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
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
    expect(src).toContain("maxIterationsPerHost");
    expect(src).toContain("perHostCap");
  });

  test("spawn-failed skips to next host not halts walker", () => {
    // Verifies: walker skip-on-spawn-failed
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "src", "host-walker.ts"),
      "utf8",
    );
    expect(src).not.toContain('if (inner === "spawn-failed") return "spawn-failed"');
  });

  test("iteration record includes verdict + duration + agent", () => {
    // Verifies: daemon-log-lacks-iteration-detail
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
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
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
    expect(src).toContain("loadMinskyConfig");
    expect(src).toContain("config.json");
  });

  test("bin/minsky has init subcommand", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("init)");
    expect(src).toContain("default_host");
  });

  test("bin/minsky has uninstall subcommand (distinct from uninstall-daemon)", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("uninstall)");
    expect(src).toContain("uninstall-daemon");
  });

  test("bin/minsky uses portable shell helpers, not python3", () => {
    // Rule-#17 guard: corporate `python3` wrappers can take 30+ seconds to
    // bootstrap a uv cache on a fresh HOME, which dominated the runtime of
    // `minsky report` from a clean test env. The shim must stay zero-deps
    // at the install layer — node + bash builtins only, no python3.
    // Discovered 2026-05-19; fix at `_minsky_realpath` + `_minsky_config_value`.
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    // Strip comments so the documented-but-not-executed reference doesn't
    // trip this check.
    const codeOnly = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(codeOnly).not.toMatch(/python3 -c/);
    // Positive assertion: the helpers exist.
    expect(src).toContain("_minsky_realpath()");
    expect(src).toContain("_minsky_config_value()");
  });

  test("minsky init writes ~/.minsky/config.json with default_host=cwd", () => {
    const host = makeHost();
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    execFileSync(binPath, ["init"], { cwd: host, env, encoding: "utf8", timeout: 30_000 });
    const cfgPath = join(env.HOME ?? "", ".minsky", "config.json");
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { default_host?: string };
    // Use realpath comparison — macOS resolves /var → /private/var when bash
    // does `cd ... && pwd`, while node's mkdtempSync returns /var/... directly.
    expect(cfg.default_host).toBeDefined();
    expect(realpathSync(cfg.default_host ?? "")).toBe(realpathSync(host));
  });

  test("minsky init refuses to write when cwd is not a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "m1-init-bad-"));
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    expect(() =>
      execFileSync(binPath, ["init"], { cwd: dir, env, encoding: "utf8", timeout: 30_000 }),
    ).toThrow();
    const cfgPath = join(env.HOME ?? "", ".minsky", "config.json");
    expect(existsSync(cfgPath)).toBe(false);
  });

  test("minsky uninstall removes ~/.minsky/config.json with --force", () => {
    const env = cleanEnv();
    // Pre-seed a config to be removed
    mkdirSync(join(env.HOME ?? "", ".minsky"), { recursive: true });
    writeFileSync(
      join(env.HOME ?? "", ".minsky", "config.json"),
      JSON.stringify({ default_host: "/tmp/x" }),
    );
    const binPath = join(REPO_ROOT, "bin", "minsky");
    execFileSync(binPath, ["uninstall", "--force"], { env, encoding: "utf8", timeout: 30_000 });
    expect(existsSync(join(env.HOME ?? "", ".minsky", "config.json"))).toBe(false);
  });

  test("minsky uninstall WITHOUT --force prints dry-run and keeps config", () => {
    const env = cleanEnv();
    mkdirSync(join(env.HOME ?? "", ".minsky"), { recursive: true });
    writeFileSync(
      join(env.HOME ?? "", ".minsky", "config.json"),
      JSON.stringify({ default_host: "/tmp/x" }),
    );
    const binPath = join(REPO_ROOT, "bin", "minsky");
    const out = execFileSync(binPath, ["uninstall"], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out).toContain("dry-run");
    expect(existsSync(join(env.HOME ?? "", ".minsky", "config.json"))).toBe(true);
  });
});

// ─── Category: Task Queue ───────────────────────────────────

describe("M1 TDD: task-queue", () => {
  test("pickHostTask skips tasks with open PRs", () => {
    // Verifies: daemon-duplicate-work-detection precursor
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
    expect(src).toContain("listOpenPrBranches");
    expect(src).toContain("openPrBranches");
  });

  test.todo("daemon-task-rotation-on-completion — shipped tasks auto-removed");
  test.todo("daemon-priority-discipline-picktask-bug — Tags-aware priority picking");
});

// ─── Category: Brief Quality ────────────────────────────────

describe("M1 TDD: brief-quality", () => {
  test("brief includes FINAL STEP with git push + gh pr create", () => {
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts"),
      "utf8",
    );
    expect(src).toContain("FINAL STEP");
    expect(src).toContain("gh pr create");
    expect(src).toContain("git push");
  });

  test("brief includes hypothesis from task block", () => {
    const src = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts"),
      "utf8",
    );
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

// ─── Category: Minsky Doctor ────────────────────────────────

describe("M1 TDD: minsky-doctor", () => {
  test("bin/minsky has doctor subcommand", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("doctor)");
  });

  test("minsky doctor runs node version + git + gh checks", () => {
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    const out = execFileSync(binPath, ["doctor"], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out).toMatch(/node/i);
    expect(out).toMatch(/git/i);
    expect(out).toMatch(/gh|GitHub CLI/i);
  });

  test("minsky doctor reports green/yellow/red status per check", () => {
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    const out = execFileSync(binPath, ["doctor"], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    // ASCII status markers (avoid relying on emoji rendering).
    // green=PASS, yellow=WARN, red=FAIL.
    expect(out).toMatch(/PASS|WARN|FAIL/);
  });

  test("minsky doctor exits 0 when no critical checks fail", () => {
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    // On a developer machine with node + git installed, doctor should exit 0.
    // We don't enforce gh/devin/claude — those are optional.
    expect(() =>
      execFileSync(binPath, ["doctor"], { env, encoding: "utf8", timeout: 30_000 }),
    ).not.toThrow();
  });

  test("minsky doctor reports daemon status (running or stopped)", () => {
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    const out = execFileSync(binPath, ["doctor"], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out).toMatch(/daemon/i);
  });
});

// ─── Category: Minsky Report ────────────────────────────────

describe("M1 TDD: minsky-report", () => {
  test("bin/minsky has report subcommand", () => {
    const src = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(src).toContain("report)");
  });

  test("scripts/minsky-report.mjs exists", () => {
    expect(existsSync(join(REPO_ROOT, "scripts", "minsky-report.mjs"))).toBe(true);
  });

  test("minsky report --baseline prints latest snapshot as JSON", () => {
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    const out = execFileSync(binPath, ["report", "--baseline", "--repo", REPO_ROOT], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    // Should be parseable JSON and contain at least one metric key.
    const parsed = JSON.parse(out) as Record<string, { value: unknown }>;
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(1);
    // Every metric must have a `value`.
    for (const key of Object.keys(parsed)) {
      expect(parsed[key]).toHaveProperty("value");
    }
  });

  test("minsky report --delta prints baseline-vs-prev diff", () => {
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    const out = execFileSync(binPath, ["report", "--delta", "--repo", REPO_ROOT], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    // Output should mention specific metric names from the snapshots.
    expect(out).toMatch(/loop-uptime|task-throughput|self-improvement-velocity/);
    // Should include arrow-style directional indicator (up/down/same).
    expect(out).toMatch(/↑|↓|→|=|\bup\b|\bdown\b|\bsame\b/i);
  });

  test("minsky report (no flag) prints human-readable summary", () => {
    const env = cleanEnv();
    const binPath = join(REPO_ROOT, "bin", "minsky");
    const out = execFileSync(binPath, ["report", "--repo", REPO_ROOT], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out).toMatch(/loop-uptime|task-throughput|self-improvement-velocity/);
    // Not pure JSON — should contain prose / formatting.
    expect(() => JSON.parse(out)).toThrow();
  });
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
    const exps = readdirSync(join(dir, ".minsky", "experiments")).filter((f) =>
      f.endsWith(".yaml"),
    );
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
      [
        RUNNER_BIN,
        "--host",
        dir,
        "--loop",
        "--max-iterations=1",
        "--no-live",
        "--tick-interval-ms=0",
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: cleanEnv(),
      },
    );
    const store = join(dir, ".minsky", "experiment-store", "cross-repo");
    const jsonls = readdirSync(store).filter((f) => f.endsWith(".jsonl"));
    expect(jsonls.length).toBeGreaterThanOrEqual(1);
    const firstJsonl = jsonls[0];
    expect(firstJsonl).toBeDefined();
    const lines = readFileSync(join(store, firstJsonl ?? ""), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines.length).toBe(1);
  });
});
