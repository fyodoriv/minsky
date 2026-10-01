// @ts-check
import { describe, expect, it } from "vitest";
import { checkDocWhyFirstParagraph, hasWhyParagraph } from "./check-doc-why-first-paragraph.mjs";

describe("hasWhyParagraph", () => {
  it("matches 'This file is the runbook'", () => {
    expect(hasWhyParagraph("# Title\n\nThis file is the runbook for X.")).toBe(true);
  });

  it("matches 'This document describes'", () => {
    expect(hasWhyParagraph("# Title\n\nThis document describes the architecture.")).toBe(true);
  });

  it("matches 'This doc covers'", () => {
    expect(hasWhyParagraph("# Title\n\nThis doc covers the install flow.")).toBe(true);
  });

  it("matches 'The canonical runbook for X'", () => {
    expect(hasWhyParagraph("# Title\n\nThe canonical runbook for agents.")).toBe(true);
  });

  it("matches 'Overview of the system'", () => {
    expect(hasWhyParagraph("# Title\n\nOverview of the system.")).toBe(true);
  });

  it("matches a leading blockquote (often a 'why' tagline)", () => {
    expect(hasWhyParagraph("# Title\n\n> The constitution.\n")).toBe(true);
  });

  it("fails on a generic opening with no why-phrase", () => {
    expect(hasWhyParagraph("# Title\n\nFooBar is great. We use it.")).toBe(false);
  });

  it("skips YAML frontmatter", () => {
    const text = "---\nschema: v1\n---\n\n# Title\n\nThis document is the spec.";
    expect(hasWhyParagraph(text)).toBe(true);
  });

  it("skips multiple headings before finding the prose", () => {
    const text = "# H1\n\n## H2\n\n### H3\n\nThis file explains the wire protocol.";
    expect(hasWhyParagraph(text)).toBe(true);
  });

  it("uses up to 3 paragraphs of grace (e.g. README starts with badges)", () => {
    const text = "# Title\n\n![badge](url)\n\n![another](url)\n\nThis document is the entry point.";
    expect(hasWhyParagraph(text)).toBe(true);
  });

  it("real CARDINAL_DOCS pass (smoke)", () => {
    const result = checkDocWhyFirstParagraph();
    expect(result.ok).toBe(true);
  });
});

describe("checkDocWhyFirstParagraph", () => {
  it("skips files that don't exist (optional cardinal docs)", () => {
    const result = checkDocWhyFirstParagraph({
      repoRoot: "/repo",
      fileExists: () => false,
      readText: () => "",
    });
    expect(result.ok).toBe(true);
  });

  it("flags a doc with no why-phrase", () => {
    const result = checkDocWhyFirstParagraph({
      repoRoot: "/repo",
      fileExists: (p) => p === "/repo/vision.md",
      readText: () => "# Vision\n\nGeneric prose with no why signal.",
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/vision\.md/);
  });

  it("passes a doc with a why-phrase in first paragraph", () => {
    const result = checkDocWhyFirstParagraph({
      repoRoot: "/repo",
      fileExists: (p) => p === "/repo/vision.md",
      readText: () => "# Vision\n\nThis document is the constitution.",
    });
    expect(result.ok).toBe(true);
  });
});
