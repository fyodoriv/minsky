#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved slice 3 of `supervisor-sandbox-syscall-restriction` (P0 sibling cited by `security-privacy-priority-substrate`'s rule #13.3 minimum bar) -->
// Pattern: deterministic gate over the `MINSKY_SANDBOX` substrate cohesion —
// pins the resolver source (`novel/tick-loop/src/sandbox-mode.ts`'s
// `SANDBOX_MODE_ENV` constant) and the two unit-file templates
// (`distribution/systemd/minsky-tick-loop.service` and
// `distribution/launchd/com.minsky.tick-loop.plist`) to declare the same
// env-var name. Without the pin, a future rename of `SANDBOX_MODE_ENV` (or
// removal of the operator-visible commented opt-in from one of the two
// platforms) would silently desynchronise the operator-facing surface.
// Source: vision.md rule #13.3 (supervisor sandbox); TASKS.md
//   `supervisor-sandbox-syscall-restriction` P0; rule #10 (deterministic
//   enforcement — substrate-cohesion is a CI lint, not a hope); Saltzer &
//   Schroeder 1975 economy of mechanism (one env-var, one source of truth).
//   Conformance: full — pure function over file texts; the only I/O is
//   reading the three files in `main()`.
//
// Why this gate exists: PR #332 shipped the resolver
// (`SANDBOX_MODE_ENV = "MINSKY_SANDBOX"`); PR #335 shipped the supervisor
// startup banner that surfaces the resolved mode. The unit-file templates
// are the operator's *first* contact with the sandbox slot — `cat
// distribution/launchd/com.minsky.tick-loop.plist` is what an operator runs
// to understand the supervisor's effective env, before ever opening the TS
// source. This slice (3) declares `MINSKY_SANDBOX` (commented, default
// `off`) in both templates; this lint pins the declaration so a future
// edit cannot drop the env-var slot from one platform while leaving it on
// the other — a regression that would silently re-confuse the operator
// about which env var to ramp.
//
// Pivot (rule #9): if a third platform is added (e.g., a Windows service
// wrapper for an experimental port), extend `UNIT_FILE_PATHS` rather than
// retire — the requirement is "every supervisor unit-file template
// declares the env var", not "exactly two platforms".

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const SANDBOX_MODE_TS_PATH = "novel/tick-loop/src/sandbox-mode.ts";
export const SYSTEMD_UNIT_PATH = "distribution/systemd/minsky-tick-loop.service";
export const LAUNCHD_PLIST_PATH = "distribution/launchd/com.minsky.tick-loop.plist";
export const UNIT_FILE_PATHS = Object.freeze([SYSTEMD_UNIT_PATH, LAUNCHD_PLIST_PATH]);

/**
 * The literal env-var name the resolver MUST export and the unit files
 * MUST declare. Pinned here rather than imported from `sandbox-mode.ts` so
 * the lint runs as a pure `.mjs` over file text — no TS compile, no module
 * graph load. If this value diverges from `SANDBOX_MODE_ENV` in
 * `sandbox-mode.ts`, the lint fires.
 */
export const REQUIRED_ENV_VAR = "MINSKY_SANDBOX";

const SANDBOX_MODE_ENV_RE = /\bexport\s+const\s+SANDBOX_MODE_ENV\s*=\s*"([^"]+)"/;

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure check on the resolver's `sandbox-mode.ts`. Asserts:
 *   1. Exactly one `export const SANDBOX_MODE_ENV = "..."` declaration.
 *   2. The string value matches `REQUIRED_ENV_VAR` (`"MINSKY_SANDBOX"`).
 *
 * @param {string} sourceText
 * @returns {CheckResult}
 */
export function checkResolverSource(sourceText) {
  const match = sourceText.match(SANDBOX_MODE_ENV_RE);
  if (match === null) {
    return {
      ok: false,
      errors: [
        `${SANDBOX_MODE_TS_PATH}: missing \`export const SANDBOX_MODE_ENV = "..."\` declaration`,
      ],
    };
  }
  const declared = match[1];
  if (declared !== REQUIRED_ENV_VAR) {
    return {
      ok: false,
      errors: [
        `${SANDBOX_MODE_TS_PATH}: SANDBOX_MODE_ENV = ${JSON.stringify(declared)}, expected ${JSON.stringify(REQUIRED_ENV_VAR)}`,
      ],
    };
  }
  return { ok: true };
}

