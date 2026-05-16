#!/usr/bin/env node
/**
 * Concern → task drainer for any agent process (worker, audit, watchdog,
 * monitor) running against this host repo. Any agent that detects a concern
 * during its work drops a Rule #9-formatted task block at
 * `.minsky/concerns/pending/<unique>.md`; this script appends each block to
 * `TASKS.md` under the right priority section (P0/P1/P2/P3 parsed from the
 * block's `**Tags**` field), dedups by `**ID**`, and moves the source file
 * to `processed/<UTC-date>/`. Re-runnable: safe to invoke from multiple
 * watchdog poll cycles; concurrent runs are gated by a single
 * `.minsky/concerns/.drain.lock` directory created via `mkdir -p` (atomic
 * across processes on POSIX filesystems — see Stevens, *APUE*, 2nd ed.,
 * Ch. 14 §"File Locking").
 *
 * File contract for agents dropping concerns:
 *   - Path: `<host>/.minsky/concerns/pending/<unique-name>.md`
 *   - Content: a single `- [ ] …` task block with the 5 Rule #9 fields
 *     (Hypothesis / Success / Pivot / Measurement / Anchor) on single
 *     lines, plus `**ID**:` + `**Tags**:` (Tags MUST include exactly one
 *     of `p0` / `p1` / `p2` / `p3` for routing).
 *   - Optional: `**Detected-by**:`, `**Detected-at**:`, `**Severity**:`
 *     for provenance — preserved verbatim in TASKS.md.
 *
 * Idempotence: re-running with the same pending files is a no-op after
 * the first drain (the block is already in TASKS.md, so subsequent IDs
 * match and the file is moved as a "duplicate" without re-appending).
 *
 * Anchor: Hohpe & Woolf, *Enterprise Integration Patterns*, 2003 —
 * "Message Channel" + "Dead Letter Channel" (Ch. 4): pending/ is the
 * channel, processed/<date>/ is the durable archive, invalid/ is the
 * dead-letter sink for malformed concerns.
 *
 * @otel oncall-hub-api.scripts.drain-concerns
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = resolve(SCRIPT_DIR, "..");
const TASKS_MD = join(HOST_ROOT, "TASKS.md");
const CONCERNS_DIR = join(HOST_ROOT, ".minsky", "concerns");
const PENDING_DIR = join(CONCERNS_DIR, "pending");
const PROCESSED_DIR = join(CONCERNS_DIR, "processed");
const INVALID_DIR = join(CONCERNS_DIR, "invalid");
const LOCK_DIR = join(CONCERNS_DIR, ".drain.lock");

const PRIORITY_TAG = /\b(p[0-3])\b/i;

/**
 * Acquire the drain lock via `mkdir` (atomic on POSIX). Returns true on
 * success; returns false (and skips the drain) when another process holds
 * the lock. Stale locks are not automatically reaped — operator must
 * `rmdir .minsky/concerns/.drain.lock` if a previous run crashed.
 */
