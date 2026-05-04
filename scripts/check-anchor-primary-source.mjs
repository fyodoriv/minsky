#!/usr/bin/env node
// Pattern: deterministic CI gate over the rule-#9 `anchor` field —
//   promotion of spec-monitor advisory rule A3 ("anchor citation is not a
//   primary source") into the deterministic-monitor layer.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: when an advisory rule is promoted to a deterministic linter, the
//   advisory counterpart is removed in the same PR); rule #5 / rule #8
//   (named, decades-tested pattern — the constitution should outlive any
//   single source); Havelund & Goldberg, "Verify Your Runs", *VSTTE* 2008
//   (runtime verification — the primary-source check is the deterministic-
//   monitor layer carved out from the residual advisory share);
//   `spec-advisories/2026-05-03-quarterly-audit.md` (audit decision: A3
//   admits a deterministic deny-list + allowlist).
// Conformance: full — pure function over the parsed `anchor` string; the
//   CLI is the I/O boundary (read EXPERIMENT.yaml, parse via
//   `@minsky/experiment-record`, run the check, exit).
//
// Why this gate exists: an `anchor` that points to a Medium post, a
// Wikipedia page, a tweet, or "ChatGPT said …" decays — blog URLs rot,
// Wikipedia edits, tweets vanish, ChatGPT outputs are non-reproducible. The
// constitution is supposed to outlive any single source (rule #5 / rule #8:
// "named, decades-tested pattern"). spec-monitor advisory rule A3 lists the
// recognisable deny-list of non-primary sources and the allowlist shape of
// primary-source citations; per the Q2 2026 quarterly audit those lists are
// mechanisable. Promoting them to a CI lint closes the blog-decay trap
// deterministically and frees the advisory substrate (≤5-rule cap, rule-#10
// ratchet) for the genuinely judgement-heavy residue.
//
// Three-way verdict:
//   - `fail` (exit 1): the anchor matches a deny-list token (medium.com,
//     substack, wikipedia, twitter/x.com, reddit, stackoverflow, chatgpt,
//     claude.ai, "ChatGPT said", "tweet by", "blog post").
//   - `pass` (exit 0): the anchor matches an allowlist pattern (italicised
//     book/journal title `*…*`, `Ch. <n>`, `pp. <n>`, ISBN, DOI, conference
//     proceedings names, internal cross-ref `vision.md §`/`rule #`).
//   - `warn` (exit 0, advisory stderr): neither list matches AND the
//     anchor is short (<25 chars). Long-tail prose stays advisory; the
//     deterministic gate stays loud-on-known-degenerate, silent-on-ambiguous.
//
// Matching is word-boundary-aware where applicable: `wiki` matches
// `wikipedia.org` but NOT `wikileaks` (boundary on `.`). The deny-list uses
// substring match for URLs (the URL itself is the signal).
//
// Opt-out: the EXPERIMENT.yaml may contain a top-level YAML comment line
//   # rule: ci-lint-anchor-primary-source: skip <reason ≥3 chars>
// in which case the lint passes regardless of anchor shape. Mirrors the
// pivot-success-margin opt-out shape; audited at quarterly review.
//
// Pivot (rule #9, this gate): if the deny-list grows past ~15 entries to
// cover legitimate variations (e.g., `arxiv.org` is sometimes primary,
// sometimes preprint-only), or if >10 % of historical anchors fall through
// to `warn`, the rule is judgement-bound and this lint is retired — A3
// stays advisory in SKILL.md.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseExperimentRecord } from "@minsky/experiment-record";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXPERIMENTS_DIR = resolve(HERE, "..", "experiments");

const SKIP_COMMENT_RE =
  /^[ \t]*#[ \t]*rule:[ \t]*ci-lint-anchor-primary-source:[ \t]*skip[ \t]+(\S.{2,})$/m;

const SHORT_ANCHOR_THRESHOLD = 25;

// ---- deny-list / allowlist -------------------------------------------------
//
// Each entry is { name, matcher }. Matchers are case-insensitive RegExps.
// The deny-list captures non-primary sources whose presence — anywhere in
// the anchor — is enough to fail. The allowlist captures primary-source
// shapes whose presence — anywhere in the anchor — is enough to pass.
// Allowlist wins on conflicts (e.g., a string that quotes a Medium post
// inside a citation to a peer-reviewed paper).

/**
 * @typedef {{ name: string, matcher: RegExp }} TokenRule
 */

