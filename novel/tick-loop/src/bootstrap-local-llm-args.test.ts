/**
 * Paired tests for `bootstrap-local-llm-args.ts` — slices 9 / 17 / 18 /
 * 19 / 20 of P0 task `minsky-cli-auto-bootstrap-local-llm`. Pure parser;
 * tests cover each flag's detection + the unknown-flag-ignore policy.
 */

import { describe, expect, it } from "vitest";
import { parseBootstrapLocalLlmArgs } from "./bootstrap-local-llm-args.js";

describe("parseBootstrapLocalLlmArgs", () => {
  it("returns all flags false when args is empty", () => {
    expect(parseBootstrapLocalLlmArgs([])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("returns dryRun: true when --dry-run is the only arg", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run"])).toEqual({
      help: false,
      dryRun: true,
      noConfirm: false,
    });
  });

  it("returns dryRun: true when --dry-run is the first of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--foo", "--bar=baz"])).toEqual({
      help: false,
      dryRun: true,
      noConfirm: false,
    });
  });

  it("returns dryRun: true when --dry-run is the last of several args", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz", "--dry-run"])).toEqual({
      help: false,
      dryRun: true,
      noConfirm: false,
    });
  });

  it("returns all flags false when only unrelated flags are passed", () => {
    expect(parseBootstrapLocalLlmArgs(["--foo", "--bar=baz"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("does not match prefix variants like --dry-runs or --dry", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--dry-runs"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["dry-run"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("returns noConfirm: true on --no-confirm", () => {
    expect(parseBootstrapLocalLlmArgs(["--no-confirm"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: true,
    });
  });

  it("returns noConfirm: true on --yes alias", () => {
    expect(parseBootstrapLocalLlmArgs(["--yes"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: true,
    });
  });

  it("returns noConfirm: true on -y short alias", () => {
    expect(parseBootstrapLocalLlmArgs(["-y"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: true,
    });
  });

  it("does not match prefix variants like --no-conf or --yess", () => {
    expect(parseBootstrapLocalLlmArgs(["--no-conf"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--yess"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["yes"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("composes both flags when --dry-run --no-confirm are passed together", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--no-confirm"])).toEqual({
      help: false,
      dryRun: true,
      noConfirm: true,
    });
  });

  it("parses --model=<id> into modelId", () => {
    expect(parseBootstrapLocalLlmArgs(["--model=mlx-community/Qwen3-4B-Instruct-4bit"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
      modelId: "mlx-community/Qwen3-4B-Instruct-4bit",
    });
  });

  it("omits modelId when --model is not passed", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run"])).toEqual({
      help: false,
      dryRun: true,
      noConfirm: false,
    });
    expect("modelId" in parseBootstrapLocalLlmArgs(["--dry-run"])).toBe(false);
  });

  it("treats --model= (empty value) as unset", () => {
    expect(parseBootstrapLocalLlmArgs(["--model="])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("does not match --models= or --model (no =) prefix variants", () => {
    expect(parseBootstrapLocalLlmArgs(["--models=foo/bar"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--model"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("last --model=<id> wins when passed multiple times (argv-tail wins)", () => {
    expect(parseBootstrapLocalLlmArgs(["--model=foo/first", "--model=bar/second"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
      modelId: "bar/second",
    });
  });

  it("composes --model with --dry-run and --no-confirm", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--no-confirm", "--model=acme/tiny"])).toEqual({
      help: false,
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
      help: false,
      dryRun: false,
      noConfirm: false,
      port: 9090,
    });
  });

  it("omits port when --port is not passed", () => {
    expect("port" in parseBootstrapLocalLlmArgs(["--dry-run"])).toBe(false);
  });

  it("treats --port= (empty value) as unset", () => {
    expect(parseBootstrapLocalLlmArgs(["--port="])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("treats non-numeric --port=foo as unset", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=foo"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("rejects --port=0 (out of valid TCP range)", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=0"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("rejects --port=65536 (above valid TCP range)", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=65536"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("accepts --port=65535 (max valid TCP port)", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=65535"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
      port: 65_535,
    });
  });

  it("rejects --port=-1 / signed values", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=-1"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("does not match --ports= or --port (no =) prefix variants", () => {
    expect(parseBootstrapLocalLlmArgs(["--ports=9090"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--port"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("last --port=<n> wins when passed multiple times", () => {
    expect(parseBootstrapLocalLlmArgs(["--port=8080", "--port=9090"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
      port: 9090,
    });
  });

  it("composes --port with --model and --dry-run", () => {
    expect(parseBootstrapLocalLlmArgs(["--dry-run", "--model=acme/tiny", "--port=1234"])).toEqual({
      help: false,
      dryRun: true,
      noConfirm: false,
      modelId: "acme/tiny",
      port: 1234,
    });
  });

  // Slice 20 — `--help` / `-h` flag.

  it("returns help: true on --help", () => {
    expect(parseBootstrapLocalLlmArgs(["--help"])).toEqual({
      help: true,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("returns help: true on -h short alias", () => {
    expect(parseBootstrapLocalLlmArgs(["-h"])).toEqual({
      help: true,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("does not match prefix variants like --helpful or --he", () => {
    expect(parseBootstrapLocalLlmArgs(["--helpful"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["--he"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
    expect(parseBootstrapLocalLlmArgs(["help"])).toEqual({
      help: false,
      dryRun: false,
      noConfirm: false,
    });
  });

  it("composes --help with the other flags (caller decides precedence)", () => {
    // Parser is order-independent and structural — bin/minsky.mjs gives
    // --help highest precedence and short-circuits before consulting
    // the other fields. The parser still reports them faithfully.
    expect(
      parseBootstrapLocalLlmArgs(["--help", "--dry-run", "--no-confirm", "--port=9090"]),
    ).toEqual({
      help: true,
      dryRun: true,
      noConfirm: true,
      port: 9090,
    });
  });
});
