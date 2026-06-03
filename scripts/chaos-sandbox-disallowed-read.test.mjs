// Tests for chaos-sandbox-disallowed-read.mjs. Pattern: paired
// steady-state assertions (Basiri et al. 2016) over the pure decision core
// + skip-resolution logic, driven via injected probe results so no
// `sandbox-exec` process is spawned (deterministic on every platform).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  ALLOWED_REL_PATH,
  assessSandboxProbes,
  DISALLOWED_PATH,
  resolveHome,
  resolveSkipReason,
} from "./chaos-sandbox-disallowed-read.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PROFILE_PATH = resolve(REPO_ROOT, "distribution", "launchd", "com.minsky.tick-loop.sb");

describe("assessSandboxProbes (pure)", () => {
  test("disallowed denied (nonzero) + allowed permitted (0) → ok, not skipped", () => {
    const result = assessSandboxProbes({
      disallowed: { exitCode: 1 },
      allowed: { exitCode: 0 },
    });
    expect(result).toMatchObject({
      disallowed_read_denied: true,
      allowed_read_permitted: true,
      skipped: false,
      ok: true,
    });
  });

  test("disallowed read PERMITTED (exit 0) → not ok (the dangerous regression)", () => {
    const result = assessSandboxProbes({
      disallowed: { exitCode: 0 },
      allowed: { exitCode: 0 },
    });
    expect(result.disallowed_read_denied).toBe(false);
    expect(result.ok).toBe(false);
  });

  test("allowed read DENIED (false-positive EPERM) → not ok", () => {
    const result = assessSandboxProbes({
      disallowed: { exitCode: 1 },
      allowed: { exitCode: 1 },
    });
    expect(result.allowed_read_permitted).toBe(false);
    expect(result.ok).toBe(false);
  });

  test("disallowed probe failed to spawn (null exit) → not a valid denial → not ok", () => {
    const result = assessSandboxProbes({
      disallowed: { exitCode: null },
      allowed: { exitCode: 0 },
    });
    expect(result.disallowed_read_denied).toBe(false);
    expect(result.ok).toBe(false);
  });

  test("skip set → graceful-degrade ok:true, skipped:true, reason surfaced", () => {
    const result = assessSandboxProbes({
      disallowed: { exitCode: null },
      allowed: { exitCode: null },
      skip: "not macOS (platform=linux); sandbox-exec is macOS-only",
    });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.skip_reason).toContain("not macOS");
  });
});

describe("resolveSkipReason (pure over injected predicates)", () => {
  test("non-darwin platform → skip names the platform", () => {
    const reason = resolveSkipReason({ platform: "linux" });
    expect(reason).toBeDefined();
    expect(reason).toContain("linux");
  });

  test("darwin but sandbox-exec absent → skip", () => {
    const reason = resolveSkipReason({ platform: "darwin", sandboxExecExists: false });
    expect(reason).toContain("sandbox-exec");
  });

  test("darwin but profile missing → skip names the profile path", () => {
    const reason = resolveSkipReason({
      platform: "darwin",
      sandboxExecExists: true,
      profileExists: false,
    });
    expect(reason).toContain("SBPL profile missing");
  });

  test("darwin but ~/.ssh/known_hosts absent → skip (no disallowed target)", () => {
    const reason = resolveSkipReason({
      platform: "darwin",
      sandboxExecExists: true,
      profileExists: true,
      disallowedTargetExists: false,
    });
    expect(reason).toContain(DISALLOWED_PATH);
  });

  test("all preconditions met → undefined (run the probe)", () => {
    const reason = resolveSkipReason({
      platform: "darwin",
      sandboxExecExists: true,
      profileExists: true,
      disallowedTargetExists: true,
    });
    expect(reason).toBeUndefined();
  });
});

describe("resolveHome", () => {
  test("expands a leading ~/", () => {
    const expanded = resolveHome("~/foo");
    expect(expanded).not.toContain("~");
    expect(expanded.endsWith("/foo")).toBe(true);
  });

  test("leaves an absolute path unchanged", () => {
    expect(resolveHome("/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("the chaos target constants", () => {
  test("disallowed path is ~/.ssh/known_hosts; allowed control is a repo file", () => {
    expect(DISALLOWED_PATH).toBe("~/.ssh/known_hosts");
    expect(ALLOWED_REL_PATH).toBe("README.md");
  });
});

describe("the shipped profile artifact", () => {
  test("exists and opens with `(deny default)`", () => {
    expect(existsSync(PROFILE_PATH)).toBe(true);
    expect(readFileSync(PROFILE_PATH, "utf8")).toContain("(deny default)");
  });
});
