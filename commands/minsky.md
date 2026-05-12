---
description: Start the Minsky autonomous run loop on the current folder (or a named folder). Invokes the `minsky` skill so the caller agent observes, heals, and swiftly escalates.
---

# /minsky — run Minsky on this folder, observed

Invoke the `minsky` skill from `skill-plugins/observer/minsky/SKILL.md`
(distributed via agentbrew). The skill walks the full protocol:

1. **Start** — pick the right invocation (§1). Default: `minsky` with
   no args runs against `$(pwd)` via cwd auto-detect.
2. **Watch** — tail stdout, classify every 30s (§2).
3. **Restart** — bounded retries on transient failures (§3).
4. **Safe-heal** — only catalogued, single-line, operator-confirmed
   fixes (§4).
5. **Swift-PR** — draft P0 PR in the correct upstream repo within
   5 minutes on budget-exhaust / scope-leak / rule-9 violation (§5).
6. **Log** — `.minsky/observer.log` captures every action (§6).
7. **Stop** — `minsky stop` when the operator says so (§7).

## Steps

### 1. Confirm the target folder

<!-- turbo -->
```bash
pwd && test -f .minsky/repo.yaml && echo "BOOTSTRAPPED" || echo "NEEDS_BOOTSTRAP"
```

If `NEEDS_BOOTSTRAP`, ask the operator: "`$(pwd)` is not a bootstrapped
Minsky host. Run `minsky-bootstrap $(pwd)` first?" Do NOT proceed
without confirmation.

### 2. Start + observe

<!-- turbo -->
```bash
minsky 2>&1 | tee -a .minsky/observer.log
```

Follow the observer protocol from the `minsky` skill. Each iteration
line goes to the log; the observer reads the tail to classify.

### 3. On failure

Follow §3 → §4 → §5 of the skill. Never silently retry. Always either
heal visibly, restart visibly, OR escalate visibly via `gh pr create
--draft`.
