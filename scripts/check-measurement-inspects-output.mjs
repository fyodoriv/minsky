#!/usr/bin/env node
// Pattern: deterministic CI gate over the rule-#9 `measurement` field —
//   promotion of spec-monitor advisory rule A4 ("measurement runs but doesn't
//   actually inspect output") into the deterministic-monitor layer.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet rule:
//   when a deterministic linter is added the matching Skill check is removed
//   in the same PR); Havelund & Goldberg, "Verify Your Runs", *VSTTE* 2008
//   (runtime verification — the inspect-output check is the deterministic-
//   monitor layer carved out from the residual advisory share); Beck,
//   *Extreme Programming Explained*, 1999 (CI as the constraint enforcer);
//   `spec-advisories/2026-05-03-quarterly-audit.md` (audit decision: A4
//   admits a deterministic allowlist + blacklist).
// Conformance: full — pure function over the parsed `measurement` string;
//   the CLI is the I/O boundary (read EXPERIMENT.yaml, parse via
//   `@minsky/experiment-record`, run the check, exit).
//
// Why this gate exists: a measurement command that shells out but never
// inspects its output (`echo done`, `true`, bare `curl URL`, bare `node
// script.mjs` whose exit code is always 0) gives false confidence — the
// experiment "passes" no matter what the system does. spec-monitor A4 lists
// the recognisable-inspector allowlist + degenerate-form blacklist; per the
// Q2 2026 audit those lists are mechanisable. Promoting them to a CI lint
// closes the false-confidence trap deterministically and frees the advisory
// substrate (≤5-rule cap, rule-#10 ratchet) for the genuinely judgement-
// heavy residue.
//
// Three-way verdict:
//   - `fail` (exit 1): the measurement matches a blacklist token AND no
//     allowlist token is present. The inspector layer is missing.
//   - `pass` (exit 0): the measurement matches an allowlist token. Even if
//     it also contains a blacklisted token (e.g., `echo hi && grep -q X
//     file`), the allowlist wins — the surviving consumer inspects output.
//   - `warn` (exit 0, advisory stderr): neither list matches. The command
//     is unrecognised; the advisory layer (residual judgement) covers the
//     long tail. This is the rule-#10 escape hatch — the deterministic gate
//     stays loud-on-known-degenerate, silent-on-ambiguous.
//
// Matching is word-boundary-aware: `test` matches `test "$(…)"` but NOT
// `latest` or `pretest`. This is the documented avoidance for the
// false-positive trap that scope-tests of advisory rule A4 surfaced
// (e.g. `pnpm vitest run --reporter latest` would otherwise spuriously
// match `test`).
//
// Pivot (rule #9): if the inspector allowlist proves too narrow (legitimate
//   measurement commands consistently fall through to the `warn` channel
//   and never to `pass`), the rule is judgement-bound and this lint is
//   retired — A4 stays advisory in SKILL.md. Threshold: >10 % of the
//   repo's existing EXPERIMENT.yaml records emit `warn` after this lint
//   ships AND those `warn` cases are reviewed-OK by the maintainer (i.e.
//   the lint is producing noise, not signal).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseExperimentRecord } from "@minsky/experiment-record";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXPERIMENTS_DIR = resolve(HERE, "..", "experiments");

// ---- allowlist / blacklist -------------------------------------------------
//
// Each entry is { token, matcher }, where matcher is a RegExp tested against
// the measurement string. Word-boundary anchors prevent `test` from matching
// `latest` (false-positive trap from advisory-A4 scope tests).
//
// Allowlist tokens — at least one of these signals the surviving consumer
// inspects the upstream command's output:

/**
 * @typedef {{ name: string, matcher: RegExp }} TokenRule
 */

