// Tests for the pure function in check-rule-5-glossary-discipline.mjs.
// Pattern: deterministic lint over a behavioral specification (rule #10).
// Source: rule #5 + Aho-Sethi-Ullman 1986 (lexer); fixtures follow
//   xUnit Test Patterns (Meszaros 2007) — paired positive/negative.

import { describe, expect, test } from "vitest";

import { checkGlossaryDiscipline, parseAllowlist } from "./check-rule-5-glossary-discipline.mjs";

const GLOSSARY_HEADING = "## Glossary — every term has a CS anchor";

/** Build a minimal vision.md fixture wrapping a constitution body and a
 * glossary body. */
function buildVision({ constitution, glossary }) {
  return [
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
    "## What Minsky is not",
    "",
    "- not a framework",
    "",
  ].join("\n");
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
    // The candidate `WidgetEngine` appears ONLY inside the Glossary body —
    // the script must not extract it as a candidate from outside.
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
    expect(candidates).toEqual([]); // Glossary is not scanned for candidates
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
      constitution: "Coined: `PascalThing`, `camelThing`, `kebab-thing`, `dotted.thing`.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
    });
    const { missing } = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    // All four are coined-shaped and unresolved → all reported.
    expect(missing.sort()).toEqual(["PascalThing", "camelThing", "dotted.thing", "kebab-thing"]);
  });

  test("trailing slash on path-like backticked tokens is stripped before lookup", () => {
    // `competitors/` should be normalized to `competitors` for allowlist /
    // glossary lookup, otherwise paths-with-trailing-slash never resolve.
    const visionMd = buildVision({
      constitution: "See `competitors/` for the analyses.",
      glossary: "| Term in use | Anchor | Source |\n|---|---|---|\n",
    });
    const { missing } = checkGlossaryDiscipline({
      visionMd,
      allowlist: new Set(["competitors"]),
    });
    expect(missing).toEqual([]);
  });

  test("missing Glossary section is reported as glossarySectionMissing", () => {
    const visionMd = "# Vision\n\n## The constitution\n\nNo glossary here.\n";
    const result = checkGlossaryDiscipline({ visionMd, allowlist: new Set() });
    expect(result.glossarySectionMissing).toBe(true);
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
