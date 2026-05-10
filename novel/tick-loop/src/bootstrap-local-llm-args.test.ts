/**
 * Paired tests for `bootstrap-local-llm-args.ts` — slices 9 + 21 of P0
 * task `minsky-cli-auto-bootstrap-local-llm`. Pure parser; tests cover
 * each flag's detection + the unknown-flag-ignore policy.
 */

import { describe, expect, it } from "vitest";
import { parseBootstrapLocalLlmArgs } from "./bootstrap-local-llm-args.js";

describe("parseBootstrapLocalLlmArgs", () => {
  it("returns all flags false when args is empty", () => {
    expect(parseBootstrapLocalLlmArgs([])).toEqual({ dryRun: false, json: false });
  });

  it("returns dryRun: true when --dry-run is the only arg", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run"])).toEqual({ dryRun: true, json: false });
  });

  it("returns dryRun: true when --dry-run is the first of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--foo", "--bar=baz"])).toEqual({
      dryRun: true,
      json: false,
    });
  });

  it("returns dryRun: true when --dry-run is the last of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz", "--dry-run"])).toEqual({
      dryRun: true,
      json: false,
    });
  });

  it("returns all flags false when only unrelated flags are passed", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz"])).toEqual({
      dryRun: false,
      json: false,
    });
  });

  it("does not match prefix variants like --dry-runs or --dry", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry"])).toEqual({ dryRun: false, json: false });
    expect(parseBootstrapLocalLlmArgs(["--dry-runs"])).toEqual({ dryRun: false, json: false });
    expect(parseBootstrapLocalLlmArgs(["dry-run"])).toEqual({ dryRun: false, json: false });
  });

  it("is pure — same input twice produces equal output", () => {
    const args = ["--dry-run", "--other"];
    expect(parseBootstrapLocalLlmArgs(args)).toEqual(parseBootstrapLocalLlmArgs(args));
  });

  // Slice 21 — `--json` flag.

  it("returns json: true when --json is the only arg", () => {
    expect(parseBootstrapLocalLlmArgs(["--json"])).toEqual({ dryRun: false, json: true });
  });

  it("composes --json with --dry-run", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--json"])).toEqual({
      dryRun: true,
      json: true,
    });
  });

  it("does not match prefix variants like --jsonl or --js", () => {
    expect(parseBootstrapLocalLlmArgs(["--jsonl"])).toEqual({ dryRun: false, json: false });
    expect(parseBootstrapLocalLlmArgs(["--js"])).toEqual({ dryRun: false, json: false });
    expect(parseBootstrapLocalLlmArgs(["json"])).toEqual({ dryRun: false, json: false });
  });

  it("is order-independent — --json before or after --dry-run yields the same result", () => {
    expect(parseBootstrapLocalLlmArgs(["--json", "--dry-run"])).toEqual(
      parseBootstrapLocalLlmArgs(["--dry-run", "--json"]),
    );
  });
});
