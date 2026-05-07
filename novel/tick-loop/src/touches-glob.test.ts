import { describe, expect, it } from "vitest";
import {
  type TouchesPrSnapshot,
  decideTouchesCollision,
  extractFilePathsFromFilesField,
  globMatchesPath,
  parseTouchesField,
  parseTouchesOrFiles,
} from "./touches-glob.js";

describe("parseTouchesField", () => {
  it("extracts a comma-separated glob list from a task block", () => {
    const block =
      "- [ ] `t` — clean\n  - **ID**: t\n  - **Touches**: `novel/tick-loop/**`, `scripts/*.mjs`\n";
    expect(parseTouchesField(block)).toEqual(["novel/tick-loop/**", "scripts/*.mjs"]);
  });

  it("returns [] when the field is absent", () => {
    const block = "- [ ] `t` — clean\n  - **ID**: t\n  - **Tags**: p0\n";
    expect(parseTouchesField(block)).toEqual([]);
  });

  it("trims whitespace and strips backtick wrappers", () => {
    const block = "  - **Touches**:   `a/b` ,  c/d  ,  `e/f`  \n";
    expect(parseTouchesField(block)).toEqual(["a/b", "c/d", "e/f"]);
  });

  it("dedupes repeated globs", () => {
    const block = "  - **Touches**: a/b, a/b, c/d\n";
    expect(parseTouchesField(block)).toEqual(["a/b", "c/d"]);
  });

  it("handles a single-glob list", () => {
    expect(parseTouchesField("  - **Touches**: novel/tick-loop/**\n")).toEqual([
      "novel/tick-loop/**",
    ]);
  });

  it("ignores empty entries (e.g. trailing comma)", () => {
    expect(parseTouchesField("  - **Touches**: a/b, , c/d,\n")).toEqual(["a/b", "c/d"]);
  });
});

describe("globMatchesPath", () => {
  it("matches exact paths", () => {
    expect(globMatchesPath("a/b/c.ts", "a/b/c.ts")).toBe(true);
    expect(globMatchesPath("a/b/c.ts", "a/b/d.ts")).toBe(false);
  });

  it("matches `*` against any chars including slash (descended-path style)", () => {
    expect(globMatchesPath("novel/*/file.ts", "novel/tick-loop/file.ts")).toBe(true);
    expect(globMatchesPath("novel/*/file.ts", "novel/a/b/c/file.ts")).toBe(true);
  });

  it("matches `**` (the same as `*` in this minimal matcher)", () => {
    expect(globMatchesPath("novel/tick-loop/**", "novel/tick-loop/src/daemon.ts")).toBe(true);
    expect(globMatchesPath("novel/tick-loop/**", "novel/dashboard-web/src/server.ts")).toBe(false);
  });

  it("matches `?` against a single character", () => {
    expect(globMatchesPath("file?.ts", "fileA.ts")).toBe(true);
    expect(globMatchesPath("file?.ts", "fileAB.ts")).toBe(false);
  });

  it("escapes regex metacharacters in literal segments", () => {
    expect(globMatchesPath("a.b.ts", "a.b.ts")).toBe(true);
    expect(globMatchesPath("a.b.ts", "axbyts")).toBe(false);
  });
});

describe("decideTouchesCollision", () => {
  it("returns proceed when no globs are declared", () => {
    const openPrs: TouchesPrSnapshot[] = [{ number: 1, files: ["any/file.ts"] }];
    expect(decideTouchesCollision({ taskGlobs: [], openPrs })).toEqual({ verdict: "proceed" });
  });

  it("returns proceed when no open PR's files overlap any glob", () => {
    const openPrs: TouchesPrSnapshot[] = [{ number: 1, files: ["docs/README.md"] }];
    expect(decideTouchesCollision({ taskGlobs: ["novel/tick-loop/**"], openPrs })).toEqual({
      verdict: "proceed",
    });
  });

  it("returns collision-prevented with the PR number when overlap is found", () => {
    const openPrs: TouchesPrSnapshot[] = [
      { number: 5, files: ["docs/README.md"] },
      { number: 7, files: ["novel/tick-loop/src/daemon.ts"] },
    ];
    const decision = decideTouchesCollision({ taskGlobs: ["novel/tick-loop/**"], openPrs });
    expect(decision).toEqual({
      verdict: "collision-prevented",
      prNumber: 7,
      overlapping: ["novel/tick-loop/src/daemon.ts"],
    });
  });

  it("returns the FIRST colliding PR (deterministic walk order)", () => {
    const openPrs: TouchesPrSnapshot[] = [
      { number: 5, files: ["novel/tick-loop/src/a.ts"] },
      { number: 9, files: ["novel/tick-loop/src/b.ts"] },
    ];
    const decision = decideTouchesCollision({ taskGlobs: ["novel/tick-loop/**"], openPrs });
    expect(decision).toMatchObject({ verdict: "collision-prevented", prNumber: 5 });
  });

  it("collects ALL overlapping files within the colliding PR", () => {
    const openPrs: TouchesPrSnapshot[] = [
      {
        number: 1,
        files: ["novel/tick-loop/src/a.ts", "docs/README.md", "novel/tick-loop/src/b.ts"],
      },
    ];
    const decision = decideTouchesCollision({ taskGlobs: ["novel/tick-loop/**"], openPrs });
    expect(decision).toMatchObject({
      verdict: "collision-prevented",
      prNumber: 1,
      overlapping: ["novel/tick-loop/src/a.ts", "novel/tick-loop/src/b.ts"],
    });
  });

  it("respects multiple globs (any glob matching is enough to fire)", () => {
    const openPrs: TouchesPrSnapshot[] = [{ number: 1, files: ["scripts/x.mjs"] }];
    const decision = decideTouchesCollision({
      taskGlobs: ["novel/tick-loop/**", "scripts/*.mjs"],
      openPrs,
    });
    expect(decision).toMatchObject({ verdict: "collision-prevented", prNumber: 1 });
  });

  it("returns proceed when openPrs is empty", () => {
    expect(decideTouchesCollision({ taskGlobs: ["novel/tick-loop/**"], openPrs: [] })).toEqual({
      verdict: "proceed",
    });
  });
});

