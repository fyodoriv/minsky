// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 1 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-python-path-detection slice 5 (operator 2026-05-08 — live-run regression: hardcoded python path broke on Intel-brew machines) -->
// <!-- scope: human-approved minsky-cli-arch-detection slice 6 (operator 2026-05-08 — "rosetta/intel must be resolved as well, do it now so that this tool can auto fix it") -->
// <!-- scope: human-approved minsky-cli-arch-detection-hardening slice 7 (operator 2026-05-08 — H1 arch-consistent aider python + H2 planRequiresTty non-TTY refuse) -->
/**
 * `@minsky/tick-loop/local-llm-bootstrap` — pure detection + plan functions
 * for the local-LLM stack. Slice 1 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm` per `TASKS.md`.
 *
 * Two pure decision functions plus a small I/O surface for detection:
 *
 *   1. {@link detectLocalLlmStack} — shells out to `which pipx` /
 *      `which mlx_lm.server` / `which aider` / `huggingface-cli scan-cache`
 *      / `fetch http://127.0.0.1:8080/v1/models` and returns a
 *      {@link LocalLlmStackState} record. The shape of the function is
 *      pure-over-injected-probes; the I/O lives in the production
 *      executor (`bin/minsky.mjs`).
 *
 *   2. {@link planLocalLlmBootstrap} — pure decision over
 *      {@link LocalLlmStackState} returning {@link BootstrapPlan} (a
 *      `readonly InstallStep[]`). Each step is a leaf installer the
 *      caller dispatches (pipx install / huggingface-cli download /
 *      mlx_lm.server start). The plan is "shortest path from current
 *      state to ready-to-iterate". Idempotent: a fully-installed stack
 *      returns an empty plan in O(1).
 *
 * Slice 2 (the executor at `local-llm-bootstrap-executor.ts`) wires the
 * plan to a confirm-prompt + sequential-spawn pipeline. Slice 3
 * (`bin/minsky.mjs` pre-flight) wires it into the no-args path.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Pure decision function** — Hughes, "Why Functional Programming
 *     Matters", 1989 — referentially transparent over the input record;
 *     all I/O lives in the caller's probe seams. Conformance: full.
 *   - **Plan-and-Execute** — Russell & Norvig, *AIMA* 3rd ed. 2010,
 *     Ch. 11 (classical-AI planning split into a plan-generator + a
 *     plan-executor). The detector + planner are the plan-generator;
 *     the executor is the I/O boundary. Conformance: full.
 *   - **Strategy / Selector** — Gamma 1994 (the function-as-Strategy
 *     form; the function returns "which steps to run" rather than
 *     itself doing the work). Conformance: full.
 *
 * Failure modes & chaos verification (rule #7 / vision.md § 7).
 *
 * Steady-state hypothesis: `planLocalLlmBootstrap` returns a plan whose
 * `steps` array is closed (one of five known step types) for every
 * legitimate input, never throws, never reads I/O. Blast radius: a
 * single bootstrap attempt's plan. Operator escape hatch:
 * `MINSKY_NO_AUTO_BOOTSTRAP=1` environment variable disables the
 * pre-flight entirely; setting it forces the legacy "operator runs the
 * recipe by hand" flow documented in `docs/local-llm-fallback.md`. The
 * planner is detection-only; it never mutates host state.
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Probe seam throws | `detectLocalLlmStack`'s injected probe rejects | `loud-crash` per Armstrong 2007 — the planner does NOT catch; the rejection bubbles up to the supervisor (`bin/minsky.mjs`). Operator sees the misconfig at the I/O layer, not as a silent install plan. Rationale: a probe that throws is a programming bug in the executor, not a runtime fault | `local-llm-bootstrap.test.ts` "rejects when probe seam throws" |
 * | 2 | Stack fully installed but server unreachable | `pipx`+`mlx_lm`+`aider`+model present, `server.reachable=false` | `graceful-degrade` — plan returns a single `start-mlx-server` step, fast-path under 60 s | "fully installed but server stopped" test |
 * | 3 | Stack partially installed (model missing) | model absent, everything else present | `graceful-degrade` — plan returns `[download-model, start-mlx-server]` | "partial install — model missing" test |
 * | 4 | Stack absent entirely | nothing present | `graceful-degrade` — full 5-step plan in deterministic order | "fresh machine — full bootstrap" test |
 * | 5 | Idempotent fast-path | everything present + reachable | empty plan (`steps.length === 0`) returned in O(1) | "idempotent — already running" test |
 *
 * @module tick-loop/local-llm-bootstrap
 */

