// Paired tests for `runner.ts` — the live-spawn orchestrator.
//
// Pattern: paired unit test (rule #3 — test-first; same-file pair so the
//   contract is co-located with the helper). Source: TASKS.md
//   `cross-repo-runner-v1-live-spawn` § "Files"; user-stories/006-runner-on-any-repo.md
//   chaos rows 4 (budget-pause) + 7 (sandbox-leak).
// Conformance: full — every test injects in-memory fakes for the
//   `SpawnLike` + `GitLike` seams; no shell-outs, no fs writes.

import { describe, expect, test } from "vitest";

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

describe("extractAllowedPathsFromTaskBlock", () => {
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

describe("runLive — PR-creation backstop (devin-spawn-no-pr-opened pivot)", () => {
  type GhCall =
    | { kind: "findOpenPr"; hostRepo: string; branch: string }
    | {
        kind: "createPr";
        hostRepo: string;
        branch: string;
        base: string;
        title: string;
        body: string;
        workingDir: string;
      };

  function fakeGh(args: {
    existingPr?: string | null;
    createdPr?: string | null;
  }): { gh: import("./runner.js").GhLike; calls: GhCall[] } {
    const calls: GhCall[] = [];
    const gh: import("./runner.js").GhLike = {
      findOpenPr(input): Promise<string | null> {
        calls.push({ kind: "findOpenPr", ...input });
        return Promise.resolve(args.existingPr ?? null);
      },
      createPr(input): Promise<string | null> {
        calls.push({ kind: "createPr", ...input });
        return Promise.resolve(args.createdPr ?? null);
      },
    };
    return { gh, calls };
  }

  test("falls back to stdout-only when no gh seam is injected", async () => {
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0, stdoutTail: "no URL here" }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
    });
    expect(result.verdict).toBe("validated");
    expect(result.prUrl).toBeNull();
  });

  test("stdout PR URL wins; gh seam is NEVER called when one is found", async () => {
    const { gh, calls } = fakeGh({});
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({
        exitCode: 0,
        stdoutTail: "Opened https://github.com/test/repo/pull/77",
      }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      hostRepo: "test/repo",
      defaultBranch: "main",
    });
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/77");
    expect(calls.length).toBe(0);
  });

  test("findOpenPr URL wins when stdout is empty and PR already exists", async () => {
    const { gh, calls } = fakeGh({
      existingPr: "https://github.com/test/repo/pull/123",
    });
    const result = await runLive({
      plan: makePlan({ branchName: "feat/fake-task-1" }),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0, stdoutTail: "" }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      hostRepo: "test/repo",
      defaultBranch: "main",
    });
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/123");
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({
      kind: "findOpenPr",
      hostRepo: "test/repo",
      branch: "feat/fake-task-1",
    });
  });

  test("createPr is invoked when stdout empty AND no existing PR", async () => {
    const { gh, calls } = fakeGh({
      existingPr: null,
      createdPr: "https://github.com/test/repo/pull/200",
    });
    const result = await runLive({
      plan: makePlan({
        branchName: "feat/fake-task-1",
        taskId: "fake-task-1",
        workingDirectory: "/tmp/fake-host",
      }),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0, stdoutTail: "" }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      hostRepo: "test/repo",
      defaultBranch: "main",
    });
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/200");
    expect(calls.length).toBe(2);
    const findCall = calls[0];
    const createCall = calls[1];
    expect(findCall?.kind).toBe("findOpenPr");
    expect(createCall?.kind).toBe("createPr");
    if (createCall === undefined || createCall.kind !== "createPr") {
      throw new Error("test fixture invariant violated — createPr call missing");
    }
    expect(createCall.hostRepo).toBe("test/repo");
    expect(createCall.branch).toBe("feat/fake-task-1");
    expect(createCall.base).toBe("main");
    expect(createCall.title).toContain("fake-task-1");
    // Body must satisfy `check-pr-self-grade.mjs` — header + four fields.
    expect(createCall.body).toMatch(/Hypothesis self-grade/i);
    expect(createCall.body).toMatch(/Predicted:/i);
    expect(createCall.body).toMatch(/Observed:/i);
    expect(createCall.body).toMatch(/Match:\s*partial/i);
    expect(createCall.body).toMatch(/Lesson:/i);
    expect(createCall.workingDir).toBe("/tmp/fake-host");
  });

  test("createPr failure preserves legacy behaviour (validated + null prUrl)", async () => {
    const { gh } = fakeGh({ existingPr: null, createdPr: null });
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0, stdoutTail: "" }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      hostRepo: "test/repo",
      defaultBranch: "main",
    });
    expect(result.verdict).toBe("validated");
    expect(result.prUrl).toBeNull();
  });

  test("backstop is SKIPPED on scope-leak (verdict supersedes the cascade)", async () => {
    const { gh, calls } = fakeGh({ existingPr: "https://github.com/test/repo/pull/99" });
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: ["src/**"],
      spawn: fakeSpawn({ exitCode: 0 }),
      git: fakeGit({ changed: ["src/foo.ts", "outside.txt"] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      hostRepo: "test/repo",
      defaultBranch: "main",
    });
    expect(result.verdict).toBe("scope-leak");
    expect(result.prUrl).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("backstop is SKIPPED on spawn-failed (verdict supersedes the cascade)", async () => {
    const { gh, calls } = fakeGh({ existingPr: "https://github.com/test/repo/pull/99" });
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 1, stderrTail: "boom" }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      hostRepo: "test/repo",
      defaultBranch: "main",
    });
    expect(result.verdict).toBe("spawn-failed");
    expect(result.prUrl).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("backstop is no-op when hostRepo is omitted (defensive)", async () => {
    const { gh, calls } = fakeGh({ existingPr: "https://github.com/test/repo/pull/99" });
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0, stdoutTail: "" }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      // hostRepo deliberately omitted
      defaultBranch: "main",
    });
    expect(result.verdict).toBe("validated");
    expect(result.prUrl).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("backstop is no-op when defaultBranch is omitted (defensive)", async () => {
    const { gh, calls } = fakeGh({ existingPr: "https://github.com/test/repo/pull/99" });
    const result = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: fakeSpawn({ exitCode: 0, stdoutTail: "" }),
      git: fakeGit({ changed: [] }),
      globMatchesPath: fakeGlobMatch,
      gh,
      hostRepo: "test/repo",
      // defaultBranch deliberately omitted
    });
    expect(result.verdict).toBe("validated");
    expect(result.prUrl).toBeNull();
    expect(calls.length).toBe(0);
  });
});

// Silence unused-var warning on baseEnv — left in place for any future
// test that needs an env override fixture.
void baseEnv;
