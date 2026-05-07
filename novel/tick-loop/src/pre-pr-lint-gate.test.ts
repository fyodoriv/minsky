// Tests for pre-pr-lint-gate.ts. All four verification cases from
// TASKS.md `daemon-pre-pr-lint-gate`:
//   (a) happy path — lint passes on first attempt
//   (b) one lint fails then passes — gate passes with attempts=2
//   (c) 3 retries exhausted — verdict "fail", failedStep carried through
//   (d) opt-out via Blocked label — shouldRunPrePrLintGate returns false
// Plus an integration-style test that simulates a rule-7-chaos-coverage
// violation and verifies the gate retries 3× rather than declaring pass.

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  type PrePrLintRunResult,
  createBodyAwarePrePrLintRun,
  createPnpmPrePrLintRun,
  parseStackNdjson,
  runPrePrLintGate,
  shouldRunPrePrLintGate,
} from "./pre-pr-lint-gate.js";

describe("parseStackNdjson", () => {
  it("parses the canonical NDJSON output (per-step rows + trailing summary)", () => {
    const raw = [
      JSON.stringify({ name: "biome", verdict: "pass", durationMs: 455, exitCode: 0 }),
      JSON.stringify({ name: "typecheck", verdict: "pass", durationMs: 2077, exitCode: 0 }),
      JSON.stringify({ summary: true, stage: "fast", allPass: true, stepCount: 2 }),
    ].join("\n");
    const parsed = parseStackNdjson(raw);
    expect(parsed.allPass).toBe(true);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]).toMatchObject({ name: "biome", verdict: "pass" });
    expect(parsed.steps[1]).toMatchObject({ name: "typecheck", verdict: "pass" });
  });

  it("propagates allPass=false when summary says so", () => {
    const raw = [
      JSON.stringify({ name: "biome", verdict: "fail", stderrTail: "lint error" }),
      JSON.stringify({ name: "typecheck", verdict: "pass" }),
      JSON.stringify({ summary: true, stage: "fast", allPass: false, stepCount: 2 }),
    ].join("\n");
    const parsed = parseStackNdjson(raw);
    expect(parsed.allPass).toBe(false);
    const failed = parsed.steps.find((s) => s.verdict === "fail");
    expect(failed).toMatchObject({ name: "biome", stderrTail: "lint error" });
  });

  it("ignores blank lines and trims whitespace", () => {
    const raw = [
      "",
      `  ${JSON.stringify({ name: "biome", verdict: "pass" })}  `,
      "",
      JSON.stringify({ summary: true, stage: "fast", allPass: true, stepCount: 1 }),
      "",
    ].join("\n");
    const parsed = parseStackNdjson(raw);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.allPass).toBe(true);
  });

  it("throws when stdout is empty (script crash before any output)", () => {
    expect(() => parseStackNdjson("")).toThrow(/empty stdout/);
    expect(() => parseStackNdjson("   \n  \n")).toThrow(/empty stdout/);
  });

  it("throws when summary row is missing (script crashed mid-stream)", () => {
    const raw = [
      JSON.stringify({ name: "biome", verdict: "pass" }),
      JSON.stringify({ name: "typecheck", verdict: "pass" }),
      // no summary
    ].join("\n");
    expect(() => parseStackNdjson(raw)).toThrow(/missing trailing summary row/);
  });

  it("throws on invalid JSON (lets caller surface as Error with stderr context)", () => {
    const raw = [
      JSON.stringify({ name: "biome", verdict: "pass" }),
      "this-is-not-json",
      JSON.stringify({ summary: true, stage: "fast", allPass: true, stepCount: 1 }),
    ].join("\n");
    expect(() => parseStackNdjson(raw)).toThrow();
  });
});

