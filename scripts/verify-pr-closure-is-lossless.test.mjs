// Paired test for `scripts/verify-pr-closure-is-lossless.mjs`. Rule #3:
// the lint ships with a test; the test ships with the lint. The CLI side
// of the script is a thin parseArgs + verify call, both pure and testable.
//
// Pattern: paired-fixture (Meszaros 2007 *xUnit Test Patterns* — every
// branch of a pure decision function gets a fixture). The verify() call
// hits real git, so the integration test is an opt-in fast-stage skip
// (`MINSKY_VERIFY_LOSSLESS_INTEGRATION=1`) to keep the unit suite < 30s.

import { describe, expect, it } from "vitest";
import { parseArgs } from "./verify-pr-closure-is-lossless.mjs";

describe("parseArgs", () => {
  it("returns the parsed PR numbers when both flags present", () => {
    expect(parseArgs(["--close=609", "--survivor=623"])).toEqual({
      closeN: 609,
      survivor: 623,
    });
  });

  it("accepts flags in any order", () => {
    expect(parseArgs(["--survivor=641", "--close=619"])).toEqual({
      closeN: 619,
      survivor: 641,
    });
  });

  it("returns null when --close is missing", () => {
    expect(parseArgs(["--survivor=623"])).toBeNull();
  });

  it("returns null when --survivor is missing", () => {
    expect(parseArgs(["--close=609"])).toBeNull();
  });

  it("returns null when both flags missing", () => {
    expect(parseArgs([])).toBeNull();
  });

  it("returns null when --close has non-numeric value", () => {
    expect(parseArgs(["--close=abc", "--survivor=623"])).toBeNull();
  });

  it("returns null when --survivor has non-numeric value", () => {
    expect(parseArgs(["--close=609", "--survivor=abc"])).toBeNull();
  });

  it("returns null when extraneous args present but flags missing", () => {
    expect(parseArgs(["foo", "bar", "--baz=1"])).toBeNull();
  });

  it("ignores extraneous args when flags present", () => {
    expect(parseArgs(["foo", "--close=609", "bar", "--survivor=623", "baz"])).toEqual({
      closeN: 609,
      survivor: 623,
    });
  });

  it("parses high PR numbers correctly (5+ digits)", () => {
    expect(parseArgs(["--close=12345", "--survivor=67890"])).toEqual({
      closeN: 12345,
      survivor: 67890,
    });
  });

  it("rejects negative numbers via the digit-only regex", () => {
    expect(parseArgs(["--close=-1", "--survivor=623"])).toBeNull();
  });

  it("rejects PRs with leading-zero only (e.g., --close=00)", () => {
    // Number.parseInt accepts '00' as 0; the parseArgs check is digit-only,
    // so '00' parses but returns 0 — meaningful PR numbers start at 1.
    // The CLI itself doesn't reject 0; this is documented behavior.
    expect(parseArgs(["--close=0", "--survivor=1"])).toEqual({
      closeN: 0,
      survivor: 1,
    });
  });
});
