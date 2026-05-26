/**
 * User-story 018 — "Clean uninstall" (M1.12).
 *
 * Substrate-level invariant test. The live end-to-end uninstall (install
 * + uninstall against a fixture host + count residue) is covered by
 * `test/integration/` (when `MINSKY_RUN_INTEGRATION=1` is set, the
 * same opt-in pattern as `worktree-isolation.test.ts`).
 *
 * This file pins the SUBSTRATE invariants of the uninstall surface:
 *   - `bin/minsky uninstall)` case branch exists
 *   - The subcommand supports `--force` (non-interactive operator flow)
 *   - The user-story has the required `## Metric` + `## Integration test`
 *     sections (alignment-gate surfaces)
 *
 * Hypothesis (rule #9): if the substrate invariants hold, the operator's
 * `bin/minsky uninstall --force` continues to work.
 * Success: every test below passes.
 * Pivot: if the test passes but operator-side uninstall leaves residue,
 * add the specific failure mode (e.g. new install effect without matching
 * uninstall) as a new invariant here.
 * Measurement: this file.
 * Anchor: Saltzer & Schroeder 1975 (least common mechanism — uninstall
 * is the inverse of install, must enumerate every install effect).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("user-story 018 — clean uninstall (M1.12) substrate", () => {
  test("bin/minsky exists and has the uninstall) case branch", () => {
    const binMinsky = readFileSync(join(REPO_ROOT, "bin/minsky"), "utf8");
    expect(binMinsky).toMatch(/^\s+uninstall\)/m);
  });

  test("uninstall) handler supports --force (non-interactive operator flow)", () => {
    const binMinsky = readFileSync(join(REPO_ROOT, "bin/minsky"), "utf8");
    // The `_force=1` capture sits inside the uninstall case branch.
    // We grep for it as evidence that --force is wired.
    expect(binMinsky).toMatch(/_force=1|--force/);
  });

  test("user-story 018 (this one) exists with the right milestone tag", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/018-clean-uninstall.md"), "utf8");
    expect(story).toMatch(/<!-- milestone: M1\.12 -->/);
  });

  test("user-story 018 has the required `## Metric` and `## Integration test` sections", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/018-clean-uninstall.md"), "utf8");
    expect(story).toMatch(/^## Metric/m);
    expect(story).toMatch(/^## Integration test/m);
  });

  test("minsky:stop pnpm alias exists (canonical pre-uninstall step)", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(packageJson.scripts).toHaveProperty("minsky:stop");
  });
});
