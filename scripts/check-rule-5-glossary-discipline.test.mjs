// Tests for the pure function in check-rule-5-glossary-discipline.mjs.
// Pattern: deterministic lint over a behavioral specification (rule #10).
// Source: rule #5 + Aho-Sethi-Ullman 1986 (lexer); fixtures follow
//   xUnit Test Patterns (Meszaros 2007) — paired positive/negative.

import { describe, expect, test } from "vitest";

import {
  checkGlossaryDiscipline,
  harvestPatternIndexTokens,
  parseAllowlist,
} from "./check-rule-5-glossary-discipline.mjs";

const GLOSSARY_HEADING = "## Glossary — every term has a CS anchor";
const PATTERN_INDEX_HEADING = "## Pattern conformance index";

/** Build a minimal vision.md fixture wrapping a constitution body and a
 * glossary body. Optional pattern-index body.
 *
 * @param {{ constitution: string, glossary: string, patternIndex?: string }} input
 * @returns {string}
 */
function buildVision({ constitution, glossary, patternIndex }) {
  const parts = [
    "# Vision",
    "",
    "## The constitution",
    "",
    constitution,
    "",
    GLOSSARY_HEADING,
    "",
    glossary,
    "",
  ];
  if (patternIndex !== undefined) {
    parts.push(PATTERN_INDEX_HEADING, "", patternIndex, "");
  }
  parts.push("## What Minsky is not", "", "- not a framework", "");
  return parts.join("\n");
}

describe("checkGlossaryDiscipline", () => {
  test("(a) backticked FrobnicatorLoop without a Glossary entry → 1 missing", () => {
    const visionMd = buildVision({
      constitution: "We use a `FrobnicatorLoop` to coordinate ticks.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n| Tick | period | Liu 2000 |",
    });
    const { missing } = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    expect(missing).toEqual(["FrobnicatorLoop"]);
  });

  test("(b) same fixture WITH Glossary entry → 0 missing", () => {
    const visionMd = buildVision({
      constitution: "We use a `FrobnicatorLoop` to coordinate ticks.",
      glossary:
        "| Term in use | Anchor | Source |\n|---|---|---|\n" +
        "| FrobnicatorLoop | feedback loop | Wiener 1948 |",
    });
    const { missing } = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    expect(missing).toEqual([]);
  });

  test("(c) allowlisted standard term (OTEL) used in prose → 0 missing", () => {
    const visionMd = buildVision({
      constitution: "Every component reports to `OTEL`.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n| Tick | period | Liu 2000 |",
    });
    const { missing } = checkGlossaryDiscipline({
      visionMd,
      allowlist: new Set(["OTEL"]),
    });
    expect(missing).toEqual([]);
  });

  test("(d) backticked term used inside the Glossary section is not double-reported", () => {
    const visionMd = buildVision({
      constitution: "Plain prose with no coined identifiers.",
      glossary:
        "| Term in use | Anchor | Source |\n|---|---|---|\n" +
        "| `WidgetEngine` | example anchor | Lamport 1983 |",
    });
    const { missing, candidates } = checkGlossaryDiscipline({
      visionMd,
      allowlist: new Set(),
    });
    expect(missing).toEqual([]);
    expect(candidates).toEqual([]);
  });

  test("(e) common English in backticks like `if` is filtered as non-identifier", () => {
    const visionMd = buildVision({
      constitution: "Use `if` and `else` and `null` in code.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
    });
    const { missing, candidates } = checkGlossaryDiscipline({
      visionMd,
      allowlist: new Set(),
    });
    expect(missing).toEqual([]);
    expect(candidates).toEqual([]);
  });

  test("PascalCase / camelCase / kebab-case are all extracted as coined-shaped", () => {
    const visionMd = buildVision({
      constitution: "Coined: `PascalThing`, `camelThing`, `kebab-thing`.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
    });
    const { missing } = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    expect(missing.sort()).toEqual(["PascalThing", "camelThing", "kebab-thing"]);
  });

  test("file paths (containing `/`) are NOT extracted as coined terms", () => {
    const visionMd = buildVision({
      constitution: "See `novel/adapters` and `user-stories/001.md` for examples.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
    });
    const { missing, candidates } = checkGlossaryDiscipline({
      visionMd,
      allowlist: new Set(),
    });
    expect(missing).toEqual([]);
    expect(candidates).toEqual([]);
  });

  test("filenames (ending in .md/.ts/.sh/.yaml/.json) are NOT extracted", () => {
    const visionMd = buildVision({
      constitution: "Read `vision.md`, `setup.sh`, `pnpm-lock.yaml`, `tsconfig.json`, `parse.ts`.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
    });
    const { missing, candidates } = checkGlossaryDiscipline({
      visionMd,
      allowlist: new Set(),
    });
    expect(missing).toEqual([]);
    expect(candidates).toEqual([]);
  });

  test("dotted-method tokens (`foo.bar`) are NOT extracted as coined terms", () => {
    const visionMd = buildVision({
      constitution:
        "Calls like `trace.setGlobalTracerProvider` and `obj.method` are not coined terms.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
    });
    const { missing, candidates } = checkGlossaryDiscipline({
      visionMd,
      allowlist: new Set(),
    });
    expect(missing).toEqual([]);
    expect(candidates).toEqual([]);
  });

  test("Pattern-index artifact tokens resolve a candidate (rule #8 anchor satisfies rule #5)", () => {
    const visionMd = buildVision({
      constitution: "We use a `WidgetCog` to drive ticks.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
      patternIndex: [
        "| # | Artifact | Pattern | Source | Conformance | Notes |",
        "|---|---|---|---|---|---|",
        "| 1 | `@minsky/widget` (`WidgetCog` driver) | Watchdog | Liu 2000 | full | — |",
      ].join("\n"),
    });
    const { missing } = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    expect(missing).toEqual([]);
  });

  test("Pattern-index header / separator rows are not mistaken for artifact rows", () => {
    // The header row has cells like `# | Artifact | Pattern …`. The separator
    // row `|---|---|…` must not contribute tokens. Only data rows contribute.
    const visionMd = buildVision({
      constitution: "Coined: `WidgetCog`.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
      patternIndex: [
        "| # | Artifact | Pattern | Source | Conformance | Notes |",
        "|---|---|---|---|---|---|",
        // No data rows: WidgetCog is unresolved.
      ].join("\n"),
    });
    const { missing } = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    expect(missing).toEqual(["WidgetCog"]);
  });

  test("missing Glossary section is reported as glossarySectionMissing", () => {
    const visionMd = "# Vision\n\n## The constitution\n\nNo glossary here.\n";
    const result = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    expect(result.glossarySectionMissing).toBe(true);
  });
});

