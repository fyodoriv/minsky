#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over `novel/**/README.md` STRIDE-shaped threat-model
// sections — every constitutional novel package's README must carry a `## Threat
// model` section that engages with STRIDE methodology by name and has at least
// 5 non-empty content lines. Pins the 16 sections shipped in PR #249 (10
// top-level packages) + PR #250 (6 adapter subpackages), extended to cover
// `novel/bridges/omc-tasksmd/README.md` once `bridges/README.md` declared it
// owns its per-package threat model.
// Source: vision.md rule #13.8 (threat-model section per novel package);
//   TASKS.md `security-privacy-priority-substrate` acceptance criterion #5;
//   rule #10 (deterministic enforcement — drift detection is a CI lint, not a
//   hope); Howard & LeBlanc, *Writing Secure Code*, 2003 (STRIDE shape).
//   Conformance: full — pure function over README text, no I/O in the check.
//
// Why this gate exists: PRs #249 and #250 added STRIDE-shaped threat-model
// sections to all 16 `novel/*/README.md` and `novel/adapters/*/README.md`
// files, satisfying acceptance criterion #5 of `security-privacy-priority-
// substrate`. Without a deterministic pin, a future README rewrite could
// silently shrink, weaken, or drop these sections — and rule #13.8 would
// lose its grip on the package-level documentation surface that operators
// rely on for incident response. This lint pins the section's existence,
// minimum substance (≥5 non-empty lines), STRIDE-name engagement (the
// methodology must be cited even when a package's STRIDE letters don't
// apply, as in `novel/adapters/types/README.md`), and the per-package
// `performance-first carve-out` line (vision.md § 13's relief-valve clause —
// the surface where declared performance/security trade-offs live).
//
// Pivot (rule #9): if STRIDE is later replaced by a different threat-model
// methodology in vision.md (e.g., LINDDUN for privacy-heavy packages),
// extend the matcher to accept either token rather than retire — the
// requirement is engagement with a named threat-model methodology, not
// STRIDE specifically.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * The constitutional novel-package READMEs that must carry a STRIDE-shaped
 * `## Threat model` section. Hardcoded (not glob-discovered) on purpose: a
 * new `novel/<name>/` package added without a threat-model section should
 * surface as a separate, visible PR ratchet (add the package + add it here +
 * add the section), not slip in silently.
 *
 * Composition: 10 top-level `novel/<pkg>/` packages + 6 `novel/adapters/<pkg>/`
 * subpackages + 1 `novel/bridges/<pkg>/` subpackage (the bridges parent
 * README explicitly delegates per-bridge threat models — see its `## Threat
 * model` section). Future bridges land their own row here in the same PR
 * that adds them.
 */
export const THREAT_MODEL_README_PATHS = Object.freeze([
  "novel/bridges/README.md",
  "novel/bridges/omc-tasksmd/README.md",
  "novel/budget-guard/README.md",
  "novel/cross-repo-runner/README.md",
  "novel/dashboard-web/README.md",
  "novel/experiment-record/README.md",
  "novel/handoff-spec/README.md",
  "novel/mape-k-loop/README.md",
  "novel/sidecar-bootstrap/README.md",
  "novel/spec-monitor/README.md",
  "novel/tick-loop/README.md",
  "novel/adapters/notifier/README.md",
  "novel/adapters/observability/README.md",
  "novel/adapters/persona-spawner/README.md",
  "novel/adapters/prompt-optimizer/README.md",
  "novel/adapters/token-monitor/README.md",
  "novel/adapters/types/README.md",
]);

