// Paired tests for the least-authority repo policy gate (rule #3 —
// test-first). Covers the full home vs foreign × push/PR/taskmd matrix
// (Acceptance (1)) plus the origin/path normalisation chain, the
// fail-safe diff-shape predicate, and the write-verdict ledger record
// the conductor wiring appends (the shape runany-policy-audit reads).
//
// Pattern: table-driven contract test (Bentley 1986 — programming
//   pearls of table-driven tests; Fowler, *Refactoring* 2nd ed. 2018
//   ch. 9 — pure functions tested via plain inputs, no DI needed since
//   the module is already I/O-free).
// Coverage target: every cell of the decision table + each
//   normalisation branch + every isTaskmdOnlyDiff edge + both
//   buildWriteVerdictRecord arms (allow / refuse).

import { describe, expect, it } from "vitest";
import {
  assertWriteAllowed,
  buildWriteVerdictRecord,
  classifyRepo,
  isTaskmdOnlyDiff,
} from "./repo-policy.mjs";

describe("classifyRepo", () => {
  it("same git root → home", () => {
    expect(
      classifyRepo({ repoRoot: "/home/op/apps/minsky", homeRoot: "/home/op/apps/minsky" }),
    ).toBe("home");
  });

  it("trailing slash on either root is normalised → home", () => {
    expect(
      classifyRepo({ repoRoot: "/home/op/apps/minsky/", homeRoot: "/home/op/apps/minsky" }),
    ).toBe("home");
  });

  it("different root but same origin (scp-form vs https, .git suffix) → home", () => {
    expect(
      classifyRepo({
        repoRoot: "/tmp/wt/minsky",
        homeRoot: "/home/op/apps/minsky",
        repoOrigin: "git@github.com:fyodoriv/minsky.git",
        homeOrigin: "https://github.com/fyodoriv/minsky",
      }),
    ).toBe("home");
  });

  it("ssh:// scheme with trailing slash collapses to the same origin → home", () => {
    expect(
      classifyRepo({
        repoRoot: "/a",
        homeRoot: "/b",
        repoOrigin: "ssh://git@github.com/fyodoriv/minsky/",
        homeOrigin: "git@github.com:fyodoriv/minsky.git",
      }),
    ).toBe("home");
  });

  it("different root and different origin → foreign", () => {
    expect(
      classifyRepo({
        repoRoot: "/home/op/apps/other",
        homeRoot: "/home/op/apps/minsky",
        repoOrigin: "git@github.com:someone/other.git",
        homeOrigin: "git@github.com:fyodoriv/minsky.git",
      }),
    ).toBe("foreign");
  });

  it("different root and no origins known → foreign (path-only fallback)", () => {
    expect(
      classifyRepo({ repoRoot: "/home/op/apps/other", homeRoot: "/home/op/apps/minsky" }),
    ).toBe("foreign");
  });

  it("empty-string origin is treated as unknown (not a match) → foreign", () => {
    expect(
      classifyRepo({
        repoRoot: "/x",
        homeRoot: "/y",
        repoOrigin: "",
        homeOrigin: "",
      }),
    ).toBe("foreign");
  });
});

describe("assertWriteAllowed — home vs foreign × push/PR/taskmd matrix", () => {
  it("home + push-code → allow", () => {
    expect(assertWriteAllowed({ repoClass: "home", action: "push-code" })).toEqual({
      allowed: true,
      classification: "home",
      action: "push-code",
    });
  });

  it("home + open-pr (arbitrary diff) → allow", () => {
    expect(
      assertWriteAllowed({
        repoClass: "home",
        action: "open-pr",
        changedPaths: ["src/a.ts", "TASKS.md"],
      }),
    ).toEqual({ allowed: true, classification: "home", action: "open-pr" });
  });

  it("foreign + push-code → refuse foreign-code-push", () => {
    const v = assertWriteAllowed({ repoClass: "foreign", action: "push-code" });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.code).toBe("foreign-code-push");
    expect(v.reason).toContain("code pushes are never permitted");
  });

  it("foreign + open-pr + TASKS.md-only diff → allow", () => {
    expect(
      assertWriteAllowed({
        repoClass: "foreign",
        action: "open-pr",
        changedPaths: ["TASKS.md"],
      }),
    ).toEqual({ allowed: true, classification: "foreign", action: "open-pr" });
  });

  it("foreign + open-pr + nested TASKS.md-only diff → allow", () => {
    expect(
      assertWriteAllowed({
        repoClass: "foreign",
        action: "open-pr",
        changedPaths: ["TASKS.md", "packages/x/TASKS.md"],
      }).allowed,
    ).toBe(true);
  });

  it("foreign + open-pr + mixed (TASKS.md + code) diff → refuse foreign-nontaskmd-pr", () => {
    const v = assertWriteAllowed({
      repoClass: "foreign",
      action: "open-pr",
      changedPaths: ["TASKS.md", "src/leak.ts"],
    });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.code).toBe("foreign-nontaskmd-pr");
  });

  it("foreign + open-pr + omitted diff → refuse (fail-safe, undetermined diff)", () => {
    const v = assertWriteAllowed({ repoClass: "foreign", action: "open-pr" });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.code).toBe("foreign-nontaskmd-pr");
  });

  it("foreign + open-pr + empty diff → refuse (fail-safe)", () => {
    const v = assertWriteAllowed({
      repoClass: "foreign",
      action: "open-pr",
      changedPaths: [],
    });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.code).toBe("foreign-nontaskmd-pr");
  });
});

