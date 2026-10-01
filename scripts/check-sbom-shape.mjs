#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements parent task `supply-chain-hardening-lockfile-sbom-slsa` § Details (b) — CycloneDX SBOM shape classifier -->
// Slice 1 of the SBOM sub-track of `supply-chain-hardening-lockfile-sbom-slsa`
// (TASKS.md): the pure CycloneDX 1.5 / 1.6 SBOM-shape classifier.
//
// `classifySbomShape(parsed)` decides whether an already-parsed JSON object
// is a well-formed CycloneDX SBOM matching the subset that
// `cyclonedx/gh-node-module-generatebom@v1` emits for this repo. The
// classifier is intentionally pure and deterministic; the SBOM-generation
// workflow, the artefact-attach step, and the CI gate that pins generated
// SBOMs to a known-good shape ship in subsequent slices against this fixed
// seam.
//
// Slice 2: adds `walkSbomViolations(parsed)` — the pure aggregating walker
// that runs the slice-1 verdict logic over every component and collects ALL
// violations rather than short-circuiting on the first failure. The slice-1
// classifier deliberately exits on the first per-component error (so a
// malformed-components rejection is the fastest path to a clear actionable
// verdict for an interactive user); the walker is the seam the CI gate
// consumes so a release with eight malformed component entries surfaces all
// eight in one log line, not eight successive PR runs. `walkSbomViolations`
// takes an already-parsed object so the test suite can exercise every
// verdict path with hand-built fixtures and is not coupled to a JSON parser
// or an on-disk file. Mirrors `walkLockfileChanges` (slice 2 of the
// lockfile-integrity sub-track) and `extractAttributeViolations` (slice 2
// of vision.md § 13.2 OTEL no-PII).
//
// Slice 3 (this file): adds `parseSbomJson(text) → ParseResult` — the pure
// text-to-value seam between the on-disk SBOM file and the slice-1/2
// functions. Wraps `JSON.parse` with deterministic verdict shaping for the
// three failure modes a slice-≥4 CLI needs to distinguish: (a) the caller
// passed a non-string (programmer error — different exit code from
// I/O-shaped failures); (b) the file is empty or whitespace-only (typical
// signature of a failed `cyclonedx-cli` generation step that left a
// zero-byte artefact behind); (c) the file is non-empty but not valid JSON
// (truncated download, accidentally-binary file, generator regression).
// Strips a leading UTF-8 BOM before parsing — `cyclonedx-cli` occasionally
// emits one and a bare `JSON.parse` rejects it as a syntax error otherwise.
// Mirrors `parsePnpmLockfile` (slice 3 of the lockfile-integrity sub-track,
// which is a custom YAML parser because pnpm's lockfile dialect is YAML);
// SBOMs are JSON, so this slice is correspondingly thin — but the input
// boundary still earns its own seam so the slice-≥4 CLI can map each
// parse-failure code to a different log line and exit code without
// in-lining a try/catch that obscures which failure mode actually fired.
//
// Why a shape classifier (not a generator) is the right slice 1: the
// sibling supply-chain gates (`scan-secrets`, `otel-no-pii-in-spans-lint`,
// `lockfile-integrity`) all start with a pure decision function whose
// verdict table is fully testable from hand-built fixtures, then add the
// boundary (file walker, AST walker, CLI, workflow) in subsequent slices.
// The generator (`cyclonedx-cli` invoked from a workflow) is the I/O
// boundary; the *validator* — that the JSON it spits out matches the spec
// the consumer expects — is the seam. Without this seam, a downstream
// regression in `cyclonedx-cli` (output-shape change between versions, a
// missed `purl` field, a duplicated `bom-ref`) ships silently because no
// gate checks the SBOM before it's attached to the GitHub Release.
//
// Verdict table:
// - kind="valid"           — matches the subset CycloneDX 1.5 / 1.6 spec
// - code="not-object"      — root is not a JSON object
// - code="missing-bomFormat"     — top-level `bomFormat` is absent
// - code="wrong-bomFormat"       — `bomFormat !== "CycloneDX"`
// - code="missing-specVersion"   — top-level `specVersion` is absent
// - code="unsupported-specVersion" — `specVersion` not in {"1.5","1.6"}
// - code="missing-version"       — top-level `version` is absent
// - code="invalid-version"       — `version` not a positive integer
// - code="missing-components"    — top-level `components` is absent
// - code="components-not-array"  — `components` not an array
// - code="component-not-object"  — a `components[i]` is not an object
// - code="component-missing-type" — a component lacks `type`
// - code="component-invalid-type" — `type` not in the spec's enum
// - code="component-missing-name" — a component lacks `name`
// - code="component-missing-version" — a library component lacks `version`
// - code="component-missing-purl" — a library component lacks `purl`
// - code="component-malformed-purl" — `purl` does not match `pkg:<type>/<name>@<version>`
// - code="duplicate-bom-ref"     — two components share a `bom-ref`
//
// Slice-3 `parseSbomJson` verdict table:
// - { ok: true, parsed }              — JSON.parse succeeded; caller hands
//                                       `parsed` to `classifySbomShape` /
//                                       `walkSbomViolations` for shape checks
// - code="non-string-input"           — argument is not a string
// - code="empty-input"                — string is empty or whitespace-only
//                                       (after BOM strip)
// - code="invalid-json"               — `JSON.parse` threw
//
// Pre-registered (rule #9 / vision.md § 13.5 supply-chain hardening): pivot
// if the false-positive rate exceeds 1 / month over 3 months — most likely
// false-positive class is a `cyclonedx-cli` minor-version output drift that
// adds a new top-level field. The relief valve is the spec-version
// allowlist (extending `{1.5, 1.6}` to `{1.5, 1.6, 1.7}` when 1.7 ships) —
// not relaxing the field requirements. Drop the lint only if SLSA L3
// provenance verification (the SLSA sub-track of the parent task) ships AND
// every release artefact is hash-pinned downstream — until then the SBOM
// shape is the consumer's only structural guarantee.
//
// Pattern: deterministic gate (rule #10), pure function (rule #2 — the
// classifier is the seam, the workflow / CLI / CI gate is the boundary).
// Sibling: `scripts/check-lockfile-integrity.mjs` (slice 1, classifier),
// `scripts/scan-secrets.mjs` (slice 1 of vision.md § 13.1), and
// `scripts/check-otel-no-pii.mjs` (slice 1 of vision.md § 13.2). All four
// cover one minimum-bar item each via the same
// classifier-then-walker-then-CLI-then-CI-gate spine.
//
// Source: vision.md § 13 "Security & privacy — second priority after
//   performance" (the 8-item minimum bar — supply-chain hardening is item
//   #5); TASKS.md `supply-chain-hardening-lockfile-sbom-slsa` § Details (b);
//   CycloneDX 1.5 specification (cyclonedx.org/docs/1.5/json/, 2023) and
//   CycloneDX 1.6 (cyclonedx.org/docs/1.6/json/, 2024) — `bomFormat`,
//   `specVersion`, `version`, `components[]`, and the `Component` `type`
//   enum are normative; SLSA Specification 1.0 (slsa.dev/spec/v1.0/, 2025)
//   — track 2 "source integrity" assumes the SBOM matches what was built;
//   purl spec (github.com/package-url/purl-spec, 2024) — `pkg:<type>/<name>@<version>`
//   is the canonical component identity for npm packages; CNCF Security
//   TAG's SBOM guidance (CNCF SBOM working group, 2024) — every release
//   should ship a machine-verified SBOM; rule #2 (the classifier is the
//   swappable seam — when CycloneDX 1.7 ships, only the spec-version
//   allowlist changes).
// Conformance: full — slice 1 is pure (no I/O); subsequent slices add the
//   boundary (workflow generation, CLI, CI gate) via well-typed wrappers.

