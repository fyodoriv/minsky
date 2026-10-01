#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over vision.md § 13 minimum-bar items 7 and 8 —
// the two items that have no sibling P0 task ID (item 7 "Privacy by default";
// item 8 "Threat model documented per novel/* package"). Pins the
// industry-standard anchor each item names, so a future rewrite cannot
// silently drop the methodological grounding while keeping the bullet body.
//
// Companion to `check-vision-rule-13-task-id-citations.mjs`, which pins items
// 1–6 to their canonical sibling P0 IDs. Together the two close the inverse
// substrate-cohesion direction for *every* numbered minimum-bar item, not
// just the ones that map to a P0 task.
//
// Source: vision.md rule #13 (security & privacy as #2 priority — items 7 &
//   8 each name an industry-standard anchor: GDPR Art. 25 + OWASP Privacy Top
//   10 for item 7, STRIDE for item 8); rule #10 (deterministic enforcement);
//   rule #1 (don't reinvent — pin the standard the bullet cites).
//   Conformance: full — pure function over vision.md text, no I/O in checks.
//
// Why this gate exists: items 1–6 have a sibling P0 task whose ID is the
// load-bearing citation (pinned by check-vision-rule-13-task-id-citations).
// Items 7 and 8 don't. Their load-bearing citation is the named industry
// standard ("GDPR Article 25", "STRIDE"). Without a deterministic pin, a
// future rewrite could drop either name while keeping the surrounding prose
// — leaving the rule as a bullet with no anchor.
//
// Pivot (rule #9): if a future audit decides item 7 or 8 needs a sibling P0
// task, fold that item into `check-vision-rule-13-task-id-citations.mjs` and
// drop it from this gate. The two gates are intentionally split by
// citation-shape (task ID vs industry-standard term), not by item number.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractNumberedItems,
  extractRule13Section,
} from "./check-vision-rule-13-task-id-citations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Item-number → required anchor tokens. Each token is a regex (case-sensitive
 * unless the token explicitly opts otherwise — these are proper-noun
 * standards). All tokens of an item must appear in its body.
 *
 * @type {ReadonlyMap<number, ReadonlyArray<{ token: RegExp, name: string }>>}
 */
export const REQUIRED_ANCHORS = new Map([
  [
    7,
    [
      { token: /\bGDPR\s+Article\s+25\b/, name: "GDPR Article 25" },
      { token: /\bOWASP\s+Privacy\s+Top\s+10\b/, name: "OWASP Privacy Top 10" },
    ],
  ],
  [8, [{ token: /\bSTRIDE\b/, name: "STRIDE" }]],
]);

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure entry point: assert every required anchor token for items 7 and 8
 * appears in that item's body. Items 1–6 are out of scope (they're pinned by
 * `check-vision-rule-13-task-id-citations.mjs`).
 *
 * @param {string} visionMdText
 * @param {ReadonlyMap<number, ReadonlyArray<{ token: RegExp, name: string }>>} [requiredAnchors]
 * @returns {CheckResult}
 */
export function checkVisionRule13NonTaskAnchors(visionMdText, requiredAnchors = REQUIRED_ANCHORS) {
  const section = extractRule13Section(visionMdText);
  if (section === null) {
    return { ok: false, errors: ["vision.md: `### 13. Security & privacy` heading not found"] };
  }
  const items = extractNumberedItems(section);
  /** @type {string[]} */
  const errors = [];
  for (const [itemNum, anchors] of requiredAnchors) {
    const body = items.get(itemNum);
    if (body === undefined) {
      errors.push(`vision.md § 13: minimum-bar item #${itemNum} not found`);
      continue;
    }
    for (const { token, name } of anchors) {
      if (!token.test(body)) {
        errors.push(
          `vision.md § 13 item #${itemNum}: required anchor "${name}" not found in item body`,
        );
      }
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
  const result = checkVisionRule13NonTaskAnchors(text);
  if (result.ok) {
    const total = [...REQUIRED_ANCHORS.values()].reduce((n, arr) => n + arr.length, 0);
    process.stdout.write(
      `vision-rule-13-non-task-anchors ok: all ${total} required anchors present in items 7 & 8.\n`,
    );
    return 0;
  }
  process.stderr.write("vision-rule-13-non-task-anchors violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "Per vision.md § 13 (security & privacy as #2 priority after performance),",
      "minimum-bar items 7 (Privacy by default) and 8 (Threat model per package)",
      'must cite the industry-standard anchors they name in prose ("GDPR Article 25",',
      '"OWASP Privacy Top 10", "STRIDE"). The anchors are the load-bearing reason',
      "the bullet exists; dropping them silently is forbidden by rule #10.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-vision-rule-13-non-task-anchors.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
