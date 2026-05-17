// Paired tests for `runner.ts` — the live-spawn orchestrator.
//
// Pattern: paired unit test (rule #3 — test-first; same-file pair so the
//   contract is co-located with the helper). Source: TASKS.md
//   `cross-repo-runner-v1-live-spawn` § "Files"; user-stories/006-runner-on-any-repo.md
//   chaos rows 4 (budget-pause) + 7 (sandbox-leak).
// Conformance: full — every test injects in-memory fakes for the
//   `SpawnLike` + `GitLike` seams; no shell-outs, no fs writes.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type { RunnerPlan } from "./spawn-plan.js";

import { extractAllowedPathsFromTaskBlock, extractPrUrl, runLive } from "./runner.js";

const baseEnv: NodeJS.ProcessEnv = { ...process.env };

function makePlan(overrides: Partial<RunnerPlan> = {}): RunnerPlan {
  return {
    workingDirectory: "/tmp/fake-host",
    taskId: "fake-task-1",
    branchName: "feat/fake-task-1",
    experimentYamlPath: "/tmp/fake-host/.minsky/experiments/fake-task-1.yaml",
    env: { MINSKY_HOST_ROOT: "/tmp/fake-host/.minsky" },
    systemPromptOverlay: "system prompt",
    brief: "task brief",
    preCommitCommand: "yarn lint",
    ...overrides,
  };
}

function fakeSpawn(result: {
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  durationMs?: number;
}): import("./runner.js").SpawnLike {
  return {
    spawn(): Promise<{
      exitCode: number;
      durationMs: number;
      stdoutTail: string;
      stderrTail: string;
    }> {
      return Promise.resolve({
        exitCode: result.exitCode ?? 0,
        durationMs: result.durationMs ?? 100,
        stdoutTail: result.stdoutTail ?? "",
        stderrTail: result.stderrTail ?? "",
      });
    },
  };
}

function fakeGit(args: {
  baselineRef?: string;
  changed?: readonly string[];
}): import("./runner.js").GitLike {
  return {
    captureBaseline(): Promise<string> {
      return Promise.resolve(args.baselineRef ?? "abc1234");
    },
    changedFiles(): Promise<readonly string[]> {
      return Promise.resolve(args.changed ?? []);
    },
  };
}

// Minimal glob matcher matching the daemon's `globMatchesPath` semantics
// (rule #1 — same parser as touches-glob). `*` matches any chars including
// `/`; `?` matches one char; otherwise literal.
function fakeGlobMatch(glob: string, path: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(path);
}

