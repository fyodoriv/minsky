<!-- milestone: M1.12 -->

# Story 018 — Clean uninstall

**Milestone(s)**: M1.12

> `minsky uninstall` removes everything Minsky added to a repo and to your machine, with zero residue.

Minsky is a background program that does coding work for you while you are away. To do that work it writes files on your machine — a config directory, logs, and the supervisors that keep it running. (A supervisor is the outer watchdog — `launchd` on macOS, `systemd` on Linux — that restarts Minsky if it dies.) This story is about the reverse: one command that removes all of that and leaves your machine exactly as it was before you installed Minsky.

Without a clean uninstall, your home directory slowly fills up with leftover state from old Minsky versions. That broken state is a real reason people give up on the tool. This story closes the loop: install adds files, uninstall removes them, and the two stay symmetric.

## Story

As an operator — the person who runs Minsky — I installed Minsky on my machine and now want it gone. Maybe I am moving to a new machine, maybe a setup went wrong and I want a clean slate, or maybe I am done experimenting. I run `bin/minsky uninstall`. It tells me each path it is about to remove, removes them, and when it finishes there is no trace of Minsky left.

I can run uninstall whenever I want. Minsky never runs it for me.

## What uninstall removes

`bin/minsky uninstall [--force]` (or `pnpm minsky:stop` followed by `bin/minsky uninstall`) removes:

- `~/.minsky/` — the config directory (config, logs, OpenHands virtualenv, iteration store, claim records, metric snapshots). An iteration is one round of work: pick a task, ask an agent to do it, capture the result, open a draft.
- `~/Library/LaunchAgents/com.minsky.*.plist` — all 7 supervisors on macOS.
- `~/.config/systemd/user/minsky-*.{service,timer}` — the supervisor units on Linux.
- Any `.minsky/` directory inside a repo you chose to set up for Minsky (you opt in per repo). A repo Minsky works on is called a host.
- Any `.worktrees/daemon-*` directories inside a host — the isolated checkouts where Minsky runs an agent (the coding assistant, such as Claude Code or Devin) so its edits never touch your main branch.

## Acceptance criteria

1. **Machine clean.** After `bin/minsky uninstall --force` on a machine that had Minsky installed: `ls ~/.minsky/` returns "No such file or directory"; `launchctl list | grep minsky` returns empty; `systemctl --user list-units 'minsky-*'` returns empty.
2. **Repo clean.** Running `bin/minsky uninstall --force` from inside a Minsky-bootstrapped repo removes `.minsky/`, leaves every other file intact, and restores any modified `.gitignore` to its pre-install state.
3. **Idempotent.** Running `bin/minsky uninstall --force` twice in a row succeeds both times. The second run is a no-op.
4. **Interactive by default.** With no `--force`, uninstall prompts at each step ("Remove `~/.minsky/`? [y/N]") and shows the actual paths.
5. **Reversible.** Running `pnpm minsky:setup` after `bin/minsky uninstall --force` works end-to-end and produces a green supervisor identical to a fresh install.

## Metric

- **Name**: `uninstall-residue-count`
- **Definition**: number of Minsky files left on disk after `bin/minsky uninstall --force`. Lower is better.
- **Threshold**: 0 (no residue files).
- **Source**: substrate probe — `bin/minsky` has the `uninstall)` case branch wired. Today's value: 0 (substrate present). The end-to-end test under `test/integration/` runs the live uninstall on a fixture host and counts files left behind; the collector here is a substrate-existence proxy.

## Integration test

- **File**: `user-stories/018-clean-uninstall.test.ts` (this PR).
- **Setup**: read `bin/minsky` from disk. No actual uninstall — that is covered by the end-to-end tests under `test/integration/`.
- **Action**: assert that the `uninstall)` case branch exists in `bin/minsky`, that `--force` is supported (the canonical operator flow), and that this user-story metadata is structurally correct.

## Failure modes

- **Called from inside an agent worktree** (a `.worktrees/daemon-<id>/` directory): refuse with a loud error pointing at the host repo.
- **Supervisor still running**: uninstall runs `launchctl bootout` first. If bootout fails, surface the `launchctl` error and let the operator clean up by hand, rather than leaving a half-uninstalled state.
- **Operator-edited files inside `~/.minsky/`** (for example, a hand-edited `config.json`): interactive mode asks before removing; `--force` removes without asking.

## Out of scope

- Removing Minsky from other operators' machines (M4, fleet-scale).
- Reverting commits or pull requests Minsky opened. Those stay on the git remote; the operator can close them by hand.

## Pivot

If the uninstall surface stays red for 2 weeks or more (residue files keep accumulating after the test runs), the install side has added a new effect without a matching cleanup. Pivot to a CI lint that scans `setup.sh` and `pnpm minsky:setup` for filesystem-mutation calls and asserts each one has a matching `bin/minsky uninstall` cleanup. Restore install-uninstall symmetry by construction.
