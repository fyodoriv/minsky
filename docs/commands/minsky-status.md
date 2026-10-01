---
description: Report what Minsky is doing on this host right now — any running minsky-run processes plus the tail of the most recent observer log.
---

# /minsky-status — is Minsky running? what is it doing?

## Steps

### 1. Show daemon status

<!-- turbo -->
```bash
minsky status
```

Shows PID, uptime, and last 10 log lines when a daemon is running.
Also detects foreground processes started without `--daemon`.

### 2. Tail the daemon log if more context needed

<!-- turbo -->
```bash
tail -30 ~/.minsky/daemon.log 2>/dev/null || echo "no daemon log"
```

### 3. Summarise for the operator

Produce a one-line verdict: "Minsky daemon running (PID X, uptime Yh),
walking N hosts, last iteration on `<host>` verdict `validated`." OR
"Not running. Last run ended at <ts> with stopReason `<reason>`.
Restart with: `minsky daemon start --hosts-dir ~/apps/tooling`"