/** @type {TokenRule[]} */
const DENYLIST = [
  // Blog platforms — substring match against the host portion of any URL.
  { name: "medium.com", matcher: /\bmedium\.com\b/i },
  { name: "substack.com", matcher: /\.substack\.com\b/i },
  { name: "wikipedia.org", matcher: /\bwikipedia\.org\b/i },
  { name: "Wikipedia (prose)", matcher: /\bwikipedia\b/i },
  // Social platforms.
  { name: "twitter.com", matcher: /\btwitter\.com\b/i },
  { name: "x.com (post)", matcher: /\bx\.com\/[^\s]+/i },
  { name: "reddit.com", matcher: /\breddit\.com\b/i },
  { name: "stackoverflow.com", matcher: /\bstackoverflow\.com\b/i },
  // LLM outputs.
  { name: "chatgpt.com", matcher: /\bchatgpt\.com\b/i },
  { name: "claude.ai", matcher: /\bclaude\.ai\b/i },
  // Prose forms — quoted in SKILL.md A3 directly.
  { name: "ChatGPT said", matcher: /\bchatgpt\s+said\b/i },
  { name: "tweet by", matcher: /\ba?\s*tweet\s+by\b/i },
  { name: "blog post", matcher: /\bblog\s+post\b/i },
];

