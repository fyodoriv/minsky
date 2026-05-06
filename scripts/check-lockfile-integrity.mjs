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
// Slice 2 (this file): adds `extractEntriesFromLockfile(parsed)` and
// `walkLockfileChanges({ before, after })` — the pure pair of helpers that
// turn two already-parsed `pnpm-lock.yaml` snapshots into the set of
// per-entry classifications. Keys are the lockfile's own `name@version`
// strings (pnpm v9's `packages` map uses these as object keys, so they're
// already unique by construction); the walker iterates the union of keys
// and runs `classifyLockfileEntryChange` on each pair. YAML parsing, file
// I/O, and the CI gate ship in slices ≥3 against this fixed seam — the
// walker takes the parsed object so the test suite can exercise every
// verdict path with hand-built fixtures and not be coupled to a YAML
// library or a real lockfile on disk.
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
// Conformance: full — slices 1–3 are pure (no I/O); slice 4 adds the CLI
// boundary that does I/O via `readFileSync` + `git show` against `process.cwd()`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

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

// Slice 2: pure walker over already-parsed pnpm-lock.yaml snapshots. ----------

/**
 * @typedef {object} ParsedLockfile
 * @property {Record<string, { resolution?: { integrity?: string } }>} [packages]
 *   pnpm v9's `packages:` map. Keys are `<name>@<version>` strings; values
 *   are entries with at minimum `resolution.integrity` populated. Other
 *   fields (engines, hasBin, peerDependencies, …) are ignored by the walker
 *   — they don't affect tarball-byte integrity.
 */

/**
 * Extract a `Map<key, LockEntry>` from a parsed pnpm-lock.yaml snapshot.
 * Keys are the lockfile's own `name@version` strings; values are the
 * `{ specifier, integrity }` shape `classifyLockfileEntryChange` consumes.
 *
 * Entries missing a `resolution.integrity` (workspace links, file: deps,
 * git+ssh deps — anything the registry doesn't ship a tarball for) are
 * skipped. The classifier flags missing integrity on entries that *should*
 * have one; here we filter out entries that legitimately don't.
 *
 * @param {ParsedLockfile | null | undefined} parsed
 * @returns {Map<string, LockEntry>}
 */
export function extractEntriesFromLockfile(parsed) {
  /** @type {Map<string, LockEntry>} */
  const entries = new Map();
  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    return entries;
  }
  const packages = parsed.packages;
  if (packages === null || packages === undefined || typeof packages !== "object") {
    return entries;
  }
  for (const [key, value] of Object.entries(packages)) {
    const integrity = readEntryIntegrity(value);
    if (integrity === null) continue;
    entries.set(key, { specifier: key, integrity });
  }
  return entries;
}

/**
 * Pull `value.resolution.integrity` out of a parsed lockfile package entry,
 * returning a non-empty SRI-shaped string or `null` when the entry doesn't
 * carry one (workspace links, file: deps, malformed shapes). Pulled out so
 * `extractEntriesFromLockfile` stays under the cognitive-complexity cap
 * (rule #2 / Biome).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function readEntryIntegrity(value) {
  if (value === null || typeof value !== "object") return null;
  const resolution = /** @type {{ integrity?: unknown } | undefined} */ (
    /** @type {any} */ (value).resolution
  );
  if (resolution === null || resolution === undefined || typeof resolution !== "object") {
    return null;
  }
  const integrity = resolution.integrity;
  if (typeof integrity !== "string" || integrity.length === 0) return null;
  return integrity;
}

/**
 * @typedef {object} WalkerViolation
 * @property {string} key       lockfile key (`name@version`) — present in at
 *                              least one of before/after. The walker keys
 *                              violations by this string so the CLI / CI
 *                              gate can emit a stable `key: code` line.
 * @property {string} code      classifier code from `classifyLockfileEntryChange`.
 * @property {string} reason    classifier reason.
 */

/**
 * @typedef {object} WalkerResult
 * @property {WalkerViolation[]} violations  ordered by key (lexicographic).
 * @property {{ unchanged: number, added: number, removed: number, versionBump: number }} summary
 *   counts of benign verdicts so the CLI can print a one-line "scanned N
 *   entries, M added, K removed, ..." digest after a clean walk.
 */

