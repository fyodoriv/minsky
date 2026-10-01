// Tests for omc-roundtrip.mjs. Pattern: round-trip parsing as a
// parseability test (Aho-Sethi-Ullman 1986). Paired positive/negative
// fixtures (Meszaros 2007, *xUnit Test Patterns*); synthetic OMC task
// JSON only — no real `~/.claude/` or third-party data is checked into
// fixtures. The synthetic shape mirrors `TaskFile` /
// `TeamTask` per research.md § "OMC handoff persistence" (citing
// `src/team/types.ts:38-58, 195-213`).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { findOmcTaskFiles, parseOmcCheckoutFlag, roundTripOmcTask } from "./omc-roundtrip.mjs";

/**
 * Synthetic task JSON in the OMC `TaskFile` shape. Pretty-printed with
 * 2-space indent — exactly what `JSON.stringify(updated, null, 2)`
 * (the canonical write site at `src/team/state/tasks.ts:90`) emits.
 */
const SYNTHETIC_TASK = {
  id: "synthetic-task-001",
  subject: "Test round-trip",
  description: "Synthetic OMC task for round-trip parseability tests.",
  status: "pending",
  blocks: [],
  blocked_by: [],
  created_at: "2026-05-04T00:00:00.000Z",
  version: 1,
};

describe("roundTripOmcTask (pure)", () => {
  test("synthetic task JSON (canonical 2-space indent) round-trips cleanly", () => {
    const json = JSON.stringify(SYNTHETIC_TASK, null, 2);
    const result = roundTripOmcTask(json);
    expect(result.ok).toBe(true);
  });

  test("whitespace-only diff (trailing newline, trailing spaces per line) → ok", () => {
    // OMC uses `writeAtomic` which may or may not append a trailing
    // newline depending on the platform; the parseability claim must
    // survive that. Add a trailing newline + a per-line trailing
    // space and verify the comparison normalises both away.
    const canonical = JSON.stringify(SYNTHETIC_TASK, null, 2);
    const withTrailing = `${canonical.replace(/\n/g, " \n")}\n\n`;
    const result = roundTripOmcTask(withTrailing);
    expect(result.ok).toBe(true);
  });

  test("structurally-different content (non-canonical indentation) fails with a divergence diff", () => {
    // 4-space indent is not the OMC canonical write shape (`writeAtomic
    // (path, JSON.stringify(updated, null, 2))` at
    // `src/team/state/tasks.ts:90`). After parse → re-emit-with-2-space,
    // the byte sequence differs at every nested level. This is the
    // load-bearing fail case: it disproves the round-trip property and
    // is exactly what the rule-#9 pivot for the research task is
    // testing for — if a future OMC release changes the indent or
    // spacing convention, the bridge silently breaks unless this gate
    // catches it.
    const fourSpace = JSON.stringify(SYNTHETIC_TASK, null, 4);
    const result = roundTripOmcTask(fourSpace);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diff).toMatch(/divergence at byte \d+/);
    }
  });

  test("invalid JSON fails with a parse-error diff", () => {
    const result = roundTripOmcTask("{ not valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diff).toMatch(/parse error/);
    }
  });

  test("non-object top-level (JSON array) fails with a shape-error diff", () => {
    const result = roundTripOmcTask("[]");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diff).toMatch(/JSON object at the top level/);
    }
  });

  test("non-string input fails fast (rule-#6 let-it-crash on caller contract violation)", () => {
    // @ts-expect-error — intentionally violating the type to test the guard.
    const result = roundTripOmcTask(42);
    expect(result.ok).toBe(false);
  });
});

describe("findOmcTaskFiles (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(tmpdir(), `omc-roundtrip-test-${process.pid}-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing .omc/state/team/ → empty array (dormant case)", () => {
    const result = findOmcTaskFiles(dir);
    expect(result).toEqual([]);
  });

  test("populated .omc/state/team/<team>/tasks/*.json → returns each file", () => {
    const tasksDir = join(dir, ".omc", "state", "team", "alpha", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(join(tasksDir, "task-001.json"), JSON.stringify(SYNTHETIC_TASK, null, 2));
    writeFileSync(
      join(tasksDir, "task-002.json"),
      JSON.stringify({ ...SYNTHETIC_TASK, id: "task-002" }, null, 2),
    );
    // Non-JSON neighbour should be ignored.
    writeFileSync(join(tasksDir, "README.md"), "not a task");
    const result = findOmcTaskFiles(dir);
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.endsWith(".json"))).toBe(true);
  });

  test("multiple teams under .omc/state/team/ are all walked", () => {
    for (const teamName of ["alpha", "beta"]) {
      const tasksDir = join(dir, ".omc", "state", "team", teamName, "tasks");
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(join(tasksDir, "t.json"), JSON.stringify(SYNTHETIC_TASK, null, 2));
    }
    const result = findOmcTaskFiles(dir);
    expect(result).toHaveLength(2);
  });
});

describe("parseOmcCheckoutFlag (CLI arg parser)", () => {
  test("absent → null (dormant case)", () => {
    expect(parseOmcCheckoutFlag([])).toBeNull();
    expect(parseOmcCheckoutFlag(["--unrelated=x"])).toBeNull();
  });

  test("--omc-checkout=<path> → absolute path", () => {
    const result = parseOmcCheckoutFlag(["--omc-checkout=/tmp/foo"]);
    expect(result).toBe("/tmp/foo");
  });

  test("--omc-checkout= (empty value) → null", () => {
    expect(parseOmcCheckoutFlag(["--omc-checkout="])).toBeNull();
  });
});
