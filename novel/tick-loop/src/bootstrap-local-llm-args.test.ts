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

  it("parses --model=<id> into modelId", () => {
    expect(parseBootstrapLocalLlmArgs(["--model=mlx-community/Qwen3-4B-Instruct-4bit"])).toEqual({
      dryRun: false,
      noConfirm: false,
      modelId: "mlx-community/Qwen3-4B-Instruct-4bit",
    });
  });

  it("omits modelId when --model is not passed", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run"])).toEqual({ dryRun: true, noConfirm: false });
    expect("modelId" in parseBootstrapLocalLlmArgs(["--dry-run"])).toBe(false);
  });

  it("treats --model= (empty value) as unset", () => {
    expect(parseBootstrapLocalLlmArgs(["--model="])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("does not match --models= or --model (no =) prefix variants", () => {
    expect(parseBootstrapLocalLlmArgs(["--models=foo/bar"])).toEqual({
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--model"])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("last --model=<id> wins when passed multiple times (argv-tail wins)", () => {
    expect(parseBootstrapLocalLlmArgs(["--model=foo/first", "--model=bar/second"])).toEqual({
      dryRun: false,
      noConfirm: false,
      modelId: "bar/second",
    });
  });

  it("composes --model with --dry-run and --no-confirm", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--no-confirm", "--model=acme/tiny"])).toEqual({
      dryRun: true,
      noConfirm: true,
      modelId: "acme/tiny",
    });
  });

  it("is pure — same input twice produces equal output", () => {
    const args = ["--dry-run", "--no-confirm", "--model=foo/bar", "--other"];
    expect(parseBootstrapLocalLlmArgs(args)).toEqual(parseBootstrapLocalLlmArgs(args));
  });

  // Slice 19 — `--port=<n>` flag.

  it("parses --port=<n> into port (integer)", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=9090"])).toEqual({
      dryRun: false,
      noConfirm: false,
      port: 9090,
    });
  });

  it("omits port when --port is not passed", () => {
    expect("port" in parseBootstrapLocalLlmArgs(["--dry-run"])).toBe(false);
  });

  it("treats --port= (empty value) as unset", () => {
    expect(parseBootstrapLocalLlmArgs(["--port="])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("treats non-numeric --port=foo as unset", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=foo"])).toEqual({
      dryRun: false,
      noConfirm: false,
    });
  });

  it("rejects --port=0 (out of valid TCP range)", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=0"])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("rejects --port=65536 (above valid TCP range)", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=65536"])).toEqual({
      dryRun: false,
      noConfirm: false,
    });
  });

  it("accepts --port=65535 (max valid TCP port)", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=65535"])).toEqual({
      dryRun: false,
      noConfirm: false,
      port: 65_535,
    });
  });

  it("rejects --port=-1 / signed values", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=-1"])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("does not match --ports= or --port (no =) prefix variants", () => {
    expect(parseBootstrapLocalLlmArgs(["--ports=9090"])).toEqual({
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--port"])).toEqual({ dryRun: false, noConfirm: false });
  });

  it("last --port=<n> wins when passed multiple times", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=8080", "--port=9090"])).toEqual({
      dryRun: false,
      noConfirm: false,
      port: 9090,
    });
  });

  it("composes --port with --model and --dry-run", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--model=acme/tiny", "--port=1234"])).toEqual({
      dryRun: true,
      noConfirm: false,
      modelId: "acme/tiny",
      port: 1234,
    });
  });
});