import {
  needsArmHomebrewInstall,
  preferredBrewPath,
  preferredPipxPath,
  preferredPythonPath,
} from "./arch-probe.js";

// ---- Types ----------------------------------------------------------------

/**
 * Discriminated union over each component's presence on the local
 * machine. The `present` boolean is the load-bearing field; the
 * optional `version` / `path` / `reason` fields are for the
 * operator-facing log line and are ignored by {@link planLocalLlmBootstrap}.
 *
 * `error` is distinct from `absent`: a probe that returned a
 * `permission denied` is a misconfigured host (loud-crash up the stack);
 * `absent` is "not installed yet" (the planner schedules an install).
 */
export interface ComponentState {
  /** `true` when the component is detected and usable. */
  readonly present: boolean;
  /**
   * When `present === true`, the resolved CLI path or version. Optional;
   * the planner does not consult this. The executor logs it for the
   * operator's terminal.
   */
  readonly path?: string;
  /** Optional human-readable detail (model size, python version, etc.). */
  readonly detail?: string;
  /**
   * When `present === false`, a short reason string ("not on PATH",
   * "ECONNREFUSED", "huggingface-cache miss", etc.) for the
   * operator-facing log. The planner does not consult this.
   */
  readonly reason?: string;
}

/** mlx-lm.server liveness — the only component with a network probe. */
export interface ServerState {
  /** `true` when `GET <url>/v1/models` returned 200 within the probe's TTL. */
  readonly reachable: boolean;
  /** Probe URL — defaults to `http://127.0.0.1:8080/v1/models`. */
  readonly url: string;
  /** Optional PID of the running server (read from `.minsky/local-llm.pid`). */
  readonly pid?: number;
  /** Short reason when `reachable === false` ("ECONNREFUSED", "timeout 5000ms", etc.). */
  readonly reason?: string;
}

/**
 * Aggregate state of the local-LLM stack. Built by `detectLocalLlmStack`,
 * consumed by `planLocalLlmBootstrap`. The five components match the
 * five install steps in `BootstrapStepType`.
 */
export interface LocalLlmStackState {
  /** `pipx` CLI — the pinned-Python venv manager that hosts mlx-lm + aider. */
  readonly pipx: ComponentState;
  /** `mlx_lm.server` — Apple Silicon native ML inference server. */
  readonly mlxLm: ComponentState;
  /** `aider` — agentic coding harness, the closest semantic match to `claude --print`. */
  readonly aider: ComponentState;
  /** Qwen3-Coder-30B-A3B-Instruct-4bit weights in the huggingface cache. */
  readonly model: ComponentState;
  /** `huggingface-cli` binary — required for model download; installed via `pipx install huggingface_hub[cli]`. */
  readonly huggingfaceCli: ComponentState;
  /** mlx-lm.server liveness — the only network-side probe. */
  readonly server: ServerState;
}

/**
 * Closed set of install-plan step types. Adding a new step is a
 * breaking change that needs a `pivot-local-llm-bootstrap-plan-shape`
 * rule-#9 record before it lands; removing one is more breaking still.
 */
export type BootstrapStepType =
  | "install-arm-homebrew"
  | "install-pipx"
  | "install-mlx-lm"
  | "install-aider"
  | "install-huggingface-cli"
  | "download-model"
  | "start-mlx-server";

/**
 * One step in a {@link BootstrapPlan}. Carries the shell command the
 * executor dispatches plus the operator-facing description + envelopes.
 * Pure data — no I/O, no closures.
 */
