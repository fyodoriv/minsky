#!/usr/bin/env node
// @ts-check
// `scripts/snapshot-minsky-install.mjs` — pure snapshotter for the
// launcher-agnostic feature-parity chaos test (TASKS.md
// `launcher-agnostic-feature-parity-chaos-test`, user-story 014).
//
// Why this file exists: story 014 pins the invariant that two Minsky
// installs driven through INSTALL.md by two different launcher agents
// (Claude Code, Cursor, Devin, …) produce byte-identical runtime
// behavior — the launcher is "a doorway, not a runtime". To *prove* that
// invariant deterministically (rule #10), the chaos test installs Minsky
// twice (once per stubbed launcher) and diffs the resulting state. This
// module is the diff substrate: it reads an install's observable surface
// into a normalized snapshot object and diffs two snapshots field-by-
// field, returning the per-field deltas. The chaos test asserts the only
// non-empty delta is the single allowlisted field
// (`telemetry_consent.agent` — "who turned the doorknob", per story 014
// § Metric).
//
// Pattern conformance (vision.md § "Pattern conformance index"):
//   - Golden-master / snapshot testing (Feathers, *Working Effectively
//     with Legacy Code*, 2004, ch. "Characterization Tests"): capture the
//     observable surface, then assert two captures are identical modulo a
//     declared allowlist. The "golden master" here is one launcher's
//     install; the other launcher's install is the comparand.
//   - Chaos engineering (Basiri et al., "Principles of Chaos
//     Engineering", *IEEE Software* 2016): steady-state hypothesis
//     (launcher-agnostic parity) + fault injection (run as two different
//     launchers) + assertion against the steady state (zero
//     non-allowlisted deltas).
//   - Pure core + injected I/O (Martin 2017 — I/O at the edge): the diff
//     and normalization are pure functions; the only I/O is `readInstall`,
//     which the paired test bypasses by constructing snapshot objects
//     directly.
//
// Anchor: user-story 014 § "Integration test" (this is its snapshot
//   step); rule #10 (deterministic enforcement); Nygard, *Release It!*
//   2nd ed. 2018 ("test the seams between subsystems with chaos faults"
//   applied to the launcher↔runtime seam).
//
// CLI: `node scripts/snapshot-minsky-install.mjs --state-dir <dir> --help-text-file <f> [--json]`
//   emits the normalized snapshot as JSON. The chaos test imports the
//   pure functions directly rather than shelling out.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/**
 * @typedef {object} InstallSnapshot
 * @property {Record<string, unknown>} config         parsed ~/.minsky/config.json
 * @property {Record<string, unknown>} telemetryConsent  parsed ~/.minsky/telemetry-consent.json, timestamp+host_path_hash stripped
 * @property {string[]} subcommands                   sorted unique subcommand set from `minsky --help`
 * @property {Record<string, unknown>} openhandsEnvelope  the mock OpenHands spawn envelope built from config (no per-call temp paths)
 */

/**
 * @typedef {object} FieldDelta
 * @property {string} field   dot-path of the divergent field
 * @property {string} a       JSON-stringified value on side A
 * @property {string} b       JSON-stringified value on side B
 */

/**
 * The single permitted delta between two launcher installs. Per story
 * 014 § Metric: "The only permitted delta is the `agent` string in
 * `~/.minsky/telemetry-consent.json` (which records who-installed, not
 * what-runs)." Any addition to this list is a moat-eroding decision and
 * MUST be justified inline (rule #7's allowlist-with-comment discipline).
 *
 * @type {readonly string[]}
 */
export const PERMITTED_DELTAS = Object.freeze(["telemetryConsent.agent"]);

/**
 * Volatile fields that legitimately differ between two installs for
 * reasons unrelated to launcher identity (wall-clock timestamps, a salt
 * hashed over a per-install random salt). They are normalized OUT of the
 * snapshot before diffing so they never produce a false-positive delta.
 * This is NOT an allowlist of permitted launcher deltas — it's the set of
 * fields whose value is install-instance-random by construction.
 *
 * @type {readonly string[]}
 */
const VOLATILE_TELEMETRY_FIELDS = Object.freeze(["timestamp", "host_path_hash"]);