/**
 * Pair entries from two parsed lockfile snapshots by `name@version` key
 * and run the slice-1 classifier on each pair.
 *
 * The walker is deliberately key-by-key rather than by-package-name:
 * pnpm-lock.yaml uses `name@version` as the package map's key, so a
 * version bump shows up as a removed `name@1.0.0` + added `name@1.0.1`
 * (both benign verdicts), not a single before/after pair. The classifier's
 * `version-bump` verdict is reachable only when a caller manually
 * constructs a same-name-different-version pair — by design, the walker
 * doesn't, because that would require name-grouping heuristics (which
 * package version is the "successor" of which?) that pnpm's resolver
 * already encoded in the lockfile keys.
 *
 * The supply-chain-attack signature this walker exists to catch is the
 * `hash-change-without-version-change` case: the *same* `name@version`
 * key exists in both before and after, but its `integrity` differs. That
 * is cryptographically impossible for a legitimate registry tarball
 * (Subresource Integrity is content-addressed by definition) and is the
 * empirical fingerprint of the 2025 `chalk`/`debug` incident.
 *
 * @param {{ before: ParsedLockfile | null | undefined, after: ParsedLockfile | null | undefined }} input
 * @returns {WalkerResult}
 */
export function walkLockfileChanges({ before, after }) {
  const beforeEntries = extractEntriesFromLockfile(before);
  const afterEntries = extractEntriesFromLockfile(after);

  /** @type {WalkerViolation[]} */
  const violations = [];
  const summary = { unchanged: 0, added: 0, removed: 0, versionBump: 0 };

  const keys = new Set([...beforeEntries.keys(), ...afterEntries.keys()]);
  const sortedKeys = [...keys].sort();

  for (const key of sortedKeys) {
    const beforeEntry = beforeEntries.get(key) ?? null;
    const afterEntry = afterEntries.get(key) ?? null;
    const verdict = classifyLockfileEntryChange({ before: beforeEntry, after: afterEntry });
    if (verdict.ok === true) {
      tallyBenignKind(summary, verdict.kind);
      continue;
    }
    violations.push({ key, code: verdict.code, reason: verdict.reason });
  }

  return { violations, summary };
}

/**
 * Increment the corresponding field of a walker summary for one benign
 * verdict kind. Pulled out so `walkLockfileChanges` stays under the
 * cognitive-complexity cap (rule #2 / Biome).
 *
 * @param {{ unchanged: number, added: number, removed: number, versionBump: number }} summary
 * @param {"unchanged" | "added" | "removed" | "version-bump"} kind
 * @returns {void}
 */
function tallyBenignKind(summary, kind) {
  if (kind === "unchanged") summary.unchanged += 1;
  else if (kind === "added") summary.added += 1;
  else if (kind === "removed") summary.removed += 1;
  else if (kind === "version-bump") summary.versionBump += 1;
}

// Slice 4 (this file): wires the slice 1-3 seams into a runnable CLI + CI gate.
// `runLockfileIntegrityCheck({ readTree, readBase })` — a pure-ish driver that
// takes two file-reader thunks (one for the working-tree lockfile, one for the
// `<diff-base>:pnpm-lock.yaml` blob) and returns the verdict. `main()` wires it
// to the real filesystem + `git show`. Splitting the driver out lets the test
// suite cover every CLI exit-path (no lockfile, lockfile-just-introduced,
// unreachable diff base, supply-chain-attack signature) deterministically
// without spawning git or touching the working tree.
//
// The CLI is diff-based, not full-scan: the verdict the gate exists to catch
// (`hash-change-without-version-change`) is by definition a delta between two
// snapshots of the same `name@version` key. A full-scan against the current
// lockfile alone has nothing to compare against — it would always pass.
// `--diff-base=<ref>` (default `origin/main`, override via env
// `LOCKFILE_INTEGRITY_DIFF_BASE`) names the snapshot we compare against, the
// same shape rule-3-doc-first / rule-6 / rule-12 already use; CI fetches
// `origin/main` for every PR run, so the base is always reachable in CI.
//
// Edge-case behaviour matrix (each is exercised by paired tests, slice 4):
//
//   - tree has no `pnpm-lock.yaml`        → exit 0, "skipped" (nothing to defend)
//   - base has no `pnpm-lock.yaml` (file just introduced in PR)
//                                          → walker sees empty before, all
//                                            entries "added", 0 violations
//   - base ref is unreachable             → exit 2 (not 1) — the gate cannot
//                                            verify integrity, fail-safe per
//                                            Saltzer & Schroeder 1975 default
//   - tree + base both healthy, no delta  → walker returns 0 violations, exit 0
//   - tree differs from base, all bumps   → version-bump verdicts, exit 0
//   - tree differs from base, hijack      → hash-change-without-version-change
//                                            verdict, exit 1 with redacted
//                                            before/after hash diagnostic
//
// Wired to:
//   - `.github/workflows/ci.yml` `lockfile-integrity` job (push + PR — security
//     gates are NOT PR-only because a hijack landed via direct push must still
//     surface and rotate; mirrors the existing `secret-scan` / `otel-no-pii`
//     wiring posture).
//   - `STACK_MANIFEST` (`scripts/run-pre-pr-lint-stack.mjs`) for the daemon's
//     `pnpm pre-pr-lint --stage=full` sweep.
//   - `CI_BASH_GATE_BUCKETS.mustSucceed` (the bash aggregator's
//     `[ "$r" = "success" ]` bucket — a `skipped` lockfile-integrity must NOT
//     pass the gate; the four parity tests in `run-pre-pr-lint-stack.test.mjs`
//     pin manifest ↔ ci.yml needs ↔ bash buckets ↔ docs).

