// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 9 (operator 2026-05-08 — `--dry-run` flag wiring) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 17 (operator 2026-05-08 — `--no-confirm` flag wiring) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 18 (operator 2026-05-08 — `--model=<id>` flag wiring) -->
/**
 * `@minsky/tick-loop/bootstrap-local-llm-args` — pure parser for the
 * `minsky bootstrap-local-llm` subcommand's flag surface. Slice 9 / 17
 * / 18 of P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Parses three flags so far — `--dry-run`, `--no-confirm` (alias `-y`,
 * `--yes`), and `--model=<hf-id>` — but exists as a typed boundary so
 * future flags (`--port=…`) land here instead of accreting in the bin
 * file. Pure-over-input; tests pass synthetic argv arrays. The wiring
 * at `bin/minsky.mjs` passes `process.argv.slice(2 + 1)` (skip node +
 * script + verb).
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
   * `--no-confirm` (aliases: `--yes`, `-y`) — when true, the CLI skips
   * the interactive `[Y/n]` prompt and runs the install plan directly.
   * Symmetric to the `MINSKY_NON_INTERACTIVE=1` env var but expressed
   * as an explicit shell flag (rule #2 — operator intent at the call
   * site beats action-at-a-distance via env). Composes with
   * `--dry-run`: when both are set, `--dry-run` still wins (read-only
   * surfaces over write surfaces).
   */
  readonly noConfirm: boolean;

  /**
   * `--model=<hf-id>` — override the pinned default model for this
   * `bootstrap-local-llm` invocation. Threads through to (a) the
   * model-cache probe so detection checks the right HF cache dir,
   * (b) the `download-model` install step's `hf download <id>`
   * command, and (c) the `start-mlx-server` step's `--model <id>`
   * argv. When undefined, the planner uses `DEFAULT_LOCAL_LLM_MODEL`
   * (`mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit`).
   *
   * Use case: the operator wants to bootstrap a smaller variant
   * (e.g., `mlx-community/Qwen3-4B-Instruct-4bit` for a low-RAM
   * box) without editing the pinned constant. Composes with
   * `--dry-run` so the operator can preview the alternative plan.
   *
   * Empty values (`--model=`) parse as undefined to avoid wiring an
   * empty model id into the install commands.
   */
  readonly modelId?: string;
}

const MODEL_FLAG_PREFIX = "--model=";

/**
 * Parse the subcommand's flag surface. Pure — same input → same output.
 *
 * @otel-exempt pure parser; no I/O, no span.
 */
export function parseBootstrapLocalLlmArgs(args: readonly string[]): BootstrapLocalLlmArgs {
  // Last `--model=<id>` wins (matches argv-tail-overrides shell convention).
  let modelId: string | undefined;
  for (const a of args) {
    if (a.startsWith(MODEL_FLAG_PREFIX)) {
      const value = a.slice(MODEL_FLAG_PREFIX.length);
      modelId = value.length > 0 ? value : undefined;
    }
  }
  return {
    dryRun: args.includes("--dry-run"),
    noConfirm: args.includes("--no-confirm") || args.includes("--yes") || args.includes("-y"),
    ...(modelId !== undefined ? { modelId } : {}),
  };
}
