// @ts-check
//
// Tests for check-supervisor-explicit-start.mjs — vision.md § rule #19
// (operator-explicit-start). The lint MUST detect every shape of an
// unprovenanced `launchctl bootstrap` or `systemctl --user enable --now`
// call outside the allowlisted paths, and MUST NOT false-positive on
// the legitimate gated paths (setup.sh's WITH_SUPERVISOR-gated loop,
// bin/minsky install-daemon, docs/comments).

import { describe, expect, test } from "vitest";

import {
  ALLOWED_PATHS,
  BANNED_PATTERNS,
  checkSupervisorExplicitStart,
} from "./check-supervisor-explicit-start.mjs";

describe("ALLOWED_PATHS — the explicit gate inventory", () => {
  test("each row has a non-empty rationale (so future maintainers see WHY)", () => {
    for (const row of ALLOWED_PATHS) {
      expect(row.rationale.length).toBeGreaterThan(10);
    }
  });

  test("setup.sh is allowlisted (WITH_SUPERVISOR-gated)", () => {
    expect(ALLOWED_PATHS.some((r) => r.pattern.test("setup.sh"))).toBe(true);
  });

  test("bin/minsky is allowlisted (install-daemon subcommand)", () => {
    expect(ALLOWED_PATHS.some((r) => r.pattern.test("bin/minsky"))).toBe(true);
  });

  test("the lint script and its tests are allowlisted (self-referential)", () => {
    expect(
      ALLOWED_PATHS.some((r) => r.pattern.test("scripts/check-supervisor-explicit-start.mjs")),
    ).toBe(true);
    expect(
      ALLOWED_PATHS.some((r) => r.pattern.test("scripts/check-supervisor-explicit-start.test.mjs")),
    ).toBe(true);
  });

  test("vision.md is allowlisted (rule #19 names the banned commands)", () => {
    expect(ALLOWED_PATHS.some((r) => r.pattern.test("vision.md"))).toBe(true);
  });

  test("docs/ is allowlisted (history, runbooks may discuss commands)", () => {
    expect(ALLOWED_PATHS.some((r) => r.pattern.test("docs/some-runbook.md"))).toBe(true);
    expect(ALLOWED_PATHS.some((r) => r.pattern.test("docs/security/supervisor-sandbox.md"))).toBe(
      true,
    );
  });

  test("an arbitrary new script is NOT allowlisted (default-deny)", () => {
    expect(ALLOWED_PATHS.some((r) => r.pattern.test("scripts/new-thing.mjs"))).toBe(false);
    expect(ALLOWED_PATHS.some((r) => r.pattern.test("bin/install-fleet"))).toBe(false);
  });
});

describe("BANNED_PATTERNS — what the lint catches", () => {
  test("matches `launchctl bootstrap gui/...`", () => {
    expect(BANNED_PATTERNS.some((re) => re.test('launchctl bootstrap gui/"$(id -u)" "$f"'))).toBe(
      true,
    );
  });

  test("matches `systemctl --user enable --now <unit>`", () => {
    expect(
      BANNED_PATTERNS.some((re) =>
        re.test("systemctl --user enable --now minsky-supervisor.target"),
      ),
    ).toBe(true);
  });

  test("does NOT match `launchctl bootout` (eviction is fine)", () => {
    expect(
      BANNED_PATTERNS.some((re) => re.test('launchctl bootout "gui/$(id -u)/com.minsky.daemon"')),
    ).toBe(false);
  });

  test("does NOT match `launchctl print` (read-only is fine)", () => {
    expect(BANNED_PATTERNS.some((re) => re.test("launchctl print gui/$(id -u)"))).toBe(false);
  });

  test("does NOT match `systemctl --user enable <unit>` alone (no --now)", () => {
    expect(BANNED_PATTERNS.some((re) => re.test("systemctl --user enable minsky.service"))).toBe(
      false,
    );
  });

  test("does NOT match `launchctl list` (introspection is fine)", () => {
    expect(BANNED_PATTERNS.some((re) => re.test("launchctl list | grep minsky"))).toBe(false);
  });
});

