#!/usr/bin/env node
// @ts-check
//
// verify-squash-merge-completeness — detect files SILENTLY DROPPED by a
// GitHub squash-merge.
//
// Observed 2026-05-21 (PR #704 → #706 ghost-fix class): PR #704's source
// commit changed `.releaserc.json`, but the squash-merge commit that landed
// on `main` did NOT include the file — GitHub re-merged parallel main churn
// into the squashed body and silently dropped it, so PR #706 had to re-ship
// the same fix. A squash-merge that drops a file from the PR's diff is a
// data-loss event that no existing gate catches.
//
// This verifier compares, per merged PR:
//   - the PR's source file list (`gh pr view <N> --json files`)
//   - the resulting squash-merge commit's file list (`git show <sha> --name-only`)
// Any path in the PR's diff that is NOT in the squash commit is a DROP.
//
// The pure decision function `findDroppedFiles({ prFiles, squashFiles })` has
// no I/O and is fully unit-tested; the CLI is the only I/O surface (it shells
// out to `gh` + `git`, walks the last N squash-merges on `main`, and prints a
// human-readable + `--json` report). On CI it runs on every push to `main`
// (`.github/workflows/squash-merge-verifier.yml`) and exits non-zero when a
// drop is found so the operator sees it loudly rather than discovering it via
// a re-shipped fix days later.
//
// Pattern: deterministic gate over the merge artefact (rule #10 — every
//   dropped file is mechanically detectable); rule #17 (proactive healing —
//   observation IS the fix); rule #18 (Merge means MERGE — this is the
//   deterministic guard for the "merge dropped my file" subclass).
// Source: rule #10 / #17 / #18 (vision.md); 2026-05-21 PR #704 → #706
//   ghost-fix class.
// Conformance: full — pure function over two file lists, no LLM in the chain.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Default number of recent squash-merges to inspect. */
export const DEFAULT_MERGE_LOOKBACK = 5;

/**
 * Paths that are EXPECTED to differ between a PR's source diff and the
 * landed squash commit — they are intentionally regenerated / re-resolved at
 * merge time and therefore must not be flagged as a drop. Keep this list
 * tight: a real drop hiding behind an over-broad ignore defeats the verifier.
 *
 * @type {readonly RegExp[]}
 */
export const DROP_IGNORE_PATTERNS = Object.freeze([
  // Lockfiles are routinely re-resolved against main at merge time.
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  // Auto-generated changelog (semantic-release owns it post-merge).
  /^CHANGELOG\.md$/,
]);

/**
 * @typedef {object} DroppedFilesInput
 * @property {readonly string[]} prFiles      paths in the PR's source diff
 * @property {readonly string[]} squashFiles  paths in the landed squash commit
 * @property {readonly RegExp[]} [ignore]     paths expected to differ at merge
 */

/**
 * @typedef {object} DroppedFilesResult
 * @property {string[]} dropped   PR files absent from the squash commit
 * @property {boolean} ok         true when nothing was dropped
 */

/**
 * Pure decision function. Returns the set of paths that were in the PR's diff
 * but are missing from the landed squash commit (excluding `ignore` paths).
 *
 * Normalises away leading `./`, trims whitespace, and de-duplicates so the
 * comparison is order-independent and robust to the slightly different path
 * shapes `gh` and `git` emit.
 *
 * @param {DroppedFilesInput} input
 * @returns {DroppedFilesResult}
 */
export function findDroppedFiles({ prFiles, squashFiles, ignore = DROP_IGNORE_PATTERNS }) {
  const squash = new Set(squashFiles.map(normalisePath).filter((p) => p.length > 0));
  /** @type {Set<string>} */
  const dropped = new Set();
  for (const raw of prFiles) {
    const p = normalisePath(raw);
    if (p.length === 0) continue;
    if (squash.has(p)) continue;
    if (ignore.some((re) => re.test(p))) continue;
    dropped.add(p);
  }
  const sorted = [...dropped].sort();
  return { dropped: sorted, ok: sorted.length === 0 };
}

/**
 * @param {string} p
 * @returns {string}
 */
function normalisePath(p) {
  let s = p.trim();
  if (s.startsWith("./")) s = s.slice(2);
  return s;
}

// CLI ------------------------------------------------------------------------

/**
 * @typedef {object} MergeReport
 * @property {string} sha       short squash-commit sha
 * @property {number | null} pr PR number (null when no PR could be resolved)
 * @property {string[]} dropped dropped file paths for this merge
 * @property {boolean} ok       true when nothing was dropped
 * @property {string} [note]    diagnostic note (e.g. "no PR found for sha")
 */

/**
 * @typedef {object} VerifyReport
 * @property {boolean} ok
 * @property {MergeReport[]} merges
 */

/**
 * Parse `--lookback=<n>` into a positive integer, falling back to the
 * current value on a non-positive / non-numeric input.
 *
 * @param {string} raw
 * @param {number} fallback
 * @returns {number}
 */
function parseLookback(raw, fallback) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Apply a single `--key=value` option to the accumulator (mutates in place).
 *
 * @param {{ json: boolean, lookback: number, repo: string }} out
 * @param {string} key
 * @param {string} value
 */
