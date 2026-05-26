# INSTALL.md — agent-mediated install runbook

> Step-by-step runbook for an AI agent installing Minsky on behalf of a human operator.

**Time**: ~5 minutes if prerequisites are already installed; ~15 minutes if not.

**For a human reading this directly**: this runbook is written for an AI agent to follow, but every command works manually too. Run them in order, stop at Step 5 to give consent, then continue.

## What this is

The canonical install runbook for Minsky. **Audience**: an AI coding agent (Claude Code, Devin, Cursor, Windsurf, Codex CLI, or any agent that can read files and run shell commands) acting on behalf of a human operator who said something like *"install minsky for this folder and start it"*. Follow it step by step. Ask the operator a question ONLY at the explicit consent-prompt step (Step 5) — every other step is yours to execute autonomously.

**Where to read next after installing**:

- [docs/configuration.md](docs/configuration.md) — `~/.minsky/config.json`, agent comparison
- [docs/cli-reference.md](docs/cli-reference.md) — every `minsky` subcommand
- [docs/uninstall.md](docs/uninstall.md) — clean removal when you're done
- [README.md](README.md) for context on what you just installed

**Status.** The end-to-end flow below works today. The `minsky consent --yes / --no` subcommand exists (Step 5 is a single CLI call) and the measurement harness `scripts/measure-agent-install.mjs` is wired into `pre-pr-lint --stage=full` (so the harness machinery is CI-gated). The remaining gap to fully close the parent `agent-mediated-install` P0 is live-mode for real-agent invocation against claude-code / devin / cursor — tracked as P2 `measure-agent-install-live-mode`. Until it ships, the 9-run success criterion is operator-verified end-to-end; the CI gate enforces threshold semantics and harness shape via mock mode.

## Step 0 — what "install" means (read first)

Two invariants you, the installing agent, must honor:

1. **You are a doorway, not a runtime.** After you finish this runbook, you are *out of the picture*. The daemon you started runs on the operator's machine and operates independently. Whatever chat window invoked you — Claude Code, Cursor, Devin, Windsurf, Codex, Aider, or a local model talking to one of them — must produce **byte-identical runtime behavior** afterwards. Do not write launcher-specific config. Do not branch on `process.env.CLAUDE_CODE` / `CURSOR` / `DEVIN_AGENT` / `CODEX` / etc. on the way through. Do not seed `~/.minsky/config.json` with anything that varies by launcher. The only field that may record which launcher you were is `agent` inside `~/.minsky/telemetry-consent.json` (telemetry-only — never re-read by runtime code). See [`user-stories/014-launcher-agnostic-feature-parity.md`](user-stories/014-launcher-agnostic-feature-parity.md) for the full invariant.

2. **A cloud API key is NOT required.** Minsky's default runtime is local — Ollama / LM Studio / MLX. The default config you write in Step 4 sets `cloud_agent: "openhands"` + `cloud_agent_model: "ollama_chat/qwen3-coder:30b"` + `ollama_base_url: "http://localhost:11434"`. If the operator has no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` in their environment, that is **not a blocker** — proceed to Step 5 (consent) and Step 6 (daemon start) without prompting. The operator's directive (recorded in [`user-stories/015-local-models-until-stable.md`](user-stories/015-local-models-until-stable.md)) is: rely on local models until the M1.1 stability gate trips at 90% clean-exit fraction. Cloud-key opt-in is a documented post-install edit, not an install-time prompt.

## What this is not

- **Not the user-facing readme** — see [README.md](./README.md) for what Minsky does and why.
- **Not the architecture doc** — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the wiring.
- **Not a troubleshooting guide for a running daemon** — see [docs/PRACTICES.md](./docs/PRACTICES.md) and `minsky doctor` once installed.
- **Not a release-notes doc** — see [CHANGELOG.md](./CHANGELOG.md).

## What you're installing

Minsky is a background daemon that runs AI coding agents against tasks in any git repo. It picks the highest-priority task with complete rule-9 fields from `TASKS.md`, spawns an AI agent to work on it, opens a PR, records the iteration, then picks the next task. By default it runs until the operator stops it.

## Step 1 — verify prerequisites

Run each line and check the output:

```bash
node --version    # must be ≥ v22 — Minsky requires modern Node
pnpm --version    # must be ≥ 9; if missing run: corepack enable pnpm
git --version     # must be ≥ 2.40
python3 --version # must be ≥ 3.10 — required for the OpenHands agent runtime (default since 2026-05-24)
```

If any prerequisite is missing or too old, tell the operator the exact missing piece and the install command for their OS (Homebrew on macOS, apt on Debian/Ubuntu), then STOP. Do not auto-install Node or pnpm without permission — that's the operator's machine, not yours.