/**
 * Pure check on a unit-file template. The env-var declaration may be
 * commented or active — the requirement is operator visibility, not
 * runtime activation (substrate-inert by default per the resolver's
 * fail-safe-defaults discipline). Asserts:
 *   1. The literal `MINSKY_SANDBOX` token appears at least once in the file.
 *   2. The accompanying explanatory text cites `vision.md § 13.3` (or
 *      `rule #13.3`) so a future operator reading the unit file finds the
 *      authoritative spec without grepping.
 *
 * @param {string} unitText
 * @param {string} path
 * @returns {CheckResult}
 */
export function checkUnitFile(unitText, path) {
  /** @type {string[]} */
  const errors = [];
  if (!unitText.includes(REQUIRED_ENV_VAR)) {
    errors.push(
      `${path}: missing \`${REQUIRED_ENV_VAR}\` declaration (operator-visible commented opt-in required by rule #13.3)`,
    );
  }
  if (!/§\s*13\.3|rule #13\.3/.test(unitText)) {
    errors.push(
      `${path}: \`${REQUIRED_ENV_VAR}\` declaration must cite \`vision.md § 13.3\` or \`rule #13.3\` so the operator finds the spec without grep`,
    );
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @typedef {{ resolverResult: CheckResult, unitResults: Array<{ path: string, result: CheckResult }> }} AggregateResult
 */

/**
 * Aggregate check across the resolver source and all unit-file templates.
 * Pure: takes a `Map<path, content>` and returns a structured result. The
 * caller wires the I/O.
 *
 * @param {ReadonlyMap<string, string>} contentsByPath
 * @returns {AggregateResult}
 */
export function checkAll(contentsByPath) {
  const resolverText = contentsByPath.get(SANDBOX_MODE_TS_PATH);
  /** @type {CheckResult} */
  const resolverResult =
    resolverText === undefined
      ? { ok: false, errors: [`${SANDBOX_MODE_TS_PATH}: file missing on disk`] }
      : checkResolverSource(resolverText);
  const unitResults = UNIT_FILE_PATHS.map((path) => {
    const text = contentsByPath.get(path);
    /** @type {CheckResult} */
    const result =
      text === undefined
        ? { ok: false, errors: [`${path}: file missing on disk`] }
        : checkUnitFile(text, path);
    return { path, result };
  });
  return { resolverResult, unitResults };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  /** @type {Map<string, string>} */
  const contents = new Map();
  for (const rel of [SANDBOX_MODE_TS_PATH, ...UNIT_FILE_PATHS]) {
    try {
      const text = await readFile(resolve(REPO_ROOT, rel), "utf8");
      contents.set(rel, text);
    } catch {
      // Leave the entry unset; checkAll surfaces "file missing on disk".
    }
  }
  const { resolverResult, unitResults } = checkAll(contents);
  /** @type {string[]} */
  const allErrors = [];
  if (!resolverResult.ok) allErrors.push(...resolverResult.errors);
  for (const { result } of unitResults) {
    if (!result.ok) allErrors.push(...result.errors);
  }
  if (allErrors.length === 0) {
    process.stdout.write(
      `sandbox-env-declared ok: ${REQUIRED_ENV_VAR} declared in ${SANDBOX_MODE_TS_PATH} and ${UNIT_FILE_PATHS.length} unit-file templates.\n`,
    );
    return 0;
  }
  process.stderr.write("sandbox-env-declared violation:\n");
  for (const err of allErrors) {
    process.stderr.write(`  - ${err}\n`);
  }
  process.stderr.write(
    [
      "",
      "Per vision.md § 13.3 and TASKS.md `supervisor-sandbox-syscall-restriction`,",
      `the \`${REQUIRED_ENV_VAR}\` env var must be declared in the resolver`,
      "(`SANDBOX_MODE_ENV`) AND surfaced in every supervisor unit-file template",
      "(commented opt-in is sufficient — substrate-inert by default).",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-sandbox-env-declared.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
