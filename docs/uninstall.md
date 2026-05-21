# Uninstall

Full removal of minsky from a machine. The host repo and its `.minsky/` experiment store are NOT touched — those are your data.

## Quick path

```bash
minsky uninstall --force
```

Stops the daemon, removes the launchd plist (macOS) / systemd-user unit (Linux), deletes `~/.minsky/`. Idempotent — safe to re-run.

## Dry-run preview (default)

```bash
minsky uninstall
```

Prints what would be removed. Exits 0 without changing anything. Add `--force` to actually delete.

## What gets removed

| Artifact | Path | Removed |
| --- | --- | --- |
| Daemon process | PID file at `~/.minsky/daemon.pid` | Yes (SIGTERM, then SIGKILL if needed) |
| Agent children | spawned `devin --prompt-file …` etc. | Yes (SIGTERM to each match) |
| launchd plist (macOS) | `~/Library/LaunchAgents/com.minsky.daemon.plist` | Yes (`launchctl unload` + `rm`) |
| systemd unit (Linux) | `~/.config/systemd/user/minsky-daemon.service` | Yes (`systemctl --user disable` + `rm`) |
| Per-machine state | `~/.minsky/` (config, log, telemetry-consent) | Yes |

## What is preserved

| Artifact | Path | Reason |
| --- | --- | --- |
| Host repo | `<your-host-repo>/` | Your project; not minsky's to delete |
| Experiment store | `<your-host-repo>/.minsky/experiment-store/` | Your iteration history — survives uninstall so you can re-bootstrap and continue |
| Sentinels in host repo | `<your-host-repo>/.minsky/restart-requested`, etc. | Per-host runtime state; cleared on next install |
| The cloned minsky repo | `<install-dir>` (e.g., `$HOME/minsky`) | Not removed — `rm -rf` the clone manually if you want it gone too |

## Verifying it worked

```bash
launchctl list | grep -c com.minsky.daemon    # → 0
pgrep -f cross-repo-runner                    # → no output (exit 1)
[ -e ~/.minsky ] && echo "STILL HERE"         # → no output
```

If any line is non-zero / non-empty, re-run `minsky uninstall --force`.

## Edge cases

- **Daemon was crashed when you ran uninstall.** The stale PID file is detected and ignored; the uninstall still completes.
- **`~/.minsky/` is missing.** No-op. The uninstall doesn't fail on idempotency.
- **You uninstalled, then ran `minsky` again.** The next `minsky` invocation re-installs persistence (per `Default by default` in the constitution). To prevent that, also `rm -rf <install-dir>` after uninstall.
- **Multi-machine fleet.** Uninstall is per-machine. Each machine in the fleet needs its own `minsky uninstall --force`.

## In-flight improvement

A single-command `minsky uninstall` with an interactive `YES` prompt (no `--force` needed) is tracked as P0 `minsky-uninstall-one-command-with-stop`. Until that ships, `--force` is required for the destructive path.

## Reinstall

If you want minsky back later: from the install dir, just run `minsky` again. The launchd plist regenerates on first run; the host repo's experiment store (if preserved) provides history for the dynamic-watchdog / stability metric.
