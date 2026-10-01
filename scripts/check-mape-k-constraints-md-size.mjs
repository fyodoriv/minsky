#!/usr/bin/env node
// Pattern: deterministic CI gate over an append-only knowledge log size cap.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: every prose-only invariant in a `novel/**/README.md` gets a
//   deterministic linter as soon as the artefact it guards becomes
//   machine-readable); `novel/mape-k-loop/constraints.md` (the live
//   immutable Knowledge log whose 200-entry archive cap was prose-only
//   until this gate landed); Helland, "Life beyond Distributed
//   Transactions", *CIDR* 2007 (immutable log; archive-by-reissue rather
//   than mutate); Beck, *Extreme Programming Explained*, 1999, Ch. 17
//   (CI as the constraint enforcer).
// Conformance: full — pure decision function over `{ content, capEntries }`,
//   thin CLI wrapper owns I/O, no LLM in the chain.
//
// Why this gate exists: `novel/mape-k-loop/constraints.md` is the
// MAPE-K Knowledge phase's append-only substrate (Kephart & Chess,
// "The Vision of Autonomic Computing", *IEEE Computer* 36(1) 2003,
// over Helland 2007's immutable log). Every tick of the loop appends a
// `## <ISO-8601 date>` section. Without a cap the file grows unbounded
// — past ~200 entries the live log becomes unreadable for the human
// operator who needs to scan recent decisions during incident response.
// The README declares a 200-entry cap as the operator's signal to
// archive older sections to a dated file (`constraints-2026Q2.md`) per
// Helland 2007's "derived data through reissue, not mutation". Until
// this gate landed the cap was prose-only; an unattended loop could
// grow constraints.md to 500+ entries before anyone noticed (the same
// "did anyone notice?" failure mode rule-#6 closes mechanically).
//
// Heading shape: counts lines matching `^## <date>` where `<date>` is a
// YYYY-MM-DD ISO-8601 stamp. The strict date match (not a bare `^## `)
// avoids counting prose that happens to mention `## <ISO-8601 date>`
// inside a backticked example in the file's preamble. The README's
// preamble itself uses backticks around `## <ISO-8601 date>` precisely
// so it doesn't show up in this count — but a future README rewrite
// might break that, so the strict date regex is the load-bearing guard.
//
// Boundary semantics: the cap is *inclusive* — exactly 200 entries
// passes; only 201+ fails. Same precedent as `check-mape-k-budget-cap`'s
// inclusive-at-cap (Beyer SRE 2016 Ch. 3 — "you have used X % of your
// budget" is not a violation until X *exceeds* it).
//
// Dormant state (rule #7 — graceful degrade): if
// `novel/mape-k-loop/constraints.md` is not present, the lint exits 0
// with a stderr advisory ("constraints.md not yet present; lint
// dormant"). Same precedent as `check-skill-rule-cap`'s retired-Skill
// terminal state and `check-mape-k-budget-cap`'s dormant-config
// short-circuit.
//
// Pivot (rule #9, this gate): if 200 proves arbitrary (the file is
// still readable at 400), raise the cap rather than removing the lint.
// The cap-as-numeric-constant is the seam — a single integer change in
// one file. Removing the lint would re-open the unbounded-growth
// failure mode.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_CONSTRAINTS_PATH = resolve(REPO_ROOT, "novel", "mape-k-loop", "constraints.md");

/**
 * Default entry cap. Anchored to `novel/mape-k-loop/constraints.md`
 * preamble: "The supervisor's `constraints-md-size-cap` check fires
 * when this file grows past 200 entries". Locked by a paired test so a
 * silent edit surfaces loudly.
 */
export const DEFAULT_CAP_ENTRIES = 200;

// Anchored-to-line-start `## YYYY-MM-DD` heading marker. Multiline flag
// so `^` matches every line, not just the start of the buffer. Strict
// ISO-8601 date shape avoids counting prose that mentions the heading
// shape inside backticks (the README's own preamble does this).
const ENTRY_HEADING_RE_GLOBAL = /^##[ \t]+\d{4}-\d{2}-\d{2}\b/gm;
// Re-exported (single-match form) so tests can lock the regex shape
// independently of the entry-point function.
export const ENTRY_HEADING_RE = /^##[ \t]+\d{4}-\d{2}-\d{2}\b/m;

/**
 * @typedef {{ ok: boolean, count: number, reason?: string }} CheckResult
 */

/**
 * Pure function: counts `## <date>` heading lines in `content` and
 * returns `{ ok: false, reason }` when the count exceeds `capEntries`.
 * Returns `{ ok: true, count: 0 }` for null / empty content (treated
 * as the dormant state — the file does not yet exist or has not been
 * written to).
 *
 * `capEntries` defaults to {@link DEFAULT_CAP_ENTRIES} (200).
 *
 * @param {{ content: string | null, capEntries?: number }} args
 * @returns {CheckResult}
 */
export function checkConstraintsMdSize({ content, capEntries }) {
  const cap = capEntries ?? DEFAULT_CAP_ENTRIES;
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isInteger(cap)) {
    return {
      ok: false,
      count: 0,
      reason: `capEntries must be a positive integer; got ${String(cap)}.`,
    };
  }
  if (content === null || content === "") {
    return { ok: true, count: 0 };
  }
  const matches = content.match(ENTRY_HEADING_RE_GLOBAL) ?? [];
  const count = matches.length;
  if (count > cap) {
    return {
      ok: false,
      count,
      reason: `novel/mape-k-loop/constraints.md has ${count} \`## <date>\` entries; the rule-#10 ratchet caps it at ${cap}. Split older entries into an archive file (e.g., \`novel/mape-k-loop/constraints-<YYYYQ<n>>.md\`) per Helland 2007 (immutable log — derived data through reissue, not mutation), then keep the live log under the cap.`,
    };
  }
  return { ok: true, count };
}

/**
 * CLI: reads `novel/mape-k-loop/constraints.md` (or the path passed as
 * the first argument) and runs `checkConstraintsMdSize`.
 *
 * Exit codes:
 *   0 — pass, OR file missing (dormant state)
 *   1 — fail (entry count exceeds the cap)
 *   2 — I/O error other than ENOENT (rule-#6 let-it-crash)
 *
 * @returns {Promise<number>}
 */
async function main() {
  const path = process.argv[2] ?? DEFAULT_CONSTRAINTS_PATH;
  /** @type {string | null} */
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") {
      process.stderr.write(
        `mape-k-constraints-md-size advisory: ${path} not yet present; lint dormant until the mape-k-loop Knowledge log is written (rule #7 graceful degrade).\n`,
      );
      return 0;
    }
    process.stderr.write(
      `mape-k-constraints-md-size: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  const result = checkConstraintsMdSize({ content });
  if (!result.ok) {
    process.stderr.write(
      `mape-k-constraints-md-size violation:\n  - ${result.reason ?? "unknown"}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `mape-k-constraints-md-size ok: ${result.count} entry/entries (cap ${DEFAULT_CAP_ENTRIES}).\n`,
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-mape-k-constraints-md-size.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
