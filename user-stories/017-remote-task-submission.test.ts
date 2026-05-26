/**
 * User-story 017 — "Remote task submission" (M1.8).
 *
 * Substrate-level invariant test. The full remote-submission surface
 * (`bin/minsky submit-finding`) is open; this file pins the CURRENT
 * substrate that makes the future surface possible:
 *   - `bin/minsky` exists (the dispatcher will host the subcommand)
 *   - `scripts/self-diagnose.mjs` has invariants whose findings would
 *     be the input to remote-submission
 *   - `gh` CLI is a tracked dependency (the eventual `gh pr create`
 *     call goes through it)
 *
 * Until the operator-facing subcommand lands, this test guards the
 * SUBSTRATE — if it regresses (e.g. spawn dispatcher disappears,
 * self-diagnose invariants get removed), we catch immediately rather
 * than waiting for an operator to need the surface.
 *
 * Hypothesis (rule #9): substrate present + invariants present → the
 * remote-submission surface can be added in <100 LoC.
 * Success: every test below passes.
 * Pivot: if the substrate stays green for ≥6 months but the actual
 * subcommand is never written, the FEATURE has no demand — retire the
 * user-story (rule #9 pivot — abandon the approach, not just the test).
 * Measurement: this file.
 * Anchor: Conway 1968 (system structure mirrors org structure — remote-
 * submission IS the org-distributed-discovery surface); rule #10
 * (deterministic substrate invariants).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("user-story 017 — remote task submission (M1.8) substrate", () => {
  test("bin/minsky exists (the dispatcher hosts the future submit-finding subcommand)", () => {
    expect(existsSync(join(REPO_ROOT, "bin/minsky"))).toBe(true);
  });

  test("scripts/self-diagnose.mjs has invariants whose findings would be remote-submission inputs", () => {
    const selfDiagnose = readFileSync(join(REPO_ROOT, "scripts/self-diagnose.mjs"), "utf8");
    // daemon-task-id-staleness and daemon-pr-stuck-dirty are the canonical
    // inputs to a remote-submission flow: "I noticed X about Minsky, file it
    // as a task for the daemon".
    expect(selfDiagnose).toMatch(/daemon-task-id-staleness/);
    expect(selfDiagnose).toMatch(/daemon-pr-stuck-dirty/);
  });

  test("user-story 017 (this one) exists with the right milestone tag", () => {
    const story = readFileSync(
      join(REPO_ROOT, "user-stories/017-remote-task-submission.md"),
      "utf8",
    );
    expect(story).toMatch(/<!-- milestone: M1\.8 -->/);
  });

  test("user-story 017 has the required `## Metric` and `## Integration test` sections", () => {
    const story = readFileSync(
      join(REPO_ROOT, "user-stories/017-remote-task-submission.md"),
      "utf8",
    );
    expect(story).toMatch(/^## Metric/m);
    expect(story).toMatch(/^## Integration test/m);
  });
});
