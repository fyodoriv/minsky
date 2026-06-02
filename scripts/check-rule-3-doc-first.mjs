#!/usr/bin/env node
// Pattern: deterministic gate over a PR diff (rule #10).
// Source: rule #3 (test-first / metric-first / doc-first); Knuth 1984
//   (literate programming — doc and code are the same artifact);
//   Beck 1999 (continuous integration as the constraint enforcer).
// Conformance: full — pure function over the diff, no LLM in the chain.
//
// Why this gate exists: rule #3 says every change starts with a failing
// test, a metric, AND a doc. Tests + metrics are caught by other gates
// (vitest + experiment-runner). This gate catches the doc clause:
// every PR that adds or modifies `novel/**/*.ts` (non-test) MUST also
// touch one of: a `user-stories/*.md`, the affected package's
// `README.md`, OR include a deferral marker in the PR description.
// Package-specific surface: `novel/competitive-benchmark` code changes are
// also satisfied by a touched `competitors/<name>.md` — those files ARE the
// human-facing corpus docs (a corpus refresh updates the reading in
// competitors.ts AND the narrative in competitors/<name>.md).
//
// Scope: only the *touched* package's README counts. A PR modifying
// `novel/budget-guard/src/foo.ts` resolves via `novel/budget-guard/README.md`,
// not via touching some other package's README.
//
// Opt-out: the PR description (separate from the diff) can include
// `<!-- rule-3: doc-deferred-to-followup-task: <task-id> -->` where
// `<task-id>` exists in TASKS.md as a `**ID**:` value, OR
// `<!-- rule-3: refactor-no-public-surface -->` for whole-PR exemption.
//
// Pivot (rule #9): if this gate produces ≥2 false positives per month
// from purely-internal refactors that legitimately need no doc change,
// add a third exemption (`rule-3: dependency-bump`) or tighten the
// scope to only public-API surfaces.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} ChangedFile
 * @property {string} status — git diff-status letter ("A", "M", "D", "R", …)
 * @property {string} path
 */

/**
 * @typedef {object} CheckInput
 * @property {readonly ChangedFile[]} changedFiles
 * @property {string} prBody — PR description; "" if not on a PR
 * @property {string} tasksMd — current TASKS.md content
 */

/**
 * @typedef {object} CheckOk
 * @property {true} ok
 */
/**
 * @typedef {object} CheckFail
 * @property {false} ok
 * @property {readonly string[]} errors
 */
/** @typedef {CheckOk | CheckFail} CheckResult */

/**
 * @param {string} base
 * @param {string} head
 * @returns {ChangedFile[]}
 */
function getChangedFiles(base, head) {
  const out = execSync(`git diff --name-status ${base}...${head}`, {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) return { status: line, path: "" };
      return {
        status: line.slice(0, tabIdx),
        path: line.slice(tabIdx + 1),
      };
    });
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isCodeUnderNovel(path) {
  if (!path.startsWith("novel/")) return false;
  if (!path.endsWith(".ts")) return false;
  if (path.endsWith(".test.ts")) return false;
  if (path.endsWith(".fixture.ts")) return false;
  // .d.ts declaration files are doc-shaped, not code-shaped, but they're
  // generated artefacts that should never be hand-edited; treat them as
  // code so accidental hand-edits surface.
  return true;
}

/**
 * Compute the package directory a `novel/...` path belongs to.
 * - novel/<pkg>/...                 → novel/<pkg>
 * - novel/adapters/<pkg>/...        → novel/adapters/<pkg>
 * - novel/bridges/<pkg>/...         → novel/bridges/<pkg>
 *
 * The list of nested-namespace prefixes is taken from `pnpm-workspace.yaml`
 * — keep in sync if a new namespace is added.
 *
 * @param {string} path
 * @returns {string}
 */
function packageOf(path) {
  const NESTED_NAMESPACES = ["adapters", "bridges"];
  const parts = path.split("/");
  if (parts.length >= 3 && parts[1] !== undefined && NESTED_NAMESPACES.includes(parts[1])) {
    return parts.slice(0, 3).join("/");
  }
  return parts.slice(0, 2).join("/");
}

const DEFERRAL_RE =
  /<!--\s*rule-3:\s*doc-deferred-to-followup-task:\s*([a-z0-9][a-z0-9-]*[a-z0-9])\s*-->/i;
const REFACTOR_EXEMPTION_RE = /<!--\s*rule-3:\s*refactor-no-public-surface\s*-->/i;

/**
 * @param {string} taskId
 * @param {string} tasksMd
 * @returns {boolean}
 */
function taskExistsInTasksMd(taskId, tasksMd) {
  const escaped = taskId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`\\*\\*ID\\*\\*:\\s*${escaped}\\b`).test(tasksMd);
}

/**
 * @param {string} prBody
 * @param {string} tasksMd
 * @returns {{ exempt: true } | { exempt: false } | { error: string }}
 */
