# INSTALL.md — agent-mediated install runbook

**Audience.** You are an AI coding agent (Claude Code, Devin, Cursor, Windsurf, Codex CLI, or any agent that can read files and run shell commands) acting on behalf of a human operator who said something like "install minsky for this folder and start it". This file is the canonical install runbook. Follow it step by step. Ask the operator a question ONLY at the explicit consent-prompt step below — every other step is yours to execute autonomously.

**Status.** Stub. Closing the loop is tracked as P0 task `agent-mediated-install` in `TASKS.md`. Until that task ships the `minsky consent` subcommand + the measurement harness, the consent step writes locally only (no server submission yet) and you the agent do steps 1–5 manually. The flow described below works end-to-end today; only the automated cross-provider measurement is pending.

## What you're installing

Minsky is a background daemon that runs AI coding agents against tasks in any git repo. It picks the highest-priority task with complete rule-9 fields from `TASKS.md`, spawns an AI agent to work on it, opens a PR, records the iteration, then picks the next task. By default it runs until the operator stops it. Full README at [README.md](./README.md); applied practices at [docs/PRACTICES.md](./docs/PRACTICES.md).

## Step 1 — verify prerequisites

Run each line and check the output:

```bash
node --version    # must be ≥ v22 — Minsky requires modern Node
pnpm --version    # must be ≥ 9; if missing run: corepack enable pnpm
git --version     # must be ≥ 2.40
```

If any prerequisite is missing or too old, tell the operator the exact missing piece and the install command for their OS (Homebrew on macOS, apt on Debian/Ubuntu), then STOP. Do not auto-install Node or pnpm without permission — that's the operator's machine, not yours.

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

Wait for the answer. Then record it:

```bash
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Replace CONSENT below with the operator's literal answer: true or false
CONSENT=true  # or false
# Hash the host path with a per-machine salt for privacy
SALT_FILE=~/.minsky/machine-salt
[ -f "$SALT_FILE" ] || (head -c 32 /dev/urandom | base64 > "$SALT_FILE")
SALT=$(cat "$SALT_FILE")
HOST_HASH=$(printf '%s%s' "$SALT" "$HOST_PATH" | shasum -a 256 | cut -d' ' -f1)

cat > ~/.minsky/telemetry-consent.json <<EOF
{
  "consent": $CONSENT,
  "timestamp": "$TIMESTAMP",
  "host_path_hash": "$HOST_HASH",
  "agent": "$AGENT"
}
EOF
```

When the `minsky consent` subcommand ships (tracked in P0 `agent-mediated-install`), replace the shell block above with `minsky consent --yes` or `minsky consent --no` — that one command does the same atomic write plus server submission when `MINSKY_TELEMETRY_ENDPOINT` is configured.

Until then: server submission is a no-op. The file lives only on the operator's machine.

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
