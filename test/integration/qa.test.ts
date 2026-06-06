// Integration tests for `bin/minsky qa` — slice 3 of the shipped
// human-loop module (see novel/human-loop/README.md).
//
// Hypothesis (rule #9): the `qa` subcommand provides the operator
// surface for the agent↔human QA channel slices 1+2 established. A
// human running `minsky qa` first time finds an explanatory header in
// the file; subsequent runs preserve their accumulated answers; the
// path can be overridden via MINSKY_QA_LOG_PATH for fixture isolation.
//
// Success: every test below passes against the real bin/minsky binary
// driving a temporary MINSKY_QA_LOG_PATH; the file always exists after
// any subcommand invocation; --init-only / --print-path exit cleanly
// without launching $EDITOR.
//
// Pivot: if creating the file with a hand-rolled bash heredoc proves
// brittle across shells, move the template into a generated file in
// novel/human-loop/templates/ and have the bash shim copy it.
//
// Measurement: this test file (10 cases).
//
// Anchor: rule #9 (pre-registered metrics); novel/human-loop/README.md
// for the agent↔human QA channel design; slices 1+2 establish the
// qa-log-format and askHuman API this subcommand wraps.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const MINSKY_BIN = resolve(HERE, "../../bin/minsky");

function makeFixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "minsky-qa-test-"));
}

function runQa(
  args: readonly string[],
  opts: { qaLogPath: string; env?: Record<string, string> },
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    MINSKY_QA_LOG_PATH: opts.qaLogPath,
    ...opts.env,
  };
  const result = spawnSync(MINSKY_BIN, ["qa", ...args], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

describe("minsky qa", () => {
  let fixtureDir: string;
  let qaLogPath: string;

  beforeEach(() => {
    fixtureDir = makeFixtureDir();
    qaLogPath = join(fixtureDir, ".minsky", "qa-log.md");
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("--print-path emits the resolved path and exits 0", () => {
    const result = runQa(["--print-path"], { qaLogPath });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(qaLogPath);
  });

  test("--init-only creates the file with a header and exits 0", () => {
    expect(existsSync(qaLogPath)).toBe(false);

    const result = runQa(["--init-only"], { qaLogPath });

    expect(result.status).toBe(0);
    expect(existsSync(qaLogPath)).toBe(true);
    const content = readFileSync(qaLogPath, "utf8");
    expect(content).toContain("# Minsky QA log");
    expect(content).toContain("## Q:");
    expect(content).toContain("## A:");
  });

  test("--init-only on existing file preserves content (no overwrite)", () => {
    runQa(["--init-only"], { qaLogPath });
    const existingContent = readFileSync(qaLogPath, "utf8");
    const augmented = `${existingContent}\n## Q: my-task · 2026-05-23T00:00:00.000Z\n**from**: human\n**asks**: kept across runs\n`;
    writeFileSync(qaLogPath, augmented);

    const result = runQa(["--init-only"], { qaLogPath });

    expect(result.status).toBe(0);
    expect(readFileSync(qaLogPath, "utf8")).toBe(augmented);
  });

  test("creates parent directory if missing", () => {
    const nestedPath = join(fixtureDir, "nested", "deep", "qa-log.md");

    const result = runQa(["--print-path"], { qaLogPath: nestedPath });

    expect(result.status).toBe(0);
    // --print-path does NOT create the file (creation only happens before the
    // print-path check), but it DOES create the parent dir (`mkdir -p`).
    expect(existsSync(dirname(nestedPath))).toBe(true);
  });

  test("unknown flag → exit 2 with helpful error", () => {
    const result = runQa(["--nonsense"], { qaLogPath });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--nonsense");
    expect(result.stderr).toContain("--help");
  });

  test("--help exits 0 with a usage line", () => {
    const result = runQa(["--help"], { qaLogPath });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--init-only");
  });

  test("MINSKY_QA_LOG_PATH overrides the default cwd-based path", () => {
    const customPath = join(fixtureDir, "custom-qa.md");

    const result = runQa(["--print-path"], { qaLogPath: customPath });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(customPath);
  });

  test("the created file uses the qa-log-format conventions from slice 1", () => {
    runQa(["--init-only"], { qaLogPath });
    const content = readFileSync(qaLogPath, "utf8");

    // Both header types from novel/human-loop/src/qa-log-format.ts must be
    // mentioned so an operator who reads the file knows how it's parsed.
    expect(content).toMatch(/## Q:/);
    expect(content).toMatch(/## A:/);
    // Pointer to slice 1's parser README so the operator can find the spec.
    expect(content).toContain("novel/human-loop/README.md");
  });

  test("--init-only and --print-path may be passed together (print-path wins, file created)", () => {
    const result = runQa(["--init-only", "--print-path"], { qaLogPath });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(qaLogPath);
    expect(existsSync(qaLogPath)).toBe(true);
  });

  test("default editor invocation is suppressed by --init-only (no $EDITOR side effect)", () => {
    // If we passed no flags here, the subcommand would try to spawn $EDITOR
    // and then tail -F, which would block the test. --init-only is the
    // guard that lets us assert "init step ran" without engaging the
    // interactive layer. This test pins that invariant.
    const start = Date.now();

    const result = runQa(["--init-only"], { qaLogPath, env: { EDITOR: "false" } });

    const elapsed = Date.now() - start;
    expect(result.status).toBe(0);
    // If the editor were spawned, "false" exits 1 immediately; if tail -F
    // were exec'd it would block until the 10s timeout. Either way an
    // elapsed > 5s would surface a regression. Allow generous headroom.
    expect(elapsed).toBeLessThan(5_000);
  });
});
