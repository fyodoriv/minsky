// Paired tests for `check-user-story-security-section.mjs`. Pattern:
// deterministic gate over `user-stories/00*.md` `## Security & privacy`
// sections (vision.md § 13 + TASKS.md `security-privacy-priority-substrate`
// acceptance criterion #2). Tests follow the standard positive / negative
// fixture shape (Meszaros 2007).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  checkAllSecuritySections,
  checkSecuritySection,
  extractSecuritySection,
  REQUIRED_BULLETS,
  USER_STORY_PATHS,
} from "./check-user-story-security-section.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @param {{ header?: string, lines?: string[], trailer?: string }} [opts]
 * @returns {string}
 */
function fixtureUserStory({
  header = "## Security & privacy",
  lines,
  trailer = "\n## Next section\n",
} = {}) {
  const body = lines ?? [
    "Operator directive 2026-05-06 — vision.md rule #13.",
    "",
    "- **Trust boundary**: untrusted inputs vs. trusted state",
    "- **Secrets**: no API keys in PR bodies or logs",
    "- **PII**: no email/IP in OTEL spans",
    "- **Sandbox**: filesystem reach restricted to repo root",
    "- **Performance carve-out**: silent trade-offs forbidden",
  ];
  return ["# Story", "", header, "", ...body, trailer].join("\n");
}

/**
 * Body lines that satisfy all 5 canonical bullets — used when the test wants
 * to isolate a non-bullet failure mode (e.g., line-floor or rule-#13 citation)
 * without dragging the bullet checks into the assertion.
 *
 * @returns {string[]}
 */
function canonicalBulletLines() {
  return REQUIRED_BULLETS.map((label) => `- **${label}**: substantive content`);
}