/**
 * The CycloneDX spec-version allowlist for this repo. 1.5 is the floor
 * because that's the version `cyclonedx-cli` v0.27+ emits by default; 1.6
 * is accepted because the npm-package-generator v3+ emits it. Anything
 * outside this set is rejected so a regression in the generator that
 * silently emits an older format trips the gate.
 */
export const ALLOWED_SPEC_VERSIONS = Object.freeze(["1.5", "1.6"]);

/**
 * The `Component.type` enum from CycloneDX 1.5 §4.2 (`type` field).
 * `library` is what every npm dependency is. `application`, `framework`,
 * `container`, `operating-system`, `device`, `firmware`, `file` are the
 * other spec values; CycloneDX 1.6 added `platform`,
 * `device-driver`, `machine-learning-model`, `data`, `cryptographic-asset`.
 */
export const ALLOWED_COMPONENT_TYPES = Object.freeze([
  "application",
  "framework",
  "library",
  "container",
  "platform",
  "operating-system",
  "device",
  "device-driver",
  "firmware",
  "file",
  "machine-learning-model",
  "data",
  "cryptographic-asset",
]);

/**
 * `purl` shape: `pkg:<type>/<name>@<version>`. Type is alphanumeric-with-dot
 * (npm, golang, maven, ...). Name is the package name (URL-encoded slashes
 * are spec-permitted but rare for npm — pnpm-emitted SBOMs use the literal
 * `@scope/name` form which is unencoded `@` + slash). Version is whatever
 * the registry returned. This regex matches the npm-shaped purls every
 * cyclonedx-node-generator emits; it deliberately does not try to be a
 * full purl parser (the spec admits qualifiers and subpaths after `?`/`#`
 * which we don't validate at this slice — slice ≥2's walker handles the
 * full grammar against real artefacts).
 */
