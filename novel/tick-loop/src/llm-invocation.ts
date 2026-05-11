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
  /**
   * Optional model override (slice 5 of
   * `claude-usage-aware-strategic-model-router`). When set, passes
   * `--model <id>` to `claude --print`. Claude Code accepts both aliases
   * (`opus`, `sonnet`, `haiku`) and full ids (`claude-opus-4-7`). When
   * unset, claude uses its session default.
   */
  readonly model?: string;
}

/**
 * Build the invocation for `claude --print` (Anthropic Code's headless
 * mode). Brief on stdin, `--print` first, optional `--model <id>` (slice
 * 5 strategic-router wire-in), then `--worktree <name>` (or other
 * per-iteration args) appended via `extraArgs`.
 *
 * @otel tick-loop.llm-invocation.build-claude-print
 */
export function buildClaudePrintInvocation(opts: BuildClaudePrintInvocationOpts): LlmInvocation {
  return {
    command: opts.command ?? "claude",
    argv: Object.freeze([
      "--print",
      ...(opts.model === undefined ? [] : ["--model", opts.model]),
      ...(opts.extraArgs ?? []),
    ]),
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
  // Real-fire 2026-05-10: 3-worker local-only spawn each sent 40-70k
  // input tokens to mlx_lm.server (slim brief is ≤2KB; the rest is
  // aider's repo-map auto-load — `--map-tokens 1024` default ramps with
  // file count). Each request returned an empty response (server hit a
  // resource limit under concurrent load). Disabling the repo-map by
  // default cuts the input tokens from 40-70k → ≤5k for the slim
  // brief's referenced files. Operators who want the repo-map back
  // override via `extraArgs: ["--map-tokens", "1024"]`.
  //
  // Real-fire 2026-05-10 (single-worker post-#446): aider auto-picked
  // `whole` edit format. That forces the model to re-emit every byte of
  // the referenced file on every iteration. On Qwen3-Coder-30B-A3B
  // 4-bit, when the file already implements the requested behaviour,
  // the model loops on "Looking more carefully, I see the file is
  // already complete" until it fills the 8192-token max-tokens output
  // budget — no edit produced. Pinning `--edit-format diff` flips aider
  // to search/replace-block output: the model emits only the changed
  // lines, and a clean no-op is allowed (zero diff blocks ⇒ iteration
  // exits without thrashing). Operators who need whole-file edits can
  // override via `extraArgs: ["--edit-format", "whole"]` (later flag
  // wins per aider's argparse).
  //
  // Real-fire 2026-05-10 v3 (single-worker sampling-tuned): aider's
  // multi-round reflection loops blew up context. Round 1 produced a
  // real diff (3.6k input / 1.9k output); aider then ran auto-lint,
  // detected ~14 file-path mentions in the response, auto-added them
  // via `--yes`, and round 2 sent 46k tokens to mlx_lm.server which
  // exceeded the 32k context window — "Empty response received from
  // LLM" + iteration wasted. Disabling auto-lint, auto-test,
  // shell-command suggestions, and URL detection eliminates 4 of 5
  // reflection paths. The remaining path (file-mention auto-add via
  // `find_filenames_in_text` in aider's source) is rarer and only
  // fires on responses that resemble paths verbatim. Operators who
  // want lint/test reflections back can override via
  // `extraArgs: ["--auto-lint", "--auto-test"]`.
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
    "--no-auto-lint",
    "--no-auto-test",
    "--no-suggest-shell-commands",
    "--no-detect-urls",
    "--map-tokens",
    "0",
    "--edit-format",
    "diff",
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

// ---- buildOpencodeInvocation ----------------------------------------------

/**
 * Default model alias for opencode's `provider/model` format. The
 * provider half (`lmstudio`) is a key the operator must define in
 * `~/.config/opencode/opencode.json` under `provider.lmstudio.options.baseURL =
 * "http://127.0.0.1:1234/v1"` (LM Studio's documented default port). The
 * model half (`qwen3-14b`) is the alias the operator gives the model in
 * the same config under `provider.lmstudio.models`. The pair is
 * recency-checked May 2026 against opencode's documented `provider/model`
 * argv shape ([opencode CLI docs](https://opencode.ai/docs/cli/)) and
 * the operator-shared LM Studio + opencode flow ([Falkingham 2026-05-08](https://peterfalkingham.com/2026/05/08/getting-local-ai-working-for-me-lm-studio-opencode-and-hermes/)).
 *
 * Slice 1 of `support-opencode-lmstudio-mlx-qwen3-14b-stack`.
 */
export const DEFAULT_OPENCODE_MODEL = "lmstudio/qwen3-14b";

export interface BuildOpencodeInvocationOpts {
  /** The brief text. Will be passed as the final positional argv element. */
  readonly brief: string;
  /** Override the `opencode` command path (tests / fixtures). Default `"opencode"`. */
  readonly command?: string;
  /**
   * Per-iteration extra args, inserted between the fixed-flag prefix
   * (`run --model <id> --dangerously-skip-permissions`) and the
   * brief positional. Used by the wiring layer (slice 2) for any
   * opencode-specific overrides the operator configures via env (agent
   * selection, session id, etc.).
   */
  readonly extraArgs?: readonly string[];
  /**
   * Override model alias. Default {@link DEFAULT_OPENCODE_MODEL}. Format:
   * `provider/model` per opencode's documented `--model` shape — the
   * provider half must match a key in `~/.config/opencode/opencode.json`'s
   * `provider.<key>` map.
   */
  readonly model?: string;
  /**
   * Per-iteration cwd — opencode's tool-use loop edits files in the
   * current directory, so the daemon's per-worker worktree path must be
   * passed when in multi-worker mode. When `undefined`, the
   * spawn-strategy uses the parent process's cwd (single-process default).
   */
  readonly cwd?: string;
}

/**
 * Build the invocation for `opencode run "<brief>"` (opencode's
 * documented non-interactive mode — see [opencode CLI docs](https://opencode.ai/docs/cli/):
 * "useful for scripting, automation"). Brief is delivered as the final
 * positional argv element; stdin is unbound. Provider config (LM Studio
 * baseURL + model alias) lives in opencode's own
 * `~/.config/opencode/opencode.json`; this builder threads the
 * `provider/model` alias through `--model` so opencode picks the right
 * provider per iteration.
 *
 * `--dangerously-skip-permissions` is wired into the default args because
 * the supervisor runs unattended — no human is present to approve each
 * tool call. Operators who want the interactive permission prompts can
 * override via `extraArgs: []` (wait, actually — once wired, the flag is
 * always present; an opt-out belongs in the wiring layer, not here).
 *
 * The argv order is fixed for stability: `run` subcommand first, then
 * `--model <id>`, then `--dangerously-skip-permissions`, then operator
 * extras, then the terminal brief positional. Putting the brief last
 * makes it the only argv element after the fixed prefix — easier to read
 * in `ps -ef` output and easier for a future argv allowlist (rule #13's
 * threat-model gate) to validate.
 *
 * Failure modes (rule #7):
 *   - Argv-poison brief (e.g., embedded `--continue`): handled —
 *     `child_process.spawn` arrays are immune to shell injection;
 *     opencode's argparse sees the brief as the trailing positional.
 *     Tested.
 *   - Brief exceeds OS argv limit (~256 KB on macOS): handled — `spawn`
 *     rejects with `E2BIG`; let-it-crash per spawn-strategy's reject
 *     handler. The slim brief from `daemon-aider-brief-shrinker` (#406
 *     shipped) is ≤2 KB so this is far from the ceiling. Documented.
 *
 * @otel tick-loop.llm-invocation.build-opencode
 */
export function buildOpencodeInvocation(opts: BuildOpencodeInvocationOpts): LlmInvocation {
  // 2026-05-10 update: when `opts.model` is undefined, OMIT `--model`
  // entirely so opencode falls through to its own config-file resolution
  // (`<repo>/opencode.json` → `~/.config/opencode/opencode.json` → opencode
  // defaults). This is what makes operator-machine-config changes
  // (`opencode.json` edits) automatically pick up without Minsky restart —
  // each `opencode run` re-reads the config. The previous default-to-
  // {@link DEFAULT_OPENCODE_MODEL} hard-coded the model behind the
  // operator's back; the new default is "let opencode pick".
  //
  // Operators who want to pin a specific model from Minsky's side set
  // `MINSKY_LOCAL_LLM_MODEL_ID=<provider/model>`; the wiring layer
  // forwards that as `opts.model` and the explicit pin wins.
  const argv: readonly string[] = Object.freeze([
    "run",
    ...(opts.model === undefined ? [] : ["--model", opts.model]),
    "--dangerously-skip-permissions",
    ...(opts.extraArgs ?? []),
    opts.brief,
  ]);
  return {
    command: opts.command ?? "opencode",
    argv,
    stdin: undefined,
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  };
}