function acquireLock() {
  try {
    mkdirSync(LOCK_DIR);
    return true;
  } catch (err) {
    if (err instanceof Error && /** @type {NodeJS.ErrnoException} */ (err).code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

function releaseLock() {
  try {
    rmdirSync(LOCK_DIR);
  } catch {
    // best-effort — a crashed earlier process leaves the lock; operator clears manually
  }
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

/** @param {string} dir */
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Parse the priority tag (p0..p3) from a task block's `**Tags**:` line.
 * Returns the matching `## PX` section header (e.g., "## P2") or null if
 * no recognized priority tag is found (in which case the block is moved
 * to `invalid/` and skipped).
 */
/** @param {string} blockText @returns {string|null} */
function parsePriority(blockText) {
  const tagsLine = blockText.split("\n").find((line) => line.match(/^\s*-\s+\*\*Tags\*\*:/));
  if (tagsLine === undefined) return null;
  const match = tagsLine.match(PRIORITY_TAG);
  if (match === null || match[1] === undefined) return null;
  return `## ${match[1].toUpperCase()}`;
}

/**
 * Parse the `**ID**` value from a task block. Returns the trimmed id
 * string or null when missing.
 */
/** @param {string} blockText @returns {string|null} */
function parseId(blockText) {
  const idLine = blockText.split("\n").find((line) => line.match(/^\s*-\s+\*\*ID\*\*:/));
  if (idLine === undefined) return null;
  const match = idLine.match(/\*\*ID\*\*:\s*(\S+)/);
  if (match === null || match[1] === undefined) return null;
  return match[1].trim();
}

/**
 * Check whether the given id is already present in TASKS.md as an
 * `**ID**: <id>` line. Used to skip duplicate concerns idempotently.
 */
/** @param {string} tasksContent @param {string} id @returns {boolean} */
function idAlreadyInTasks(tasksContent, id) {
  const re = new RegExp(
    `^\\s*-\\s+\\*\\*ID\\*\\*:\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "m",
  );
  return re.test(tasksContent);
}

/**
 * Insert the concern block at the END of the matching `## PX` section
 * (before the next `## ` heading, or before EOF if it's the last section).
 * Atomicity: write to a temp file then rename.
 */
/** @param {string} blockText @param {string} sectionHeader */
function insertIntoTasksMd(blockText, sectionHeader) {
  const tasks = readFileSync(TASKS_MD, "utf-8");
  const headerIdx = tasks.indexOf(`\n${sectionHeader}\n`);
  if (headerIdx === -1) {
    throw new Error(`section header not found in TASKS.md: ${sectionHeader}`);
  }
  // Find the next `## ` header AFTER the priority section header (or EOF).
  const afterHeader = headerIdx + `\n${sectionHeader}\n`.length;
  const nextSectionIdx = tasks.indexOf("\n## ", afterHeader);
  const insertAt = nextSectionIdx === -1 ? tasks.length : nextSectionIdx;
  // Trim trailing whitespace on the prefix, then add a blank line, then the
  // block, then a blank line before the next section. Ensures the inserted
  // block has clean separators from neighbours.
  const prefix = tasks.slice(0, insertAt).replace(/\s+$/, "");
  const suffix = tasks.slice(insertAt);
  const block = blockText.trim();
  const updated = `${prefix}\n\n${block}\n${suffix}`;
  // Atomic write: temp + rename
  const tmp = `${TASKS_MD}.drain-tmp`;
  writeFileSync(tmp, updated);
  renameSync(tmp, TASKS_MD);
}

/** @param {string} fileName @param {string} sourcePath @param {string} status */
function moveToProcessed(fileName, sourcePath, status) {
  const dateDir = join(status === "duplicate" ? PROCESSED_DIR : PROCESSED_DIR, utcDate());
  ensureDir(dateDir);
  const destPath = join(dateDir, fileName);
  renameSync(sourcePath, destPath);
}

/**
 * @param {string} fileName
 * @param {string} sourcePath
 * @param {string} reason
 */
function moveToInvalid(fileName, sourcePath, reason) {
  ensureDir(INVALID_DIR);
  const destPath = join(INVALID_DIR, `${utcDate()}-${fileName}`);
  // Annotate with the rejection reason as a leading comment so the operator
  // (or a future fix-it agent) can see why the concern was rejected.
  const original = readFileSync(sourcePath, "utf-8");
  const annotated = `<!-- drainer rejected ${utcDate()}: ${reason} -->\n${original}`;
  writeFileSync(destPath, annotated);
  // best-effort delete the pending file
  try {
    renameSync(sourcePath, `${destPath}.original`);
  } catch {
    // ignore
  }
}

/**
 * Process one pending file: parse, dedup-check, insert OR move-to-invalid.
 * Returns the outcome string so the caller can tally counts. Extracted from
 * `main` to keep its cognitive complexity under biome's cap (rule #6, ≤10).
 *
 * @param {string} fileName
 * @returns {"appended"|"duplicate"|"invalid"}
 */
function processConcernFile(fileName) {
  const sourcePath = join(PENDING_DIR, fileName);
  const blockText = readFileSync(sourcePath, "utf-8");
  const id = parseId(blockText);
  if (id === null) {
    moveToInvalid(fileName, sourcePath, "missing **ID** line");
    return "invalid";
  }
  const section = parsePriority(blockText);
  if (section === null) {
    moveToInvalid(
      fileName,
      sourcePath,
      "missing or unparseable priority in **Tags** (need p0/p1/p2/p3)",
    );
    return "invalid";
  }
  const tasksContent = readFileSync(TASKS_MD, "utf-8");
  if (idAlreadyInTasks(tasksContent, id)) {
    process.stdout.write(`  · ${fileName}: id ${id} already in TASKS.md (dedup → processed)\n`);
    moveToProcessed(fileName, sourcePath, "duplicate");
    return "duplicate";
  }
  insertIntoTasksMd(blockText, section);
  process.stdout.write(`  ✓ ${fileName}: appended ${id} under ${section}\n`);
  moveToProcessed(fileName, sourcePath, "appended");
  return "appended";
}

function main() {
  if (!existsSync(PENDING_DIR)) {
    // Nothing to drain — clean exit so the watchdog can call us every poll
    // without log spam.
    return 0;
  }
  if (!acquireLock()) {
    process.stderr.write("drain-concerns: another drainer is running; skipping\n");
    return 0;
  }
  try {
    const files = readdirSync(PENDING_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return 0;
    process.stdout.write(`drain-concerns: ${files.length} pending concern(s)\n`);
    const tally = { appended: 0, duplicate: 0, invalid: 0 };
    for (const fileName of files) {
      tally[processConcernFile(fileName)]++;
    }
    const { appended, duplicate: duplicates, invalid } = tally;
    process.stdout.write(
      `drain-concerns: done (appended=${appended}, duplicates=${duplicates}, invalid=${invalid})\n`,
    );
    return 0;
  } finally {
    releaseLock();
  }
}

process.exit(main());
