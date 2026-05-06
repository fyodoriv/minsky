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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CTO_AUDIT_PR_LABEL,
  type CompletedIterationSignals,
  type CtoAuditLock,
} from "./post-task-cto-audit.js";

/** Env-var name the launchd plist + systemd unit set to opt-in the CTO audit
 *  seam in `bin/tick-loop.mjs`. Exported + referenced both in the source-plist
 *  parser and the live-env comparator below so brief drift on the var name
 *  surfaces in tests rather than silently zeroing the drift detector. */
export const CTO_AUDIT_ENABLE_ENV_VAR = "MINSKY_CTO_AUDIT_ENABLE";

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
  return produce()
    .then(parse)
    .catch(() => fallback);
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

// ---- Label preflight ------------------------------------------------------

/** Outcome categories an `ensureCtoAuditLabel` invocation can resolve to. */
export type EnsureLabelOutcome =
  /** Label was missing and `gh label create` succeeded. */
  | "created"
  /** Label already existed; `gh label create` was not invoked. */
  | "exists"
  /** `gh label list`/`create` threw (offline, gh missing, auth missing). */
  | "skipped-degraded";

/**
 * Idempotently ensure the `minsky:cto-audit` label exists on the current
 * repo so the audit's first PR-create doesn't fail with "label not found"
 * and the pre-registered measurement query (`gh pr list --label
 * minsky:cto-audit ...`) can see audit PRs from the moment they open.
 *
 * The CTO_PROMPT_HEADER tells the spawned agent to create the label
 * idempotently, but that path is LLM-runtime-dependent; this preflight is
 * the deterministic substrate equivalent — the supervisor handles it once
 * at startup so the agent never has to.
 *
 * Graceful-degrade per rule #7: when `gh` is missing, offline, or
 * unauthenticated, return `"skipped-degraded"` rather than crashing. The
 * audit's own brief still instructs the agent to create the label as a
 * fallback path; the lint (`scripts/check-cto-audit-pr-conventions.mjs`)
 * blocks any audit PR that lands without the label, so a degraded
 * preflight is not a silent failure.
 *
 * @otel-exempt thin async helper invoked at supervisor startup; the
 *   `bin/tick-loop.mjs` boundary carries the start-up span.
 */
export async function ensureCtoAuditLabel(opts: {
  readonly execFile: ExecFileLike;
}): Promise<EnsureLabelOutcome> {
  const { execFile } = opts;
  const exists = await labelExists(execFile);
  if (exists === "unknown") return "skipped-degraded";
  if (exists === "yes") return "exists";
  return createLabel(execFile);
}

/**
 * Probe `gh label list --search ${label} --json name --jq '.[].name'`. The
 * `--search` is a best-effort filter; we still match the exact label name
 * out of the result to avoid false positives from substring matches (e.g.
 * `minsky:cto-audit-future`).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function labelExists(execFile: ExecFileLike): Promise<"yes" | "no" | "unknown"> {
  return execFile("gh", [
    "label",
    "list",
    "--search",
    CTO_AUDIT_PR_LABEL,
    "--json",
    "name",
    "--jq",
    ".[].name",
  ])
    .then((raw) => {
      const names = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return names.includes(CTO_AUDIT_PR_LABEL) ? ("yes" as const) : ("no" as const);
    })
    .catch(() => "unknown" as const);
}

/**
 * Run `gh label create` with the brief's documented `--description` +
 * `--color`. Race condition: if a parallel supervisor invocation creates
 * the label between our `labelExists` check and this call, `gh` returns a
 * "already exists" error; we treat that as success (`"exists"`) rather
 * than `"skipped-degraded"`.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function createLabel(execFile: ExecFileLike): Promise<EnsureLabelOutcome> {
  return execFile("gh", [
    "label",
    "create",
    CTO_AUDIT_PR_LABEL,
    "--description",
    "Filed by post-task CTO audit",
    "--color",
    "0e8a16",
  ])
    .then(() => "created" as const)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(msg)) return "exists" as const;
      return "skipped-degraded" as const;
    });
}

// ---- Source-plist env-drift detector --------------------------------------

/** Outcomes the source-plist ↔ live-env comparator can resolve to. The
 *  load-bearing case is `"drift-stale-install"`: source plist enables the
 *  CTO audit but the supervisor's live env doesn't have the var set, which
 *  is the install-drift signature when `~/Library/LaunchAgents/<plist>` is
 *  older than the source plist in the repo. The other three are noise to
 *  filter in the call-site. */