describe("runPrePrLintGate", () => {
  it("happy path: lint passes on first attempt → verdict pass, attempts 1", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "pass",
    });
    const result = await runPrePrLintGate({ runLint });
    expect(result).toEqual({ verdict: "pass", attempts: 1 });
    expect(runLint).toHaveBeenCalledTimes(1);
  });

  it("one lint fails then passes → verdict pass, attempts 2", async () => {
    const runLint = vi
      .fn<() => Promise<PrePrLintRunResult>>()
      .mockResolvedValueOnce({ verdict: "fail", failedStep: "biome", stderrTail: "lint error" })
      .mockResolvedValueOnce({ verdict: "pass" });
    const result = await runPrePrLintGate({ runLint });
    expect(result).toEqual({ verdict: "pass", attempts: 2 });
    expect(runLint).toHaveBeenCalledTimes(2);
  });

  it("3 retries exhausted → verdict fail, attempts 3, failedStep from last attempt", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "fail",
      failedStep: "typecheck",
      stderrTail: "TS2345: type error",
    });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 3 });
    expect(result).toEqual({
      verdict: "fail",
      attempts: 3,
      failedStep: "typecheck",
      stderrTail: "TS2345: type error",
    });
    expect(runLint).toHaveBeenCalledTimes(3);
  });

  it("maxAttempts=1 exhausts immediately on a single failure", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "fail",
      failedStep: "markdownlint",
    });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 1 });
    expect(result.verdict).toBe("fail");
    expect(result.attempts).toBe(1);
    expect(result.failedStep).toBe("markdownlint");
    expect(runLint).toHaveBeenCalledTimes(1);
  });

  it("passes on attempt 3 of 3 (last-minute fix)", async () => {
    const runLint = vi
      .fn<() => Promise<PrePrLintRunResult>>()
      .mockResolvedValueOnce({ verdict: "fail", failedStep: "tasks-lint" })
      .mockResolvedValueOnce({ verdict: "fail", failedStep: "tasks-lint" })
      .mockResolvedValueOnce({ verdict: "pass" });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 3 });
    expect(result).toEqual({ verdict: "pass", attempts: 3 });
  });

  it("rule-7-chaos-coverage violation: gate retries 3× and does not declare pass on first fail (integration)", async () => {
    // Simulates a daemon PR where a new novel/ module ships without a chaos
    // table row in its README.md. The gate sees rule-7-chaos-coverage fail on
    // every attempt (inner Claude never fixed it in this scenario). The gate
    // must retry up to maxAttempts and return "fail" rather than opening the
    // PR on the first failure — the key invariant of TASKS.md
    // `daemon-pre-pr-lint-gate` Detail (b): "daemon iterates on the fix
    // instead of opening the PR".
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "fail",
      failedStep: "rule-7-chaos-coverage",
      stderrTail: "novel/new-module/README.md: missing Chaos test column",
    });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 3 });

    // Gate returns fail (not pass) — PR should NOT be opened.
    expect(result.verdict).toBe("fail");
    // Gate retried 3 times (not just once) before giving up.
    expect(result.attempts).toBe(3);
    expect(result.failedStep).toBe("rule-7-chaos-coverage");
    // Daemon emits the noop-exit token with the step name so the operator can
    // grep `.minsky/tick-loop.out.log` for `pre-pr-lint-failures: rule-7-chaos-coverage`.
    expect(runLint).toHaveBeenCalledTimes(3);
  });

  it("failedStep and stderrTail absent when last attempt passes (no pollution in pass result)", async () => {
    const runLint = vi
      .fn<() => Promise<PrePrLintRunResult>>()
      .mockResolvedValue({ verdict: "pass" });
    const result = await runPrePrLintGate({ runLint });
    expect(result.verdict).toBe("pass");
    expect(result.failedStep).toBeUndefined();
    expect(result.stderrTail).toBeUndefined();
  });
});

describe("shouldRunPrePrLintGate", () => {
  it("returns true for a normal task block", () => {
    const taskBlock = [
      "- [ ] `some-task` — do the thing",
      "  - **ID**: some-task",
      "  - **Tags**: p0",
    ].join("\n");
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(true);
  });

  it("returns false when task contains Blocked: pre-pr-lint-failures (opt-out)", () => {
    const taskBlock = [
      "- [ ] `some-task` — do the thing",
      "  - **ID**: some-task",
      "  - **Blocked**: pre-pr-lint-failures — lint exhausted after 3 retries on branch daemon-1-some-task",
    ].join("\n");
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(false);
  });

  it("returns true for other Blocked reasons (only pre-pr-lint-failures opts out)", () => {
    const taskBlock = [
      "- [ ] `some-task` — waiting for approval",
      "  - **ID**: some-task",
      "  - **Blocked**: needs-user-approval — requires operator sign-off before shipping",
    ].join("\n");
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(true);
  });

  it("returns true for empty task block (genesis case)", () => {
    expect(shouldRunPrePrLintGate({ taskBlock: "" })).toBe(true);
  });

  it("Blocked: pre-pr-lint-failures is case-sensitive (no false positives on different casing)", () => {
    const taskBlock = "  - **Blocked**: PRE-PR-LINT-FAILURES — wrong casing";
    // Must NOT opt out on wrong casing — the gate token is exact.
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(true);
  });
});