describe("extractFilePathsFromFilesField", () => {
  it("extracts backtick-wrapped paths from a typical Files line", () => {
    const block = [
      "- [ ] `task-id` — desc",
      "  - **ID**: task-id",
      "  - **Files**: `novel/tick-loop/src/spawn-strategy.ts` (timeout opt + watchdog), `novel/tick-loop/src/spawn-strategy.test.ts` (paired tests), `scripts/self-diagnose.mjs` (new invariant).",
    ].join("\n");
    expect(extractFilePathsFromFilesField(block)).toEqual([
      "novel/tick-loop/src/spawn-strategy.ts",
      "novel/tick-loop/src/spawn-strategy.test.ts",
      "scripts/self-diagnose.mjs",
    ]);
  });

  it("dedupes and preserves first-seen order", () => {
    const block =
      "  - **Files**: `a/b.ts` (one), `a/b.ts` (one again), `c/d.mjs` (two), `c/d.mjs`.";
    expect(extractFilePathsFromFilesField(block)).toEqual(["a/b.ts", "c/d.mjs"]);
  });

  it("returns [] when no Files field is present", () => {
    const block = "- [ ] `t` — clean\n  - **ID**: t\n  - **Tags**: p0\n";
    expect(extractFilePathsFromFilesField(block)).toEqual([]);
  });

  it("ignores backtick-wrapped tokens that aren't path-shaped (no slash, no dot)", () => {
    // Identifiers in the field's prose like `claudePrintTimeoutFrequencyInvariant`
    // — code symbol, not a path. Must not pollute the path list.
    const block = "  - **Files**: `novel/x/y.ts` (`buildXyz`), `scripts/y.mjs` (`zzz`).";
    expect(extractFilePathsFromFilesField(block)).toEqual(["novel/x/y.ts", "scripts/y.mjs"]);
  });

  it("does not leak backticks from neighbouring fields", () => {
    // The Hypothesis field contains backticks too; only Files should be
    // parsed. Use a single-line Files field so the regex doesn't span
    // unrelated content.
    const block = [
      "- [ ] `t` — desc",
      "  - **Hypothesis**: do `x` then `novel/other/thing.ts` later.",
      "  - **Files**: `novel/here/this.ts` (purpose).",
      "  - **Risk**: low.",
    ].join("\n");
    expect(extractFilePathsFromFilesField(block)).toEqual(["novel/here/this.ts"]);
  });
});

describe("parseTouchesOrFiles", () => {
  it("prefers Touches when present", () => {
    const block = [
      "  - **Files**: `a/b.ts`, `c/d.ts`.",
      "  - **Touches**: novel/tick-loop/**, scripts/*.mjs",
    ].join("\n");
    expect(parseTouchesOrFiles(block)).toEqual(["novel/tick-loop/**", "scripts/*.mjs"]);
  });

  it("falls back to Files when Touches is absent", () => {
    const block = "  - **Files**: `a/b.ts` (purpose), `c/d.mjs` (other).";
    expect(parseTouchesOrFiles(block)).toEqual(["a/b.ts", "c/d.mjs"]);
  });

  it("returns [] when neither field is present", () => {
    expect(parseTouchesOrFiles("- [ ] `t` — clean\n  - **Tags**: p0\n")).toEqual([]);
  });
});
