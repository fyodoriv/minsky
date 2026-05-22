---
description: Start the Minsky autonomous run loop on the current folder (or a named folder). Invokes the `minsky` skill so the caller agent observes, heals, and swiftly escalates.
---

# /minsky — run Minsky on this folder, observed

Launch minsky as a background daemon that survives terminal close, IDE
restart, and SSH disconnect. Uses `minsky --daemon` so the agent returns
immediately and can observe/heal via `minsky status` and `minsky logs`.

## Steps

### 1. Confirm the target folder

<!-- turbo -->
```bash
pwd && test -f .minsky/repo.yaml && echo "BOOTSTRAPPED" || echo "NEEDS_BOOTSTRAP"
```

If `NEEDS_BOOTSTRAP`, run the bootstrap:

```bash
node <minsky-repo>/novel/sidecar-bootstrap/bin/minsky-bootstrap.mjs "$(pwd)"
```

### 2. Check if already running

<!-- turbo -->
```bash
minsky status
```

If already running, report to the operator and skip to step 4 (observe).
Do NOT start a second daemon.

### 3. Start daemon

<!-- turbo -->
```bash
minsky --daemon --max-iterations=120
```

For multi-host (all repos in a parent dir):

```bash
minsky --daemon --hosts-dir ~/apps/tooling --max-iterations=120
```

The daemon logs to `~/.minsky/daemon.log`, writes PID to
`~/.minsky/daemon.pid`, and is SIGHUP-immune. Safe to close the IDE.

### 4. Verify it started

<!-- turbo -->
```bash
sleep 3 && minsky status
```

Expect `running (PID ...)` with uptime and log tail. If not running,
check `minsky logs` for the error.

### 5. On failure

Check logs:

```bash
minsky logs
```

If the daemon died, restart it (step 3). If it's stuck on a spawn
failure (e.g., devin auth expired), fix the root cause then restart.

Follow §3 → §4 → §5 of the `minsky` skill for heal/escalate protocol.
Never silently retry. Always either heal visibly, restart visibly, OR
escalate visibly via `gh pr create --draft`.

### 6. Stop

```bash
minsky stop
```
