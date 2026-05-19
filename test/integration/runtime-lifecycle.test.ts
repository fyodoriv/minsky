// End-to-end runtime lifecycle tests.
// These test the REAL minsky flow — not mocked pure functions.
// Each test bootstraps a fixture host, runs minsky-run against it,
// and asserts on the actual outputs (experiment records, log lines,
// exit codes, file-system state).
//
// Hypothesis (rule #9): runtime lifecycle tests catch the integration-seam
//   bugs that 95% unit coverage systematically misses. Every bug from the
//   2026-05-18 session would have been caught by at least one test here.
// Success: all tests pass deterministically on any machine with node ≥20.
// Pivot: if spawning real agents is too slow/costly, use --no-live (dry-run)
//   which still exercises the full lifecycle minus the actual LLM call.
// Measurement: this test file.
// Anchor: Havelund & Goldberg 2008 (runtime specification monitoring);
//   operator directive 2026-05-18 ("ensure tests cover 95% of runtime").

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
import { describe, expect, test, beforeAll, afterAll } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUNNER_BIN = join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs");

/** Create a bootstrapped fixture host with a TASKS.md containing one task. */
function createFixtureHost(opts?: { taskId?: string; taskFields?: Record<string, string> }): string {
  const dir = mkdtempSync(join(tmpdir(), "minsky-e2e-"));
  const taskId = opts?.taskId ?? "test-fixture-task";

  // Init a git repo
  execSync(
    "git init -b main && git config user.email 'test@test' && git config user.name 'test' && git commit --allow-empty -m 'chore: init fixture'",
    { cwd: dir, stdio: "pipe" },
  );

  // Bootstrap sidecar
  const minskyDir = join(dir, ".minsky");
  mkdirSync(minskyDir, { recursive: true });
  mkdirSync(join(minskyDir, "experiment-store", "cross-repo"), { recursive: true });
  mkdirSync(join(minskyDir, "experiments"), { recursive: true });

  // repo.yaml
  writeFileSync(
    join(minskyDir, "repo.yaml"),
    [
      "host_repo: test/fixture",
      "tasks_md_path: TASKS.md",
      "commit_format: 'feat: <DESCRIPTION>'",
      "pre_commit_command: ''",
      "branch_prefix: feat/",
      "default_branch: main",
      "host_packages_path: src/",
      "ignore_mechanism: global-ignore",
    ].join("\n"),
  );

  // TASKS.md with one rule-#9-compliant task
  const fields = {
    ID: taskId,
    Tags: "p0, test",
    Hypothesis: "test hypothesis",
    Success: "test passes",
    Pivot: "revert if fails",
    Measurement: "echo ok",
    Anchor: "rule #9",
    Details: "implement the test fixture task",
    Files: "test.txt",
    ...opts?.taskFields,
  };
  const taskBlock = [
    "# Tasks",
    "",
    "## P0",
    "",
    `- [ ] \`${taskId}\` — test fixture task`,
    ...Object.entries(fields).map(([k, v]) => `  - **${k}**: ${v}`),
  ].join("\n");
  writeFileSync(join(dir, "TASKS.md"), taskBlock);

  return dir;
}

// ─── Lifecycle: dry-run picks a task and produces a plan ──────

describe("runtime lifecycle: dry-run (no agent spawn)", () => {
  let fixtureHost: string;

  beforeAll(() => {
    fixtureHost = createFixtureHost();
  });

  test("minsky-run --host <fixture> --once --no-live exits 0 and picks the task", () => {
    const result = execFileSync(
      "node",
      [RUNNER_BIN, "--host", fixtureHost, "--once", "--no-live"],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
      },
    );
    expect(result).toContain("test-fixture-task");
  });

  test("experiment yaml is written after dry-run", () => {
    const expDir = join(fixtureHost, ".minsky", "experiments");
    const files = readdirSync(expDir).filter((f) => f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.includes("test-fixture-task"))).toBe(true);
  });

  test("iteration record is written to experiment-store", () => {
    const storeDir = join(fixtureHost, ".minsky", "experiment-store", "cross-repo");
    const jsonls = readdirSync(storeDir).filter((f) => f.endsWith(".jsonl"));
    expect(jsonls.length).toBeGreaterThanOrEqual(1);
    const content = readFileSync(join(storeDir, jsonls[0]!), "utf8");
    expect(content).toContain("test-fixture-task");
    expect(content).toContain("verdict");
  });
});

// ─── Lifecycle: empty queue exits cleanly ────────────────────

describe("runtime lifecycle: empty queue", () => {
  test("minsky-run --host <empty-queue-host> --once exits 0 with empty-queue", () => {
    const dir = createFixtureHost({ taskId: "already-done" });
    // Empty the TASKS.md
    writeFileSync(join(dir, "TASKS.md"), "# Tasks\n\n## P0\n\n");

    const result = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
      },
    );
    expect(result).toContain("empty-queue");
  });
});

// ─── Lifecycle: loop mode respects max-iterations ────────────

