import { describe, expect, it } from "vitest";
import { checkAdditions } from "./check-rule-1-novel-justification.mjs";

const RESEARCH_WITH_FOO = `# Research

## When the existing tools didn't fit

### foo

Considered \`bar-cli\`, \`baz-runtime\` — neither modelled the X invariant.

## Other section

unrelated content
`;

const RESEARCH_EMPTY = `# Research

## How to read this file

content
`;

describe("checkAdditions", () => {
  it("flags a new novel/ package with no research.md entry and no opt-out", () => {
    const result = checkAdditions({
      added: ["novel/foo/src/index.ts", "novel/foo/README.md"],
      researchMd: RESEARCH_EMPTY,
      readReadme: () => null,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.pkg).toBe("foo");
  });

  it("passes when research.md has the package under the required heading", () => {
    const result = checkAdditions({
      added: ["novel/foo/src/index.ts"],
      researchMd: RESEARCH_WITH_FOO,
      readReadme: () => null,
    });
    expect(result.errors).toEqual([]);
  });

  it("passes when README has a rule-1 opt-out comment", () => {
    const optOut =
      "# foo\n\n<!-- rule-1: bar-cli rejected because: doesn't model the X invariant -->\n";
    const result = checkAdditions({
      added: ["novel/foo/src/index.ts"],
      researchMd: RESEARCH_EMPTY,
      readReadme: (pkg) => (pkg === "foo" ? optOut : null),
    });
    expect(result.errors).toEqual([]);
  });

  it("ignores novel/adapters/* additions (governed by rule #2)", () => {
    const result = checkAdditions({
      added: ["novel/adapters/bar/src/index.ts", "novel/adapters/bar/README.md"],
      researchMd: RESEARCH_EMPTY,
      readReadme: () => null,
    });
    expect(result.errors).toEqual([]);
  });

  it("returns no errors when no novel/ additions are present", () => {
    const result = checkAdditions({
      added: ["scripts/x.mjs", "README.md", "novel/adapters/bar/src/y.ts"],
      researchMd: RESEARCH_EMPTY,
      readReadme: () => null,
    });
    expect(result.errors).toEqual([]);
  });

  it("does not partial-match package names (foo must not match foobar)", () => {
    const researchWithFoobar = `## When the existing tools didn't fit\n\n### foobar\n\nconsidered alts\n`;
    const result = checkAdditions({
      added: ["novel/foo/src/index.ts"],
      researchMd: researchWithFoobar,
      readReadme: () => null,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.pkg).toBe("foo");
  });

  it("requires the mention to live inside the named section, not just anywhere", () => {
    const elsewhere = "# Research\n\n## Active dependencies\n\n### foo\n\ncontent\n";
    const result = checkAdditions({
      added: ["novel/foo/src/index.ts"],
      researchMd: elsewhere,
      readReadme: () => null,
    });
    expect(result.errors).toHaveLength(1);
  });

  it("deduplicates multiple files added under the same new package", () => {
    const result = checkAdditions({
      added: [
        "novel/foo/src/a.ts",
        "novel/foo/src/b.ts",
        "novel/foo/README.md",
        "novel/foo/package.json",
      ],
      researchMd: RESEARCH_EMPTY,
      readReadme: () => null,
    });
    expect(result.errors).toHaveLength(1);
  });

  it("reports multiple unjustified packages in sorted order", () => {
    const result = checkAdditions({
      added: ["novel/zeta/src/a.ts", "novel/alpha/src/b.ts"],
      researchMd: RESEARCH_EMPTY,
      readReadme: () => null,
    });
    expect(result.errors.map((e) => e.pkg)).toEqual(["alpha", "zeta"]);
  });

  it("rejects malformed opt-out comments missing the 'rejected because' clause", () => {
    const malformed = "# foo\n\n<!-- rule-1: bar-cli (no reason given) -->\n";
    const result = checkAdditions({
      added: ["novel/foo/src/index.ts"],
      researchMd: RESEARCH_EMPTY,
      readReadme: () => malformed,
    });
    expect(result.errors).toHaveLength(1);
  });
});
