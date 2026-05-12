---
description: Report what Minsky is doing on this host right now — any running minsky-run processes plus the tail of the most recent observer log.
---

# /minsky-status — is Minsky running? what is it doing?

## Steps

### 1. Show running processes

<!-- turbo -->
```bash
minsky status
```

Output is either `pgrep -a` of every running `minsky-run` process
(with PID + full argv so the operator sees which host each one is
driving) or `no running minsky-run on this host`.

### 2. Tail the observer log, if one exists

<!-- turbo -->
```bash
test -f .minsky/observer.log && tail -20 .minsky/observer.log || echo "no observer log in $(pwd)"
```

Each line is JSON: `{ts, action, reason, pid?, pr?}`. The newest
entries are at the bottom.

### 3. Summarise for the operator

Produce a one-line verdict: "Minsky is running against `<host>`,
currently on iteration N, last verdict `validated`. No observer
actions needed." OR "Nothing running; log shows 3 restarts at <ts>
then a PR was filed at <url>."
