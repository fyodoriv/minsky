# Configuration

Per-machine config at `~/.minsky/config.json`. Edit once, read on every minsky start.

A complete annotated example ships at [`docs/example-config.json`](example-config.json) — copy it to `~/.minsky/config.json` and edit. It is strict JSON (`jq`-parseable); the `_*` keys are documentation-only and ignored by the runner.

## Minimal config

```json
{
  "cloud_agent": "openhands",
  "default_host": "/path/to/your/repo"
}
```

`openhands` is the default since 2026-05-24 — no `cloud_agent` field is required if the operator wants OpenHands behind Claude/OpenAI/Gemini. The legacy `claude` / `devin` / `aider` backends remain valid via explicit setting.

## Full schema

```json
{
  "cloud_agent": "openhands",
  "cloud_agent_model": "claude-sonnet-4-20250514",
  "local_agent": "aider",
  "local_agent_model": "ollama_chat/qwen3-coder:30b",
  "local_agent_args": ["--model", "ollama_chat/qwen3-coder:30b", "--no-auto-commits"],
  "ollama_base_url": "http://localhost:11434",
  "default_host": "/path/to/your/repo"
}
```

| Field | What it controls |
| --- | --- |
| `cloud_agent` | Which agent runs in cloud mode: `openhands` (default since 2026-05-24) / `claude` / `devin` / `aider`. |
| `cloud_agent_model` | Passed as `--model` to the agent. For `openhands`, this is the LiteLLM model id consumed by the SDK (e.g. `claude-sonnet-4-20250514`, `gpt-4o`). |
| `local_agent` | Which CLI runs in local mode: `aider` / `opencode`. |
| `local_agent_model` | Model name for the local agent (passed to the underlying provider). |
| `local_agent_args` | Extra CLI flags passed to the local agent on every invocation. |
| `ollama_base_url` | URL for Ollama (when local agent uses Ollama as the backend). |
| `default_host` | The git repo minsky operates on by default. Override per-invocation with `--host <path>`. |

## OpenHands-specific environment overrides

| Env var | Default | Purpose |
| --- | --- | --- |
| `MINSKY_OPENHANDS_PYTHON` | `python3` | Python binary the daemon spawns. Override if your `python3` isn't 3.10+ or you want to use a specific venv interpreter (e.g. `~/.minsky/openhands-venv/bin/python`). |
| `MINSKY_OPENHANDS_API_KEY_ENV` | `ANTHROPIC_API_KEY` | Env var name the shim reads for the LLM API key. Set to `OPENAI_API_KEY` / `GEMINI_API_KEY` / `OLLAMA_API_KEY` / etc. when using a non-Anthropic model. |
| `MINSKY_OPENHANDS_BASE_URL` | (auto-detected) | LiteLLM endpoint base URL. Auto-detected to `http://localhost:11434` (or `ollama_base_url` in config) when `cloud_agent_model` starts with `ollama_chat/` / `ollama/` / `lm_studio/`. Override for non-default local endpoints or custom proxies. |
| `MINSKY_OPENHANDS_REASONING_EFFORT` | (auto-detected) | OpenHands reasoning-effort knob. Auto-detected to `none` for local models (Ollama / LM Studio) which reject the SDK default `high`. Override (`low` / `medium` / `high` / `xhigh` / `none`) for hybrid setups. |
| `OPENHANDS_SUPPRESS_BANNER` | (unset) | Suppress OpenHands' startup banner in shim stdout. Recommended for `1` in CI/non-interactive contexts. |

## OpenHands with local models (Ollama / LM Studio)

For operators without an Anthropic / OpenAI / Gemini key, set `cloud_agent_model` to a `ollama_chat/<model>` id and Minsky auto-configures the shim for local-model operation:

```json
{
  "cloud_agent": "openhands",
  "cloud_agent_model": "ollama_chat/qwen3-coder:30b",
  "ollama_base_url": "http://localhost:11434"
}
```

