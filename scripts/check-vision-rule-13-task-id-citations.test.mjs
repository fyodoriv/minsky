// @ts-check
import { describe, expect, it } from "vitest";
import {
  SIBLING_P0_IDS,
  checkVisionRule13Citations,
} from "./check-vision-rule-13-task-id-citations.mjs";

const allIds = SIBLING_P0_IDS;

function makeSection(/** @type {readonly string[]} */ ids) {
  const citations = ids.map((id) => `\`${id}\``).join(", ");
  return `
### 13. Security & privacy — second priority after performance

Some text here.

**Substrate cohesion.** Six sibling P0 tasks implement the minimum bar: ${citations}.

Sources: Saltzer & Schroeder 1975.

### 14. Some future rule
`;
}

describe("checkVisionRule13Citations", () => {
  it("passes when all 6 sibling IDs are backtick-cited in § 13", () => {
    const vision = makeSection([...allIds]);
    const { sectionFound, results } = checkVisionRule13Citations(vision);
    expect(sectionFound).toBe(true);
    for (const r of results) {
      expect(r.cited).toBe(true);
    }
  });

  it("fails when the section is missing entirely", () => {
    const vision = "# Vision\n\nNo rule 13 here.\n";
    const { sectionFound, results } = checkVisionRule13Citations(vision);
    expect(sectionFound).toBe(false);
    for (const r of results) {
      expect(r.cited).toBe(false);
    }
  });

  it("fails when one ID is missing from the section", () => {
    const missingId = "cloud-tier-external-security-audit-gate";
    const presentIds = allIds.filter((id) => id !== missingId);
    const vision = makeSection(presentIds);
    const { sectionFound, results } = checkVisionRule13Citations(vision);
    expect(sectionFound).toBe(true);
    const missingResult = results.find((r) => r.id === missingId);
    expect(missingResult?.cited).toBe(false);
    const presentResults = results.filter((r) => r.id !== missingId);
    for (const r of presentResults) {
      expect(r.cited).toBe(true);
    }
  });

  it("does not match an ID cited without backticks", () => {
    const id = "otel-no-pii-in-spans-lint";
    const vision = `### 13. Security & privacy\n\nText mentions ${id} without backticks.\n\n## Next\n`;
    const { results } = checkVisionRule13Citations(vision, [id]);
    expect(results[0]?.cited).toBe(false);
  });

  it("does not match IDs in sections after § 13", () => {
    const id = "supply-chain-hardening-lockfile-sbom-slsa";
    const vision = `### 13. Security & privacy\n\nNo citation here.\n\n### 14. Next rule\n\nMentions \`${id}\` only here.\n`;
    const { results } = checkVisionRule13Citations(vision, [id]);
    expect(results[0]?.cited).toBe(false);
  });

  it("exports SIBLING_P0_IDS with the canonical 6 IDs", () => {
    expect(SIBLING_P0_IDS).toHaveLength(6);
    expect(SIBLING_P0_IDS).toContain("secret-scanning-precommit-and-ci");
    expect(SIBLING_P0_IDS).toContain("cloud-tier-external-security-audit-gate");
  });
});
