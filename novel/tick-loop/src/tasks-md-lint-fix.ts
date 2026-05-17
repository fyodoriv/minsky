// <!-- scope: P0 `daemon-tasks-md-auto-lint-fix` Details (a)+(c) — pure
//      `markdownlint-cli2 --fix` wrapper the daemon runs after a completed
//      iteration so progress/claim/completion writes never leave an MD012
//      double-blank-line that deadlocks the pre-PR lint gate. -->

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Strategy seam (rule #2): one `markdownlint-cli2` invocation, injected so
 * the orchestration is unit-testable without spawning a real subprocess.
 *
 * Contract: return the tool's combined stdout+stderr text. MUST NOT throw
 * on `markdownlint-cli2`'s non-zero exit — exit 1 means "violations found",
 * which is the *expected* signal this helper parses (`Summary: N error(s)`),
 * not a failure. A real crash (missing summary line) surfaces as a thrown
 * `Error` from `parseSummaryCount` instead (rule #6 visible-not-silent).
 *
 * Production binding: `createMarkdownlintExec`.
 */
export type MarkdownlintExec = (cmd: {
  readonly fix: boolean;
  readonly tasksPath: string;
}) => string;

export interface FixTasksMdMarkdownOpts {
  /** Absolute (or cwd-relative) path to the TASKS.md file to lint-fix. */
  readonly tasksPath: string;
  /** Injected `markdownlint-cli2` runner (rule #2). */
  readonly execSyncFn: MarkdownlintExec;
  /**
   * When `true`, count violations but never invoke `--fix` — the file is
   * not mutated. Used by callers that only want the count (and by the
   * paired test asserting no mutation).
   */
  readonly dryRun?: boolean;
  /**
   * Sink for the "unfixable violations remain" warning (rule #6
   * visible-not-silent). Default: no-op. The daemon passes a span/log emitter.
   */
  readonly warn?: (msg: string) => void;
}

export interface FixTasksMdMarkdownResult {
  /** Total violations `markdownlint-cli2` reported BEFORE the `--fix` pass. */
  readonly violations: number;
  /** How many of those were auto-fixed (`violations - remaining`, ≥0). */
  readonly fixed: number;
}

/**
 * Parse the `Summary: N error(s)` line `markdownlint-cli2` always prints
 * (even for a clean file → `Summary: 0 error(s)`). Its absence means the
 * tool crashed before linting — surface that loudly (rule #6) rather than
 * silently treating a crash as "0 violations" and committing anyway.
 *
 * @otel-exempt pure parser; the I/O wrapper records the spawn.
 */
export function parseSummaryCount(output: string): number {
  const m = output.match(/^Summary:\s+(\d+)\s+error\(s\)/m);
  if (m === null) {
    throw new Error(
      `tasks-md-lint-fix: markdownlint-cli2 produced no "Summary: N error(s)" line (tool crashed before linting?) — output:\n${output}`,
    );
  }
  return Number(m[1]);
}

/**
 * Run `markdownlint-cli2 --fix <tasksPath>` so a daemon TASKS.md write
 * (claim → `**Status**: in-progress`, progress overwrite, completion
 * removal) never leaves an MD012 double blank line that deadlocks the
 * pre-PR lint gate. Returns the pre-fix violation count and how many were
 * auto-fixed so the caller can emit them as span attributes.
 *
 * Algorithm (2 spawns max, vs. the brief's literal 3-spawn fix→re-count):
 *   1. Read-only count → `before`.
 *   2. `before === 0` → return early; skip the `--fix` spawn entirely
 *      (skip-earlier gate — the common case is a clean file, so the
 *      mutating spawn is pure waste there).
 *   3. `dryRun` → return `{ before, 0 }` WITHOUT the `--fix` spawn (no
 *      file mutation).
 *   4. `--fix` spawn — `markdownlint-cli2` applies fixes then re-lints and
 *      prints the *post-fix* `Summary:` in the SAME run, so its own output
 *      yields `after` with no separate read-only re-count spawn
 *      (round-trip elimination — one fewer subprocess per non-clean write).
 *   5. `fixed = before - after`; if `fixed < before` (unfixable structural
 *      violations like MD001 remain) emit a warning but DO NOT block — the
 *      daemon's structural update is still correct; the operator fixes
 *      heading-order violations in a separate pass (brief Detail c).
 *
 * @otel-exempt pure orchestration over the injected `execSyncFn`; the
 *   `tasks-md-lint-fix.*` span lives at the call-site
 *   (`daemon.ts § maybeRunTasksMdLintFix`).
 */
export function fixTasksMdMarkdown(opts: FixTasksMdMarkdownOpts): FixTasksMdMarkdownResult {
  const before = parseSummaryCount(opts.execSyncFn({ fix: false, tasksPath: opts.tasksPath }));
  if (before === 0) return { violations: 0, fixed: 0 };
  if (opts.dryRun === true) return { violations: before, fixed: 0 };

  const after = parseSummaryCount(opts.execSyncFn({ fix: true, tasksPath: opts.tasksPath }));
  const fixed = Math.max(0, before - after);
  if (fixed < before) {
    (opts.warn ?? (() => {}))(
      `tasks-md-lint-fix: ${before - fixed} unfixable violation(s) remain in ${opts.tasksPath} after markdownlint-cli2 --fix; proceeding with commit (operator resolves structural lint — e.g. MD001 heading order — separately)`,
    );
  }
  return { violations: before, fixed };
}

/**
 * Production binding for `MarkdownlintExec`: spawn the repo's own
 * `markdownlint-cli2` (devDependency, rule #1 — canonical markdown
 * auto-fixer, not reinvented) via the current Node so there is no
 * version skew between the daemon and the linter.
 *
 * `spawnSync` (not `execFileSync`) because the seam is synchronous and we
 * must NOT throw on exit 1 — `markdownlint-cli2` exits non-zero whenever
 * any violation exists, which is the normal "found work to do" path.
 *
 * @otel-exempt pure factory; the span lives at the daemon call-site.
 */
export function createMarkdownlintExec(reqUrl: string = import.meta.url): MarkdownlintExec {
  // The package's `exports` map blocks deep-subpath resolution
  // (`markdownlint-cli2/markdownlint-cli2-bin.mjs` → ERR_PACKAGE_PATH_NOT_EXPORTED),
  // so resolve the exported main module and derive the sibling bin from
  // its directory instead.
  const mainPath = createRequire(reqUrl).resolve("markdownlint-cli2");
  const binPath = join(dirname(mainPath), "markdownlint-cli2-bin.mjs");
  return ({ fix, tasksPath }) => {
    const args = [binPath, ...(fix ? ["--fix"] : []), tasksPath];
    const r = spawnSync(process.execPath, args, { encoding: "utf8" });
    if (r.error !== undefined) throw r.error; // spawn failure (ENOENT) — misconfigured env
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  };
}
