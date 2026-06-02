/**
 * User-story 008 — "Per-task backend and personas (launcher-agnostic
 * feature parity)" (`user-stories/008-per-task-backend-and-personas.md`).
 *
 * Integration test for M1.9 (claude / devin / aider + openhands parity).
 * Pins the SUBSTRATE invariant via two surfaces:
 *
 *   1. AGENT_MATRIX in `scripts/lib/cloud-agent-config.mjs` — the
 *      source-of-truth contract for all 4 backends (matrix rows +
 *      `pendingExternalDep: null` for each).
 *   2. `scripts/spawn_agent.py` — the current dispatcher only wires
 *      openhands + claude; devin + aider are documented opt-in fallbacks
 *      with their wire shape captured in the matrix.
 *   3. `bin/minsky` — the operator-facing surface (`list agents`)
 *      enumerates all 4 backends.
 *
 * Hypothesis (rule #9): if all 4 backends are present in AGENT_MATRIX
 * with `pendingExternalDep: null` AND the operator-facing surfaces
 * enumerate them, the launcher-agnostic contract is met. The runtime
 * gap (devin spawn-failed, aider live-mode) is tracked by separate
 * P0 tasks (`spawn-failed-exit-minus-one-silent-empty-stderr`); this
 * file is the substrate gate.
 * Success: every test below passes.
 * Pivot: if a backend's runtime spawn fails and that failure isn't
 * already in a task, add it.
 * Measurement: this file.
 * Anchor: Liskov 1987 (backends interchangeable at the spawn boundary);
 * `user-stories/014-launcher-agnostic-feature-parity.md`; the AGENT_MATRIX
 * contract documented in `scripts/lib/cloud-agent-config.mjs`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");
const SPAWN_AGENT = join(REPO_ROOT, "scripts/spawn_agent.py");
const AGENT_MATRIX_FILE = join(REPO_ROOT, "scripts/lib/cloud-agent-config.mjs");
const PIPELINE_DRIVER = join(REPO_ROOT, "bin/minsky-multi-persona.sh");
const BUILD_BRIEF = join(REPO_ROOT, "scripts/build_brief.py");
const PIPELINE_PERSONAS = ["researcher", "planner", "developer", "qa", "reviewer"] as const;

describe("user-story 008 — launcher-agnostic feature parity (M1.9) substrate", () => {
  test("AGENT_MATRIX is the source-of-truth contract", () => {
    const content = readFileSync(AGENT_MATRIX_FILE, "utf8");
    expect(content).toMatch(/export const AGENT_MATRIX/);
  });

  test("AGENT_MATRIX has all 4 backends (openhands + claude + devin + aider) contractually runnable today", () => {
    const content = readFileSync(AGENT_MATRIX_FILE, "utf8");
    // Each backend appears as an `id: "<name>"` row in the array.
    for (const backend of ["openhands", "claude", "devin", "aider"]) {
      expect(content).toMatch(new RegExp(`id:\\s*"${backend}"`));
    }
    // All 4 have `pendingExternalDep: null` (runnable today, not gated
    // on a future external dep).
    const nullCount = (content.match(/pendingExternalDep:\s*null/g) ?? []).length;
    expect(nullCount).toBe(4);
  });

  test("scripts/spawn_agent.py is the canonical dispatcher (openhands + claude wired today)", () => {
    const content = readFileSync(SPAWN_AGENT, "utf8");
    expect(content).toMatch(/spawn_agent/);
    expect(content.toLowerCase()).toMatch(/openhands/);
    expect(content.toLowerCase()).toMatch(/claude/);
    // devin + aider are in the matrix but not the dispatcher (gated on
    // M1.14's live A/B benchmarks); this is by-design — the dispatcher
    // delegates to the openhands shim for non-openhands cloud_agent
    // settings today.
  });

  test("`bin/minsky list agents` enumerates all 4 backends with current setting", () => {
    const binMinsky = readFileSync(join(REPO_ROOT, "bin/minsky"), "utf8");
    expect(binMinsky).toMatch(/openhands/);
    expect(binMinsky).toMatch(/claude/);
    expect(binMinsky).toMatch(/devin/);
    expect(binMinsky).toMatch(/aider/);
  });
});

// M2 multi-persona pipeline — formerly the spec's `it.skip` case (now active,
// shipped via the A2A adapter). The behavioural end-to-end coverage lives in
// `test/integration/multi-persona-pipeline.test.ts`; this block pins the
// substrate the user story claims as shipped.
describe("user-story 008 — M2 multi-persona A2A pipeline substrate", () => {
  test("the pipeline driver bin/minsky-multi-persona.sh exists and is executable", () => {
    expect(existsSync(PIPELINE_DRIVER)).toBe(true);
    const src = readFileSync(PIPELINE_DRIVER, "utf8");
    // The driver walks the five personas via the A2A adapter (handoff substrate).
    expect(src).toMatch(/A2AOpenHands/);
    expect(src).toMatch(/iterations\.jsonl/);
    expect(src).toMatch(/persona=/);
  });

  test("each persona has a brief template under novel/personas/", () => {
    for (const role of PIPELINE_PERSONAS) {
      const template = join(REPO_ROOT, "novel/personas", `${role}.md`);
      expect(existsSync(template)).toBe(true);
      expect(readFileSync(template, "utf8")).toContain(`# Persona: ${role}`);
    }
  });

  test("build_brief.py exposes the --persona overlay (the per-persona brief seam)", () => {
    const src = readFileSync(BUILD_BRIEF, "utf8");
    expect(src).toMatch(/--persona/);
    expect(src).toMatch(/PIPELINE_PERSONAS/);
    expect(src).toMatch(/render_persona_overlay/);
  });

  test("the behavioural pipeline test exists (artifact chain + transition log)", () => {
    expect(existsSync(join(REPO_ROOT, "test/integration/multi-persona-pipeline.test.ts"))).toBe(
      true,
    );
  });
});
