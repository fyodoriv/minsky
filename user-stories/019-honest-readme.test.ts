/**
 * User-story 019 — "Honest README in <5 min reading time" (M1.11).
 *
 * Substrate-level invariants for the README's shape. The load-bearing
 * 3-developer user test is gated on `readme-honest-3-developer-user-test`
 * (operator-driven, not auto-detectable). This file pins the structural
 * surfaces that the every-commit gate can check.
 *
 * Hypothesis (rule #9): if the README holds its 5-takeaway shape, the
 * 3-developer user test's p95 reading time stays ≤5 minutes.
 * Success: every test below passes; `check-readme-byte-budget.mjs`
 * stays green at the hard limit (11500 bytes).
 * Pivot: if the byte budget is too brittle (legitimate clarity addition
 * pushes past 11500), drop to a soft warning + a `Status:` field rather
 * than fake the metric. See user-stories/019-honest-readme.md § Pivot.
 * Measurement: this file.
 * Anchor: Krug 2014, *Don't Make Me Think* (5-second-test pattern
 * adapted to a 5-minute reading window).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("user-story 019 — honest README in <5 min (M1.11) substrate", () => {
  const readReadme = () => readFileSync(join(REPO_ROOT, "README.md"), "utf8");

  test("README exists and is non-empty", () => {
    const readme = readReadme();
    expect(readme.length).toBeGreaterThan(0);
  });

  test("README opens with a tagline (one-line `>` blockquote after the H1)", () => {
    const readme = readReadme();
    // First H1, then optionally blank line, then a `> ` blockquote.
    // The blockquote is the canonical tagline shape across the
    // reader-orientation doc frame.
    expect(readme).toMatch(/^# [^\n]+\n+>\s+\S+/m);
  });

  test("README documents an install path (npx minsky init / pnpm install / bin/minsky)", () => {
    const readme = readReadme();
    // Three canonical install paths today: the RC `npx minsky init`,
    // the manual `pnpm install` clone path, or the alias chain
    // `pnpm minsky:setup` / `bin/minsky setup`. At least one must
    // appear — the README is the install funnel.
    expect(readme).toMatch(
      /npx\s+(?:-y\s+)?minsky\s+init|pnpm\s+install|pnpm\s+minsky:setup|bin\/minsky\s+setup/,
    );
  });

  test("README documents a run path (minsky / bin/minsky / daemon start)", () => {
    const readme = readReadme();
    // `minsky` (PATH alias post-`npx init`), `bin/minsky` (manual),
    // or `minsky daemon start` — at least one must appear.
    expect(readme).toMatch(/\bminsky\b\s*\n|bin\/minsky\b|minsky\s+daemon\s+start/);
  });

  test("README links to MILESTONES.md (M1 progress takeaway)", () => {
    const readme = readReadme();
    expect(readme).toMatch(/MILESTONES\.md/);
  });

  test("README stays within the byte budget hard limit (≤11500 bytes)", () => {
    const readme = readReadme();
    // The hard limit comes from scripts/check-readme-byte-budget.mjs
    // (README_BYTE_BUDGET_HARD_LIMIT). Mirror it here so this test
    // fails AT THE SAME PR as the dedicated byte-budget gate.
    expect(readme.length).toBeLessThanOrEqual(11500);
  });

  test("user-story 019 (this one) exists with the right milestone tag", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/019-honest-readme.md"), "utf8");
    expect(story).toMatch(/<!-- milestone: M1\.11 -->/);
  });

  test("user-story 019 has the required `## Metric` and `## Integration test` sections", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/019-honest-readme.md"), "utf8");
    expect(story).toMatch(/^## Metric\b/m);
    expect(story).toMatch(/^## Integration test\b/m);
  });

  test("user-story 019 mentions M1.11 (so check-milestone-alignment matches it)", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/019-honest-readme.md"), "utf8");
    expect(story).toMatch(/\bM1\.11\b/);
  });
});
