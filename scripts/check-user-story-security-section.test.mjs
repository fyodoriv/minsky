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
  USER_STORY_PATHS,
  checkAllSecuritySections,
  checkSecuritySection,
  extractSecuritySection,
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
  ];
  return ["# Story", "", header, "", ...body, trailer].join("\n");
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
        lines: [
          "Some prose without the constitutional anchor.",
          "- bullet 1",
          "- bullet 2",
          "- bullet 3",
          "- bullet 4",
        ],
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
          lines: [
            `${variant} — second priority after performance.`,
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

  test("does not match `rule #130` or other suffixed numbers (word boundary on 13)", () => {
    const r = checkSecuritySection(
      fixtureUserStory({
        lines: [
          "rule #130 is a future rule that doesn't exist.",
          "- bullet 1",
          "- bullet 2",
          "- bullet 3",
          "- bullet 4",
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("rule #13"))).toBe(true);
  });

  test("aggregates multiple errors when both content-line floor and rule-#13 citation fail", () => {
    const r = checkSecuritySection(
      fixtureUserStory({
        lines: ["one line", "", "two lines"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(2);
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
