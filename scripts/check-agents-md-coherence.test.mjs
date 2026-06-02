// @ts-check
// Paired test for `scripts/check-agents-md-coherence.mjs`. Pure function tests
// — no filesystem, no network. The injection seam is `fileExists`, which we
// stub with a `Set<string>` per scenario.
//
// Anchor: `rule #3` (test-first); `rule #10` (deterministic enforcement —
// every branch of the decision function is pinned by a paired test);
// Meszaros 2007 (paired-fixture pattern for parametric cases).

import { describe, expect, it } from "vitest";

import {
  checkAgentsMdCoherence,
  extractRelativeLinks,
  extractVisionRuleCitations,
  extractVisionRuleNumbers,
  REQUIRED_SECTIONS,
} from "./check-agents-md-coherence.mjs";

const MIN_VISION_MD = `
# Vision

### 1. Foo
### 2. Bar
### 9. Pre-registered hypothesis-driven development
### 10. Deterministic enforcement
### 15. Match the operator's machine-utilisation budget
### 16. Default by default
### 17. Proactive healing
`;

function buildMinAgentsMd() {
  return [
    "# AGENTS.md",
    "",
    "Body intro.",
    "",
    ...REQUIRED_SECTIONS.map((s) => `${s.heading}\n\nBody.`),
    "",
    "See [vision.md](./vision.md) for the constitution.",
  ].join("\n");
}

describe("extractVisionRuleNumbers", () => {
  it("returns the set of `### N. ` heading numbers in vision.md", () => {
    expect(extractVisionRuleNumbers(MIN_VISION_MD)).toEqual(new Set([1, 2, 9, 10, 15, 16, 17]));
  });

  it("returns the empty set when vision.md has no numbered rules", () => {
    expect(extractVisionRuleNumbers("# Vision\n\nNo rules here.")).toEqual(new Set());
  });

  it("ignores `## N. ` (h2) and `#### N. ` (h4) — only h3 matches", () => {
    const md = "## 1. Foo\n#### 2. Bar\n### 3. Real rule";
    expect(extractVisionRuleNumbers(md)).toEqual(new Set([3]));
  });
});

describe("extractVisionRuleCitations", () => {
  it("captures every `vision.md § N` reference", () => {
    const md = "See vision.md § 9 and vision.md § 10. Also vision.md § 17.";
    expect(extractVisionRuleCitations(md)).toEqual([9, 10, 17]);
  });

  it("preserves duplicate citations", () => {
    expect(extractVisionRuleCitations("vision.md § 9 / vision.md § 9")).toEqual([9, 9]);
  });

  it("does not match `vision.md` without `§ N`", () => {
    expect(extractVisionRuleCitations("See vision.md for context.")).toEqual([]);
  });

  it("does not match other `.md § N` files", () => {
    expect(extractVisionRuleCitations("See foo.md § 9.")).toEqual([]);
  });
});

describe("extractRelativeLinks", () => {
  it("captures every relative markdown link", () => {
    const md = "[a](./vision.md) and [b](TASKS.md) and [c](docs/x.md)";
    expect(extractRelativeLinks(md)).toEqual(["./vision.md", "TASKS.md", "docs/x.md"]);
  });

  it("strips anchor fragments for existence check", () => {
    const md = "[a](./vision.md#cost-schedule)";
    expect(extractRelativeLinks(md)).toEqual(["./vision.md"]);
  });

  it("skips http(s) URLs", () => {
    const md = "[a](https://example.com) and [b](./vision.md)";
    expect(extractRelativeLinks(md)).toEqual(["./vision.md"]);
  });

  it("skips mailto: and pure-anchor links", () => {
    const md = "[a](mailto:x@y.z) and [b](#section) and [c](TASKS.md)";
    expect(extractRelativeLinks(md)).toEqual(["TASKS.md"]);
  });
});