function checkExemptions(prBody, tasksMd) {
  if (REFACTOR_EXEMPTION_RE.test(prBody)) return { exempt: true };
  const deferralMatch = prBody.match(DEFERRAL_RE);
  if (deferralMatch === null || deferralMatch[1] === undefined) {
    return { exempt: false };
  }
  const taskId = deferralMatch[1];
  if (taskExistsInTasksMd(taskId, tasksMd)) return { exempt: true };
  return {
    error: `rule-3 deferral references unknown task id "${taskId}". Add the task to TASKS.md first, or remove the deferral comment.`,
  };
}

/**
 * @param {readonly ChangedFile[]} changedFiles
 * @returns {Set<string>}
 */
function collectTouchedDocs(changedFiles) {
  return new Set(
    changedFiles
      .filter((f) => f.status !== "D")
      .filter(
        (f) =>
          f.path.startsWith("user-stories/") ||
          (f.path.startsWith("novel/") && f.path.endsWith("README.md")) ||
          // `competitors/<name>.md` ARE the human-facing corpus docs for the
          // competitive-benchmark package: a corpus refresh updates the reading
          // in `novel/competitive-benchmark/src/competitors.ts` AND the
          // narrative + provenance in `competitors/<name>.md`. The latter IS
          // the doc, so it satisfies the doc-first clause for that package.
          (f.path.startsWith("competitors/") && f.path.endsWith(".md")),
      )
      .map((f) => f.path),
  );
}

/** The package whose doc surface includes `competitors/*.md`. */
const COMPETITIVE_BENCHMARK_PKG = "novel/competitive-benchmark";

/**
 * Pure function. See module header for semantics.
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkRule3DocFirst({ changedFiles, prBody, tasksMd }) {
  const codeFiles = changedFiles.filter((f) => f.status !== "D" && isCodeUnderNovel(f.path));
  if (codeFiles.length === 0) return { ok: true };

  const exemption = checkExemptions(prBody, tasksMd);
  if ("exempt" in exemption && exemption.exempt) return { ok: true };
  if ("error" in exemption) return { ok: false, errors: [exemption.error] };

  const touchedDocs = collectTouchedDocs(changedFiles);
  const userStoryTouched = [...touchedDocs].some((p) => p.startsWith("user-stories/"));
  const competitorDocTouched = [...touchedDocs].some(
    (p) => p.startsWith("competitors/") && p.endsWith(".md"),
  );

  const packages = new Set(codeFiles.map((f) => packageOf(f.path)));
  const errors = [...packages]
    .map((pkg) => packageDocError(pkg, touchedDocs, userStoryTouched, competitorDocTouched))
    .filter((e) => e !== null);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * The doc-clause check for a single package. Returns a violation string, or
 * null when the package's doc surface was touched.
 *
 * @param {string} pkg
 * @param {Set<string>} touchedDocs
 * @param {boolean} userStoryTouched
 * @param {boolean} competitorDocTouched
 * @returns {string | null}
 */
function packageDocError(pkg, touchedDocs, userStoryTouched, competitorDocTouched) {
  const pkgReadmeTouched = touchedDocs.has(`${pkg}/README.md`);
  // The competitive-benchmark package's doc surface also includes competitors/*.md.
  const competitiveDocOk = pkg === COMPETITIVE_BENCHMARK_PKG && competitorDocTouched;
  if (userStoryTouched || pkgReadmeTouched || competitiveDocOk) return null;
  const docHint =
    pkg === COMPETITIVE_BENCHMARK_PKG
      ? `touch user-stories/*.md OR ${pkg}/README.md OR competitors/*.md`
      : `touch user-stories/*.md OR ${pkg}/README.md`;
  return `rule-3 violation: ${pkg} has code changes but no doc change (${docHint}, OR add the deferral comment to the PR body).`;
}

function main() {
  const base = process.env["RULE_3_DIFF_BASE"] ?? "origin/main";
  const head = "HEAD";
  let prBody = "";
  const prBodyPath = process.env["RULE_3_PR_BODY_PATH"];
  if (prBodyPath !== undefined && existsSync(prBodyPath)) {
    prBody = readFileSync(prBodyPath, "utf8");
  }
  const repoRoot = resolve(HERE, "..");
  const tasksMd = readFileSync(resolve(repoRoot, "TASKS.md"), "utf8");

  /** @type {ChangedFile[]} */
  let changedFiles;
  try {
    changedFiles = getChangedFiles(base, head);
  } catch (e) {
    process.stderr.write(
      `rule-3 lint cannot compute diff: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
  }

  const result = checkRule3DocFirst({ changedFiles, prBody, tasksMd });
  if (result.ok) {
    process.stdout.write("rule-3 ok: doc-first clause satisfied (or no novel/ code touched).\n");
    return;
  }
  for (const err of result.errors) process.stderr.write(`${err}\n`);
  process.exit(1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-rule-3-doc-first.mjs");
if (invokedDirectly) main();
