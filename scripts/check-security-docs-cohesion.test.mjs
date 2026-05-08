// Paired tests for `check-security-docs-cohesion.mjs`. Pattern: deterministic
// substrate-cohesion gate over `docs/security/*.md`. Tests follow Meszaros
// 2007 positive / negative fixture shape + a regression check that the live
// corpus on disk satisfies the invariants today (the property the gate is
// designed to preserve, not to introduce).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  SECURITY_DOCS_DIR,
  checkAllSecurityDocs,
  checkSecurityDoc,
  listSecurityDocs,
} from "./check-security-docs-cohesion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @param {{ rule13?: boolean, threatHeading?: boolean, stride?: boolean }} [opts]
 * @returns {string}
 */
function fixtureDoc({ rule13 = true, threatHeading = true, stride = true } = {}) {
  const lines = ["# Some security doc", ""];
  if (rule13) {
    lines.push(
      "Per [vision.md § 13](../../vision.md) (rule #13) this doc operationalises minimum-bar item N.",
      "",
    );
  } else {
    lines.push("This doc is unmoored from any constitutional rule.", "");
  }
  if (threatHeading) {
    lines.push("## Threat model", "");
    lines.push(stride ? "STRIDE-shaped per Howard & LeBlanc 2003." : "(no methodology cited)");
  } else if (stride) {
    lines.push("Some prose mentioning STRIDE without a heading.");
  } else {
    lines.push("Some prose with neither a heading nor a methodology citation.");
  }
  lines.push("");
  return lines.join("\n");
}

describe("checkSecurityDoc — pure-function paired fixtures", () => {
  test("passes a doc that cites rule #13 + carries a STRIDE-shaped threat-model heading", () => {
    const r = checkSecurityDoc(fixtureDoc(), "docs/security/example.md");
    expect(r.ok).toBe(true);
  });

  test("fails when the doc omits the rule #13 citation", () => {
    const r = checkSecurityDoc(fixtureDoc({ rule13: false }), "docs/security/example.md");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("rule #13"))).toBe(true);
  });

  test("fails when the doc has no `Threat model` heading", () => {
    const r = checkSecurityDoc(fixtureDoc({ threatHeading: false }), "docs/security/example.md");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("Threat model"))).toBe(true);
  });

  test("fails when the doc has no STRIDE methodology engagement", () => {
    const r = checkSecurityDoc(fixtureDoc({ stride: false }), "docs/security/example.md");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("STRIDE"))).toBe(true);
  });

  test("rule #13 match is case-insensitive and tolerates the `#` separator + spacing", () => {
    for (const variant of ["rule #13", "Rule #13", "RULE 13", "rule#13", "rule  # 13"]) {
      const doc = fixtureDoc({ rule13: false }).replace(
        "This doc is unmoored from any constitutional rule.",
        `Per ${variant} this doc binds in.`,
      );
      const r = checkSecurityDoc(doc, "docs/security/example.md");
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });

  test("`Threat model` heading match accepts H1–H6 and varying suffixes", () => {
    for (const heading of [
      "# Threat model",
      "## Threat model",
      "### Threat model and operator guide",
      "#### Threat model — STRIDE",
    ]) {
      const doc = ["# d", "", "rule #13 link.", "", heading, "", "STRIDE methodology."].join("\n");
      const r = checkSecurityDoc(doc, "docs/security/example.md");
      expect(r.ok, `heading: "${heading}"`).toBe(true);
    }
  });

  test("aggregates errors when multiple invariants fail at once", () => {
    const r = checkSecurityDoc(
      fixtureDoc({ rule13: false, threatHeading: false, stride: false }),
      "docs/security/example.md",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(3);
  });
});

describe("listSecurityDocs — directory enumeration", () => {
  test("returns all top-level *.md under docs/security/, sorted, prefixed", async () => {
    const paths = await listSecurityDocs(REPO_ROOT);
    expect(paths.length).toBeGreaterThanOrEqual(6);
    for (const p of paths) {
      expect(p.startsWith(`${SECURITY_DOCS_DIR}/`)).toBe(true);
      expect(p.endsWith(".md")).toBe(true);
    }
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });
});

describe("real docs/security/*.md — the security-doc corpus on main", () => {
  test("every operator-readable security doc on disk satisfies the cohesion invariants", async () => {
    const result = await checkAllSecurityDocs(REPO_ROOT);
    if (!result.ok) {
      throw new Error(
        `security-docs-cohesion violation:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
    expect(result.ok).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(6);
  });
});