const PURL_RE = /^pkg:[a-zA-Z][a-zA-Z0-9.+-]*\/[^?#]+@[^?#]+(?:[?#].*)?$/;

/**
 * @typedef {(
 *   | { ok: true, kind: "valid" }
 *   | { ok: false, code: string, reason: string, path?: string }
 * )} ClassifyResult
 */

/**
 * Test whether a value is a positive integer (the spec's `version` field
 * is a 1-based BOM revision counter; 0 and negatives are nonsensical).
 *
 * @param {unknown} value
 * @returns {value is number}
 */
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Test whether a value is a plain object (not null, not an array, not a
 * primitive). The classifier does not care about prototype-pollution
 * shapes — the JSON parser already returns plain objects.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Test whether a value is a non-empty string. Many of the per-field
 * validators below need this test, so naming it once keeps each validator
 * a single boolean expression and well below the cognitive-complexity cap.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value !== "";
}

/**
 * Validate a library component's `version` and `purl` (the npm-package
 * case where these fields are load-bearing). Split out from
 * `classifyComponent` to keep both functions under the 10-cognitive-
 * complexity cap. Returns `null` if valid or a verdict if malformed.
 *
 * @param {Record<string, unknown>} component
 * @param {string} path
 * @returns {ClassifyResult | null}
 */
function classifyLibraryFields(component, path) {
  if (!isNonEmptyString(component["version"])) {
    return {
      ok: false,
      code: "component-missing-version",
      reason: `${path} (type=library) is missing required field "version"`,
      path,
    };
  }
  if (!isNonEmptyString(component["purl"])) {
    return {
      ok: false,
      code: "component-missing-purl",
      reason: `${path} (type=library) is missing required field "purl"`,
      path,
    };
  }
  if (!PURL_RE.test(component["purl"])) {
    return {
      ok: false,
      code: "component-malformed-purl",
      reason: `${path}.purl "${component["purl"]}" is not pkg:<type>/<name>@<version>`,
      path,
    };
  }
  return null;
}

/**
 * Validate a single `components[i]` entry. Returns `null` if valid or a
 * verdict if malformed. The `index` is woven into the `path` so the
 * downstream report can point operators at the bad entry.
 *
 * @param {unknown} component
 * @param {number} index
 * @returns {ClassifyResult | null}
 */
function classifyComponent(component, index) {
  const path = `components[${index}]`;
  if (!isPlainObject(component)) {
    return {
      ok: false,
      code: "component-not-object",
      reason: `${path} must be an object`,
      path,
    };
  }
  const type = component["type"];
  if (type === undefined) {
    return {
      ok: false,
      code: "component-missing-type",
      reason: `${path} is missing required field "type"`,
      path,
    };
  }
  if (typeof type !== "string" || !ALLOWED_COMPONENT_TYPES.includes(type)) {
    return {
      ok: false,
      code: "component-invalid-type",
      reason: `${path}.type "${String(type)}" is not in the CycloneDX 1.5/1.6 enum`,
      path,
    };
  }
  if (!isNonEmptyString(component["name"])) {
    return {
      ok: false,
      code: "component-missing-name",
      reason: `${path} is missing required field "name"`,
      path,
    };
  }
  // For library-typed components (the npm-package case), version + purl are
  // load-bearing — without them the SBOM cannot be reconciled against
  // pnpm-lock.yaml. Other types (application, file, data) are exempt from
  // the version/purl floor at this slice; they're rare in an npm SBOM and
  // the spec does not mark those fields required for them.
  if (type === "library") return classifyLibraryFields(component, path);
  return null;
}

