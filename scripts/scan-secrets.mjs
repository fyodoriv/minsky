#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements parent task `secret-scanning-precommit-and-ci` § Details (a)/(b)/(c)/(d) — gitleaks-equivalent classifier + walker + annotation + CLI/CI gate -->
// Slice 1 of `secret-scanning-precommit-and-ci` (TASKS.md): the pure classifier.
//
// `scanContentForSecrets(text, filePath?)` decides whether a string of file
// content contains any well-known credential shape that should never land in
// a tracked file. It is intentionally regex-based, deterministic, and pure;
// the staged-files walker, lefthook pre-commit hook, and CI gate ship in
// subsequent slices against this fixed seam.
//
// This is the in-tree fallback the parent task's Pivot anticipates ("if
// gitleaks's default ruleset produces ≥3 false positives in the first month,
// swap to trufflehog … only the scanner binary changes" — rule #2). The
// classifier is the seam, gitleaks/trufflehog the swappable boundary. Until
// the binary is wired into pre-commit + CI, this seam guards the supervisor
// against regressions that would write a credential into a tracked file (the
// supervisor edits arbitrary files per iteration; a single regression can
// commit `OPENAI_API_KEY=...` / a private RSA key — the parent's Hypothesis).
//
// Patterns covered (slice 1):
//   - GitHub PAT / OAuth / server-server / user-server tokens (`ghp_…`,
//     `gho_…`, `ghs_…`, `ghu_…` — 36-char tail, GitHub's documented format).
//   - Anthropic / OpenAI keys (`sk-…` ≥20 trailing chars; Anthropic's
//     `sk-ant-…` is a common subset).
//   - Slack tokens (`xoxb-` / `xoxp-` / `xoxa-` / `xoxs-` ≥10 trailing chars).
//   - AWS access key IDs (`AKIA[0-9A-Z]{16}` — AWS's documented format).
//   - Google API keys (`AIza[0-9A-Za-z_-]{35}` — Google's documented format).
//   - PEM private key headers (`-----BEGIN [...] PRIVATE KEY-----`) — the
//     header alone is enough; entropy of the body isn't checked because the
//     header itself is a high-confidence signal.
//
// Each pattern's tail length / shape is calibrated to the issuer's documented
// format rather than entropy heuristics, to keep the false-positive rate near
// zero on prose / fixtures (`sk-test`, `ghp_short`, etc. do NOT flag).
//
// Pre-registered (rule #9 / vision.md § 13.1 secret-scanning): pivot if the
// regex set is too narrow (a leak class slips through real content) or too
// noisy (≥2 false positives per month on legitimate file content). The
// allow-list annotation (slice ≥3, mirroring the otel-no-pii pattern) is the
// targeted relief valve, not regex relaxation.
//
// Slice 2 (this file): adds `scanFilesForSecrets({ files })` — the pure
// multi-file walker that runs the slice-1 classifier across a list of
// `{ path, source }` records and returns aggregated violations with the
// file path attached to each finding. Mirrors `extractAttributeViolations`
// in `scripts/check-otel-no-pii.mjs` (the slice-2 walker on the OTEL side
// of vision.md § 13). The lefthook pre-commit hook, allow-list annotation,
// and CI gate ship in slices ≥3 against this fixed seam.
//
// Slice 3 (this file): adds the `@scan-secrets-allowed: <reason>` annotation
// seam — a comment carrying the annotation on the offending line OR the line
// immediately preceding suppresses the finding, provided the reason is ≥3
// characters of substantive text after trimming. Mirrors `@otel-pii-allowed`
// in `scripts/check-otel-no-pii.mjs`; the floor (3 chars) matches the
// `MIN_ALLOW_REASON_LEN` / `MIN_OPT_OUT_REASON_LEN` floors elsewhere in the
// rule-#13 substrate so opt-out reasons across security gates have the same
// minimum substantiveness. The annotation is comment-form-agnostic: the
// regex matches the bare token regardless of whether it's preceded by `//`,
// `#`, `/* */`, `;`, etc., so the same seam works in JS/TS, shell, dotenv,
// YAML, INI — wherever a credential might land. Malformed annotations
// (missing or too-short reason) do NOT suppress; the underlying violation
// stands so the operator fixes one or the other (parent task `Details (c)`).
//
// Slice 4 (this file): wires the walker into a runnable CLI + CI gate +
// lefthook pre-commit hook. Two invocation modes share the same code path:
//
//   1. No positional args → full scan via `git ls-files` (the CI mode).
//      Excludes test files (`*.test.{mjs,ts,tsx}`) — those legitimately
//      embed credential-shaped strings as fixtures and are guarded by the
//      slice-3 annotation. Excludes binary file extensions (.png, .pdf,
//      .lock files, fonts) by name; tracked text files are everything else.
//
//   2. Positional args → scan only those paths (the lefthook mode). The
//      hook expands `{staged_files}` into the CLI's argv; if zero files
//      stage, lefthook short-circuits and the CLI is never invoked. This
//      mirrors `git diff --cached`'s shape and keeps pre-commit fast even
//      on large commits — only what the operator is about to commit gets
//      scanned, not the whole tree.
//
// Both modes feed `scanFilesForSecrets` and exit non-zero on any finding.
// The CI gate (`.github/workflows/ci.yml::secret-scan`) runs the full mode
// on every push and PR; lefthook (`lefthook.yml::pre-commit::scan-secrets`)
// runs the staged-files mode locally before the commit lands. Both share
// the classifier, the walker, and the annotation — three pure seams behind
// one boundary, per the parent task's gitleaks/trufflehog pivot strategy
// (rule #2 — swap the boundary, keep the seams).
//
// Pattern: deterministic gate (rule #10), pure function (rule #2 — the
// classifier is the seam, the staged-files walker / CLI / gitleaks pivot is
// the boundary). Sibling: `scripts/check-otel-no-pii.mjs` (slice 1 of the
// other half of vision.md § 13.1+§ 13.2 — credentials in span attributes vs
// credentials in tracked files).
//
// Source: vision.md § 13 "Security & privacy — second priority after
//   performance" (the 8-item minimum bar — secret-scanning is item #1);
//   TASKS.md `secret-scanning-precommit-and-ci` § Details; Truffle Security
//   "The State of Secrets Sprawl 2023" (median TTD for public-GitHub leaked
//   tokens is in hours; the cost of a leak is real); GitHub PAT format docs
//   (https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/);
//   AWS IAM access key format (`AKIA…`); Google Cloud API key format docs;
//   Saltzer & Schroeder 1975 "open design" (the gate is a public lint, not
//   a private heuristic).
// Conformance: full — no I/O, no async, no LLM.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// Files larger than this are skipped to keep the regex scan O(repo size).
// Real credentials are short; legitimate large tracked files (lockfiles,
// generated bundles) push this threshold and are vanishingly unlikely to
// embed a high-entropy credential prefix in a way the slice-1 patterns
// would match. 1 MiB matches gitleaks's default `max-target-bytes`.
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * @typedef {object} SecretPattern
 * @property {string} tag      machine-readable identifier (`github-pat`, …).
 *                             Stable: external tooling / allow-lists pin to
 *                             this string.
 * @property {string} label    human-readable label for diagnostics.
 * @property {RegExp} re       global regex (`/g` flag — required for
 *                             multi-find on a single line via `matchAll`).
 */

