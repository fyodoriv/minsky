// Tests for orchestrate.mjs. The conductor's deterministic decision
// (rule #10 — no I/O in the decision) is `decideHeal`; the I/O wiring
// (pgrep / launchctl / runGateSweep) is validated by the `--once` run.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import { decideHeal } from "./orchestrate.mjs";

describe("decideHeal (conductor self-heal decision)", () => {
  it("worker alive ⇒ ok (no heal)", () => {
    expect(decideHeal(true)).toBe("ok");
  });
  it("worker down ⇒ heal", () => {
    expect(decideHeal(false)).toBe("heal");
  });
  it("is pure / deterministic — same input, same output", () => {
    expect(decideHeal(true)).toBe(decideHeal(true));
    expect(decideHeal(false)).toBe(decideHeal(false));
  });
});