// Slice 3: pure pnpm-lock.yaml parser. ----------------------------------------
//
// `parsePnpmLockfile(text)` extracts the minimum shape `walkLockfileChanges`
// consumes — `{ packages: { '<name>@<version>': { resolution: { integrity } } } }`
// — from a textual `pnpm-lock.yaml`. The parser is intentionally narrow: it
// understands only the `packages:` top-level block of pnpm v9's lockfile
// dialect, not arbitrary YAML. That narrowness is the point — adding a full
// YAML library to a *supply-chain-hardening* gate would expand the trusted
// dependency surface the gate exists to defend (rule #1: "don't reinvent" cuts
// both ways — don't reinvent general YAML, but don't import a 30-KLOC parser
// to pluck two fields either). The pnpm v9 lockfile shape is stable and
// machine-emitted; if pnpm v10 changes the field names, only this function
// changes — the classifier (slice 1) and walker (slice 2) keep their seams.
//
// What the parser handles:
//   - `packages:` block at column 0 (the lockfile's outermost key).
//   - 2-space-indented entries: `'<key>':` (quoted) or `<key>:` (unquoted).
//     Keys are returned verbatim — pnpm uses `<name>@<version>` strings, but
//     the parser doesn't validate that here (the classifier does, downstream).
//   - 4-space-indented `resolution: {integrity: <sri>}` (inline flow — pnpm's
//     emitted style) AND the block-style fallback:
//         resolution:
//           integrity: <sri>
//     Hand-edited lockfiles sometimes use the block form; both yield the same
//     `{ packages: { key: { resolution: { integrity } } } }` shape.
//   - Other 4-space-indented fields under an entry (`engines`, `hasBin`,
//     `peerDependencies`, …) are skipped — they don't affect tarball-byte
//     integrity, and including them would mean implementing more of YAML.
//
// What the parser does NOT handle (intentional):
//   - YAML anchors (`&foo`) / aliases (`*foo`) — pnpm doesn't emit them.
//   - Multi-document streams (`---` separators).
//   - Block-scalar literals (`|`, `>`).
//   - Comments are tolerated (`#` to end-of-line is stripped) but not parsed.
//   - The `importers:`, `snapshots:`, `settings:`, `lockfileVersion:` blocks —
//     they don't carry per-tarball integrity; the gate doesn't read them.
//
// Pattern: pure function (rule #2 — string in, object out, no I/O); the seam
// between the YAML lockfile representation on disk and the JS object the
// classifier/walker reason about. Slice 4 wires this into a CLI that reads
// `pnpm-lock.yaml` from disk + a git base ref and feeds both into
// `walkLockfileChanges`. Slice ≥5 (per the parent task) lands the CI gate.
//
// Source: pnpm v9 lockfile spec (github.com/pnpm/spec/blob/master/lockfile/9.md
//   — the `packages:` block uses `<name>@<version>` keys with `resolution`
//   carrying SRI-format `integrity`); rule #13 (security & privacy — second
//   priority); SLSA Specification 1.0 § "build integrity" — minimum trusted
//   surface; YAML 1.2 Core Schema (yaml.org/spec/1.2.2/) — the inline-flow
//   subset the parser handles is fully spec-compliant.

