// Paired tests for `minsky-logs.mjs`. Pure formatters get pinned shapes
// here so a daemon-side rename of `iteration.status` / `task.id` / etc.
// trips a deterministic test failure (rule #10).
//
// We assert on the *raw* (non-TTY) output (no ANSI codes) so the tests are
// portable across CI environments — `process.stdout.isTTY` is `false` under
// vitest so `color()` already returns the unwrapped string.

import { describe, expect, it } from "vitest";

import { formatLine, formatSpan } from "./minsky-logs.mjs";

describe("formatSpan — iteration", () => {
  it("formats a failed iteration with FAIL tag, task id, provider, reason", () => {
    const line = `[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"failed","task.id":"spawn-failed-exit-minus-one-silent-empty-stderr","iteration.reason":"some error","iteration.provider":"claude"}`;
    const out = formatSpan(line);
    expect(out).not.toBeNull();
    expect(out).toContain("FAIL");
    expect(out).toContain("iter#0");
    expect(out).toContain("spawn-failed-exit-minus-one-silent-empty-stderr");
    expect(out).toContain("via claude");
    expect(out).toContain("some error");
  });

  it("formats a validated iteration with PASS tag", () => {
    const line = `[span] tick-loop.iteration {"iteration.index":3,"iteration.status":"validated","task.id":"some-task","iteration.provider":"devin"}`;
    const out = formatSpan(line);
    expect(out).not.toBeNull();
    expect(out).toContain("PASS");
    expect(out).toContain("iter#3");
    expect(out).toContain("some-task");
    expect(out).toContain("via devin");
  });

  it("truncates over-long reason at 240 chars", () => {
    const huge = "x".repeat(500);
    const line = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"failed","task.id":"t","iteration.reason":"${huge}","iteration.provider":"devin"}`;
    const out = formatSpan(line);
    expect(out).not.toBeNull();
    // The middle of the huge string is dropped after 240 chars.
    expect((out ?? "").length).toBeLessThan(400);
  });
});

describe("formatSpan — strategic-pick", () => {
  it("formats with agent/model + kind + reason", () => {
    const line = `[span] tick-loop.strategic-pick {"model":"claude-sonnet-4-6","agent":"claude","kind":"operator-pin","reason":"operator-pin: MINSKY_STRATEGIC_PIN_MODEL=claude-sonnet-4-6 bypasses catalog walk"}`;
    const out = formatSpan(line);
    expect(out).not.toBeNull();
    expect(out).toContain("[pick]");
    expect(out).toContain("claude/claude-sonnet-4-6");
    expect(out).toContain("operator-pin");
  });

  it("handles devin agent", () => {
    const line = `[span] tick-loop.strategic-pick {"model":"devin","agent":"devin","kind":"strategic-router","reason":"x"}`;
    const out = formatSpan(line);
    expect(out).toContain("devin/devin");
  });
});

describe("formatSpan — llm-provider.dispatch", () => {
  it("shows provider + budget + local reachability", () => {
    const line = `[span] tick-loop.llm-provider.dispatch {"provider":"claude","reason":"budget weekly-cap-warn; claude clean","budget.state":"weekly-cap-warn","local.reachable":false,"local.reason":"ECONNREFUSED"}`;
    const out = formatSpan(line);
    expect(out).not.toBeNull();
    expect(out).toContain("[dispatch]");
    expect(out).toContain("→ claude");
    expect(out).toContain("budget=weekly-cap-warn");
    expect(out).toContain("local:no(ECONNREFUSED)");
  });

  it("marks local reachable when ok", () => {
    const line = `[span] tick-loop.llm-provider.dispatch {"provider":"local","budget.state":"normal","local.reachable":true}`;
    const out = formatSpan(line);
    expect(out).toContain("local:ok");
  });
});

describe("formatSpan — changelog / snapshot / metrics-render", () => {
  it("shows ran outcome with exit code", () => {
    const line = `[span] tick-loop.changelog {"changelog.date":"2026-05-26","changelog.outcome":"ran","changelog.exit_code":0,"changelog.duration_ms":1500}`;
    const out = formatSpan(line);
    expect(out).toContain("[changelog]");
    expect(out).toContain("ran");
    expect(out).toContain("2026-05-26");
    expect(out).toContain("exit=0");
  });

  it("shows skipped outcome with reason", () => {
    const line = `[span] tick-loop.snapshot {"snapshot.date":"2026-05-26","snapshot.outcome":"skipped","snapshot.skip_reason":"already-captured"}`;
    const out = formatSpan(line);
    expect(out).toContain("[snapshot]");
    expect(out).toContain("skipped");
    expect(out).toContain("skip=already-captured");
  });
});

describe("formatSpan — parallel-sweeper.tick", () => {
  it("dims quiet sweep (no debris)", () => {
    const line = `[span] tick-loop.parallel-sweeper.tick {"sweeper.indexLocksSwept":0,"sweeper.expiredClaimsSwept":0,"sweeper.hadRecoverableErrors":false,"sweeper.reasonsHead":[]}`;
    const out = formatSpan(line);
    expect(out).toContain("[sweeper] clean");
  });

  it("highlights non-zero sweep counts", () => {
    const line = `[span] tick-loop.parallel-sweeper.tick {"sweeper.indexLocksSwept":2,"sweeper.expiredClaimsSwept":1}`;
    const out = formatSpan(line);
    expect(out).toContain("locks=2");
    expect(out).toContain("claims=1");
  });
});

describe("formatSpan — unknown shape", () => {
  it("returns null for non-span lines", () => {
    expect(formatSpan("plain text")).toBeNull();
    expect(formatSpan("[tick-loop] something")).toBeNull();
  });

  it("falls back gracefully on malformed JSON", () => {
    const out = formatSpan("[span] tick-loop.iteration { not valid json");
    expect(out).not.toBeNull();
    // No crash, returns the raw line dimmed.
    expect(out).toContain("not valid json");
  });

  it("uses generic format for unknown span names", () => {
    const line = `[span] tick-loop.brand-new-event {"foo":"bar"}`;
    const out = formatSpan(line);
    expect(out).toContain("[span]");
    expect(out).toContain("brand-new-event");
    expect(out).toContain('"foo":"bar"');
  });
});

describe("formatLine — non-span prefixes", () => {
  it("tags [tick-loop] lines", () => {
    const out = formatLine("out", "[tick-loop] daily snapshot wired");
    expect(out).toContain("[tick-loop]");
    expect(out).toContain("daily snapshot wired");
  });

  it("tags [config-analyzer] lines", () => {
    const out = formatLine("err", "[config-analyzer] 2 recommendation(s):");
    expect(out).toContain("[config-analyzer]");
    expect(out).toContain("2 recommendation(s):");
  });

  it("tags [machine-budget] lines", () => {
    const out = formatLine("err", "[machine-budget] budget=70% reachable");
    expect(out).toContain("[machine-budget]");
    expect(out).toContain("budget=70%");
  });

  it("tags self-diagnose findings", () => {
    const out = formatLine("out", "self-diagnose: ran at 2026-05-26T13:29:28Z, 3 findings");
    expect(out).toContain("[self-diagnose]");
    expect(out).toContain("ran at 2026-05-26T13:29:28Z");
  });

  it("tags worker startup line", () => {
    const out = formatLine("err", "tick-loop: worker 0 of 1 (branches: daemon/0/<task-id>)");
    expect(out).toContain("[worker]");
    expect(out).toContain("worker 0 of 1");
  });

  it("colors err-stream lines containing error keywords red", () => {
    // We can't easily assert ANSI codes when isTTY=false (they're stripped),
    // but we can assert the line passes through cleanly.
    const out = formatLine("err", "fatal: this operation must be run in a work tree");
    expect(out).toContain("fatal:");
  });

  it("attaches ERR vs OUT stream tag", () => {
    const outLine = formatLine("out", "[tick-loop] foo");
    const errLine = formatLine("err", "[tick-loop] foo");
    expect(outLine).toContain("OUT");
    expect(errLine).toContain("ERR");
  });

  it("returns empty string for blank input", () => {
    expect(formatLine("out", "")).toBe("");
    expect(formatLine("err", "   ")).toBe("");
  });
});

describe("formatLine — self-diagnose actor labels (operator directive 2026-05-26)", () => {
  it("preserves the [👤 needs-operator] label so the operator can grep for action items", () => {
    const line = "  [👤 needs-operator] daemon-pr-stuck-dirty";
    const out = formatLine("out", line);
    expect(out).toContain("[👤 needs-operator]");
    expect(out).toContain("daemon-pr-stuck-dirty");
  });

  it("preserves the [🤖 minsky-will-fix] label for auto-fix findings", () => {
    const line = "  [🤖 minsky-will-fix] some-auto-id";
    const out = formatLine("out", line);
    expect(out).toContain("[🤖 minsky-will-fix]");
    expect(out).toContain("some-auto-id");
  });

  it("preserves the [🤖→👤 minsky-tries-then-operator] label for escalation findings", () => {
    const line = "  [🤖→👤 minsky-tries-then-operator] some-escalation-id";
    const out = formatLine("out", line);
    expect(out).toContain("[🤖→👤 minsky-tries-then-operator]");
    expect(out).toContain("some-escalation-id");
  });

  it("rolls up the count-by-actor header line through cleanly", () => {
    const line =
      "self-diagnose: 2 finding(s) — 🤖 0 auto-fix · 🤖→👤 0 auto-then-operator · 👤 2 needs-operator";
    const out = formatLine("out", line);
    expect(out).toContain("self-diagnose");
    expect(out).toContain("2 finding(s)");
    expect(out).toContain("👤 2 needs-operator");
  });
});
