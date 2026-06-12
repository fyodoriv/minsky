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
| `bin/minsky` or `bin/minsky-run.sh` (and your plist exists) | Refreshes the launchd plist via idempotent `minsky install-daemon` |
| `distribution/systemd/*.{service,target}` | `systemctl --user daemon-reload` (Linux) |
| Daemon runtime code while the legacy Node runner or current bash launchd loop is running | Writes `~/.minsky/restart-requested`; the loop exits between iterations so the supervisor restarts on fresh code |
| Any of the above | `pre-pr-lint --stage=fast` as advisory sanity check |

Defined in `scripts/post-merge-auto-install.mjs`.

## What it does NOT auto-do

Bootstrap a first-time supervisor. Starting a resource-consuming launchd/systemd unit is operator-explicit. For launchd:

```bash
minsky install-daemon
```

If a plist already exists, `git pull` and no-arg `minsky` refresh it automatically. If the daemon is already running and runtime code changed, the post-pull hook requests a restart through the sentinel so the current iteration can finish first.

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
~/apps/<minsky-repo>/bin/minsky --version    # confirm version bump
minsky status                    # confirm daemon is running fresh PID
```

## Edge cases

- **Pull conflicts with local changes in the install dir.** `git pull` fails; resolve conflicts before re-running. The post-merge hook doesn't run until the merge completes.
- **Daemon was already updating when you pulled.** Race-free by design — the auto-install hook requests a between-iteration restart instead of killing in-flight work.
- **`pnpm install` fails (network / registry).** The hook surfaces a warning; the daemon keeps running on the old code. Re-run `pnpm install` manually when network is back.
- **Plist regeneration changes the binary path.** Triggered only when daemon install-relevant files change and a plist already exists. The new plist takes effect after the next daemon restart.