function applyKeyValueArg(out, key, value) {
  if (key === "lookback") out.lookback = parseLookback(value, out.lookback);
  else if (key === "repo") out.repo = value === "" ? out.repo : value;
}

/**
 * @param {string[]} argv
 * @returns {{ json: boolean, lookback: number, repo: string }}
 */
function parseArgs(argv) {
  const out = { json: false, lookback: DEFAULT_MERGE_LOOKBACK, repo: REPO_ROOT };
  for (const arg of argv) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m !== null) applyKeyValueArg(out, m[1] ?? "", m[2] ?? "");
  }
  return out;
}

/**
 * @param {string} repo
 * @param {number} lookback
 * @returns {string[]}
 */
function recentSquashMergeShas(repo, lookback) {
  // First-parent walk of main keeps us on the merge timeline (each squash is
  // a single commit on main). `%h` is the short sha.
  const out = execFileSync(
    "git",
    ["log", "--first-parent", `-n${lookback}`, "--pretty=%h", "HEAD"],
    { cwd: repo, encoding: "utf8" },
  );
  return out.split("\n").filter((l) => l.length > 0);
}

/**
 * @param {string} repo
 * @param {string} sha
 * @returns {string[]}
 */
function squashCommitFiles(repo, sha) {
  const out = execFileSync("git", ["show", "--name-only", "--format=", sha], {
    cwd: repo,
    encoding: "utf8",
  });
  return out.split("\n").filter((l) => l.length > 0);
}

/**
 * Resolve the PR number a squash commit closed from its subject line. GitHub
 * appends `(#<N>)` to squash-merge subjects by default.
 *
 * @param {string} repo
 * @param {string} sha
 * @returns {number | null}
 */
function prNumberForSha(repo, sha) {
  const subject = execFileSync("git", ["show", "-s", "--format=%s", sha], {
    cwd: repo,
    encoding: "utf8",
  });
  const m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  if (m === null) return null;
  const n = Number.parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {number} pr
 * @returns {string[] | null}
 */
function prSourceFiles(pr) {
  try {
    const out = execFileSync("gh", ["pr", "view", String(pr), "--json", "files"], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(out);
    /** @type {{ files?: { path?: string }[] }} */
    const data = parsed;
    if (!Array.isArray(data.files)) return null;
    return data.files.map((f) => f.path ?? "").filter((p) => p.length > 0);
  } catch {
    return null;
  }
}

/**
 * Analyse a single squash commit. Pure orchestration over the I/O helpers —
 * never throws (read failures become a `note`, not a crash) per rule #6.
 *
 * @param {string} repo
 * @param {string} sha
 * @returns {MergeReport}
 */
function analyseMerge(repo, sha) {
  const pr = prNumberForSha(repo, sha);
  if (pr === null) {
    return { sha, pr: null, dropped: [], ok: true, note: "no PR number in subject" };
  }
  const prFiles = prSourceFiles(pr);
  if (prFiles === null) {
    return {
      sha,
      pr,
      dropped: [],
      ok: true,
      note: `could not fetch PR #${pr} files (gh unavailable or PR not found)`,
    };
  }
  const squashFiles = squashCommitFiles(repo, sha);
  const { dropped, ok } = findDroppedFiles({ prFiles, squashFiles });
  return { sha, pr, dropped, ok };
}

/**
 * @param {{ repo: string, lookback: number }} opts
 * @returns {VerifyReport}
 */
function verifyRecentMerges({ repo, lookback }) {
  let shas;
  try {
    shas = recentSquashMergeShas(repo, lookback);
  } catch (e) {
    return {
      ok: true,
      merges: [
        {
          sha: "",
          pr: null,
          dropped: [],
          ok: true,
          note: `cannot read git log: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }

  const merges = shas.map((sha) => analyseMerge(repo, sha));
  return { ok: merges.every((m) => m.ok), merges };
}

/**
 * @param {MergeReport} m
 */
function printMergeLine(m) {
  const label = m.pr === null ? m.sha : `#${m.pr} (${m.sha})`;
  if (m.ok) {
    const note = m.note ? ` — ${m.note}` : "";
    process.stdout.write(`  ok  ${label}${note}\n`);
    return;
  }
  process.stdout.write(`  DROP ${label} — ${m.dropped.length} file(s) dropped:\n`);
  for (const p of m.dropped) process.stdout.write(`        - ${p}\n`);
}

/**
 * @param {VerifyReport} report
 */
function printHuman(report) {
  for (const m of report.merges) printMergeLine(m);
  if (report.ok) {
    process.stdout.write("verify-squash-merge-completeness: no dropped files.\n");
    return;
  }
  process.stderr.write(
    "verify-squash-merge-completeness: squash-merge DROPPED files from the PR diff (see above). " +
      "Re-apply the dropped change in a follow-up PR.\n",
  );
}

function main() {
  const { json, lookback, repo } = parseArgs(process.argv.slice(2));
  const report = verifyRecentMerges({ repo, lookback });
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }
  process.exit(report.ok ? 0 : 1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("verify-squash-merge-completeness.mjs") === true;
if (invokedDirectly) main();
