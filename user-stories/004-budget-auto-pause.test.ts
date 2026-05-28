// Pin: 4-state shell replacement at bin/check-budget.sh must match user-story 004's 70%/85%/20% threshold prose. Anchor: Beyer 2016 § 3 (error budgets).

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");
const SHELL_PATH = join(REPO_ROOT, "bin/check-budget.sh");

function runShell(input: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`${SHELL_PATH}`, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    const err = e as { status: number; stdout: Buffer };
    return { stdout: String(err.stdout ?? "").trim(), exitCode: err.status };
  }
}

describe("user-story 004 — budget-auto-pause substrate (shell rewrite)", () => {
  test("bin/check-budget.sh exists and is executable", () => {
    expect(existsSync(SHELL_PATH)).toBe(true);
    const stat = statSync(SHELL_PATH);
    // rwxr-xr-x or rwxrwxr-x — owner-executable bit set.
    expect(stat.mode & 0o100).toBe(0o100);
  });

  test("bin/check-budget.sh --thresholds emits the canonical 70%/85%/20% values", () => {
    const out = execSync(`${SHELL_PATH} --thresholds`, { encoding: "utf8" });
    expect(out).toContain("degradeAt=0.7");
    expect(out).toContain("circuitBreakAt=0.85");
    expect(out).toContain("weeklyWarnAt=0.2");
  });

  test("shell prints NORMAL + exit 0 at under-70% consumption (user-story baseline)", () => {
    const result = runShell(
      JSON.stringify({ used: 100, limit: 1000, weekly_consumed_fraction: 0.1 }),
    );
    expect(result.stdout).toBe("NORMAL");
    expect(result.exitCode).toBe(0);
  });

  test("shell prints THROTTLE + exit 0 at 70%-85% (user-story 70% degrade threshold)", () => {
    const result = runShell(
      JSON.stringify({ used: 750, limit: 1000, weekly_consumed_fraction: 0.1 }),
    );
    expect(result.stdout).toBe("THROTTLE");
    expect(result.exitCode).toBe(0);
  });

  test("shell prints PAUSE + exit 1 at >=85% (user-story 85% circuit-break threshold)", () => {
    const result = runShell(
      JSON.stringify({ used: 900, limit: 1000, weekly_consumed_fraction: 0.1 }),
    );
    expect(result.stdout).toBe("PAUSE");
    expect(result.exitCode).toBe(1);
  });

  test("shell prints WEEKLY_WARN + exit 0 when weekly remaining <= 20%", () => {
    const result = runShell(
      JSON.stringify({ used: 100, limit: 1000, weekly_consumed_fraction: 0.9 }),
    );
    expect(result.stdout).toBe("WEEKLY_WARN");
    expect(result.exitCode).toBe(0);
  });

  test("shell handles empty/missing snapshot gracefully (returns NORMAL)", () => {
    const result = runShell(JSON.stringify({ used: 0, limit: 0 }));
    expect(result.stdout).toBe("NORMAL");
    expect(result.exitCode).toBe(0);
  });

  test("shell file mentions the 4-state vocabulary (NORMAL / THROTTLE / PAUSE / WEEKLY_WARN)", () => {
    const source = readFileSync(SHELL_PATH, "utf8");
    expect(source).toContain("NORMAL");
    expect(source).toContain("THROTTLE");
    expect(source).toContain("PAUSE");
    expect(source).toContain("WEEKLY_WARN");
  });

  test("@minsky/token-monitor adapter exists (TokenMonitor port named by user story)", () => {
    expect(existsSync(join(REPO_ROOT, "novel/adapters/token-monitor/src/index.ts"))).toBe(true);
  });

  test("scripts/scan-secrets.mjs exists (Security & privacy floor named by user story)", () => {
    expect(existsSync(join(REPO_ROOT, "scripts/scan-secrets.mjs"))).toBe(true);
  });

  test("user-story 004 has the required `## Metric` and `## Integration test` sections", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/004-budget-auto-pause.md"), "utf8");
    expect(story).toMatch(/^## Metric\b/m);
    expect(story).toMatch(/^## Integration test\b/m);
  });
});