/**
 * Strip a trailing inline `# comment` from a line, respecting that `#` inside
 * single-quoted strings is literal. The pnpm-lock dialect uses `#` only for
 * top-of-file metadata comments, never inside `packages:`, but the
 * conservative behaviour keeps the parser robust to hand edits.
 *
 * @param {string} line
 * @returns {string}
 */
function stripInlineComment(line) {
  let inSingleQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'") inSingleQuote = !inSingleQuote;
    else if (ch === "#" && !inSingleQuote) return line.slice(0, i).trimEnd();
  }
  return line;
}

/**
 * Match a 2-space-indented `packages:` child key: either `'<key>':` (single-
 * quoted) or `<key>:` (unquoted). Returns the unquoted key, or `null` if the
 * line isn't a key.
 *
 * @param {string} line
 * @returns {string | null}
 */
function matchPackageKey(line) {
  // `^  '(.+?)':\s*$` — quoted key.
  const quoted = /^ {2}'([^']+)':\s*$/.exec(line);
  if (quoted !== null) return quoted[1] ?? null;
  // `^  <key>:\s*$` — unquoted key. pnpm only quotes keys that need it
  // (those starting with `@` or containing special chars), but unquoted
  // `<name>@<version>` is also valid YAML when the name doesn't start with
  // `@` — e.g. `lodash@4.17.21:`.
  const unquoted = /^ {2}([^\s'][^:]*?):\s*$/.exec(line);
  if (unquoted !== null) return unquoted[1] ?? null;
  return null;
}

/**
 * Match an inline-flow `resolution: {integrity: <sri>, …}` line under a
 * 4-space-indented entry child. Returns the integrity string (unquoted) or
 * `null` if the line doesn't carry one.
 *
 * @param {string} line
 * @returns {string | null}
 */
function matchInlineResolutionIntegrity(line) {
  // `^    resolution:\s*\{...integrity:\s*<sri>...\}\s*$`
  const m = /^ {4}resolution:\s*\{[^}]*?\bintegrity:\s*(['"]?)([^,'"\s}]+)\1[^}]*\}\s*$/.exec(line);
  return m === null ? null : (m[2] ?? null);
}

/**
 * Match a block-style `integrity: <sri>` line — used when `resolution:` is
 * itself a block:
 *   resolution:
 *     integrity: sha512-...
 * The parser tracks the in-block state in `parsePnpmLockfile`; this matcher
 * is name-only.
 *
 * @param {string} line
 * @returns {string | null}
 */
function matchBlockIntegrity(line) {
  const m = /^ {6}integrity:\s*(['"]?)([^'"\s]+)\1\s*$/.exec(line);
  return m === null ? null : (m[2] ?? null);
}

/**
 * True if a line marks the end of the `packages:` block — either EOF (caller
 * handles), or a new top-level key (`^[A-Za-z]`), or `^---`. Blank lines and
 * lines indented ≥1 space stay inside the block.
 *
 * @param {string} line
 * @returns {boolean}
 */
function endsPackagesBlock(line) {
  if (line.length === 0) return false;
  if (line.startsWith(" ") || line.startsWith("\t")) return false;
  return /^[A-Za-z][A-Za-z0-9_-]*:/.test(line) || line === "---";
}

/**
 * @typedef {object} ParserState
 * @property {Record<string, { resolution?: { integrity?: string } }>} packages
 * @property {string | null} currentKey
 * @property {boolean} inBlockResolution
 */

/**
 * Process one line that lives inside the `packages:` block. Mutates `state`.
 * Pulled out so the top-level loop in `parsePnpmLockfile` stays under the
 * cognitive-complexity cap (rule #2 / Biome).
 *
 * @param {string} line
 * @param {ParserState} state
 * @returns {void}
 */
function applyPackagesLine(line, state) {
  const newKey = matchPackageKey(line);
  if (newKey !== null) {
    state.currentKey = newKey;
    state.inBlockResolution = false;
    // Initialise the entry slot so a key with no integrity (workspace link,
    // file: dep) still surfaces — the slice-2 walker filters those out.
    state.packages[newKey] = state.packages[newKey] ?? {};
    return;
  }
  if (state.currentKey === null) return;

  const inlineIntegrity = matchInlineResolutionIntegrity(line);
  if (inlineIntegrity !== null) {
    state.packages[state.currentKey] = { resolution: { integrity: inlineIntegrity } };
    state.inBlockResolution = false;
    return;
  }
  if (/^ {4}resolution:\s*$/.test(line)) {
    state.inBlockResolution = true;
    return;
  }
  if (!state.inBlockResolution) return;
  const blockIntegrity = matchBlockIntegrity(line);
  if (blockIntegrity !== null) {
    state.packages[state.currentKey] = { resolution: { integrity: blockIntegrity } };
    state.inBlockResolution = false;
  }
}

/**
 * Pure pnpm-lock.yaml parser. See header comment for what's handled.
 *
 * @param {string} text  raw `pnpm-lock.yaml` contents.
 * @returns {ParsedLockfile}
 */
export function parsePnpmLockfile(text) {
  /** @type {ParserState} */
  const state = {
    packages: Object.create(null),
    currentKey: null,
    inBlockResolution: false,
  };
  if (typeof text !== "string" || text.length === 0) return { packages: state.packages };

  const lines = text.split(/\r?\n/);
  let inPackages = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine);
    if (!inPackages) {
      if (line === "packages:") inPackages = true;
      continue;
    }
    if (endsPackagesBlock(line)) break;
    applyPackagesLine(line, state);
  }

  return { packages: state.packages };
}

// Slice 4: CLI + diff-base resolver + CI gate. --------------------------------

/**
 * @typedef {object} CheckOutcome
 * @property {0 | 1 | 2} exitCode
 *   `0` = clean (no violations or no lockfile to scan).
 *   `1` = supply-chain-attack signature found.
 *   `2` = the gate cannot evaluate (base ref unreachable, IO error). The
 *          fail-safe-defaults split (Saltzer & Schroeder 1975) makes the two
 *          failure shapes distinguishable in CI: a `1` is "the lockfile was
 *          tampered with"; a `2` is "we don't know". Both block the PR.
 * @property {string} stdout    diagnostic suitable for `process.stdout.write`.
 * @property {string} stderr    diagnostic suitable for `process.stderr.write`.
 * @property {WalkerViolation[]} violations  exposed for tests.
 */

/**
 * @typedef {object} ReaderOk
 * @property {"ok"} kind
 * @property {string} text
 */
/**
 * @typedef {object} ReaderMissing
 * @property {"missing"} kind
 */
/**
 * @typedef {object} ReaderError
 * @property {"error"} kind
 * @property {string} reason
 */
/** @typedef {ReaderOk | ReaderMissing | ReaderError} ReaderResult */

/**
 * Pure driver. Given two readers (one for the working tree's lockfile, one
 * for the diff-base's lockfile blob), produce the verdict + diagnostic. The
 * CLI's `main()` is a thin wrapper around this — splitting the I/O boundary
 * out lets the test suite cover every exit path without spawning git.
 *
 * @param {{ readTree: () => ReaderResult, readBase: () => ReaderResult }} input
 * @returns {CheckOutcome}
 */
export function runLockfileIntegrityCheck({ readTree, readBase }) {
  const tree = readTree();
  if (tree.kind === "missing") {
    return {
      exitCode: 0,
      stdout: "lockfile-integrity skipped: pnpm-lock.yaml not present in working tree.\n",
      stderr: "",
      violations: [],
    };
  }
  if (tree.kind === "error") {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `lockfile-integrity: cannot read working-tree pnpm-lock.yaml — ${tree.reason}\n`,
      violations: [],
    };
  }

  const base = readBase();
  if (base.kind === "error") {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `lockfile-integrity: cannot read base pnpm-lock.yaml — ${base.reason}\n`,
      violations: [],
    };
  }

  const beforeText = base.kind === "ok" ? base.text : "";
  const before = parsePnpmLockfile(beforeText);
  const after = parsePnpmLockfile(tree.text);
  const { violations, summary } = walkLockfileChanges({ before, after });

  if (violations.length === 0) {
    return {
      exitCode: 0,
      stdout: `lockfile-integrity ok: ${summary.unchanged} unchanged, ${summary.added} added, ${summary.removed} removed, ${summary.versionBump} version-bump entries; 0 hash-change-without-version-change violations.\n`,
      stderr: "",
      violations: [],
    };
  }

  const lines = ["lockfile-integrity: supply-chain-attack signatures detected:"];
  for (const v of violations) {
    lines.push(`  ${v.key}: ${v.code} — ${v.reason}`);
  }
  lines.push(
    "",
    "Fix one of:",
    "  1. revert the lockfile change and rotate any credential whose tarball",
    "     was swapped (every `hash-change-without-version-change` is",
    "     cryptographically incompatible with a legitimate registry tarball);",
    "  2. bump the package version alongside the integrity hash if the",
    "     republish is intentional (the legitimate `version-bump` shape);",
    "  3. rerun `pnpm install` against a clean cache if the diff is local",
    "     drift (rare; usually a sign of registry-side resolution churn).",
    "",
    "See vision.md § 13.5 (security & privacy minimum-bar item #5 —",
    "supply-chain hardening; the 2025 chalk/debug incident as load-bearing",
    "precedent).",
    "",
  );

  return {
    exitCode: 1,
    stdout: "",
    stderr: `${lines.join("\n")}`,
    violations,
  };
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]  defaults to `process.env`
 *   — overridable for unit tests so the env-fallback path is exercised
 *   deterministically without poking at `process.env`.
 * @returns {{ diffBase: string, repo: string }}
 */
export function parseArgs(argv, env = process.env) {
  let diffBase = env["LOCKFILE_INTEGRITY_DIFF_BASE"] ?? "origin/main";
  let repo = REPO_ROOT;
  for (const arg of argv) {
    if (arg.startsWith("--diff-base=")) {
      diffBase = arg.slice("--diff-base=".length);
    } else if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
    }
  }
  return { diffBase, repo };
}