export interface InstallStep {
  readonly type: BootstrapStepType;
  /** One-line operator-facing description, used in the confirm prompt. */
  readonly description: string;
  /**
   * Coarse wall-clock estimate, used in the confirm prompt's "this will
   * take ~N min" line. Caller should display `Math.ceil(ms / 60000)` min.
   */
  readonly estimatedDurationMs: number;
  /**
   * Coarse download envelope in MB, summed for the confirm prompt's
   * "this will download ~N GB" line. `undefined` for steps that don't
   * download (server start, etc.).
   */
  readonly estimatedDownloadMb?: number;
  /**
   * Argv vector the executor dispatches. The first element is the
   * binary; subsequent elements are the args. Pure data.
   */
  readonly command: readonly string[];
}

/**
 * The full plan {@link planLocalLlmBootstrap} returns. The `steps` field
 * is the load-bearing one; the totals are summed for the confirm prompt's
 * UX. Empty `steps` means "nothing to do" (idempotent fast path).
 */
export interface BootstrapPlan {
  readonly steps: readonly InstallStep[];
  /** Sum of step `estimatedDurationMs`; used for the confirm prompt. */
  readonly totalEstimatedDurationMs: number;
  /** Sum of step `estimatedDownloadMb`; used for the confirm prompt. */
  readonly totalEstimatedDownloadMb: number;
  /** When `true`, the stack is already ready and no install is needed. */
  readonly ready: boolean;
}

/**
 * Optional planner knobs. The state record stays focused on "what's
 * installed"; knobs like "which python interpreter to pin aider to"
 * are orthogonal and only touch individual steps, so they live here
 * instead of on {@link LocalLlmStackState}.
 *
 * Added 2026-05-08 (slice 5 — `minsky-cli-python-path-detection` fix)
 * to replace the hardcoded `/opt/homebrew/bin/python3.12` that slice 1
 * baked into the aider install step. Absent / undefined fields keep
 * the planner backward-compatible with slice 1's call sites.
 */
export interface BootstrapPlanOptions {
  /**
   * Interpreter path for `pipx install --python <path> aider-chat`.
   * When undefined, pipx picks whatever `python3` is on PATH — fine
   * on most machines (macOS/Linux default to 3.12 or 3.13 which aider
   * supports). Production wiring calls `probePython()` from
   * `local-llm-probes.ts` to pick the best interpreter; tests pass
   * synthetic strings.
   */
  readonly pythonPath?: string;

  /**
   * Architecture state for the host. Slice 6
   * (`minsky-cli-arch-detection`) feeds `detectArchState` from
   * `arch-probe.ts`. When present AND
   * `archState.needsNativeBrew === true`, the planner prepends the
   * `install-arm-homebrew` step AND reshapes downstream brew / pipx
   * commands to use `/opt/homebrew/bin/...` absolute paths so the
   * chain is architecture-transparent (works from both arm64 shells
   * and Rosetta shells on Apple Silicon hardware).
   *
   * When undefined (slice 1-5 call sites), the planner falls back to
   * the slice-5 behavior — bare `brew` / `pipx` on PATH. Backward-
   * compat by construction.
   */
  readonly archState?: import("./arch-probe.js").ArchState;
  /**
   * Slice 46: local filesystem path to pass to `mlx_lm.server --model`.
   * When set, the start-mlx-server step uses this path instead of the
   * model ID string, avoiding any HuggingFace network lookup at server
   * start. The wiring layer (`bin/minsky.mjs`) supplies `state.model.path`
   * when the probe found the model locally.
   */
  readonly modelPath?: string;
}

// ---- Constants ------------------------------------------------------------

/**
 * Pinned model identifier — `mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit`
 * per `docs/local-llm-fallback.md` (the operator's elected stack as of
 * 2026-05-07). Bumping this is a breaking change that needs a
 * `pivot-local-llm-model-id` rule-#9 record before it lands.
 *
 * Stability promise: the constant is the public contract for
 * downstream tooling (the daemon's `MINSKY_LLM_MODEL` env var, the
 * smoke-test runbook, the CHANGELOG entry for the swap PR). Changing
 * the value here without updating those three places is a drift bug.
 *
 * Anchor: `docs/local-llm-fallback.md` § "Stack" — model row.
 */
