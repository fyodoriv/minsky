#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved cto-audit-rule-9-field-quality — reject-rate collector for the rule-9 pre-write validator; pre-registered in experiments/cto-audit-rule-9-field-quality.yaml -->
// cto-audit-rule-9-reject-rate — compute the rule-9 pre-write validator's
// reject rate from `.minsky/audit-log.jsonl`. The validator
// (novel/cross-repo-runner/src/host-cto-audit.ts) appends `audit-skip`
// (proposal dropped after all retries) and `audit-retry-success` (proposal
// accepted after ≥1 retry) entries. This script emits one JSON line on stdout:
//   { rule_9_reject_rate, rule_9_skip_count, rule_9_retry_success_count }
//
// rule_9_reject_rate = skip / (skip + retry-success); 0 when no logged events.
// First-try passes are not logged, so the denominator counts only proposals
// that required intervention — this is the observable the current
// instrumentation supports (see experiments/cto-audit-rule-9-field-quality.yaml).
//
// The metric is observational, not a gate — the threshold verdict belongs to
// the experiment's Success/Pivot fields, evaluated by the weekly tracker.
// Pattern: pure-function-with-I/O-at-edge (rule #2 DI seam for tests).
// Exit code is always 0 — a missing/empty log reads as "no events observed"
// (graceful-degrade, rule #7) so the daily snapshot still renders.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_LOG = resolve(REPO_ROOT, ".minsky", "audit-log.jsonl");

/**
 * Parse one audit-log line, returning its `event` string (or null when the
 * line is blank, malformed, or not an object). Extracted so
 * {@link computeRejectRate} stays under biome's cognitive-complexity cap.
 *
 * @param {string} line
 * @returns {string | null}
 */
function parseEventType(line) {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  try {
    const entry = JSON.parse(trimmed);
    if (entry !== null && typeof entry === "object" && typeof entry.event === "string") {
      return entry.event;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Compute reject-rate stats from raw audit-log `.jsonl` content. Pure.
 *
 * @param {string} content - raw `.minsky/audit-log.jsonl` content (may be empty)
 * @returns {{ rule_9_reject_rate: number, rule_9_skip_count: number, rule_9_retry_success_count: number }}
 */
export function computeRejectRate(content) {
  let skip = 0;
  let retry = 0;
  for (const line of content.split("\n")) {
    const event = parseEventType(line);
    if (event === "audit-skip") skip += 1;
    else if (event === "audit-retry-success") retry += 1;
  }
  const total = skip + retry;
  return {
    rule_9_reject_rate: total === 0 ? 0 : skip / total,
    rule_9_skip_count: skip,
    rule_9_retry_success_count: retry,
  };
}

/**
 * Read the audit log, returning "" when absent — the I/O boundary.
 *
 * @param {string} logPath
 * @returns {string}
 */
export function readLog(logPath) {
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const logPath = process.argv[2] ?? DEFAULT_LOG;
  process.stdout.write(`${JSON.stringify(computeRejectRate(readLog(logPath)))}\n`);
  process.exit(0);
}