export type EnvDriftOutcome =
  /** Source plist enables the var AND live env has it set to 1/true. */
  | "in-sync-enabled"
  /** Source plist does not enable the var AND live env doesn't either. */
  | "in-sync-disabled"
  /** Source plist enables the var but live env is unset/non-truthy — the
   *  install-drift case PR #214's wire-status announcement guards against
   *  on supervisor restart, surfaced here at boot without needing a restart. */
  | "drift-stale-install"
  /** Live env enables the var but source plist doesn't — operator local
   *  override (the var was set manually via `launchctl setenv` or in the
   *  installed plist after edit). Not an error; just a drift signal. */
  | "drift-local-override"
  /** Plist file unreadable / unparseable — graceful-degrade per rule #7
   *  (fresh checkout, non-mac install, file moved). */
  | "plist-unreadable";

/**
 * Extract the `EnvironmentVariables` dict from a launchd plist XML body.
 * Returns a `Record<string, string>` of the env vars set in the plist; an
 * empty object when the dict is absent or the plist has no env vars.
 *
 * The plist grammar is stable (Apple's PropertyList-1.0.dtd) so a
 * regex-based parser is robust enough for this single dict — pulling in an
 * XML library here would be a rule-12 scope violation. Tests pin the parser
 * against the actual repo plist plus several edge-case fixtures.
 *
 * @otel-exempt pure parser.
 */
export function parsePlistEnv(xml: string): Readonly<Record<string, string>> {
  const dictMatch = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml);
  if (dictMatch === null) return {};
  const body = dictMatch[1] ?? "";
  const out: Record<string, string> = {};
  const pairRe = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g;
  let m: RegExpExecArray | null = pairRe.exec(body);
  while (m !== null) {
    const k = m[1];
    const v = m[2];
    if (k !== undefined && v !== undefined) out[k] = v;
    m = pairRe.exec(body);
  }
  return out;
}

/**
 * Treat the live env's CTO-audit-enable var as truthy iff it's `"1"` or
 * `"true"` (case-insensitive, trimmed) — the same predicate `bin/tick-loop.mjs`
 * uses to decide whether to wire the `CtoAuditSeam`. Anything else (unset,
 * empty, `"0"`, `"false"`, garbage) is non-truthy.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function isAuditEnvEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalised = value.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
}

export interface DetectCtoAuditEnvDriftOpts {
  /** Path to the source launchd plist (production:
   *  `${MINSKY_HOME}/distribution/launchd/com.minsky.tick-loop.plist`). */
  readonly sourcePlistPath: string;
  /** Live process env. Production passes `process.env`; tests inject a
   *  frozen record so the comparator is deterministic. */
  readonly liveEnv: Readonly<Record<string, string | undefined>>;
}

/**
 * Compare the source launchd plist's `EnvironmentVariables` dict against
 * the supervisor's live process env to surface install drift between the
 * checked-in plist (the source of truth) and `~/Library/LaunchAgents/<plist>`
 * (the installed copy) without waiting for a supervisor restart.
 *
 * Failure mode this guards against: PRs #205 / #213 / #214 land changes to
 * the source plist (`MINSKY_CTO_AUDIT_ENABLE=1`, etc.) that only take
 * effect after `pnpm dogfood:install` re-copies the plist + `launchctl
 * bootstrap` reloads it. If the operator skips the reinstall, the live
 * supervisor runs with stale env. PR #214's wire-status announcement
 * surfaces this on the *next* restart, but until restart the supervisor
 * silently zeroes the pre-registered measurement query
 * (`gh pr list --label minsky:cto-audit ...` returns 0 forever). This
 * detector closes that gap: at supervisor startup, before `runDaemon`
 * enters its loop, the bin script calls this helper and emits a loud
 * warning when the stale-install case is detected.
 *
 * Graceful-degrade per rule #7: a missing / unreadable plist returns
 * `"plist-unreadable"` rather than crashing. Production wires
 * `bin/tick-loop.mjs`'s startup banner to log a one-line hint per
 * outcome; the supervisor never blocks on a drift finding.
 *
 * @otel-exempt thin sync helper invoked once at supervisor startup; the
 *   `bin/tick-loop.mjs` boundary carries the start-up span.
 */
export function detectCtoAuditEnvDrift(opts: DetectCtoAuditEnvDriftOpts): EnvDriftOutcome {
  let xml: string;
  try {
    xml = readFileSync(opts.sourcePlistPath, "utf-8");
    // rule-6: handled-locally — graceful-degrade per rule #7; missing/unreadable plist resolves to a typed outcome the caller logs, never crashes the supervisor
  } catch {
    return "plist-unreadable";
  }
  const env = parsePlistEnv(xml);
  const sourceEnabled = isAuditEnvEnabled(env[CTO_AUDIT_ENABLE_ENV_VAR]);
  const liveEnabled = isAuditEnvEnabled(opts.liveEnv[CTO_AUDIT_ENABLE_ENV_VAR]);
  if (sourceEnabled && liveEnabled) return "in-sync-enabled";
  if (!sourceEnabled && !liveEnabled) return "in-sync-disabled";
  if (sourceEnabled && !liveEnabled) return "drift-stale-install";
  return "drift-local-override";
}
