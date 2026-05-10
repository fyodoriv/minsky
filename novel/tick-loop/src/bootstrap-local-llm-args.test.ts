/**
 * Paired tests for `bootstrap-local-llm-args.ts` — slices 9 + 22 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`. Pure parser; tests cover the
 * `--dry-run` and `--check` flag detection and that unknown flags are ignored
 * (forward-compat for future flags).
 */

import { describe, expect, it } from "vitest";
import { parseBootstrapLocalLlmArgs } from "./bootstrap-local-llm-args.js";

describe("parseBootstrapLocalLlmArgs", () => {
  it("returns dryRun: false, check: false when args is empty", () => {
    expect(parseBootstrapLocalLlmArgs([])).toEqual({ dryRun: false, check: false });
  });

  it("returns dryRun: true when --dry-run is the only arg", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run"])).toEqual({ dryRun: true, check: false });
  });

  it("returns dryRun: true when --dry-run is the first of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--foo", "--bar=baz"])).toEqual({
      dryRun: true,
      check: false,
    });
  });

  it("returns dryRun: true when --dry-run is the last of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz", "--dry-run"])).toEqual({
      dryRun: true,
      check: false,
    });
  });

  it("returns dryRun: false when only unrelated flags are passed", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz"])).toEqual({
      dryRun: false,
      check: false,
    });
  });

  it("does not match prefix variants like --dry-runs or --dry", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry"])).toEqual({ dryRun: false, check: false });
    expect(parseBootstrapLocalLlmArgs(["--dry-runs"])).toEqual({ dryRun: false, check: false });
    expect(parseBootstrapLocalLlmArgs(["dry-run"])).toEqual({ dryRun: false, check: false });
  });

  it("returns check: true when --check is the only arg", () => {
    expect(parseBootstrapLocalLlmArgs(["--check"])).toEqual({ dryRun: false, check: true });
  });

  it("returns check: true when --check is mixed with other args", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--check", "--bar=baz"])).toEqual({
      dryRun: false,
      check: true,
    });
  });

  it("returns dryRun: true, check: true when both flags are present", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--check"])).toEqual({
      dryRun: true,
      check: true,
    });
  });

  it("does not match prefix variants like --checks or --che", () => {
    expect(parseBootstrapLocalLlmArgs(["--che"])).toEqual({ dryRun: false, check: false });
    expect(parseBootstrapLocalLlmArgs(["--checks"])).toEqual({ dryRun: false, check: false });
    expect(parseBootstrapLocalLlmArgs(["check"])).toEqual({ dryRun: false, check: false });
  });

  it("is pure — same input twice produces equal output", () => {
    const args = ["--dry-run", "--check", "--other"];
    expect(parseBootstrapLocalLlmArgs(args)).toEqual(parseBootstrapLocalLlmArgs(args));
  });
});