/** @type {TokenRule[]} */
const ALLOWLIST = [
  // Italicised book / journal title — the standard citation shape used
  // throughout vision.md and the existing EXPERIMENT.yaml records.
  // Requires at least one alphabetic character inside the asterisks (so
  // bullet-list `*` markers don't false-positive).
  { name: "italicised title (*Title*)", matcher: /\*[^*]*[A-Za-z][^*]*\*/ },
  // Chapter / page citations — the canonical "I read the textbook" form.
  { name: "Ch. <n>", matcher: /\bCh\.?\s*\d+/i },
  { name: "pp. <n> / p. <n>", matcher: /\bpp?\.\s*\d+/i },
  // DOI prefix (10.<registrant>/<suffix>) — the most durable scholarly id.
  { name: "DOI", matcher: /\b(?:doi:\s*)?10\.\d{2,}\/\S+/i },
  // ISBN — book identifier.
  { name: "ISBN", matcher: /\bISBN[\s:-]?\d/i },
  // Conference proceedings — recognisable acronyms used in the vision.md
  // pattern index (TOPLAS, SOSP, OSDI, ICSE, FSE, CIDR, VSTTE, JACM, IJCAI,
  // SIGCOMM, NSDI, RCoSE, etc.). We match the *italicised* form
  // (`*<ACRONYM>*`) via the italicised-title matcher above; here we also
  // accept a bare token of two-or-more uppercase letters followed by a
  // 4-digit year — the "<VENUE> <YEAR>" shape ("VSTTE 2008", "SOSP 1989").
  { name: "<VENUE> <YEAR>", matcher: /\b[A-Z]{2,}\s+(?:19|20)\d{2}\b/ },
  // Internal cross-references to constitutional rules — the rules
  // themselves carry primary citations (rule #5 / rule #8 are the anchors).
  { name: "rule #<n>", matcher: /\brule\s*#\s*\d+/i },
  { name: "vision.md §", matcher: /\bvision\.md\s*§/i },
  // Spec-advisory cross-references — these themselves ladder up to primary
  // sources and are the recognised internal-citation form for rule-#10
  // ratchet promotions (the EXPERIMENT.yaml that promotes A2 cites the
  // 2026-05-03 audit; the same shape applies here).
  { name: "spec-advisories/<date>.md", matcher: /\bspec-advisories\/\d{4}-\d{2}-\d{2}/i },
];

// ---- pure entry point ------------------------------------------------------

/**
 * @typedef {{ ok: boolean, level: "fail" | "warn" | "pass", reason?: string }} CheckResult
 */

/**
 * Collect the names of every rule whose matcher hits `s`.
 *
 * @param {TokenRule[]} rules
 * @param {string} s
 * @returns {string[]}
 */
function collectHits(rules, s) {
  /** @type {string[]} */
  const hits = [];
  for (const rule of rules) {
    if (rule.matcher.test(s)) hits.push(rule.name);
  }
  return hits;
}

/**
 * Pure function: classify an anchor citation as `pass` / `fail` / `warn`.
 *
 *   - fail: at least one deny-list token matches AND no allowlist token
 *     does. The anchor is a known non-primary source.
 *   - pass: at least one allowlist token matches. (Allowlist wins over
 *     deny-list — a primary citation that *quotes* a Medium URL inside it
 *     should pass.)
 *   - warn: neither matches AND the anchor is short (<25 chars). Advisory.
 *   - pass-with-note: neither matches but the anchor is long enough that
 *     prose-citation patterns probably exist; advisory layer (spec-monitor)
 *     covers the residual judgement scope. Returned as `pass`.
 *
 * @param {string} anchor
 * @returns {CheckResult}
 */
export function checkAnchorPrimarySource(anchor) {
  const a = anchor ?? "";
  if (a.trim() === "") {
    return { ok: false, level: "fail", reason: "anchor is empty" };
  }

  // 1. Allowlist hit short-circuits to pass (allowlist wins on conflicts).
  const allowlistHits = collectHits(ALLOWLIST, a);
  if (allowlistHits.length > 0) {
    return {
      ok: true,
      level: "pass",
      reason: `primary-source pattern(s) present: ${allowlistHits.join(", ")}`,
    };
  }

  // 2. Deny-list hits — only meaningful when no allowlist matched.
  const denylistHits = collectHits(DENYLIST, a);
  if (denylistHits.length > 0) {
    return {
      ok: false,
      level: "fail",
      reason: `non-primary source token(s) present and no primary-source pattern: ${denylistHits.join(", ")}. Per rule #5 / rule #8 the constitution must outlive any single source; replace with a peer-reviewed paper, recognised textbook, standards document, or internal cross-reference (rule #<n> / vision.md § <n>).`,
    };
  }

  // 3. Neither list — short anchor → warn; long anchor → pass with note
  //    (the advisory layer / spec-monitor covers the residual judgement).
  if (a.length < SHORT_ANCHOR_THRESHOLD) {
    return {
      ok: true,
      level: "warn",
      reason: `no primary-source pattern recognised and anchor is short (<${SHORT_ANCHOR_THRESHOLD} chars) — falls in the residual judgement scope; reviewer should confirm the citation points to a peer-reviewed paper, textbook, or standards document.`,
    };
  }
  return {
    ok: true,
    level: "pass",
    reason: `no deny-list match; anchor is ≥${SHORT_ANCHOR_THRESHOLD} chars (advisory layer covers residual judgement).`,
  };
}

/**
 * Detect the inline opt-out comment in raw EXPERIMENT.yaml content.
 *
 * @param {string} rawYaml
 * @returns {{ skip: true, reason: string } | { skip: false }}
 */
export function detectSkipComment(rawYaml) {
  const m = rawYaml.match(SKIP_COMMENT_RE);
  if (m === null || m[1] === undefined) return { skip: false };
  return { skip: true, reason: m[1].trim() };
}

// Re-exports for tests.
export { ALLOWLIST, DENYLIST, SHORT_ANCHOR_THRESHOLD };

// ---- CLI -------------------------------------------------------------------

/**
 * Parse an EXPERIMENT.yaml file, run the check on its `anchor` field, and
 * produce an exit code per the three-way verdict.
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
        `anchor-primary-source ok: ${experimentPath} not found (handled by ci-experiment-runner gate).\n`,
      );
      return 0;
    }
    throw err;
  }

  const skip = detectSkipComment(yamlText);
  if (skip.skip) {
    process.stdout.write(
      `anchor-primary-source ok: skipped via opt-out comment ("${skip.reason}").\n`,
    );
    return 0;
  }

  const parsed = parseExperimentRecord(yamlText);
  if (!parsed.ok) {
    // Same boundary as measurement-inspects-output — invalid EXPERIMENT.yaml
    // is the parser / experiment-runner's job to flag, not this lint.
    process.stdout.write(
      `anchor-primary-source ok: ${experimentPath} did not parse (handled by @minsky/experiment-record / ci-experiment-runner).\n`,
    );
    return 0;
  }
  const result = checkAnchorPrimarySource(parsed.record.anchor);
  if (result.level === "pass") {
    process.stdout.write(`anchor-primary-source ok: ${result.reason}\n`);
    return 0;
  }
  if (result.level === "warn") {
    process.stderr.write(
      `anchor-primary-source warn: ${result.reason}\n  anchor: ${parsed.record.anchor}\n`,
    );
    return 0;
  }
  process.stderr.write(
    `anchor-primary-source violation:\n  - ${result.reason}\n  anchor: ${parsed.record.anchor}\n`,
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
        `anchor-primary-source ok: ${directoryPath} not found (handled by ci-experiment-runner gate).\n`,
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
      `anchor-primary-source ok: ${directoryPath} has no *.yaml files (nothing to check).\n`,
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
  process.argv[1]?.endsWith("check-anchor-primary-source.mjs");
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
