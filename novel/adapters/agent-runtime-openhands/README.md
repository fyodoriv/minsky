<!-- scope: human-approved 2026-05-24 operator directive "Let's work on completely integrating with openhands today" — Path C reshape phase 1 -->

# @minsky/agent-runtime-openhands

> OpenHands agent-runtime adapter — TS-side spawn-config builder + Python SDK shim. Replaces direct Claude / Devin / Aider CLI adapters per the operator's 2026-05-22 Path C reshape directive. **OpenHands is Minsky's canonical agent runtime as of 2026-05-24.**

## Why this exists

Per the canonical [Path C plan](../../../docs/plans/2026-05-22-path-c-openhands-reshape.md) and the operator's 2026-05-22 directive, Minsky's agent layer collapses from "maintain N direct CLI adapters" (claude, devin, aider) to "delegate to OpenHands' agent runtime." This package is the substrate that landing makes that real today, without waiting for the [June-1-2026 Agent Canvas Initiative CLI](https://github.com/OpenHands/OpenHands/issues/14374).

## What it ships

- **`bin/minsky-openhands-spawn.py`** — Python shim that runs the OpenHands SDK in-process via `openhands.sdk.Conversation`. Owns the entire SDK contact surface; the Node.js daemon never imports OpenHands directly. This shim is **explicitly throwaway** — when the June-1-2026 stable `openhands solve --task-file X` CLI ships, this file is replaced with a one-line CLI invocation and the TS adapter shape stays the same.
- **`src/spawner.ts`** — TS builder that produces the subprocess invocation envelope (`{ command, argv, stdin, cwd }`) the cross-repo runner spawns. Matches the existing claude / devin / aider builders in [`bin/minsky-run.mjs`](../../cross-repo-runner/bin/minsky-run.mjs).
- **`src/spawner.test.ts`** — unit tests for the spawn-config contract (argv order, brief delivery shape, size guards).

## How it slots in

```text
~/.minsky/config.json  cloud_agent: "openhands"
        |
        v
bin/minsky → minsky-run.mjs
        |
        v
buildAgentConfig() — branches on cloud_agent
        |   (openhands branch)
        v
@minsky/agent-runtime-openhands::buildOpenHandsInvocation
        |
        v
child_process.spawn("python3", ["bin/minsky-openhands-spawn.py",
                                 "--brief-file", "/tmp/...md",
                                 "--model", "claude-sonnet-4-...",
                                 "--repo", "/host/repo",
                                 "--api-key-env", "ANTHROPIC_API_KEY"])
        |
        v
OpenHands SDK Conversation.run() → edits files in /host/repo
        |
        v
Daemon captures `git diff baseline..HEAD` post-spawn → iteration record
```

## Wire shape

The Python shim consumes:

| Flag | Required | Default | Meaning |
|---|---|---|---|
| `--brief-file` | yes | — | Path to the task brief markdown |
| `--model` | yes | — | LiteLLM model id (e.g. `claude-sonnet-4-20250514`) |
| `--repo` | yes | — | Absolute path to the host repo (= OpenHands workspace) |
| `--api-key-env` | no | `ANTHROPIC_API_KEY` | Env var name that holds the LLM API key |
| `--max-iterations` | no | `50` | Reserved; OpenHands SDK does not currently expose this knob |
| `--base-url` | no | (none) | LiteLLM endpoint base URL. Required for Ollama / LM Studio / any local provider (e.g. `http://localhost:11434`). Omit for Anthropic/OpenAI/Gemini cloud endpoints. |
| `--reasoning-effort` | no | (none, lets SDK default) | OpenHands reasoning-effort knob. Set `none` for Ollama and most local models which reject the default `high` with `does-not-support-thinking`. |
| `--no-extended-thinking` | no | off | Flag — set this whenever `--base-url` points at a local endpoint. Disables the SDK's default `extended_thinking_budget=200000` which Ollama rejects with the same `does-not-support-thinking` error. |

### Local-model (Ollama / LM Studio) invocation

For operators without an Anthropic / OpenAI / Gemini key, the shim works against any local OpenAI-compatible endpoint via LiteLLM. The canonical Ollama invocation:

```bash
export OLLAMA_API_KEY="ollama"  # litellm requires the env var to be SET; value is ignored
python3 bin/minsky-openhands-spawn.py \
  --brief-file /tmp/brief.md \
  --model 'ollama_chat/qwen3-coder:30b' \
  --repo /path/to/repo \
  --api-key-env OLLAMA_API_KEY \
  --base-url http://localhost:11434 \
  --reasoning-effort none \
  --no-extended-thinking
```

The cross-repo-runner auto-detects local models from the `ollama_chat/`, `ollama/`, or `lm_studio/` model prefix in `~/.minsky/config.json` `cloud_agent_model` and adds these flags automatically. Operators only need to set `cloud_agent: "openhands"` + `cloud_agent_model: "ollama_chat/qwen3-coder:30b"` for zero-config local-LLM operation.

**Tool-call reliability with local models**: Smaller models (qwen3:0.6b, llama-3.2:1b) often emit malformed tool-call JSON, which OpenHands rejects with `Cannot infer 'command' for tool` and exits via the stuck-detector. Use qwen3-coder:30b or larger for reliable tool calls. The shim's contract test catches malformed argv but tool-call quality is an LLM-tier concern, not a shim concern.

It emits:

- **stdout** — streaming agent transcript (default OpenHands callback) plus a single JSON envelope on the last line:

  ```json
  {"agent":"openhands","sdk_version":"1.19.1","baseline_sha":"abc123…","files_changed":3,"diff_bytes":4821,"ok":true}
  ```

- **stderr** — operator-visible warnings + errors (boundary catch for unexpected SDK exceptions).
- **exit code** — `0` on success, `64` on bad input (EX_USAGE), `1` on agent failure.

## How to run locally

```bash
# 1. Install the OpenHands SDK into a venv on this host
uv venv ~/.minsky/openhands-venv
source ~/.minsky/openhands-venv/bin/activate
uv pip install openhands-ai

# 2. Smoke-test the shim against a fixture repo
mkdir /tmp/openhands-smoke && cd /tmp/openhands-smoke
git init && echo "# fixture" > README.md && git add -A && git commit -m "init"
echo "Add a docs/HELLO.md file with the text 'hello from openhands'." > /tmp/brief.md
ANTHROPIC_API_KEY=sk-... python3 path/to/minsky-openhands-spawn.py \
  --brief-file /tmp/brief.md \
  --model claude-sonnet-4-20250514 \
  --repo /tmp/openhands-smoke
```

## Failure modes & chaos verification

| Failure | Detection | Behaviour | Blast radius | Operator escape hatch | Chaos test |
|---|---|---|---|---|---|
| Python not installed | `spawn` returns ENOENT | `loud-crash-supervisor-restart` — daemon iteration fails with `spawn-failed`; outer launchd supervisor restarts | one iteration | install python3 (≥3.10) via the host's package manager; documented in [INSTALL.md](../../../INSTALL.md) | `test/shim-contract.test.ts` auto-skips when `python3 --version` fails, proving the daemon-side detection point; manual chaos: `PATH=/nonexistent pnpm minsky run <task>` should print `spawn-failed` cleanly |
| OpenHands SDK not installed in venv | shim exits 1 with `ModuleNotFoundError: openhands.sdk` on stderr | `loud-crash-supervisor-restart` | one iteration | `uv pip install openhands-ai` (see "How to run locally") | manual chaos test: `uv pip uninstall openhands-ai && python3 bin/minsky-openhands-spawn.py --brief-file /tmp/b.md --model claude-sonnet-4-20250514 --repo /tmp` — assert exit=1 with `ModuleNotFoundError` on stderr |
| API key env var unset | shim exits 64 with `missing API key` on stderr | `loud-crash-supervisor-restart` — but daemon does NOT retry (EX_USAGE means operator action required) | one iteration | `export ANTHROPIC_API_KEY=…` or set in `~/.minsky/config.json` | `test/shim-contract.test.ts` § "missing API key env var exits 64" |
| Agent runs but doesn't edit any file | shim exits 0; envelope reports `files_changed: 0` | `graceful-degrade` — daemon records an empty iteration and moves to next task | one iteration | inspect the brief; the task may be ambiguous (rule-#3 acceptance-scenario gate) | manual chaos test: brief = "do nothing" — assert exit=0 with `files_changed: 0` in the envelope |
| Agent edits files but doesn't commit | daemon's post-spawn `git diff HEAD` captures the uncommitted edits | `graceful-degrade` — daemon's PR-creation step commits + opens the draft PR | none | this is the expected flow; the agent is not required to commit | covered by the existing daemon-side `git diff HEAD` integration test in `test/integration/runtime-paths-coverage.test.ts` |
| Brief exceeds 1 MB | TS builder throws `RangeError` BEFORE spawning | `circuit-break-and-notify` — iteration aborted at the boundary; never reaches the agent | none | re-run `/task-slice` to split the task | `src/spawner.test.ts` § "rejects briefs longer than 1 MB" |

## Threat model

Per constitutional rule #13 (vision.md § 13.8). Methodology: STRIDE (Howard & LeBlanc 2003 — Spoofing / Tampering / Repudiation / Information-disclosure / Denial-of-service / Elevation-of-privilege).

**Performance-first carve-out** (vision.md § 13 relief-valve clause): **none declared.** The Python shim adapter does not exchange security for performance — there is no TLS-disabled, sandbox-relaxed, or PII-permissive code path in this package.

**What's untrusted**

- The task brief contents (could carry prompt-injection payload from a TASKS.md PR by an external contributor — though Minsky's `pr-pre-pr-lint` chain blocks merges from outside contributors before reaching the daemon)
- The OpenHands SDK itself (third-party PyPI package; supply-chain risk per rule #13 row 5)
- The LLM provider's response (could attempt to exfiltrate via shell commands — bounded by the host repo's filesystem only; the OpenHands `terminal` tool runs in the host shell with the operator's full privileges)

**What's trusted**

- The Python shim itself (this repo, code-reviewed under the rule-#10 lint stack)
- The TS spawn-config builder (this repo, unit-tested)
- The operator's API key env var (set out-of-band by the operator; the shim only reads the named env var, never logs or echoes it)
- `~/.minsky/config.json` (operator-owned)

**Trust boundary**

The boundary is the `spawn` call in `bin/minsky-run.mjs` — everything ABOVE (config resolution, agent matrix, runtime invariants, brief assembly) runs as Minsky-trusted code; everything BELOW (Python shim, OpenHands SDK, LLM API, agent tool calls) runs as untrusted-but-sandboxed code that can only modify files inside the host repo (Minsky's outer-loop scope-leak lint catches edits outside `<host>/.minsky/**` and aborts the iteration).

The biggest residual risk is **agent tool calls executing arbitrary shell commands** via OpenHands' `TerminalTool`. This is the same risk class as the existing Claude Code / Devin spawn paths — Minsky's host-isolation is provided by the `runtime-invariants` chain (`git tree clean before spawn` + `scope-leak detection after spawn`), not by sandbox virtualisation. A future hardening is filed as [`agent-runtime-sandbox-isolation`](../../../TASKS.md) — running the shim inside a Docker container or under macOS App Sandbox / Linux seccomp.

**Secret hygiene**

- The shim NEVER logs the API key (only the env var name is logged; the value is read once and passed to `openhands.sdk.LLM`).
- The brief file is written to a fresh `mkdtemp` directory (`minsky-openhands-` prefix) under `os.tmpdir()`; not deleted automatically (the iteration record may want to attach it) — operators relying on auto-cleanup should run `find $TMPDIR -name "minsky-openhands-*" -mtime +7 -exec rm -rf {} \;` in a daily cron.
- No PII can land in the brief that wouldn't already land in the existing claude/devin path; this adapter is shape-compatible.

## Migration path (June-1-2026)

When OpenHands' Agent Canvas Initiative CLI ships:

1. Replace the Python shim with a one-line subprocess call to `openhands solve --task-file <brief> --model <model> --repo <repo> --print`.
2. Keep the TS adapter shape — `buildOpenHandsInvocation` still returns the same envelope; only the `command` switches from `python3 ...minsky-openhands-spawn.py ...` to `openhands solve ...`.
3. Delete the Python shim file + the `openhands-ai` Python dependency from `INSTALL.md`.

The TS adapter's tests stay green because they assert the argv contract abstractly (--brief-file, --model, --repo, --api-key-env appearing in order) — not the specific binary.

## See also

- [`docs/plans/2026-05-22-path-c-openhands-reshape.md`](../../../docs/plans/2026-05-22-path-c-openhands-reshape.md) — full reshape plan
- [`competitors/openhands.md`](../../../competitors/openhands.md) — relationship: dependency (in-progress adoption)
- [`novel/cross-repo-runner/src/agent-config.ts`](../../cross-repo-runner/src/agent-config.ts) — AGENT_MATRIX with the `openhands` row
- [`MILESTONES.md`](../../../MILESTONES.md) M1.14 — "OpenHands as the canonical agent runtime"
