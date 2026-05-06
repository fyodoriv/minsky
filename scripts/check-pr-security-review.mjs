#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements parent task `security-privacy-priority-substrate` § Measurement — `pr-security-review` (filed as follow-up) -->
// Slice 1 of `pr-security-review` (parent: TASKS.md `security-privacy-priority-substrate`
// § Measurement — "CI lint `pr-security-review` blocks merge otherwise (filed as
// follow-up)"): the pure decision function over a PR body.
//
// `checkPrSecurityReview(body)` enforces the parent task's Measurement
// criterion: every feature PR's body contains either evidence the security &
// privacy review happened, or a typed opt-out documenting *why* it doesn't
// apply. The two accepted shapes are:
//
//   1. **Section / heading shape** — the body contains a heading or line that
//      says "Security & privacy" (or "Security and privacy"). Match is
//      case-insensitive. The line is the marker that the PR author considered
//      the rule-#13 8-item minimum bar against this change.
//
//   2. **Typed opt-out** — `<!-- security: not-applicable — <reason ≥3 chars> -->`
//      (or the ASCII `--` separator). The reason is mandatory; "n/a" / empty
//      reasons fail. Per the parent task's Pivot threshold the opt-out is the
//      relief valve when a PR genuinely doesn't touch a security surface
//      (typo / docs-only / vendor-bump).
//
// Pre-registered (rule #9 / vision.md § 13): the gate ships in slice 1 as the
// pure seam — CLI wrapper + paired tests, **not** wired into CI in this slice.
// Slice ≥2 wires it into `.github/workflows/ci.yml` and `STACK_MANIFEST` after
// the false-positive rate is observed locally on the merge log. Pivot if FPR
// ≥10%/week (per parent's Pivot field) — narrow the required-mention set to
// PRs touching `/scripts`, `/distribution`, `/novel/dashboard-web`, or any
// auth/secret path. The carve-out clause in vision.md § 13 is the relief
// valve, not retirement.
//
// Pattern: deterministic gate (rule #10) over a PR-body convention; pure
// decision function (rule #2 — body string is the seam, the CLI is the
// boundary). Sibling: `scripts/check-pr-self-grade.mjs` (same shape, different
// rule).
// Source: vision.md § 13 "Security & privacy — second priority after
//   performance" (the 8-item minimum bar); TASKS.md
//   `security-privacy-priority-substrate` § Measurement; OWASP LLM Top 10
//   (2025 ed.); GDPR Article 25 (privacy by design); Saltzer & Schroeder,
//   *Proceedings of the IEEE* 63(9), 1975 (open design — the review must
//   leave a trace, not happen silently).
// Conformance: full — pure shape check, no I/O, no LLM.

// Section-shape match: heading line OR bullet/prose line containing the
// phrase. Case-insensitive. Both "&" and "and" are accepted because the
// vision.md heading uses "&" while body prose may use "and".
//
// `[ \t]*` (NOT `\s*`) to keep matches on a single line — `\s*` would span
// newlines and accidentally match the next line's value.
const SECTION_HEADING_RE = /^[ \t]*#+[ \t]*security[ \t]+(?:&|and)[ \t]+privacy\b/im;
const SECTION_LINE_RE = /\bsecurity[ \t]+(?:&|and)[ \t]+privacy\b/i;

// Typed opt-out: `<!-- security: not-applicable — <reason> -->`. Both the em
// dash (—, U+2014) and ASCII `--` are accepted as the separator — the em dash
// is the canonical form in TASKS.md briefs, but operator-side keyboards
// frequently produce `--` and rejecting that would be a UX trap. The reason
// must be ≥3 chars of substantive text (matching `check-pr-self-grade.mjs`'s
// `MIN_VALUE_LEN`).
const OPT_OUT_RE =
  /<!--[ \t]*security[ \t]*:[ \t]*not-applicable[ \t]*(?:—|--)[ \t]*([^>-][^>]*?)[ \t]*-->/i;

const MIN_OPT_OUT_REASON_LEN = 3;

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure function: given a PR body, return `{ ok: true }` if either the
 * security-section marker is present OR a well-formed typed opt-out is
 * present. Otherwise `{ ok: false, errors: [...] }`.
 *
 * @param {string} body
 * @returns {CheckResult}
 */
export function checkPrSecurityReview(body) {
  const optOutMatch = body.match(OPT_OUT_RE);
  if (optOutMatch) {
    const captured = optOutMatch[1];
    if (captured === undefined) {
      return {
        ok: false,
        errors: ["found `<!-- security: not-applicable -->` opt-out but the reason is missing"],
      };
    }
    const reason = captured.trim();
    if (reason.length < MIN_OPT_OUT_REASON_LEN) {
      return {
        ok: false,
        errors: [
          `\`<!-- security: not-applicable — <reason> -->\` reason is too short (≥${MIN_OPT_OUT_REASON_LEN} chars required); got "${reason}"`,
        ],
      };
    }
    return { ok: true };
  }

  if (SECTION_HEADING_RE.test(body) || SECTION_LINE_RE.test(body)) {
    return { ok: true };
  }

  return {
    ok: false,
    errors: [
      "missing security & privacy review marker. Add either a `## Security & privacy` section to the PR body OR a `<!-- security: not-applicable — <reason ≥3 chars> -->` opt-out. See vision.md § 13.",
    ],
  };
}

/**
 * CLI: reads PR body from a file path passed as the first argument, OR from
 * stdin if no argument is given. Mirrors `check-pr-self-grade.mjs`'s shape so
 * the eventual CI job can copy-paste the invocation.
 *
 * @returns {Promise<number>}
 */
async function main() {
  const arg = process.argv[2];
  /** @type {string} */
  let body;
  if (arg !== undefined && arg !== "-") {
    const { readFile } = await import("node:fs/promises");
    body = await readFile(arg, "utf8");
  } else {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    body = Buffer.concat(chunks).toString("utf8");
  }
  const result = checkPrSecurityReview(body);
  if (result.ok) {
    process.stdout.write("pr-security-review ok: review marker (or typed opt-out) present.\n");
    return 0;
  }
  process.stderr.write("pr-security-review violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "Required: PR body contains ONE of the following.",
      "",
      "  Option A — section heading:",
      "    ## Security & privacy",
      "    <one or more lines describing the threat surface + mitigation, or",
      "     'no new attack surface; vision.md § 13 minimum-bar items reviewed'>",
      "",
      "  Option B — typed opt-out (PR genuinely doesn't touch a security surface):",
      "    <!-- security: not-applicable — <reason ≥3 chars> -->",
      "",
      "See vision.md § 13 for the 8-item minimum bar.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-pr-security-review.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
