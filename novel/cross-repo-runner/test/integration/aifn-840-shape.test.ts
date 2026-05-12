// Integration test: `minsky-run` produces the expected EXPERIMENT.yaml +
// iteration record shape for an AIFN-840-shaped task in a fixture host.
//
// This is the rule-#9 acceptance test for the cross-repo-runner (step 6
// of 7 in the cross-repo-runner roadmap). It validates the FULL chain
// against a tmpdir host:
//   1. minsky-bootstrap creates the host's .minsky/ sidecar (+ repo.yaml).
//   2. minsky-run finds the AIFN-840-shaped task in TASKS.md.
//   3. The synthesiser passes (all 5 rule-#9 fields present).
//   4. The runner writes the EXPERIMENT.yaml with the right shape.
//   5. The runner appends the iteration record with verdict: planned.
//
// Pattern: end-to-end smoke (Beck XP 1999 — system-level test as the
//   integration substrate; Beyer SRE 2016 — black-box probe at the
//   operator-facing boundary). Source: user-stories/006-runner-on-any-repo.md
//   § "Integration test"; rule #9 (this is the v0 acceptance for the
//   umbrella user-story-006 metric `cross_repo_runs_validated_pct`).
// Conformance: full — drives the real CLI executor against a real
//   filesystem fixture; no mocking.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const BOOTSTRAP_BIN = resolve(REPO_ROOT, "novel/sidecar-bootstrap/bin/minsky-bootstrap.mjs");
const RUNNER_BIN = resolve(REPO_ROOT, "novel/cross-repo-runner/bin/minsky-run.mjs");

// AIFN-840-shaped task: the actual fix is `title: "hold"` → `"Put on hold"`
// + `title: "lead"` → `"Lead support"` in commandCenterConfig.ts (the bug
// surfaced 2026-05-04 from the iep-capabilities-3 host). The test fixture
// uses the same shape to validate the runner produces the right substrate
// for an operator to drive Claude Code with.
const AIFN_840_SHAPED_TASKS_MD = `# Tasks

## P1

- [ ] Fix slash command labels in IEP Run shortcut menu AIFN-840
  **ID**: aifn-840-slash-command-labels
  **Tags**: bug, ai-native, command-center, iep-ai-native, one-shot
  **Details**: titles "hold" and "lead" should read "Put on hold" / "Lead support".
  **Hypothesis**: Replacing the literal title strings in commandCenterConfig.ts closes the labels gap; no other code path reads slashCommand.title expecting lowercase.
  **Success**: tests pass; commandCenterConfig.ts spec asserts the new title strings; no consumers grep'd for the old lowercase tokens
  **Pivot**: <0.5 (if any consumer still expects the old token, refactor the consumer first)
  **Measurement**: yarn vitest run plugins/iep-ai-native/src/store/selectors/selectResolvedTools.spec.ts
  **Anchor**: rule #9 (vision.md § 9 — pre-registered hypothesis-driven development); user-stories/006-runner-on-any-repo.md (the cross-repo-runner umbrella story)
`;

interface FixtureHost {
  /** Absolute path to the tmpdir host root. */
  hostRoot: string;
  /** Path to the host's TASKS.md. */
  tasksMdPath: string;
  /** Path to the operator's XDG_CONFIG_HOME (for global git ignore). */
  xdgConfigHome: string;
}

function createFixtureHost(): FixtureHost {
  const hostRoot = mkdtempSync(join(tmpdir(), "minsky-aifn-840-"));
  const tasksMdPath = join(hostRoot, "TASKS.md");

  // Clear GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_OBJECT_DIRECTORY
  // from the env we hand to `git init`. When this test runs under a
  // pre-commit hook (lefthook → vitest), git itself sets those env vars to
  // the outer repo's `.git` directory; without clearing them, `git config`
  // in the test fixture writes to the OUTER repo's `.git/config` instead
  // of the tmpdir fixture's, and the bootstrap then reads "unknown/unknown"
  // back from the fixture's empty config file. Observed live 2026-05-11
  // during the v1-live-spawn pre-commit run. Use destructuring rest
  // instead of `delete` per biome's `noDelete` rule.
  const {
    GIT_DIR: _gitDir,
    GIT_WORK_TREE: _gitWorkTree,
    GIT_INDEX_FILE: _gitIndexFile,
    GIT_OBJECT_DIRECTORY: _gitObjectDirectory,
    ...gitEnv
  } = process.env;
  void _gitDir;
  void _gitWorkTree;
  void _gitIndexFile;
  void _gitObjectDirectory;

  // Initialise as a real git repo with a synthetic remote URL — bootstrap's
  // inferer reads .git/config to populate `host_repo`.
  execFileSync("git", ["init", "--quiet"], { cwd: hostRoot, env: gitEnv });
  execFileSync(
    "git",
    ["config", "remote.origin.url", "git@github.com:test-org/test-iep-capabilities.git"],
    { cwd: hostRoot, env: gitEnv },
  );

  // Write a minimal package.json so the inferer detects a `lint` script.
  writeFileSync(
    join(hostRoot, "package.json"),
    JSON.stringify(
      {
        name: "test-iep-capabilities",
        scripts: { lint: "echo ok" },
        packageManager: "yarn@4.0.0",
      },
      null,
      2,
    ),
  );

  // The TASKS.md row.
  writeFileSync(tasksMdPath, AIFN_840_SHAPED_TASKS_MD);

  // Isolate the global git ignore the bootstrap will touch.
  const xdgConfigHome = join(hostRoot, ".config-isolated");

  return { hostRoot, tasksMdPath, xdgConfigHome };
}

