---
name: launchd-safe-paths
description: How to write scripts that work in launchd's stripped PATH context (where bare `node`, `python3`, `gh`, `opencode`, etc. may not resolve to the right binary or version). Use when adding a new launchd-driven service (`com.minsky.*`), debugging "command not found" / `ModuleNotFoundError` / wrong-node-version errors in tick-loop / auto-merge / watchdog logs, or when writing a script meant to run from both an interactive shell AND launchd.
allowed-tools: Read, Edit, Bash
---

# Launchd-safe script PATH handling

## The problem

When launchd spawns a process on macOS, the PATH inherited is **minimal** — typically just `/usr/bin:/bin:/usr/sbin:/sbin` plus whatever was set in the plist's `<key>EnvironmentVariables</key>` dict. This means:

| Tool | Where the interactive shell finds it | What launchd's PATH has |
|---|---|---|
| `node` | `~/.local/share/fnm/node-versions/*/installation/bin/node` (fnm) | NONE |
| `python3` | `/usr/bin/python3` (system) OR `~/.minsky/openhands-venv/bin/python` (venv) | `/usr/bin/python3` (no openhands) |
| `gh` | `/opt/homebrew/bin/gh` (Homebrew) | NONE |
| `claude` | `~/.local/bin/claude` | NONE |
| `opencode` | `~/.opencode/bin/opencode` | NONE |

Symptoms when this goes wrong (observed on minsky):
- `[openhands-spawn] missing API key` AND `exit 64` → bare `python3` resolves but openhands isn't importable (caught by `daemon-spawn-failure-rate` invariant in #897)
- `ModuleNotFoundError: No module named 'openhands'` → same root cause, different stack (caught in #898 by `invariant_openhands_in_path` importability check)
- `Can't find lefthook in PATH` → in auto-merge.log every cycle (still present 2026-05-27, low-priority)

## The fix shape (canonical pattern)

Every launchd-driven script should:

1. **Prepend operator-installed bin dirs to PATH** at the top of the script. See `distribution/systemd/run-tick-loop.sh` lines 60-95 for the canonical implementation — it prepends fnm + nvm + asdf + Homebrew + `~/.local/bin` + `~/.npm-global/bin` + `~/.opencode/bin` paths.

2. **Resolve binaries that need specific versions explicitly.** Don't trust PATH alone for binaries that have multiple installation paths AND multiple versions:
   - **python3 with venv-installed packages**: resolve to `~/.minsky/openhands-venv/bin/python` via `resolve_openhands_python` (bash helper in `bin/minsky-run.sh` lines 162-188). Honors `MINSKY_OPENHANDS_PYTHON` env override + falls back to bare `python3` gracefully.
   - **node**: prepend fnm's path first; downstream `pnpm` / `npm` then resolves consistently.

3. **Add an importability / liveness probe** to the runtime invariants in `scripts/self-diagnose.mjs`. Pattern: `invariant_<tool>_in_path` shape — verify file exists AND actually works (e.g. for python: `python -c 'import openhands'`, not just `which python`). The existence-only check is a false-positive waiting to happen (caught in #898).

## Why launchd doesn't substitute `${HOME}`

Launchd substitutes `${HOME}` for `Program` and `ProgramArguments` keys BUT NOT for `StandardOutPath` / `StandardErrorPath`. Side effect: a plist with `<string>${HOME}/.minsky/foo.log</string>` causes launchd to create a directory literally named `${HOME}` inside the script's cwd.

Fix shape: substitute `${HOME}` at INSTALL time via envsubst, not at runtime via launchd. `setup.sh` line 498 now does this:

```bash
MINSKY_HOME="$ROOT" envsubst '${MINSKY_HOME} ${HOME}' < "$template" > "$installed"
```

Forgot to add `${HOME}` to the envsubst whitelist? See PR #900 — observed the bug as a 1MB orphan `${HOME}/.minsky/auto-merge.log` directory in the repo root.

## Checklist for a new launchd-driven script

- [ ] Script lives under `distribution/{launchd,systemd}/run-<name>.sh`
- [ ] First ~30 lines prepend fnm + nvm + asdf + Homebrew + `~/.local/bin` to PATH
- [ ] Binaries that need version-pinning are resolved by absolute path (or via a helper like `resolve_openhands_python`)
- [ ] `distribution/launchd/com.minsky.<name>.plist` has `${HOME}` (not `$HOME`) and is rendered via `envsubst '${MINSKY_HOME} ${HOME}'`
- [ ] `scripts/self-diagnose.mjs` has an `invariant_<name>` that probes liveness, not just file existence
- [ ] `distribution/lint-units.sh` placeholder-hygiene allowlist (line 79) includes any new envsubst-substituted variable

## Source citations

- Canonical PATH-prepend example: `distribution/systemd/run-tick-loop.sh` lines 60-95
- Canonical version-pinned binary resolution: `bin/minsky-run.sh` lines 162-188 (`resolve_openhands_python`)
- Canonical liveness invariant: `bin/minsky-run.sh` lines 108-160 (`invariant_openhands_in_path` — imports against the resolved python)
- envsubst `${HOME}` whitelist: `setup.sh` line 498
- PR chain that taught these: #897 / #898 / #900
