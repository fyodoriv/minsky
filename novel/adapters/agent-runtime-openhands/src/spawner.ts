// <!-- scope: human-approved 2026-05-24 operator directive "Let's work on completely integrating with openhands today" — Path C reshape phase 1 -->
// <!-- pattern: not-applicable — instance of the Adapter pattern row already in vision.md § "Pattern conformance index" row 3 (`novel/adapters/`); this file is one concrete implementation under that umbrella, not a new pattern -->
// OpenHands agent-runtime spawn-config builder (rule-#2 adapter).
//
// This module is the TS half of Minsky's OpenHands runtime adapter.
// Given a task brief, a host repo path, and a model name, it produces
// the exact subprocess invocation the cross-repo runner will execute
// to spawn the Python shim. The shim itself lives at
// `bin/minsky-openhands-spawn.py` in this package.
//
// Wire shape matches the existing claude / devin / aider builders in
// `novel/cross-repo-runner/bin/minsky-run.mjs` § `buildAgentConfig`:
// the caller receives `{ command, argv, stdin, cwd }` and spawns it
// directly via `child_process.spawn`. No long-lived state, no shared
// resources between calls — each task gets its own subprocess.
//
// Pattern: Adapter (Gamma 1994) + Strategy (each agent's spawner is a
// row in the agent-config matrix). The Python shim is the bridge to
// the OpenHands SDK (V1, Python-only); the TS side never imports the
// SDK directly — that keeps Minsky's Node.js daemon polyglot-free at
// the JS layer.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Inputs the daemon supplies when spawning an OpenHands iteration.
 */
export interface OpenHandsSpawnInput {
  /** The task brief markdown that will be sent to the agent as its first message. */
  brief: string;
  /** Absolute path to the host repo. Becomes the OpenHands workspace. */
  repoRoot: string;
  /** LiteLLM model id (e.g. "claude-sonnet-4-20250514"). Forwarded as `--model`. */
  model: string;
  /** Env var name that holds the LLM API key. Default "ANTHROPIC_API_KEY". */
  apiKeyEnv?: string;
  /** Absolute path to the Python shim. Default resolves to bin/minsky-openhands-spawn.py. */
  shimPath?: string;
  /** Python binary to invoke. Default "python3"; operator may override via env. */
  pythonBin?: string;
  /**
   * Optional LiteLLM endpoint base URL. Required for Ollama / LM Studio
   * / any non-default provider, e.g. `http://localhost:11434` for any
   * `ollama_chat/<model>` id. Omit for Anthropic/OpenAI/Gemini cloud
   * endpoints where LiteLLM resolves the URL from the provider prefix.
   */
  baseUrl?: string;
  /**
   * Optional OpenHands reasoning-effort knob. Set `"none"` for non-
   * thinking providers (Ollama, LM Studio, most local models) which
   * reject the default `"high"` with `does-not-support-thinking`. Omit
   * for Anthropic/OpenAI/Gemini which support thinking natively.
   */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  /**
   * Optional disable-extended-thinking flag. Required `true` for Ollama
   * / LM Studio / any non-thinking provider — OpenHands defaults to
   * `extended_thinking_budget=200000` which Ollama rejects with the
   * same `does-not-support-thinking` error. Has no effect when the
   * provider supports thinking; safe to set whenever `baseUrl` points
   * at a local endpoint.
   */
  disableExtendedThinking?: boolean;
}

/**
 * The subprocess invocation the cross-repo runner will execute. Shape
 * matches the existing claude/devin invocation envelope so the spawn
 * site stays uniform across agents.
 */
export interface OpenHandsInvocation {
  /** Python binary (or operator override). */
  command: string;
  /** Full argv including the shim script as argv[0]. */
  argv: string[];
  /** Always undefined — OpenHands receives the brief via --brief-file, not stdin. */
  stdin: undefined;
  /** Working directory for the subprocess (= host repo root). */
  cwd: string;
  /** Path to the temp brief file (caller may unlink it after spawn ends). */
  briefFilePath: string;
}

const MAX_BRIEF_BYTES = 1024 * 1024;

/**
 * Build the OpenHands subprocess invocation for one iteration.
 *
 * Side effect: writes `brief` to a fresh temp file (`mkdtempSync` per
 * call). The TS caller is responsible for cleanup after the subprocess
 * exits — see `bin/minsky-run.mjs` for the existing devin/aider
 * cleanup pattern (the temp dir lives for the daemon's lifetime; per-
 * task files are not deleted because the iteration record may want
 * to attach them).
 *
 * @otel-exempt pure builder over inputs + one mkdtempSync; the spawn
 *   site (`bin/minsky-run.mjs`) is the OTEL boundary that records
 *   spawn duration, exit code, and agent id under `minsky.spawn.*`.
 *   Instrumenting this builder would double-count the same span.
 *
 * @throws RangeError when the brief is empty or exceeds 1 MB.
 */
export function buildOpenHandsInvocation(input: OpenHandsSpawnInput): OpenHandsInvocation {
  if (input.brief.trim() === "") {
    throw new RangeError("OpenHands spawn: brief is empty — the agent has no work to do.");
  }
  if (input.brief.length > MAX_BRIEF_BYTES) {
    throw new RangeError(
      `OpenHands spawn: brief exceeds 1 MB (${input.brief.length} bytes). Briefs this large blow out the agent's context window and indicate a task decomposition gap — split via /task-slice before retrying.`,
    );
  }

  const promptDir = mkdtempSync(join(tmpdir(), "minsky-openhands-"));
  const briefFilePath = join(promptDir, "brief.md");
  writeFileSync(briefFilePath, input.brief, "utf8");

  const shimPath = input.shimPath ?? resolveShimPath();
  const pythonBin = input.pythonBin ?? "python3";
  const apiKeyEnv = input.apiKeyEnv ?? "ANTHROPIC_API_KEY";

  const argv = [
    shimPath,
    "--brief-file",
    briefFilePath,
    "--model",
    input.model,
    "--repo",
    input.repoRoot,
    "--api-key-env",
    apiKeyEnv,
  ];
  if (input.baseUrl !== undefined) {
    argv.push("--base-url", input.baseUrl);
  }
  if (input.reasoningEffort !== undefined) {
    argv.push("--reasoning-effort", input.reasoningEffort);
  }
  if (input.disableExtendedThinking === true) {
    argv.push("--no-extended-thinking");
  }

  return {
    command: pythonBin,
    argv,
    stdin: undefined,
    cwd: input.repoRoot,
    briefFilePath,
  };
}

/**
 * Resolve the absolute path to `bin/minsky-openhands-spawn.py` based
 * on this module's own location. Works whether the package is loaded
 * from `dist/` (built) or `src/` (vitest) because the path is relative
 * to the import-meta URL.
 *
 * @otel-exempt pure path resolution, no I/O, deterministic.
 */
export function resolveShimPath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // From dist/spawner.js OR src/spawner.ts, climb to package root, then bin/.
  return resolve(thisDir, "..", "bin", "minsky-openhands-spawn.py");
}
