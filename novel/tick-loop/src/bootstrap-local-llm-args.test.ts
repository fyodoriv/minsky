/**
 * Paired tests for `bootstrap-local-llm-args.ts` — slice 9 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`. Pure parser; tests cover the
 * `--dry-run` flag detection and that unknown flags are ignored
 * (forward-compat for future flags).
 */

import { describe, expect, it } from "vitest";
import { parseBootstrapLocalLlmArgs } from "./bootstrap-local-llm-args.js";

describe("parseBootstrapLocalLlmArgs", () => {
  it("returns both flags false when args is empty", () => {
    expect(parseBootstrapLocalLlmArgs([])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("returns dryRun: true when --dry-run is the only arg", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run"])).toEqual({
      dryRun: true,
      noConfirm: false,
    });
  });

  it("returns dryRun: true when --dry-run is the first of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--foo", "--bar=baz"])).toEqual({
      dryRun: true,
      noConfirm: false,
    });
  });

  it("returns dryRun: true when --dry-run is the last of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz", "--dry-run"])).toEqual({
      dryRun: true,
      noConfirm: false,
    });
  });

  it("returns both flags false when only unrelated flags are passed", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz"])).toEqual({
      dryRun: false,
      noConfirm: false,
    });
  });

  it("does not match prefix variants like --dry-runs or --dry", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry"])).toEqual({ dryRun: false, noConfirm: false });
    expect(parseBootstrapLocalLlmArgs(["--dry-runs"])).toEqual({
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["dry-run"])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("returns noConfirm: true on --no-confirm", () => {
    expect(parseBootstrapLocalLlmArgs(["--no-confirm"])).toEqual({
      dryRun: false,
      noConfirm: true,
    });
  });

  it("returns noConfirm: true on --yes alias", () => {
    expect(parseBootstrapLocalLlmArgs(["--yes"])).toEqual({ dryRun: false, noConfirm: true });
  });

  it("returns noConfirm: true on -y short alias", () => {
    expect(parseBootstrapLocalLlmArgs(["-y"])).toEqual({ dryRun: false, noConfirm: true });
  });

  it("does not match prefix variants like --no-conf or --yess", () => {
    expect(parseBootstrapLocalLlmArgs(["--no-conf"])).toEqual({
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--yess"])).toEqual({ dryRun: false, noConfirm: false });
    expect(parseBootstrapLocalLlmArgs(["yes"])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("composes both flags when --dry-run --no-confirm are passed together", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--no-confirm"])).toEqual({
      dryRun: true,
      noConfirm: true,
    });
  });

  it("is pure — same input twice produces equal output", () => {
    const args = ["--dry-run", "--no-confirm", "--other"];
    expect(parseBootstrapLocalLlmArgs(args)).toEqual(parseBootstrapLocalLlmArgs(args));
  });
});
