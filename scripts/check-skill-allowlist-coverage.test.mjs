// Tests for check-skill-allowlist-coverage.mjs. Pattern: deterministic gate
// over the skill-primer ↔ glossary-allowlist coupling (rule #10 applied to
// rule #5). Paired positive/negative fixtures (Meszaros 2007).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { parseAllowlist } from "./check-rule-5-glossary-discipline.mjs";
import {
  buildViolationMessage,
  checkSkillAllowlistCoverage,
  DEFAULT_SKILL_ROOTS,
  listSkillNames,
} from "./check-skill-allowlist-coverage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

describe("checkSkillAllowlistCoverage", () => {
  test("every skill on the allowlist → no missing", () => {
    const result = checkSkillAllowlistCoverage({
      skillNames: ["caveman", "diagnose"],
      allowlist: new Set(["caveman", "diagnose", "unrelated-token"]),
    });
    expect(result.missing).toEqual([]);
  });

  test("one skill absent → reported as missing", () => {
    const result = checkSkillAllowlistCoverage({
      skillNames: ["caveman", "diagnose"],
      allowlist: new Set(["caveman"]),
    });
    expect(result.missing).toEqual(["diagnose"]);
  });

  test("multiple absent → all reported, sorted and deduped", () => {
    const result = checkSkillAllowlistCoverage({
      skillNames: ["zoom-out", "triage", "triage", "caveman"],
      allowlist: new Set(["caveman"]),
    });
    expect(result.missing).toEqual(["triage", "zoom-out"]);
    // skillNames is normalised (deduped + sorted) regardless of missing-ness.
    expect(result.skillNames).toEqual(["caveman", "triage", "zoom-out"]);
  });

  test("empty skill set → no missing (vacuously covered)", () => {
    const result = checkSkillAllowlistCoverage({ skillNames: [], allowlist: new Set() });
    expect(result.missing).toEqual([]);
    expect(result.skillNames).toEqual([]);
  });
});

describe("buildViolationMessage", () => {
  test("names every missing skill and points at the allowlist + the recurrence", () => {
    const msg = buildViolationMessage(["diagnose", "triage"]);
    expect(msg).toContain("diagnose");
    expect(msg).toContain("triage");
    expect(msg).toContain("scripts/glossary-allowlist.txt");
    expect(msg).toContain("#696/#704");
    expect(msg).toMatch(/2 skill primer directories are missing/);
  });

  test("singular wording for exactly one missing skill", () => {
    const msg = buildViolationMessage(["diagnose"]);
    expect(msg).toMatch(/1 skill primer directory is missing/);
  });
});

describe("the live repo (rule #5 enforcement)", () => {
  test("every .claude/skills + .devin/skills directory name is on the allowlist", () => {
    const skillNames = listSkillNames([...DEFAULT_SKILL_ROOTS], REPO_ROOT);
    // Sanity — the repo ships real skill primers; an empty result would mean
    // the discovery seam silently broke and the gate became a no-op.
    expect(skillNames.length).toBeGreaterThan(5);
    const allowlist = parseAllowlist(
      readFileSync(resolve(REPO_ROOT, "scripts/glossary-allowlist.txt"), "utf8"),
    );
    const result = checkSkillAllowlistCoverage({ skillNames, allowlist });
    expect(result.missing).toEqual([]);
  });
});
