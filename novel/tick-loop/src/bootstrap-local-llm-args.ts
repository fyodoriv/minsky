// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 9 (operator 2026-05-08 — `--dry-run` flag wiring) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 25 (operator 2026-05-10 — discoverability surface: `--no-confirm`/`-y`/`--yes` for explicit non-interactive `bootstrap-local-llm`; previously only the env hatch `MINSKY_NON_INTERACTIVE=1` skipped the [Y/n] prompt, undiscoverable from `--help`) -->
/**
 * `@minsky/tick-loop/bootstrap-local-llm-args` — pure parser for the
 * `minsky bootstrap-local-llm` subcommand's flag surface. Slice 9 of
 * P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Parses two flags — `--dry-run` and `--no-confirm` (with `--yes` /
 * `-y` aliases) — and exists as a typed boundary so future flags
 * (`--model=…`, `--port=…`) land here instead of accreting in the
 * bin file. Pure-over-input; tests pass synthetic argv arrays. The
 * wiring at `bin/minsky.mjs` passes `process.argv.slice(2 + 1)`
 * (skip node + script + verb).
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

  /**
   * `--no-confirm` (aliases: `--yes`, `-y`) — when true, the CLI
   * skips the `[Y/n]` confirm prompt and proceeds with the install
   * plan as if the operator typed `y`. Equivalent to setting the
   * `MINSKY_NON_INTERACTIVE=1` env var, but discoverable from
   * `minsky --help` and ergonomic to wire into shell scripts /
   * Makefiles / install runbooks. Slice 25 (operator 2026-05-10).
   *
   * Non-interactive does NOT bypass `planRequiresTty`: a plan that
   * needs sudo (install-arm-homebrew) still refuses with the slice
   * 7 H2 recovery message, because no flag can synthesize a
   * password prompt. The flag is for the routine "all deps already
   * present except the model — just download it without asking"
   * path that dominates re-runs.
   */
  readonly noConfirm: boolean;
}

/**
 * Parse the subcommand's flag surface. Pure — same input → same output.
 *
 * @otel-exempt pure parser; no I/O, no span.
 */
export function parseBootstrapLocalLlmArgs(args: readonly string[]): BootstrapLocalLlmArgs {
  return {
    dryRun: args.includes("--dry-run"),
    noConfirm: args.includes("--no-confirm") || args.includes("--yes") || args.includes("-y"),
  };
}
