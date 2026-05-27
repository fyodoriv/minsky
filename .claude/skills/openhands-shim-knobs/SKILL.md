---
name: openhands-shim-knobs
description: Documents the exact knob combination on the `minsky-openhands-spawn.py` shim — `--base-url`, `--api-key-env`, `--no-extended-thinking`, `--reasoning-effort`, `--model` — and which ones must be set together for each provider class (Anthropic cloud, OpenAI cloud, ollama local, LM Studio local). Use when configuring the local-LLM path, debugging spawn-failed verdicts with API-key / does-not-support-thinking / ModuleNotFoundError stderr, or adding a new provider to `bin/minsky-run.sh`.
allowed-tools: Read, Edit, Bash
---

# OpenHands shim knob constellation

The `novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py` shim wraps the OpenHands SDK behind a CLI. The flags interact — getting one wrong silently breaks the run. This skill pins which constellation works for each provider class.

## The five knobs

| Flag | What it does | Default |
|---|---|---|
| `--model` | LiteLLM model id (e.g. `claude-sonnet-4-20250514`, `ollama_chat/qwen3-coder:30b`) | required |
| `--base-url` | LiteLLM endpoint override. Required for ollama / LM Studio / vLLM | None |
| `--api-key-env` | Env var holding the API key. Skipped when `--base-url` is set | `ANTHROPIC_API_KEY` |
| `--no-extended-thinking` | Sets `extended_thinking_budget=None` (OpenHands default is 200000) | off (= 200000 budget) |
| `--reasoning-effort` | One of `none\|low\|medium\|high\|xhigh`. Set to `none` for non-thinking providers | None (= OpenHands default `high`) |

## Provider class → required knobs

### Anthropic Claude cloud (current production default)

```
--model claude-opus-4-7
--api-key-env ANTHROPIC_API_KEY    # env var must be exported in launchd context
# DO NOT pass --no-extended-thinking or --reasoning-effort — Claude supports both
```

### OpenAI cloud (e.g. gpt-4-turbo)

```
--model gpt-4-turbo
--api-key-env OPENAI_API_KEY
# DO NOT pass --no-extended-thinking or --reasoning-effort — OpenAI supports reasoning
```

### Ollama local (non-thinking — the load-bearing case)

```
--model ollama_chat/qwen3-coder:30b
--base-url http://localhost:11434
--no-extended-thinking
--reasoning-effort none
# api-key-env is a no-op when --base-url is set; shim auto-bypasses the check
```

Both `--no-extended-thinking` AND `--reasoning-effort none` are REQUIRED. Omit either and ollama rejects the request with `{"error":"\"qwen3-coder:30b\" does not support thinking"}` after 4 retries.

### LM Studio local

Same shape as Ollama — `--base-url http://localhost:1234`, both thinking flags off.

## How `bin/minsky-run.sh` wires these

When `~/.minsky/config.json` has `local_llm_enabled: true`:

```bash
extra_spawn_flags="--base-url $local_base_url --no-extended-thinking --reasoning-effort none"
```

All three flags ship together. Removing any one silently breaks local-LLM iterations.

## Symptoms → diagnostic table

| Symptom (exit code + stderr tail) | Likely cause | Fix |
|---|---|---|
| `exit 64; tail: missing API key: env var 'ANTHROPIC_API_KEY' is unset` | API key bypass not active — either `--base-url` not set OR the shim doesn't have the bypass code | Set `--base-url` to a local endpoint, or `launchctl setenv ANTHROPIC_API_KEY sk-...` |
| `exit 1; tail: ModuleNotFoundError: No module named 'openhands'` | Wrong python — bare `python3` from launchd PATH doesn't have the openhands venv | Use `~/.minsky/openhands-venv/bin/python` (resolved by `resolve_openhands_python` in `bin/minsky-run.sh`) |
| `exit 1; tail: ConversationRunError ... does not support thinking` | `--reasoning-effort none` not passed alongside `--no-extended-thinking` | Add the missing flag (PR #899 was this) |
| `exit 0; verdict=no-progress; agent did one tool call and quit` | Model under-engaged (qwen3-coder:30b pattern) — emitted `Let me examine X` as prose, SDK terminated | Brief now carries TOOL-CALL DISCIPLINE block (#901) — verify it's present in the rendered brief |

## Source citations

- Shim implementation: `novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py` lines 121-168 (`_build_agent`)
- Runner wiring: `bin/minsky-run.sh` lines 576-595 (`local_llm_enabled` block)
- PR history that taught these lessons: #897 (API key bypass) → #898 (venv python) → #899 (reasoning_effort) → #900 (no-progress verdict) → #901 (TOOL-CALL DISCIPLINE in brief)
