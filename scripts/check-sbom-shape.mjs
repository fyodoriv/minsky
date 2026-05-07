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
// Slice 2 adds `walkSbomViolations(parsed)` — the pure aggregating walker
// that runs the slice-1 verdict logic over every component and collects ALL
// violations rather than short-circuiting on the first failure. The slice-1
// classifier deliberately exits on the first per-component error (so a
// malformed-components rejection is the fastest path to a clear actionable
// verdict for an interactive user); the walker is the seam the CI gate
// consumes so a release with eight malformed component entries surfaces all
// eight in one log line, not eight successive PR runs. Mirrors
// `walkLockfileChanges` (slice 2 of the lockfile-integrity sub-track) and
// `extractAttributeViolations` (slice 2 of vision.md § 13.2 OTEL no-PII).
//
// Slice 3 (this file): adds `parseSbomJson(text)` — the pure JSON-text-to-
// `unknown`-object wrapper around `JSON.parse` that produces a structured
// `{ ok, code, reason }` verdict on parse failure (matching the slice-1 /
// slice-2 verdict shape) and an early-out for empty / whitespace-only input.
// The seam slice 4 (CLI + CI gate) needs is exactly this: text from disk →
// uniform verdict surface → slice-2 walker. Mirrors `parsePnpmLockfile`
// (slice 3 of the lockfile-integrity sub-track, PR #265). See the dedicated
// header comment over `parseSbomJson` below for the full rationale.
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

// Slice 3: pure SBOM JSON parser. --------------------------------------------
//
// `parseSbomJson(text)` turns an on-disk CycloneDX SBOM (a UTF-8 JSON string)
// into the `unknown` shape `classifySbomShape` / `walkSbomViolations` consume.
// JSON.parse already does the heavy lifting — unlike pnpm-lock.yaml's slice 3
// (where avoiding a 30-KLOC YAML library was load-bearing), there is no
// custom-grammar work to do here. The seam this slice ships is the *verdict
// surface*: a SyntaxError from `JSON.parse` becomes a structured
// `{ ok: false, code: "invalid-json" }` result with the same shape the
// classifier and walker emit, so slice 4 (CLI + CI gate) can format every
// failure mode — bad JSON, bad envelope, bad component — through one printer.
//
// The slice-1 / slice-2 classifier-then-walker rejects only *parsed* objects;
// without this slice, the CLI would have to wrap `JSON.parse` in its own
// try/catch and invent an ad-hoc error code, duplicating the verdict
// vocabulary and drifting from the slice-1 table. Putting the parse step
// under the same `{ ok, code, reason }` discipline keeps the four sub-tracks'
// output formats uniform (compare `parsePnpmLockfile` returning a structured
// shape, not throwing).
//
// Why a wrapper at all (vs. calling `JSON.parse` from slice 4 directly):
//   - empty / whitespace-only input is an early-out the CLI shouldn't have to
//     re-derive — `cyclonedx-cli` regressions have shipped that produced a
//     zero-byte file in CI; that's a parser-level verdict, not "JSON parse
//     error: Unexpected end of input".
//   - The error message from `JSON.parse` varies across runtimes (V8 vs.
//     SpiderMonkey vs. JSC) and minor versions — the gate's CI log line must
//     be deterministic so log-grep-based monitors don't false-positive on
//     a Node minor bump. Wrapping into `code: "invalid-json"` with a stable
//     `reason` template (the underlying error message preserved as the tail)
//     anchors the prefix.
//
// What this slice does NOT do (slice 4):
//   - Read the SBOM file from disk (`fs.readFileSync`).
//   - Resolve the SBOM path relative to a workflow / repo root.
//   - Print formatted output or set a process exit code.
//   - Run the walker over the parsed result (the caller chains
//     `parseSbomJson(text)` → `walkSbomViolations(parsed)` explicitly so
//     parser-level failures and shape-level failures stay distinguishable).
//
// Pattern: deterministic gate (rule #10), pure function (rule #2 — text in,
// `{ ok, parsed }` or `{ ok, code, reason }` out, no I/O). Mirrors
// `parsePnpmLockfile` (slice 3 of vision.md § 13.5 lockfile sub-track) and
// `parseAttribute` (slice 3 of vision.md § 13.2 OTEL no-PII).
//
// Source: ECMA-404 (the JSON Data Interchange Standard, 2017) — JSON.parse
//   conformance; CycloneDX 1.5 / 1.6 specs (cyclonedx.org/docs/, 2023-2024) —
//   the spec mandates JSON or XML serialization; this gate covers the JSON
//   serialization only. Sibling: `parsePnpmLockfile` (scripts/check-lockfile-
//   integrity.mjs slice 3, PR #265). vision.md § 13.5 (supply-chain
//   hardening — SBOM is item #5 of the minimum bar).

/**
 * @typedef {(
 *   | { ok: true, parsed: unknown }
 *   | { ok: false, code: "empty-input" | "invalid-json", reason: string }
 * )} ParseSbomResult
 */

/**
 * Parse a CycloneDX SBOM from its on-disk JSON serialization. Pure: takes
 * the file's text and returns either the parsed object or a structured
 * verdict with the same `{ ok: false, code, reason }` shape the slice-1
 * classifier and slice-2 walker emit.
 *
 * Empty / whitespace-only input is short-circuited to `code: "empty-input"`
 * so a zero-byte SBOM produced by a `cyclonedx-cli` regression surfaces a
 * specific actionable verdict instead of an opaque "Unexpected end of JSON
 * input". All other parse failures (malformed JSON, truncated file,
 * embedded NULs, …) collapse into `code: "invalid-json"` with the
 * underlying error message preserved as the verdict's tail; the prefix is
 * stable across Node versions so log-grep monitors don't flap.
 *
 * @param {string} text  The SBOM file's text (UTF-8 decoded by the caller).
 * @returns {ParseSbomResult}
 */
export function parseSbomJson(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return {
      ok: false,
      code: "empty-input",
      reason: "SBOM input is empty or whitespace-only",
    };
  }
  try {
    return { ok: true, parsed: JSON.parse(text) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "invalid-json",
      reason: `SBOM is not valid JSON: ${detail}`,
    };
  }
}
