/**
 * Paired tests for `bootstrap-local-llm-args.ts` — slice 9 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`. Pure parser; tests cover the
 * `--dry-run` flag detection and that unknown flags are ignored
 * (forward-compat for future flags).
 */

import { describe, expect, it } from "vitest";
import { parseBootstrapLocalLlmArgs } from "./bootstrap-local-llm-args.js";

describe("parseBootstrapLocalLlmArgs", () => {
  it("returns dryRun: false when args is empty", () => {
    expect(parseBootstrapLocalLlmArgs([])).toEqual({ dryRun: false });
  });

  it("returns dryRun: true when --dry-run is the only arg", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run"])).toEqual({ dryRun: true });
  });

  it("returns dryRun: true when --dry-run is the first of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--foo", "--bar=baz"])).toEqual({
      dryRun: true,
    });
  });

  it("returns dryRun: true when --dry-run is the last of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz", "--dry-run"])).toEqual({
      dryRun: true,
    });
  });

  it("returns dryRun: false when only unrelated flags are passed", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz"])).toEqual({ dryRun: false });
  });

  it("does not match prefix variants like --dry-runs or --dry", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry"])).toEqual({ dryRun: false });
    expect(parseBootstrapLocalLlmArgs(["--dry-runs"])).toEqual({ dryRun: false });
    expect(parseBootstrapLocalLlmArgs(["dry-run"])).toEqual({ dryRun: false });
  });

  it("is pure — same input twice produces equal output", () => {
    const args = ["--dry-run", "--other"];
    expect(parseBootstrapLocalLlmArgs(args)).toEqual(parseBootstrapLocalLlmArgs(args));
  });
});
