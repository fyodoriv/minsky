// <!-- scope: human-approved P0 from CTO audit 2026-05-11 (operator directive) — task `daemon-tasks-md-auto-lint-fix`: "run markdownlint-cli2 --fix TASKS.md after every daemon write so progress updates never introduce lint violations that deadlock the pre-PR gate" -->
/**
 * `@minsky/tick-loop/tasks-md-lint-fix` — pure auto-fix pass over
 * `TASKS.md` that the daemon runs immediately after every TASKS.md
 * write (claim / progress-update / completion), before `git add`.
 *
 * Root cause it eliminates (task `daemon-tasks-md-auto-lint-fix`): the
 * daemon's text-substitution writes to TASKS.md can leave double blank
 * lines (MD012) when one task block replaces another with differing
 * trailing whitespace. The pre-PR lint gate then catches MD012 and the
 * daemon deadlocks on that task — the operator currently removes the
 * whitespace by hand (commit `eb7c44b`).
 *
 * Pattern (rule #2): pure decision over an injected `execSyncFn` seam.
 * Production binding spawns `markdownlint-cli2`; tests inject a stub.
 * `markdownlint-cli2 --fix` is the canonical markdown auto-fixer and is
 * already a devDependency (rule #1 — don't reinvent).
 *
 * Algorithm:
 *   1. Read-only `markdownlint-cli2 <path>` → `violations` (total before).
 *   2. If `violations === 0` → return `{ violations: 0, fixed: 0 }`
 *      WITHOUT running `--fix` or the re-read (skip-earlier gate: the
 *      common case is a clean file; eliminating 2 round-trips per write
 *      is the per-iteration optimization for this slice).
 *   3. If `dryRun` → return `{ violations, fixed: 0 }` WITHOUT mutating.
 *   4. `markdownlint-cli2 --fix <path>` (applies whitespace fixes).
 *   5. Read-only `markdownlint-cli2 <path>` again → `remaining`.
 *   6. `fixed = violations - remaining`. If `remaining > 0` (unfixable
 *      structural errors like MD001 heading order remain), emit a
 *      warning line via the optional `logFn` seam but DO NOT block —
 *      the daemon's structural update is still correct; the operator
 *      fixes structural violations in a separate pass.
 *
 * The seam contract: `execSyncFn(command)` runs `command` and returns
 * its combined stdout+stderr as a string, NEVER throwing on a non-zero
 * exit (markdownlint-cli2 exits non-zero whenever violations remain).
 * The production binding therefore appends `2>&1 || true` to the
 * command (see {@link buildMarkdownlintCommand}).
 *
 * @module tick-loop/tasks-md-lint-fix
 */

// ---- Types ----------------------------------------------------------------

/**
 * Seam (rule #2) — run a shell command, return combined stdout+stderr,
 * never throw on non-zero exit. Production binding wraps `execSync`
 * with `{ encoding: "utf8" }`; the command itself carries `2>&1 || true`.
 */
export type ExecSyncFn = (command: string) => string;

/** Optional log seam — receives one warning line when unfixable violations remain. */
export type LogFn = (line: string) => void;

export interface FixTasksMdMarkdownOpts {
  /** Absolute or repo-relative path to TASKS.md. */
  readonly tasksPath: string;
  /** Injected command runner (see {@link ExecSyncFn}). */
  readonly execSyncFn: ExecSyncFn;
  /** When `true`, count violations but never run `--fix` (no file mutation). */
  readonly dryRun?: boolean;
  /** Optional warning sink for the unfixable-violations-remain case. */
  readonly logFn?: LogFn;
}

export interface FixTasksMdMarkdownResult {
  /** Total markdownlint violations detected BEFORE the `--fix` pass. */
  readonly violations: number;
  /** Number of violations the `--fix` pass resolved (`violations - remaining`). */
  readonly fixed: number;
}

// ---- Pure helpers ---------------------------------------------------------

/**
 * Build the shell command for one markdownlint-cli2 invocation. The
 * `2>&1 || true` suffix is the seam contract: violation lines go to
 * stderr and a non-zero exit must NOT throw under `execSync`.
 *
 * The path is single-quoted so spaces / shell metacharacters in
 * `tasksPath` don't break the invocation. Embedded single quotes are
 * escaped via the standard `'\''` idiom.
 *
 * @otel-exempt pure string builder; no I/O, no spans.
 */
export function buildMarkdownlintCommand(tasksPath: string, fix: boolean): string {
  const quoted = `'${tasksPath.replaceAll("'", "'\\''")}'`;
  const fixFlag = fix ? "--fix " : "";
  return `npx markdownlint-cli2 ${fixFlag}${quoted} 2>&1 || true`;
}

/**
 * Count markdownlint violations in one run's combined output. Each
 * violation is one line of the shape
 * `TASKS.md:5 MD012/no-multiple-blanks Multiple consecutive blank lines …`
 * — i.e. a rule code `MD<ddd>/<name>`. Counting those lines is robust
 * against version-specific summary wording.
 *
 * @otel-exempt pure parser; no I/O, no spans.
 */
export function countMarkdownlintViolations(output: string): number {
  const matches = output.match(/\bMD\d{3}\//g);
  return matches === null ? 0 : matches.length;
}

// ---- Main -----------------------------------------------------------------

/**
 * Auto-fix markdownlint violations in TASKS.md. Pure over the injected
 * `execSyncFn` / `logFn` seams. See the module header for the full
 * algorithm and rationale.
 *
 * Never throws and never blocks: when structural (unfixable) violations
 * remain after `--fix`, a warning line is emitted via `logFn` and the
 * caller proceeds with its commit — the daemon's structural TASKS.md
 * update is still correct.
 *
 * @otel-exempt pure over the injected `execSyncFn` / `logFn` seams; the
 * daemon wiring (slice 2) emits `tasks-md-lint-fix.violations` /
 * `.fixed` spans on the containing iteration span.
 */
export function fixTasksMdMarkdown(opts: FixTasksMdMarkdownOpts): FixTasksMdMarkdownResult {
  const { tasksPath, execSyncFn, dryRun, logFn } = opts;

  const beforeOutput = execSyncFn(buildMarkdownlintCommand(tasksPath, false));
  const violations = countMarkdownlintViolations(beforeOutput);

  // Skip-earlier gate: a clean file is the common case — don't spend
  // the `--fix` + re-read round-trips when there's nothing to fix.
  if (violations === 0) return { violations: 0, fixed: 0 };

  // Dry-run: report the count but never mutate the file.
  if (dryRun === true) return { violations, fixed: 0 };

  execSyncFn(buildMarkdownlintCommand(tasksPath, true));

  const afterOutput = execSyncFn(buildMarkdownlintCommand(tasksPath, false));
  const remaining = countMarkdownlintViolations(afterOutput);
  const fixed = violations - remaining;

  if (remaining > 0 && logFn !== undefined) {
    logFn(
      `tasks-md-lint-fix: ${fixed}/${violations} TASKS.md violation(s) auto-fixed; ${remaining} unfixable (structural — e.g. MD001) remain. Proceeding with commit; operator should fix structural violations in a separate pass.`,
    );
  }

  return { violations, fixed };
}