describe("createPnpmPrePrLintRun (slice 32/N — bodyPath option)", () => {
  // Slice 30/N (PR #329) added `--body=<path>` to the canonical
  // `scripts/run-pre-pr-lint-stack.mjs` so the two body-only CI checks
  // (`pr-self-grade`, `pr-security-review` — both env-dependent on PR-body
  // context in CI) ride the same retry budget as the branch-code lints.
  // The brief already instructs the inner Claude to invoke the flag via the
  // shell. Slice 32/N exposes the same flag on the typed binding so the
  // daemon's programmatic gate (`tick-loop.mjs § preLintRun`) can validate
  // a draft PR-body file without the shell round-trip — the wire-in is one
  // line per call-site once consumers want it. These tests pin that the
  // binding propagates `--body=<path>` through to the spawned argv.
  /**
   * Build a fake `spawn` that records the args it was called with and
   * synthesises a successful JSON result on stdout.
   */
  function fakeSpawn(stdoutJson: string): {
    spawn: ReturnType<typeof vi.fn>;
    captured: { args: readonly string[] }[];
  } {
    const captured: { args: readonly string[] }[] = [];
    const spawn = vi.fn((_cmd: string, args: readonly string[]) => {
      captured.push({ args });
      const child = new EventEmitter() as EventEmitter & {
        stdout: Readable;
        stderr: Readable;
      };
      const stdout = Readable.from([Buffer.from(stdoutJson, "utf8")]);
      const stderr = Readable.from([Buffer.from("", "utf8")]);
      child.stdout = stdout;
      child.stderr = stderr;
      // Defer `close` until after stdout has drained so the production
      // code sees the JSON before it tries to parse — matching real
      // child-process semantics where `close` follows the streams' `end`.
      stdout.on("end", () => {
        queueMicrotask(() => child.emit("close", 0));
      });
      return child;
    });
    return { spawn, captured };
  }

  const passJson = JSON.stringify({ summary: true, stage: "fast", allPass: true, stepCount: 0 });

  it("does NOT pass --body when bodyPath is unset (default behaviour preserved)", async () => {
    const { spawn, captured } = fakeSpawn(passJson);
    // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn — the test seam types it identically.
    const run = createPnpmPrePrLintRun({ spawnFn: spawn as any });
    await run();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.args.some((a) => a.startsWith("--body="))).toBe(false);
  });

  it("passes --body=<path> when bodyPath is set (slice 30 flag wired through)", async () => {
    const { spawn, captured } = fakeSpawn(passJson);
    const run = createPnpmPrePrLintRun({
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn — the test seam types it identically.
      spawnFn: spawn as any,
      bodyPath: "pr-body.md",
    });
    await run();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.args).toContain("--body=pr-body.md");
  });

  it("preserves --json + --stage=<stage> alongside --body (flags compose, no rewrites)", async () => {
    const { spawn, captured } = fakeSpawn(passJson);
    const run = createPnpmPrePrLintRun({
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn — the test seam types it identically.
      spawnFn: spawn as any,
      stage: "full",
      bodyPath: "/tmp/draft-body.md",
    });
    await run();
    const args = captured[0]?.args ?? [];
    expect(args).toContain("--json");
    expect(args).toContain("--stage=full");
    expect(args).toContain("--body=/tmp/draft-body.md");
  });
});

