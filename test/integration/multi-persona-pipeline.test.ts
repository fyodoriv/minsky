// Integration test for the M2 multi-persona A2A pipeline driver
// (`bin/minsky-multi-persona.sh`). Drives the five personas
// (researcher → planner → developer → QA → reviewer) on a fixture task and
// asserts: every transition is logged with `persona=<role>` + an A2A task ID;
// the personas run in order; persona N's artifact is visible in persona N+1's
// brief (the artifact chain); and the chaos failure modes from
// `novel/personas/README.md` hold (unknown role → loud halt; missing task →
// loud halt; adapter-absent → graceful-degrade still logs).
//
// Hypothesis (rule #9): running the
// 5-persona pipeline via the A2A adapter collapses bespoke handoff orchestration
// into A2A verb calls per transition; `.minsky/iterations.jsonl` records ≥5
// `persona=` lines per run, and the researcher's artifact reaches the planner.
// Success: every test below passes.
// Pivot: if A2A's task lifecycle can't carry persona-to-persona context, the
//   driver falls back to a `.minsky/handoffs/<task>/<persona>.md` envelope
//   referenced by A2A URI — which is exactly the shape these tests pin.
// Measurement: this vitest file; `grep -c "persona=" .minsky/iterations.jsonl ≥5`.
// Anchor: user-stories/008-per-task-backend-and-personas.md § "M2 milestone";
//   competitors/metagpt.md § "SOP pattern"; novel/personas/README.md (chaos table);
//   Hewitt 1973 (actor model — each persona is an actor, the A2A message is the message).

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const DRIVER = join(REPO_ROOT, "bin", "minsky-multi-persona.sh");
const PERSONAS = ["researcher", "planner", "developer", "qa", "reviewer"] as const;

// The driver shells out to bash + python3 + jq + node. Extend PATH with the
// standard binary locations so the test works under lefthook's stripped-PATH
// pre-commit env (same pattern as worktree-isolation.test.ts).
const AUGMENTED_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  process.env["PATH"] ?? "",
]
  .filter(Boolean)
  .join(":");

function makeFixtureHost(): { dir: string; taskId: string } {
  const dir = mkdtempSync(join(tmpdir(), "minsky-multi-persona-"));
  const taskId = "fixture-pipeline-task";
  writeFileSync(
    join(dir, "TASKS.md"),
    [
      "# Tasks",
      "",
      "## P0",
      "",
      `- [ ] \`${taskId}\` — fixture task for the multi-persona pipeline test`,
      `  - **ID**: ${taskId}`,
      "  - **Tags**: p0, pipeline, fixture",
      "  - **Details**: a fixture task the 5-persona pipeline runs against",
      "  - **Hypothesis**: the pipeline walks all 5 personas in order",
      "  - **Success**: this test passes",
      "  - **Pivot**: fall back to a handoff envelope referenced by A2A URI",
      "  - **Measurement**: this vitest file",
      "  - **Anchor**: rule #9; user-stories/008",
      "",
    ].join("\n"),
  );
  return { dir, taskId };
}

function runDriver(taskId: string, host: string): { stdout: string; code: number } {
  try {
    const stdout = execFileSync("bash", [DRIVER, taskId, host], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: AUGMENTED_PATH },
    });
    return { stdout, code: 0 };
    // rule-6: handled-locally — execFileSync throws on non-zero exit; we want
    // the exit code as data (the failure-mode tests assert on it), not a crash.
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      stdout: `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`,
      code: e.status ?? 1,
    };
  }
}

