// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 9 (operator 2026-05-08 — `--dry-run` flag wiring) -->
/**
 * `@minsky/tick-loop/bootstrap-local-llm-args` — pure parser for the
 * `minsky bootstrap-local-llm` subcommand's flag surface. Slice 9 of
 * P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Currently parses one flag — `--dry-run` — but exists as a typed
 * boundary so future flags (`--no-confirm`, `--model=…`, `--port=…`)
 * land here instead of accreting in the bin file. Pure-over-input;
 * tests pass synthetic argv arrays. The wiring at `bin/minsky.mjs`
 * passes `process.argv.slice(2 + 1)` (skip node + script + verb).
 *
 * Contract: never throws. Unknown flags are ignored — argparse
 * rigour belongs at a future per-subcommand parser layer; for now
 * the surface is too narrow to warrant it (rule #2 — keep boundaries
 * minimal until a second consumer demands more).
 *
 * @module tick-loop/bootstrap-local-llm-args
 */

/** The parsed argument surface for `minsky bootstrap-local-llm <args>`. */
export interface BootstrapLocalLlmArgs {
  /**
   * `--dry-run` — when true, the CLI runs detect + plan, prints the
   * confirm summary to stdout, and exits 0 without prompting or
   * spawning any installer. Anchors the task block's Risk mitigation
   * (operator 2026-05-08, "`--dry-run` flag prints the plan without
   * executing"). Read-only; safe in non-TTY contexts (cron / CI /
   * launchd) where slice 7 H2's TTY-refuse path otherwise blocks.
   */
  readonly dryRun: boolean;
}

/**
 * Parse the subcommand's flag surface. Pure — same input → same output.
 *
 * @otel-exempt pure parser; no I/O, no span.
 */
export function parseBootstrapLocalLlmArgs(args: readonly string[]): BootstrapLocalLlmArgs {
  return { dryRun: args.includes("--dry-run") };
}
