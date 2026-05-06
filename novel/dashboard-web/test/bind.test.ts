import { describe, expect, it } from "vitest";

import {
  BIND_DEFAULT,
  BIND_OVERRIDE_ENV,
  bindHostnameWarning,
  resolveBindHostname,
} from "../src/bind.js";

describe("resolveBindHostname — vision rule #13.4", () => {
  it("returns 127.0.0.1 by default (no override env)", () => {
    expect(resolveBindHostname({})).toBe("127.0.0.1");
    expect(BIND_DEFAULT).toBe("127.0.0.1");
  });

  it("ignores empty-string override (treated as unset)", () => {
    expect(resolveBindHostname({ [BIND_OVERRIDE_ENV]: "" })).toBe(BIND_DEFAULT);
  });

  it("returns the override when MINSKY_DASHBOARD_BIND is set", () => {
    expect(resolveBindHostname({ [BIND_OVERRIDE_ENV]: "0.0.0.0" })).toBe("0.0.0.0");
    expect(resolveBindHostname({ [BIND_OVERRIDE_ENV]: "192.168.1.10" })).toBe("192.168.1.10");
  });

  it("does not consume any other env var (no aliasing with PORT, etc.)", () => {
    expect(resolveBindHostname({ PORT: "8080", HOST: "0.0.0.0" })).toBe(BIND_DEFAULT);
  });
});

describe("bindHostnameWarning — silent-trade-offs-forbidden surface", () => {
  it("returns null for the loopback default (no warning)", () => {
    expect(bindHostnameWarning("127.0.0.1")).toBeNull();
  });

  it("returns null for the literal 'localhost' alias (no warning)", () => {
    expect(bindHostnameWarning("localhost")).toBeNull();
  });

  it("returns a warning string for 0.0.0.0 (LAN exposure)", () => {
    const w = bindHostnameWarning("0.0.0.0");
    expect(w).not.toBeNull();
    expect(w).toMatch(/0\.0\.0\.0/);
    expect(w).toMatch(/SSH tunnel|reverse proxy/);
    expect(w).toMatch(/rule #13/);
  });

  it("returns a warning for any non-loopback address", () => {
    expect(bindHostnameWarning("192.168.1.10")).not.toBeNull();
    expect(bindHostnameWarning("10.0.0.5")).not.toBeNull();
    expect(bindHostnameWarning("::")).not.toBeNull();
  });
});