function readJsonl(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("multi-persona A2A pipeline — bin/minsky-multi-persona.sh", () => {
  test("walks all 5 personas in order against a fixture task", () => {
    const { dir, taskId } = makeFixtureHost();
    const { code } = runDriver(taskId, dir);
    expect(code).toBe(0);
    const records = readJsonl(join(dir, ".minsky", "iterations.jsonl"));
    expect(records.map((r) => r["role"])).toEqual([...PERSONAS]);
  });

  test("every transition is logged with persona=<role> and an A2A task ID", () => {
    const { dir, taskId } = makeFixtureHost();
    runDriver(taskId, dir);
    const jsonlPath = join(dir, ".minsky", "iterations.jsonl");
    const raw = readFileSync(jsonlPath, "utf8");
    // The task's measurement: grep -c "persona=" .minsky/iterations.jsonl ≥ 5.
    const personaLines = raw.split("\n").filter((l) => l.includes("persona=")).length;
    expect(personaLines).toBeGreaterThanOrEqual(5);
    for (const record of readJsonl(jsonlPath)) {
      expect(record["task_id"]).toBe(taskId);
      expect(String(record["a2a_task_id"]).length).toBeGreaterThan(0);
      expect(record["transition"]).toBe(`persona=${String(record["role"])}`);
    }
  });

  test("each persona's artifact is observable in the next persona's brief (artifact chain)", () => {
    const { dir, taskId } = makeFixtureHost();
    runDriver(taskId, dir);
    const handoffDir = join(dir, ".minsky", "handoffs", taskId);
    // All five artifacts exist.
    for (const role of PERSONAS) {
      expect(existsSync(join(handoffDir, `${role}.md`))).toBe(true);
    }
    // The planner's brief embeds the researcher's artifact marker; the reviewer's
    // brief embeds QA's — the researcher → … → reviewer chain.
    const plannerBrief = readFileSync(join(handoffDir, "planner.md"), "utf8");
    expect(plannerBrief).toContain("persona=researcher");
    expect(plannerBrief).toContain("Prior persona artifact");
    const reviewerBrief = readFileSync(join(handoffDir, "reviewer.md"), "utf8");
    expect(reviewerBrief).toContain("persona=qa");
  });

  test("A2A adapter supplies the transition's task ID (the handoff substrate)", () => {
    const { dir, taskId } = makeFixtureHost();
    runDriver(taskId, dir);
    const records = readJsonl(join(dir, ".minsky", "iterations.jsonl"));
    // When the built @minsky/a2a dist is present, the A2AOpenHands.sendMessage
    // scaffold returns `task-<epoch>` IDs. When absent, the driver degrades to
    // `a2a-local-*` (chaos failure mode #3) — either is a non-empty ID.
    for (const record of records) {
      expect(String(record["a2a_task_id"])).toMatch(/^(task-|a2a-local-)/);
    }
  });

  test("chaos #1: unknown persona role is rejected by build_brief", () => {
    // The driver only ever passes the five valid roles, so the contract is
    // enforced at the build_brief seam: an unknown --persona exits non-zero.
    const { dir, taskId } = makeFixtureHost();
    let code = 0;
    try {
      execFileSync(
        "python3",
        [join(REPO_ROOT, "scripts", "build_brief.py"), taskId, dir, "--persona", "architect"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PATH: AUGMENTED_PATH },
        },
      );
      // rule-6: handled-locally — non-zero exit throws; we capture the code.
    } catch (err) {
      code = (err as { status?: number }).status ?? 1;
    }
    expect(code).not.toBe(0);
  });

  test("chaos #2: missing task halts the pipeline loudly (no partial run)", () => {
    const { dir } = makeFixtureHost();
    const { code, stdout } = runDriver("no-such-task-id", dir);
    expect(code).not.toBe(0);
    expect(stdout).toContain("build_brief failed");
    // No transitions were logged — the pipeline did not partially run.
    expect(existsSync(join(dir, ".minsky", "iterations.jsonl"))).toBe(false);
  });

  test("chaos #4: a second run leaves exactly 5 fresh handoff artifacts (idempotent)", () => {
    const { dir, taskId } = makeFixtureHost();
    runDriver(taskId, dir);
    runDriver(taskId, dir);
    const handoffDir = join(dir, ".minsky", "handoffs", taskId);
    const artifacts = PERSONAS.filter((r) => existsSync(join(handoffDir, `${r}.md`)));
    expect(artifacts).toHaveLength(5);
  });
});
