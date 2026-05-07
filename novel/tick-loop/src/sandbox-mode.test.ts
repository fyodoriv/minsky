import { describe, expect, it } from "vitest";

import {
  SANDBOX_MODE_DEFAULT,
  SANDBOX_MODE_ENV,
  resolveSandboxMode,
  sandboxModeWarning,
} from "./sandbox-mode.js";

describe("SANDBOX_MODE_DEFAULT", () => {
  it("defaults to 'off' (substrate-inert until a later slice ramps to warn-only / enforce)", () => {
    expect(SANDBOX_MODE_DEFAULT).toBe("off");
  });
});

describe("SANDBOX_MODE_ENV", () => {
  it("is the documented MINSKY_SANDBOX env var name", () => {
    expect(SANDBOX_MODE_ENV).toBe("MINSKY_SANDBOX");
  });
});

describe("resolveSandboxMode", () => {
  it("returns 'off' when the env var is unset", () => {
    expect(resolveSandboxMode({})).toBe("off");
  });

  it("returns 'off' when the env var is empty", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "" })).toBe("off");
  });

  it("returns 'off' when the env var is whitespace-only", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "   " })).toBe("off");
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "\t\n" })).toBe("off");
  });

  it("accepts 'off' verbatim", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "off" })).toBe("off");
  });

  it("accepts 'warn-only' verbatim", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "warn-only" })).toBe("warn-only");
  });

  it("accepts 'enforce' verbatim", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "enforce" })).toBe("enforce");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "  warn-only  " })).toBe("warn-only");
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "\tenforce\n" })).toBe("enforce");
  });

  it("lowercases the value before matching (operator typo tolerance)", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "OFF" })).toBe("off");
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "Warn-Only" })).toBe("warn-only");
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "ENFORCE" })).toBe("enforce");
  });

  it("falls back to 'off' on an unrecognised value (fail-safe-defaults)", () => {
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "strict" })).toBe("off");
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "warn" })).toBe("off");
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "1" })).toBe("off");
    expect(resolveSandboxMode({ [SANDBOX_MODE_ENV]: "true" })).toBe("off");
  });
});

describe("sandboxModeWarning", () => {
  it("returns null when the env var is unset", () => {
    expect(sandboxModeWarning({})).toBeNull();
  });

  it("returns null when the env var is empty / whitespace-only", () => {
    expect(sandboxModeWarning({ [SANDBOX_MODE_ENV]: "" })).toBeNull();
    expect(sandboxModeWarning({ [SANDBOX_MODE_ENV]: "   " })).toBeNull();
  });

  it("returns null for each valid mode", () => {
    expect(sandboxModeWarning({ [SANDBOX_MODE_ENV]: "off" })).toBeNull();
    expect(sandboxModeWarning({ [SANDBOX_MODE_ENV]: "warn-only" })).toBeNull();
    expect(sandboxModeWarning({ [SANDBOX_MODE_ENV]: "enforce" })).toBeNull();
  });

  it("returns null for valid mode after trim/lowercase normalisation", () => {
    expect(sandboxModeWarning({ [SANDBOX_MODE_ENV]: "  ENFORCE  " })).toBeNull();
  });

  it("returns a visible warning when the env carries an unrecognised value", () => {
    const warning = sandboxModeWarning({ [SANDBOX_MODE_ENV]: "strict" });
    expect(warning).not.toBeNull();
    expect(warning).toContain("MINSKY_SANDBOX");
    expect(warning).toContain('"strict"');
    expect(warning).toContain("'off'");
    expect(warning).toContain("rule #13.3");
  });

  it("preserves the operator's raw value in the warning (so the typo is visible)", () => {
    const warning = sandboxModeWarning({ [SANDBOX_MODE_ENV]: "WARN_ONLY" });
    expect(warning).toContain('"WARN_ONLY"');
  });

  it("enumerates all valid modes in the warning so the operator sees the choice set", () => {
    const warning = sandboxModeWarning({ [SANDBOX_MODE_ENV]: "garbage" }) ?? "";
    expect(warning).toContain("'off'");
    expect(warning).toContain("'warn-only'");
    expect(warning).toContain("'enforce'");
  });
});
