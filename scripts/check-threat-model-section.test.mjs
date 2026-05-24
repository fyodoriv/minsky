// Paired tests for `check-threat-model-section.mjs`. Pattern: deterministic
// gate over `novel/*/README.md` STRIDE-shaped threat-model sections (vision.md
// § 13.8). Tests follow the standard positive / negative fixture shape
// (Meszaros 2007).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  THREAT_MODEL_README_PATHS,
  checkAllThreatModelSections,
  checkThreatModelSection,
  extractThreatModelSection,
} from "./check-threat-model-section.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @param {{ header?: string, lines?: string[], trailer?: string }} [opts]
 * @returns {string}
 */
function fixtureReadme({
  header = "## Threat model",
  lines,
  trailer = "\n## Next section\n",
} = {}) {
  const body = lines ?? [
    "Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc 2003.",
    "",
    "- **Untrusted inputs**: stdin, env, file contents",
    "- **Trusted state**: pure functions only",
    "- **Trust boundary**: process boundary",
    "- **STRIDE focus**: **T**ampering — input validation",
    "- **Performance-first carve-out** (rule #13's relief valve): none declared.",
  ];
  return ["# Pkg", "", header, "", ...body, trailer].join("\n");
}

describe("checkThreatModelSection — pure-function paired fixtures", () => {
  test("passes a STRIDE-shaped section with ≥5 non-empty content lines", () => {
    const r = checkThreatModelSection(fixtureReadme());
    expect(r.ok).toBe(true);
  });

  test("fails when the `## Threat model` heading is absent", () => {
    const r = checkThreatModelSection("# Pkg\n\n## Other section\n\nbody\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("missing");
  });

  test("fails when the section has fewer than 5 non-empty content lines", () => {
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: ["STRIDE: stub.", "", "- only one bullet"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("non-empty content lines"))).toBe(true);
  });

  test("fails when the section omits STRIDE methodology by name", () => {
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: [
          "Some prose without the methodology name.",
          "- bullet 1",
          "- bullet 2",
          "- bullet 3",
          "- bullet 4",
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("STRIDE"))).toBe(true);
  });

  test("accepts STRIDE in any case (case-insensitive)", () => {
    for (const variant of ["STRIDE", "stride", "Stride", "STriDE"]) {
      const r = checkThreatModelSection(
        fixtureReadme({
          lines: [
            `Per vision.md § 13.8. ${variant} methodology applied.`,
            "- **Untrusted inputs**: stdin",
            "- **Trusted state**: pure",
            "- **Trust boundary**: process",
            "- **Performance-first carve-out**: none declared.",
          ],
        }),
      );
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });

  test("accepts an explicit no-STRIDE-applies declaration as long as STRIDE is named", () => {
    // Mirrors `novel/adapters/types/README.md` — pure leaf with no applicable
    // STRIDE letters but still cites the methodology.
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: [
          "Per vision.md § 13.8. STRIDE-shaped per Howard & LeBlanc 2003.",
          "- **Untrusted inputs**: type-bounded only",
          "- **Trusted state**: pure functions",
          "- **Trust boundary**: import-time only",
          "- there is no STRIDE letter that applies directly to a pure leaf",
          "- **Performance-first carve-out**: none declared.",
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  test("fails when the section omits the `performance-first carve-out` clause", () => {
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: [
          "STRIDE-shaped per Howard & LeBlanc 2003.",
          "- **Untrusted inputs**: stdin",
          "- **Trusted state**: pure functions",
          "- **Trust boundary**: process boundary",
          "- **STRIDE focus**: **T**ampering — input validation",
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("performance-first carve-out"))).toBe(true);
  });

  test("accepts the carve-out clause in any case (case-insensitive)", () => {
    for (const variant of [
      "Performance-first carve-out",
      "performance-first carve-out",
      "PERFORMANCE-FIRST CARVE-OUT",
    ]) {
      const r = checkThreatModelSection(
        fixtureReadme({
          lines: [
            "Per vision.md § 13.8. STRIDE-shaped per Howard & LeBlanc 2003.",
            "- **Untrusted inputs**: stdin",
            "- **Trusted state**: pure functions",
            "- **Trust boundary**: process boundary",
            "- **STRIDE focus**: **T**ampering",
            `- **${variant}**: none declared.`,
          ],
        }),
      );
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });

  test("aggregates multiple errors when every axis fails", () => {
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: ["one line", "", "two lines"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 7 axes: content-line floor + STRIDE + carve-out + Untrusted + Trusted +
    // Trust boundary + vision.md anchor.
    expect(r.errors.length).toBe(7);
  });

  test("fails when the section omits `Untrusted` (vision.md § 13.8 (a))", () => {
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: [
          "STRIDE-shaped per Howard & LeBlanc 2003.",
          "- **Inputs**: stdin",
          "- **Trusted state**: pure functions",
          "- **Trust boundary**: process boundary",
          "- **Performance-first carve-out**: none declared.",
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("Untrusted"))).toBe(true);
  });

  test("fails when the section omits `Trusted` standalone (only `Untrusted` is present)", () => {
    // Word-boundary requirement: `\bTrusted\b` must NOT be satisfied by the
    // substring inside `Untrusted`. The fixture below has `Untrusted` but no
    // standalone `Trusted` — the lint must still flag it.
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: [
          "STRIDE-shaped per Howard & LeBlanc 2003.",
          "- **Untrusted inputs**: stdin",
          "- **State**: pure functions",
          "- **Trust boundary**: process boundary",
          "- **Performance-first carve-out**: none declared.",
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("`Trusted`"))).toBe(true);
  });

  test("fails when the section omits `Trust boundary` (vision.md § 13.8 (c))", () => {
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: [
          "STRIDE-shaped per Howard & LeBlanc 2003.",
          "- **Untrusted inputs**: stdin",
          "- **Trusted state**: pure functions",
          "- **Boundary**: process boundary (no `trust` qualifier)",
          "- **Performance-first carve-out**: none declared.",
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("Trust boundary"))).toBe(true);
  });

  test("accepts the trust-triplet in any case (case-insensitive)", () => {
    for (const variant of ["UNTRUSTED", "untrusted", "Untrusted"]) {
      const trustedVariant = variant.toLowerCase() === "untrusted" ? "TRUSTED" : "Trusted";
      const boundaryVariant = variant === "UNTRUSTED" ? "TRUST BOUNDARY" : "trust boundary";
      const r = checkThreatModelSection(
        fixtureReadme({
          lines: [
            "Per vision.md § 13.8. STRIDE-shaped per Howard & LeBlanc 2003.",
            `- **${variant} inputs**: stdin`,
            `- **${trustedVariant} state**: pure functions`,
            `- **${boundaryVariant}**: process boundary`,
            "- **Performance-first carve-out**: none declared.",
          ],
        }),
      );
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });

  test("fails when the section omits `vision.md` anchor (only `rule #13` survives via carve-out)", () => {
    // Negative case: the canonical "Per constitutional rule #13 (vision.md
    // § 13.8). …" opening line is dropped, but the carve-out clause keeps a
    // bare `rule #13` reference. Without pinning `vision.md`, the lint would
    // miss the silent anchor-line drop because `rule #13` still appears.
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: [
          "STRIDE-shaped per Howard & LeBlanc 2003.",
          "- **Untrusted inputs**: stdin",
          "- **Trusted state**: pure functions",
          "- **Trust boundary**: process boundary",
          "- **STRIDE focus**: **T**ampering",
          "- **Performance-first carve-out** (rule #13's relief valve): none declared.",
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("vision.md"))).toBe(true);
  });

  test("accepts the `vision.md` anchor in any case (case-insensitive)", () => {
    for (const variant of ["vision.md", "VISION.MD", "Vision.md"]) {
      const r = checkThreatModelSection(
        fixtureReadme({
          lines: [
            `Per constitutional rule #13 (${variant} § 13.8). STRIDE-shaped per Howard & LeBlanc 2003.`,
            "- **Untrusted inputs**: stdin",
            "- **Trusted state**: pure functions",
            "- **Trust boundary**: process boundary",
            "- **Performance-first carve-out**: none declared.",
          ],
        }),
      );
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });
});

describe("extractThreatModelSection — section slicer", () => {
  test("slices the body between `## Threat model` and the next `## ` header", () => {
    const text = [
      "# Pkg",
      "",
      "## Threat model",
      "",
      "body line",
      "",
      "## Other",
      "",
      "other body",
    ].join("\n");
    const out = extractThreatModelSection(text);
    expect(out).not.toBeNull();
    expect(out).toContain("body line");
    expect(out).not.toContain("other body");
  });

  test("returns null when no `## Threat model` heading is present", () => {
    expect(extractThreatModelSection("# Pkg\n\nbody\n")).toBeNull();
  });

  test("returns the rest of the file when the section is the last one", () => {
    const text = ["# Pkg", "", "## Threat model", "", "trailing body"].join("\n");
    const out = extractThreatModelSection(text);
    expect(out).not.toBeNull();
    expect(out).toContain("trailing body");
  });

  test("does not match similar-but-different headers", () => {
    const text = ["## Threat models (plural)", "", "body"].join("\n");
    expect(extractThreatModelSection(text)).toBeNull();
  });
});

describe("checkAllThreatModelSections — multi-file aggregation", () => {
  test("flags missing files distinctly from content failures", () => {
    const contents = new Map([
      [THREAT_MODEL_README_PATHS[0] ?? "", fixtureReadme()],
      // remaining paths absent
    ]);
    const results = checkAllThreatModelSections(contents);
    expect(results.length).toBe(THREAT_MODEL_README_PATHS.length);
    expect(results[0]?.result.ok).toBe(true);
    const missing = results.slice(1);
    for (const { result } of missing) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0]).toContain("file missing");
    }
  });
});