describe("harvestPatternIndexTokens", () => {
  test("extracts identifiers from artifact column of data rows only", () => {
    const indexBody = [
      "| # | Artifact | Pattern | Source | Conformance | Notes |",
      "|---|---|---|---|---|---|",
      "| 1 | `BudgetGuard` watchdog + `decide()` function | Watchdog | Liu 2000 | full | — |",
      "| 2 | `@minsky/handoff-spec` parser | Recursive-descent | Aho 1986 | full | — |",
    ].join("\n");
    const tokens = harvestPatternIndexTokens(indexBody);
    expect(tokens.has("BudgetGuard")).toBe(true);
    expect(tokens.has("decide")).toBe(true);
    // `@minsky/handoff-spec` contributes the path-shape `minsky/handoff-spec`
    // (the `@` is not part of an identifier-start). That's fine — it's a
    // valid resolution token even though such tokens are not extracted as
    // *candidates* (paths are filtered in harvestCandidates).
    expect(tokens.has("minsky/handoff-spec")).toBe(true);
    // The Pattern column ("Watchdog") must not bleed into the artifact set.
    expect(tokens.has("Watchdog")).toBe(false);
  });

  test("non-table lines are ignored", () => {
    const indexBody = [
      "Some prose before the table.",
      "",
      "| # | Artifact | Pattern | Source | Conformance | Notes |",
      "|---|---|---|---|---|---|",
      "| 1 | `Foo` | Bar | Baz | full | — |",
      "",
      "Some prose after the table.",
    ].join("\n");
    const tokens = harvestPatternIndexTokens(indexBody);
    expect(tokens.has("Foo")).toBe(true);
    expect(tokens.has("prose")).toBe(false);
  });
});

describe("parseAllowlist", () => {
  test("ignores blank lines and `#` comments, supports inline comments", () => {
    const text = [
      "# top-of-file comment",
      "",
      "OTEL",
      "  HTTP  ",
      "JSON # inline justification",
      "",
      "# trailing comment",
      "API",
    ].join("\n");
    const parsed = parseAllowlist(text);
    expect([...parsed].sort()).toEqual(["API", "HTTP", "JSON", "OTEL"]);
  });

  test("empty file yields empty set", () => {
    expect(parseAllowlist("").size).toBe(0);
    expect(parseAllowlist("# only a comment\n").size).toBe(0);
  });
});