**Why Python 3.10+ is required**: Minsky's default agent runtime is OpenHands (per the operator's 2026-05-22 Path C reshape directive). Today's OpenHands ships as a Python SDK; Minsky's adapter ([`@minsky/agent-runtime-openhands`](novel/adapters/agent-runtime-openhands/README.md)) spawns it via a tiny Python shim. From `2026-06-01` (OpenHands' Agent Canvas Initiative CLI release) the shim is replaced with a direct CLI invocation and the Python dep can move from required to optional. Until then, Python is required if the operator uses the default `cloud_agent: "openhands"`. Operators can fall back to `cloud_agent: "claude"` / `"devin"` / `"aider"` (no Python required) by editing `~/.minsky/config.json` after Step 4.

## Step 1.5 — install the OpenHands SDK (automatic during `pnpm minsky:setup`)

**Updated 2026-05-26 — operator directive "install openhands always".** Step 1.5 used to be a manual command; `pnpm minsky:setup` (Step 6 below) now does it automatically as part of the supervisor bootstrap. Skip ahead to Step 2.

For reference / debugging only — the equivalent manual command (what `pnpm minsky:setup` runs internally):

```bash
# Install uv if not present
python3 -m pip install --user uv 2>/dev/null || true

# Create the venv at ~/.minsky/openhands-venv
uv venv ~/.minsky/openhands-venv

# Idempotent install of the SDK into the venv
uv pip install --python ~/.minsky/openhands-venv/bin/python openhands-ai

# Verify the import works (suppress the SDK banner)
OPENHANDS_SUPPRESS_BANNER=1 ~/.minsky/openhands-venv/bin/python -c "from openhands.sdk import Agent, LLM, Conversation; print('openhands-ai ready')"
```

The operator must export their LLM API key (default: `ANTHROPIC_API_KEY`) in their shell rc before the daemon spawns its first task. If they use a different provider (OpenAI, Gemini, etc.), set `MINSKY_OPENHANDS_API_KEY_ENV=OPENAI_API_KEY` (or equivalent) in `~/.minsky/config.json`.

If `pnpm minsky:setup` reports `⚠ uv not on PATH` (graceful-degrade — supervisor still loads), install `uv` first (`brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`), then re-run `pnpm minsky:setup`. Operators using a non-openhands backend (`cloud_agent: "claude" | "devin" | "aider"`) can ignore the openhands SDK entirely.

## Step 2 — record the current host

The operator wants Minsky to manage the folder they were in when they asked you to install it. That folder is the "host". Capture its absolute path NOW, before changing directories:

```bash
HOST_PATH=$(pwd)
echo "Will register host: $HOST_PATH"
```

Confirm this is a git repo:

```bash
git -C "$HOST_PATH" rev-parse --show-toplevel
```

If the command errors, the operator's current folder isn't a git repo. Ask: "Minsky operates on git repos. The current folder isn't tracked by git. Should I (a) `git init` it, (b) cd to a parent folder that is a repo, or (c) abort the install?" — then act on their reply.

## Step 3 — clone and install minsky

Pick an install location. The default is `$HOME/minsky`; if the operator has a different convention (e.g., `~/code/minsky`, `~/src/minsky`), follow it. Record your choice in the `INSTALL_DIR` shell variable so the rest of the runbook stays consistent:

```bash
INSTALL_DIR="${INSTALL_DIR:-$HOME/minsky}"
mkdir -p "$(dirname "$INSTALL_DIR")"
[ -d "$INSTALL_DIR" ] || git clone https://github.com/fyodoriv/minsky.git "$INSTALL_DIR"
cd "$INSTALL_DIR"
pnpm install
```

Add Minsky's `bin/` to the operator's shell PATH. Detect their shell:

```bash
case "$SHELL" in
  */zsh)   RC=~/.zshrc ;;
  */bash)  RC=~/.bashrc ;;
  */fish)  RC=~/.config/fish/config.fish ;;
  *)       RC=~/.profile ;;
esac

LINE="export PATH=\"$INSTALL_DIR/bin:\$PATH\""
grep -qF "$LINE" "$RC" 2>/dev/null || echo "$LINE" >> "$RC"
```

Tell the operator: "I added Minsky to your PATH in `$RC`. New shells will pick it up automatically; for the current shell I'll use the absolute path."

## Step 4 — register the host in `~/.minsky/config.json`

```bash
mkdir -p ~/.minsky

# Detect which agent backend you (the installer agent) are
AGENT="${MINSKY_AGENT_BACKEND:-claude}"  # honour env if set; default to claude

cat > ~/.minsky/config.json <<EOF
{
  "default_host": "$HOST_PATH",
  "agent": "$AGENT",
  "model": "sonnet-4"
}
EOF
```

Pick the `agent` value matching the AI agent that's running you right now: `claude` if you're Claude Code, `devin` if you're Devin, `cursor` if you're inside Cursor, `aider` if you're Aider with a local Ollama model, etc. The operator can change it later; default to `claude` if unsure.

## Step 5 — telemetry consent (the one human prompt)

This is the ONE place you must pause and ask the operator. Read this prompt to them VERBATIM (do not paraphrase):

> Minsky can submit anonymized runtime logs — iteration counts, error verdicts, and p95 timings — to help catch regressions and improve the daemon. No code content, no task content, and no personally identifying information is ever sent; the host path is SHA-256-hashed with a per-machine salt before submission. The data goes only to the Minsky project's consent ledger. Do you agree to submit these anonymized telemetry events? (yes / no — default: no if you don't answer)