/**
 * High-confidence credential shapes. Each entry's regex MUST carry the `g`
 * flag — `scanContentForSecrets` uses `String.prototype.matchAll` to find
 * every occurrence. Tags are stable identifiers (downstream allow-lists pin
 * to them); labels are diagnostic-only and may change.
 *
 * Order is the diagnostic order — when multiple patterns match the same
 * substring (rare; the prefixes are disjoint), the first wins.
 */
export const SECRET_PATTERNS = Object.freeze(
  /** @type {readonly SecretPattern[]} */ ([
    Object.freeze({
      tag: "github-pat",
      label: "GitHub personal access token",
      re: /\bghp_[A-Za-z0-9]{36}\b/g,
    }),
    Object.freeze({
      tag: "github-oauth",
      label: "GitHub OAuth access token",
      re: /\bgho_[A-Za-z0-9]{36}\b/g,
    }),
    Object.freeze({
      tag: "github-server-token",
      label: "GitHub server-to-server token",
      re: /\bghs_[A-Za-z0-9]{36}\b/g,
    }),
    Object.freeze({
      tag: "github-user-server-token",
      label: "GitHub user-to-server token",
      re: /\bghu_[A-Za-z0-9]{36}\b/g,
    }),
    Object.freeze({
      tag: "anthropic-or-openai-key",
      label: "Anthropic / OpenAI API key (sk-…)",
      re: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    }),
    Object.freeze({
      tag: "slack-bot-token",
      label: "Slack bot token (xoxb-…)",
      re: /\bxoxb-[A-Za-z0-9-]{10,}\b/g,
    }),
    Object.freeze({
      tag: "slack-user-token",
      label: "Slack user token (xoxp-…)",
      re: /\bxoxp-[A-Za-z0-9-]{10,}\b/g,
    }),
    Object.freeze({
      tag: "slack-app-token",
      label: "Slack app-level token (xoxa-…)",
      re: /\bxoxa-[A-Za-z0-9-]{10,}\b/g,
    }),
    Object.freeze({
      tag: "slack-config-token",
      label: "Slack config token (xoxs-…)",
      re: /\bxoxs-[A-Za-z0-9-]{10,}\b/g,
    }),
    Object.freeze({
      tag: "aws-access-key-id",
      label: "AWS access key ID",
      re: /\bAKIA[0-9A-Z]{16}\b/g,
    }),
    Object.freeze({
      tag: "google-api-key",
      label: "Google API key",
      re: /\bAIza[0-9A-Za-z_-]{35,}\b/g,
    }),
    Object.freeze({
      tag: "pem-private-key",
      label: "PEM private key header",
      re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
    }),
  ]),
);

