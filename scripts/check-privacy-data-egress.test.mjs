// Paired tests for `check-privacy-data-egress.mjs`. Pattern: deterministic
// gate over the privacy-by-default operator doc (vision.md § 13 minimum-bar
// item 7). Tests follow Meszaros 2007 positive / negative fixture shape.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  checkPrivacyDataEgress,
  PRIVACY_DATA_EGRESS_PATH,
  REQUIRED_DESTINATIONS,
  REQUIRED_SECTIONS,
} from "./check-privacy-data-egress.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @param {{ sections?: string[], destinations?: string[], stride?: boolean, gdpr?: boolean }} [opts]
 * @returns {string}
 */
function fixtureDoc({
  sections = [...REQUIRED_SECTIONS],
  destinations = [...REQUIRED_DESTINATIONS],
  stride = true,
  gdpr = true,
} = {}) {
  /** @type {Record<string, string[]>} */
  const bodyForSection = {
    "## Threat model": [
      stride ? "STRIDE-shaped per Howard & LeBlanc 2003." : "(no methodology cited)",
    ],
    "## Egress allow-list": destinations.map((d) => `- ${d}: hostname pinned`),
    "## Sources": [gdpr ? "GDPR Article 25 (data protection by design)." : "(no privacy anchor)"],
  };
  const out = ["# Privacy by default", ""];
  for (const section of sections) {
    const body = bodyForSection[section] ?? ["(body)"];
    out.push(section, "", ...body, "");
  }
  return out.join("\n");
}

describe("checkPrivacyDataEgress — pure-function paired fixtures", () => {
  test("passes a doc with all sections, destinations, STRIDE, and GDPR Art. 25", () => {
    const r = checkPrivacyDataEgress(fixtureDoc());
    expect(r.ok).toBe(true);
  });

  test("fails when a required H2 section is missing", () => {
    const r = checkPrivacyDataEgress(
      fixtureDoc({ sections: REQUIRED_SECTIONS.filter((s) => s !== "## Verification") }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("Verification"))).toBe(true);
  });

  test("fails when sections appear out of order", () => {
    // Swap Threat model and Sources; cursor-based matcher should not find
    // the canonical order.
    const reordered = [
      "## Sources",
      "## Egress allow-list",
      "## Operator opt-out matrix",
      "## Performance-first carve-out",
      "## Verification",
      "## Threat model",
    ];
    const r = checkPrivacyDataEgress(fixtureDoc({ sections: reordered }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("out-of-order"))).toBe(true);
  });

  test("fails when an enumerated egress destination is missing", () => {
    const r = checkPrivacyDataEgress(
      fixtureDoc({ destinations: REQUIRED_DESTINATIONS.filter((d) => d !== "ntfy.sh") }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("ntfy.sh"))).toBe(true);
  });

  test("fails when the doc omits STRIDE engagement", () => {
    const r = checkPrivacyDataEgress(fixtureDoc({ stride: false }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("STRIDE"))).toBe(true);
  });

  test("fails when the doc omits the GDPR Article 25 anchor", () => {
    const r = checkPrivacyDataEgress(fixtureDoc({ gdpr: false }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("GDPR Article 25"))).toBe(true);
  });

  test("aggregates multiple errors when several invariants fail at once", () => {
    const r = checkPrivacyDataEgress(
      fixtureDoc({
        sections: REQUIRED_SECTIONS.filter((s) => s !== "## Sources"),
        destinations: REQUIRED_DESTINATIONS.filter((d) => d !== "Anthropic API"),
        stride: false,
        gdpr: false,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Sources missing implicitly drops the GDPR anchor in our fixture too,
    // so we expect at least 3 distinct errors (Sources H2, Anthropic dest,
    // STRIDE, GDPR).
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  test("STRIDE check is case-insensitive", () => {
    for (const variant of ["STRIDE", "stride", "Stride"]) {
      const doc = fixtureDoc({ stride: false }).replace(
        "(no methodology cited)",
        `${variant} methodology applied`,
      );
      const r = checkPrivacyDataEgress(doc);
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });
});

describe("real docs/security/privacy-data-egress.md — the privacy invariant on main", () => {
  test("the doc shipped in PR #310 satisfies all rule #13.7 invariants", async () => {
    const text = await readFile(resolve(REPO_ROOT, PRIVACY_DATA_EGRESS_PATH), "utf8");
    const result = checkPrivacyDataEgress(text);
    if (!result.ok) {
      throw new Error(
        `privacy-data-egress violation:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  test("the required-sections list pins exactly six H2 headings", () => {
    expect(REQUIRED_SECTIONS.length).toBe(6);
  });

  test("the required-destinations list pins five enumerated egress destinations", () => {
    expect(REQUIRED_DESTINATIONS.length).toBe(5);
  });
});
