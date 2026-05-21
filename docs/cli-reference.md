# CLI reference

Every `minsky` subcommand, every flag. See [`bin/minsky`](../bin/minsky) for the canonical source.

## Daily

| Command | What it does |
| --- | --- |
| `minsky` | Start-or-attach: daemon + auto-install persistence + dashboard. The one command for everyday use. |
| `minsky watch` | Attach to live dashboard (Ctrl-C detaches; daemon keeps running). |
| `minsky stop` | Thorough shutdown (launchd + runners + agents). Zero ghost processes. |

## Diagnostics

| Command | What it does |
| --- | --- |
| `minsky status` | Quick health: PID, uptime, stability %. |
| `minsky logs` | `tail -f` the daemon log at `~/.minsky/daemon.log`. |
| `minsky doctor` | Check host readiness (node, git, gh, config, agents). Surfaces actionable warnings. |
| `minsky report` | Baseline / delta against `.minsky/metric-snapshots/`. |
| `minsky benchmark` | Run the cross-repo runner N times and report pass-rate. |

## Lifecycle

| Command | What it does |
| --- | --- |
| `minsky init` | One-command bootstrap on any git repo (creates `TASKS.md` if missing + `.minsky/` sidecar). |
| `minsky update` | `minsky stop → git pull → pnpm install → minsky` in one step. |
| `minsky uninstall` | Dry-run by default; `--force` to actually delete. See [docs/uninstall.md](uninstall.md). |
| `minsky install-daemon` | Install the launchd plist / systemd unit. Auto-done on first `minsky` invocation. |
| `minsky uninstall-daemon` | Remove the plist only (preserves config + logs). |

## Top-level flags

| Flag | What it does |
| --- | --- |
| `--daemon` | Detach + persist via launchd / systemd; don't drop into the dashboard. |
| `--host <path>` | Target a specific host repo (overrides `default_host` from `~/.minsky/config.json`). |
| `--hosts-dir <parent>` | Multi-host mode: walk every git repo under `<parent>` round-robin (3 iterations per host per pass). |
| `--once` | Run a single iteration and exit. |
| `--max-iterations=N` | Cap at N iterations and exit (default: `Infinity`). |
| `--local` | Local-only mode: zero cloud-agent calls. Combinable with `--daemon`. |
| `--no-seed-on-empty` | Halt cleanly when the task queue runs dry, instead of running CTO audit to seed new tasks. |

## Environment variables

| Var | What it controls |
| --- | --- |
| `MINSKY_REPO` | Override the install-dir resolver. Set to an absolute path. |
| `MINSKY_CLOUD_AGENT` | One-shot agent override (`devin` / `claude`). |
| `MINSKY_LLM_PROVIDER` | `cloud-preferred` (default) / `local-only` / `local-preferred`. |
| `MINSKY_BUDGET_TOKENS` | Per-iteration token budget cap. |
| `MINSKY_CTO_AUDIT` | `on` (default) / `off` — toggles the post-iteration CTO audit. |
| `MINSKY_SCOPE_LEAK_MODE` | `soft` (default; deprecated alternative `hard` halts daemon — see `DEPRECATED.md`). |
| `MINSKY_NO_AUTO_INSTALL` | `1` to skip the post-merge auto-install hook for one pull. |
| `MINSKY_NON_INTERACTIVE` | `1` for CI / scripted use (no TTY prompts). |
| `MINSKY_TELEMETRY_ENDPOINT` | Optional HTTPS endpoint for anonymized telemetry submission (see `INSTALL.md` step 5). |

## Examples

```bash
# Start on the default host, daemon + dashboard
minsky

# Run against a specific repo, single iteration
minsky --host ~/code/my-repo --once

# Multi-host fleet mode, local-only, daemon
minsky --local --daemon --hosts-dir ~/code

# Health check + log tail
minsky status
minsky logs

# Update to latest and restart
minsky update

# Preview what uninstall would do
minsky uninstall

# Actually uninstall
minsky uninstall --force
```
