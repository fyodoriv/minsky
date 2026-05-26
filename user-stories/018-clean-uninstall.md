<!-- milestone: M1.12 -->

# 018 — Clean uninstall

> `minsky uninstall` removes everything Minsky added to a repo and to the operator's machine, zero residue.

## Who, what, when, why

**Who**: any operator who installed Minsky on machine X and decides to remove it — either to migrate to a new machine, to reset after a botched setup, or because they're abandoning the experiment.

**What**: `bin/minsky uninstall [--force]` (or `pnpm minsky:stop` + `bin/minsky uninstall`) removes:

- `~/.minsky/` directory (config, logs, openhands venv, iteration store, claim records, metric snapshots)
- `~/Library/LaunchAgents/com.minsky.*.plist` (all 7 supervisors on macOS)
- `~/.config/systemd/user/minsky-*.{service,timer}` (on Linux)
- Any `.minsky/` substrate inside repos the operator chose to bootstrap (operator opt-in per repo)
- Any `.worktrees/daemon-*` directories inside repos (the spawn isolation points)

**When**: at the operator's discretion. No automatic invocation.

**Why**: M1.12 closes the install-uninstall reversibility loop. Without clean uninstall, the operator's $HOME slowly accretes broken state from old Minsky versions — a real adoption blocker.

## Acceptance criteria

1. After `bin/minsky uninstall --force` on a previously-installed machine: `ls ~/.minsky/` returns "No such file or directory"; `launchctl list | grep minsky` returns empty; `systemctl --user list-units 'minsky-*'` returns empty.
2. Per-repo: `bin/minsky uninstall --force` from inside a Minsky-bootstrapped repo removes `.minsky/`, leaves all other files intact, restores any modified `.gitignore` to its pre-install state.
3. Idempotence: invoking `bin/minsky uninstall --force` twice in a row succeeds both times (second invocation is a no-op).
4. Interactive mode (default, no `--force`): prompts the operator at each step ("Remove `~/.minsky/`? [y/N]") with the actual paths shown.
5. Reversibility: `pnpm minsky:setup` after `bin/minsky uninstall --force` works end-to-end, producing a green supervisor identical to a fresh install.

## Metric

- **Name**: `uninstall-residue-count`
- **Threshold**: 0 (no residue files after `bin/minsky uninstall --force`).
- **Source**: substrate probe — `bin/minsky` has the `uninstall)` case branch wired. Today's value: 0 (substrate present).
- **Rationale**: lower-is-better. The integration test under `test/integration/` runs the live uninstall on a fixture host and counts files left behind; the metric collector here is a substrate-existence proxy.

## Integration test

- **File**: `user-stories/018-clean-uninstall.test.ts` (this PR).
- **Setup**: read `bin/minsky` from disk; no actual uninstall (that's covered by `test/integration/` end-to-end tests).
- **Action**: assert that the `uninstall)` case branch exists in `bin/minsky`, that `--force` is supported (per the canonical operator flow), and that the user-story metadata is structurally correct.

## Failure modes

- Uninstall called from inside a `.worktrees/daemon-<id>/` (the agent's worktree): refuse with a loud error pointing at the host repo.
- Supervisor running: uninstall attempts to `launchctl bootout` first; if bootout fails, surface the launchctl error and let the operator clean up manually rather than leaving a partially-uninstalled state.
- Operator-modified files inside `~/.minsky/` (e.g. they hand-edited `config.json`): interactive mode asks before removing; `--force` removes without asking.

## Out of scope

- Removing Minsky from other operators' machines (M4 fleet-scale).
- Reverting commits or PRs Minsky opened (those stay on the git remote; the operator can close them manually).

## Pivot

If the uninstall surface goes red ≥2 weeks (residue files accumulate after the test runs), the install side has added a new effect without a matching uninstall — pivot to a CI lint that scans `setup.sh` + `pnpm minsky:setup` for filesystem-mutation calls and asserts each has a matching `bin/minsky uninstall` clean-up. Restore install-uninstall symmetry by construction.
