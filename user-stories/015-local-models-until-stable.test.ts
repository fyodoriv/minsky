/**
 * User-story 015 — "Local models until the daemon is stable" (M1.1).
 *
 * Substrate-level invariant test. The full live-spawn proof against
 * `ollama_chat/qwen3-coder:30b` (envelope: `{"agent":"openhands","sdk_version":"1.7.0","files_changed":1,"diff_bytes":20,"ok":true}`)
 * already shipped in PR #786; the contract test referenced by the
 * user story (`test/contract/local-models-default.test.ts`) is the
 * end-to-end gate. This file pins the SUBSTRATE that holds the
 * operator stance ("local models are THE path, not a fallback") in
 * place:
 *   - `scripts/measure-stability.mjs` exists and exports the three
 *     documented threshold constants (`DEFAULT_GATE_THRESHOLD = 0.9`,
 *     `KEEP_ACTIVE_FLOOR = 0.6`, `DEFAULT_WINDOW_DAYS = 7`) — the
 *     gate-measurement contract the user story makes
 *   - `MINSKY_STABILITY_GATE_THRESHOLD` env override is honored
 *     (operator escape hatch per the Risk § "90% threshold is
 *     operator-chosen" mitigation)
 *   - `scripts/measure-stability.test.mjs` exists as the paired
 *     unit tests for the constants and bucketing
 *   - `scripts/stability-number.mjs` exists as the one source of
 *     truth for clean-exit fraction (read by `measure-stability`)
 *   - `novel/adapters/agent-runtime-openhands/src/spawner.ts`
 *     references `ollama_chat/` — the local-model prefix detection
 *     that fires the `--base-url` / `--reasoning-effort` /
 *     `--no-extended-thinking` shim args
 *   - `INSTALL.md` Step 0 (the doorway-not-runtime + no-cloud-key
 *     section) names the local-model stance explicitly (line ~28)
 *   - The user-story file itself has the required `## Metric` and
 *     `## Integration test` H2 sections (alignment-gate surfaces)
 *
 * Hypothesis (rule #9): substrate present (the threshold constants,
 *   the env override, the install runbook text, the spawner's local-
 *   model branch) → the operator's "local models until stable"
 *   stance is honored end-to-end.
 * Success: every test below passes.
 * Pivot: if substrate stays green but operators report Minsky
 *   silently auto-upgrades to a cloud model when a key is in env,
 *   the failure is in the shim's argv layer — file a new chaos test
 *   row in the user story's failure-modes table (and a paired test
 *   here), don't lower the constants.
 * Measurement: this file.
 * Anchor: rule #1 (don't reinvent — `measure-stability.mjs` reads
 *   from the existing `experiment-store` ledger, doesn't introduce
 *   a parallel counter); Beck 2004, *Extreme Programming Explained*
 *   2nd ed., Ch. "Do the simplest thing that could possibly work" —
 *   the local-first default removes cloud-key friction from the
 *   install path; this test pins the property at the substrate
 *   layer so an inadvertent regression flips red <1 s, not 7 days
 *   into a stability-gate measurement window.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("user-story 015 — local-models until stable substrate (M1.1)", () => {
  test("scripts/measure-stability.mjs exists with the documented threshold constants", () => {
    const measureStability = readFileSync(join(REPO_ROOT, "scripts/measure-stability.mjs"), "utf8");
    // The three threshold constants the user story §5 names explicitly.
    expect(measureStability).toMatch(/export const DEFAULT_GATE_THRESHOLD\s*=\s*0\.9\b/);
    expect(measureStability).toMatch(/export const KEEP_ACTIVE_FLOOR\s*=\s*0\.6\b/);
    expect(measureStability).toMatch(/export const DEFAULT_WINDOW_DAYS\s*=\s*7\b/);
  });

  test("MINSKY_STABILITY_GATE_THRESHOLD env override is read (operator escape hatch)", () => {
    const measureStability = readFileSync(join(REPO_ROOT, "scripts/measure-stability.mjs"), "utf8");
    // The Risk § "90% threshold is operator-chosen" mitigation —
    // the env var must be read at runtime.
    expect(measureStability).toMatch(/MINSKY_STABILITY_GATE_THRESHOLD/);
  });

  test("scripts/measure-stability.test.mjs exists (paired unit tests)", () => {
    expect(existsSync(join(REPO_ROOT, "scripts/measure-stability.test.mjs"))).toBe(true);
  });

  test("scripts/stability-number.mjs exists (one source of truth)", () => {
    // User story §5 calls this out as the single source of truth
    // for clean-exit fraction.
    expect(existsSync(join(REPO_ROOT, "scripts/stability-number.mjs"))).toBe(true);
  });

  test("openhands spawner recognizes the ollama_chat/ local-model prefix", () => {
    const spawner = readFileSync(
      join(REPO_ROOT, "novel/adapters/agent-runtime-openhands/src/spawner.ts"),
      "utf8",
    );
    // The branch that detects a local-model id and routes through
    // `--base-url` + the no-reasoning shim args.
    expect(spawner).toMatch(/ollama_chat\//);
  });

  test("INSTALL.md Step 0 names the no-cloud-key local-model default", () => {
    const installMd = readFileSync(join(REPO_ROOT, "INSTALL.md"), "utf8");
    // Line ~28 contract: "A cloud API key is NOT required" + the
    // canonical default model id.
    expect(installMd).toMatch(/cloud API key is NOT required/i);
    expect(installMd).toMatch(/ollama_chat\/qwen3-coder:30b/);
  });

  test("docs/configuration.md and docs/validated-learnings.md exist (referenced by user story)", () => {
    expect(existsSync(join(REPO_ROOT, "docs/configuration.md"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "docs/validated-learnings.md"))).toBe(true);
  });

  test("user-story 015 has the required `## Metric` and `## Integration test` sections", () => {
    const story = readFileSync(
      join(REPO_ROOT, "user-stories/015-local-models-until-stable.md"),
      "utf8",
    );
    expect(story).toMatch(/^## Metric\b/m);
    expect(story).toMatch(/^## Integration test\b/m);
  });
});