export const DEFAULT_LOCAL_LLM_MODEL = "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit";

/**
 * Default disk envelope for the model download in MB. Empirical from
 * the operator's M1 Max 32 GB measurement 2026-05-07: the model resident
 * size is ~17.2 GB; the download with sharding overhead lands at
 * ~17_500 MB. Used only for the confirm prompt's "this will download
 * ~17 GB" line; the planner does not gate on disk space (callers
 * should add a separate `df -BM <hf-cache>` check if desired).
 */
export const DEFAULT_MODEL_DOWNLOAD_MB = 17_500;

/**
 * Default mlx-lm.server URL — the same probe target the daemon's
 * `LlmProviderSpawnStrategy` uses. Mirrors
 * `MINSKY_LOCAL_LLM_PROBE_URL`'s default in `bin/tick-loop.mjs`.
 *
 * Anchor: `docs/local-llm-fallback.md` § "Smoke test" — first command.
 */
export const DEFAULT_LOCAL_LLM_PROBE_URL = "http://127.0.0.1:8080/v1/models";

// ---- Step Builders --------------------------------------------------------

/**
 * Build the install-arm-homebrew step. Only scheduled when the host is
 * Apple Silicon AND `/opt/homebrew/bin/brew` is absent (slice 6's
 * `archState.needsNativeBrew === true` branch).
 *
 * The installer is the official Homebrew one-liner wrapped with
 * `arch -arm64` so sudo-escalated `mkdir /opt/homebrew/` lands in
 * arm64 mode even when the parent shell is running under Rosetta.
 * `NONINTERACTIVE=1` skips the installer's "press RETURN to continue"
 * prompt; sudo may still prompt for a password on the operator's
 * terminal (inherited stdin required — handled at the executor layer).
 *
 * Estimated 3 min wall-clock on a 1 Gbps link: 30 s for the installer
 * script download + ~90 s for the Homebrew self-tar unpack + ~60 s for
 * `brew update` to seed the formula index.
 *
 * Internal — exported only for paired tests.
 */