/**
 * Validate the four top-level scalar fields (`bomFormat`, `specVersion`,
 * `version`) of a CycloneDX SBOM. Split out from `classifySbomShape` to
 * keep that function under the 10-cognitive-complexity cap.
 *
 * @param {Record<string, unknown>} parsed
 * @returns {ClassifyResult | null}
 */
function classifyTopLevelFields(parsed) {
  if (!("bomFormat" in parsed)) {
    return {
      ok: false,
      code: "missing-bomFormat",
      reason: 'SBOM is missing required top-level field "bomFormat"',
    };
  }
  if (parsed["bomFormat"] !== "CycloneDX") {
    return {
      ok: false,
      code: "wrong-bomFormat",
      reason: `bomFormat "${String(parsed["bomFormat"])}" must be exactly "CycloneDX"`,
    };
  }
  if (!("specVersion" in parsed)) {
    return {
      ok: false,
      code: "missing-specVersion",
      reason: 'SBOM is missing required top-level field "specVersion"',
    };
  }
  const specVersion = parsed["specVersion"];
  if (typeof specVersion !== "string" || !ALLOWED_SPEC_VERSIONS.includes(specVersion)) {
    return {
      ok: false,
      code: "unsupported-specVersion",
      reason: `specVersion "${String(specVersion)}" must be one of ${ALLOWED_SPEC_VERSIONS.join(", ")}`,
    };
  }
  if (!("version" in parsed)) {
    return {
      ok: false,
      code: "missing-version",
      reason: 'SBOM is missing required top-level field "version"',
    };
  }
  if (!isPositiveInteger(parsed["version"])) {
    return {
      ok: false,
      code: "invalid-version",
      reason: `version "${String(parsed["version"])}" must be a positive integer`,
    };
  }
  return null;
}

/**
 * Walk `components[]` running per-component validation and tracking
 * `bom-ref` uniqueness. Returns the first verdict (component-shape or
 * duplicate-bom-ref) or `null` if the array is fully valid.
 *
 * @param {unknown[]} components
 * @returns {ClassifyResult | null}
 */
function classifyComponents(components) {
  /** @type {Map<string, number>} */
  const seenBomRefs = new Map();
  for (let i = 0; i < components.length; i += 1) {
    const verdict = classifyComponent(components[i], i);
    if (verdict !== null) return verdict;
    const component = /** @type {Record<string, unknown>} */ (components[i]);
    const bomRef = component["bom-ref"];
    if (typeof bomRef !== "string" || bomRef === "") continue;
    const previous = seenBomRefs.get(bomRef);
    if (previous !== undefined) {
      return {
        ok: false,
        code: "duplicate-bom-ref",
        reason: `bom-ref "${bomRef}" is shared by components[${previous}] and components[${i}]`,
        path: `components[${i}]`,
      };
    }
    seenBomRefs.set(bomRef, i);
  }
  return null;
}

/**
 * Classify the shape of an already-parsed JSON object as a CycloneDX SBOM.
 * Pure, deterministic, no I/O. Order of checks: top-level required fields
 * first (so a totally-empty document fails fast with a clear reason), then
 * per-component checks (so the verdict points at the offending entry).
 *
 * @param {unknown} parsed  Already-parsed JSON object — caller does I/O.
 * @returns {ClassifyResult}
 */
export function classifySbomShape(parsed) {
  if (!isPlainObject(parsed)) {
    return { ok: false, code: "not-object", reason: "SBOM root must be a JSON object" };
  }
  const topLevel = classifyTopLevelFields(parsed);
  if (topLevel !== null) return topLevel;
  if (!("components" in parsed)) {
    return {
      ok: false,
      code: "missing-components",
      reason: 'SBOM is missing required top-level field "components"',
    };
  }
  const components = parsed["components"];
  if (!Array.isArray(components)) {
    return { ok: false, code: "components-not-array", reason: "components must be an array" };
  }
  const componentsVerdict = classifyComponents(components);
  if (componentsVerdict !== null) return componentsVerdict;
  return { ok: true, kind: "valid" };
}

// Slice 2: pure aggregating walker over already-parsed SBOMs. ----------------

/**
 * @typedef {{ ok: false, code: string, reason: string, path?: string }} SbomViolation
 */

