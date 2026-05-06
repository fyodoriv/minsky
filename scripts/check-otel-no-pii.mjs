#!/usr/bin/env node
// @ts-check
// Slice 1 of `otel-no-pii-in-spans-lint` (TASKS.md): the pure classifier.
//
// `classifySpanAttribute(name, value)` decides whether a key/value pair that
// would land on an OTEL span attribute looks like PII or a credential. It is
// intentionally regex-based and deterministic; the call-site walker, CLI, and
// CI wiring ship in subsequent slices, against this fixed seam.
//
// Two rejection paths:
//
//   1. NAME-shape: the attribute name matches one of the credential-shaped
//      tokens documented in TASKS.md `otel-no-pii-in-spans-lint` Hypothesis —
//      `(api[_-]?key | password | token | secret | credential | bearer)`.
//      Match is case-insensitive and substring (so `apiKey`, `userPassword`,
//      `auth_token`, `clientSecret`, `bearer_jwt` all flag).
//
//   2. VALUE-shape: the value is a string and matches a known credential
//      prefix:
//        - `sk-…` (≥20 trailing alphanumerics) — Anthropic / OpenAI keys
//        - `ghp_…` (≥30 trailing alphanumerics) — GitHub PATs
//        - `xoxb-…` / `xoxp-…` — Slack tokens
//      The value rule is independent of the name; a span attribute named
//      `note` whose value is `sk-...` still flags.
//
// Both shapes return `{ ok: false, reason }`. Anything else returns
// `{ ok: true }`. Non-string values short-circuit value-shape detection
// (numbers, booleans, undefined are never credentials by themselves).
//
// Pre-registered (rule #9 / vision.md § 13.2 OTEL no-PII): pivot if the regex
// is too narrow (a leak class slips through) or too noisy (≥2 false positives
// per month on legitimate attribute names). The allow-list (slice ≥2) is the
// targeted relief valve, not regex relaxation.
//
// Pattern: deterministic gate (rule #10), pure function (rule #2 — the
// classifier is the seam, the call-site walker / CLI is the boundary).
// Source: rule #13.2 (OTEL no-PII as one of the eight security minimum-bar
//   items); GDPR Art. 25 (data protection by design); CCPA equivalent in
//   California; OWASP A04 "Insecure Design"; Truffle Security 2023 ("State of
//   Secrets Sprawl") — credential prefix patterns.
// Conformance: full — no I/O, no async, no LLM.
//
// Slice 2 (this file): adds `extractAttributeViolations({ files })` — the
// pure AST walker that finds `attributes: { … }` object-literal properties
// (the shape `emit({ name, attributes })` call sites pass), runs the slice-1
// classifier on each property, and returns the violation list. The diff
// base, CLI, and CI wire-in still ship in slice ≥4 against this fixed seam.
//
// Slice 3 (this file): adds the `// @otel-pii-allowed: <reason>` annotation
// seam — a leading-comment escape hatch on a flagged property suppresses the
// violation, provided the reason is ≥3 characters of substantive text. This
// is the parent task's `Details (c)` (TASKS.md `otel-no-pii-in-spans-lint`):
// "explicit annotations like `// @otel-pii-allowed: <reason>` next to a
// flagged line, recording why this particular attribute is intentionally
// PII-shaped (e.g., a hash of an opaque ID where the regex false-positives
// on the `_token` substring)." Both `//` and `/* … */` comment forms are
// honoured; the annotation must appear in the leading-trivia of the offending
// property (i.e., between the previous token and the property's first token).
// Malformed annotations (missing reason / reason < 3 chars) do NOT suppress
// — the original violation stands so the operator can fix one or the other.
//
// Slice 4 (this file): wires the walker into a runnable CLI. `main()` walks
// `novel/**/*.ts` (excluding `*.test.ts`, `*.fixture.ts`, `*.d.ts`), feeds
// every file into `extractAttributeViolations`, and exits 0 / 1 on the
// violation list. Full-scan rather than diff-based: the parent task's
// Hypothesis (TASKS.md `otel-no-pii-in-spans-lint`) preregisters
// "0 PII-shaped attributes across all current `record({...})` calls",
// which is a global invariant — diff-based grandfathering would defeat it.
// The companion `.github/workflows/ci.yml` `otel-no-pii` job runs this CLI
// on every PR and is wired into the `ci` gate's `needs:` array.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {object} ClassifyResult
 * @property {boolean} ok                  true = safe to record on a span.
 * @property {string} [reason]             present when `ok === false`.
 * @property {"name-shape" | "value-shape"} [shape]
 *   which family triggered the rejection. Useful for slice ≥2 reporting +
 *   for the operator's allow-list annotation.
 */