describe("real novel/**/README.md — the threat-model invariant on main", () => {
  test("all 18 constitutional novel package READMEs carry a STRIDE-shaped threat-model section", async () => {
    /** @type {Map<string, string>} */
    const contents = new Map();
    for (const rel of THREAT_MODEL_README_PATHS) {
      contents.set(rel, await readFile(resolve(REPO_ROOT, rel), "utf8"));
    }
    const results = checkAllThreatModelSections(contents);
    const failures = results.filter((r) => !r.result.ok);
    if (failures.length > 0) {
      const lines = failures.flatMap(({ path, result }) =>
        result.ok ? [] : result.errors.map((e) => `  - ${path}: ${e}`),
      );
      throw new Error(`threat-model-section violation:\n${lines.join("\n")}`);
    }
    expect(failures.length).toBe(0);
  });

  test("the hardcoded path list covers top-level novel/* and novel/adapters/* READMEs", () => {
    // Phase 9 (Path A aggressive cut) deleted the `novel/bridges/`
    // namespace + `novel/handoff-spec/`, dropping 3 paths from the list
    // (was 18, now 15). The composition is now 9 top-level + 6 adapters.
    expect(THREAT_MODEL_README_PATHS.length).toBe(15);
    const adapterCount = THREAT_MODEL_README_PATHS.filter((p) => p.includes("/adapters/")).length;
    expect(adapterCount).toBe(6);
    const bridgeSubpkgCount = THREAT_MODEL_README_PATHS.filter((p) =>
      p.startsWith("novel/bridges/"),
    ).length;
    expect(bridgeSubpkgCount).toBe(0);
    expect(THREAT_MODEL_README_PATHS.length - adapterCount - bridgeSubpkgCount).toBe(9);
  });
});