const SECTION_HEADER_RE = /^## Threat model\s*$/m;
const NEXT_H2_RE = /^## /m;
const STRIDE_RE = /\bSTRIDE\b/i;
const MIN_CONTENT_LINES = 5;
// vision.md § 13's relief-valve clause: "performance wins on a case-by-case
// basis, with the security cost documented in the relevant package's
// threat-model section as a declared deviation." Pin the per-section line so
// a future README rewrite cannot silently drop the carve-out, removing the
// surface where declared performance/security trade-offs live.
const CARVE_OUT_RE = /\bperformance-first carve-out\b/i;
// vision.md § 13.8's enumeration: "every package's README has a 'Threat model'
// section enumerating: (a) what's untrusted, (b) what's trusted, (c) the
// boundary between them." Pin the (a)/(b)/(c) triplet so a future README
// rewrite cannot drop one of the three axes the constitutional rule names.
// Word boundaries make `\bTrusted\b` reject the substring inside `Untrusted`.
const UNTRUSTED_RE = /\bUntrusted\b/i;
const TRUSTED_RE = /\bTrusted\b/i;
const TRUST_BOUNDARY_RE = /\btrust\s+boundary\b/i;
// vision.md § 13.8 anchor: every threat-model section must cite `vision.md`
// back to the constitution. The canonical opening line everywhere on main is
// "Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard
// & LeBlanc, *Writing Secure Code*, 2003." Pin the `vision.md` reference so a
// future README rewrite cannot silently drop the anchor line — the carve-out
// clause already mentions `rule #13` (e.g., "(rule #13's relief valve)") so
// requiring `rule #13` alone wouldn't catch an anchor-line drop. Requiring
// `vision.md` is what tightens the pin.
const VISION_MD_RE = /\bvision\.md\b/i;

/**
 * Slice the `## Threat model` section body out of a README. Returns `null`
 * when no header exists; otherwise the lines between the header and the next
 * `## ` heading (or EOF). Bold/emphasis markers stay intact — callers strip
 * as needed.
 *
 * @param {string} readmeText
 * @returns {string | null}
 */
