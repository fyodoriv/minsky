# Running minsky — setup, commands, and per-machine config

This file exists to hold the full setup and run details that `AGENTS.md` summarizes. Read it when you install minsky, start or stop the daemon, or change which agents and models run. The agent support matrix stays in [AGENTS.md](../../AGENTS.md#per-machine-agent-config--minskyconfigjson) because a CI gate parses it there.

## Repository setup

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
pnpm install            # prepare hook: (a) tsc -b builds all workspace dist/; (b) lefthook installs git hooks
minsky daemon doctor    # verify health (no separate build step)
```

No separate build step needed. `pnpm install` runs the root `prepare` hook which calls `tsc -b` to compile every workspace package's `dist/` (including `@minsky/tick-loop`). If no runnable entrypoint is built at runtime (interrupted/partial install), `bin/minsky` exits 1 with a one-line `` `minsky: run `pnpm install` `` hint naming the repo root, rather than a raw node `ERR_MODULE_NOT_FOUND` stack trace. The contract is pinned by `tests/fresh-clone-bootstrap.bats` (the `prepare`-script presence + the actionable-hint branch via the `__assert-built` guard).

## Running minsky

```bash
# Subcommand-style (canonical, 2026-05-26 CLI overhaul — nx + openhands shape):
minsky daemon start --hosts-dir <repos-parent-dir>  # background across repos
minsky daemon start --local                         # local-only (zero cloud tokens)
minsky daemon status                                 # PID, uptime, log tail
minsky daemon logs                                   # tail -f daemon log
minsky daemon stop                                   # SIGTERM → graceful drain

# Killer-feature verbs:
minsky transform [<path>]                            # one improvement session w/ before/after delta
minsky solve <task-id>                               # one iteration of one task (openhands-pattern)
minsky run --once --host <dir>                       # one iteration, ad-hoc

# Introspection:
minsky show tasks                                    # next-pick + per-priority counts
minsky show findings                                 # self-diagnose with actor labels
minsky list agents                                   # claude / aider / openhands
minsky config show                                   # ~/.minsky/config.json
```

Backward-compat flag-style entrypoints (`minsky --daemon`, `--once`, `--transform`, `--bash-runner`) and bare subcommands (`minsky stop / status / logs / doctor`) still work; the subcommand form above is canonical and will be the only form after 2026-06-26.

**`minsky daemon start`** backgrounds the process (logs to `~/.minsky/daemon.log`, PID file at `~/.minsky/daemon.pid`). SIGHUP-immune — survives terminal close / IDE restart.

**`--local`** forces local-only mode (`MINSKY_LLM_PROVIDER=local-only`). Uses the local agent (aider + ollama) from `~/.minsky/config.json`. Zero cloud tokens.

### Per-machine agent config — `~/.minsky/config.json`

**Always check this file first** when starting minsky on any machine. It determines which agents and models run.

```json
{
  "cloud_agent": "claude",              // "claude" | "aider" | "openhands"
  "cloud_agent_model": "claude-opus-4-7-max",  // passed as --model
  "local_agent": "aider",               // local-only mode agent
  "local_agent_model": "ollama_chat/qwen3-coder:30b",
  "local_agent_args": ["--model", "ollama_chat/qwen3-coder:30b", "--no-auto-commits"],
  "ollama_base_url": "http://localhost:11434",
  "review_model": "claude-opus-4-7",    // optional: brain PR review model (default: cloud_agent_model)
  "brain_effort": "xhigh"               // optional: passed as --effort to the brain review
}
```

**Changing models:** edit this one file. `cloud_agent_model` is the brain (orchestrator), `local_agent_model` the workers, `review_model` the merge review (falls back to `cloud_agent_model`), `brain_effort` its effort. One-session overrides: `MINSKY_REVIEW_MODEL`, `MINSKY_BRAIN_EFFORT`.

**Resolution priority** (highest wins, per key):

| Layer | When | Example |
|---|---|---|
| Env var (one session) | `MINSKY_CLOUD_AGENT=claude minsky ...` | override for one run |
| `~/.minsky/config.json` | persistent per-machine | edit file to change permanently |
| Default | no config, no env | `claude` for cloud, `aider` for local |

The `openhands` row reflects an operator-approved wrap-feasibility decision per `competitors/openhands.md` § "Should we wrap OpenHands instead?" (Shape A: agent-layer wrap as pluggable backend). Implementation tracked at [`add-openhands-as-pluggable-backend`](../../TASKS.md) (P0). The schema half ships now via `novel/cross-repo-runner/src/agent-config.ts` → `AGENT_MATRIX` (the openhands row carries `pendingExternalDep: "2026-06-01"`); the daemon REFUSES to spawn under `cloud_agent: "openhands"` until that date, exiting `EX_USAGE` (64) with an actionable error that names the GitHub issue and the fallback agents. On June 1 the `pendingExternalDep` flag flips to `null` and the same code path becomes live.

### Per-host overlay — `<host>/.minsky/repo.yaml`

The daemon reads `<host>/.minsky/repo.yaml` once per iteration to learn how to drive that host. The `task_source` field selects which backend the picker reads work from:

| Value | Backend | Notes |
|---|---|---|
| `tasks-md` (default) | parses `tasks_md_path` (`TASKS.md` by default) | every existing host, no migration needed |
| `github-issues` | `gh issue list` on `host_repo`, P0/P1 labels | adapter at `scripts/gh_issue_task_source.py`; rule-#9 fields parsed from the issue body |

An unknown value fails loud at picker start — a typo never silently reverts to `tasks-md`. The `Closes #N` keyword on the daemon-authored PR auto-closes the source issue on merge (GitHub default-branch close keywords); the `tasks-md` block on a TASKS.md host is removed by the iteration's normal `chore(tasks): drop shipped <id>` commit. Switching a host's backend is one-line: edit `task_source` and the daemon picks up the change on the next tick.
