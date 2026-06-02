#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements TASKS.md `dependabot-bumps-dep-regression-triage` § Verification -->
//
// dependabot-triage — the pure semver-triage decision for an open Dependabot
// PR. Given the package's from/to versions, decide whether the bump is safe
// to auto-merge through the local merge gate (patch + minor) or must be held
// for the operator (major). This is the enforcement seam (rule #2: pure
// decision over an injected snapshot; rule #10: deterministic, no LLM) behind
// the dependency-update policy documented in `docs/dependency-policy.md`.
//
// Why a decision function and not a `gh pr merge --auto` workflow: GitHub
// Actions is disabled on this repo (operator decision — every merge is locally
// vetted via `scripts/local-gate-merge.mjs`, not via cloud runners; see
// `docs/dependabot.md` § "Why no GitHub Actions auto-merge workflow"). So
// "auto-merge if CI green" maps to "the local gate may merge patch/minor bumps
// unattended"; "major bumps require operator approval" maps to "the triage
// labels the PR `needs-operator` and the local gate skips it". The label is the
// established repo convention for "the operator must act" (see
// `scripts/self-diagnose.mjs` actor labels).
//
// `.github/dependabot.yml` already routes minor+patch into per-family groups
// (so they bump together) and lets major bumps fall out as individual PRs.
// This module is the second half of that policy: it classifies each PR by the
// magnitude of its bump and emits the action + label the local gate consumes.
//
// Verdict table (for `classifyDependabotBump`):
// - patch  → { bumpType: "patch", action: "auto-merge",   label: null }
// - minor  → { bumpType: "minor", action: "auto-merge",   label: null }
// - major  → { bumpType: "major", action: "needs-operator", label: "needs-operator" }
// - unknown (unparseable version) → treated as "major" (fail safe — hold for
//   the operator rather than auto-merge something we can't classify).
//
// Anchor: TASKS.md `dependabot-bumps-dep-regression-triage` (pre-registered
//   hypothesis — rolling-7d failing-dependabot-PR count ≤ 2); SemVer 2.0.0
//   (semver.org — MAJOR.MINOR.PATCH contract); Dependabot best practices
//   (docs.github.com — auto-merge low-risk updates, review breaking changes).

/**
 * @typedef {"patch" | "minor" | "major"} BumpType
 */

/**
 * @typedef {"auto-merge" | "needs-operator"} TriageAction
 */

/**
 * @typedef {object} TriageVerdict
 * @property {BumpType} bumpType    — the semver magnitude of the bump
 * @property {TriageAction} action  — what the local merge gate should do
 * @property {"needs-operator" | null} label — label to apply (null when none)
 */

/**
 * The label that signals "the operator must act before this merges". Matches
 * the actor-label convention in `scripts/self-diagnose.mjs`.
 *
 * @type {"needs-operator"}
 */
export const NEEDS_OPERATOR_LABEL = "needs-operator";

/**
 * Parse a semver-ish version string into [major, minor, patch]. Strips a
 * leading `v`, a leading `^`/`~`/`>=`/`=` range operator, and any build /
 * prerelease suffix after the patch number. Returns null when the string has
 * no parseable MAJOR component.
 *
 * @param {string} version
 * @returns {[number, number, number] | null}
 */
export function parseSemver(version) {
  if (typeof version !== "string") return null;
  const cleaned = version
    .trim()
    .replace(/^[v=^~]+/, "")
    .replace(/^>=?\s*/, "");
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (match === null) return null;
  const majorStr = match[1];
  if (majorStr === undefined) return null;
  const major = Number.parseInt(majorStr, 10);
  if (!Number.isFinite(major)) return null;
  const minor = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const patch = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  return [major, minor, patch];
}

/**
 * Classify a Dependabot bump by the magnitude of the from→to version change.
 *
 * @param {{ fromVersion: string, toVersion: string }} bump
 * @returns {TriageVerdict}
 */
export function classifyDependabotBump(bump) {
  const from = parseSemver(bump.fromVersion);
  const to = parseSemver(bump.toVersion);
  // Fail safe: if either side is unparseable, treat as major (hold for the
  // operator). Auto-merging something we can't classify is the exact regression
  // mode this task exists to close.
  if (from === null || to === null) {
    return { bumpType: "major", action: "needs-operator", label: NEEDS_OPERATOR_LABEL };
  }
  if (to[0] !== from[0]) {
    return { bumpType: "major", action: "needs-operator", label: NEEDS_OPERATOR_LABEL };
  }
  if (to[1] !== from[1]) {
    return { bumpType: "minor", action: "auto-merge", label: null };
  }
  return { bumpType: "patch", action: "auto-merge", label: null };
}

/**
 * Convenience predicate the local merge gate consumes: may this bump be merged
 * unattended once CI (the local `pre-pr-lint --stage=full` gate) is green?
 *
 * @param {{ fromVersion: string, toVersion: string }} bump
 * @returns {boolean}
 */
export function mayAutoMerge(bump) {
  return classifyDependabotBump(bump).action === "auto-merge";
}