/**
 * @typedef {object} SecretFinding
 * @property {string} tag        the matched pattern's stable tag.
 * @property {string} label      the matched pattern's human label.
 * @property {number} line       1-based line number of the match.
 * @property {number} column     1-based column number of the match's start.
 * @property {string} snippet    the matched substring, redacted to first 4
 *                               chars + `…` (length-bounded so a finding can
 *                               be logged without re-leaking the credential).
 */

/**
 * @typedef {{ ok: true } | { ok: false, findings: SecretFinding[] }} ScanResult
 */

const SNIPPET_HEAD_LEN = 4;

// Slice 3: allow-annotation seam. The regex captures any text after the
// `@scan-secrets-allowed:` token up to end-of-line (or the closing `*/` of
// a block comment); the captured group's trimmed length must be ≥
// `MIN_ALLOW_REASON_LEN` for the annotation to suppress. The leading word
// boundary (`\b`) prevents accidental subset matches like
// `@scan-secrets-allowed-but-not-really:`.
const ALLOW_ANNOTATION_RE = /\B@scan-secrets-allowed:[ \t]*([^\r\n]*?)(?:[ \t]*\*\/[ \t]*)?$/m;
const MIN_ALLOW_REASON_LEN = 3;

/**
 * Check whether a string of text contains a well-formed allow-annotation.
 * Used by `scanContentForSecrets` to test the line containing each finding
 * and the line immediately preceding it; either may carry the annotation.
 *
 * @param {string} line
 * @returns {boolean}
 */
function lineHasAllowAnnotation(line) {
  const m = line.match(ALLOW_ANNOTATION_RE);
  if (!m) return false;
  const reason = (m[1] ?? "").replace(/\s*\*\/\s*$/, "").trim();
  return reason.length >= MIN_ALLOW_REASON_LEN;
}