describe("isTaskmdOnlyDiff (defense-in-depth diff-shape predicate)", () => {
  it("single root TASKS.md → true", () => {
    expect(isTaskmdOnlyDiff(["TASKS.md"])).toBe(true);
  });

  it("nested TASKS.md only → true", () => {
    expect(isTaskmdOnlyDiff(["packages/a/TASKS.md", "TASKS.md"])).toBe(true);
  });

  it("empty list → false (fail-safe — undetermined is not TASKS.md-only)", () => {
    expect(isTaskmdOnlyDiff([])).toBe(false);
  });

  it("any non-TASKS.md path → false", () => {
    expect(isTaskmdOnlyDiff(["TASKS.md", "README.md"])).toBe(false);
  });

  it("TASKS.md look-alikes are rejected", () => {
    expect(isTaskmdOnlyDiff(["TASKS.md.bak"])).toBe(false);
    expect(isTaskmdOnlyDiff(["MY-TASKS.md"])).toBe(false);
    expect(isTaskmdOnlyDiff(["TASKS.markdown"])).toBe(false);
  });

  it("whitespace-only / empty path entry → false", () => {
    expect(isTaskmdOnlyDiff(["  "])).toBe(false);
  });
});

describe("buildWriteVerdictRecord — the ledger shape runany-policy-audit reads", () => {
  it("home open-pr allow → write-verdict, repoClass home, allowed true, no code", () => {
    const req = /** @type {const} */ ({ repoClass: "home", action: "open-pr" });
    const rec = buildWriteVerdictRecord(req, assertWriteAllowed(req), "2026-06-02T00:00:00.000Z");
    expect(rec).toEqual({
      ts: "2026-06-02T00:00:00.000Z",
      event: "write-verdict",
      repoClass: "home",
      action: "open-pr",
      allowed: true,
      taskmdOnly: false,
    });
  });

  it("foreign TASKS.md-only PR allow → taskmdOnly true, allowed true", () => {
    const req = /** @type {const} */ ({
      repoClass: "foreign",
      action: "open-pr",
      changedPaths: ["TASKS.md"],
    });
    const rec = buildWriteVerdictRecord(req, assertWriteAllowed(req), "2026-06-02T00:00:00.000Z");
    expect(rec.allowed).toBe(true);
    expect(rec.taskmdOnly).toBe(true);
    expect(rec.code).toBeUndefined();
  });

  it("foreign code-push refusal → allowed false carries the stable code", () => {
    const req = /** @type {const} */ ({ repoClass: "foreign", action: "push-code" });
    const rec = buildWriteVerdictRecord(req, assertWriteAllowed(req), "2026-06-02T00:00:00.000Z");
    expect(rec.allowed).toBe(false);
    expect(rec.code).toBe("foreign-code-push");
    expect(rec.taskmdOnly).toBe(false);
  });

  it("defaults the timestamp to an ISO string when ts omitted", () => {
    const req = /** @type {const} */ ({ repoClass: "home", action: "push-code" });
    const rec = buildWriteVerdictRecord(req, assertWriteAllowed(req));
    expect(typeof rec.ts).toBe("string");
    expect(() => new Date(rec.ts).toISOString()).not.toThrow();
  });
});
