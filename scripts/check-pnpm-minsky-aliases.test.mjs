// @ts-check
import { describe, expect, it } from "vitest";
import { DELEGATE_REGEX, checkPnpmMinskyAliases } from "./check-pnpm-minsky-aliases.mjs";

describe("DELEGATE_REGEX", () => {
  it.each([
    "bin/minsky setup",
    "bin/minsky doctor",
    "bin/minsky status",
    "bin/minsky stop",
    "bin/minsky ui",
    "bin/minsky logs",
    "bin/minsky run --once",
    "bin/minsky run --once --host /tmp/repo",
    "bin/minsky transform --quiet",
    "bin/minsky logs --source=daemon",
  ])("accepts delegate shape: %s", (val) => {
    expect(DELEGATE_REGEX.test(val)).toBe(true);
  });

  it.each([
    "./setup.sh --setup",
    "./setup.sh --doctor",
    "PORT=${PORT:-8181} bash distribution/run-dashboard-web.sh",
    "launchctl list 2>/dev/null | grep -i minsky",
    "systemctl --user status minsky-supervisor.target",
    "launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.minsky.daemon.plist",
    "bin/minsky a && bin/minsky b",
    "bin/minsky a; echo done",
    "bash bin/minsky setup",
    "node scripts/foo.mjs",
    "echo bin/minsky setup",
  ])("rejects non-delegate shape: %s", (val) => {
    expect(DELEGATE_REGEX.test(val)).toBe(false);
  });

  it("rejects unknown variable substitution", () => {
    expect(DELEGATE_REGEX.test("bin/minsky setup $EXTRA")).toBe(false);
  });

  it("rejects piped output", () => {
    expect(DELEGATE_REGEX.test("bin/minsky logs | grep error")).toBe(false);
  });
});

describe("checkPnpmMinskyAliases", () => {
  it("passes when all minsky:* scripts delegate", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        "minsky:setup": "bin/minsky setup",
        "minsky:doctor": "bin/minsky doctor",
        "minsky:status": "bin/minsky status",
        "minsky:stop": "bin/minsky stop",
        "minsky:ui": "bin/minsky ui",
        "minsky:logs": "bin/minsky logs",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.scannedCount).toBe(6);
  });

  it("flags a single non-delegate script", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        "minsky:setup": "bin/minsky setup",
        "minsky:doctor": "./setup.sh --doctor",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/minsky:doctor/);
    expect(result.violations[0]).toMatch(/setup\.sh/);
  });

  it("flags multiple non-delegates with distinct messages", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        "minsky:setup": "./setup.sh --setup",
        "minsky:doctor": "./setup.sh --doctor",
        "minsky:status": "launchctl list",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(3);
  });

  it("ignores non-minsky:* scripts", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        build: "tsc -b",
        "minsky:setup": "bin/minsky setup",
        test: "vitest run",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.scannedCount).toBe(1);
  });

  it("returns ok when there are zero minsky:* scripts", () => {
    const result = checkPnpmMinskyAliases({
      scripts: { build: "tsc -b" },
    });
    expect(result.ok).toBe(true);
    expect(result.scannedCount).toBe(0);
  });

  it("rejects env-prefixed delegate (PORT=… bash …)", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        "minsky:ui": "PORT=8181 bash distribution/run-dashboard-web.sh",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/distribution\/run-/);
  });

  it("rejects bash-invoked delegate (`bash bin/minsky setup`)", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        "minsky:setup": "bash bin/minsky setup",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts delegate with multiple flags", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        "minsky:run": "bin/minsky run --once --host /tmp/repo --quiet",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkPnpmMinskyAliases();
    expect(result.ok).toBe(true);
    expect(result.scannedCount).toBeGreaterThanOrEqual(5);
  });

  it("emits a helpful fix hint in the violation message", () => {
    const result = checkPnpmMinskyAliases({
      scripts: {
        "minsky:doctor": "./setup.sh --doctor",
      },
    });
    expect(result.violations[0]).toMatch(/bin\/minsky doctor/);
    expect(result.violations[0]).toMatch(/cli-consolidate-pnpm-minsky-scripts/);
  });

  it("handles scripts with undefined values defensively", () => {
    /** @type {Record<string, string>} */
    const scripts = { "minsky:setup": "bin/minsky setup" };
    // Simulate a malformed package.json where a key has no value.
    Object.defineProperty(scripts, "minsky:broken", {
      enumerable: true,
      value: undefined,
    });
    const result = checkPnpmMinskyAliases({ scripts });
    expect(result.ok).toBe(true);
  });

  it("loads from default path when no opts.scripts given", () => {
    const result = checkPnpmMinskyAliases();
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("scannedCount");
  });

  it("loads from explicit packageJsonPath", () => {
    const result = checkPnpmMinskyAliases({
      packageJsonPath: `${process.cwd()}/package.json`,
    });
    expect(result.ok).toBe(true);
  });
});
