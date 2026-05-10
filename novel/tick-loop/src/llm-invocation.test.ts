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
  DEFAULT_OPENCODE_MODEL,
  buildAiderInvocation,
  buildClaudePrintInvocation,
  buildOpencodeInvocation,
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
      "--map-tokens",
      "0",
      "--message",
      "do work",
    ]);
  });

  it("--no-auto-commits is hard-wired (daemon controls commits via the brief)", () => {
    const inv = buildAiderInvocation({ brief: "h" });
    expect(inv.argv).toContain("--no-auto-commits");
  });

  it("--map-tokens 0 disables aider's repo-map auto-load (slim-brief invariant)", () => {
    const inv = buildAiderInvocation({ brief: "h" });
    const idx = inv.argv.indexOf("--map-tokens");
    expect(idx).toBeGreaterThan(-1);
    expect(inv.argv[idx + 1]).toBe("0");
  });

  it("operator can override --map-tokens via extraArgs (later flag wins per aider's argparse)", () => {
    const inv = buildAiderInvocation({
      brief: "h",
      extraArgs: ["--map-tokens", "1024"],
    });
    // Both pairs present; last one wins per aider's argparse.
    const all = inv.argv.filter((x) => x === "--map-tokens");
    expect(all.length).toBe(2);
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

describe("llm-invocation / buildOpencodeInvocation — slice 1 of `support-opencode-lmstudio-mlx-qwen3-14b-stack`", () => {
  it("returns command='opencode' by default", () => {
    const inv = buildOpencodeInvocation({ brief: "h" });
    expect(inv.command).toBe("opencode");
  });

  it("argv starts with `run --dangerously-skip-permissions` when no model pin (lets opencode read its config)", () => {
    const inv = buildOpencodeInvocation({ brief: "h" });
    expect(inv.argv[0]).toBe("run");
    // No --model when opts.model is undefined — opencode resolves from
    // <repo>/opencode.json → ~/.config/opencode/opencode.json → defaults.
    expect(inv.argv).not.toContain("--model");
    expect(inv.argv[1]).toBe("--dangerously-skip-permissions");
  });

  it("argv includes `--model <id>` when opts.model is set", () => {
    const inv = buildOpencodeInvocation({
      brief: "h",
      model: "lmstudio/qwen/qwen3-14b",
    });
    expect(inv.argv[0]).toBe("run");
    expect(inv.argv[1]).toBe("--model");
    expect(inv.argv[2]).toBe("lmstudio/qwen/qwen3-14b");
    expect(inv.argv[3]).toBe("--dangerously-skip-permissions");
  });

  it("brief is delivered as the final positional argv element (not stdin)", () => {
    const brief = "ship the next iteration of foo";
    const inv = buildOpencodeInvocation({ brief });
    expect(inv.argv[inv.argv.length - 1]).toBe(brief);
    expect(inv.stdin).toBeUndefined();
  });

  it("DEFAULT_OPENCODE_MODEL is the May 2026 reference model (used by docs + tests; builder no longer auto-applies it)", () => {
    expect(DEFAULT_OPENCODE_MODEL).toBe("lmstudio/qwen3-14b");
  });

  it("model override flows through to argv", () => {
    const inv = buildOpencodeInvocation({
      brief: "h",
      model: "lmstudio/qwen3.6-27b",
    });
    expect(inv.argv).toContain("lmstudio/qwen3.6-27b");
    expect(inv.argv).not.toContain("lmstudio/qwen3-14b");
  });

  it("model override accepts non-lmstudio providers (any provider/model string)", () => {
    const inv = buildOpencodeInvocation({
      brief: "h",
      model: "anthropic/claude-opus-4-7",
    });
    expect(inv.argv).toContain("anthropic/claude-opus-4-7");
  });

  it("command override for fixture binary", () => {
    const inv = buildOpencodeInvocation({
      brief: "h",
      command: "/private/opencode",
    });
    expect(inv.command).toBe("/private/opencode");
  });

  it("extraArgs are inserted between fixed flags and the brief positional", () => {
    const inv = buildOpencodeInvocation({
      brief: "task body",
      extraArgs: ["--agent", "build", "--session", "abc123"],
    });
    const briefIdx = inv.argv.length - 1;
    expect(inv.argv[briefIdx]).toBe("task body");
    expect(inv.argv[briefIdx - 4]).toBe("--agent");
    expect(inv.argv[briefIdx - 3]).toBe("build");
    expect(inv.argv[briefIdx - 2]).toBe("--session");
    expect(inv.argv[briefIdx - 1]).toBe("abc123");
  });

  it("cwd is set on the invocation when provided (per-worker worktree path)", () => {
    const inv = buildOpencodeInvocation({
      brief: "h",
      cwd: "/tmp/daemon-3/worktree",
    });
    expect(inv.cwd).toBe("/tmp/daemon-3/worktree");
  });

  it("cwd field is omitted when not provided (so spawn-strategy uses parent cwd)", () => {
    const inv = buildOpencodeInvocation({ brief: "h" });
    expect(inv.cwd).toBeUndefined();
  });

  it("argv is frozen (Strategy seam — wiring layer cannot mutate)", () => {
    const inv = buildOpencodeInvocation({ brief: "h" });
    expect(Object.isFrozen(inv.argv)).toBe(true);
  });

  it("argv-poison brief is delivered as a single argv element (chaos row 1)", () => {
    // Adversarial brief that, if shell-evaluated, would change opencode's
    // behavior (--continue resumes the prior session; --fork branches it).
    const brief = "real task\n--continue\n--fork some-session-id";
    const inv = buildOpencodeInvocation({ brief });
    expect(inv.argv[inv.argv.length - 1]).toBe(brief);
    // No --continue or --fork should appear as standalone argv elements.
    const continueIdx = inv.argv.indexOf("--continue");
    expect(continueIdx).toBe(-1);
    const forkIdx = inv.argv.indexOf("--fork");
    expect(forkIdx).toBe(-1);
  });

  it("preserves brief verbatim with whitespace, newlines, emoji, unicode (chaos row)", () => {
    const brief = "task\n  brief\twith\nlots of   stuff and a 🚀 emoji";
    const inv = buildOpencodeInvocation({ brief });
    expect(inv.argv[inv.argv.length - 1]).toBe(brief);
  });

  it("empty brief is permitted (operator may want to attach to a session with no new prompt)", () => {
    const inv = buildOpencodeInvocation({ brief: "" });
    expect(inv.argv[inv.argv.length - 1]).toBe("");
    // Empty brief is still the trailing argv element, not absent.
    // With the 2026-05-10 update (no auto-model), the argv shape is
    // [run, --dangerously-skip-permissions, <brief>] = 3 elements when
    // no model is pinned.
    expect(inv.argv).toHaveLength(3);
  });

  it("operator-machine-config auto-pickup: with no model pin, opencode reads its own opencode.json (no --model override)", () => {
    // This test pins the semantic: minsky NEVER passes --model unless
    // explicitly asked. Operators put their preferred model in
    // <repo>/opencode.json or ~/.config/opencode/opencode.json and edit
    // it at will — the next iteration's `opencode run` picks up the
    // change automatically with no Minsky restart.
    const inv = buildOpencodeInvocation({ brief: "task" });
    expect(inv.argv).not.toContain("--model");
    expect(inv.argv).not.toContain("lmstudio/qwen3-14b");
    // Argv length proves no --model + <id> pair injected.
    expect(inv.argv).toEqual(["run", "--dangerously-skip-permissions", "task"]);
  });

  it("very long brief is delivered intact (no truncation in the builder; spawn-strategy enforces OS argv limits)", () => {
    const brief = "x".repeat(10_000);
    const inv = buildOpencodeInvocation({ brief });
    expect(inv.argv[inv.argv.length - 1]).toBe(brief);
    expect((inv.argv[inv.argv.length - 1] ?? "").length).toBe(10_000);
  });

  it("dangerously-skip-permissions flag is always present (daemon runs unattended)", () => {
    const inv = buildOpencodeInvocation({
      brief: "h",
      extraArgs: ["--something-else"],
    });
    expect(inv.argv).toContain("--dangerously-skip-permissions");
  });

  it("stdin is undefined (brief on argv, not piped)", () => {
    const inv = buildOpencodeInvocation({ brief: "h" });
    expect(inv.stdin).toBeUndefined();
  });

  it("argv ordering is stable: run, --model, <id>, --dangerously-skip-permissions, [extras], <brief>", () => {
    const inv = buildOpencodeInvocation({
      brief: "B",
      model: "lmstudio/qwen3-14b",
      extraArgs: ["--variant", "agent-mode"],
    });
    expect([...inv.argv]).toEqual([
      "run",
      "--model",
      "lmstudio/qwen3-14b",
      "--dangerously-skip-permissions",
      "--variant",
      "agent-mode",
      "B",
    ]);
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
