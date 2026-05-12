---
description: Gracefully stop every running Minsky autonomous loop on this host via SIGTERM — the runner drains its in-flight iteration then exits.
---

# /minsky-stop — stop Minsky cleanly

## Steps

### 1. SIGTERM running processes

<!-- turbo -->
```bash
minsky stop
```

Sends SIGTERM to every `minsky-run` process. The runner's own signal
handler (`host-loop.ts` → abort signal) finishes the in-flight
iteration before exiting with `stopReason: aborted`. No in-progress
work is lost.

### 2. Confirm

<!-- turbo -->
```bash
sleep 2 && minsky status
```

Expect `no running minsky-run on this host`. If processes are still
listed after 5s, report this to the operator — a stuck child process
may need SIGKILL:

```bash
pkill -KILL -f "cross-repo-runner/bin/minsky-run"
```

(Never SIGKILL without 5s of SIGTERM first — the runner needs that
window to flush iteration records to disk.)

### 3. Append a stop line to the observer log

<!-- turbo -->
```bash
test -d .minsky && echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"action\":\"stop\",\"reason\":\"operator-requested\"}" >> .minsky/observer.log
```

Rule #7 discipline: every intentional stop is logged.