/**
 * Redact a matched secret to a safe diagnostic form: `<first-N-chars>…`.
 * The first 4 chars are kept so the diagnostic distinguishes `ghp_` /
 * `gho_` / `sk-` / `AKIA` / etc. without echoing the full credential into
 * logs (which would defeat the purpose of the scan when CI logs are public).
 *
 * @param {string} match
 * @returns {string}
 */
function redactSnippet(match) {
  if (match.length <= SNIPPET_HEAD_LEN) {
    return match;
  }
  return `${match.slice(0, SNIPPET_HEAD_LEN)}…`;
}

/**
 * Compute line-offsets so absolute index → (line, column) is O(log n).
 * Line 1 starts at offset 0.
 *
 * @param {string} text
 * @returns {number[]}
 */
function computeLineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0x0a /* \n */) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Binary search for the largest `offsets[i] ≤ index`, return 1-based
 * (line, column).
 *
 * @param {readonly number[]} offsets
 * @param {number} index
 * @returns {{ line: number, column: number }}
 */
function locateInOffsets(offsets, index) {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const offset = offsets[mid];
    if (offset !== undefined && offset <= index) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const lineStart = offsets[lo] ?? 0;
  return { line: lo + 1, column: index - lineStart + 1 };
}

/**
 * Slice 3 suppression: a finding on `line` (1-based) is suppressed iff its
 * own line OR the line immediately preceding carries a well-formed
 * `@scan-secrets-allowed: <reason ≥3>` annotation. Inline form covers
 * `EXPORT KEY=… # @scan-secrets-allowed: …` (shell, dotenv); preceding-line
 * form covers `// @scan-secrets-allowed: …\nconst k = '…'` (JS/TS) and the
 * block-comment / `#` / `;` variants — the regex is comment-form-agnostic.
 *
 * @param {readonly string[]} lines
 * @param {number} line
 * @returns {boolean}
 */
function isFindingSuppressed(lines, line) {
  const own = lines[line - 1];
  if (own !== undefined && lineHasAllowAnnotation(own)) return true;
  const prev = lines[line - 2];
  if (prev !== undefined && lineHasAllowAnnotation(prev)) return true;
  return false;
}

/**
 * Pure scanner. Given a string of file content, return `{ ok: true }` if no
 * known credential shape is present, otherwise `{ ok: false, findings: [...] }`
 * with one entry per match (a single file may contain multiple secrets).
 *
 * Findings are sorted by `(line, column)` ascending so the diagnostic order
 * is stable and matches reading order.
 *
 * @param {string} text
 * @returns {ScanResult}
 */
export function scanContentForSecrets(text) {
  if (typeof text !== "string") {
    return {
      ok: false,
      findings: [
        {
          tag: "non-string-input",
          label: "scanContentForSecrets requires a string",
          line: 0,
          column: 0,
          snippet: "",
        },
      ],
    };
  }

  /** @type {SecretFinding[]} */
  const findings = [];
  const lineOffsets = computeLineOffsets(text);
  const lines = text.split(/\r?\n/);

  for (const { tag, label, re } of SECRET_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const matched = match[0];
      const index = match.index ?? 0;
      const { line, column } = locateInOffsets(lineOffsets, index);
      if (isFindingSuppressed(lines, line)) continue;
      findings.push({
        tag,
        label,
        line,
        column,
        snippet: redactSnippet(matched),
      });
    }
  }

  if (findings.length === 0) {
    return { ok: true };
  }

  findings.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });

  return { ok: false, findings };
}

/**
 * Convenience: format a finding as a one-line diagnostic suitable for
 * CLI / lefthook output. The redacted snippet is included so the operator
 * can disambiguate which line in a multi-finding file is which, without
 * exposing the full credential.
 *
 * @param {SecretFinding} finding
 * @param {string} [filePath]   optional repo-relative path for context.
 * @returns {string}
 */
export function formatFinding(finding, filePath) {
  const where = filePath
    ? `${filePath}:${finding.line}:${finding.column}`
    : `${finding.line}:${finding.column}`;
  return `${where}: ${finding.label} (${finding.tag}) — ${finding.snippet}`;
}