Wait for the answer. Then record it with one command:

```bash
# Replace --yes with --no if the operator declined.
MINSKY_AGENT="$AGENT" "$INSTALL_DIR/bin/minsky" consent --yes
```

That single call:

- creates `~/.minsky/machine-salt` (32 random bytes, base64) on first run, reuses it after
- writes `~/.minsky/telemetry-consent.json` atomically (tmp + rename) with the 4 documented fields (`consent` / `timestamp` / `host_path_hash` / `agent`)
- POSTs the same payload to `MINSKY_TELEMETRY_ENDPOINT` when set (best-effort, never blocks the install)

If `minsky` isn't yet on PATH for the current shell, use the explicit `$INSTALL_DIR/bin/minsky` form (as shown above) — Step 3 already set the absolute path in your shell variable.

## Step 6 — start the daemon

```bash
cd "$HOST_PATH"
"$INSTALL_DIR/bin/minsky"
```

The first invocation:

- installs a launchd persistence agent so Minsky survives reboots (macOS) — on Linux it installs a systemd-user unit instead
- creates `.minsky/` in the host repo (gitignored sidecar for iteration history)
- drops you into the live dashboard

Wait up to 60 seconds and confirm an iteration has started by checking for either an "iteration #1" line in `~/.minsky/daemon.log` OR the dashboard showing a non-zero iteration count.

```bash
tail -50 ~/.minsky/daemon.log | grep -E 'iteration #|verdict=' | head -5
```

## Step 7 — confirm to the operator

Tell the operator, in this exact format (substitute the bracketed values):

```text
Minsky install complete.

  Location:       <INSTALL_DIR>
  Host:           <HOST_PATH>
  Agent backend:  <AGENT>
  Telemetry:      <yes|no, recorded at <TIMESTAMP>>
  Daemon status:  <running on PID N | starting>
  Dashboard:      detach with Ctrl-C; the daemon keeps running.
  Stop:           `minsky stop` shuts everything down.
  Uninstall:      `minsky uninstall` (interactive; --force for scripts).

Next: add tasks to <HOST_PATH>/TASKS.md with the rule-9 fields documented at
<INSTALL_DIR>/vision.md, and Minsky will pick them up.
```

Then exit cleanly. Do not pick a task from the operator's host repo. Do not modify code in the host repo. Do not push to any remote. The daemon is now running and will do that work itself in the background.

## What if something fails?

| Failure mode | Diagnosis | Fix |
| --- | --- | --- |
| `command not found: pnpm` | corepack not enabled | `corepack enable pnpm` (may need sudo on Linux) |
| `pnpm install` fails with engine error | Node < 22 | upgrade Node; do not auto-install — ask first |
| `command not found: minsky` after PATH update | shell not re-sourced | use the absolute path `$INSTALL_DIR/bin/minsky` for the current shell |
| Daemon won't start | launchd / systemd permissions | run `$INSTALL_DIR/bin/minsky doctor` and surface the report to the operator |
| `git clone` fails behind a corporate proxy | network policy | ask the operator for their HTTPS proxy URL and `git config --global http.proxy "$URL"` |
| `~/.minsky/config.json` already exists with a different `default_host` | operator has Minsky on another host | DO NOT overwrite; ask the operator whether to add this host (multi-host mode requires `--hosts-dir`) |

If any other failure happens that isn't in this table, do NOT paper over it. File a new task in the operator's host `TASKS.md` at P1 priority describing the exact error, with `**Blocked**: needs-user-debugging`. Document the unblock path so a future agent (or the operator) can resume.

## Out of scope for this file

You are installing Minsky. You are NOT:

- picking a task from any `TASKS.md` to work on (that's the daemon's job, not yours)
- modifying any source code in the operator's host repo
- pushing to any remote (the daemon will open PRs on its own once it has work to do)
- running `minsky` against any folder other than the registered host (`HOST_PATH`)
- changing the operator's git config, gh auth, or shell beyond the single PATH line in step 3

If the operator's original request was "install minsky AND do X" where X is in the list above, finish the install first, then ask the operator whether they want you to continue with X as a separate task (not as part of the install).