/**
 * @typedef {object} SbomWalkResult
 * @property {SbomViolation[]} violations
 *   All discovered violations, in document order: top-level first, then
 *   per-component, then duplicate-bom-ref. Empty array means the SBOM is
 *   well-formed. Each entry carries the same `{ code, reason, path? }`
 *   shape `classifySbomShape` returns — downstream printers can format
 *   either origin uniformly.
 */

/**
 * Walk every component in an already-parsed SBOM, collecting ALL
 * violations rather than short-circuiting on the first one. Top-level
 * shape failures (root not object, missing/wrong `bomFormat` /
 * `specVersion` / `version` / `components`) still produce a single
 * violation — there's nothing more to walk when the envelope is wrong —
 * but a `components[]` array with eight malformed entries surfaces all
 * eight at once.
 *
 * The walker is the seam the CI gate (slice ≥3) consumes so a release
 * with multiple shape regressions surfaces every one in a single log
 * line. The slice-1 `classifySbomShape` retains its early-fail behaviour
 * so interactive users (a developer running the gate locally) get the
 * fastest path to a clear actionable verdict.
 *
 * Order of checks mirrors `classifySbomShape`:
 *   1. root not object → single violation, return.
 *   2. top-level field rejections → single violation, return.
 *   3. missing/non-array `components` → single violation, return.
 *   4. per-component shape errors → collect all, append duplicate-bom-ref
 *      pairs, return.
 *
 * @param {unknown} parsed  Already-parsed JSON — caller does I/O.
 * @returns {SbomWalkResult}
 */
export function walkSbomViolations(parsed) {
  if (!isPlainObject(parsed)) {
    return {
      violations: [{ ok: false, code: "not-object", reason: "SBOM root must be a JSON object" }],
    };
  }
  const topLevel = classifyTopLevelFields(parsed);
  if (topLevel !== null && topLevel.ok === false) return { violations: [topLevel] };
  if (!("components" in parsed)) {
    return {
      violations: [
        {
          ok: false,
          code: "missing-components",
          reason: 'SBOM is missing required top-level field "components"',
        },
      ],
    };
  }
  const components = parsed["components"];
  if (!Array.isArray(components)) {
    return {
      violations: [
        { ok: false, code: "components-not-array", reason: "components must be an array" },
      ],
    };
  }
  return { violations: collectComponentViolations(components) };
}

/**
 * Walk every entry in `components[]`, collecting both shape errors (from
 * `classifyComponent`) and duplicate-bom-ref pairs. Pulled out so
 * `walkSbomViolations` stays under the cognitive-complexity cap and so the
 * iteration logic for the aggregate path is its own well-named seam.
 *
 * `classifyComponent` itself returns at most one verdict per entry — that
 * matches operator intent (an entry that's both missing `name` and missing
 * `purl` reports the first failure; once the operator fixes that, the next
 * walk surfaces the second). Across-entry independence is what slice 2
 * adds: entries 3, 5, and 7 all malformed each get their own violation.
 *
 * @param {unknown[]} components
 * @returns {SbomViolation[]}
 */
function collectComponentViolations(components) {
  /** @type {SbomViolation[]} */
  const violations = [];
  /** @type {Map<string, number>} */
  const seenBomRefs = new Map();
  for (let i = 0; i < components.length; i += 1) {
    const verdict = classifyComponent(components[i], i);
    if (verdict !== null && verdict.ok === false) {
      violations.push(verdict);
      continue;
    }
    const component = /** @type {Record<string, unknown>} */ (components[i]);
    const bomRef = component["bom-ref"];
    if (typeof bomRef !== "string" || bomRef === "") continue;
    const previous = seenBomRefs.get(bomRef);
    if (previous !== undefined) {
      violations.push({
        ok: false,
        code: "duplicate-bom-ref",
        reason: `bom-ref "${bomRef}" is shared by components[${previous}] and components[${i}]`,
        path: `components[${i}]`,
      });
      continue;
    }
    seenBomRefs.set(bomRef, i);
  }
  return violations;
}

