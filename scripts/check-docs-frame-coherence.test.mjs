// @ts-check
// Paired tests for scripts/check-docs-frame-coherence.mjs. Pin the
// 3-beat detection (tagline / What-this-is / What-this-is-not) and
// the allowlist contract (silently pass docs not in the list).
//
// Anchor: docs/PRACTICES.md § Unified reader-orientation doc frame;
// PR #685; rule #10 (deterministic enforcement).

import { describe, expect, it } from "vitest";

import {
  checkAllowlist,
  checkContent,
  DOCS_FRAME_ALLOWLIST,
  hasH1Tagline,
  hasWhatThisIs,
  hasWhatThisIsNot,
} from "./check-docs-frame-coherence.mjs";

const CONFORMANT_DOC = `# Some Doc

> A tagline ≤12 words explaining the doc's job.

## What this file is

- Bullet naming what the doc covers.

## What this file is not

- Bullet pointing the reader at the OTHER doc that would answer their question.
`;

describe("hasH1Tagline", () => {
  it("matches H1 followed by a blockquote tagline", () => {
    expect(hasH1Tagline("# Title\n\n> tagline here\n")).toBe(true);
  });

  it("matches H1 followed by immediate blockquote (no blank line)", () => {
    expect(hasH1Tagline("# Title\n> tagline\n")).toBe(true);
  });

  it("rejects H1 without a blockquote", () => {
    expect(hasH1Tagline("# Title\n\nSome prose.\n")).toBe(false);
  });

  it("rejects a blockquote without an H1 above it", () => {
    expect(hasH1Tagline("> orphan tagline\n")).toBe(false);
  });
});

describe("hasWhatThisIs", () => {
  it("matches `## What this is`", () => {
    expect(hasWhatThisIs("\n## What this is\n\nBullets.")).toBe(true);
  });

  it("matches `## What this file is`", () => {
    expect(hasWhatThisIs("\n## What this file is\n\nBullets.")).toBe(true);
  });

  it("does NOT match `## What this is not` (the inverse heading)", () => {
    expect(hasWhatThisIs("\n## What this is not\n\nBullets.")).toBe(false);
  });

  it("does NOT match `## What this file is not`", () => {
    expect(hasWhatThisIs("\n## What this file is not\n\nBullets.")).toBe(false);
  });
});

describe("hasWhatThisIsNot", () => {
  it("matches `## What this is not`", () => {
    expect(hasWhatThisIsNot("\n## What this is not\n\nBullets.")).toBe(true);
  });

  it("matches `## What this file is not`", () => {
    expect(hasWhatThisIsNot("\n## What this file is not\n\nBullets.")).toBe(true);
  });

  it("does NOT match `## What this is`", () => {
    expect(hasWhatThisIsNot("\n## What this is\n\nBullets.")).toBe(false);
  });
});

describe("checkContent — 3-beat conformance", () => {
  it("returns empty for a fully conformant doc", () => {
    expect(checkContent(CONFORMANT_DOC)).toEqual([]);
  });

  it("flags missing tagline", () => {
    const noTagline = CONFORMANT_DOC.replace(
      "> A tagline ≤12 words explaining the doc's job.\n\n",
      "",
    );
    const missing = checkContent(noTagline);
    expect(missing.some((m) => m.includes("tagline"))).toBe(true);
  });

  it("flags missing `## What this is` section", () => {
    const noWhatIs = CONFORMANT_DOC.replace(
      "## What this file is\n\n- Bullet naming what the doc covers.\n\n",
      "",
    );
    const missing = checkContent(noWhatIs);
    expect(missing.some((m) => m.includes("`## What this is`"))).toBe(true);
  });

  it("flags missing `## What this is not` section", () => {
    const noIsNot = CONFORMANT_DOC.replace(
      "## What this file is not\n\n- Bullet pointing the reader at the OTHER doc that would answer their question.\n",
      "",
    );
    const missing = checkContent(noIsNot);
    expect(missing.some((m) => m.includes("is not"))).toBe(true);
  });

  it("flags ALL THREE beats missing when given a bare H1", () => {
    expect(checkContent("# Just an H1\n").length).toBe(3);
  });
});

describe("checkAllowlist — file-level walk", () => {
  it("passes when every allowlisted file conforms", () => {
    const violations = checkAllowlist(["foo.md", "bar.md"], () => CONFORMANT_DOC);
    expect(violations).toEqual([]);
  });

  it("flags a file whose read returns null (missing on disk)", () => {
    const violations = checkAllowlist(["gone.md"], () => null);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("gone.md");
    expect(violations[0]?.missing).toEqual(["FILE MISSING ON DISK"]);
  });

  it("flags violations per-file with the specific missing beat", () => {
    const noIsNot = CONFORMANT_DOC.replace(
      "## What this file is not\n\n- Bullet pointing the reader at the OTHER doc that would answer their question.\n",
      "",
    );
    const violations = checkAllowlist(["broken.md"], () => noIsNot);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("broken.md");
    expect(violations[0]?.missing.some((m) => m.includes("is not"))).toBe(true);
  });

  it("silently passes a doc not in the allowlist (correct behavior)", () => {
    // Caller only passes docs they want guarded — the lint doesn't
    // discover docs it should guard. The PRACTICES.md rule documents
    // which docs SHOULD be in the allowlist; this function only
    // verifies the input list.
    const violations = checkAllowlist([], () => "");
    expect(violations).toEqual([]);
  });
});

describe("live allowlist (sanity)", () => {
  it("exports a non-empty allowlist", () => {
    expect(DOCS_FRAME_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it("allowlist entries are repo-relative paths to existing files", () => {
    // The actual disk read is in the CLI; the allowlist itself is a
    // string array. This test pins the SHAPE (no leading slash, no
    // ./ prefix) to keep entries consistent with the rest of the
    // lint stack's conventions.
    for (const entry of DOCS_FRAME_ALLOWLIST) {
      expect(entry).not.toMatch(/^\.\//);
      expect(entry).not.toMatch(/^\//);
      expect(entry.length).toBeGreaterThan(0);
    }
  });
});
