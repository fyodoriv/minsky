# Configuration

Per-machine config at `~/.minsky/config.json`. Edit once, read on every minsky start.

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
| `MINSKY_OPENHANDS_API_KEY_ENV` | `ANTHROPIC_API_KEY` | Env var name the shim reads for the LLM API key. Set to `OPENAI_API_KEY` / `GEMINI_API_KEY` / etc. when using a non-Anthropic model. |
| `OPENHANDS_SUPPRESS_BANNER` | (unset) | Suppress OpenHands' startup banner in shim stdout. Recommended for `1` in CI/non-interactive contexts. |

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

## Edge cases

- **No config file.** `minsky` runs with built-in defaults (claude / claude-opus-4-7-max / cwd as host). Edit `~/.minsky/config.json` to customize.
- **Invalid JSON.** `minsky doctor` reports the parse error with the line number; the daemon refuses to start until fixed.
- **`default_host` points at a non-existent path.** Doctor reports it; daemon falls back to cwd with a warning.
- **Stale model name (e.g., a model the provider retired).** The agent's first probe fails with a clear error from the provider; minsky surfaces it in the daemon log.
