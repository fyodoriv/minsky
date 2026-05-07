// @ts-check
import { describe, expect, it } from "vitest";
import { SIBLING_P0_IDS, checkSiblingAnchors } from "./check-rule-13-sibling-anchors.mjs";

const MINIMAL_BLOCK = (/** @type {string} */ id, /** @type {string} */ anchor) => `
- [ ] \`${id}\` — description
  - **ID**: ${id}
  - **Tags**: security, p0
  - **Anchor**: ${anchor}
  - **Risk**: low.
`;

describe("checkSiblingAnchors", () => {
  it("passes when all siblings have rule #13 in their Anchor lines", () => {
    const tasksMd = SIBLING_P0_IDS.map((id) =>
      MINIMAL_BLOCK(id, "rule #13 (vision.md § 13); rule #10 (det. enforcement)"),
    ).join("\n");
    const results = checkSiblingAnchors(tasksMd);
    expect(results).toHaveLength(SIBLING_P0_IDS.length);
    for (const r of results) {
      expect(r.found).toBe(true);
      expect(r.anchored).toBe(true);
    }
  });

  it("fails when a sibling task is missing from TASKS.md", () => {
    const tasksMd = "";
    const results = checkSiblingAnchors(tasksMd, ["secret-scanning-precommit-and-ci"]);
    expect(results[0]).toEqual({
      id: "secret-scanning-precommit-and-ci",
      found: false,
      anchored: false,
    });
  });

  it("fails when a sibling task Anchor does not cite rule #13", () => {
    const id = "otel-no-pii-in-spans-lint";
    const tasksMd = MINIMAL_BLOCK(id, "rule #10 (deterministic enforcement); GDPR Art. 25");
    const results = checkSiblingAnchors(tasksMd, [id]);
    expect(results[0]).toEqual({ id, found: true, anchored: false });
  });

  it("passes for 'rule #13' cited in various positions in the Anchor line", () => {
    const id = "otel-no-pii-in-spans-lint";
    const anchors = [
      "rule #13 (vision.md § 13 — security); OWASP",
      "OWASP; rule #13 (item 2); rule #7",
      "rule #13; Saltzer & Schroeder 1975",
    ];
    for (const anchor of anchors) {
      const tasksMd = MINIMAL_BLOCK(id, anchor);
      const results = checkSiblingAnchors(tasksMd, [id]);
      expect(results[0]?.anchored).toBe(true);
    }
  });

  it("handles the 5 open sibling IDs in SIBLING_P0_IDS (dashboard-localhost-only-by-default shipped and removed)", () => {
    expect(SIBLING_P0_IDS).toHaveLength(5);
    expect(SIBLING_P0_IDS).toContain("secret-scanning-precommit-and-ci");
    expect(SIBLING_P0_IDS).toContain("supervisor-sandbox-syscall-restriction");
    expect(SIBLING_P0_IDS).not.toContain("dashboard-localhost-only-by-default");
    expect(SIBLING_P0_IDS).toContain("otel-no-pii-in-spans-lint");
    expect(SIBLING_P0_IDS).toContain("supply-chain-hardening-lockfile-sbom-slsa");
    expect(SIBLING_P0_IDS).toContain("cloud-tier-external-security-audit-gate");
  });
});
