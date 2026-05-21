// @ts-check
// Paired test for `check-no-personal-paths-in-docs.mjs`.
//
// Covers the 4 rules + the opt-out comment + the bin/minsky shell-comment
// scoping. Pure-function input/output — no filesystem touching here.

import { describe, expect, it } from "vitest";
import { checkNoPersonalPathsInDocs } from "./check-no-personal-paths-in-docs.mjs";

describe("checkNoPersonalPathsInDocs", () => {
  it("passes on clean docs", () => {
    const files = new Map([
      ["README.md", "Install to `<minsky-repo>` and run.\n"],
      ["docs/foo.md", "Configure via `$MINSKY_REPO/config.json`.\n"],
    ]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toEqual([]);
  });

  it("catches ~/apps/tooling/ (rule 1 — personal layout)", () => {
    const files = new Map([["README.md", "Clone to ~/apps/tooling/minsky and run.\n"]]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("personal-layout");
    expect(violations[0]?.match).toBe("~/apps/tooling/");
    expect(violations[0]?.line).toBe(1);
  });

  it("catches literal `fivanishche` (rule 2 — literal username)", () => {
    const files = new Map([["docs/notes.md", "Reported by fivanishche on the original install\n"]]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("literal-username");
    expect(violations[0]?.match).toBe("fivanishche");
  });

  it("catches /Users/<any-user>/ (rule 3 — mac user path)", () => {
    const files = new Map([["TASKS.md", "Anchor at /Users/cbrwizard/apps/minsky/config.json\n"]]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("user-absolute-path");
    expect(violations[0]?.match).toBe("/Users/cbrwizard");
  });

  it("catches /home/<user>/ (rule 4 — linux user path)", () => {
    const files = new Map([["docs/foo.md", "Set up at /home/alice/code/minsky\n"]]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("user-absolute-path");
    expect(violations[0]?.match).toBe("/home/alice");
  });

  it("allowlists common runtime users in /home/ (ubuntu / runner / root)", () => {
    const files = new Map([
      ["docs/ci.md", "On CI under /home/runner/work/ the gate runs.\n"],
      ["docs/docker.md", "Use /home/ubuntu/ as the WORKDIR.\n"],
      ["docs/root.md", "Inside a container at /home/root/.\n"],
    ]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toEqual([]);
  });

  it("honors same-line opt-out comments (markdown / shell / js)", () => {
    const files = new Map([
      [
        "docs/a.md",
        "Clone to ~/apps/tooling/minsky <!-- not-personal: example layout in docs -->\n",
      ],
      ["bin/minsky", "# Falls back to ~/apps/tooling/minsky # not-personal: legacy install\n"],
      [
        "bin/minsky",
        "# Recommended layout is /Users/alice/code/minsky // not-personal: api docs\n",
      ],
    ]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toEqual([]);
  });

  it("for bin/minsky, only checks lines starting with `#` (comments)", () => {
    const files = new Map([
      [
        "bin/minsky",
        [
          "#!/bin/bash",
          "# Comment with leak: /Users/alice",
          "FALLBACKS=( ~/apps/tooling/minsky )", // executable code — should NOT trip the linter
          "echo /Users/alice/code", // executable code — should NOT trip
        ].join("\n"),
      ],
    ]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    // Only the comment-line leak should be caught
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.match).toBe("/Users/alice");
  });

  it("reports the exact line number and content", () => {
    const files = new Map([
      [
        "TASKS.md",
        ["## P0", "", "- [ ] Some task", "  - **Anchor**: /Users/cbrwizard/minsky/file.ts"].join(
          "\n",
        ),
      ],
    ]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.match).toBe("/Users/cbrwizard");
    expect(violations[0]?.content).toContain("Anchor");
  });

  it("catches multiple violations per file", () => {
    const files = new Map([
      [
        "docs/big.md",
        [
          "First leak: ~/apps/tooling/minsky/foo",
          "Second leak: /Users/alice/bar",
          "Third leak: fivanishche the maintainer",
        ].join("\n"),
      ],
    ]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toHaveLength(3);
  });

  it("truncates long lines to 200 characters in the report", () => {
    const longLine = "Prefix ".concat("x".repeat(300), " /Users/alice/code");
    const files = new Map([["docs/long.md", longLine]]);
    const { violations } = checkNoPersonalPathsInDocs({ files });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.content.length).toBeLessThanOrEqual(201);
    expect(violations[0]?.content.endsWith("…")).toBe(true);
  });
});