describe("checkAgentsMdCoherence", () => {
  /**
   * @param {Set<string>} paths
   * @returns {(rel: string) => boolean}
   */
  const fileExistsFor = (paths) => (rel) => paths.has(rel);

  it("ok on a well-formed AGENTS.md", () => {
    const result = checkAgentsMdCoherence({
      agentsMd: buildMinAgentsMd(),
      visionMd: MIN_VISION_MD,
      fileExists: fileExistsFor(new Set(["./vision.md"])),
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when a required section is missing", () => {
    const broken = buildMinAgentsMd().replace("## Orchestrator discipline\n\nBody.", "");
    const result = checkAgentsMdCoherence({
      agentsMd: broken,
      visionMd: MIN_VISION_MD,
      fileExists: fileExistsFor(new Set(["./vision.md"])),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.kind).toBe("missing-section");
    expect(result.errors[0]?.message).toContain("Orchestrator discipline");
  });

  it("fails when a relative link doesn't resolve", () => {
    const md = `${buildMinAgentsMd()}\nAlso see [missing](./does-not-exist.md).`;
    const result = checkAgentsMdCoherence({
      agentsMd: md,
      visionMd: MIN_VISION_MD,
      fileExists: fileExistsFor(new Set(["./vision.md"])),
    });
    expect(result.ok).toBe(false);
    const broken = result.errors.filter((e) => e.kind === "broken-link");
    expect(broken).toHaveLength(1);
    expect(broken[0]?.message).toContain("./does-not-exist.md");
  });

  it("fails when a `vision.md § N` citation references a non-existent rule", () => {
    const md = `${buildMinAgentsMd()}\nSee vision.md § 99 for the missing rule.`;
    const result = checkAgentsMdCoherence({
      agentsMd: md,
      visionMd: MIN_VISION_MD,
      fileExists: fileExistsFor(new Set(["./vision.md"])),
    });
    expect(result.ok).toBe(false);
    const stale = result.errors.filter((e) => e.kind === "stale-vision-rule-ref");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.message).toContain("vision.md § 99");
  });

  it("dedupes duplicate stale citation errors", () => {
    const md = `${buildMinAgentsMd()}\nSee vision.md § 99 once. And vision.md § 99 twice. And vision.md § 99 thrice.`;
    const result = checkAgentsMdCoherence({
      agentsMd: md,
      visionMd: MIN_VISION_MD,
      fileExists: fileExistsFor(new Set(["./vision.md"])),
    });
    const stale = result.errors.filter((e) => e.kind === "stale-vision-rule-ref");
    expect(stale).toHaveLength(1);
  });

  it("aggregates multiple distinct errors", () => {
    const md = [
      "# AGENTS.md",
      "",
      "See [missing](./not-here.md).",
      "See vision.md § 42 and vision.md § 99.",
    ].join("\n");
    const result = checkAgentsMdCoherence({
      agentsMd: md,
      visionMd: MIN_VISION_MD,
      fileExists: fileExistsFor(new Set()),
    });
    expect(result.ok).toBe(false);
    // 3 required-section errors + 1 broken-link + 2 stale-vision-rule = 6
    expect(result.errors.length).toBeGreaterThanOrEqual(6);
    expect(result.errors.filter((e) => e.kind === "missing-section")).toHaveLength(3);
    expect(result.errors.filter((e) => e.kind === "broken-link")).toHaveLength(1);
    expect(result.errors.filter((e) => e.kind === "stale-vision-rule-ref")).toHaveLength(2);
  });

  it("a vision.md § N citation that points to a real rule passes", () => {
    const md = `${buildMinAgentsMd()}\nSee vision.md § 9 for HDD and vision.md § 17 for healing.`;
    const result = checkAgentsMdCoherence({
      agentsMd: md,
      visionMd: MIN_VISION_MD,
      fileExists: fileExistsFor(new Set(["./vision.md"])),
    });
    expect(result.ok).toBe(true);
  });
});
