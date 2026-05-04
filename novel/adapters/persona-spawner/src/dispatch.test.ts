import { describe, expect, it } from "vitest";

import { DEFAULT_PERSONA, PERSONA_DISPATCH_TABLE, dispatchPersona } from "./dispatch.js";

describe("dispatchPersona", () => {
  it("maps `bug` → `engineer`", () => {
    expect(dispatchPersona(["bug"])).toBe("engineer");
  });

  it("maps `research` → `researcher`", () => {
    expect(dispatchPersona(["research"])).toBe("researcher");
  });

  it("maps `review` → `reviewer`", () => {
    expect(dispatchPersona(["review"])).toBe("reviewer");
  });

  it("maps `feature` → `engineer`", () => {
    expect(dispatchPersona(["feature"])).toBe("engineer");
  });

  it("falls back to `engineer` (default) for unknown tags", () => {
    expect(dispatchPersona(["frobnicate"])).toBe("engineer");
    expect(DEFAULT_PERSONA).toBe("engineer");
  });

  it("returns DEFAULT_PERSONA for an empty tag list", () => {
    expect(dispatchPersona([])).toBe(DEFAULT_PERSONA);
  });

  it("walks tags left-to-right, returning the first match", () => {
    // `unknown` does not match; `research` does.
    expect(dispatchPersona(["unknown", "research"])).toBe("researcher");
    // `bug` matches first → engineer wins over the later `research`.
    expect(dispatchPersona(["bug", "research"])).toBe("engineer");
  });

  it("accepts an injected dispatch table for tests / future Strategies", () => {
    const custom = Object.freeze({ alpha: "auditor", beta: "scribe" });
    expect(dispatchPersona(["alpha"], custom)).toBe("auditor");
    expect(dispatchPersona(["beta"], custom)).toBe("scribe");
    expect(dispatchPersona(["gamma"], custom)).toBe(DEFAULT_PERSONA);
  });

  it("PERSONA_DISPATCH_TABLE has at least three tag→persona mappings", () => {
    expect(Object.keys(PERSONA_DISPATCH_TABLE).length).toBeGreaterThanOrEqual(3);
  });
});
