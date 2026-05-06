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