/**
 * Normalize a parsed telemetry-consent record: drop the volatile fields
 * (timestamp, host_path_hash) so the diff sees only the launcher-relevant
 * surface (consent + agent). Pure.
 *
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeTelemetryConsent(raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (VOLATILE_TELEMETRY_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Normalize an OpenHands spawn envelope: drop the per-call temp paths
 * (`briefFilePath`, and any `--brief-file <tmp>` argv pair) which are
 * `mkdtempSync`-random per invocation and unrelated to launcher identity.
 * What survives is the launcher-invariant shape: command, model, repo,
 * base-url, reasoning flags. Pure.
 *
 * @param {Record<string, unknown>} envelope
 * @returns {Record<string, unknown>}
 */
export function normalizeOpenhandsEnvelope(envelope) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(envelope)) {
    if (k === "briefFilePath") continue;
    if (k === "argv" && Array.isArray(v)) {
      // Strip the `--brief-file <tmp>` pair (the value is a random temp
      // path) and the shim's own absolute path (argv[0]) which is
      // checkout-location-dependent, not launcher-dependent. Keep the
      // rest of the argv — model, repo, base-url, reasoning flags — which
      // is the part that would diverge if a launcher branch leaked.
      out[k] = stripVolatileArgv(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Remove argv[0] (the absolute shim path) and the `--brief-file <tmp>`
 * pair from a spawn argv. Pure.
 *
 * @param {unknown[]} argv
 * @returns {unknown[]}
 */
function stripVolatileArgv(argv) {
  /** @type {unknown[]} */
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (i === 0) continue; // shim path — checkout-relative, not launcher-relative
    if (argv[i] === "--brief-file") {
      i += 1; // skip the temp-path value too
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

/**
 * Extract the set of top-level subcommands Minsky advertises from its
 * `minsky --help` output. The help block lists each verb after a `minsky `
 * prefix; we collect the first token after that prefix. Sorted + de-duped
 * so the snapshot is order-stable. Pure.
 *
 * The set is launcher-invariant by construction (the help text is
 * sed-extracted from `bin/minsky`'s own docstring); a launcher branch
 * that conditionally registered a subcommand would shift this set and the
 * diff would catch it.
 *
 * @param {string} helpText
 * @returns {string[]}
 */
export function extractSubcommands(helpText) {
  /** @type {Set<string>} */
  const verbs = new Set();
  const re = /\bminsky\s+([a-z][a-z0-9-]*)\b/g;
  for (const match of helpText.matchAll(re)) {
    const verb = match[1];
    // Skip pseudo-verbs that are flags or the program name echoed.
    if (verb !== undefined && verb !== "minsky") verbs.add(verb);
  }
  return [...verbs].sort();
}

/**
 * Build a normalized install snapshot from already-parsed pieces. Pure —
 * this is the function the chaos test drives directly. The CLI wrapper
 * (`readInstall` + `main`) reads the pieces off disk first.
 *
 * @param {{
 *   config: Record<string, unknown>,
 *   telemetryConsent: Record<string, unknown>,
 *   helpText: string,
 *   openhandsEnvelope: Record<string, unknown>,
 * }} parts
 * @returns {InstallSnapshot}
 */
export function buildSnapshot(parts) {
  return {
    config: parts.config,
    telemetryConsent: normalizeTelemetryConsent(parts.telemetryConsent),
    subcommands: extractSubcommands(parts.helpText),
    openhandsEnvelope: normalizeOpenhandsEnvelope(parts.openhandsEnvelope),
  };
}

/**
 * Recursively flatten an object into dot-path → JSON-string entries.
 * Arrays are compared as whole JSON values (order matters — a reordered
 * subcommand set IS a divergence). Pure.
 *
 * @param {unknown} value
 * @param {string} prefix
 * @param {Map<string, string>} acc
 * @returns {Map<string, string>}
 */
function flatten(value, prefix, acc) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value));
    if (entries.length === 0) {
      acc.set(prefix, "{}");
      return acc;
    }
    for (const [k, v] of entries) {
      flatten(v, prefix === "" ? k : `${prefix}.${k}`, acc);
    }
    return acc;
  }
  acc.set(prefix, JSON.stringify(value));
  return acc;
}

/**
 * Diff two install snapshots, returning every field whose value differs
 * AND is not on the permitted-delta allowlist. A field present on one side
 * but absent on the other is also a delta (`undefined` on the missing
 * side). Pure — the heart of the chaos test's assertion.
 *
 * @param {InstallSnapshot} a
 * @param {InstallSnapshot} b
 * @param {readonly string[]} [permitted]
 * @returns {FieldDelta[]}
 */
export function diffSnapshots(a, b, permitted = PERMITTED_DELTAS) {
  const flatA = flatten(a, "", new Map());
  const flatB = flatten(b, "", new Map());
  const allKeys = new Set([...flatA.keys(), ...flatB.keys()]);
  /** @type {FieldDelta[]} */
  const deltas = [];
  for (const key of [...allKeys].sort()) {
    const va = flatA.get(key);
    const vb = flatB.get(key);
    if (va === vb) continue;
    if (permitted.includes(key)) continue;
    deltas.push({ field: key, a: va ?? "<absent>", b: vb ?? "<absent>" });
  }
  return deltas;
}

/**
 * Read an install's observable surface off disk. The only I/O boundary in
 * this module — the chaos test bypasses it and constructs snapshots from
 * its own in-memory captures (it spawns the launchers itself).
 *
 * @param {{ stateDir: string, helpText: string, openhandsEnvelope: Record<string, unknown> }} opts
 * @returns {InstallSnapshot}
 */
export function readInstall(opts) {
  const configPath = join(opts.stateDir, "config.json");
  const consentPath = join(opts.stateDir, "telemetry-consent.json");
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  const telemetryConsent = existsSync(consentPath)
    ? JSON.parse(readFileSync(consentPath, "utf8"))
    : {};
  return buildSnapshot({
    config,
    telemetryConsent,
    helpText: opts.helpText,
    openhandsEnvelope: opts.openhandsEnvelope,
  });
}

// --------------------------------------------------------------- CLI -------

/**
 * Normalize argv into `--key=value` form so the parser has one shape to
 * handle: `["--state-dir", "x"]` → `["--state-dir=x"]`. Bare flags (`--json`)
 * pass through untouched. Pure helper that keeps `parseArgs` under the
 * cognitive-complexity ceiling.
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
function coalesceValueFlags(argv) {
  const valueFlags = new Set(["--state-dir", "--help-text-file"]);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a !== undefined && valueFlags.has(a) && i + 1 < argv.length) {
      out.push(`${a}=${argv[i + 1]}`);
      i += 1;
    } else if (a !== undefined) {
      out.push(a);
    }
  }
  return out;
}

/**
 * @param {string[]} argv
 * @returns {{ stateDir?: string, helpTextFile?: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ stateDir?: string, helpTextFile?: string, json: boolean }} */
  const out = { json: false };
  for (const a of coalesceValueFlags(argv)) {
    if (a === "--json") out.json = true;
    else if (a.startsWith("--state-dir=")) out.stateDir = a.slice("--state-dir=".length);
    else if (a.startsWith("--help-text-file="))
      out.helpTextFile = a.slice("--help-text-file=".length);
  }
  return out;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.stateDir === undefined || parsed.helpTextFile === undefined) {
    process.stderr.write(
      "usage: snapshot-minsky-install.mjs --state-dir <dir> --help-text-file <f> [--json]\n",
    );
    process.exit(2);
  }
  const helpText = existsSync(parsed.helpTextFile) ? readFileSync(parsed.helpTextFile, "utf8") : "";
  const snapshot = readInstall({
    stateDir: parsed.stateDir,
    helpText,
    // The envelope is built by the daemon at spawn time; the standalone
    // CLI has no config-derived envelope to show, so it emits an empty
    // object. The chaos test (the real consumer) builds the envelope from
    // each install's config via buildOpenHandsInvocation and passes it to
    // buildSnapshot directly.
    openhandsEnvelope: {},
  });
  process.stdout.write(`${JSON.stringify(snapshot, null, parsed.json ? 0 : 2)}\n`);
  process.exit(0);
}

const invokedAsScript = process.argv[1]?.endsWith("snapshot-minsky-install.mjs") === true;
if (invokedAsScript) {
  main();
}
