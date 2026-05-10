// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 9 (operator 2026-05-08 — `--dry-run` flag wiring) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 17 (operator 2026-05-08 — `--no-confirm` flag wiring) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 18 (operator 2026-05-08 — `--model=<id>` flag wiring) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 19 (operator 2026-05-08 — `--port=<n>` flag wiring) -->
/**
 * `@minsky/tick-loop/bootstrap-local-llm-args` — pure parser for the
 * `minsky bootstrap-local-llm` subcommand's flag surface. Slice 9 / 17
 * / 18 / 19 of P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Parses four flags so far — `--dry-run`, `--no-confirm` (alias `-y`,
 * `--yes`), `--model=<hf-id>`, and `--port=<n>` — but exists as a typed
 * boundary so future flags land here instead of accreting in the bin
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

  /**
   * `--port=<n>` — override the default 8080 mlx-lm.server port for
   * BOTH the `start-mlx-server` install step's argv AND the bootstrap-
   * time server-liveness probe URL (`http://127.0.0.1:<port>/v1/models`).
   * When undefined, the planner uses `DEFAULT_LOCAL_LLM_PORT` (8080).
   *
   * Use case: the operator already runs another local server on 8080
   * (lm-studio default, ollama on 11434, an existing mlx_lm.server)
   * and wants to bootstrap a parallel instance on a different port.
   * Composes with `--model` so the operator can run two model variants
   * side by side. NOTE: the daemon itself reads
   * `MINSKY_LOCAL_LLM_PROBE_URL` to pick its provider — when bootstrapping
   * on a non-default port the operator must also set that env var so
   * the daemon points at the same port; the help text in `bin/minsky.mjs`
   * mentions this.
   *
   * Invalid values (`--port=`, `--port=foo`, `--port=0`, negative,
   * non-integer, > 65535) parse as undefined — the operator's typo
   * shouldn't silently bind to the privileged port range or skip
   * validation. Last `--port=<n>` wins (argv-tail-overrides convention).
   */
  readonly port?: number;
}

const MODEL_FLAG_PREFIX = "--model=";
const PORT_FLAG_PREFIX = "--port=";

/**
 * Parse a TCP port string. Returns `undefined` for any input that
 * isn't a positive integer in the IANA-registered ephemeral range
 * (1–65535). Pure helper.
 */
function parsePortValue(raw: string): number | undefined {
  if (raw.length === 0) return undefined;
  // Reject leading-zero / sign / non-digit forms before Number() coerces.
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65_535) return undefined;
  return n;
}

/**
 * Walk argv once, collecting the value-bearing flags (`--model=<id>`
 * and `--port=<n>`). Last-wins per flag. Extracted from the public
 * parser so its cognitive complexity stays under biome's cap (rule #6
 * — helper IS the boundary).
 */
function collectValueFlags(args: readonly string[]): {
  modelId: string | undefined;
  port: number | undefined;
} {
  let modelId: string | undefined;
  let port: number | undefined;
  for (const a of args) {
    if (a.startsWith(MODEL_FLAG_PREFIX)) {
      const value = a.slice(MODEL_FLAG_PREFIX.length);
      modelId = value.length > 0 ? value : undefined;
    } else if (a.startsWith(PORT_FLAG_PREFIX)) {
      port = parsePortValue(a.slice(PORT_FLAG_PREFIX.length));
    }
  }
  return { modelId, port };
}

/**
 * Parse the subcommand's flag surface. Pure — same input → same output.
 *
 * @otel-exempt pure parser; no I/O, no span.
 */
export function parseBootstrapLocalLlmArgs(args: readonly string[]): BootstrapLocalLlmArgs {
  const { modelId, port } = collectValueFlags(args);
  return {
    dryRun: args.includes("--dry-run"),
    noConfirm: args.includes("--no-confirm") || args.includes("--yes") || args.includes("-y"),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(port !== undefined ? { port } : {}),
  };
}
