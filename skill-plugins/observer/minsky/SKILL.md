---
name: minsky
description: Start the Minsky autonomous run loop on the current folder (or a named folder) and observe it from the calling agent session. The caller watches the loop, restarts on transient crash, attempts safe bounded healing only when the fix is obvious (env-var typo, missing directory), logs every action, and — when a failure pattern exceeds the retry budget — swiftly opens a draft P0 PR upstream (Minsky's repo for cross-repo-runner bugs; the host repo for host-side bugs) so the fix-forward loop stays visible to maintainers. Use when the user says "run minsky here", "start minsky", "minsky on this folder", "observe minsky", "watch the minsky loop", or similar.
allowed-tools: Bash, Read, Grep, Glob
---

# Minsky observer

The operator-side wrapper + observer protocol for the Minsky cross-repo
runner. This skill turns the calling agent session (Claude Code, Cursor,
Devin, any agent agentbrew syncs to) into a **safety supervisor** sitting
one layer above `minsky-run`: watches the loop, heals the easy cases,
escalates the hard cases by opening a PR in the right upstream repo.

> **Pattern anchor** — Perrow 1984, *Normal Accidents* (an independent
> monitor outside the primary control loop catches failures the loop
> can't see about itself); Beyer et al. 2016, *Site Reliability
> Engineering* § "Error Budgets" (the retry budget + swift-PR threshold
> are the observer's error-budget enforcement); rule #6 (operator
> escape hatch — the observer never silently degrades, it always either
> heals visibly or escalates visibly).

## 1. Start

Pick the invocation based on the user's intent:

| User intent | Command |
|---|---|
| "run minsky here", "start minsky" (inside a bootstrapped host) | `minsky` |
| "run minsky on ~/apps/foo" | `minsky --host ~/apps/foo` |
| "walk all bootstrapped repos under ~/apps" | `minsky --hosts-dir ~/apps` |
| "dry run / just tell me what it would do" | `minsky --no-live --once` |

`minsky` (the PATH shim) resolves the Minsky repo via `MINSKY_REPO`
env var → `~/apps/tooling/minsky` fallback → common community layouts;
from there it forwards to `novel/cross-repo-runner/bin/minsky-run.mjs`
with autonomous defaults (`--live --loop --cto-audit --seed-on-empty`).
A 3-second countdown banner prints before the first live spawn unless
`MINSKY_NON_INTERACTIVE=1`.

If the host isn't bootstrapped yet, the runner exits 1 with `Run
minsky-bootstrap <host> first`. Run `minsky-bootstrap $(pwd)` and try
again.

## 2. Watch

Capture the runner's stdout — tail it; do NOT block on it. The
autonomous loop prints one banner per host-iteration and one
`iteration record written` line per successful spawn. Watch for the
markers below and classify every 30s tick:

| Signal | Meaning | Observer action |
|---|---|---|
| `stopReason: empty-queue` | Queue drained, either exit or seed | normal; no action |
| `stopReason: max-iterations` | Operator-set cap hit | normal; no action |
| `stopReason: aborted` | SIGTERM received | normal; no action |
| `stopReason: scope-leak` | Spawn wrote outside allowed paths | **halt** — do NOT restart. File upstream PR (§5). |
| `stopReason: spawn-failed` | Non-zero exit from `claude --print` | restart once with 10s backoff; if 3 in 60s, escalate |
| no output for >15 min + process alive | stuck | SIGTERM + restart once; if recurs within 60 min, escalate |
| process exited with no `stopReason` | crash | restart once with 10s backoff; if 3 in 60s, escalate |

Update the operator every 2-3 iterations with a one-line summary
("iteration 7: validated `aifn-840-slash-command-labels` → PR opened;
queue has 3 more P0 tasks").

## 3. Restart (bounded)

`minsky-run` is idempotent by design — restarting it simply picks the
next eligible task. The observer's restart policy:

- **Budget**: ≤3 restarts per 60-minute window per failure class.
- **Backoff**: 10 s, 30 s, 120 s (exponential).
- **Signal**: SIGTERM first (the runner's abort handler drains the
  in-flight iteration); SIGKILL only after a 30 s grace window.
- **State**: always print `restart N of 3 (reason: <class>)` so the
  operator sees every restart. Silent retry is a rule #7 violation.

If the budget is exhausted, STOP — do NOT restart further. Jump to §5
(Swift-PR).

## 4. Safe-heal (very bounded)

The observer may ONLY attempt a code / config fix when ALL of these
hold:

1. The failure pattern is in the catalogue below (exact signal match).
2. The fix is single-file, single-line, and obviously correct to a
   third party reading the repro.
3. The operator confirms (or is absent AND the risk is zero — e.g.
   setting an env var in the current shell).

### Heal catalogue

| Signal (in stderr / banner) | Safe-heal recipe |
|---|---|
| `MINSKY_REPO=<path> but path does not exist` | Unset `MINSKY_REPO` in the current shell + retry. |
| `host is not bootstrapped` | Run `minsky-bootstrap <host>`. Wait for it to finish, then retry `minsky`. |
| `Run minsky-bootstrap <host> first` | Same — run the bootstrap. |
| `node: command not found` | Out of scope — tell the operator to `nvm install 20` and exit. |
| `Rule #9 is iron` (task missing required fields) | Do NOT edit the task. File the task-fix PR upstream (§5) — this is a host-repo content bug, not a runner bug. |

**NEVER**:

- Edit code outside the catalogue.
- Commit to the host repo's `main` branch.
- Push anywhere without the operator's explicit OK.
- Disable a lint / test to make the loop pass.
- Re-interpret a `scope-leak` as safe — it's always unsafe.

## 5. Swift-PR (the escalation path)

When the restart budget is exhausted OR a failure matches the
"escalate immediately" patterns (scope-leak, rule-#9 violation at the
runner level, segfault / panic), open a **draft** P0 PR in the correct
upstream repo within 5 minutes. The speed matters: the operator is
often concurrently editing TASKS.md, so a slow PR risks merge conflicts.

### Picking the upstream repo

| Failure source | Upstream |
|---|---|
| Runner bug (spawn logic, CTO audit, walker, shim) | `~/apps/tooling/minsky` |
| `minsky-bootstrap` / sidecar bug | `~/apps/tooling/minsky` |
| Host-specific (task missing rule-#9 fields, host config broken) | the host repo itself |
| Claude API outage | neither — tell the operator + stop restarting |

If unsure, open it against Minsky — the maintainers can re-route.

### The PR body template

Every observer-filed PR follows this shape (fields in angle brackets
are to be filled by the observer; 4-backtick fence outer block so the
inner code blocks survive the copy-paste):

````markdown
# observer: <one-line failure headline>

## Why this is needed

Seen on `<host-repo-url>` at `<UTC timestamp>`. `minsky-run` produced
the following failure pattern `<N>` times in `<M>` minutes:

```
<redacted stderr tail, ≤40 lines>
```

## Pattern class

`<scope-leak | spawn-failed | rule-9-violation | crash | stuck>`

## Repro

```bash
cd <host-dir>
MINSKY_NON_INTERACTIVE=1 minsky --max-iterations=1 --tick-interval-ms=0
```

## Suggested P0 TASKS.md block

(Paste into TASKS.md if this is the right upstream.)

- [ ] `observer-<short-id>-<date>` — `<task title>`
  - **ID**: `observer-<short-id>-<date>`
  - **Tags**: `p0, observer-filed, <pattern-class>`
  - **Hypothesis**: `<what the observer expects the fix to change>`
  - **Success**: `<measurable threshold>`
  - **Pivot**: `<decision boundary>`
  - **Measurement**: `<runnable command>`
  - **Anchor**: `<literature ref>; rule #<N>`

## Hypothesis self-grade

- **Predicted**: this failure recurs without intervention at rate `<X>`.
- **Observed**: `<N>` occurrences in `<M>` minutes on `<host>`.
- **Match**: partial (need the fix to know if it drops to 0).
- **Lesson**: `<one line>`.

*🤖 Filed by the minsky observer. See Minsky's `skill-plugins/observer/minsky/SKILL.md` § 5.*
````

### The PR creation commands

```bash
# Always draft — rule-9 requires the fix to be human-reviewed.
cd ~/apps/tooling/minsky   # or the host repo
git switch -c observer-<short-id>-$(date +%Y-%m-%d)
# Optional: append the P0 task block to TASKS.md (only for the
# minsky repo itself — don't modify host TASKS.md from outside)
# git add TASKS.md && git commit -m "observer: file <short-id>" ...
git push -u origin HEAD

gh pr create --draft \
  --title "observer: <one-line headline>" \
  --body-file /tmp/observer-pr-body.md
```

**Rate limit**: ≤2 observer PRs per hour per upstream repo. If you'd
exceed the rate, escalate to the operator instead of opening a third
PR — the first two are enough signal to act on.

## 6. Log

Every action the observer takes (restart, heal, PR-open) goes into
`.minsky/observer.log` in the host repo (create the directory if
missing — it's in `.gitignore`). Format: one JSON object per line,
`{ts, action, reason, pid?, pr?}`. Example:

```jsonl
{"ts":"2026-05-12T22:04:17Z","action":"restart","reason":"spawn-failed","pid":4721}
{"ts":"2026-05-12T22:06:42Z","action":"pr-open","reason":"scope-leak-budget-exhausted","pr":"https://github.com/fyodoriv/minsky/pull/493"}
```

This is the audit trail the operator consults when they return to the
session. `.minsky/observer.log` is gitignored by the sidecar bootstrap.

## 7. Stop

When the operator says "stop", "pause", "enough", or the observer hits
a hard escalation boundary:

```bash
minsky stop   # SIGTERM every running minsky-run on this host
```

`minsky stop` is idempotent (`nothing to stop` + exit 0 if nothing is
running). Follow up with `minsky status` to confirm.

## Checklist for the observer

Before considering the observing job done:

- [ ] Loop exited with a known `stopReason` OR was explicitly stopped.
- [ ] `.minsky/observer.log` exists and captures every action.
- [ ] If any PR was filed, its URL was printed to the operator.
- [ ] No silent retries (rule #7 discipline).
- [ ] The operator has a one-sentence summary of what happened.