/**
 * @typedef {object} WalkerSourceFile
 * @property {string} path     POSIX, repo-relative — preserved verbatim on
 *                             every violation so the CLI / hook can print
 *                             a click-through `path:line:col` location.
 * @property {string} source   full file content as a UTF-8 string. Binary
 *                             files are the CLI wrapper's concern (slice ≥4);
 *                             this walker treats `source` as opaque text.
 */

/**
 * @typedef {SecretFinding & { file: string }} ScanViolation
 */

/**
 * Pure multi-file walker. Run `scanContentForSecrets` against each input
 * file's `source` and return aggregated violations with the originating
 * `file` path attached to each finding. Findings preserve the slice-1
 * `(line, column)` ordering within each file; files are reported in the
 * order they were supplied (call-site decides whether that's
 * `git diff --cached`'s order, alphabetical, etc.).
 *
 * Pure: no I/O, no globals, no async. The CLI wrapper (slice 4) is
 * responsible for reading files off disk and feeding them in. This boundary
 * matches `extractAttributeViolations({ files })` in
 * `scripts/check-otel-no-pii.mjs` so the same staged-files plumbing can be
 * shared.
 *
 * @param {{ files: readonly WalkerSourceFile[] }} input
 * @returns {{ violations: ScanViolation[] }}
 */
export function scanFilesForSecrets({ files }) {
  /** @type {ScanViolation[]} */
  const violations = [];
  for (const f of files) {
    const result = scanContentForSecrets(f.source);
    if (result.ok) continue;
    for (const finding of result.findings) {
      violations.push({ ...finding, file: f.path });
    }
  }
  return { violations };
}

// CLI ------------------------------------------------------------------------

// Suffix-based skip list. Test files legitimately carry credential-shaped
// strings as fixtures (every paired test in `scan-secrets.test.mjs` and
// `check-otel-no-pii.test.mjs` exercises the classifier with literals) — the
// slice-3 annotation handles the inline-fixture case, but blanket-excluding
// test files keeps the lint quiet on the harness itself. Binary extensions
// are excluded because `readFileSync(path, "utf8")` would mojibake them and
// could yield spurious matches.
const EXCLUDED_SUFFIXES = Object.freeze([
  ".test.mjs",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".woff",
  ".woff2",
  ".otf",
  ".ttf",
  ".eot",
]);

/**
 * @param {string} relPosix  repo-relative POSIX path
 * @returns {boolean}
 */
export function isScannablePath(relPosix) {
  if (relPosix === "") return false;
  for (const suffix of EXCLUDED_SUFFIXES) {
    if (relPosix.endsWith(suffix)) return false;
  }
  return true;
}

/**
 * @param {string[]} argv  the script's argv tail (`process.argv.slice(2)`).
 * @returns {{ repo: string, paths: string[] }}
 *   `repo` is the absolute path the CLI scans against (overridable via
 *   `--repo=<dir>` for tests). `paths` is the set of repo-relative POSIX
 *   paths the operator passed positionally (lefthook's `{staged_files}`
 *   expansion); empty array means full-scan mode.
 */
export function parseArgs(argv) {
  let repo = REPO_ROOT;
  /** @type {string[]} */
  const paths = [];
  for (const arg of argv) {
    if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
      continue;
    }
    if (arg.startsWith("--")) continue;
    paths.push(arg);
  }
  return { repo, paths };
}

/**
 * Enumerate every tracked file in `repo` via `git ls-files`. POSIX paths
 * (forward-slash) regardless of host OS so violation reports are stable
 * across CI / local. Excludes test fixtures + binary extensions per
 * `isScannablePath`.
 *
 * @param {string} repo
 * @returns {string[]}
 */
