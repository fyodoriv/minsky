/**
 * Tests for `@minsky/tick-loop/llm-invocation` — slice 2 of
 * `local-llm-fallback-on-budget-pause`.
 *
 * Coverage strategy: for each builder, assert the invariant shape
 * (command, argv, stdin), the default-vs-override branches for each
 * configurable knob, and the chaos-table failure modes (argv-poison
 * brief delivered as a single argv element, etc.).
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_AIDER_MODEL,
  DEFAULT_AIDER_OPENAI_API_BASE,
  DEFAULT_AIDER_OPENAI_API_KEY,
  buildAiderInvocation,
  buildClaudePrintInvocation,
} from "./llm-invocation.js";

describe("llm-invocation / buildClaudePrintInvocation", () => {
  it("returns command='claude' and argv=['--print'] with brief on stdin", () => {
    const inv = buildClaudePrintInvocation({ brief: "hello" });
    expect(inv.command).toBe("claude");
    expect(inv.argv).toEqual(["--print"]);
    expect(inv.stdin).toBe("hello");
    expect(inv.cwd).toBeUndefined();
  });

  it("appends extraArgs after --print", () => {
    const inv = buildClaudePrintInvocation({
      brief: "h",
      extraArgs: ["--worktree", "daemon-1-foo"],
    });
    expect(inv.argv).toEqual(["--print", "--worktree", "daemon-1-foo"]);
  });

  it("override command for fixture binary", () => {
    const inv = buildClaudePrintInvocation({ brief: "h", command: "/usr/local/bin/claude" });
    expect(inv.command).toBe("/usr/local/bin/claude");
  });

  it("preserves brief verbatim including whitespace and special chars", () => {
    const brief = "task brief\n  with\ttabs\n  and emoji";
    const inv = buildClaudePrintInvocation({ brief });
    expect(inv.stdin).toBe(brief);
  });

  it("argv is frozen (cannot be mutated)", () => {
    const inv = buildClaudePrintInvocation({ brief: "h" });
    expect(Object.isFrozen(inv.argv)).toBe(true);
  });
});

describe("llm-invocation / buildAiderInvocation", () => {
  it("returns command='aider' and stdin=undefined (brief on argv)", () => {
    const inv = buildAiderInvocation({ brief: "do work" });
    expect(inv.command).toBe("aider");
    expect(inv.stdin).toBeUndefined();
  });

  it("argv has the documented shape with defaults", () => {
    const inv = buildAiderInvocation({ brief: "do work" });
    expect(inv.argv).toEqual([
      "--model",
      DEFAULT_AIDER_MODEL,
      "--openai-api-base",
      DEFAULT_AIDER_OPENAI_API_BASE,
      "--openai-api-key",
      DEFAULT_AIDER_OPENAI_API_KEY,
      "--yes",
      "--no-show-model-warnings",
      "--no-auto-commits",
      "--message",
      "do work",
    ]);
  });

  it("--no-auto-commits is hard-wired (daemon controls commits via the brief)", () => {
    const inv = buildAiderInvocation({ brief: "h" });
    expect(inv.argv).toContain("--no-auto-commits");
  });

  it("--message is the LAST argv element so brief is easy to read in ps", () => {
    const inv = buildAiderInvocation({ brief: "the brief" });
    const messageIdx = inv.argv.indexOf("--message");
    expect(messageIdx).toBeGreaterThan(-1);
    expect(inv.argv[messageIdx + 1]).toBe("the brief");
    expect(inv.argv).toHaveLength(messageIdx + 2);
  });

  it("model override appears in argv", () => {
    const inv = buildAiderInvocation({ brief: "h", model: "openai/llama-3.1-70b" });
    expect(inv.argv).toContain("openai/llama-3.1-70b");
    expect(inv.argv).not.toContain(DEFAULT_AIDER_MODEL);
  });

  it("openaiApiBase override appears in argv", () => {
    const inv = buildAiderInvocation({
      brief: "h",
      openaiApiBase: "http://elsewhere:9000/v1",
    });
    expect(inv.argv).toContain("http://elsewhere:9000/v1");
    expect(inv.argv).not.toContain(DEFAULT_AIDER_OPENAI_API_BASE);
  });

  it("openaiApiKey override appears in argv", () => {
    const inv = buildAiderInvocation({ brief: "h", openaiApiKey: "real-key" });
    expect(inv.argv).toContain("real-key");
    expect(inv.argv).not.toContain(DEFAULT_AIDER_OPENAI_API_KEY);
  });

  it("extraArgs are inserted before --message (so --message <brief> stays terminal)", () => {
    const inv = buildAiderInvocation({
      brief: "h",
      extraArgs: ["--auto-commits", "--no-attribute-author"],
    });
    const messageIdx = inv.argv.indexOf("--message");
    expect(inv.argv.slice(messageIdx - 2, messageIdx)).toEqual([
      "--auto-commits",
      "--no-attribute-author",
    ]);
  });

  it("cwd override flows through to invocation.cwd", () => {
    const inv = buildAiderInvocation({ brief: "h", cwd: "/path/to/daemon-1-foo" });
    expect(inv.cwd).toBe("/path/to/daemon-1-foo");
  });

  it("cwd absent stays undefined (no cwd key on object)", () => {
    const inv = buildAiderInvocation({ brief: "h" });
    expect("cwd" in inv).toBe(false);
  });

  it("argv-poison brief is delivered as a single argv element (chaos row 1)", () => {
    // Adversarial brief that, if shell-evaluated, would change behavior.
    const brief = "real task\n--yes-i-really-mean-it\n; rm -rf /";
    const inv = buildAiderInvocation({ brief });
    const messageIdx = inv.argv.indexOf("--message");
    // The whole brief must be one argv element, NOT split.
    expect(inv.argv[messageIdx + 1]).toBe(brief);
    expect(inv.argv).toHaveLength(messageIdx + 2);
  });

  it("override command for fixture binary", () => {
    const inv = buildAiderInvocation({ brief: "h", command: "/private/aider" });
    expect(inv.command).toBe("/private/aider");
  });

  it("argv is frozen (cannot be mutated)", () => {
    const inv = buildAiderInvocation({ brief: "h" });
    expect(Object.isFrozen(inv.argv)).toBe(true);
  });

  it("preserves brief verbatim with whitespace, newlines, emoji, unicode", () => {
    const brief = "task\n  brief\twith\nlots of \u2028 stuff and a 🚀 emoji";
    const inv = buildAiderInvocation({ brief });
    const messageIdx = inv.argv.indexOf("--message");
    expect(inv.argv[messageIdx + 1]).toBe(brief);
  });
});

describe("llm-invocation / referential transparency", () => {
  it("buildClaudePrintInvocation: same input → same output", () => {
    const a = buildClaudePrintInvocation({ brief: "x" });
    const b = buildClaudePrintInvocation({ brief: "x" });
    expect(a).toEqual(b);
  });

  it("buildAiderInvocation: same input → same output", () => {
    const a = buildAiderInvocation({ brief: "x" });
    const b = buildAiderInvocation({ brief: "x" });
    expect(a).toEqual(b);
  });

  it("two calls don't share argv reference (freezing per-call)", () => {
    const a = buildAiderInvocation({ brief: "x" });
    const b = buildAiderInvocation({ brief: "x" });
    // Different reference, same content (so callers can't mutate one and affect the other).
    expect(a.argv).not.toBe(b.argv);
    expect(a.argv).toEqual(b.argv);
  });
});
