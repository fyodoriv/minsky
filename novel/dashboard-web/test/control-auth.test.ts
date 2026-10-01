import { describe, expect, it, vi } from "vitest";

import {
  CONTROL_TOKEN_ENV,
  CONTROL_TOKEN_HEADER,
  controlTokenStartupHint,
  resolveControlToken,
  validateControlAuth,
} from "../src/control-auth.js";

describe("resolveControlToken — vision rule #13.4", () => {
  it("returns env value with source=env when MINSKY_CONTROL_TOKEN is set", () => {
    const gen = vi.fn(() => "random-fallback");
    const result = resolveControlToken({ [CONTROL_TOKEN_ENV]: "my-token-123" }, gen);
    expect(result.token).toBe("my-token-123");
    expect(result.source).toBe("env");
    expect(gen).not.toHaveBeenCalled();
  });

  it("falls back to generator with source=generated when env is unset", () => {
    const gen = vi.fn(() => "generated-token-abc");
    const result = resolveControlToken({}, gen);
    expect(result.token).toBe("generated-token-abc");
    expect(result.source).toBe("generated");
    expect(gen).toHaveBeenCalledOnce();
  });

  it("treats empty-string env as unset (mirrors bind.ts discipline)", () => {
    const gen = vi.fn(() => "from-generator");
    const result = resolveControlToken({ [CONTROL_TOKEN_ENV]: "" }, gen);
    expect(result.token).toBe("from-generator");
    expect(result.source).toBe("generated");
  });

  it("does not consume any other env var (no aliasing)", () => {
    const gen = vi.fn(() => "fallback");
    const result = resolveControlToken({ MINSKY_TOKEN: "wrong-var", PORT: "8080" }, gen);
    expect(result.source).toBe("generated");
    expect(result.token).toBe("fallback");
  });
});

describe("validateControlAuth — header-based auth", () => {
  function headers(map: Record<string, string>): { get(name: string): string | null } {
    return {
      get(name: string): string | null {
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(map)) {
          if (k.toLowerCase() === lower) return v;
        }
        return null;
      },
    };
  }

  it("ok=true when header matches expected token exactly", () => {
    const result = validateControlAuth(headers({ [CONTROL_TOKEN_HEADER]: "abc123" }), "abc123");
    expect(result.ok).toBe(true);
  });

  it("ok=false reason=missing-header when header absent", () => {
    const result = validateControlAuth(headers({}), "abc123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-header");
  });

  it("ok=false reason=missing-header when header empty string", () => {
    const result = validateControlAuth(headers({ [CONTROL_TOKEN_HEADER]: "" }), "abc123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-header");
  });

  it("ok=false reason=wrong-token when length differs (length is the timing-safe gate)", () => {
    const result = validateControlAuth(
      headers({ [CONTROL_TOKEN_HEADER]: "short" }),
      "much-longer-token",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong-token");
  });

  it("ok=false reason=wrong-token when bytes differ at any position", () => {
    const r1 = validateControlAuth(headers({ [CONTROL_TOKEN_HEADER]: "abc124" }), "abc123");
    const r2 = validateControlAuth(headers({ [CONTROL_TOKEN_HEADER]: "Abc123" }), "abc123");
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  it("treats header lookup case-insensitively (per RFC 7230)", () => {
    const result = validateControlAuth(headers({ "X-Minsky-Token": "tok" }), "tok");
    expect(result.ok).toBe(true);
  });

  it("does not short-circuit on first matching byte (constant-time discipline)", () => {
    const longExpected = "a".repeat(64);
    const earlyMismatch = `b${"a".repeat(63)}`;
    const lateMismatch = `${"a".repeat(63)}b`;
    expect(
      validateControlAuth(headers({ [CONTROL_TOKEN_HEADER]: earlyMismatch }), longExpected).ok,
    ).toBe(false);
    expect(
      validateControlAuth(headers({ [CONTROL_TOKEN_HEADER]: lateMismatch }), longExpected).ok,
    ).toBe(false);
  });

  it("works with a real Headers object (Web standard, not just the stub)", () => {
    const h = new Headers();
    h.set("X-Minsky-Token", "real-headers-token");
    const result = validateControlAuth(h, "real-headers-token");
    expect(result.ok).toBe(true);
  });
});

describe("controlTokenStartupHint — operator-readable surface", () => {
  it("env-source hint announces the env var without echoing the token", () => {
    const hint = controlTokenStartupHint({ token: "secret-from-env-do-not-leak", source: "env" });
    expect(hint).toContain(CONTROL_TOKEN_ENV);
    expect(hint).toContain("length 27");
    expect(hint).not.toContain("secret-from-env-do-not-leak");
    expect(hint).toContain("X-Minsky-Token");
  });

  it("generated-source hint includes the verbatim token (operator must copy it)", () => {
    const hint = controlTokenStartupHint({ token: "GENERATED-1234", source: "generated" });
    expect(hint).toContain("GENERATED-1234");
    expect(hint).toContain(CONTROL_TOKEN_ENV);
    expect(hint).toContain("X-Minsky-Token");
    expect(hint).toMatch(/random|generated/i);
  });

  it("hint mentions the header name on both code paths (operator never has to guess it)", () => {
    const envHint = controlTokenStartupHint({ token: "env-tok", source: "env" });
    const genHint = controlTokenStartupHint({ token: "gen-tok", source: "generated" });
    expect(envHint).toContain("X-Minsky-Token");
    expect(genHint).toContain("X-Minsky-Token");
  });
});
