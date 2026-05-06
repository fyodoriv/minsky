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
    "Per constitutional rule #13 (STRIDE-shaped per Howard & LeBlanc 2003).",
    "",
    "- **Untrusted inputs**: stdin, env, file contents",
    "- **Trusted state**: pure functions only",
    "- **Trust boundary**: process boundary",
    "- **STRIDE focus**: **T**ampering — input validation",
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
            `${variant} methodology applied.`,
            "- bullet 1",
            "- bullet 2",
            "- bullet 3",
            "- bullet 4",
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
          "STRIDE-shaped per Howard & LeBlanc 2003.",
          "- **Untrusted inputs**: type-bounded only",
          "- **Trusted state**: pure functions",
          "- **Trust boundary**: type system",
          "- there is no STRIDE letter that applies directly to a pure leaf",
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  test("aggregates multiple errors when both content-line floor and STRIDE engagement fail", () => {
    const r = checkThreatModelSection(
      fixtureReadme({
        lines: ["one line", "", "two lines"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(2);
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

describe("real novel/*/README.md — the threat-model invariant on main", () => {
  test("all 16 constitutional novel package READMEs carry a STRIDE-shaped threat-model section", async () => {
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

  test("the hardcoded path list matches all top-level novel/* and novel/adapters/* READMEs", () => {
    expect(THREAT_MODEL_README_PATHS.length).toBe(16);
    const adapterCount = THREAT_MODEL_README_PATHS.filter((p) => p.includes("/adapters/")).length;
    expect(adapterCount).toBe(6);
    expect(THREAT_MODEL_README_PATHS.length - adapterCount).toBe(10);
  });
});
