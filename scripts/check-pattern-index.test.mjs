// @ts-check
// Tests for the pure function in check-pattern-index.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { checkPatternIndex, extractOptOutReason, isEligiblePath } from "./check-pattern-index.mjs";

const VISION_FIXTURE_WITH_NEWPKG = [
  "# vision",
  "",
  "## Pattern conformance index",
  "",
  "| # | Artifact | Pattern | Source | Conformance | Notes |",
  "|---|----------|---------|--------|-------------|-------|",
  "| 1 | `vision.md` | spec | Lamport 1983 | full | … |",
  "| 2 | `novel/widget/` (new pkg) | Adapter | Gamma 1994 | full | … |",
  "",
  "## Theoretical foundations",
  "",
  "(unrelated section)",
  "",
].join("\n");

const VISION_FIXTURE_NO_NEWPKG = [
  "# vision",
  "",
  "## Pattern conformance index",
  "",
  "| # | Artifact | Pattern | Source | Conformance | Notes |",
  "|---|----------|---------|--------|-------------|-------|",
  "| 1 | `vision.md` | spec | Lamport 1983 | full | … |",
  "",
  "## Theoretical foundations",
  "",
].join("\n");

describe("checkPatternIndex", () => {
  test("new artefact under novel/<pkg>/ without an index row → fails", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "novel/orphan/src/index.ts" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.path).toBe("novel/orphan/src/index.ts");
  });

  test("new artefact mentioned by package-path in the index → passes", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "novel/widget/src/index.ts" }],
      visionMdContent: VISION_FIXTURE_WITH_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(0);
  });

  test("new artefact with an opt-out reason → passes", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "novel/orphan/src/foo.ts" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map([["novel/orphan/src/foo.ts", "auto-generated lockfile-style artefact"]]),
    });
    expect(result.violations.length).toBe(0);
  });

  test("test fixture file (`*.test.ts`) is skipped (not eligible)", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "novel/orphan/src/foo.test.ts" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(0);
  });

  test("paths under node_modules are skipped (not eligible)", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "novel/orphan/node_modules/some-dep/index.js" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(0);
  });

  test("modification (status M) of an existing eligible file → skipped", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "M", path: "novel/orphan/src/foo.ts" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(0);
  });

  test("multiple new files: mixed pass/fail across novel and root markdown", () => {
    const result = checkPatternIndex({
      changedFiles: [
        { status: "A", path: "novel/widget/src/foo.ts" }, // mentioned → pass
        { status: "A", path: "novel/orphan/src/bar.ts" }, // unmentioned → fail
        { status: "A", path: "novel/widget/README.md" }, // package-path mentioned → pass
        { status: "A", path: "novel/orphan/src/foo.test.ts" }, // test → skipped
      ],
      visionMdContent: VISION_FIXTURE_WITH_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.path).toBe("novel/orphan/src/bar.ts");
  });

  test("opt-out for a non-eligible path is a no-op (no false positive)", () => {
    const result = checkPatternIndex({
      changedFiles: [
        { status: "A", path: "novel/orphan/src/foo.test.ts" }, // skipped anyway
      ],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map([["novel/orphan/src/foo.test.ts", "test file — irrelevant"]]),
    });
    expect(result.violations.length).toBe(0);
  });

  test("new root-level markdown (`FOO.md` at repo root) requires an index row", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "GOVERNANCE.md" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
  });

  test("new file under .github/workflows/ requires an index row", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: ".github/workflows/foo.yml" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
  });

  test("new file under distribution/ requires an index row", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "distribution/foo.sh" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
  });

  test("new file under bin/ requires an index row", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "bin/minsky-new-verb" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.path).toBe("bin/minsky-new-verb");
  });

  test("new file under skill-plugins/ requires an index row", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "skill-plugins/observer/minsky/SKILL.md" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.path).toBe("skill-plugins/observer/minsky/SKILL.md");
  });

  test("new top-level *.yaml manifest requires an index row", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "A", path: "Agentfile.yaml" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.path).toBe("Agentfile.yaml");
  });

  test("a deleted file (status D) is never an addition → skipped", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "D", path: "novel/orphan/src/foo.ts" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(0);
  });

  test("a renamed file (status R) is treated as a modification → skipped", () => {
    const result = checkPatternIndex({
      changedFiles: [{ status: "R", path: "novel/orphan/src/foo.ts" }],
      visionMdContent: VISION_FIXTURE_NO_NEWPKG,
      optOuts: new Map(),
    });
    expect(result.violations.length).toBe(0);
  });
});

describe("extractOptOutReason", () => {
  test("recognises the em-dash form", () => {
    const r = extractOptOutReason(
      "// some preamble\n<!-- pattern: not-applicable — generated lockfile -->\n// more code\n",
    );
    expect(r).toBe("generated lockfile");
  });

  test("recognises the ASCII `--` form", () => {
    const r = extractOptOutReason("<!-- pattern: not-applicable -- machine-generated artefact -->");
    expect(r).toBe("machine-generated artefact");
  });

  test("rejects an empty / whitespace reason", () => {
    expect(extractOptOutReason("<!-- pattern: not-applicable —    -->")).toBe(null);
  });

  test("rejects a reason shorter than 3 chars", () => {
    expect(extractOptOutReason("<!-- pattern: not-applicable — ok -->")).toBe(null);
    // 3 chars passes
    expect(extractOptOutReason("<!-- pattern: not-applicable — yep -->")).toBe("yep");
  });

  test("ignores opt-outs after line ~20 of the file", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `// line ${i}`);
    lines.push("<!-- pattern: not-applicable — too-far-down -->");
    expect(extractOptOutReason(lines.join("\n"))).toBe(null);
  });
});

describe("isEligiblePath", () => {
  test("classifies the documented path shapes correctly", () => {
    expect(isEligiblePath("novel/widget/src/foo.ts")).toBe(true);
    expect(isEligiblePath("setup.sh")).toBe(true);
    expect(isEligiblePath("VISION.md")).toBe(true);
    expect(isEligiblePath("distribution/systemd/foo.service")).toBe(true);
    expect(isEligiblePath(".github/workflows/ci.yml")).toBe(true);
    expect(isEligiblePath("bin/minsky")).toBe(true);
    expect(isEligiblePath("skill-plugins/observer/minsky/SKILL.md")).toBe(true);
    expect(isEligiblePath("Agentfile.yaml")).toBe(true);
    expect(isEligiblePath("novel/widget/src/foo.test.ts")).toBe(false);
    expect(isEligiblePath("novel/widget/__fixtures__/x.json")).toBe(false);
    expect(isEligiblePath("docs/foo.md")).toBe(false); // not root
    expect(isEligiblePath("docs/config.yaml")).toBe(false); // yaml not at root
    expect(isEligiblePath("Agentfile.yml")).toBe(false); // .yml is not .yaml
    expect(isEligiblePath("novel/widget/node_modules/dep/index.js")).toBe(false);
  });
});
