# Deprecated Features

> The list of code paths that should not receive new work — and what to use instead.

## What this file is

The canonical do-not-invest list for the minsky repo. Every entry below names a deprecated surface, the replacement to use instead, and the rationale. If you're picking a task and one of these names appears in the task body, switch to the replacement before writing code — don't extend the deprecated path.

The list is consulted by `AGENTS.md` (which tells every agent to read this file before implementing a feature) and is the ratchet that prevents two parallel implementations from co-existing past their migration window.

## What this file is not

- **Not a roadmap** — see `MILESTONES.md` for what's being built.
- **Not a changelog** — see `CHANGELOG.md` for what shipped when.
- **Not the constitution** — see `vision.md` for the rules every surface must follow.
- **Not a list of bugs** — see `TASKS.md` for active work.

## Deprecated (do not invest)

### 1. `MINSKY_SCOPE_LEAK_MODE=hard` (scope-leak halts daemon)

- **Replacement**: Soft mode is the permanent default. Scope-leak logs
  out-of-scope files and continues. There is no reason to halt.
- **Rationale**: Devin naturally touches related files. 54% of overnight
  iterations were killed by hard scope-leak (2026-05-18). Soft mode
  preserves PRs and keeps the daemon alive.
- **Remove**: Delete the `"hard"` branch in `host-loop.ts:337` and the
  `MINSKY_SCOPE_LEAK_MODE` env var. Always warn.

### 2. `scripts/observer-watch.sh` + launchd observer plist

- **Replacement**: `minsky watch` (built into `bin/minsky`).
- **Rationale**: The observer script was a separate bash loop that
  monitored the daemon. `minsky watch` does the same thing better —
  integrated into the CLI, shows stability %, iterations, human-help
  indicators, and git SHA.
- **Remove**: Delete `scripts/observer-watch.sh` and
  `~/Library/LaunchAgents/com.minsky.observer.plist`.

### 3. `pnpm dogfood` / `pnpm dogfood:ui` / `pnpm dogfood:doctor`

- **Replacement**: `minsky --daemon --host .` (or just `minsky` in the repo).
- **Rationale**: The dogfood scripts were a separate codepath for
  running minsky on itself. `minsky --host .` uses the standard path.
  Task `minsky-on-minsky-as-regular-host` makes the dogfood path
  identical to the standard path.
- **Remove**: Delete `dogfood*` scripts from `package.json`. Keep
  `pnpm minsky` as the canonical entry point.

### 4. `novel/dashboard-web` (web dashboard)

- **Replacement**: `minsky watch` (CLI TUI dashboard).
- **Rationale**: The web dashboard requires a running HTTP server, a
  browser, and port management. `minsky watch` shows the same
  information in the terminal with zero dependencies. The
  `runany-retro-tui-dashboard` task explicitly calls for removing
  the web UI.
- **Status**: Keep for now (some tasks reference it), but do NOT add
  new features. All new dashboard work goes into `minsky watch`.

### 5. `setup.sh` (623-line setup script)

- **Replacement**: `minsky update` (for existing installs) and
  `minsky init` (for new installs, when it ships).
- **Rationale**: setup.sh mixes bootstrapping, dogfood config, launchd
  unit installation, and doctor checks. `minsky update` handles the
  pull/rebuild/restart flow. `minsky init` will handle first-time setup.
- **Status**: Keep until `minsky init` ships, then deprecate.

### 6. `MINSKY_CLAUDE_PRINT_TIMEOUT_MS` (hardcoded timeout env var)

- **Replacement**: Dynamic timeouts computed from iteration history
  (`dynamic-timeouts.ts`). The system self-tunes.
- **Rationale**: A hardcoded 15min/30min timeout killed productive
  iterations and was too generous for stuck ones. Dynamic timeouts
  adapt to the actual machine + agent performance.
- **Status**: The env var still works as an escape hatch but should
  NOT be set in plists or documented as the recommended approach.

### 7. `MINSKY_LIVE_SPAWN_TIMEOUT_MS` (same as above for cross-repo runner)

- **Replacement**: Same — dynamic timeouts via `computeDynamicSettingsForHost`.
- **Status**: Escape hatch only. Do not set in plists.

### 8. Manual `minsky stop` + `rm -f daemon.pid` + `minsky --daemon`

- **Replacement**: `minsky update` (one command).
- **Rationale**: The three-step restart was error-prone (forgot to
  clean PID, forgot the host arg, started on wrong branch). `minsky
  update` does all three + pulls latest code.

### 9. `distribution/launchd/com.minsky.tick-loop.plist` (old tick-loop daemon)

- **Replacement**: `minsky --daemon --host <repo>` (cross-repo runner).
- **Rationale**: The tick-loop plist runs the old single-host daemon
  via `pnpm minsky`. The cross-repo runner (`minsky-run.mjs`) is the
  current production daemon with walker, per-host cap, dynamic
  timeouts, and experiment store.
- **Status**: Keep until all operators migrate to `minsky --daemon`.

## Not deprecated (keep investing)

- `minsky watch` — the primary operator dashboard
- `minsky update` — the standard update flow
- `minsky status` — quick health check
- `minsky --daemon --host <repo>` — the production daemon
- `dynamic-timeouts.ts` — self-tuning watchdog
- `runtime-invariants.ts` — pre-iteration system checks
- `experiment-store/cross-repo/*.jsonl` — iteration history
- `stability-number.mjs` — the headline metric
- Soft scope-leak mode — the permanent default
