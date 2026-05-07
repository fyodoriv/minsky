/**
 * `@minsky/tick-loop/llm-invocation` — pure builders that translate a
 * brief + invocation parameters into the argv / stdin shape each LLM CLI
 * expects. Slice 2 of `local-llm-fallback-on-budget-pause` per TASKS.md.
 *
 * Two providers, two argv shapes:
 *
 * - **Claude Code** (`claude --print`): brief on stdin, `--print` flag on
 *   argv. Per `claude --help`: "Print response and exit (useful for pipes)".
 *   Optional per-worker `--worktree <name>` already produced by
 *   `claudeArgsForWorker` (`worker-config.ts`).
 *
 * - **Aider** (`aider --message <brief> --yes ...`): brief lives on argv
 *   via `--message`; stdin is unused. Aider auto-commits to the current
 *   branch, so the daemon's per-worker worktree must be the cwd. Per
 *   `aider --help`: `--message <text>` runs a one-shot edit cycle and
 *   exits; `--yes` auto-confirms; `--openai-api-base` routes the OpenAI
 *   client at the local mlx-lm.server; `--openai-api-key dummy` because
 *   the local server doesn't authenticate (Saltzer-Schroeder 1975 —
 *   psychological acceptability: a dummy key keeps aider's path uniform
 *   with its OpenAI / Anthropic paths, instead of a special "no-key"
 *   mode).
 *
 * Pattern conformance (rule #8):
 *   - **Adapter (structural)** — Gamma 1994. The two CLIs have different
 *     argv conventions; each builder is the adapter between the daemon's
 *     uniform `(brief, opts)` input and the CLI's specific shape.
 *     Conformance: full.
 *   - **Pure function** — Hughes 1989. Each builder is referentially
 *     transparent over its inputs; no clock, no env, no filesystem.
 *     Conformance: full.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: each builder returns a {@link LlmInvocation}
 * with a non-empty `command`, a frozen `argv` array, and a deterministic
 * brief-delivery channel (claude → stdin; aider → `--message` argv).
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Brief contains aider-`--message` argv-poison (e.g., embedded `--yes-i-really-mean-it`) | adversarial brief | `graceful-degrade` — argv is built positionally so `--message <brief>` keeps the brief as one argv element regardless of contents (no shell evaluation; `child_process.spawn` arrays are immune to shell injection). Tested in `aider-invocation.test.ts` "argv-poison brief is delivered as a single argv element". | paired test |
 * | 2 | Brief exceeds aider's `--message` size limit (Anthropic CLI accepts ~1MB; aider's spawn rlimit ~128KB on macOS) | very large brief | `graceful-degrade` — `child_process.spawn` raises an `E2BIG` runtime error which the spawn-strategy's reject handler converts to a non-zero exit + reason. Builder doesn't validate (rule #6 — let it crash with a precise error at the OS layer; truncating silently would be vanity). Pivot: if E2BIG fires more than once a week, ship a brief-trimmer at the brief construction layer (slice 3). | manual: build a 200KB brief, pass to spawn-strategy, assert exit non-zero with stderrTail containing E2BIG |
 * | 3 | Aider's `--openai-api-base` URL does not include `/v1` suffix (operator typo) | `apiBase: "http://127.0.0.1:8080"` | `graceful-degrade` — builder passes the URL through unchanged; aider returns an HTTP 404; daemon iteration logs `failed` with reason. Builder is the adapter, not the validator (Howard-LeBlanc 2003 — defence in depth, but the layer that owns validation is the layer that ships the URL — slice 3 wiring). | covered by slice-3 wiring tests |
 *
 * @module tick-loop/llm-invocation
 */

// ---- Types ----------------------------------------------------------------

/**
 * The shape `ProcessSpawnStrategy` consumes per iteration. Tagged-union via
 * the `stdin` field: `string` means "write this to child stdin and close",
 * `undefined` means "do not write to stdin" (the brief is on argv).
 *
 * `cwd` is optional — when set, the spawn-strategy's `child_process.spawn`
 * uses it (matters for aider, which auto-commits to the cwd's git branch).
 * When unset, `process.cwd()` is used (matches `ProcessSpawnStrategy` v0).
 */
export interface LlmInvocation {
  /** The CLI executable to spawn (e.g., `"claude"` or `"aider"`). */
  readonly command: string;
  /** Positional argv array (first element after `command`). Frozen. */
  readonly argv: readonly string[];
  /**
   * Brief delivery channel. `string` writes to child stdin; `undefined`
   * means "brief is on argv" (the aider path).
   */
  readonly stdin: string | undefined;
  /** Optional working directory for the child. Default: parent cwd. */
  readonly cwd?: string;
}

// ---- buildClaudePrintInvocation ------------------------------------------

export interface BuildClaudePrintInvocationOpts {
  /** The brief text to feed claude on stdin. Required (claude --print's input). */
  readonly brief: string;
  /**
   * Per-iteration extra args, appended after `--print`. Used by the
   * `worker-config.ts` `claudeArgsForWorker` extension for `--worktree`.
   */
  readonly extraArgs?: readonly string[];
  /**
   * Override `claude` command path (default: bare `"claude"` resolved via
   * PATH). Tests inject a fixture binary.
   */
  readonly command?: string;
}

/**
 * Build the invocation for `claude --print` (Anthropic Code's headless
 * mode). Brief on stdin, `--print` first, optional `--worktree <name>`
 * (or other per-iteration args) appended via `extraArgs`.
 *
 * @otel tick-loop.llm-invocation.build-claude-print
 */