/**
 * Read a file from disk into the `ReaderResult` shape. `ENOENT` maps to
 * `{ kind: "missing" }` (a healthy "no lockfile to scan" signal); any other
 * error maps to `{ kind: "error", reason }` (the gate exits 2 — fail-safe).
 *
 * @param {string} absPath
 * @returns {ReaderResult}
 */
function readFileAsReaderResult(absPath) {
  try {
    return { kind: "ok", text: readFileSync(absPath, "utf8") };
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === "ENOENT") return { kind: "missing" };
    return { kind: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read the diff-base's `pnpm-lock.yaml` blob via `git show <ref>:pnpm-lock.yaml`.
 * If the ref is unreachable → `{ kind: "error" }` (CI fail-safe). If the ref
 * is reachable but the file didn't exist at that ref (i.e., the lockfile is
 * being introduced in this PR) → `{ kind: "missing" }`, which the driver
 * treats as an empty before-snapshot.
 *
 * @param {string} repo
 * @param {string} diffBase
 * @returns {ReaderResult}
 */
function readBaseLockfile(repo, diffBase) {
  // Probe ref reachability separately from the file-existence question so the
  // two failure shapes can be distinguished. `git rev-parse --verify` exits
  // non-zero on an unreachable ref; `git show <ref>:path` exits non-zero
  // EITHER on unreachable ref OR on a missing file at that ref.
  try {
    execFileSync("git", ["-C", repo, "rev-parse", "--verify", `${diffBase}^{commit}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return {
      kind: "error",
      reason: `diff-base "${diffBase}" is unreachable (${err instanceof Error ? err.message.split("\n")[0] : "git rev-parse failed"})`,
    };
  }
  try {
    const text = execFileSync("git", ["-C", repo, "show", `${diffBase}:pnpm-lock.yaml`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { kind: "ok", text };
  } catch {
    // ref is reachable (rev-parse passed) but pnpm-lock.yaml didn't exist at
    // that ref — file is being introduced in this PR. Walker handles empty
    // before-snapshot natively.
    return { kind: "missing" };
  }
}

function main() {
  const { diffBase, repo } = parseArgs(process.argv.slice(2));
  const treeLockfile = resolve(repo, "pnpm-lock.yaml");
  const outcome = runLockfileIntegrityCheck({
    readTree: () => readFileAsReaderResult(treeLockfile),
    readBase: () => readBaseLockfile(repo, diffBase),
  });
  if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
  if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  process.exit(outcome.exitCode);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-lockfile-integrity.mjs") === true;
if (invokedDirectly) main();