Then export the API-key env var with any non-empty value (LiteLLM requires it set, ignores the value for Ollama):

```bash
export OLLAMA_API_KEY="ollama"
export MINSKY_OPENHANDS_API_KEY_ENV=OLLAMA_API_KEY
minsky
```

The daemon auto-detects the local model from the prefix and threads `--base-url` + `--reasoning-effort=none` + `--no-extended-thinking` to the shim. Verified end-to-end on 2026-05-24 against `qwen3-coder:30b` (the same model Minsky's legacy `aider` local agent uses). Tool-call reliability degrades below ~8B params — use `qwen3-coder:30b` or larger for production work.

## Local-LLM fallback keys (`local_llm_enabled`, `local_llm.*`)

Distinct from the `local_agent` / `cloud_agent_model: "ollama_chat/…"` paths above, the `local_llm_*` keys express a **declarative local-LLM-fallback preference** that `bin/minsky-run.sh` reads directly. Setting `local_llm_enabled: true` routes every iteration through the operator's local OpenAI-compatible endpoint (Ollama / LM Studio / MLX) with **zero env-var ceremony** — the operator's complete preference fits in one editable file.

```json
{
  "cloud_agent": "devin",
  "local_llm_enabled": true,
  "local_llm": {
    "model": "ollama_chat/qwen3-coder:30b",
    "base_url": "http://localhost:11434"
  },
  "openhands": { "model": "claude-opus-4-7" }
}
```

| Key | Default (as read in `bin/minsky-run.sh`) | What it controls |
| --- | --- | --- |
| `local_llm_enabled` | `false` | When `true`, every iteration uses the local backend instead of `cloud_agent`. Read at `jq -r '.local_llm_enabled // false'`. |
| `local_llm.model` | `ollama_chat/qwen3-coder:30b` | LiteLLM model id for the local backend (`ollama_chat/<name>` for Ollama, `lm_studio/<name>` for LM Studio). Read at `jq -r '.local_llm.model // "…"'`. |
| `local_llm.base_url` | `http://localhost:11434` | Base URL of the local OpenAI-compatible server (Ollama `:11434`, LM Studio `:1234`). Read at `jq -r '.local_llm.base_url // "…"'`. |
| `cloud_agent` | `openhands` | Which agent runs when `local_llm_enabled` is `false`. Read at `jq -r '.cloud_agent // "openhands"'`. |
| `openhands.model` | `claude-opus-4-7` | OpenHands LiteLLM model id when `cloud_agent: "openhands"` and not in local mode. Read at `jq -r '.openhands.model // "claude-opus-4-7"'`. |

**Env override (wins per-run).** `MINSKY_LOCAL_LLM=1` forces `local_llm_enabled` on for one invocation without editing the file (escape hatch); the config value is the persistent default. This mirrors the resolution order at the top of this file: env var > `~/.minsky/config.json` > built-in default.

**Verify the file is honored — no agent spawn.** A dry-run resolves and prints which provider the next iteration would use, before any host walk:

```bash
MINSKY_CONFIG=~/.minsky/config.json DRY_RUN=1 bin/minsky-run.sh --once --dry-run
# config: local_llm=on model=ollama_chat/qwen3-coder:30b base-url=http://localhost:11434 (from …/config.json) [dry-run]
```

With no `--host` / `--hosts-dir`, the dry-run is a pure config-resolution preview (exit 0, no spawn). With a host, it falls through to the normal per-host `planned`-verdict dry-run.

For the full local-model setup walkthrough (warming, keep-alive, tool-call reliability), see [docs/local-llm-fallback.md](local-llm-fallback.md).

## Agent comparison

| Agent | Mode | How brief is sent | Strengths | Recommended for |
| --- | --- | --- | --- | --- |
| `openhands` | Cloud (OpenHands SDK + LLM of choice via litellm) | `--brief-file` (via Python shim) | 65.8% SWE-bench Verified inherited; critic + best-of-N agent loop; LLM-agnostic; AgentSkills-spec compat with Claude Code skills | **Default cloud workload since 2026-05-24** |
| `claude` | Cloud (Anthropic subscription) | stdin | Highest single-shot completion rate; OAuth / keychain auth | Opt-in fallback when OpenHands SDK unavailable |
| `devin` | Cloud (Windsurf subscription) | `--prompt-file` (stdin panics) | Polished IDE-style PR output | Opt-in fallback when openhands rate-limited |
| `aider` | Local (Ollama / MLX) | `--message-file` | $0 cost, runs on M-series Mac | Token-budget fallback; long sessions |
| `opencode` | Local (LM Studio / Ollama) | stdin | Faster cold-start than aider | Mechanical lint fixes |

## Switching agents

| Scope | Mechanism |
| --- | --- |
| One run | `MINSKY_CLOUD_AGENT=devin minsky` |
| Persistent | Edit `cloud_agent` in `~/.minsky/config.json` |
| Auto-fallback (cloud → local) | Detected automatically when the cloud agent returns "quota exceeded" (see [user-stories/004-budget-auto-pause.md](../user-stories/004-budget-auto-pause.md) and [user-stories/008-per-task-backend-and-personas.md](../user-stories/008-per-task-backend-and-personas.md)) |

Full mid-run swap-and-swap-back is in flight as P0 `runtime-token-limit-auto-pivot-local-and-back`.

## Environment-variable overrides

Per-invocation overrides via env var. See [docs/cli-reference.md](cli-reference.md#environment-variables) for the full index.

## Telemetry consent

The optional consent record at `~/.minsky/telemetry-consent.json` carries:

```json
{
  "consent": true,
  "timestamp": "2026-05-20T13:30:00Z",
  "host_path_hash": "<sha256-with-per-machine-salt>",
  "agent": "claude-code"
}
```

Recorded by the `minsky consent` CLI (P0 in flight). See [INSTALL.md](./INSTALL.md) step 5 for the consent prompt and what's submitted.

## Multiple hosts

Two ways:

1. **One host at a time, swap per-invocation**: `minsky --host /path/to/other-repo` overrides `default_host`.
2. **Multi-host fleet mode**: `minsky --hosts-dir <parent>` walks every git repo under `<parent>` in round-robin (3 iterations per host per pass). Useful when you want one daemon running across several projects.

### Auto-start plist picks multi-host automatically

`minsky install-daemon` (the launchd auto-start agent at `~/Library/LaunchAgents/com.minsky.daemon.plist`) inspects the parent directory of `default_host`. When **≥2 bootstrapped hosts** (each carrying a `.minsky/repo.yaml` sidecar) live under that parent, the generated plist uses `--hosts-dir <parent>` so the daemon visits all of them — a second bootstrapped sibling (e.g. `agentbrew` next to `minsky`) is never silently skipped. With 0 or 1 bootstrapped sibling it keeps the explicit single-host form. Set `MINSKY_MULTI_HOST=0` before `install-daemon` to force single-host even when more exist (escape hatch). Preview the generated plist without reloading launchd via `minsky install-daemon --print`.

`minsky doctor` surfaces the mismatch: if a live plist still targets a single `--host` while ≥2 bootstrapped hosts exist under its parent, it prints `WARN multi-host` with the one-command fix (`minsky install-daemon`).

## Edge cases

- **No config file.** `minsky` runs with built-in defaults (claude / claude-opus-4-7-max / cwd as host). Edit `~/.minsky/config.json` to customize.
- **Invalid JSON.** `minsky doctor` reports the parse error with the line number; the daemon refuses to start until fixed.
- **`default_host` points at a non-existent path.** Doctor reports it; daemon falls back to cwd with a warning.
- **Stale model name (e.g., a model the provider retired).** The agent's first probe fails with a clear error from the provider; minsky surfaces it in the daemon log.