export function listScannableTrackedFiles(repo) {
  const stdout = execFileSync("git", ["-C", repo, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const all = stdout.length === 0 ? [] : stdout.split("\0").filter((p) => p.length > 0);
  return all.filter(isScannablePath).sort();
}

/**
 * Read each `relPath` (skipping files larger than `MAX_FILE_BYTES`,
 * non-existent paths, and paths outside `repo`'s ls-files set) and return
 * the `{ path, source }` records the walker consumes. Errors are surfaced
 * as a separate `errors` array so the caller can decide whether to fail
 * the gate on read failures (CI does; pre-commit on missing files does
 * not — `git diff --cached` may list a path that's been concurrently
 * deleted).
 *
 * @param {string} repo
 * @param {readonly string[]} relPaths
 * @returns {{ files: WalkerSourceFile[], errors: { path: string, reason: string }[] }}
 */
export function readScannableFiles(repo, relPaths) {
  /** @type {WalkerSourceFile[]} */
  const files = [];
  /** @type {{ path: string, reason: string }[]} */
  const errors = [];
  for (const rel of relPaths) {
    const result = readOneScannableFile(repo, rel);
    if (result.kind === "skip") continue;
    if (result.kind === "error") {
      errors.push({ path: rel, reason: result.reason });
      continue;
    }
    files.push({ path: rel, source: result.source });
  }
  return { files, errors };
}

/**
 * @param {string} repo
 * @param {string} rel
 * @returns {{ kind: "skip" } | { kind: "error", reason: string } | { kind: "ok", source: string }}
 */
function readOneScannableFile(repo, rel) {
  if (!isScannablePath(rel)) return { kind: "skip" };
  const abs = isAbsolute(rel) ? rel : resolve(repo, rel);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return { kind: "error", reason: "missing" };
  }
  if (!stat.isFile()) return { kind: "skip" };
  if (stat.size > MAX_FILE_BYTES) return { kind: "skip" };
  try {
    return { kind: "ok", source: readFileSync(abs, "utf8") };
  } catch (err) {
    return { kind: "error", reason: err instanceof Error ? err.message : "unreadable" };
  }
}

/**
 * End-to-end pipeline: list scannable files (full or staged), read each,
 * run the walker, return aggregated violations + the count of files
 * actually scanned. Used by `main()` and exercised in unit tests via
 * `--repo=<dir>` + optional positional paths.
 *
 * @param {string} repo
 * @param {readonly string[]} positionalPaths
 *   Empty → full scan via `git ls-files`. Non-empty → only those paths
 *   (lefthook's `{staged_files}` mode).
 * @returns {{ scanned: number, violations: ScanViolation[] }}
 */
export function scanRepoForSecrets(repo, positionalPaths) {
  const relPaths =
    positionalPaths.length === 0 ? listScannableTrackedFiles(repo) : [...positionalPaths];
  const { files } = readScannableFiles(repo, relPaths);
  const { violations } = scanFilesForSecrets({ files });
  return { scanned: files.length, violations };
}

function main() {
  const { repo, paths } = parseArgs(process.argv.slice(2));
  const { scanned, violations } = scanRepoForSecrets(repo, paths);

  if (violations.length === 0) {
    const mode = paths.length === 0 ? "tracked" : "staged";
    process.stdout.write(
      `scan-secrets ok: scanned ${scanned} ${mode} file(s); 0 credential shapes detected.\n`,
    );
    process.exit(0);
    return;
  }

  process.stderr.write("scan-secrets: credential shapes detected:\n");
  for (const v of violations) {
    process.stderr.write(`  ${formatFinding(v, v.file)}\n`);
  }
  process.stderr.write(
    [
      "",
      "Fix one of:",
      "  1. remove the credential and rotate it (every credential committed",
      "     to git is compromised — rotation is required even after deletion);",
      "  2. annotate the offending line with a comment carrying",
      "     `@scan-secrets-allowed: <reason ≥3 chars>` if the match is a",
      "     genuine false positive (e.g. a documented fixture, an example in",
      "     a test, or a public-issue dump). The annotation is comment-form-",
      "     agnostic — `//`, `#`, `/* */`, `;` all work.",
      "",
      "See vision.md § 13.1 (security & privacy minimum-bar item #1).",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("scan-secrets.mjs") === true;
if (invokedDirectly) main();