function buildInstallArmHomebrewStep(): InstallStep {
  return {
    type: "install-arm-homebrew",
    description:
      "Install native ARM Homebrew at /opt/homebrew/ (~3 min; needs sudo for /opt/homebrew/ mkdir)",
    estimatedDurationMs: 180_000,
    // `arch -arm64` forces the entire installer into arm64 execution;
    // the installer's own detection logic then chooses /opt/homebrew/
    // (the Apple-Silicon-standard prefix) because the child process
    // reports `uname -m` as arm64 regardless of the parent shell.
    command: [
      "arch",
      "-arm64",
      "/bin/bash",
      "-c",
      'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    ],
  };
}

/**
 * Build the canonical install step for `pipx`. Internal — exported only
 * for paired tests. The command uses Homebrew because pipx itself ships
 * via brew on macOS and apt on Linux; the operator's machine is macOS
 * (vision.md § "Tech defaults" — operator-blessed; Linux is supported
 * but is not the default).
 *
 * Slice 6: when `brewPath` is supplied, the command becomes
 * `<brewPath> install pipx` (absolute path → architecture-transparent).
 * When undefined, falls back to slice-1's bare `brew install pipx`.
 */
function buildPipxStep(brewPath?: string): InstallStep {
  const brew = brewPath ?? "brew";
  return {
    type: "install-pipx",
    description:
      brewPath !== undefined
        ? `Install pipx via ${brewPath} (Python isolated-venv manager)`
        : "Install pipx (Python isolated-venv manager)",
    estimatedDurationMs: 30_000,
    command: [brew, "install", "pipx"],
  };
}

function buildMlxLmStep(pipxPath?: string): InstallStep {
  const pipx = pipxPath ?? "pipx";
  return {
    type: "install-mlx-lm",
    description:
      pipxPath !== undefined
        ? `Install mlx-lm via ${pipxPath} (Apple Silicon native ML server)`
        : "Install mlx-lm via pipx (Apple Silicon native ML server)",
    estimatedDurationMs: 60_000,
    command: [pipx, "install", "mlx-lm"],
  };
}

function buildAiderStep(pythonPath?: string, pipxPath?: string): InstallStep {
  // Aider needs python 3.12 or 3.13 (3.14 has numpy build issues — see
  // `docs/local-llm-fallback.md`). pipx isolates the venv so aider's
  // tokenizers==0.21.1 doesn't conflict with mlx-lm's >=0.22.
  //
  // Resolution order for the python interpreter (slice 5):
  //   1. Caller-supplied `pythonPath` (the wiring layer detects what's
  //      actually available via `probePython`).
  //   2. Omit `--python` → pipx picks whatever `python3` points to.
  //      On most macOS/Linux machines that's 3.12 or 3.13 (supported);
  //      if 3.14, the install fails loudly and the operator can install
  //      brew python@3.13 and rerun.
  //
  // Slice 6 adds the pipxPath knob so the command uses the arch-correct
  // `pipx` absolute path (e.g., `/opt/homebrew/bin/pipx` on Apple
  // Silicon). When both pythonPath and pipxPath are undefined, the
  // command falls through to slice-5's bare-`pipx install aider-chat`.
  //
  // Replaces slice 1's hardcoded `/opt/homebrew/bin/python3.12` path —
  // it worked on the operator's Apple-Silicon-with-brew-python machine
  // but failed on machines without brew python@3.12 (caught 2026-05-08
  // live-run on the operator's laptop).
  const pipx = pipxPath ?? "pipx";
  const command =
    pythonPath !== undefined
      ? [pipx, "install", "--python", pythonPath, "aider-chat"]
      : [pipx, "install", "aider-chat"];
  const viaPipxLabel = pipxPath !== undefined ? ` via ${pipxPath}` : "";
  const description =
    pythonPath !== undefined
      ? `Install aider-chat${viaPipxLabel} with ${pythonPath} (pinned 3.12/3.13 per docs)`
      : `Install aider-chat${viaPipxLabel} (pipx-default python; 3.12/3.13 supported)`;
  return { type: "install-aider", description, estimatedDurationMs: 60_000, command };
}

function buildInstallHuggingfaceCliStep(pipxPath?: string): InstallStep {
  const pipx = pipxPath ?? "pipx";
  const viaPipxLabel = pipxPath !== undefined ? ` via ${pipxPath}` : "";
  return {
    type: "install-huggingface-cli",
    description: `Install huggingface-cli${viaPipxLabel} via pipx (needed for model download)`,
    estimatedDurationMs: 30_000,
    command: [pipx, "install", "huggingface_hub[cli]"],
  };
}

function buildModelDownloadStep(modelId: string): InstallStep {
  return {
    type: "download-model",
    description: `Download ${modelId} (~17 GB; ~8–12 min on a 1 Gbps link)`,
    estimatedDurationMs: 12 * 60_000,
    estimatedDownloadMb: DEFAULT_MODEL_DOWNLOAD_MB,
    command: ["huggingface-cli", "download", modelId],
  };
}

function buildStartServerStep(modelPath?: string): InstallStep {
  return {
    type: "start-mlx-server",
    description: "Start mlx_lm.server in the background (writes PID to .minsky/local-llm.pid)",
    estimatedDurationMs: 60_000,
    // The executor wraps this in a detached spawn so the server outlives
    // the bootstrap call; the actual command is launched via shell-out
    // in the executor (it needs detach + log redirection that argv-only
    // can't express). The argv here is the canonical shape the executor
    // dispatches; adjust there if the executor changes the launch path.
    //
    // Slice 46: when modelPath is supplied (local cache path from the
    // model probe or MINSKY_LOCAL_MODEL_PATH), pass it directly to
    // avoid any HuggingFace network lookup at server start.
    command: [
      "mlx_lm.server",
      "--model",
      modelPath ?? DEFAULT_LOCAL_LLM_MODEL,
      "--host",
      "127.0.0.1",
      "--port",
      "8080",
    ],
  };
}

// ---- planLocalLlmBootstrap ------------------------------------------------

/**
 * Idempotent fast path check — everything present + reachable. The
 * operator runs `minsky` again on a set-up machine; we add zero
 * seconds. Extracted from `planLocalLlmBootstrap` to drop cognitive
 * complexity per biome's cap (rule #6 — helpers IS the boundary).
 *
 * (Internal — not exported.)
 */
function isStackReady(state: LocalLlmStackState): boolean {
  return (
    state.pipx.present &&
    state.mlxLm.present &&
    state.aider.present &&
    state.model.present &&
    state.server.reachable
  );
}

/**
 * Build the ordered install step list. Separated from
 * `planLocalLlmBootstrap` so the public function's cognitive
 * complexity stays ≤ biome's cap of 10. Pure function — same inputs
 * → same outputs; no I/O.
 *
 * Slice 6: when `options.archState` is supplied AND
 * `needsNativeBrew === true`, prepends `install-arm-homebrew` and
 * reshapes downstream `brew` / `pipx` step commands to use absolute
 * paths.
 *
 * (Internal — not exported.)
 */
interface ResolvedPaths {
  readonly brewPath: string | undefined;
  readonly pipxPath: string | undefined;
  readonly pythonPath: string | undefined;
}

/**
 * Resolve absolute brew / pipx / python paths from `options`. Extracted
 * so `buildInstallSteps` below stays under biome's cognitive-complexity
 * cap. When `archState` is undefined, every field is `undefined` and
 * the step builders fall back to slice-1's bare-name commands.
 */
function resolvePaths(options: BootstrapPlanOptions): ResolvedPaths {
  const { archState } = options;
  if (archState === undefined) {
    return { brewPath: undefined, pipxPath: undefined, pythonPath: options.pythonPath };
  }
  const archPython = preferredPythonPath(archState);
  return {
    brewPath: preferredBrewPath(archState),
    pipxPath: preferredPipxPath(archState),
    pythonPath: archPython ?? options.pythonPath,
  };
}

function buildInstallSteps(
  state: LocalLlmStackState,
  options: BootstrapPlanOptions,
): InstallStep[] {
  const { brewPath, pipxPath, pythonPath } = resolvePaths(options);
  const steps: InstallStep[] = [];
  if (options.archState !== undefined && needsArmHomebrewInstall(options.archState)) {
    steps.push(buildInstallArmHomebrewStep());
  }
  if (!state.pipx.present) steps.push(buildPipxStep(brewPath));
  if (!state.mlxLm.present) steps.push(buildMlxLmStep(pipxPath));
  if (!state.aider.present) steps.push(buildAiderStep(pythonPath, pipxPath));
  if (!state.model.present) {
    if (!state.huggingfaceCli.present) steps.push(buildInstallHuggingfaceCliStep(pipxPath));
    steps.push(buildModelDownloadStep(DEFAULT_LOCAL_LLM_MODEL));
  }
  // Slice 46: use the detected local path when available so mlx_lm.server
  // doesn't need to resolve the model ID through the HuggingFace cache.
  if (!state.server.reachable)
    steps.push(buildStartServerStep(state.model.path ?? options.modelPath));
  return steps;
}

/**
 * Does the plan contain at least one step that needs an interactive
 * terminal (stdin inheritance for sudo prompt)? Slice 7 H2 — the CLI
 * wiring uses this to refuse `bootstrap-local-llm` when the operator
 * runs `minsky` without a TTY (launchd, systemd, cron, `< /dev/null`).
 *
 * Currently the only TTY-required step is `install-arm-homebrew` (the
 * Homebrew installer needs sudo to `mkdir /opt/homebrew/`). If future
 * steps add sudo dependencies, extend the predicate here.
 *
 * Pattern conformance: Predicate pattern — Meyer, *Eiffel: The
 * Language*, 1992 (the `require` / `ensure` contract-by-pre/post-
 * condition tradition). Pure function; same input → same output.
 *
 * @otel-exempt pure predicate — no span.
 */
export function planRequiresTty(plan: BootstrapPlan): boolean {
  return plan.steps.some((step) => step.type === "install-arm-homebrew");
}

/**
 * Output of {@link decideTtyMode} — splits the two questions the CLI
 * wiring conflated before slice 7's hardening iteration:
 *
 *   - `hasTtyForSudo` — can `install-arm-homebrew`'s sudo prompt
 *     reasonably succeed? `process.stdin.isTTY` is the canonical probe,
 *     but it false-negatives in tmux-detach, nohup, ssh-tty-allocation,
 *     and `< /dev/null` contexts where the operator has externally
 *     arranged sudo elevation (passwordless sudoers, `SUDO_ASKPASS`).
 *     `MINSKY_ASSUME_TTY=1` is the operator's "trust me, sudo can
 *     prompt" override per the task block's pivot threshold.
 *
 *   - `isInteractive` — should the [Y/n] confirm read from stdin, or
 *     auto-confirm via `confirmAlwaysYes`? Conservative: needs an
 *     actual TTY (not the assumed-TTY override) AND `MINSKY_NON_
 *     INTERACTIVE` unset. The auto-confirm path is the documented
 *     non-interactive behavior since slice 1.
 */
export interface TtyMode {
  readonly hasTtyForSudo: boolean;
  readonly isInteractive: boolean;
}

/**
 * Decide the two TTY-dependent behaviors from the three input signals:
 * Node's `process.stdin.isTTY`, the `MINSKY_ASSUME_TTY=1` operator
 * override, and the `MINSKY_NON_INTERACTIVE=1` auto-confirm flag.
 *
 * Slice 7 hardening iteration: extracted from `bin/minsky.mjs` so the
 * truth table is paired-testable. The original slice-7 H2 wiring
 * folded both decisions into one `isInteractive` boolean — that
 * regressed `MINSKY_NON_INTERACTIVE=1` in a real TTY (it tripped the
 * non-TTY refuse path even though sudo had a real stdin) and offered
 * no escape hatch for tmux-detach / nohup contexts. The pivot
 * threshold in the task block named `MINSKY_ASSUME_TTY=1` as the
 * canonical override.
 *
 * Pattern conformance: Strategy / pure-decision-function — Hughes 1989
 * — same input → same output, no I/O, no environment access. The
 * caller (`bin/minsky.mjs`) reads the env vars and passes them in.
 *
 * @otel-exempt pure decision — no span.
 */
export function decideTtyMode(opts: {
  readonly stdinIsTty: boolean;
  readonly assumeTty: boolean;
  readonly nonInteractive: boolean;
}): TtyMode {
  return {
    hasTtyForSudo: opts.stdinIsTty || opts.assumeTty,
    isInteractive: opts.stdinIsTty && !opts.nonInteractive,
  };
}

/**
 * Plan the shortest sequence of install steps that takes the host from
 * `state` to a ready-to-iterate local-LLM stack. Pure decision function;
 * see the JSDoc at the top of this file for the contract and the
 * failure-mode chaos table.
 *
 * Step order is deterministic and dependency-aware: pipx is required by
 * mlx-lm and aider; mlx-lm + aider + model are required by server-start.
 * If a step's dependency is missing, the dependency is scheduled first.
 * Slice 6: when `options.archState.needsNativeBrew === true`, prepends
 * an `install-arm-homebrew` step before pipx.
 *
 * Idempotent: a fully-installed reachable stack returns
 * `{ steps: [], ready: true }` in O(1). Empty plan is the operator's
 * "nothing to do, just start the daemon" signal.
 *
 * @otel tick-loop.local-llm-bootstrap.plan
 */
export function planLocalLlmBootstrap(
  state: LocalLlmStackState,
  options: BootstrapPlanOptions = {},
): BootstrapPlan {
  if (isStackReady(state)) {
    return { steps: [], totalEstimatedDurationMs: 0, totalEstimatedDownloadMb: 0, ready: true };
  }
  const steps = buildInstallSteps(state, options);

  let totalDurationMs = 0;
  let totalDownloadMb = 0;
  for (const step of steps) {
    totalDurationMs += step.estimatedDurationMs;
    totalDownloadMb += step.estimatedDownloadMb ?? 0;
  }

  return {
    steps,
    totalEstimatedDurationMs: totalDurationMs,
    totalEstimatedDownloadMb: totalDownloadMb,
    ready: false,
  };
}

// ---- detectLocalLlmStack --------------------------------------------------

/**
 * Probe seams the production detector wraps — used in tests to inject
 * synthetic states without shelling out. All probes are bounded-time
 * (each ≤500 ms in production) so the no-op fast path on a set-up
 * machine completes in ≤2.5 s wall-clock per the rule-#9 measurement.
 *
 * The probe shapes are intentionally minimal: each returns a
 * {@link ComponentState} or {@link ServerState} record. Adding a new
 * field to the shape is a breaking change.
 */
export interface DetectProbes {
  /** `which pipx` → `{ present: true, path }` or `{ present: false, reason }`. */
  readonly probePipx: () => Promise<ComponentState>;
  /** `which mlx_lm.server` (or python -m mlx_lm.server). */
  readonly probeMlxLm: () => Promise<ComponentState>;
  /** `which aider`. */
  readonly probeAider: () => Promise<ComponentState>;
  /**
   * `huggingface-cli scan-cache` (or filesystem stat on the cache dir).
   * Implementations should accept a `modelId` arg in the production
   * wiring; the seam returns whatever the caller threaded through.
   */
  readonly probeModel: () => Promise<ComponentState>;
  /** `which huggingface-cli` — the CLI installed via `pipx install huggingface_hub[cli]`. */
  readonly probeHuggingfaceCli: () => Promise<ComponentState>;
  /** `fetch <url>/v1/models` with a 5 s timeout. */
  readonly probeServer: () => Promise<ServerState>;
}

/**
 * Detect the current state of the local-LLM stack by running the five
 * injected probes in parallel. The probe seams are pure-over-injection:
 * tests pass synthetic functions; production wires
 * `bin/minsky.mjs`-side probes that shell out.
 *
 * Steady-state hypothesis: every legitimate `DetectProbes` input
 * produces a {@link LocalLlmStackState} record with all five components
 * populated. Probe rejections bubble up via `Promise.all` (loud-crash
 * per failure-mode #1 above).
 *
 * @otel tick-loop.local-llm-bootstrap.detect
 */
export async function detectLocalLlmStack(probes: DetectProbes): Promise<LocalLlmStackState> {
  const [pipx, mlxLm, aider, model, huggingfaceCli, server] = await Promise.all([
    probes.probePipx(),
    probes.probeMlxLm(),
    probes.probeAider(),
    probes.probeModel(),
    probes.probeHuggingfaceCli(),
    probes.probeServer(),
  ]);
  return { pipx, mlxLm, aider, model, huggingfaceCli, server };
}

// ---- summarisePlan --------------------------------------------------------

/**
 * Render a plan as a human-readable multi-line string suitable for the
 * confirm prompt. Pure formatter — same input → same output. Used by
 * the executor's confirm-prompt step (slice 2).
 *
 * Format:
 *
 *     The following steps will run:
 *       1. Install pipx (Python isolated-venv manager)
 *       2. Install mlx-lm via pipx (Apple Silicon native ML server)
 *       3. Install aider-chat via pipx ...
 *       4. Download mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit (~17 GB)
 *       5. Start mlx_lm.server in the background ...
 *
 *     Total: ~14 min wall-clock; ~17 GB download.
 *
 * Empty plan returns `"Local-LLM stack already ready — nothing to do."`.
 *
 * @otel-exempt pure formatter; no span.
 */
export function summarisePlan(plan: BootstrapPlan): string {
  if (plan.ready || plan.steps.length === 0) {
    return "Local-LLM stack already ready — nothing to do.";
  }
  const lines: string[] = ["The following steps will run:"];
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (step === undefined) continue;
    lines.push(`  ${i + 1}. ${step.description}`);
  }
  const minutes = Math.ceil(plan.totalEstimatedDurationMs / 60_000);
  const gb = (plan.totalEstimatedDownloadMb / 1024).toFixed(1);
  const downloadStr = plan.totalEstimatedDownloadMb > 0 ? `; ~${gb} GB download` : "";
  lines.push("");
  lines.push(`Total: ~${minutes} min wall-clock${downloadStr}.`);
  return lines.join("\n");
}
