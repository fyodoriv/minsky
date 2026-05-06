#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over `TASKS.md` substrate cohesion — every
// task block listed as a sibling P0 of `security-privacy-priority-substrate`
// must cite `rule #13` in its `**Anchor**:` line, anchoring its existence to
// vision.md § 13's minimum-bar enumeration.
// Source: vision.md rule #13 (security & privacy as #2 priority after
//   performance — minimum-bar items 1–6 each map to one of these P0s);
//   rule #10 (deterministic enforcement — substrate cohesion is a CI lint,
//   not a hope); TASKS.md `security-privacy-priority-substrate` acceptance
//   criterion #3 ("the 6 sibling security P0s linked to rule #13 in their
//   Anchor lines"). Conformance: full — pure function over the TASKS.md
//   text, no I/O in the check itself.
//
// Why this gate exists: when `vision.md` § 13 was added (PR #242, the
// substrate slice), the 6 sibling security P0 task blocks already existed
// from an earlier P0 sweep and cited various other rules in their anchors
// (rule #1, #2, #4, #7, #10) but none cited rule #13 itself. Without an
// explicit citation, future readers re-running the queue could not see
// which substrate clause each P0 operationalises, and rule #13 would
// silently lose its grip on the 6 P0s that are its concrete instantiation.
// This lint pins every P0 listed below to cite `rule #13`; the inverse
// regression (a future PR removes a citation) trips the lint deterministically.
//
// Pivot (rule #9): if rule #13 is later replaced or subsumed (e.g., a
// dedicated `vision.md` chapter on security & privacy lands and the rule
// citation form changes), narrow the matcher to the new citation form
// rather than retire — substrate cohesion stays a hard requirement; only
// the citation token shifts.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * The 6 sibling security P0s that vision.md § 13 names as the minimum bar.
 * Each ID is the literal `**ID**:` value of a task block in TASKS.md. Order
 * mirrors vision.md § 13's numbered list (1 → secret-scanning, 2 → otel-no-pii,
 * 3 → supervisor-sandbox, 4 → dashboard-localhost, 5 → supply-chain, 6 →
 * cloud-tier-audit), so the `## minimum-bar item #N` annotation in each P0's
 * anchor line is auditable against this list directly.
 */
export const SIBLING_P0_IDS = Object.freeze([
  "secret-scanning-precommit-and-ci",
  "otel-no-pii-in-spans-lint",
  "supervisor-sandbox-syscall-restriction",
  "dashboard-localhost-only-by-default",
  "supply-chain-hardening-lockfile-sbom-slsa",
  "cloud-tier-external-security-audit-gate",
]);

const RULE_13_RE = /\brule\s*#\s*13\b/i;

/**
 * @typedef {{ id: string, anchor: string | null }} BlockAnchor
 */

const TASK_HEADER_RE = /^- \[[ x]\] /;
const ID_LINE_RE = /^\s+- \*\*ID\*\*:\s*(\S+)/;
const ANCHOR_LINE_RE = /^\s+- \*\*Anchor\*\*:\s*(.+)$/;

/**
 * Classify a single TASKS.md line into one of: a new task header, an `**ID**:`
 * line, an `**Anchor**:` line, or `other`. Splitting the loop body out keeps
 * `extractAnchorsForIds` under the cognitive-complexity cap.
 *
 * @param {string} line
 * @returns {{ kind: "header" } | { kind: "id", id: string } | { kind: "anchor", value: string } | { kind: "other" }}
 */
function classifyLine(line) {
  if (TASK_HEADER_RE.test(line)) return { kind: "header" };
  const idMatch = line.match(ID_LINE_RE);
  if (idMatch !== null) return { kind: "id", id: idMatch[1] ?? "" };
  const anchorMatch = line.match(ANCHOR_LINE_RE);
  if (anchorMatch !== null) return { kind: "anchor", value: anchorMatch[1] ?? "" };
  return { kind: "other" };
}

/**
 * Step the parser one line forward. Returns the next `currentId` value (which
 * may be the same as the input). Mutates `found` only when a wanted-id's first
 * Anchor line is observed.
 *
 * @param {ReturnType<typeof classifyLine>} c
 * @param {string | null} currentId
 * @param {Map<string, string | null>} found
 * @returns {string | null}
 */
function stepParser(c, currentId, found) {
  if (c.kind === "header") return null;
  if (c.kind === "id") return found.has(c.id) ? c.id : null;
  if (c.kind === "anchor" && currentId !== null && found.get(currentId) === null) {
    found.set(currentId, c.value);
    return null;
  }
  return currentId;
}

/**
 * Extract `(id, anchorLine)` pairs from the TASKS.md content for every ID in
 * `wantedIds`. The TASKS.md format is:
 *
 *   - [ ] `<title>`
 *     - **ID**: <id>
 *     ...
 *     - **Anchor**: <citation>
 *     ...
 *
 * For each `id`, we capture the first `**Anchor**:` line that appears after
 * the `**ID**: <id>` line and before the next `- [ ]` / `- [x]` task header.
 * If no anchor line is found within that window, the value is `null`.
 *
 * Pure function — no I/O.
 *
 * @param {string} tasksMdText
 * @param {readonly string[]} wantedIds
 * @returns {BlockAnchor[]}
 */
export function extractAnchorsForIds(tasksMdText, wantedIds) {
  /** @type {Map<string, string | null>} */
  const found = new Map();
  for (const id of wantedIds) found.set(id, null);

  /** @type {string | null} */
  let currentId = null;
  for (const line of tasksMdText.split("\n")) {
    currentId = stepParser(classifyLine(line), currentId, found);
  }
  return wantedIds.map((id) => ({ id, anchor: found.get(id) ?? null }));
}

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure entry point: assert every sibling P0's Anchor line cites rule #13.
 *
 * @param {string} tasksMdText
 * @param {readonly string[]} [siblingIds]
 * @returns {CheckResult}
 */
export function checkRule13SiblingAnchors(tasksMdText, siblingIds = SIBLING_P0_IDS) {
  const blocks = extractAnchorsForIds(tasksMdText, siblingIds);
  /** @type {string[]} */
  const errors = [];
  for (const { id, anchor } of blocks) {
    if (anchor === null) {
      errors.push(`task \`${id}\`: no \`**Anchor**:\` line found in TASKS.md`);
      continue;
    }
    if (!RULE_13_RE.test(anchor)) {
      errors.push(
        `task \`${id}\`: \`**Anchor**:\` does not cite \`rule #13\` (security & privacy as #2 priority — vision.md § 13 minimum-bar item).`,
      );
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const tasksPath = resolve(REPO_ROOT, "TASKS.md");
  const text = await readFile(tasksPath, "utf8");
  const result = checkRule13SiblingAnchors(text);
  if (result.ok) {
    process.stdout.write(
      `rule-13-sibling-anchors ok: ${SIBLING_P0_IDS.length} sibling security P0s all cite rule #13.\n`,
    );
    return 0;
  }
  process.stderr.write("rule-13-sibling-anchors violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "Per vision.md § 13 (security & privacy as #2 priority after performance) and",
      "TASKS.md `security-privacy-priority-substrate` acceptance criterion #3, every",
      "sibling P0 must explicitly cite `rule #13` in its `**Anchor**:` line, naming",
      "which minimum-bar item (1–6) it operationalises.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-rule-13-sibling-anchors.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
