#!/usr/bin/env node
// <!-- scope: human-approved 2026-05-05 user request "implement a meaningful changelog for humans … as a part of the minsky loop. It must show also which metrics improved." — task `daily-changelog-for-humans` Details (e) "Snapshots persisted at .minsky/metric-snapshots/<date>.json" -->
// Pattern: pure file-store helpers above the fs primitive (rule #2 —
//   data, not code; the snapshot file IS the source of truth, this
//   module is the typed reader/writer the operator CLI and daemon
//   compose with). Anchor: Card & Mackinlay 1999 (the metric
//   snapshot is the per-day glanceable observation) + rule #9 (the
//   snapshot is the falsifiable observable that grades the day's
//   pre-registered hypotheses).
// Conformance: full — pure path/date helpers; the I/O surface
//   (`loadSnapshot`, `saveSnapshot`) takes injected `readFile` /
//   `writeFile` / `mkdir` seams so tests drive it without touching
//   disk. The CLI binding (production fs.promises) lives in
//   `changelog-today.mjs`.
// Pivot (rule #9): if the per-date single-JSON-file shape proves too
//   coarse (operators want hourly snapshots, or per-metric files),
//   tighten to a directory-of-files scheme. Don't retire the
//   per-date file contract — `changelog-today.mjs` and the daemon's
//   `claude --print` flow both depend on it.

/**
 * @typedef {Object} SnapshotMetricEntry
 *   JSON-serialisable metric entry. Mirrors the pure builder's
 *   `MetricEntry` minus the `format` function (functions can't survive
 *   JSON; operators format at render time, not in the snapshot).
 * @property {number} value
 * @property {boolean} [higherIsBetter] defaults to true; pass false for
 *   counters where a drop is good (self-diagnose findings, errors,
 *   stuck-PRs, regressions, etc.) — same semantics as `classifyDirection`.
 */

/**
 * @typedef {Readonly<Record<string, SnapshotMetricEntry>>} MetricSnapshot
 *   The on-disk shape. Keys are metric names (free-form, operator-chosen);
 *   values are the typed entries above.
 */

const SNAPSHOT_DIR = ".minsky/metric-snapshots";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a YYYY-MM-DD UTC date string. The whole pipeline is UTC-aligned
 * because CHANGELOG.md headings are UTC.
 *
 * @param {string} date
 * @returns {string}  the same date, returned for caller chaining
 */
function assertDate(date) {
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    throw new Error(`invalid date "${date}" — expected YYYY-MM-DD`);
  }
  // Reject dates that *match* the regex but fail Date.parse (e.g. 2026-13-01).
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`invalid date "${date}" — not a real calendar date`);
  }
  // Round-trip check so e.g. "2026-02-30" (which Date.parse may coerce) is rejected.
  const back = new Date(parsed).toISOString().slice(0, 10);
  if (back !== date) {
    throw new Error(`invalid date "${date}" — not a real calendar date`);
  }
  return date;
}

/**
 * The repo-relative path (POSIX-style) for `date`'s snapshot file.
 * Pure — no I/O, no fs calls — so callers can compute it for logging
 * before deciding to load.
 *
 * @param {{ rootDir: string, date: string }} args
 * @returns {string}
 */
export function snapshotPath({ rootDir, date }) {
  assertDate(date);
  if (typeof rootDir !== "string" || rootDir === "") {
    throw new Error("rootDir must be a non-empty string");
  }
  // Use POSIX joins so the produced path matches what tests can assert
  // verbatim across platforms; the consumer uses node:path at the I/O
  // boundary.
  const trimmed = rootDir.endsWith("/") ? rootDir.slice(0, -1) : rootDir;
  return `${trimmed}/${SNAPSHOT_DIR}/${date}.json`;
}

/**
 * The previous UTC calendar day. Pure — month + year + leap-year
 * boundaries handled by `Date`'s arithmetic on UTC ms.
 *
 * @param {string} date  YYYY-MM-DD
 * @returns {string}     YYYY-MM-DD
 */
export function previousDateUtc(date) {
  assertDate(date);
  const ms = Date.parse(`${date}T00:00:00Z`);
  const prev = new Date(ms - 24 * 60 * 60 * 1000);
  return prev.toISOString().slice(0, 10);
}

/**
 * Validate a single metric entry. Extracted so `validateSnapshot` stays
 * under biome's complexity-10 cap (rule #6).
 *
 * @param {string} name
 * @param {unknown} entry
 * @param {string} sourcePath
 */
