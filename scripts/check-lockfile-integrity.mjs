#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements parent task `supply-chain-hardening-lockfile-sbom-slsa` § Details (a) — pnpm lockfile integrity classifier -->
// Slice 1 of `supply-chain-hardening-lockfile-sbom-slsa` (TASKS.md): the pure
// lockfile-entry classifier.
//
// `classifyLockfileEntryChange({ before, after })` decides whether a single
// before/after pair of `pnpm-lock.yaml` package entries (for the *same*
// package name) is benign (added, removed, unchanged, or a normal version
// bump where the integrity hash legitimately changed alongside the version)
// or suspicious (the integrity hash changed while the resolved version
// stayed the same — the empirical fingerprint of a hijacked-package
// supply-chain attack: same `pkg@1.2.3`, different SHA, different bytes).
// The classifier is intentionally pure and deterministic; the diff walker
// over `pnpm-lock.yaml`, the CLI, and the CI gate ship in subsequent slices
// against this fixed seam.
//
// The 2025 `chalk` / `debug` incident (vision.md § 13.5) is the load-bearing
// precedent: a maintainer credential was compromised, the attacker
// republished `debug@4.x.x` (and several siblings) under their existing
// version numbers carrying a malicious post-install script. Any consumer
// running `pnpm install` against a stale lockfile that already had that
// `debug@4.x.x` entry was protected — the integrity hash mismatch made
// pnpm refuse the tampered tarball. The class of attacks the gate has to
// catch is the *next* one: a PR that updates `pnpm-lock.yaml` swapping the
// integrity hash for a same-version entry without a corresponding
// `package.json` version bump. That is exactly the verdict this classifier
// emits — `hash-change-without-version-change`. Subsequent slices wire the
// walker that diffs two parsed lockfile snapshots, the CLI that runs the
// classifier over the diff, and the CI gate that fails the PR (with the
// allow-annotation escape hatch in slice 3, mirroring the otel-no-pii /
// scan-secrets relief-valve pattern).
//
// Pre-registered (rule #9 / vision.md § 13.5 supply-chain hardening): pivot
// if the false-positive rate exceeds 1 / month over 3 months — the most
// likely false-positive class is registry-side resolution churn (a registry
// re-uploads the same tarball with a stripped trailing newline, which is
// rare but documented). The relief valve is the per-entry allow-annotation
// (slice 3), not classifier relaxation. Drop the lint only if the verdict
// rate is identically zero for 6 months AND SLSA L3 provenance verification
// (slice 6) is shipped — until then the classifier is the floor.
//
// Pattern: deterministic gate (rule #10), pure function (rule #2 — the
// classifier is the seam, the lockfile-diff walker / CLI / CI gate is the
// boundary). Sibling: `scripts/scan-secrets.mjs` (slice 1 of vision.md §
// 13.1) and `scripts/check-otel-no-pii.mjs` (slice 1 of vision.md § 13.2).
// All three cover one minimum-bar item each via the same
// classifier-then-walker-then-CLI-then-CI-gate spine.
//
// Source: vision.md § 13 "Security & privacy — second priority after
//   performance" (the 8-item minimum bar — supply-chain hardening is item
//   #5); TASKS.md `supply-chain-hardening-lockfile-sbom-slsa` § Details (a);
//   SLSA Specification 1.0 (slsa.dev/spec/v1.0/, 2025) — track 1 "build
//   integrity" identifies tarball-byte tampering as the lowest-effort
//   compromise to detect; CycloneDX 1.5 SBOM specification (the SBOM, not
//   the integrity gate, is the cross-cutting tool — both ship as
//   independent gates per the parent task's pivot clause); npm Subresource
//   Integrity (SRI) format spec (W3C SRI 1.0 — `<algo>-<base64>` shape
//   reproduced by pnpm); the `event-stream` (2018), `ua-parser-js` (2021),
//   `colors.js` (2022), and `debug`/`chalk` (2025) incidents as empirical
//   load-bearing precedent (TASKS.md § Hypothesis); Saltzer & Schroeder
//   1975 "fail-safe defaults" (an integrity-hash mismatch is a hard fail,
//   not a warning); rule #2 (the classifier is the swappable seam — if
//   pnpm v10's lockfile shape changes the field name, only the walker
//   changes, not this function).
// Conformance: full — no I/O, no async, no LLM.

/**
 * The set of integrity-hash algorithms permitted in `pnpm-lock.yaml` per
 * pnpm v9's behaviour and the SRI 1.0 spec. `sha512` is pnpm's default and
 * what the registry returns; `sha384` and `sha256` are accepted for
 * back-compat with older registries. Anything outside this set is treated
 * as malformed (the lockfile cannot have come from a healthy `pnpm install`).
 */