describe("checkSecuritySection — pure-function paired fixtures", () => {
  test("passes a rule-#13-cited section with ≥5 non-empty content lines", () => {
    const r = checkSecuritySection(fixtureUserStory());
    expect(r.ok).toBe(true);
  });

  test("fails when the `## Security & privacy` heading is absent", () => {
    const r = checkSecuritySection("# Story\n\n## Other section\n\nbody\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("missing");
  });

  test("fails when the section has fewer than 5 non-empty content lines", () => {
    const r = checkSecuritySection(
      fixtureUserStory({
        lines: ["rule #13: stub.", "", "- only one bullet"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("non-empty content lines"))).toBe(true);
  });

  test("fails when the section omits a `rule #13` citation", () => {
    const r = checkSecuritySection(
      fixtureUserStory({
        lines: ["Some prose without the constitutional anchor.", ...canonicalBulletLines()],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("rule #13"))).toBe(true);
  });

  test("accepts `rule #13` in any case and with optional whitespace around the hash", () => {
    for (const variant of ["rule #13", "Rule #13", "RULE #13", "rule#13", "rule # 13"]) {
      const r = checkSecuritySection(
        fixtureUserStory({
          lines: [`${variant} — second priority after performance.`, ...canonicalBulletLines()],
        }),
      );
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });

  test("does not match `rule #130` or other suffixed numbers (word boundary on 13)", () => {
    const r = checkSecuritySection(
      fixtureUserStory({
        lines: ["rule #130 is a future rule that doesn't exist.", ...canonicalBulletLines()],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("rule #13"))).toBe(true);
  });

  test("aggregates errors when both the line floor AND every canonical bullet are absent", () => {
    const r = checkSecuritySection(
      fixtureUserStory({
        lines: ["one line", "", "two lines"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // line-floor + rule-#13 + 5 missing bullets = 7 errors.
    expect(r.errors.length).toBe(2 + REQUIRED_BULLETS.length);
  });

  describe("canonical bullet shape — REQUIRED_BULLETS pin", () => {
    test("fails when the canonical `Performance carve-out` bullet is missing", () => {
      const r = checkSecuritySection(
        fixtureUserStory({
          lines: [
            "rule #13 anchored.",
            "- **Trust boundary**: …",
            "- **Secrets**: …",
            "- **PII**: …",
            "- **Sandbox**: …",
          ],
        }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.includes("Performance carve-out"))).toBe(true);
    });

    test("fails when every canonical bullet is missing — surfaces all 5 errors at once", () => {
      const r = checkSecuritySection(
        fixtureUserStory({
          lines: [
            "rule #13 anchored.",
            "- prose bullet 1",
            "- prose bullet 2",
            "- prose bullet 3",
            "- prose bullet 4",
          ],
        }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.length).toBe(REQUIRED_BULLETS.length);
      for (const label of REQUIRED_BULLETS) {
        expect(r.errors.some((e) => e.includes(label))).toBe(true);
      }
    });

    test("accepts a `*` bullet marker (alternative Markdown style)", () => {
      const r = checkSecuritySection(
        fixtureUserStory({
          lines: [
            "rule #13 anchored.",
            ...REQUIRED_BULLETS.map((label) => `* **${label}**: substantive content`),
          ],
        }),
      );
      expect(r.ok).toBe(true);
    });

    test("does NOT match `**Performance**` (must be the full canonical label)", () => {
      // Defensive: a future rewrite that drops the `carve-out` qualifier should
      // be flagged, not silently accepted via partial-prefix match.
      const r = checkSecuritySection(
        fixtureUserStory({
          lines: [
            "rule #13 anchored.",
            "- **Trust boundary**: …",
            "- **Secrets**: …",
            "- **PII**: …",
            "- **Sandbox**: …",
            "- **Performance**: missing the carve-out qualifier",
          ],
        }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.includes("Performance carve-out"))).toBe(true);
    });
  });
});

describe("extractSecuritySection — section slicer", () => {
  test("slices the body between `## Security & privacy` and the next `## ` header", () => {
    const text = [
      "# Story",
      "",
      "## Security & privacy",
      "",
      "body line",
      "",
      "## Other",
      "",
      "other body",
    ].join("\n");
    const out = extractSecuritySection(text);
    expect(out).not.toBeNull();
    expect(out).toContain("body line");
    expect(out).not.toContain("other body");
  });

  test("returns null when no `## Security & privacy` heading is present", () => {
    expect(extractSecuritySection("# Story\n\nbody\n")).toBeNull();
  });

  test("returns the rest of the file when the section is the last one", () => {
    const text = ["# Story", "", "## Security & privacy", "", "trailing body with rule #13"].join(
      "\n",
    );
    const out = extractSecuritySection(text);
    expect(out).not.toBeNull();
    expect(out).toContain("trailing body");
  });

  test("does not match similar-but-different headers", () => {
    const text = ["## Security and privacy (and-shape)", "", "body"].join("\n");
    expect(extractSecuritySection(text)).toBeNull();
  });
});

describe("checkAllSecuritySections — multi-file aggregation", () => {
  test("flags missing files distinctly from content failures", () => {
    const contents = new Map([
      [USER_STORY_PATHS[0] ?? "", fixtureUserStory()],
      // remaining paths absent
    ]);
    const results = checkAllSecuritySections(contents);
    expect(results.length).toBe(USER_STORY_PATHS.length);
    expect(results[0]?.result.ok).toBe(true);
    const missing = results.slice(1);
    for (const { result } of missing) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0]).toContain("file missing");
    }
  });
});

describe("real user-stories/*.md — the security-privacy-section invariant on main", () => {
  test("all 6 constitutional user stories carry a rule-#13-anchored security & privacy section", async () => {
    /** @type {Map<string, string>} */
    const contents = new Map();
    for (const rel of USER_STORY_PATHS) {
      contents.set(rel, await readFile(resolve(REPO_ROOT, rel), "utf8"));
    }
    const results = checkAllSecuritySections(contents);
    const failures = results.filter((r) => !r.result.ok);
    if (failures.length > 0) {
      const lines = failures.flatMap(({ path, result }) =>
        result.ok ? [] : result.errors.map((e) => `  - ${path}: ${e}`),
      );
      throw new Error(`user-story-security-section violation:\n${lines.join("\n")}`);
    }
    expect(failures.length).toBe(0);
  });
});
