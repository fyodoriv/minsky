# Updating

How to pick up new minsky fixes on a machine that's already running it.

## Quick path

```bash
git pull
```

A post-merge git hook handles most of the redeploy automatically.

## What `git pull` triggers

| Change in the pull | Auto-runs |
| --- | --- |
| `pnpm-lock.yaml` or `package.json` | `pnpm install` (refreshes `dist/`) |
| `bin/minsky` (and your plist exists) | Regenerates the launchd plist (no daemon kill) |
| `distribution/systemd/*.{service,target}` | `systemctl --user daemon-reload` (Linux) |
| Any of the above | `pre-pr-lint --stage=fast` as advisory sanity check |

Defined in `scripts/post-merge-auto-install.mjs`.

## What it does NOT auto-do

Restart the running daemon. The current iteration may be mid-spawn and killing it would waste compute, so picking up new daemon-loop behaviour still requires:

```bash
minsky update   # graceful stop → pull → rebuild → restart from next iteration
```

Tracked as P0 `minsky-auto-restart-daemon-on-pull` in `TASKS.md` — the goal is to make `minsky update` redundant by having the daemon notice a sentinel between iterations and gracefully restart itself.

## Opting out

| Scope | Mechanism |
| --- | --- |
| One pull | `MINSKY_NO_AUTO_INSTALL=1 git pull` |
| Per-machine | `touch ~/.minsky/no-auto-install` |
| Reverting opt-out | `rm ~/.minsky/no-auto-install` |

## Manual update workflow

If you opted out and want to update manually:

```bash
minsky stop      # graceful drain of current iteration
git pull
pnpm install     # refresh dist/
minsky           # restart daemon
```

`minsky update` does all four steps in one command, plus regenerates the plist if needed.

## Verifying the update landed

```bash
git log -1 --oneline             # confirm pull happened
~/apps/<minsky-repo>/bin/minsky --version    # confirm version bump (after restart)
minsky status                    # confirm daemon is running fresh PID
```

## Edge cases

- **Pull conflicts with local changes in the install dir.** `git pull` fails; resolve conflicts before re-running. The post-merge hook doesn't run until the merge completes.
- **Daemon was already updating when you pulled.** Race-free by design — the auto-install hook never touches a running daemon; the restart step is yours to time.
- **`pnpm install` fails (network / registry).** The hook surfaces a warning; the daemon keeps running on the old code. Re-run `pnpm install` manually when network is back.
- **Plist regeneration changes the binary path.** Only triggered when `bin/minsky` changes. The new plist takes effect after the next daemon restart.