function validateMetricEntry(name, entry, sourcePath) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: metric "${name}" must be an object with a value field`);
  }
  const e = /** @type {Record<string, unknown>} */ (entry);
  const value = e["value"];
  // The collector emits human-readable strings for proxy metrics
  // (e.g. "53.3% active days (16/30d)") and finite numbers for clean
  // scalars (e.g. `extraction-count: 1`). Both are accepted; the renderer
  // formats the value as-is. Rejecting either shape was the
  // `metrics-render-finite-number-validation-bug` (rule #17 — observed
  // 2026-05-21 blocking every metrics:render, fixed in same session).
  // NaN / Infinity is still rejected: they're not finite, and they
  // indicate the collector hit a divide-by-zero or unparsed value —
  // visible-not-silent.
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `${sourcePath}: metric "${name}" numeric value must be finite (got ${value})`,
      );
    }
  } else if (typeof value !== "string") {
    throw new Error(
      `${sourcePath}: metric "${name}" value must be a finite number or a string (got ${typeof value})`,
    );
  }
  const hib = e["higherIsBetter"];
  if (hib !== undefined && typeof hib !== "boolean") {
    throw new Error(`${sourcePath}: metric "${name}" higherIsBetter must be a boolean`);
  }
}

/**
 * Validate a parsed JSON object as a `MetricSnapshot`. Throws with a
 * helpful message on shape mismatch — the caller wants a hard failure
 * over silently rendering wrong metrics.
 *
 * @param {unknown} parsed
 * @param {string} sourcePath  for the error message
 * @returns {MetricSnapshot}
 */
export function validateSnapshot(parsed, sourcePath) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourcePath}: expected a JSON object mapping metric-name → entry`);
  }
  for (const [name, entry] of Object.entries(parsed)) {
    validateMetricEntry(name, entry, sourcePath);
  }
  return /** @type {MetricSnapshot} */ (parsed);
}

/**
 * @typedef {(path: string) => Promise<string>} ReadFileSeam
 *   Async file read returning UTF-8 contents. Tests inject a stub map;
 *   the production binding wraps `fs.promises.readFile`. ENOENT must
 *   surface as `Error & { code: "ENOENT" }` so `loadSnapshot` can
 *   graceful-degrade per rule #7.
 */

/**
 * Load `date`'s snapshot from disk. Returns `undefined` on ENOENT
 * (rule #7 graceful-degrade — a fresh repo / pre-instrumentation day
 * legitimately has no snapshot, and the changelog should still render
 * without metrics rather than crash). All other read errors propagate
 * — let-it-crash at the right boundary (Armstrong 2007).
 *
 * @param {{ rootDir: string, date: string, readFile: ReadFileSeam }} args
 * @returns {Promise<MetricSnapshot | undefined>}
 */
export async function loadSnapshot({ rootDir, date, readFile }) {
  const path = snapshotPath({ rootDir, date });
  let raw;
  try {
    raw = await readFile(path);
    // rule-6: handled-locally — ENOENT on the snapshot file is the
    // documented graceful-degrade contract; any other error
    // propagates to the supervisor (Armstrong 2007).
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${path}: malformed JSON (${reason})`);
  }
  return validateSnapshot(parsed, path);
}

/**
 * @typedef {(path: string, contents: string) => Promise<void>} WriteFileSeam
 * @typedef {(dir: string, opts: { recursive: boolean }) => Promise<unknown>} MkdirSeam
 */

/**
 * Persist `date`'s snapshot to disk. Creates the parent directory
 * recursively (idempotent — `mkdir -p` semantics) so a fresh repo
 * gets `.minsky/metric-snapshots/` on first write. Overwrites an
 * existing file deliberately — re-recording today's metrics is the
 * documented operator workflow (numbers can change as the day
 * progresses; the changelog reads the final value).
 *
 * @param {{
 *   rootDir: string,
 *   date: string,
 *   snapshot: MetricSnapshot,
 *   writeFile: WriteFileSeam,
 *   mkdir: MkdirSeam,
 * }} args
 * @returns {Promise<string>}  the path written
 */
export async function saveSnapshot({ rootDir, date, snapshot, writeFile, mkdir }) {
  validateSnapshot(snapshot, "<input>");
  const path = snapshotPath({ rootDir, date });
  const trimmed = rootDir.endsWith("/") ? rootDir.slice(0, -1) : rootDir;
  await mkdir(`${trimmed}/${SNAPSHOT_DIR}`, { recursive: true });
  // Stable two-space JSON for diffability (rule #2 — data, not code; the
  // file is human-edited as well as machine-written).
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return path;
}

/**
 * Discriminate ENOENT from other read errors. Node's fs throws an
 * `Error & { code: "ENOENT" }` for missing-file; any other shape
 * (EACCES, EISDIR, …) propagates.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isEnoent(err) {
  if (!(err instanceof Error)) return false;
  const code = /** @type {NodeJS.ErrnoException} */ (err).code;
  return typeof code === "string" && code === "ENOENT";
}