// Slice 3: pure JSON-text parser. -------------------------------------------
//
// `parseSbomJson(text) → ParseResult` is the seam between on-disk SBOM
// bytes and the slice-1/2 shape functions. Pure, no I/O, deterministic.
// Slice ≥4 wires this into a CLI that reads the SBOM file from disk + a
// CI gate that fails the build on any non-`{ ok: true }` verdict. Mirrors
// `parsePnpmLockfile` from the lockfile-integrity sub-track — the lockfile
// dialect needed a custom YAML state machine; SBOM is JSON, so this slice
// is `JSON.parse` plus three deterministic failure shapes the CLI can map
// to distinct exit codes.
//
// Why a thin wrapper around `JSON.parse` is its own slice: the input
// boundary is where every textual quirk lives — a UTF-8 BOM that
// `cyclonedx-cli` occasionally emits, a zero-byte file from a failed
// generation step, a truncated-download artefact, a non-string passed by
// a buggy caller. Each needs to surface a distinct verdict so the
// slice-≥4 CLI logs the right diagnosis. Inlining a `try { JSON.parse }`
// in the CLI hides those distinctions and makes the failure shape
// untestable without spawning subprocesses.

/**
 * @typedef {(
 *   | { ok: true, parsed: unknown }
 *   | { ok: false, code: string, reason: string }
 * )} ParseResult
 */

/** UTF-8 byte-order-mark — `cyclonedx-cli` v0.27 occasionally emits it. */
const UTF8_BOM = "﻿";

/**
 * Parse on-disk SBOM text into a JS value the slice-1/2 shape functions
 * consume. Strips a leading UTF-8 BOM before parsing. The returned
 * `parsed` is whatever `JSON.parse` produced — `classifySbomShape` /
 * `walkSbomViolations` decide whether that value is a well-formed
 * CycloneDX SBOM.
 *
 * @param {unknown} text
 * @returns {ParseResult}
 */
export function parseSbomJson(text) {
  if (typeof text !== "string") {
    return {
      ok: false,
      code: "non-string-input",
      reason: `parseSbomJson requires a string argument; received ${text === null ? "null" : typeof text}`,
    };
  }
  const stripped = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  if (stripped.trim().length === 0) {
    return {
      ok: false,
      code: "empty-input",
      reason: "SBOM text is empty or whitespace-only",
    };
  }
  try {
    return { ok: true, parsed: JSON.parse(stripped) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "invalid-json",
      reason: `SBOM text is not valid JSON: ${message}`,
    };
  }
}

// Slice 4: CLI driver. ------------------------------------------------------
//
// Wires the slice 1–3 seams (classifier, walker, parser) into a runnable
// CLI: `node scripts/check-sbom-shape.mjs --sbom=<path>` reads the SBOM
// file, parses it via `parseSbomJson`, walks it via `walkSbomViolations`,
// and exits 0 (clean) / 1 (shape violations) / 2 (cannot evaluate). The
// SBOM-generation workflow + CI job that produces the file this CLI
// validates ship in slice ≥5 against this fixed driver. Mirrors
// `runLockfileIntegrityCheck` (slice 4 of the lockfile-integrity sub-
// track) — same `{ exitCode, stdout, stderr, violations }` outcome shape,
// same fail-safe-defaults exit-code split (Saltzer & Schroeder 1975).
//
// Why a dependency-injected reader: the test suite covers every exit path
// (missing file, IO error, parse failure, shape violations, clean) by
// passing a fake `readSbom` — no temporary directories, no file-system
// fixtures. Mirrors the `readTree`/`readBase` pattern in
// `runLockfileIntegrityCheck`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

/**
 * @typedef {object} SbomCheckOutcome
 * @property {0 | 1 | 2} exitCode
 *   `0` = clean (SBOM well-formed or no SBOM to scan).
 *   `1` = SBOM shape violations found.
 *   `2` = the gate cannot evaluate (IO error, parse failure). The
 *          fail-safe-defaults split (Saltzer & Schroeder 1975) makes the
 *          two failure shapes distinguishable in CI: a `1` is "the SBOM
 *          we generated does not match the spec"; a `2` is "we don't
 *          know" (read failed, JSON malformed). Both block the gate.
 * @property {string} stdout    diagnostic suitable for `process.stdout.write`.
 * @property {string} stderr    diagnostic suitable for `process.stderr.write`.
 * @property {SbomViolation[]} violations  exposed for tests.
 */

/**
 * @typedef {object} SbomReaderOk
 * @property {"ok"} kind
 * @property {string} text
 */
/**
 * @typedef {object} SbomReaderMissing
 * @property {"missing"} kind
 */
/**
 * @typedef {object} SbomReaderError
 * @property {"error"} kind
 * @property {string} reason
 */