describe("createBodyAwarePrePrLintRun (slice 33/N — outer gate auto-discovers pr-body.md)", () => {
  // Slice 32/N (PR #333) added `bodyPath` to `createPnpmPrePrLintRun` but the
  // daemon's outer gate (`tick-loop.mjs § preLintRun`) bound the run once at
  // boot with no bodyPath, so the outer gate was blind to any draft body file
  // the inner Claude wrote during the iteration. This factory resolves the
  // mismatch — each invocation stats `<cwd>/pr-body.md` and forwards
  // `--body=<path>` when present, on the same retry budget as the branch-code
  // lints. The brief's "body-only checks" line documents the contract; this
  // factory implements it on the daemon side instead of trusting inner Claude
  // to invoke the shell flag itself.
  function fakeSpawn(stdoutJson: string): {
    spawn: ReturnType<typeof vi.fn>;
    captured: { args: readonly string[] }[];
  } {
    const captured: { args: readonly string[] }[] = [];
    const spawn = vi.fn((_cmd: string, args: readonly string[]) => {
      captured.push({ args });
      const child = new EventEmitter() as EventEmitter & {
        stdout: Readable;
        stderr: Readable;
      };
      const stdout = Readable.from([Buffer.from(stdoutJson, "utf8")]);
      const stderr = Readable.from([Buffer.from("", "utf8")]);
      child.stdout = stdout;
      child.stderr = stderr;
      stdout.on("end", () => {
        queueMicrotask(() => child.emit("close", 0));
      });
      return child;
    });
    return { spawn, captured };
  }

  const passJson = JSON.stringify({ summary: true, stage: "fast", allPass: true, stepCount: 0 });

  it("does NOT pass --body when pr-body.md is absent (no false body-validation)", async () => {
    const { spawn, captured } = fakeSpawn(passJson);
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      fileExists: () => false,
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    await run();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.args.some((a) => a.startsWith("--body="))).toBe(false);
  });

  it("passes --body=<cwd>/pr-body.md when the file exists (closes the brief↔gate loop)", async () => {
    const { spawn, captured } = fakeSpawn(passJson);
    const seen: string[] = [];
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      fileExists: (p) => {
        seen.push(p);
        return p === "/repo/pr-body.md";
      },
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    await run();
    expect(seen).toEqual(["/repo/pr-body.md"]);
    expect(captured[0]?.args).toContain("--body=/repo/pr-body.md");
  });

  it("re-stats the body file on every call (not bound at factory time)", async () => {
    // Per-call detection is the whole point: the body file appears DURING the
    // iteration, after the factory was built at daemon boot. A bind-once impl
    // would miss it. This test pins per-call semantics by flipping the stub
    // between calls.
    const { spawn, captured } = fakeSpawn(passJson);
    let exists = false;
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      fileExists: () => exists,
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    await run();
    exists = true;
    await run();
    expect(captured).toHaveLength(2);
    expect(captured[0]?.args.some((a) => a.startsWith("--body="))).toBe(false);
    expect(captured[1]?.args).toContain("--body=/repo/pr-body.md");
  });

  it("honours custom bodyFilename (lets operators rename the convention)", async () => {
    const { spawn, captured } = fakeSpawn(passJson);
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      bodyFilename: "draft-pr.md",
      fileExists: (p) => p === "/repo/draft-pr.md",
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    await run();
    expect(captured[0]?.args).toContain("--body=/repo/draft-pr.md");
  });

  it("forwards --stage=full when set (composes with --body)", async () => {
    const { spawn, captured } = fakeSpawn(passJson);
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      stage: "full",
      fileExists: () => true,
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    await run();
    const args = captured[0]?.args ?? [];
    expect(args).toContain("--stage=full");
    expect(args).toContain("--body=/repo/pr-body.md");
  });

  // ---- slice 34/N — bodyDiscovered surfaces silent body-only check skips ----
  // PR #337 was BLOCKED in CI on `pr-security-review` even after the body-aware
  // wire-in (slice 33/N) shipped — the inner Claude opened the PR without
  // writing `pr-body.md` to disk, so the outer gate's body-only checks
  // silently skipped. This metric makes that asymmetry visible per-iteration.
  it("sets bodyDiscovered=true on the result when pr-body.md is present", async () => {
    const { spawn } = fakeSpawn(passJson);
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      fileExists: () => true,
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    const result = await run();
    expect(result.verdict).toBe("pass");
    expect(result.bodyDiscovered).toBe(true);
  });

  it("sets bodyDiscovered=false on the result when pr-body.md is absent", async () => {
    const { spawn } = fakeSpawn(passJson);
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      fileExists: () => false,
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    const result = await run();
    expect(result.verdict).toBe("pass");
    expect(result.bodyDiscovered).toBe(false);
  });

  it("preserves bodyDiscovered through a fail result (carries the silent-skip flag with the failure)", async () => {
    const failJson = `${JSON.stringify({
      name: "biome",
      verdict: "fail",
      stderrTail: "lint err",
    })}\n${JSON.stringify({
      summary: true,
      stage: "fast",
      allPass: false,
      stepCount: 1,
    })}`;
    const { spawn } = fakeSpawn(failJson);
    const run = createBodyAwarePrePrLintRun({
      cwd: "/repo",
      fileExists: () => false,
      // biome-ignore lint/suspicious/noExplicitAny: spawnFn shape mirrors node:child_process.spawn.
      spawnFn: spawn as any,
    });
    const result = await run();
    expect(result.verdict).toBe("fail");
    expect(result.failedStep).toBe("biome");
    expect(result.bodyDiscovered).toBe(false);
  });
});

describe("runPrePrLintGate forwards bodyDiscovered (slice 34/N)", () => {
  it("propagates bodyDiscovered=true through the pass path", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "pass",
      bodyDiscovered: true,
    });
    const result = await runPrePrLintGate({ runLint });
    expect(result).toEqual({ verdict: "pass", attempts: 1, bodyDiscovered: true });
  });

  it("propagates bodyDiscovered=false through the fail path (last attempt's status wins)", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "fail",
      failedStep: "pr-security-review",
      stderrTail: "missing security marker",
      bodyDiscovered: false,
    });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 1 });
    expect(result).toEqual({
      verdict: "fail",
      attempts: 1,
      failedStep: "pr-security-review",
      stderrTail: "missing security marker",
      bodyDiscovered: false,
    });
  });

  it("omits bodyDiscovered when the run is body-blind by construction (legacy createPnpmPrePrLintRun)", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "pass",
    });
    const result = await runPrePrLintGate({ runLint });
    expect(result).toEqual({ verdict: "pass", attempts: 1 });
    expect("bodyDiscovered" in result).toBe(false);
  });
});