describe("checkSupervisorExplicitStart — pure function over injected files", () => {
  test("clean when no files contain banned patterns", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/foo.mjs", "novel/adapters/bar/src/index.ts"],
      readFile: () => "// nothing banned here\nexport const x = 1;\n",
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("fires when a non-allowlisted file contains `launchctl bootstrap`", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/new-fleet-installer.sh"],
      readFile: () =>
        '#!/usr/bin/env bash\nlaunchctl bootstrap gui/"$(id -u)" "$HOME/Library/LaunchAgents/foo.plist"\n',
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.path).toBe("scripts/new-fleet-installer.sh");
    expect(result.violations[0]?.match).toBe("launchctl bootstrap");
  });

  test("fires when a non-allowlisted file contains `systemctl --user enable --now`", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/auto-launch.sh"],
      readFile: () => "#!/bin/bash\nsystemctl --user enable --now my-daemon.service\n",
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.match).toBe("systemctl --user enable --now");
  });

  test("does NOT fire when the call lives in an allowlisted file (setup.sh)", () => {
    const result = checkSupervisorExplicitStart({
      files: ["setup.sh"],
      readFile: () =>
        '#!/bin/bash\nif [ "$WITH_SUPERVISOR" = "1" ]; then\n  launchctl bootstrap gui/"$(id -u)" "$f"\nfi\n',
    });
    expect(result.ok).toBe(true);
  });

  test("does NOT fire when the call lives in bin/minsky (install-daemon subcommand)", () => {
    const result = checkSupervisorExplicitStart({
      files: ["bin/minsky"],
      readFile: () => 'launchctl bootstrap "gui/$(id -u)" "$_plist"\n',
    });
    expect(result.ok).toBe(true);
  });

  test("does NOT fire on comment lines that mention the commands", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/comment-only.mjs"],
      readFile: () =>
        "// Run `launchctl bootstrap` to load the unit.\n// See `systemctl --user enable --now <name>`.\n",
    });
    expect(result.ok).toBe(true);
  });

  test("does NOT fire on bash `#` comments that mention the commands", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/bash-comment.sh"],
      readFile: () => "# launchctl bootstrap gui/...  (documentation only)\n",
    });
    expect(result.ok).toBe(true);
  });

  test("fires on multiple violations in one file", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/bad.sh"],
      readFile: () =>
        "launchctl bootstrap gui/foo bar\nsystemctl --user enable --now baz.service\n",
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  test("records 1-indexed line numbers", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/bad.sh"],
      readFile: () => "echo ok\necho ok\nlaunchctl bootstrap gui/foo bar\n",
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.line).toBe(3);
  });

  test("records the matched substring + the trimmed line content", () => {
    const result = checkSupervisorExplicitStart({
      files: ["scripts/bad.sh"],
      readFile: () => '    launchctl bootstrap "gui/$(id -u)" "$plist"\n',
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.match).toBe("launchctl bootstrap");
    expect(result.violations[0]?.content).toBe('launchctl bootstrap "gui/$(id -u)" "$plist"');
  });

  test("returns filesScanned count regardless of violations", () => {
    const result = checkSupervisorExplicitStart({
      files: ["a.mjs", "b.mjs", "c.mjs"],
      readFile: () => "",
    });
    expect(result.filesScanned).toBe(3);
  });
});

describe("checkSupervisorExplicitStart — real repo state (smoke)", () => {
  test("the real repo is clean today (post-fix baseline)", () => {
    // No injected files — walks the actual REPO_ROOT. This is the
    // CI gate's own production behavior: if a future PR adds an
    // unprovenanced call, this test fails before the PR can land.
    const result = checkSupervisorExplicitStart();
    if (!result.ok) {
      // Surface the violations in the assertion message so a failure
      // tells the author exactly what to fix.
      const summary = result.violations
        .map((v) => `${v.path}:${v.line}: ${v.match} — ${v.content}`)
        .join("\n");
      expect.fail(`rule-19 violations in repo:\n${summary}`);
    }
    expect(result.ok).toBe(true);
  });
});
