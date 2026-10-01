#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over the *inverse* substrate-cohesion direction
// of `check-rule-13-sibling-anchors.mjs`. That gate pins TASKS.md → "rule #13"
// citation; this gate pins vision.md § 13's numbered minimum-bar items 1–6 to
// the canonical task IDs in `SIBLING_P0_IDS`. Without it, a future PR can
// rename a sibling P0 in TASKS.md (and update its anchor citation) while
// leaving vision.md § 13's `(TASKS.md \`old-id\` P0)` citation rotting.
//
// Source: vision.md rule #13 (security & privacy as #2 priority — minimum-bar
//   items 1–6 each map to one of these P0s); rule #10 (deterministic
//   enforcement — bidirectional substrate cohesion is a CI lint, not a hope);
//   TASKS.md `security-privacy-priority-substrate` acceptance criteria #1 + #3
//   (rule #13 with 8-item minimum bar; the 6 sibling P0s linked to rule #13).
//   Conformance: full — pure function over the vision.md text, no I/O in the
//   check itself.
//
// Why this gate exists: the existing `check-rule-13-sibling-anchors.mjs` only
// catches one half of the substrate-cohesion drift hazard. If a sibling P0 is
// renamed in TASKS.md, that gate's matcher (which keys off the IDs in
// `SIBLING_P0_IDS`) keeps passing as long as the new name is added to the
// constant — but vision.md still cites the old name in plain text. This gate
// closes the inverse direction: vision.md must cite each canonical ID
// verbatim in its corresponding numbered item.
//
// Pivot (rule #9): if vision.md's citation form changes (e.g., a future
// rewrite drops the backtick-quoted task IDs in favour of a separate index
// table), narrow the matcher to the new shape. Substrate cohesion stays a
// hard requirement; only the citation form shifts.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SIBLING_P0_IDS } from "./check-rule-13-sibling-anchors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const RULE_13_HEADING_RE = /^###\s+13\.\s+Security\s+&\s+privacy/i;
const NEXT_HEADING_RE = /^##/;
const NUMBERED_ITEM_RE = /^(\d+)\.\s/;

/**
 * Locate the rule-#13 section body in vision.md. Returns the slice between the
 * `### 13.` heading and the next `## …` (top-level) heading, or `null` if the
 * heading is absent. Pure function — no I/O.
 *
 * @param {string} visionMdText
 * @returns {string | null}
 */
export function extractRule13Section(visionMdText) {
  const lines = visionMdText.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (RULE_13_HEADING_RE.test(lines[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (NEXT_HEADING_RE.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * Extract the body of each numbered minimum-bar item (1, 2, …) from a section
 * body. Each item starts at a line matching `^N. ` and continues until the
 * next `^M. ` line. Returns a `Map<number, string>` keyed by the item number.
 * Pure function — no I/O.
 *
 * @param {string} sectionBody
 * @returns {Map<number, string>}
 */
export function extractNumberedItems(sectionBody) {
  /** @type {Map<number, string>} */
  const out = new Map();
  const lines = sectionBody.split("\n");
  /** @type {{ n: number, buf: string[] } | null} */
  let current = null;
  for (const line of lines) {
    const m = line.match(NUMBERED_ITEM_RE);
    if (m !== null) {
      if (current !== null) out.set(current.n, current.buf.join("\n"));
      current = { n: Number.parseInt(m[1] ?? "0", 10), buf: [line] };
      continue;
    }
    if (current !== null) current.buf.push(line);
  }
  if (current !== null) out.set(current.n, current.buf.join("\n"));
  return out;
}

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure entry point: assert vision.md § 13 minimum-bar items 1..N each cite the
 * corresponding `SIBLING_P0_IDS[N-1]` as a backticked task ID. The 6 sibling
 * IDs are the canonical source of truth (also pinned by
 * `check-rule-13-sibling-anchors.mjs`); this gate enforces that vision.md's
 * prose citations match.
 *
 * @param {string} visionMdText
 * @param {readonly string[]} [siblingIds]
 * @returns {CheckResult}
 */
export function checkVisionRule13TaskIdCitations(visionMdText, siblingIds = SIBLING_P0_IDS) {
  const section = extractRule13Section(visionMdText);
  if (section === null) {
    return { ok: false, errors: ["vision.md: `### 13. Security & privacy` heading not found"] };
  }
  const items = extractNumberedItems(section);
  /** @type {string[]} */
  const errors = [];
  for (let i = 0; i < siblingIds.length; i++) {
    const itemNum = i + 1;
    const expectedId = siblingIds[i] ?? "";
    const body = items.get(itemNum);
    if (body === undefined) {
      errors.push(`vision.md § 13: minimum-bar item #${itemNum} not found`);
      continue;
    }
    const backtickRe = new RegExp(`\`${expectedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``);
    if (!backtickRe.test(body)) {
      errors.push(
        `vision.md § 13 item #${itemNum}: expected backticked task ID \`${expectedId}\`, not found in item body`,
      );
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const visionPath = resolve(REPO_ROOT, "vision.md");
  const text = await readFile(visionPath, "utf8");
  const result = checkVisionRule13TaskIdCitations(text);
  if (result.ok) {
    process.stdout.write(
      `vision-rule-13-task-id-citations ok: all ${SIBLING_P0_IDS.length} sibling P0 IDs cited verbatim in vision.md § 13.\n`,
    );
    return 0;
  }
  process.stderr.write("vision-rule-13-task-id-citations violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "Per vision.md § 13 (security & privacy as #2 priority after performance) and",
      "TASKS.md `security-privacy-priority-substrate` acceptance criteria #1 and #3,",
      "every minimum-bar item 1–6 must cite its sibling P0 task ID verbatim as",
      "backticked text — pinning the inverse direction of `check-rule-13-sibling-anchors`.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-vision-rule-13-task-id-citations.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
