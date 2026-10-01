// @ts-check
// ErrorReporter adapter (rule #2 seam) for run-level error capture + external
// reporting (task `obs-error-capture-and-reporter`).
//
// Two strategies behind one interface (`{ kind, report, selfTest }`):
//   - FileErrorReporter   — default, offline; appends a full, untruncated,
//                           classified record to `.minsky/runs/<id>/errors.jsonl`.
//   - SentryErrorReporter — ships each error to Sentry via a LAZY dynamic
//                           import of `@sentry/node` (active only when SENTRY_DSN
//                           is set AND the dep is installed); otherwise it
//                           transparently falls back to the file strategy.
//
// Placed in `scripts/lib/` rather than a `novel/adapters/` workspace package on
// purpose: zero new monorepo dependencies, no build-graph churn, nothing to
// `pnpm install` before an 8h run — the most stable shape (operator "most stable
// way possible" mandate, 2026-06-03). The interface IS the deliverable (rule #2);
// the directory is not.
//
// rule #6 / rule #7: `report()` NEVER throws — a reporter failure is captured as
// `{ ok: false, reason }` and swallowed by callers, so a broken sink can never
// crash the daemon.
//
// Anchor: Majors, Fong-Jones, Miranda, "Observability Engineering", O'Reilly
// 2022 — high-cardinality error events; rule #2 (adapter seam).

import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * @typedef {{ ts: string, runId: string | null, taskId: string | null, class: string, message: string, stack?: string, exitCode?: number, durationMs?: number }} ErrorRecord
 */
/**
 * @typedef {{ ok: boolean, reason?: string }} ReportResult
 */
/**
 * @typedef {{ kind: string, report: (rec: ErrorRecord) => Promise<ReportResult>, selfTest: () => Promise<{ status: string, message: string }> }} ErrorReporter
 */

/**
 * Strip secret-ish tokens so no credential reaches a log or an external sink.
 * @param {unknown} value @returns {string}
 */
export function redact(value) {
  return String(value ?? "")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-gh-token]")
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "[redacted-key]")
    .replace(/\bhttps:\/\/[^@\s]+@[^\s]*sentry[^\s]*/gi, "[redacted-dsn]")
    .replace(/\b([A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|DSN))=\S+/g, "$1=[redacted]");
}

/**
 * Classify an error from its text. Deterministic substring match; "unknown" is
 * the honest default (never guess a category).
 * @param {string} text
 * @returns {string}
 */
export function classifyError(text) {
  const t = String(text ?? "").toLowerCase();
  if (/\bspawn\b|enoent|launch failed|failed to spawn/.test(t)) return "spawn-failed";
  if (/\blint\b|biome|eslint|pre-pr-lint|format would/.test(t)) return "lint-failed";
  if (/timeout|timed out|etimedout/.test(t)) return "timeout";
  if (/gate|merge.*block|check failed|not mergeable/.test(t)) return "gate-failed";
  if (/crash|segfault|fatal|uncaught|unhandled rejection/.test(t)) return "crash";
  return "unknown";
}

/**
 * Build a normalized, redacted ErrorRecord.
 * @param {{ ts: string, runId?: string | null, taskId?: string | null, message: string, stack?: string, exitCode?: number, durationMs?: number }} input
 * @returns {ErrorRecord}
 */
export function toErrorRecord(input) {
  const message = redact(input.message);
  const stack = input.stack ? redact(input.stack) : undefined;
  /** @type {ErrorRecord} */
  const rec = {
    ts: input.ts,
    runId: input.runId ?? null,
    taskId: input.taskId ?? null,
    class: classifyError(`${message} ${stack ?? ""}`),
    message,
  };
  if (stack) rec.stack = stack;
  if (Number.isInteger(input.exitCode)) rec.exitCode = /** @type {number} */ (input.exitCode);
  if (Number.isInteger(input.durationMs)) rec.durationMs = /** @type {number} */ (input.durationMs);
  return rec;
}

/**
 * Default offline strategy: append one JSON line per error to `errorsFile`.
 * @param {string} errorsFile
 * @returns {ErrorReporter}
 */
export function FileErrorReporter(errorsFile) {
  return {
    kind: "file",
    async report(rec) {
      try {
        mkdirSync(dirname(errorsFile), { recursive: true });
        appendFileSync(errorsFile, `${JSON.stringify(rec)}\n`);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e) };
      }
    },
    async selfTest() {
      return { status: "green", message: `file reporter → ${errorsFile}` };
    },
  };
}

/**
 * External strategy: ship to Sentry via a lazy `@sentry/node` import. Active
 * only when `dsn` is set AND the dep resolves; otherwise delegates to
 * `fallback` (the file strategy). The variable specifier keeps tsc from
 * requiring `@sentry/node` at type-check time (optional dependency).
 * @param {string} dsn
 * @param {ErrorReporter} fallback
 * @returns {ErrorReporter}
 */
export function SentryErrorReporter(dsn, fallback) {
  /** @type {{ captureException: (e: Error, hint?: unknown) => void } | null} */
  let sentry = null;
  let loaded = false;
  async function ensure() {
    if (loaded) return sentry;
    loaded = true;
    try {
      const spec = "@sentry/node";
      const mod = /** @type {any} */ (await import(spec));
      mod.init({ dsn });
      sentry = mod;
    } catch {
      sentry = null; // dep not installed → caller falls back
    }
    return sentry;
  }
  return {
    kind: "sentry",
    async report(rec) {
      const s = await ensure();
      if (!s) return fallback.report(rec);
      try {
        s.captureException(new Error(rec.message), { extra: rec });
        await fallback.report(rec); // always keep the local ledger too
        return { ok: true };
      } catch (e) {
        const fb = await fallback.report(rec);
        return fb.ok ? { ok: true, reason: `sentry failed, file ok: ${String(e)}` } : fb;
      }
    },
    async selfTest() {
      const s = await ensure();
      return s
        ? { status: "green", message: "sentry active (@sentry/node loaded)" }
        : {
            status: "yellow",
            message: "SENTRY_DSN set but @sentry/node not installed — using file fallback",
          };
    },
  };
}

/**
 * Factory: pick the strategy from config/env. Sentry when a DSN is present
 * (the operator default, 2026-06-03), else the offline file strategy.
 * @param {{ dsn?: string | undefined, errorsFile: string }} opts
 * @returns {ErrorReporter}
 */
export function createErrorReporter({ dsn = process.env["SENTRY_DSN"], errorsFile }) {
  const file = FileErrorReporter(errorsFile);
  return dsn ? SentryErrorReporter(dsn, file) : file;
}

/**
 * Self-test the default (file) strategy end-to-end in a temp dir: report a
 * probe error, read it back, confirm it round-trips. Returns true on success.
 * @returns {Promise<boolean>}
 */
export async function selfTestFileReporter() {
  const dir = join(tmpdir(), `minsky-error-reporter-selftest-${process.pid}`);
  const file = join(dir, "errors.jsonl");
  try {
    const reporter = FileErrorReporter(file);
    const rec = toErrorRecord({
      ts: "1970-01-01T00:00:00.000Z",
      runId: "selftest",
      message: "spawn ENOENT probe",
    });
    const r = await reporter.report(rec);
    if (!r.ok) return false;
    const back = JSON.parse(readFileSync(file, "utf8").trim());
    return back.class === "spawn-failed" && back.runId === "selftest";
  } catch {
    return false;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}
