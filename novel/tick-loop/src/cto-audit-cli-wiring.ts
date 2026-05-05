/**
 * `@minsky/tick-loop/cto-audit-cli-wiring` — CLI-side construction of the
 * `CtoAuditSeam` the `runDaemon` orchestrator dispatches into. Sub-step (d/e/f)
 * of `post-task-cto-audit`: production wiring for the audit seam whose pure
 * brief builder + I/O wrapper landed in PR #170 / #175 / #176.
 *
 * Three primitives:
 *   - `createFileBackedCtoAuditLock(rootDir)` — `<rootDir>/<taskId>` file
 *     presence is the lock. Crash-safe across daemon restarts (sub-step f
 *     "cap audits at 1 per task"), unlike PR #175's in-memory `Set` lock.
 *   - `createGitGhSignalsBuilder({execFile})` — assembles
 *     `CompletedIterationSignals` from `git log` + `gh issue/pr list` calls.
 *     `lintScores` is `{}` until the rolling-30d snapshot infrastructure
 *     ships (deferred; rule-3 doc-first applies to the snapshot, not here).
 *   - `extractPrUrl(stdoutTail)` — pure regex extraction of the first
 *     `https://github.com/<owner>/<repo>/pull/<n>` URL the spawned
 *     `claude --print` printed; null if none.
 *
 * Pattern (rule #2): the bin script (`bin/tick-loop.mjs`) is the I/O
 * boundary; this module is the smallest unit-testable surface above it.
 * Pure helpers (`extractPrUrl`, the parsers) are tested against frozen
 * fixtures; the I/O wrapper takes an injected `execFile` so tests can
 * drive it deterministically without a subprocess.
 *
 * @module tick-loop/cto-audit-cli-wiring
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CompletedIterationSignals, CtoAuditLock } from "./post-task-cto-audit.js";

// ---- File-backed lock -----------------------------------------------------

/**
 * Build a `CtoAuditLock` whose presence record is a sentinel file at
 * `<rootDir>/<taskId>`. Idempotent across processes (the daemon can restart
 * mid-audit and won't fire a duplicate on the next iteration, sub-step (f)).
 *
 * The directory is created lazily on first `acquireLock` so a fresh
 * checkout + first-ever audit doesn't fail on ENOENT.
 *
 * @otel-exempt pure factory; the lock methods themselves are file-system
 *   primitives whose call site (`runCtoAudit`) carries the audit span.
 */
export function createFileBackedCtoAuditLock(rootDir: string): CtoAuditLock {
  return {
    lockExists(taskId: string): boolean {
      return existsSync(resolve(rootDir, sanitizeTaskId(taskId)));
    },
    acquireLock(taskId: string): void {
      mkdirSync(rootDir, { recursive: true });
      writeFileSync(resolve(rootDir, sanitizeTaskId(taskId)), `${new Date().toISOString()}\n`, {
        flag: "w",
      });
    },
  };
}

/**
 * TASKS.md ID grammar is `[a-z][a-z0-9-]*[a-z0-9]` (per `parseFixtureTaskIds`),
 * but defense-in-depth: replace any non-conforming character with `_` so a
 * malformed task-id can't escape the lock directory via path traversal.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-z0-9_-]/gi, "_");
}

// ---- Pure helpers ---------------------------------------------------------

const PR_URL_RE = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;

/**
 * Extract the first GitHub PR URL from the spawn's `stdoutTail`. The
 * daemon's `maybeRunCtoAudit` threads `result.reason` here, which on a
 * `completed` iteration is the spawn's stdout tail (last 4KB).
 * Returns `null` when no URL is present (e.g. `noop, exiting` runs).
 *
 * @otel-exempt pure parser.
 */
export function extractPrUrl(stdoutTail: string): string | null {
  const match = PR_URL_RE.exec(stdoutTail);
  return match === null ? null : match[0];
}

/**
 * Parse `git log --name-only -1 --pretty=format:` output into a list of
 * relative file paths from the most recent commit. Empty array when the
 * working tree was unchanged (no commit landed).
 *
 * @otel-exempt pure parser.
 */