describe("runLive — happy path", () => {
  test("verdict=validated when spawn exits 0 and diff is empty", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({ exitCode: 0 }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("validated");
    expect(result.scopeLeakPaths).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.baselineRef).toBe("abc1234");
  });

  test("verdict=validated when allowedPaths is empty (scope opt-out)", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0 }),
      git: fakeGit({ changed: ["arbitrary/path.ts", "any/other/file.md"] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("validated");
    expect(result.scopeLeakPaths).toEqual([]);
  });

  test("verdict=validated AND extracts PR URL from stdout tail", async () => {
    const stdoutTail = "Working on the task...\nOpened PR https://github.com/test/repo/pull/42";
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0, stdoutTail }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("validated");
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/42");
  });

  test("validated path with all changed files inside allowed globs", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**", "test/**"],
      spawn: fakeSpawn({ exitCode: 0 }),
      git: fakeGit({ changed: ["src/foo.ts", "test/foo.test.ts"] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("validated");
  });
});

describe("runLive — scope-leak detection (chaos row 7)", () => {
  test("verdict=scope-leak when spawn writes a file outside allowedPaths", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({ exitCode: 0 }),
      git: fakeGit({ changed: ["src/foo.ts", "package.json"] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("scope-leak");
    expect(result.scopeLeakPaths).toEqual(["package.json"]);
    expect(result.prUrl).toBeNull();
  });

  test("scope-leak captures EVERY leaked path, not just the first", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({ exitCode: 0 }),
      git: fakeGit({ changed: ["src/foo.ts", "package.json", "README.md", "test/a.ts"] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("scope-leak");
    expect(result.scopeLeakPaths).toEqual(["package.json", "README.md", "test/a.ts"]);
  });

  test("scope-leak does NOT extract PR URL (leak supersedes success)", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({
        exitCode: 0,
        stdoutTail: "PR https://github.com/test/repo/pull/99",
      }),
      git: fakeGit({ changed: ["src/foo.ts", "arbitrary.bin"] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("scope-leak");
    expect(result.prUrl).toBeNull();
  });
});

describe("runLive — spawn-failed (chaos row: non-zero spawn exit)", () => {
  test("verdict=spawn-failed when spawn exits non-zero", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({ exitCode: 1, stderrTail: "claude: ENOENT" }),
      git: fakeGit({ changed: ["src/foo.ts"] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("spawn-failed");
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toBe("claude: ENOENT");
    expect(result.scopeLeakPaths).toEqual([]);
  });

  test("spawn-failed skips the git diff step (rule #6 let-it-crash boundary)", async () => {
    let diffCalled = false;
    const git: import("./runner.js").GitLike = {
      captureBaseline(): Promise<string> {
        return Promise.resolve("abc1234");
      },
      changedFiles(): Promise<readonly string[]> {
        diffCalled = true;
        return Promise.resolve([]);
      },
    };
    await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({ exitCode: 137 }),
      git,
      globMatchesPath: fakeGlobMatch,
    });
    expect(diffCalled).toBe(false);
  });
});

describe("extractPrUrl", () => {
  test("returns null on empty / no-match stdout", () => {
    expect(extractPrUrl("")).toBeNull();
    expect(extractPrUrl("nothing to see here")).toBeNull();
  });

  test("extracts the only PR URL on a clean stdout", () => {
    expect(extractPrUrl("PR: https://github.com/test/repo/pull/1")).toBe(
      "https://github.com/test/repo/pull/1",
    );
  });

  test("returns the LAST URL when multiple appear (the actual PR, not example refs)", () => {
    const stdout = [
      "see PR https://github.com/example/foo/pull/1 for reference",
      "...",
      "Opened https://github.com/real/host/pull/999",
    ].join("\n");
    expect(extractPrUrl(stdout)).toBe("https://github.com/real/host/pull/999");
  });

  test("handles GHE-style hosts (not just github.com)", () => {
    expect(extractPrUrl("Opened https://github.example.corp/team/proj/pull/42")).toBe(
      "https://github.example.corp/team/proj/pull/42",
    );
  });
});

describe("extractAllowedPathsFromTaskBlock — parser", () => {
  // The 5 tests below are about the PARSER's extraction shape, not the
  // implicit-allowed-paths union policy. Disable the implicit set here so
  // the existing contract assertions stay focused on what's parsed from
  // the block's text. The union behaviour is tested separately below.
  //
  // Save-and-restore over delete (biome lint/performance/noDelete): mirrors
  // novel/budget-guard/src/http-server.test.ts and avoids the "undefined as
  // string" coercion trap on process.env[X] = undefined.
  let savedImplicit: string | undefined;
  beforeAll(() => {
    savedImplicit = process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"];
    process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"] = "";
  });
  afterAll(() => {
    if (savedImplicit === undefined) {
      // biome-ignore lint/performance/noDelete: assigning undefined coerces to "undefined" string in node env
      delete process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"];
    } else {
      process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"] = savedImplicit;
    }
  });

  test("returns [] when neither field is present", () => {
    expect(extractAllowedPathsFromTaskBlock("- [ ] Task\n  - **ID**: x")).toEqual([]);
  });

  test("extracts Touches globs (backticked or plain)", () => {
    const block = ["- [ ] Task", "  - **ID**: x", "  - **Touches**: `src/**`, `test/foo.ts`"].join(
      "\n",
    );
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual(["src/**", "test/foo.ts"]);
  });

  test("falls back to Files field when Touches is absent", () => {
    const block = [
      "- [ ] Task",
      "  - **ID**: x",
      "  - **Files**: `src/runner.ts`, `src/runner.test.ts`",
    ].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual([
      "src/runner.ts",
      "src/runner.test.ts",
    ]);
  });

  test("Touches wins over Files when both are present", () => {
    const block = [
      "- [ ] Task",
      "  - **ID**: x",
      "  - **Touches**: `src/**`",
      "  - **Files**: `whatever.ts`",
    ].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual(["src/**"]);
  });

  test("strips backticks and trims whitespace", () => {
    const block = [
      "- [ ] Task",
      "  - **ID**: x",
      "  - **Touches**:    `src/**`  ,   `test/foo.ts`  ",
    ].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual(["src/**", "test/foo.ts"]);
  });
});

describe("extractAllowedPathsFromTaskBlock — implicit allowed paths", () => {
  // The implicit-paths union closes the scope-leak loophole observed on
  // example-service-api 2026-05-16: every devin worker is brief-instructed to
  // remove the shipped task block from TASKS.md, but no task author lists
  // TASKS.md in **Files**: (it's repo-meta, not code surface). The union
  // appends `TASKS.md` + `AGENTS.md` to whatever the block declared so
  // brief-mandated cleanup paths don't trigger scope-leak verdicts.

  // Save-and-restore over delete (biome lint/performance/noDelete) — mirrors
  // the parser block above so per-test env overrides don't leak.
  let savedImplicit: string | undefined;
  beforeEach(() => {
    savedImplicit = process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"];
  });
  afterEach(() => {
    if (savedImplicit === undefined) {
      // biome-ignore lint/performance/noDelete: assigning undefined coerces to "undefined" string in node env
      delete process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"];
    } else {
      process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"] = savedImplicit;
    }
  });

  test("default: TASKS.md + AGENTS.md are appended to declared Touches", () => {
    const block = ["- [ ] Task", "  - **ID**: x", "  - **Touches**: `src/foo.ts`"].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual([
      "src/foo.ts",
      "TASKS.md",
      "AGENTS.md",
    ]);
  });

  test("default: TASKS.md + AGENTS.md are appended to declared Files (fallback path)", () => {
    const block = ["- [ ] Task", "  - **ID**: x", "  - **Files**: `server/db-example-model.ts`"].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual([
      "server/db-example-model.ts",
      "TASKS.md",
      "AGENTS.md",
    ]);
  });

  test("no-declaration blocks stay empty (implicit paths are additive, not load-bearing)", () => {
    // detectScopeLeak short-circuits on empty allowed-paths — preserving
    // today's "no scope = no leak" semantics for tasks that declared no scope.
    expect(extractAllowedPathsFromTaskBlock("- [ ] Task\n  - **ID**: x")).toEqual([]);
  });

  test("dedup: when declared paths already include TASKS.md, no duplicate is added", () => {
    const block = [
      "- [ ] Task",
      "  - **ID**: x",
      "  - **Touches**: `TASKS.md`, `src/foo.ts`, `AGENTS.md`",
    ].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual([
      "TASKS.md",
      "src/foo.ts",
      "AGENTS.md",
    ]);
  });

  test("env override replaces the implicit set", () => {
    process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"] = "docs/, CHANGELOG.md";
    const block = ["- [ ] Task", "  - **ID**: x", "  - **Touches**: `src/foo.ts`"].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual([
      "src/foo.ts",
      "docs/",
      "CHANGELOG.md",
    ]);
  });

  test("env empty string disables the implicit union", () => {
    process.env["MINSKY_IMPLICIT_ALLOWED_PATHS"] = "";
    const block = ["- [ ] Task", "  - **ID**: x", "  - **Touches**: `src/foo.ts`"].join("\n");
    expect(extractAllowedPathsFromTaskBlock(block)).toEqual(["src/foo.ts"]);
  });
});

describe("runLive — baseline capture", () => {
  test("baselineRef is captured BEFORE spawn (returned in outcome)", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({}),
      git: fakeGit({ baselineRef: "deadbeef" }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.baselineRef).toBe("deadbeef");
  });

  test("baselineRef is preserved even when verdict is scope-leak", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({}),
      git: fakeGit({ baselineRef: "cafef00d", changed: ["package.json"] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("scope-leak");
    expect(result.baselineRef).toBe("cafef00d");
  });

  test("baselineRef is preserved even when verdict is spawn-failed", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({ exitCode: 2 }),
      git: fakeGit({ baselineRef: "feedface" }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("spawn-failed");
    expect(result.baselineRef).toBe("feedface");
  });
});

// Silence unused-var warning on baseEnv — left in place for any future
// test that needs an env override fixture.
void baseEnv;