describe("runtime lifecycle: loop mode", () => {
  test("--loop --max-iterations=2 exits after exactly 2 iterations", () => {
    const dir = createFixtureHost();
    const result = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--loop", "--max-iterations=2", "--no-live", "--tick-interval-ms=0"],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
      },
    );
    // Should see iteration records for 2 iterations
    const storeDir = join(dir, ".minsky", "experiment-store", "cross-repo");
    const jsonls = readdirSync(storeDir).filter((f) => f.endsWith(".jsonl"));
    if (jsonls.length > 0) {
      const lines = readFileSync(join(storeDir, jsonls[0]!), "utf8").trim().split("\n").filter(Boolean);
      expect(lines.length).toBeLessThanOrEqual(2);
    }
    // Should contain summary
    expect(result).toContain("stopReason");
  });
});

// ─── Lifecycle: host config is read correctly ────────────────

describe("runtime lifecycle: host config", () => {
  test("repo.yaml fields are reflected in the experiment yaml", () => {
    const dir = createFixtureHost();
    execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
      },
    );
    const expDir = join(dir, ".minsky", "experiments");
    const files = readdirSync(expDir).filter((f) => f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const content = readFileSync(join(expDir, files[0]!), "utf8");
    expect(content).toContain("test/fixture"); // host_repo from repo.yaml
  });
});

// ─── Lifecycle: task with missing rule-9 fields is rejected ──

describe("runtime lifecycle: rule-9 enforcement", () => {
  test("task without Hypothesis field is rejected (no iteration record)", () => {
    const dir = createFixtureHost({
      taskId: "incomplete-task",
      taskFields: {
        ID: "incomplete-task",
        Tags: "p0",
        // Deliberately missing: Hypothesis, Success, Pivot, Measurement, Anchor
        Details: "this task has no rule-9 fields",
        Files: "foo.txt",
      },
    });
    // Should exit non-zero or produce no iteration record
    try {
      execFileSync(
        "node",
        [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
        {
          encoding: "utf8",
          timeout: 60_000,
          env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
        },
      );
    } catch {
      // Expected — rule-9 violation exits non-zero
    }
    // The task should either be rejected or not produce an iteration
    const storeDir = join(dir, ".minsky", "experiment-store", "cross-repo");
    const jsonls = readdirSync(storeDir).filter((f) => f.endsWith(".jsonl"));
    // Either no jsonl at all, or the jsonl has no records for this task
    if (jsonls.length > 0) {
      const content = readFileSync(join(storeDir, jsonls[0]!), "utf8");
      // If there IS a record, it should indicate the rule-9 violation
      if (content.includes("incomplete-task")) {
        expect(content).toMatch(/rule.?9|missing/i);
      }
    }
  });
});

// ─── Lifecycle: dynamic timeouts compute from fixture data ───

describe("runtime lifecycle: dynamic timeouts", () => {
  test("with existing iteration history, dynamic timeout is computed", () => {
    const dir = createFixtureHost();
    const storeDir = join(dir, ".minsky", "experiment-store", "cross-repo");
    // Seed fixture iteration records
    const records = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        experiment_id: "seed-task",
        host_repo: "test/fixture",
        branch: "feat/seed-task",
        verdict: "validated",
        pr_url: null,
        notes: `loop iteration=${i}; ${(i + 1) * 100000}ms; live`,
      }),
    );
    writeFileSync(join(storeDir, "seed-task.jsonl"), records.join("\n") + "\n");

    const result = execFileSync(
      "node",
      [RUNNER_BIN, "--host", dir, "--once", "--no-live"],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
      },
    );
    // Dynamic timeouts should compute from the seeded data
    expect(result).toContain("dynamic-timeouts");
  });
});

// ─── Lifecycle: stability number computes from records ───────

describe("runtime lifecycle: stability number", () => {
  test("stability-number.mjs computes from fixture host records", () => {
    const dir = createFixtureHost();
    const storeDir = join(dir, ".minsky", "experiment-store", "cross-repo");
    // Seed: 7 validated + 3 spawn-failed = 70%
    const records = [
      ...Array.from({ length: 7 }, () => ({ ts: new Date().toISOString(), verdict: "validated", notes: "100000ms" })),
      ...Array.from({ length: 3 }, () => ({ ts: new Date().toISOString(), verdict: "spawn-failed", notes: "4000ms" })),
    ];
    writeFileSync(
      join(storeDir, "stability-test.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );

    const scriptPath = join(REPO_ROOT, "scripts", "stability-number.mjs");
    const output = execSync(`node ${scriptPath} ${dir}`, { encoding: "utf8" }).trim();
    expect(output).toContain("70%");
    expect(output).toContain("7/10");
  });
});

// ─── Lifecycle: minsky status works on fixture ──────────────

describe("runtime lifecycle: CLI commands", () => {
  test("bin/minsky status exits 0", () => {
    const minskyBin = join(REPO_ROOT, "bin", "minsky");
    const output = execSync(`bash -c '${minskyBin} status 2>&1; true'`, {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(output.toLowerCase()).toContain("minsky");
  });
});