// Name-shape: the substrings that flag a credential-like attribute name.
// `api[_-]?key` matches `apikey`, `api_key`, `api-key`, and via the
// case-insensitive flag, `apiKey` / `ApiKey` / etc. The other tokens are
// plain substrings — `password` flags `userPassword`, `passwordHash`,
// `oldPassword`, etc. Entry order is also the diagnostic order (the
// `reason` field cites the first-matched token).
const NAME_PATTERNS = Object.freeze([
  Object.freeze({ tag: "api-key", re: /api[_-]?key/i }),
  Object.freeze({ tag: "password", re: /password/i }),
  Object.freeze({ tag: "secret", re: /secret/i }),
  Object.freeze({ tag: "credential", re: /credential/i }),
  Object.freeze({ tag: "bearer", re: /bearer/i }),
  Object.freeze({ tag: "token", re: /token/i }),
]);

// Value-shape: known credential prefixes. The minimum-tail length (`{20,}`,
// `{30,}`) is a deliberate guard against e.g. `sk-test` being flagged when
// it's actually a label. Real Anthropic / OpenAI / GitHub keys are far
// longer than the floor; the floor exists to keep the false-positive rate
// near zero on prose.
const VALUE_PATTERNS = Object.freeze([
  Object.freeze({ tag: "anthropic-or-openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ }),
  Object.freeze({ tag: "github-pat", re: /\bghp_[A-Za-z0-9]{30,}\b/ }),
  Object.freeze({ tag: "slack-bot-token", re: /\bxoxb-[A-Za-z0-9-]{10,}\b/ }),
  Object.freeze({ tag: "slack-user-token", re: /\bxoxp-[A-Za-z0-9-]{10,}\b/ }),
]);

// Allow-list annotation (slice 3). Must capture a non-empty reason; the
// `MIN_ALLOW_REASON_LEN` floor matches `check-pr-security-review.mjs`'s
// `MIN_OPT_OUT_REASON_LEN` so opt-out reasons across security gates have
// the same minimum substantiveness. Greedy match for the reason keeps
// `// @otel-pii-allowed: hash; not the secret itself` working — the comment
// terminator (`*/` or end-of-line) is the bound, not the next punctuation.
const ALLOW_ANNOTATION_RE = /@otel-pii-allowed:[ \t]*([^\r\n*]+?)(?:[ \t]*\*\/)?[ \t]*$/m;
const MIN_ALLOW_REASON_LEN = 3;

/**
 * Pure classifier. Decide whether a key/value pair would leak PII or a
 * credential if recorded on an OTEL span.
 *
 * @param {string} name                attribute key on the span
 * @param {unknown} value              attribute value (typed `unknown` because
 *                                     OTEL accepts string | number | bool |
 *                                     array; non-strings skip the value rule)
 * @returns {ClassifyResult}
 */
export function classifySpanAttribute(name, value) {
  if (typeof name !== "string") {
    // Defensive: `name` is always a string in real OTEL usage. If someone
    // hands us a non-string, treat it as a malformed attribute — reject.
    return {
      ok: false,
      shape: "name-shape",
      reason: "attribute name must be a string",
    };
  }

  for (const { tag, re } of NAME_PATTERNS) {
    if (re.test(name)) {
      return {
        ok: false,
        shape: "name-shape",
        reason: `attribute name matches credential pattern: ${tag}`,
      };
    }
  }

  if (typeof value === "string") {
    for (const { tag, re } of VALUE_PATTERNS) {
      if (re.test(value)) {
        return {
          ok: false,
          shape: "value-shape",
          reason: `attribute value matches credential prefix: ${tag}`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Convenience: classify every entry of a `Record<string, unknown>` (the shape
 * `record({ … })` call sites pass). Returns the first violation, or `null`
 * if every attribute is safe. The walker (slice ≥2) calls this against the
 * literal-object AST nodes it extracts.
 *
 * @param {Record<string, unknown>} attrs
 * @returns {(ClassifyResult & { name: string }) | null}
 */
export function classifyAttributesObject(attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    const result = classifySpanAttribute(name, value);
    if (!result.ok) {
      return { ...result, name };
    }
  }
  return null;
}

/**
 * @typedef {object} WalkerSourceFile
 * @property {string} path     POSIX, repo-relative
 * @property {string} source   full TS source text
 */

/**
 * @typedef {object} WalkerViolation
 * @property {string} file
 * @property {number} line                 1-based
 * @property {string} attributeName        the property key that flagged
 * @property {"name-shape" | "value-shape"} shape
 * @property {string} reason
 */

/**
 * Pure AST walker over TypeScript source files. Finds every
 * `attributes: { … }` PropertyAssignment whose value is an ObjectLiteral
 * (the shape Minsky's `emit({ name, attributes })` and OTEL's
 * `setAttributes({ … })` call sites use), and runs `classifySpanAttribute`
 * against each inner property.
 *
 * Recognised inner-property shapes:
 *
 *   1. `attributes: { apiKey: "x" }`           — string literal value
 *   2. `attributes: { apiKey: \`x\` }`           — no-substitution template
 *   3. `attributes: { apiKey: someVar }`       — non-literal; classify by
 *                                                 NAME ONLY (value-shape
 *                                                 cannot be statically
 *                                                 verified, so it falls
 *                                                 through unflagged unless
 *                                                 the NAME itself flags)
 *
 * Identifier / computed property keys (e.g. `[NAME]: …`) are skipped: the
 * static name is unknown and the runtime classifier (slice ≥4 follow-up)
 * is the right point to catch those. Non-string-literal values whose name
 * is safe are also skipped — same justification.
 *
 * Pure: no I/O, no globals. The CLI wrapper (slice ≥3) is responsible for
 * reading files off disk and feeding them in.
 *
 * @param {{ files: readonly WalkerSourceFile[] }} input
 * @returns {{ violations: WalkerViolation[] }}
 */
export function extractAttributeViolations({ files }) {
  /** @type {WalkerViolation[]} */
  const violations = [];
  for (const f of files) {
    const sf = ts.createSourceFile(
      f.path,
      f.source,
      ts.ScriptTarget.ES2023,
      true,
      f.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    walk(sf, sf, f.path, violations);
  }
  return { violations };
}

/**
 * Recursively descend the AST. When we hit a `PropertyAssignment` whose
 * (identifier or string-literal) name is `attributes` and whose initializer
 * is an `ObjectLiteralExpression`, classify each of that object's
 * properties.
 *
 * @param {ts.Node} node
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {WalkerViolation[]} out
 */
function walk(node, sf, path, out) {
  if (ts.isPropertyAssignment(node) && propertyKeyName(node.name) === "attributes") {
    if (ts.isObjectLiteralExpression(node.initializer)) {
      classifyObjectLiteral(node.initializer, sf, path, out);
    }
  }
  ts.forEachChild(node, (child) => walk(child, sf, path, out));
}

/**
 * Classify each property of an ObjectLiteralExpression.
 *
 * @param {ts.ObjectLiteralExpression} obj
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {WalkerViolation[]} out
 */
function classifyObjectLiteral(obj, sf, path, out) {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyKeyName(prop.name);
    if (name === undefined) continue;
    const value = staticValueOf(prop.initializer);
    const result = classifySpanAttribute(name, value);
    if (result.ok) continue;
    if (hasValidAllowAnnotation(sf, prop)) continue;
    const { line } = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
    out.push({
      file: path,
      line: line + 1,
      attributeName: name,
      shape: /** @type {"name-shape" | "value-shape"} */ (result.shape),
      reason: /** @type {string} */ (result.reason),
    });
  }
}

/**
 * Slice 3: check the leading-trivia of `node` for a well-formed
 * `// @otel-pii-allowed: <reason>` annotation. Both line-comments (`//`) and
 * block-comments (`/* … *\/`) are honoured. The annotation suppresses the
 * violation iff the captured reason is ≥`MIN_ALLOW_REASON_LEN` characters
 * after trimming. Malformed annotations (missing or too-short reason) do NOT
 * suppress — the underlying violation stands so the operator can fix either
 * the annotation or the attribute.
 *
 * @param {ts.SourceFile} sf
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasValidAllowAnnotation(sf, node) {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart());
  if (!ranges) return false;
  for (const range of ranges) {
    const commentText = sf.text.slice(range.pos, range.end);
    const m = commentText.match(ALLOW_ANNOTATION_RE);
    if (!m) continue;
    const reason = (m[1] ?? "").trim();
    if (reason.length >= MIN_ALLOW_REASON_LEN) return true;
  }
  return false;
}

/**
 * Extract the static name of a PropertyName node, or `undefined` if the
 * key is computed / non-literal (those are skipped by the walker; the
 * runtime guard in slice ≥4 covers them).
 *
 * @param {ts.PropertyName} name
 * @returns {string | undefined}
 */
function propertyKeyName(name) {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

/**
 * Extract the static value of an initializer if and only if it's a
 * string literal or a no-substitution template literal. Anything else
 * (identifiers, numbers, calls, …) returns `undefined` — the classifier
 * then falls back to name-only classification.
 *
 * @param {ts.Expression} expr
 * @returns {string | undefined}
 */
function staticValueOf(expr) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  return undefined;
}

// CLI ------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {{ repo: string }}
 */
export function parseArgs(argv) {
  let repo = REPO_ROOT;
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m === null) continue;
    if (m[1] === "repo") repo = m[2] ?? repo;
  }
  return { repo };
}

// Suffix-based skip list (declarations / tests / fixtures). Order is
// irrelevant — `Array#some` short-circuits on the first match.
const EXCLUDED_SUFFIXES = Object.freeze([
  ".d.ts",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
  ".fixture.ts",
  ".fixture.tsx",
]);

// Substring-based skip list (path segments that designate fixture trees).
const EXCLUDED_SEGMENTS = Object.freeze(["/test/fixtures/", "/__fixtures__/"]);

/**
 * @param {string} relPosix  repo-relative POSIX path
 * @returns {boolean}
 */
function isInScope(relPosix) {
  if (!relPosix.startsWith("novel/")) return false;
  if (!(relPosix.endsWith(".ts") || relPosix.endsWith(".tsx"))) return false;
  if (EXCLUDED_SUFFIXES.some((s) => relPosix.endsWith(s))) return false;
  if (EXCLUDED_SEGMENTS.some((s) => relPosix.includes(s))) return false;
  return true;
}

/**
 * @param {string} dir
 * @param {(absPath: string) => void} onFile
 */
function walkDir(dir, onFile) {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".turbo") continue;
    const abs = resolve(dir, e.name);
    if (e.isDirectory()) walkDir(abs, onFile);
    else if (e.isFile()) onFile(abs);
  }
}

/**
 * Recursively list every `.ts` / `.tsx` file under `novel/` that is in the
 * lint's scope. Excludes test, spec, fixture, and `.d.ts` files plus
 * `**\/test/fixtures/**`, `**\/__fixtures__/**`, and `**\/node_modules/**`.
 * Returns POSIX-relative paths (forward-slash regardless of host OS) so
 * violation reports are reproducible across CI and local runs.
 *
 * @param {string} repo  absolute path to the repo root
 * @returns {string[]}
 */
export function listScannableNovelFiles(repo) {
  /** @type {string[]} */
  const out = [];
  const novelRoot = resolve(repo, "novel");
  walkDir(novelRoot, (abs) => {
    const rel = relative(repo, abs).split(sep).join("/");
    if (isInScope(rel)) out.push(rel);
  });
  out.sort();
  return out;
}

/**
 * Read-and-classify pipeline. Pure-ish — does file I/O but is deterministic
 * given a stable filesystem. Used by `main()` and exercised in unit tests
 * via the `--repo=<dir>` knob.
 *
 * @param {string} repo
 * @returns {{ scanned: number, violations: WalkerViolation[] }}
 */
export function scanRepoForOtelPii(repo) {
  const files = listScannableNovelFiles(repo).map((rel) => ({
    path: rel,
    source: readFileSync(resolve(repo, rel), "utf8"),
  }));
  const { violations } = extractAttributeViolations({ files });
  return { scanned: files.length, violations };
}

function main() {
  const { repo } = parseArgs(process.argv.slice(2));
  const { scanned, violations } = scanRepoForOtelPii(repo);

  if (violations.length === 0) {
    process.stdout.write(
      `otel-no-pii ok: scanned ${scanned} novel/**/*.ts file(s); 0 PII-shaped span attributes.\n`,
    );
    process.exit(0);
    return;
  }

  process.stderr.write("otel-no-pii: PII-shaped span attributes found:\n");
  for (const v of violations) {
    process.stderr.write(
      `  ${v.file}:${v.line} attributes.${v.attributeName} (${v.shape}) — ${v.reason}\n`,
    );
  }
  process.stderr.write(
    [
      "",
      "Fix one of:",
      "  1. rename the attribute / drop the credential value;",
      "  2. annotate the offending property with a leading comment",
      "     `// @otel-pii-allowed: <reason ≥3 chars>` if the match is a",
      "     genuine false positive (e.g. an opaque hash whose name happens",
      "     to contain `_token`).",
      "",
      "See vision.md § 13.2 (security & privacy minimum-bar item #2).",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-otel-no-pii.mjs") === true;
if (invokedDirectly) main();