export function parseFilesChangedFromGit(rawOutput: string): readonly string[] {
  return rawOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Parse `git log origin/main --oneline -10 --format=%s` output (subjects
 * one per line) into a list of commit-message first-lines, oldest-first.
 *
 * Git's `--format=%s` lists newest-first; we reverse here so the brief
 * matches `CompletedIterationSignals.recentMainCommits`'s "oldest-first"
 * contract (per `post-task-cto-audit.ts:38`).
 *
 * @otel-exempt pure parser.
 */
export function parseRecentMainCommitsFromGit(rawOutput: string): readonly string[] {
  return rawOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reverse();
}

// ---- Signals collector ----------------------------------------------------

/**
 * Minimum subprocess surface the signals collector depends on. Production
 * wires `node:child_process.execFile` with `{encoding: "utf-8"}`; tests
 * pass a deterministic stub that returns frozen fixtures.
 *
 * Returns the trimmed stdout. Errors (non-zero exit, ENOENT) are surfaced
 * via thrown `Error`; the collector catches and returns the graceful-degrade
 * shape (empty arrays / 0 counts) so a `gh` outage doesn't block audits.
 */
export type ExecFileLike = (file: string, args: readonly string[]) => Promise<string>;

export interface SignalsBuilderArgs {
  readonly taskId: string;
  readonly spawnStdoutTail: string;
}

/**
 * Build the `buildSignals` async function the daemon's `CtoAuditSeam`
 * expects. The injected `execFile` is the only side-effect surface; it
 * runs the four collection commands in series (parallelism here is not
 * worth the complexity — total wall-time <1s on a normal repo).
 *
 * Graceful-degrade per rule #7: a failing `gh` call (offline / rate-limit)
 * yields `openWorkItems: 0` rather than crashing the daemon iteration.
 * The audit's brief reports the degraded values; the operator-side review
 * surface (the audit's PR) is the success boundary.
 *
 * @otel tick-loop.cto-audit-signals.build (the daemon emits the audit's
 *   `tick-loop.cto-audit` span; this builder is invoked under it).
 */
export function createGitGhSignalsBuilder(opts: {
  readonly execFile: ExecFileLike;
}): (args: SignalsBuilderArgs) => Promise<CompletedIterationSignals> {
  return async (args) => {
    const filesChanged = await safeRun(
      () => opts.execFile("git", ["log", "-1", "--name-only", "--pretty=format:"]),
      parseFilesChangedFromGit,
      [] as readonly string[],
    );
    const recentMainCommits = await safeRun(
      () => opts.execFile("git", ["log", "origin/main", "-10", "--format=%s"]),
      parseRecentMainCommitsFromGit,
      [] as readonly string[],
    );
    const openIssues = await safeCount(opts.execFile, "issue");
    const openPrs = await safeCount(opts.execFile, "pr");

    return {
      completedTaskId: args.taskId,
      prUrl: extractPrUrl(args.spawnStdoutTail),
      filesChanged,
      recentMainCommits,
      openWorkItems: openIssues + openPrs,
      lintScores: {},
    };
  };
}

/**
 * Run an async producer + parser; on any thrown error return the fallback.
 * The production daemon must not crash on `git`/`gh` failure — graceful-
 * degrade is the documented contract (rule #7).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function safeRun<T>(
  produce: () => Promise<string>,
  parse: (raw: string) => T,
  fallback: T,
): Promise<T> {
  try {
    const raw = await produce();
    return parse(raw);
    // rule-6: handled-locally — `git`/`gh` failures (offline, rate-limit,
    // missing remote) are documented graceful-degrade boundaries; rethrowing
    // would crash the daemon iteration.
  } catch {
    return fallback;
  }
}

/**
 * `gh <kind> list --state=open --limit=200 --json=number` returns a JSON
 * array; we count its length. 200 is the GitHub API page cap; repos with
 * >200 open items are rare enough that the saturation is not worth a
 * pagination loop here (the count is an order-of-magnitude signal for the
 * brief, not an exact figure).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function safeCount(execFile: ExecFileLike, kind: "issue" | "pr"): Promise<number> {
  return safeRun(
    () => execFile("gh", [kind, "list", "--state=open", "--limit=200", "--json=number"]),
    (raw) => {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    },
    0,
  );
}