/** @type {TokenRule[]} */
const ALLOWLIST = [
  // POSIX `test` builtin — `test $(…) -lt 100`. \btest\b excludes `pretest`,
  // `latest`, `vitest`. The `[`/`[[` forms are listed separately because
  // they aren't word characters.
  { name: "test", matcher: /\btest\b/ },
  // POSIX bracket-test — `[ "$(…)" -ge 1 ]` or `[[ … ]]`. Anchored to
  // whitespace / start-of-line so we don't match array literals like
  // `["foo"]`.
  { name: "[ ... ]", matcher: /(?:^|\s)\[\s/ },
  { name: "[[ ... ]]", matcher: /(?:^|\s)\[\[\s/ },
  // jq -e — exits non-zero on null/false output.
  { name: "jq -e", matcher: /\bjq\s+(?:[^|]*\s)?-e\b/ },
  // grep -q / -c — quiet/count modes both inspect; -c is paired with `test`.
  { name: "grep -q", matcher: /\bgrep\b[^|]*\s-q\b/ },
  { name: "grep -c", matcher: /\bgrep\b[^|]*\s-c\b/ },
  // assert (e.g. `node -e "assert(...)"`).
  { name: "assert", matcher: /\bassert\b/ },
  // vitest / pnpm test — runners exit non-zero on failure.
  { name: "vitest", matcher: /\bvitest\b/ },
  { name: "pnpm test", matcher: /\bpnpm\s+test\b/ },
  { name: "pnpm typecheck", matcher: /\bpnpm\s+typecheck\b/ },
  { name: "pnpm lint", matcher: /\bpnpm\s+lint\b/ },
  { name: "@tasks-md/lint", matcher: /@tasks-md\/lint\b/ },
  { name: "markdownlint-cli2", matcher: /\bmarkdownlint-cli2\b/ },
  // gh run list … --jq — pipes output through jq for inspection.
  { name: "gh run list ... --jq", matcher: /\bgh\s+run\s+list\b[^|]*--jq\b/ },
  // `node scripts/check-*.mjs` — the rule-N linters are inspectors by
  // construction (they exit non-zero on violations). The pattern is
  // anchored to `scripts/check-<…>.mjs` to avoid blessing arbitrary
  // `node script.mjs` invocations as inspectors.
  { name: "node scripts/check-*.mjs", matcher: /\bnode\s+scripts\/check-[A-Za-z0-9._-]+\.mjs\b/ },
];

// Blacklist tokens — at least one of these (combined with no allowlist hit)
// signals a degenerate / non-inspecting measurement.

/** @type {TokenRule[]} */
const BLACKLIST = [
  // `echo …` — emits text, exit code is always 0 unless a write fails.
  { name: "echo", matcher: /\becho\b/ },
  // Bare `true` (the POSIX builtin that always exits 0). Anchored to
  // whitespace / start-of-line / end-of-line / common shell separators so
  // we don't false-positive on substrings like `truestate` or `assertTrue`.
  { name: "true", matcher: /(?:^|\s|;|&&|\|\|)true(?:$|\s|;|&&|\|\|)/ },
  // Bare `curl URL` with no piped consumer — the network call's success is
  // not the same as the body matching a threshold. We detect this only when
  // there is no `|` in the command (a piped consumer is the legitimating
  // surface). The matcher itself flags `curl` presence; the bare-curl rule
  // is enforced inside `checkMeasurementInspectsOutput` because the
  // pipe-or-no-pipe context isn't local to the regex.
  { name: "curl (bare)", matcher: /\bcurl\b/ },
  // Bare `node script.mjs` whose script isn't `scripts/check-*.mjs`. Same
  // structural caveat as `curl` — handled in the entry point because the
  // negation is non-local.
  { name: "node (bare)", matcher: /\bnode\s+\S+\.mjs\b/ },
];

// ---- pure entry point ------------------------------------------------------

/**
 * @typedef {{ ok: boolean, level: "fail" | "warn" | "pass", reason?: string }} CheckResult
 */

/**
 * Collect the names of every rule whose matcher hits `cmd`.
 *
 * @param {TokenRule[]} rules
 * @param {string} cmd
 * @returns {string[]}
 */
function collectHits(rules, cmd) {
  /** @type {string[]} */
  const hits = [];
  for (const rule of rules) {
    if (rule.matcher.test(cmd)) hits.push(rule.name);
  }
  return hits;
}

/**
 * Pure function: classify a measurement command as `pass` / `fail` / `warn`.
 *
 *   - pass: at least one allowlist token matches.
 *   - fail: at least one blacklist token matches AND no allowlist token does.
 *   - warn: neither matches (advisory; residual judgement scope).
 *
 * The `node (bare)` and `curl (bare)` rules document non-local context
 * (presence of a pipe, or whether the script path is `scripts/check-*.mjs`)
 * in their comments above. The non-locality is resolved by the *order* of
 * the checks: allowlist runs first and short-circuits, so reaching the
 * blacklist scan already implies no inspector consumer matched.
 *
 * @param {string} measurementCmd
 * @returns {CheckResult}
 */
export function checkMeasurementInspectsOutput(measurementCmd) {
  const cmd = measurementCmd ?? "";
  if (cmd.trim() === "") {
    return { ok: false, level: "fail", reason: "measurement command is empty" };
  }

  // 1. Allowlist hit short-circuits to pass (allowlist wins on conflicts).
  const allowlistHits = collectHits(ALLOWLIST, cmd);
  if (allowlistHits.length > 0) {
    return {
      ok: true,
      level: "pass",
      reason: `inspector token(s) present: ${allowlistHits.join(", ")}`,
    };
  }

  // 2. Blacklist hits — the allowlist short-circuit guarantees we only reach
  //    here when no inspector matched, so a `curl … | cat` (pipe-but-no-
  //    consumer) is still flagged, and `node script.mjs` (not under
  //    `scripts/check-*.mjs`) is still flagged.
  const blacklistHits = collectHits(BLACKLIST, cmd);
  if (blacklistHits.length > 0) {
    return {
      ok: false,
      level: "fail",
      reason: `degenerate / non-inspecting token(s) present and no inspector token: ${blacklistHits.join(", ")}`,
    };
  }

  // 3. Neither list — advisory warn, exit 0.
  return {
    ok: true,
    level: "warn",
    reason:
      "no recognised inspector token (allowlist) and no degenerate-form token (blacklist) — measurement falls in the residual judgement scope; reviewer should confirm the command's exit code reflects the measured value",
  };
}

// Re-exports for tests.
export { ALLOWLIST, BLACKLIST };

// ---- CLI -------------------------------------------------------------------

/**
 * Parse an EXPERIMENT.yaml file, run the check on its `measurement` field,
 * and produce an exit code per the three-way verdict.
 *
 * @param {string} experimentPath
 * @returns {Promise<number>}
 */
async function main(experimentPath) {
  /** @type {string} */
  let yamlText;
  try {
    yamlText = readFileSync(experimentPath, "utf8");
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") {
      // Missing EXPERIMENT.yaml is the responsibility of the rule-#9
      // pre-registration gate (`scripts/run-experiment.mjs`'s gate job),
      // not this lint. Pass silently.
      process.stdout.write(
        `measurement-inspects-output ok: ${experimentPath} not found (handled by ci-experiment-runner gate).\n`,
      );
      return 0;
    }
    throw err;
  }
  const parsed = parseExperimentRecord(yamlText);
  if (!parsed.ok) {
    // Same boundary as above — invalid EXPERIMENT.yaml is the parser /
    // experiment-runner's job to flag, not this lint. Pass with a note.
    process.stdout.write(
      `measurement-inspects-output ok: ${experimentPath} did not parse (handled by @minsky/experiment-record / ci-experiment-runner).\n`,
    );
    return 0;
  }
  const result = checkMeasurementInspectsOutput(parsed.record.measurement);
  if (result.level === "pass") {
    process.stdout.write(`measurement-inspects-output ok: ${result.reason}\n`);
    return 0;
  }
  if (result.level === "warn") {
    process.stderr.write(
      `measurement-inspects-output warn: ${result.reason}\n  measurement: ${parsed.record.measurement}\n`,
    );
    return 0;
  }
  process.stderr.write(
    `measurement-inspects-output violation:\n  - ${result.reason}\n  measurement: ${parsed.record.measurement}\n`,
  );
  return 1;
}

/**
 * Walk a directory of `experiments/*.yaml` files, run `main(file)` per file,
 * and aggregate exit codes (max wins). Per `experiments-directory-migration`:
 * the singleton EXPERIMENT.yaml at the repo root was retired in favour of
 * plural `experiments/<id>.yaml`. The walker is the directory-mode entry;
 * per-file `main(file)` remains for explicit single-file invocation.
 *
 * @param {string} directoryPath
 * @returns {Promise<number>}
 */
export async function mainDirectory(directoryPath) {
  let entries;
  try {
    entries = readdirSync(directoryPath);
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") {
      process.stdout.write(
        `measurement-inspects-output ok: ${directoryPath} not found (handled by ci-experiment-runner gate).\n`,
      );
      return 0;
    }
    throw err;
  }
  const yamlFiles = entries
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .map((name) => join(directoryPath, name))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  if (yamlFiles.length === 0) {
    process.stdout.write(
      `measurement-inspects-output ok: ${directoryPath} has no *.yaml files (nothing to check).\n`,
    );
    return 0;
  }
  let maxExitCode = 0;
  for (const file of yamlFiles) {
    const code = await main(file);
    if (code > maxExitCode) maxExitCode = code;
  }
  return maxExitCode;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-measurement-inspects-output.mjs");
if (invokedDirectly) {
  const arg = process.argv[2] ?? DEFAULT_EXPERIMENTS_DIR;
  let isDir = false;
  try {
    isDir = statSync(arg).isDirectory();
  } catch {
    isDir = false;
  }
  const code = isDir ? await mainDirectory(arg) : await main(arg);
  process.exit(code);
}