export const ALLOWED_INTEGRITY_ALGORITHMS = Object.freeze(["sha256", "sha384", "sha512"]);

/**
 * SRI hash format: `<algo>-<base64>`. Base64 may contain URL-safe variants
 * (`-` / `_`) per RFC 4648 §5; pnpm emits standard base64 with `+` / `/`
 * but the SRI spec admits both. Trailing `=` padding is permitted, per
 * spec, but not required.
 */
const INTEGRITY_RE = /^(sha256|sha384|sha512)-[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Parse a pnpm specifier (`pkg@version` or `@scope/pkg@version`) into its
 * unversioned name and version. Returns `null` for malformed input — the
 * caller treats that as `malformed-specifier`.
 *
 * @param {string} specifier
 * @returns {{ name: string, version: string } | null}
 */
export function parseSpecifier(specifier) {
  if (typeof specifier !== "string" || specifier.length === 0) {
    return null;
  }
  // Scoped packages start with `@` — find the *last* `@` after position 0.
  // Unscoped packages have exactly one `@` at the boundary.
  const atIndex = specifier.lastIndexOf("@");
  if (atIndex <= 0) {
    // Either no `@` or the only `@` is the leading scope marker.
    return null;
  }
  const name = specifier.slice(0, atIndex);
  const version = specifier.slice(atIndex + 1);
  if (name.length === 0 || version.length === 0) {
    return null;
  }
  return { name, version };
}

/**
 * @typedef {object} LockEntry
 * @property {string} specifier  e.g. `lodash@4.17.21` or `@scope/pkg@1.2.3`.
 * @property {string} integrity  SRI-format hash, e.g. `sha512-AB12...==`.
 */

/**
 * @typedef {{ before: LockEntry | null, after: LockEntry | null }} LockChange
 */

/**
 * @typedef {(
 *   | { ok: true, kind: "unchanged" | "added" | "removed" | "version-bump" }
 *   | { ok: false, code: string, reason: string }
 * )} ClassifyResult
 */

/**
 * Validate the shape of a `LockEntry`: specifier parses, integrity matches
 * the SRI regex. Returns `null` if valid; otherwise a `{ code, reason }`
 * pair describing the malformation.
 *
 * @param {LockEntry} entry
 * @param {"before" | "after"} side
 * @returns {{ code: string, reason: string } | null}
 */
function validateEntry(entry, side) {
  if (typeof entry.specifier !== "string" || entry.specifier.length === 0) {
    return {
      code: "malformed-specifier",
      reason: `${side}.specifier must be a non-empty string`,
    };
  }
  if (parseSpecifier(entry.specifier) === null) {
    return {
      code: "malformed-specifier",
      reason: `${side}.specifier "${entry.specifier}" is not a valid pkg@version`,
    };
  }
  if (typeof entry.integrity !== "string" || entry.integrity.length === 0) {
    return {
      code: "missing-integrity",
      reason: `${side} entry has no integrity hash`,
    };
  }
  if (!INTEGRITY_RE.test(entry.integrity)) {
    return {
      code: "malformed-integrity",
      reason: `${side}.integrity "${entry.integrity}" is not SRI <algo>-<base64>`,
    };
  }
  return null;
}

/**
 * Both-sided classification: both `before` and `after` are non-null. Split
 * out so `classifyLockfileEntryChange`'s top-level branching stays under
 * the cognitive-complexity cap (rule #2 / Biome).
 *
 * @param {LockEntry} before
 * @param {LockEntry} after
 * @returns {ClassifyResult}
 */
function classifyBothSided(before, after) {
  const vBefore = validateEntry(before, "before");
  if (vBefore !== null) return { ok: false, ...vBefore };
  const vAfter = validateEntry(after, "after");
  if (vAfter !== null) return { ok: false, ...vAfter };

  const parsedBefore = parseSpecifier(before.specifier);
  const parsedAfter = parseSpecifier(after.specifier);
  // validateEntry already accepted these — parseSpecifier returns non-null.
  // The runtime check is a let-it-crash hedge for callers that bypass the
  // validator (rule #6).
  if (parsedBefore === null || parsedAfter === null) {
    return {
      ok: false,
      code: "malformed-specifier",
      reason: "unreachable: parseSpecifier null after validateEntry pass",
    };
  }

  if (parsedBefore.name !== parsedAfter.name) {
    return {
      ok: false,
      code: "name-mismatch",
      reason: `before.name="${parsedBefore.name}" !== after.name="${parsedAfter.name}"`,
    };
  }

  const versionChanged = parsedBefore.version !== parsedAfter.version;
  const integrityChanged = before.integrity !== after.integrity;

  if (!versionChanged && !integrityChanged) return { ok: true, kind: "unchanged" };
  if (versionChanged && integrityChanged) return { ok: true, kind: "version-bump" };

  if (integrityChanged) {
    return {
      ok: false,
      code: "hash-change-without-version-change",
      reason: `${parsedBefore.name}@${parsedBefore.version}: integrity changed (${before.integrity.slice(0, 10)}… → ${after.integrity.slice(0, 10)}…) without a version bump — possible supply-chain attack`,
    };
  }

  return {
    ok: false,
    code: "version-change-without-hash-change",
    reason: `${parsedBefore.name}: ${parsedBefore.version} → ${parsedAfter.version} but integrity unchanged — cryptographically impossible for distinct tarballs`,
  };
}

/**
 * Pure classifier. Given a before/after pair of lockfile entries (for the
 * *same* package name), classify the change.
 *
 * Verdicts:
 *   - `{ ok: true, kind: "unchanged" }` — same specifier + same integrity.
 *   - `{ ok: true, kind: "added" }` — before is null, after is valid.
 *   - `{ ok: true, kind: "removed" }` — before is valid, after is null.
 *   - `{ ok: true, kind: "version-bump" }` — versions differ AND integrity
 *     also differs (the legitimate, expected shape of a `pnpm update`).
 *   - `{ ok: false, code: "hash-change-without-version-change" }` — same
 *     specifier (same name + same version) but integrity differs. This is
 *     the supply-chain-attack fingerprint the gate exists to catch.
 *   - `{ ok: false, code: "version-change-without-hash-change" }` — versions
 *     differ but integrity is identical. Cryptographically impossible for
 *     legitimate, distinct tarballs; signals a malformed or hand-edited
 *     lockfile.
 *   - `{ ok: false, code: "name-mismatch" }` — caller passed entries for
 *     two different package names (programming error in the walker).
 *   - `{ ok: false, code: "no-change" }` — both `before` and `after` are
 *     null (programming error in the walker).
 *   - `{ ok: false, code: "malformed-specifier" | "missing-integrity" |
 *     "malformed-integrity" }` — input violates the LockEntry shape.
 *
 * @param {LockChange} change
 * @returns {ClassifyResult}
 */
/**
 * One-sided classification: exactly one of `before` / `after` is non-null.
 * Returns `null` if the caller passed two nulls (the parent function emits
 * the `no-change` verdict in that case).
 *
 * @param {LockEntry | null} before
 * @param {LockEntry | null} after
 * @returns {ClassifyResult | null}
 */
function classifyOneSided(before, after) {
  if (before === null && after !== null) {
    const v = validateEntry(after, "after");
    return v === null ? { ok: true, kind: "added" } : { ok: false, ...v };
  }
  if (before !== null && after === null) {
    const v = validateEntry(before, "before");
    return v === null ? { ok: true, kind: "removed" } : { ok: false, ...v };
  }
  return null;
}

/**
 * Pure classifier. See the verdict table in the script header.
 *
 * @param {LockChange} change
 * @returns {ClassifyResult}
 */
export function classifyLockfileEntryChange(change) {
  if (change === null || typeof change !== "object") {
    return {
      ok: false,
      code: "malformed-input",
      reason: "classifyLockfileEntryChange requires { before, after }",
    };
  }
  const { before, after } = change;

  if (before === null && after === null) {
    return {
      ok: false,
      code: "no-change",
      reason: "before and after are both null — caller passed an empty change",
    };
  }

  const oneSided = classifyOneSided(before, after);
  if (oneSided !== null) return oneSided;

  // Both non-null after the early returns above; the runtime guards keep
  // the type-narrowing honest without a non-null assertion.
  if (before === null || after === null) {
    return {
      ok: false,
      code: "malformed-input",
      reason: "unreachable: null after dual-presence guard",
    };
  }
  return classifyBothSided(before, after);
}

/**
 * Format a verdict for diagnostic output (CLI / CI annotation). Stable
 * across versions; downstream tooling pins to the leading `[ok]` / `[fail]`
 * tokens.
 *
 * @param {ClassifyResult} result
 * @param {string} [packageName]
 * @returns {string}
 */
export function formatVerdict(result, packageName) {
  const tag = packageName ? `[${packageName}] ` : "";
  if (result.ok === true) {
    return `[ok] ${tag}${result.kind}`;
  }
  return `[fail] ${tag}${result.code}: ${result.reason}`;
}
