// @ts-check
import { describe, expect, it } from "vitest";
import {
  MIN_CONTENT_LINES,
  STRIDE_KEYWORDS,
  checkReadme,
  extractThreatModelSection,
} from "./check-threat-model-section.mjs";

const VALID_SECTION = `
## Threat model

STRIDE methodology (Shostack 2014).

- **Spoofing**: a malicious TASKS.md could impersonate a valid task; mitigated by schema validation.
- **Tampering**: an adversary modifies EXPERIMENT.yaml in transit; mitigated by git integrity.
- **Repudiation**: the spawn produces no audit trail; mitigated by OTEL spans per iteration.
- **Information Disclosure**: a span carries API key; mitigated by otel-no-pii-in-spans-lint.
- **Denial of Service**: a runaway spawn exhausts budget; mitigated by BudgetGuard circuit-break.
- **Elevation of Privilege**: sandboxed spawn attempts disallowed read; mitigated by OS sandbox.
`;

const VALID_README = `# Package\n\nSome content.\n${VALID_SECTION}\n## Other section\n\nOther.\n`;

describe("extractThreatModelSection", () => {
  it("returns body for a well-formed threat model section", () => {
    const body = extractThreatModelSection(VALID_README);
    expect(body).not.toBeNull();
    expect(body).toContain("STRIDE");
  });

  it("returns null when no threat model section exists", () => {
    const readme = "# Package\n\nNo threat model here.\n";
    expect(extractThreatModelSection(readme)).toBeNull();
  });

  it("stops extraction at the next ## heading", () => {
    const body = extractThreatModelSection(VALID_README);
    expect(body).not.toContain("## Other section");
  });

  it("is case-insensitive for the section heading", () => {
    const readme = "# Package\n\n## THREAT MODEL\n\nSome STRIDE content.\n";
    expect(extractThreatModelSection(readme)).not.toBeNull();
  });
});

describe("checkReadme", () => {
  it("passes a well-formed threat model section", () => {
    const r = checkReadme("/fake/README.md", VALID_README);
    expect(r.sectionFound).toBe(true);
    expect(r.strideOk).toBe(true);
    expect(r.lengthOk).toBe(true);
    expect(r.contentLines).toBeGreaterThanOrEqual(MIN_CONTENT_LINES);
  });

  it("returns sectionFound=false when section is absent", () => {
    const r = checkReadme("/fake/README.md", "# Package\n\nNo threat model.\n");
    expect(r.sectionFound).toBe(false);
    expect(r.strideOk).toBe(false);
    expect(r.lengthOk).toBe(false);
  });

  it("fails when no STRIDE keyword is present", () => {
    const readme = "# Package\n\n## Threat model\n\nLine 1.\nLine 2.\nLine 3.\nLine 4.\nLine 5.\n";
    const r = checkReadme("/fake/README.md", readme);
    expect(r.sectionFound).toBe(true);
    expect(r.strideOk).toBe(false);
    expect(r.lengthOk).toBe(true);
  });

  it("fails when fewer than MIN_CONTENT_LINES non-empty lines", () => {
    const readme = "# Package\n\n## Threat model\n\nSpoofing: short.\n\n";
    const r = checkReadme("/fake/README.md", readme);
    expect(r.sectionFound).toBe(true);
    expect(r.strideOk).toBe(true);
    expect(r.lengthOk).toBe(false);
    expect(r.contentLines).toBeLessThan(MIN_CONTENT_LINES);
  });

  it("accepts 'STRIDE' keyword alone as sufficient", () => {
    const lines = Array.from({ length: MIN_CONTENT_LINES }, (_, i) => `Line ${i + 1}.`);
    const readme = `# P\n\n## Threat model\n\nSTRIDE approach.\n${lines.join("\n")}\n`;
    const r = checkReadme("/fake/README.md", readme);
    expect(r.strideOk).toBe(true);
  });
});

describe("STRIDE_KEYWORDS", () => {
  it("contains the six STRIDE components plus STRIDE itself", () => {
    expect(STRIDE_KEYWORDS).toContain("Spoofing");
    expect(STRIDE_KEYWORDS).toContain("Tampering");
    expect(STRIDE_KEYWORDS).toContain("Repudiation");
    expect(STRIDE_KEYWORDS).toContain("Information Disclosure");
    expect(STRIDE_KEYWORDS).toContain("Denial of Service");
    expect(STRIDE_KEYWORDS).toContain("Elevation of Privilege");
    expect(STRIDE_KEYWORDS).toContain("STRIDE");
  });
});