export function extractThreatModelSection(readmeText) {
  const match = readmeText.match(SECTION_HEADER_RE);
  if (match === null || match.index === undefined) return null;
  const after = readmeText.slice(match.index + match[0].length);
  const nextHeader = after.match(NEXT_H2_RE);
  return nextHeader?.index !== undefined ? after.slice(0, nextHeader.index) : after;
}

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure check on a single README's text. Asserts:
 *   1. A `## Threat model` heading exists (case-sensitive — the canonical form).
 *   2. The section body has ≥ 5 non-empty content lines (guards against
 *      a future rewrite shrinking it to a stub).
 *   3. The section names STRIDE explicitly (case-insensitive). Even when a
 *      package's STRIDE letters don't apply (e.g., the leaf-only `types`
 *      adapter), the methodology must be cited so future readers see the
 *      author engaged with it rather than skipped it.
 *   4. The section names rule #13's "performance-first carve-out" clause
 *      (case-insensitive). This is the documented surface for declared
 *      performance/security trade-offs per vision.md § 13's relief valve;
 *      every package must say either "none declared" or list the deviations.
 *      Pinning forces the surface to stay populated even when no deviation
 *      currently exists.
 *   5. The section names the (a)/(b)/(c) trust-boundary triplet from vision.md
 *      § 13.8 — `Untrusted`, `Trusted`, and `Trust boundary` (each
 *      case-insensitive, word-bounded). This is the constitutional
 *      enumeration; without all three, the section can engage with STRIDE
 *      while skipping the trust-axis decomposition that operators read first
 *      during incident response.
 *   6. The section cites `vision.md` (case-insensitive). The canonical opening
 *      line is "Per constitutional rule #13 (vision.md § 13.8). …"; pinning
 *      `vision.md` catches a future rewrite that silently drops the anchor
 *      line back to the constitution. Pinning `rule #13` alone wouldn't
 *      suffice — the carve-out clause already names `rule #13` (e.g., "(rule
 *      #13's relief valve)"), so a citation drop would slip through.
 *
 * @param {string} readmeText
 * @returns {CheckResult}
 */
export function checkThreatModelSection(readmeText) {
  const section = extractThreatModelSection(readmeText);
  if (section === null) {
    return { ok: false, errors: ["missing `## Threat model` section"] };
  }
  /** @type {string[]} */
  const errors = [];
  const nonEmptyLines = section.split("\n").filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length < MIN_CONTENT_LINES) {
    errors.push(
      `section has ${nonEmptyLines.length} non-empty content lines (minimum ${MIN_CONTENT_LINES}) — risk of stub drift`,
    );
  }
  if (!STRIDE_RE.test(section)) {
    errors.push(
      "section does not name `STRIDE` — rule #13.8 requires explicit methodology engagement",
    );
  }
  if (!CARVE_OUT_RE.test(section)) {
    errors.push(
      "section does not name `performance-first carve-out` — vision.md § 13's relief-valve clause requires per-package documentation of declared deviations (or an explicit `none declared` line)",
    );
  }
  if (!UNTRUSTED_RE.test(section)) {
    errors.push(
      "section does not name `Untrusted` — vision.md § 13.8 (a) requires the package to enumerate what's untrusted",
    );
  }
  if (!TRUSTED_RE.test(section)) {
    errors.push(
      "section does not name `Trusted` (standalone, not the substring of `Untrusted`) — vision.md § 13.8 (b) requires the package to enumerate what's trusted",
    );
  }
  if (!TRUST_BOUNDARY_RE.test(section)) {
    errors.push(
      "section does not name `Trust boundary` — vision.md § 13.8 (c) requires the package to name the boundary between trusted and untrusted",
    );
  }
  if (!VISION_MD_RE.test(section)) {
    errors.push(
      "section does not cite `vision.md` — rule #13.8 requires the section to anchor back to the constitution (canonical: `Per constitutional rule #13 (vision.md § 13.8).`)",
    );
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @typedef {{ path: string, result: CheckResult }} PathResult
 */

/**
 * Aggregate check across all hardcoded paths. Pure: takes a `Map<path,
 * content>` and returns a list of `{ path, result }` entries.
 *
 * @param {ReadonlyMap<string, string>} contentsByPath
 * @param {readonly string[]} [paths]
 * @returns {PathResult[]}
 */
export function checkAllThreatModelSections(contentsByPath, paths = THREAT_MODEL_README_PATHS) {
  return paths.map((path) => {
    const text = contentsByPath.get(path);
    if (text === undefined) {
      return { path, result: { ok: false, errors: ["file missing on disk"] } };
    }
    return { path, result: checkThreatModelSection(text) };
  });
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  // Parallel reads: 17 paths × ~10ms read latency, sequenced via `Promise.all`
  // shrinks wall-time to the per-file ceiling instead of summing the latencies.
  const reads = await Promise.all(
    THREAT_MODEL_README_PATHS.map(async (rel) => {
      try {
        const text = await readFile(resolve(REPO_ROOT, rel), "utf8");
        return /** @type {const} */ ([rel, text]);
      } catch {
        // Returning `null` lets us drop the entry; checkAll surfaces
        // "file missing on disk" via the absent Map key.
        return /** @type {const} */ ([rel, null]);
      }
    }),
  );
  /** @type {Map<string, string>} */
  const contents = new Map();
  for (const [rel, text] of reads) {
    if (text !== null) contents.set(rel, text);
  }
  const results = checkAllThreatModelSections(contents);
  const failures = results.filter((r) => !r.result.ok);
  if (failures.length === 0) {
    process.stdout.write(
      `threat-model-section ok: ${THREAT_MODEL_README_PATHS.length} novel/** READMEs all carry a STRIDE-shaped threat-model section.\n`,
    );
    return 0;
  }
  process.stderr.write("threat-model-section violation:\n");
  for (const { path, result } of failures) {
    if (result.ok) continue;
    for (const err of result.errors) {
      process.stderr.write(`  - ${path}: ${err}\n`);
    }
  }
  process.stderr.write(
    [
      "",
      "Per vision.md § 13.8 and TASKS.md `security-privacy-priority-substrate`",
      "acceptance criterion #5, every novel package's README must carry a",
      "STRIDE-shaped `## Threat model` section with ≥5 non-empty content lines",
      "and a per-package `performance-first carve-out` line (vision.md § 13's",
      "relief-valve clause — declared deviations OR an explicit `none declared`).",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-threat-model-section.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
