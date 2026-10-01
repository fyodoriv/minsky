/**
 * User-story 016 — "Default 8h transformation session" (M1.4 + M1.5).
 *
 * Substrate-level invariant test. The full end-to-end flow (bootstrap →
 * baseline → run → report against a fixture host) is covered by the bats
 * tests at `tests/minsky-run.bats` and by the operator-side dogfood
 * sessions; this file pins the SUBSTRATE that makes those higher tests
 * possible:
 *   - `bin/minsky-default-session.sh` orchestrator exists and exposes
 *     the documented flag surface (--baseline-only / --report-only /
 *     --no-bootstrap / --json / --max-hours)
 *   - `bin/minsky` has a `transform)` subcommand that forwards to
 *     `--transform` (the legacy flag-style path that lands on the
 *     orchestrator)
 *   - The four shipped composition pieces exist (rule #1 — orchestrator
 *     does no novel work; it just composes existing scripts):
 *     `scripts/baseline_metrics.py`, `scripts/minsky_report.py`,
 *     `scripts/transform_trend.py`, `scripts/transform_recommend.py`,
 *     `scripts/transform_knowledge.py`
 *   - `tests/minsky-run.bats` exists as the bash-tests CI gate's input
 *     (the gate enforces the seven scenarios listed in the user story's
 *     `## Integration test` section)
 *   - The user-story file itself has the required `## Metric` and
 *     `## Integration test` H2 sections (alignment-gate surfaces)
 *
 * If the substrate invariants regress (orchestrator deleted, a composed
 * script removed, the transform subcommand wired to the wrong path), we
 * catch the regression in <1s here rather than waiting for the bats
 * tests to timeout in CI or for an operator to type `minsky --transform`
 * and see a 127 exit code.
 *
 * Hypothesis (rule #9): substrate present + correctly wired → the
 *   operator's `minsky transform` continues to work end-to-end.
 * Success: every test below passes.
 * Pivot: if substrate stays green but the bats tests at
 *   `tests/minsky-run.bats` go red, the orchestrator's bash logic
 *   regressed (not the substrate shape) — add the specific failure mode
 *   to the bats suite, not here.
 * Measurement: this file.
 * Anchor: rule #1 (don't reinvent — the orchestrator composes existing
 *   tools; the substrate test verifies the composition seams are
 *   intact); Forsgren/Humble/Kim 2018 *Accelerate* — DORA's baseline →
 *   intervention → re-baseline loop is the named pattern the user
 *   story implements.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("user-story 016 — default 8h transformation session substrate", () => {
  test("bin/minsky-default-session.sh orchestrator exists", () => {
    expect(existsSync(join(REPO_ROOT, "bin/minsky-default-session.sh"))).toBe(true);
  });

  test("orchestrator exposes the documented flag surface", () => {
    const orchestrator = readFileSync(join(REPO_ROOT, "bin/minsky-default-session.sh"), "utf8");
    // All five operator-facing flags must appear in the script.
    expect(orchestrator).toMatch(/--max-hours\)/);
    expect(orchestrator).toMatch(/--report-only\)/);
    expect(orchestrator).toMatch(/--baseline-only\)/);
    expect(orchestrator).toMatch(/--no-bootstrap\)/);
    expect(orchestrator).toMatch(/--json\)/);
  });

  test("bin/minsky has a transform) subcommand wired to the orchestrator path", () => {
    const binMinsky = readFileSync(join(REPO_ROOT, "bin/minsky"), "utf8");
    // Subcommand form (canonical 2026-05-26 CLI overhaul).
    expect(binMinsky).toMatch(/^\s+transform\)/m);
    // The transform handler must forward to --transform (legacy flag) OR
    // directly invoke bin/minsky-default-session.sh. Both shapes count as
    // "wired to the orchestrator" — the user story doesn't pin which
    // dispatch path is used internally.
    expect(binMinsky).toMatch(/--transform|minsky-default-session\.sh/);
  });

  test("composed substrate scripts exist (rule #1 — orchestrator does no novel work)", () => {
    // The four scripts the orchestrator composes plus the three MAPE-K
    // analyse/plan pieces (Path A — orchestrator is pure composition).
    const composed = [
      "scripts/baseline_metrics.py",
      "scripts/minsky_report.py",
      "scripts/transform_trend.py",
      "scripts/transform_recommend.py",
      "scripts/transform_knowledge.py",
    ];
    for (const path of composed) {
      expect(existsSync(join(REPO_ROOT, path)), `${path} must exist`).toBe(true);
    }
  });

  test("tests/minsky-run.bats exists (bash-tests CI gate input)", () => {
    // The user story's `## Integration test` section names seven bats
    // scenarios at this path. We pin existence only — the scenario list
    // itself can evolve without invalidating the substrate.
    expect(existsSync(join(REPO_ROOT, "tests/minsky-run.bats"))).toBe(true);
  });

  test("user-story 016 has the required `## Metric` and `## Integration test` sections", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/016-default-8h-session.md"), "utf8");
    expect(story).toMatch(/^## Metric\b/m);
    expect(story).toMatch(/^## Integration test\b/m);
  });
});