export function buildClaudePrintInvocation(opts: BuildClaudePrintInvocationOpts): LlmInvocation {
  return {
    command: opts.command ?? "claude",
    argv: Object.freeze(["--print", ...(opts.extraArgs ?? [])]),
    stdin: opts.brief,
  };
}

// ---- buildAiderInvocation -------------------------------------------------

/**
 * Default model alias for aider's OpenAI client. The full HuggingFace
 * path (`openai/mlx-community/Qwen2.5-Coder-32B-Instruct-4bit`) is
 * required because litellm (aider's backend) parses the prefix after
 * `openai/` and looks up the tokenizer by the remainder; the bare
 * `openai/qwen2.5-coder-32b-instruct-4bit` triggers a 401 against
 * `https://huggingface.co/api/models/qwen2.5-coder-32b-instruct-4bit`
 * because litellm strips the namespace before the tokenizer lookup.
 *
 * Verified live against `mlx_lm.server --model
 * mlx-community/Qwen2.5-Coder-32B-Instruct-4bit` on 2026-05-07 (M3 Max
 * 64GB): aider produced a SEARCH/REPLACE block + applied the edit,
 * exit 0.
 */
export const DEFAULT_AIDER_MODEL = "openai/mlx-community/Qwen2.5-Coder-32B-Instruct-4bit";

/**
 * Default `--openai-api-base` for the local mlx-lm.server. Matches
 * `scripts/check-mlx-server.mjs`'s default URL minus the path suffix
 * (aider appends `/chat/completions` itself).
 */
export const DEFAULT_AIDER_OPENAI_API_BASE = "http://127.0.0.1:8080/v1";

/**
 * Default OpenAI key for aider against the local server. Aider's client
 * always sends the header even though `mlx_lm.server` doesn't validate;
 * a literal "dummy" matches the smoke-test pattern.
 */
export const DEFAULT_AIDER_OPENAI_API_KEY = "dummy";

export interface BuildAiderInvocationOpts {
  /** The brief text. Will be passed via `--message <brief>` argv. */
  readonly brief: string;
  /** Override the `aider` command path (tests / fixtures). Default `"aider"`. */
  readonly command?: string;
  /**
   * Per-iteration extra args, inserted before `--message`. Used by the
   * wiring layer (slice 3) for any aider-specific overrides the operator
   * configures via env (model selection, system-prompt path, etc.).
   */
  readonly extraArgs?: readonly string[];
  /** Override model alias. Default `DEFAULT_AIDER_MODEL`. */
  readonly model?: string;
  /** Override `--openai-api-base`. Default `DEFAULT_AIDER_OPENAI_API_BASE`. */
  readonly openaiApiBase?: string;
  /** Override `--openai-api-key`. Default `DEFAULT_AIDER_OPENAI_API_KEY`. */
  readonly openaiApiKey?: string;
  /**
   * Per-iteration cwd — aider auto-commits to the cwd's git branch, so
   * the daemon's per-worker worktree path must be passed when in
   * multi-worker mode. When `undefined`, the spawn-strategy uses the
   * parent process's cwd (single-process default).
   */
  readonly cwd?: string;
}

/**
 * Build the invocation for `aider --message <brief>` (the agentic edit
 * loop's one-shot mode). Brief is delivered via argv (`--message`); stdin
 * is left unbound. Defaults match the smoke-test in
 * `docs/local-llm-fallback.md` so an operator can swap claude → aider with
 * zero per-call config when a local mlx-lm.server is reachable.
 *
 * The argv order is fixed for stability: model/url/key/yes/no-warnings
 * first, then operator extras, then the terminal `--message <brief>`.
 * Putting `--message` last makes the brief the only argv element after the
 * fixed prefix — easier to read in `ps -ef` output and easier for a
 * future argv allowlist (rule #13's threat-model gate) to validate.
 *
 * `--no-auto-commits` is hard-wired into the default args because
 * aider's auto-commit default would commit straight to whatever branch
 * the daemon's cwd is on (which, in single-process mode, is minsky's
 * checked-out branch — destructive to the operator's working state).
 * The daemon's brief (`buildDaemonBrief`) instructs the LLM to commit
 * and open a PR explicitly, so the auto-commit channel would
 * double-commit. Operators who genuinely want aider's auto-commit path
 * can override via `extraArgs: ["--auto-commits"]` (the later flag
 * wins per aider's argparse).
 *
 * @otel tick-loop.llm-invocation.build-aider
 */
export function buildAiderInvocation(opts: BuildAiderInvocationOpts): LlmInvocation {
  const model = opts.model ?? DEFAULT_AIDER_MODEL;
  const apiBase = opts.openaiApiBase ?? DEFAULT_AIDER_OPENAI_API_BASE;
  const apiKey = opts.openaiApiKey ?? DEFAULT_AIDER_OPENAI_API_KEY;
  const argv: readonly string[] = Object.freeze([
    "--model",
    model,
    "--openai-api-base",
    apiBase,
    "--openai-api-key",
    apiKey,
    "--yes",
    "--no-show-model-warnings",
    "--no-auto-commits",
    ...(opts.extraArgs ?? []),
    "--message",
    opts.brief,
  ]);
  return {
    command: opts.command ?? "aider",
    argv,
    stdin: undefined,
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  };
}