/** @typedef {SbomReaderOk | SbomReaderMissing | SbomReaderError} SbomReaderResult */

/**
 * Pure driver. Given a reader for the SBOM file, produce the verdict +
 * diagnostic. The CLI's `main()` is a thin wrapper around this — splitting
 * the I/O boundary out lets the test suite cover every exit path without
 * touching the file system.
 *
 * @param {{ readSbom: () => SbomReaderResult, sbomPath: string }} input
 * @returns {SbomCheckOutcome}
 */
export function runSbomShapeCheck({ readSbom, sbomPath }) {
  const result = readSbom();
  if (result.kind === "missing") {
    return {
      exitCode: 0,
      stdout: `sbom-shape skipped: ${sbomPath} not present.\n`,
      stderr: "",
      violations: [],
    };
  }
  if (result.kind === "error") {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `sbom-shape: cannot read ${sbomPath} — ${result.reason}\n`,
      violations: [],
    };
  }

  const parsed = parseSbomJson(result.text);
  if (parsed.ok === false) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `sbom-shape: cannot parse ${sbomPath} — ${parsed.code}: ${parsed.reason}\n`,
      violations: [],
    };
  }

  const { violations } = walkSbomViolations(parsed.parsed);
  if (violations.length === 0) {
    return {
      exitCode: 0,
      stdout: `sbom-shape ok: ${sbomPath} matches CycloneDX 1.5/1.6; 0 violations.\n`,
      stderr: "",
      violations: [],
    };
  }

  const lines = [`sbom-shape: ${violations.length} violation(s) in ${sbomPath}:`];
  for (const v of violations) {
    const prefix = v.path === undefined ? "" : `${v.path}: `;
    lines.push(`  ${prefix}${v.code} — ${v.reason}`);
  }
  lines.push(
    "",
    "Fix one of:",
    "  1. regenerate the SBOM with a `cyclonedx-cli` version that emits",
    "     CycloneDX 1.5 or 1.6 (the allowlist this gate enforces);",
    "  2. update the upstream generator if the violation is a real",
    "     spec-conformance regression (then file an upstream issue);",
    "  3. extend `ALLOWED_SPEC_VERSIONS` if a newer CycloneDX version",
    "     ships and is intentionally adopted (slice 1 verdict-table",
    "     extension, not classifier relaxation).",
    "",
    "See vision.md § 13.5 (security & privacy minimum-bar item #5 —",
    "supply-chain hardening; SBOM shape is the consumer's only structural",
    "guarantee against generator-side regressions).",
    "",
  );

  return {
    exitCode: 1,
    stdout: "",
    stderr: lines.join("\n"),
    violations,
  };
}

/**
 * Parse CLI args. `--sbom=<path>` overrides the default `sbom.cdx.json`;
 * env `SBOM_SHAPE_PATH` is consulted as a fallback. The default name
 * matches what `cyclonedx-cli`'s `--output-file` writes by convention.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]  defaults to `process.env`
 * @returns {{ sbomPath: string }}
 */
export function parseArgs(argv, env = process.env) {
  let sbomPath = env["SBOM_SHAPE_PATH"] ?? "sbom.cdx.json";
  for (const arg of argv) {
    if (arg.startsWith("--sbom=")) {
      sbomPath = arg.slice("--sbom=".length);
    }
  }
  return { sbomPath };
}

/**
 * Read a file from disk into the `SbomReaderResult` shape. `ENOENT` maps
 * to `{ kind: "missing" }` (the fail-safe "no SBOM to scan" signal — the
 * gate exits 0 so a repo without a generation step doesn't perma-fail);
 * any other error maps to `{ kind: "error" }` (the gate exits 2).
 *
 * @param {string} absPath
 * @returns {SbomReaderResult}
 */
function readSbomFile(absPath) {
  try {
    return { kind: "ok", text: readFileSync(absPath, "utf8") };
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === "ENOENT") return { kind: "missing" };
    return { kind: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

function main() {
  const { sbomPath } = parseArgs(process.argv.slice(2));
  const absPath = resolve(process.cwd(), sbomPath);
  const outcome = runSbomShapeCheck({
    readSbom: () => readSbomFile(absPath),
    sbomPath,
  });
  if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
  if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  process.exit(outcome.exitCode);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-sbom-shape.mjs") === true;
if (invokedDirectly) main();