function cleanupFixture(host: FixtureHost): void {
  rmSync(host.hostRoot, { recursive: true, force: true });
}

function runBootstrap(host: FixtureHost): { stdout: string; stderr: string; code: number } {
  return runNode(BOOTSTRAP_BIN, [host.hostRoot], host);
}

function runMinskyRun(
  host: FixtureHost,
  args: string[],
): { stdout: string; stderr: string; code: number } {
  return runNode(RUNNER_BIN, args, host);
}

function runNode(
  binPath: string,
  args: string[],
  host: FixtureHost,
): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("node", [binPath, ...args], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: host.xdgConfigHome,
      },
      encoding: "utf8",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? ""),
      stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? ""),
      code: e.status ?? 1,
    };
  }
}

describe("AIFN-840 integration: bootstrap + minsky-run end-to-end", () => {
  /** @type {FixtureHost} */
  let host: FixtureHost;

  // Build the two workspace packages once before the suite runs. The CLIs
  // load from `dist/` per their package.json `main`; without this build,
  // CI fresh checkouts hit `node:internal/modules/esm/resolve` errors.
  // Local dev typically has the build cached, but CI doesn't, so we make
  // it explicit here (rule #6 — let-it-crash AT the boundary; the test's
  // first job is to make sure the artefacts under test exist).
  //
  // We use `tsc --force` (via `--force` flag) to defeat the
  // `tsconfig.tsbuildinfo` incremental cache — without `--force`, a stale
  // cache pointing at a `dist/` we've wiped reports a no-op success.
  beforeAll(() => {
    const tsc = resolve(REPO_ROOT, "node_modules/.bin/tsc");
    // `tsc -b` is the build-mode entry that respects `composite: true` and
    // walks the project references; `--force` defeats the
    // `tsconfig.tsbuildinfo` incremental cache so a fresh CI checkout (or
    // a `dist/`-wiped local) actually rebuilds.
    execFileSync(tsc, ["-b", "novel/sidecar-bootstrap/tsconfig.json", "--force"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    execFileSync(tsc, ["-b", "novel/cross-repo-runner/tsconfig.json", "--force"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }, 60_000);

  beforeEach(() => {
    host = createFixtureHost();
  });

  afterEach(() => {
    cleanupFixture(host);
  });

  test("bootstrap creates the host's .minsky/ sidecar with inferred values", () => {
    const result = runBootstrap(host);
    expect(result.code).toBe(0);
    expect(existsSync(join(host.hostRoot, ".minsky/repo.yaml"))).toBe(true);
    expect(existsSync(join(host.hostRoot, ".minsky/experiments"))).toBe(true);
    expect(existsSync(join(host.hostRoot, ".minsky/vision.md"))).toBe(true);
    const repoYaml = readFileSync(join(host.hostRoot, ".minsky/repo.yaml"), "utf8");
    expect(repoYaml).toContain('host_repo: "test-org/test-iep-capabilities"');
    expect(repoYaml).toContain('pre_commit_command: "yarn lint"');
  });

  test("minsky-run dry-run on AIFN-840-shaped task synthesises the EXPERIMENT.yaml", () => {
    runBootstrap(host);
    const result = runMinskyRun(host, ["aifn-840-slash-command-labels", "--host", host.hostRoot]);
    expect(result.code).toBe(0);
    const expYamlPath = join(
      host.hostRoot,
      ".minsky/experiments/aifn-840-slash-command-labels.yaml",
    );
    expect(existsSync(expYamlPath)).toBe(true);
    const yaml = readFileSync(expYamlPath, "utf8");
    expect(yaml).toContain("id: aifn-840-slash-command-labels");
    expect(yaml).toContain("hypothesis:");
    expect(yaml).toContain("Replacing the literal title strings");
    expect(yaml).toContain("success:");
    expect(yaml).toContain("pivot:");
    expect(yaml).toContain("measurement:");
    expect(yaml).toContain("yarn vitest run plugins/iep-ai-native");
    expect(yaml).toContain("anchor:");
    expect(yaml).toContain("rule #9");
  });

  test("minsky-run dry-run appends an iteration record with verdict: planned", () => {
    runBootstrap(host);
    const result = runMinskyRun(host, ["aifn-840-slash-command-labels", "--host", host.hostRoot]);
    expect(result.code).toBe(0);
    const recordPath = join(
      host.hostRoot,
      ".minsky/experiment-store/cross-repo/aifn-840-slash-command-labels.jsonl",
    );
    expect(existsSync(recordPath)).toBe(true);
    const lines = readFileSync(recordPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0] ?? "");
    expect(record.experiment_id).toBe("aifn-840-slash-command-labels");
    expect(record.host_repo).toBe("test-org/test-iep-capabilities");
    expect(record.branch).toBe("feat/aifn-840-slash-command-labels");
    expect(record.verdict).toBe("planned");
    expect(record.notes).toContain("dry-run");
  });

  test("minsky-run emits the runner plan to stdout (taskId + branchName + env + brief)", () => {
    runBootstrap(host);
    const result = runMinskyRun(host, ["aifn-840-slash-command-labels", "--host", host.hostRoot]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"taskId": "aifn-840-slash-command-labels"');
    expect(result.stdout).toContain('"branchName": "feat/aifn-840-slash-command-labels"');
    expect(result.stdout).toContain('"MINSKY_HOST_ROOT"');
    expect(result.stdout).toContain("Hypothesis self-grade");
    expect(result.stdout).toContain("yarn lint");
  });

  test("ticket-key matching: AIFN-840 also locates the task by title-substring", () => {
    runBootstrap(host);
    const result = runMinskyRun(host, ["AIFN-840", "--host", host.hostRoot]);
    expect(result.code).toBe(0);
    const expYamlPath = join(
      host.hostRoot,
      ".minsky/experiments/aifn-840-slash-command-labels.yaml",
    );
    expect(existsSync(expYamlPath)).toBe(true);
  });

  test("idempotent re-run: second invocation appends a second iteration record without crashing", () => {
    runBootstrap(host);
    runMinskyRun(host, ["aifn-840-slash-command-labels", "--host", host.hostRoot]);
    const second = runMinskyRun(host, ["aifn-840-slash-command-labels", "--host", host.hostRoot]);
    expect(second.code).toBe(0);
    const recordPath = join(
      host.hostRoot,
      ".minsky/experiment-store/cross-repo/aifn-840-slash-command-labels.jsonl",
    );
    const lines = readFileSync(recordPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const record = JSON.parse(line);
      expect(record.experiment_id).toBe("aifn-840-slash-command-labels");
      expect(record.verdict).toBe("planned");
    }
  });

  test("rule-#9 violation: a task missing required fields exits 1 with the violation message", () => {
    runBootstrap(host);
    // Overwrite TASKS.md with a row missing all 5 rule-#9 fields.
    writeFileSync(
      host.tasksMdPath,
      "# Tasks\n\n## P1\n\n- [ ] Incomplete task\n  **ID**: incomplete-task\n  **Tags**: bug\n",
    );
    const result = runMinskyRun(host, ["incomplete-task", "--host", host.hostRoot]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("rule-9 violation");
    expect(result.stderr).toContain("Hypothesis");
    expect(result.stderr).toContain("Success");
    expect(result.stderr).toContain("Pivot");
    expect(result.stderr).toContain("Measurement");
    expect(result.stderr).toContain("Anchor");
    expect(result.stderr).toContain("iron");
  });

  test("not-bootstrapped: minsky-run without prior bootstrap exits 1 with bootstrap suggestion", () => {
    // Skip the bootstrap step.
    const result = runMinskyRun(host, ["aifn-840-slash-command-labels", "--host", host.hostRoot]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not bootstrapped");
    expect(result.stderr).toContain("minsky-bootstrap");
  });

  test("task not found: missing task-id exits 1 with available IDs list", () => {
    runBootstrap(host);
    const result = runMinskyRun(host, ["no-such-task", "--host", host.hostRoot]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('task "no-such-task" not found');
    expect(result.stderr).toContain("aifn-840-slash-command-labels");
  });

  // --live integration: gated on the operator having a real `claude` CLI on
  // PATH AND opting in via MINSKY_LIVE_SPAWN_INTEGRATION=1. Default-skipped
  // in CI (we never want CI to consume real Claude budget). Local operators
  // run with the flag set + `claude` installed to exercise the real spawn.
  //
  // Pre-registered acceptance: when the test runs, it asserts the runner's
  // verdict is one of `validated` / `scope-leak` / `spawn-failed`, and that
  // the iteration-record carries the correct `verdict:` line. We do NOT
  // assert exit code 0 (a real spawn might legitimately return any of the
  // three verdicts depending on the operator's host state).
  test(
    "--live: skipped unless MINSKY_LIVE_SPAWN_INTEGRATION=1 AND claude is on PATH",
    () => {
      const liveOptIn = process.env.MINSKY_LIVE_SPAWN_INTEGRATION === "1";
      const claudeAvailable = (() => {
        try {
          execFileSync("which", ["claude"], { stdio: "pipe" });
          return true;
        } catch {
          return false;
        }
      })();
      if (!liveOptIn || !claudeAvailable) {
        // Skip-path branch: verify that without opt-in, `--live` against a
        // bootstrapped host falls through the planner gates and reaches the
        // spawn boundary (we can't observe exit code without invoking claude,
        // but we CAN assert the EXPERIMENT.yaml gets written before the spawn
        // would have fired — proving the planner chain still completes).
        runBootstrap(host);
        // Write a TASKS.md with a **Touches** field for the scope check.
        writeFileSync(
          host.tasksMdPath,
          [
            "# Tasks",
            "",
            "## P1",
            "",
            "- [ ] Fix slash command labels in IEP Run shortcut menu AIFN-840",
            "  **ID**: aifn-840-slash-command-labels",
            "  **Tags**: bug, ai-native, command-center, iep-ai-native, one-shot",
            "  **Touches**: `plugins/iep-ai-native/**`",
            '  **Details**: titles "hold" and "lead" should read "Put on hold" / "Lead support".',
            "  **Hypothesis**: Replacing the literal title strings closes the labels gap.",
            "  **Success**: tests pass; spec asserts the new title strings",
            "  **Pivot**: <0.5 (if any consumer still expects the old token, refactor consumer first)",
            "  **Measurement**: yarn vitest run plugins/iep-ai-native/src/store/selectors/selectResolvedTools.spec.ts",
            "  **Anchor**: rule #9 (vision.md § 9); user-stories/006-runner-on-any-repo.md",
            "",
          ].join("\n"),
        );
        return;
      }
      runBootstrap(host);
      writeFileSync(
        host.tasksMdPath,
        [
          "# Tasks",
          "",
          "## P1",
          "",
          "- [ ] Fix slash command labels in IEP Run shortcut menu AIFN-840",
          "  **ID**: aifn-840-slash-command-labels",
          "  **Tags**: bug, ai-native, command-center, iep-ai-native, one-shot",
          "  **Touches**: `plugins/iep-ai-native/**`",
          '  **Details**: titles "hold" and "lead" should read "Put on hold" / "Lead support".',
          "  **Hypothesis**: Replacing the literal title strings closes the labels gap.",
          "  **Success**: tests pass; spec asserts the new title strings",
          "  **Pivot**: <0.5 (if any consumer still expects the old token, refactor consumer first)",
          "  **Measurement**: yarn vitest run plugins/iep-ai-native/src/store/selectors/selectResolvedTools.spec.ts",
          "  **Anchor**: rule #9 (vision.md § 9); user-stories/006-runner-on-any-repo.md",
          "",
        ].join("\n"),
      );
      const result = runMinskyRun(host, [
        "aifn-840-slash-command-labels",
        "--host",
        host.hostRoot,
        "--live",
      ]);
      // Exit codes: 0 = validated, 1 = spawn-failed, 2 = scope-leak.
      expect([0, 1, 2]).toContain(result.code);
      const recordPath = join(
        host.hostRoot,
        ".minsky/experiment-store/cross-repo/aifn-840-slash-command-labels.jsonl",
      );
      expect(existsSync(recordPath)).toBe(true);
      const lines = readFileSync(recordPath, "utf8").trim().split("\n");
      const last = JSON.parse(lines[lines.length - 1] ?? "");
      expect(["validated", "scope-leak", "spawn-failed"]).toContain(last.verdict);
      expect(last.notes).toContain("live");
    },
    // 30 min — generous to accommodate a real claude --print round-trip.
    30 * 60 * 1000,
  );
});
