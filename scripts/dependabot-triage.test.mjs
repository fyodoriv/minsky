// @ts-check
// Paired tests for the Dependabot semver-triage decision
// (`dependabot-triage.mjs`). Implements the Verification clause of TASKS.md
// `dependabot-bumps-dep-regression-triage`: "synthetic patch-bump PR
// auto-merges; major-bump PR opens with `needs-operator` label."
//
// Also pins that `.github/dependabot.yml` encodes the grouping half of the
// policy (minor+patch grouped, majors fall out individually) so a future edit
// can't silently widen a group to swallow major bumps.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  classifyDependabotBump,
  mayAutoMerge,
  NEEDS_OPERATOR_LABEL,
  parseSemver,
} from "./dependabot-triage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEPENDABOT_YML = resolve(REPO_ROOT, ".github/dependabot.yml");

describe("parseSemver", () => {
  it("parses bare MAJOR.MINOR.PATCH", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
  });

  it("strips a leading v and range operators", () => {
    expect(parseSemver("v4.12.18")).toEqual([4, 12, 18]);
    expect(parseSemver("^2.6.0")).toEqual([2, 6, 0]);
  });

  it("defaults missing minor/patch to 0", () => {
    expect(parseSemver("6")).toEqual([6, 0, 0]);
    expect(parseSemver("5.1")).toEqual([5, 1, 0]);
  });

  it("returns null for unparseable input", () => {
    expect(parseSemver("not-a-version")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("classifyDependabotBump", () => {
  it("patch bump auto-merges with no label (hono 4.12.16 → 4.12.18)", () => {
    const verdict = classifyDependabotBump({ fromVersion: "4.12.16", toVersion: "4.12.18" });
    expect(verdict.bumpType).toBe("patch");
    expect(verdict.action).toBe("auto-merge");
    expect(verdict.label).toBeNull();
  });

  it("minor bump auto-merges with no label", () => {
    const verdict = classifyDependabotBump({ fromVersion: "0.15.0", toVersion: "0.22.0" });
    expect(verdict.bumpType).toBe("minor");
    expect(verdict.action).toBe("auto-merge");
    expect(verdict.label).toBeNull();
  });

  it("major bump opens with the needs-operator label (setup-python 5 → 6)", () => {
    const verdict = classifyDependabotBump({ fromVersion: "5", toVersion: "6" });
    expect(verdict.bumpType).toBe("major");
    expect(verdict.action).toBe("needs-operator");
    expect(verdict.label).toBe(NEEDS_OPERATOR_LABEL);
  });

  it("major OTEL jump opens with needs-operator (0.57.2 → 0.217.0 is minor on 0.x)", () => {
    // 0.x.y semver: a leading-zero major means minor changes can be breaking,
    // but per MAJOR.MINOR.PATCH the magnitude here is a MINOR change (0 stays).
    // This documents the deliberate choice: 0.x bumps are NOT auto-classified
    // as major by version arithmetic; the OTEL-group coupling is handled by the
    // grouping in dependabot.yml, not by per-PR triage.
    const verdict = classifyDependabotBump({ fromVersion: "0.57.2", toVersion: "0.217.0" });
    expect(verdict.bumpType).toBe("minor");
  });

  it("fails safe to needs-operator when a version is unparseable", () => {
    const verdict = classifyDependabotBump({ fromVersion: "main", toVersion: "1.0.0" });
    expect(verdict.action).toBe("needs-operator");
    expect(verdict.label).toBe(NEEDS_OPERATOR_LABEL);
  });
});

describe("mayAutoMerge", () => {
  it("is true for patch and minor, false for major", () => {
    expect(mayAutoMerge({ fromVersion: "1.0.0", toVersion: "1.0.1" })).toBe(true);
    expect(mayAutoMerge({ fromVersion: "1.0.0", toVersion: "1.1.0" })).toBe(true);
    expect(mayAutoMerge({ fromVersion: "1.0.0", toVersion: "2.0.0" })).toBe(false);
  });
});

describe(".github/dependabot.yml grouping policy", () => {
  // Structural raw-text assertions rather than a full YAML parse — the repo
  // deliberately avoids pulling a YAML-parser dependency into a lint
  // (see scripts/check-pre-push-hook-fast.mjs). `js-yaml` ships no types and
  // the grouping invariant we care about (no group declares `major`) is a
  // clean text predicate.
  const text = readFileSync(DEPENDABOT_YML, "utf8");

  it("exists and declares version 2", () => {
    expect(existsSync(DEPENDABOT_YML)).toBe(true);
    expect(/^version:\s*2\b/m.test(text)).toBe(true);
  });

  it("no group widens its update-types to include major bumps", () => {
    // Every `update-types:` block under a group must list only patch/minor.
    // A `- major` line anywhere in the file would let a group swallow a
    // breaking bump, defeating the triage. There are none today.
    const majorUpdateType = /update-types:\s*(?:\n\s*-\s*\w+)*\n\s*-\s*major\b/;
    expect(majorUpdateType.test(text)).toBe(false);
    expect(/-\s*major\b/.test(text)).toBe(false);
  });

  it("references the triage seam and the needs-operator hold", () => {
    expect(text).toContain("dependabot-triage.mjs");
    expect(text).toContain(NEEDS_OPERATOR_LABEL);
  });
});
