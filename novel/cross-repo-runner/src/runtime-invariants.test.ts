// Paired tests for runtime invariants.
// Each test exercises the EXACT bug class that 95% unit coverage missed.
//
// 2026-05-19 rule-#17 fix: the import list previously named 25 invariants,
// only 6 of which were implemented in runtime-invariants.ts. The other 19
// were aspirational — never used in any test body, only listed in the
// import block. This produced 25 TS2305 errors that broke the
// `novel/cross-repo-runner` tsc build, which in turn failed every
// integration test that does a build-from-source check (e.g.
// `aifn-840-shape.test.ts`). Per rule #17, every observed-but-unfixed
// build error is a violation: fix the imports to match the actual public
// surface, file the aspirational invariants as TASKS.md entries instead
// of leaving them in a dead import block.

import { describe, expect, test } from "vitest";

import {
  agentArgvSanityCheck,
  briefIncludesPrInstructions,
  checkRuntimeInvariants,
  daemonPidConsistent,
  formatInvariantSummary,
  gitTreeCleanBeforeSpawn,
  taskNotStuckInRepickLoop,
  type InvariantContext,
} from "./runtime-invariants.js";

function baseCtx(overrides: Partial<InvariantContext> = {}): InvariantContext {
  return {
    agentCommand: "devin",
    agentArgv: ["--print", "--permission-mode", "dangerous", "--prompt-file", "/tmp/brief.md"],
    hostRoot: "/tmp/host",
    gitClean: true,
    briefContent: "... gh pr create --base main ...",
    taskId: "test-task",
    lastIterationDurationMs: null,
    lastIterationVerdict: null,
    taskIterationCount: 0,
    daemonPidAlive: true,
    ...overrides,
  };
}

// ── agentArgvSanityCheck ──

describe("agentArgvSanityCheck", () => {
  test("devin with --permission-mode + --prompt-file → ok", () => {
    const r = agentArgvSanityCheck(baseCtx());
    expect(r.ok).toBe(true);
  });

  test("devin WITHOUT --permission-mode → error (the 2026-05-18 bug)", () => {
    const r = agentArgvSanityCheck(
      baseCtx({ agentArgv: ["--print", "--prompt-file", "/tmp/brief.md"] }),
    );
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("error");
    expect(r.message).toContain("--permission-mode");
  });

  test("devin WITHOUT --prompt-file → error (the stdin panic bug)", () => {
    const r = agentArgvSanityCheck(
      baseCtx({ agentArgv: ["--print", "--permission-mode", "dangerous"] }),
    );
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("error");
    expect(r.message).toContain("--prompt-file");
  });

  test("claude agent → ok regardless of argv (not devin)", () => {
    const r = agentArgvSanityCheck(
      baseCtx({ agentCommand: "claude", agentArgv: ["--print"] }),
    );
    expect(r.ok).toBe(true);
  });
});

// ── briefIncludesPrInstructions ──

describe("briefIncludesPrInstructions", () => {
  test("brief with gh pr create → ok", () => {
    const r = briefIncludesPrInstructions(baseCtx());
    expect(r.ok).toBe(true);
  });

  test("brief with git push → ok", () => {
    const r = briefIncludesPrInstructions(
      baseCtx({ briefContent: "... git push -u origin HEAD ..." }),
    );
    expect(r.ok).toBe(true);
  });

  test("brief WITHOUT any PR instruction → warn (the no-pr-opened bug)", () => {
    const r = briefIncludesPrInstructions(
      baseCtx({ briefContent: "Just implement the task. Do your best." }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("never open a PR");
  });
});

// ── gitTreeCleanBeforeSpawn ──

describe("gitTreeCleanBeforeSpawn", () => {
  test("clean tree → ok", () => {
    const r = gitTreeCleanBeforeSpawn(baseCtx());
    expect(r.ok).toBe(true);
  });

  test("dirty tree → warn (the scope-leak false-positive bug)", () => {
    const r = gitTreeCleanBeforeSpawn(baseCtx({ gitClean: false }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("scope-leak");
  });
});

// ── taskNotStuckInRepickLoop ──

describe("taskNotStuckInRepickLoop", () => {
  test("first iteration → ok", () => {
    const r = taskNotStuckInRepickLoop(baseCtx());
    expect(r.ok).toBe(true);
  });

  test("5th iteration with spawn-failed → warn (stuck loop)", () => {
    const r = taskNotStuckInRepickLoop(
      baseCtx({ taskIterationCount: 5, lastIterationVerdict: "spawn-failed" }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("re-pick loop");
  });

  test("5th iteration with validated → ok (making progress)", () => {
    const r = taskNotStuckInRepickLoop(
      baseCtx({ taskIterationCount: 5, lastIterationVerdict: "validated" }),
    );
    expect(r.ok).toBe(true);
  });
});

// ── daemonPidConsistent ──

describe("daemonPidConsistent", () => {
  test("pid alive → ok", () => {
    const r = daemonPidConsistent(baseCtx());
    expect(r.ok).toBe(true);
  });

  test("pid not alive → warn (stale PID — the #1 operational bug)", () => {
    const r = daemonPidConsistent(baseCtx({ daemonPidAlive: false }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("stale PID");
  });
});

// ── checkRuntimeInvariants (all together) ──

describe("checkRuntimeInvariants", () => {
  test("all-green context → all ok", () => {
    const results = checkRuntimeInvariants(baseCtx());
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("devin without permission-mode → at least one error", () => {
    const results = checkRuntimeInvariants(
      baseCtx({ agentArgv: ["--print", "--prompt-file", "/tmp/x.md"] }),
    );
    const errors = results.filter((r) => !r.ok && r.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.id).toBe("agent-argv-sanity");
  });

  test("multiple issues at once → multiple failures", () => {
    const results = checkRuntimeInvariants(
      baseCtx({
        agentArgv: ["--print"], // missing both --permission-mode and --prompt-file
        briefContent: "no pr instructions",
        gitClean: false,
        taskIterationCount: 10,
        lastIterationVerdict: "scope-leak",
        daemonPidAlive: false,
      }),
    );
    const failures = results.filter((r) => !r.ok);
    expect(failures.length).toBeGreaterThanOrEqual(4);
  });
});

// ── formatInvariantSummary ──

describe("formatInvariantSummary", () => {
  test("all ok → ✅ message", () => {
    const results = checkRuntimeInvariants(baseCtx());
    const summary = formatInvariantSummary(results);
    expect(summary).toContain("✅");
    expect(summary).toContain("ok");
  });

  test("errors → 🚨 message with details", () => {
    const results = checkRuntimeInvariants(
      baseCtx({ agentArgv: ["--print"] }),
    );
    const summary = formatInvariantSummary(results);
    expect(summary).toContain("🚨");
    expect(summary).toContain("ERROR");
  });

  test("warns only → ⚠️ message", () => {
    const results = checkRuntimeInvariants(
      baseCtx({ gitClean: false }),
    );
    const summary = formatInvariantSummary(results);
    expect(summary).toContain("⚠️");
    expect(summary).toContain("warn");
  });
});
