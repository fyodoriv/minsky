---
name: minsky
description: Start the Minsky autonomous run loop and PROACTIVELY monitor it. The caller launches minsky, then enters a monitoring loop — checking health every 30s, reading experiment records for verdicts + PR URLs, healing stale PIDs and spawn failures, restarting on crash, and reporting progress to the operator. Use when the user says "run minsky", "start minsky", "observe minsky", "watch minsky", "monitor minsky", "keep minsky running", or similar. CRITICAL — never block on a long-running command. Always use non-blocking spawns + periodic status checks.
allowed-tools: Bash, Read, Grep, Glob
---

# Minsky observer

You are the **safety supervisor** sitting one layer above the minsky
daemon. Your job: launch it, watch it, heal it, report on it. You are
the operator's eyes while minsky runs autonomously.

## 0. Pre-flight (before starting)

Minsky runs on **any machine** with Node ≥20. It adapts to different
folder layouts, agents (Claude/Devin/aider), models, and OS (macOS/Linux)
via two config sources:

| Config | Location | What it controls |
|---|---|---|
| **Per-machine** | `~/.minsky/config.json` | `cloud_agent`, `cloud_agent_model`, `local_agent`, `local_agent_model`, `ollama_base_url` |
| **Per-repo** | `<repo>/.minsky/repo.yaml` | `host_repo` slug, `branch_prefix`, `tasks_md_path`, `pre_commit_command` |

**Pre-flight checks** — run these before starting on ANY machine:

```bash
# 1. Where is minsky? (auto-resolved, but verify)
which minsky || echo "minsky not on PATH — add bin/minsky to PATH or set MINSKY_REPO"
# 2. What config does THIS machine have?
cat ~/.minsky/config.json 2>/dev/null || echo "no config — minsky will prompt or use defaults (claude)"
# 3. Kill anything stale
minsky stop 2>/dev/null; rm -f ~/.minsky/daemon.pid
# 4. Which agents are available on this machine?
claude --version 2>&1 | head -1 || echo "no claude"
devin --version 2>&1 | head -1 || echo "no devin"
which ollama >/dev/null && ollama list 2>/dev/null | head -3 || echo "no ollama"
# 5. Check disk space and machine load
df -h / | tail -1; uptime
```

**CRITICAL**: check `~/.minsky/config.json` first. The `cloud_agent`
field determines which agent runs. NEVER override it with an env var
unless the operator explicitly says to — the config file is the source
of truth for this machine.

**Different machines, different configs** — examples:

```jsonc
// Machine A: Devin + Opus (Windsurf machine)
{ "cloud_agent": "devin", "cloud_agent_model": "claude-opus-4-7-max" }

// Machine B: Claude Code + Sonnet (daily driver)
{ "cloud_agent": "claude", "cloud_agent_model": "claude-sonnet-4-5" }

// Machine C: local-only (GPU server, no cloud)
{ "local_agent": "aider", "local_agent_model": "ollama_chat/qwen3-coder:30b" }
```

If `~/.minsky/config.json` doesn't exist, minsky defaults to `claude`
for cloud and `aider` for local. The interactive model-cost picker
(planned) will create this file on first run.

## 1. Start

**Always use `--daemon` mode** so minsky survives terminal close.
**Always use `--host <dir>` for a specific repo** — NOT `--hosts-dir`
unless the operator explicitly asked for multi-repo mode. The most
common mistake is launching `--hosts-dir` when the operator wanted
a single repo. When in doubt, ask.

| User intent | Command |
|---|---|
| "run minsky on minsky" / "minsky on itself" | `minsky daemon start --host $MINSKY_REPO` (or wherever minsky is cloned) |
| "run minsky here" (from inside a repo) | `minsky daemon start --host $(pwd)` |
| "run minsky on ~/apps/foo" | `minsky daemon start --host ~/apps/foo` |
| "run minsky on ALL repos" (explicit) | `minsky daemon start --hosts-dir <parent-dir>` |
| "dry run" | `minsky --no-live --once` (blocking OK for dry-run) |

**Path resolution**: `minsky` (the PATH shim) auto-discovers the minsky
repo via `$MINSKY_REPO` env → `<minsky-repo>` → `~/apps/minsky`
→ `~/code/minsky` → `~/src/minsky`. If your layout differs, set
`export MINSKY_REPO=/your/path/to/minsky` in your shell profile.

After starting, **immediately verify TWO things**:

1. The daemon is running (`running (PID ...)`)
2. It targets the **correct folder** (check the `--host` or `--hosts-dir` in the process args)

```bash
minsky daemon start --host <TARGET_REPO> 2>&1
sleep 3
# Verify: must show "running" AND the correct --host path
minsky status 2>&1 | head -5
ps aux | grep minsky-run | grep -v grep | head -1
# ^^^ the process args must contain the folder the operator requested
```

**Target verification** — if the process args show a different folder
than the operator requested, STOP and restart with the correct `--host`:

```bash
# WRONG: operator said "minsky on minsky" but daemon shows --hosts-dir
minsky stop 2>&1 || true; rm -f ~/.minsky/daemon.pid
minsky daemon start --host <CORRECT_REPO> 2>&1
```

If `minsky status` shows "stale PID file", clean up and retry:

```bash
rm -f ~/.minsky/daemon.pid
minsky daemon start --host <TARGET_REPO> 2>&1
```

## 2. Monitor loop (the core of this skill)

**NEVER block on a minsky command.** NEVER `sleep` for more than 30s.
Poll status and logs with short commands:

### Health check (run every 30-60s)

```bash
# One-liner health probe — checks running + correct target + agent activity
minsky status 2>&1 | head -3 \
  && echo "target: $(ps aux | grep minsky-run | grep -v grep | grep -oE '\-\-host[s-dir]* [^ ]+' | head -1)" \
  && ps aux | grep 'devin.*print\|claude.*print' | grep -v grep | wc -l | xargs echo "agent procs:" \
  && tail -3 ~/.minsky/daemon.log
```

**CRITICAL**: every health check must confirm the `target:` line shows
the folder the operator requested. If it shows `--hosts-dir` when the
operator wanted `--host <specific-repo>` (or vice versa), the daemon is
running on the **wrong target** — stop and restart immediately.

### Read iteration results (the real signal)

```bash
# Find all experiment records — use the host dir the daemon is targeting
HOST_DIR="$(ps aux | grep minsky-run | grep -v grep | grep -oE '\-\-host [^ ]+' | awk '{print $2}' | head -1)"
for f in "$HOST_DIR"/.minsky/experiment-store/cross-repo/*.jsonl; do
  [ -f "$f" ] || continue
  tail -1 "$f" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'{d[\"host_repo\"]:30} v={d[\"verdict\"]:12} pr={d.get(\"pr_url\") or \"null\":8} {d[\"notes\"][:40]}')" 2>/dev/null
done
```

### Signal classification

| Signal | Meaning | Action |
|---|---|---|
| `running (PID ...)` in status | healthy | verify target folder matches operator request |
| `stale PID file` in status | daemon died | clean PID + restart (§3) |
| target shows wrong `--host` or `--hosts-dir` | **wrong target** | **stop immediately** + restart with correct `--host` |
| `recs` count increasing | iterations completing | healthy — report to operator |
| `verdict: validated, pr_url: null` | devin worked but no PR | known bug — iterations still useful, will be fixed |
| `verdict: validated, pr_url: https://...` | **PR opened!** 🎉 | report to operator immediately |
| `verdict: spawn-failed, 900...ms` | watchdog killed a slow iteration | known issue — daemon continues automatically |
| `verdict: spawn-failed, <5000ms` | spawn died immediately | check agent auth (`claude/devin --version`) |
| `verdict: scope-leak` | agent touched files outside declared scope | **normal** — soft mode logs the out-of-scope files + preserves the PR. Only investigate if the same files leak 3+ times. |
| daemon process gone, no stale PID | clean exit | check `stopReason` in log, restart if needed |
| no new records for 20+ min | stuck iteration | check if agent process is alive; if CPU=0% for 5min, SIGTERM daemon + restart |

### Report to operator

Every 2-3 iterations, give a **one-line** summary:

> "minsky: 3 iterations on agentbrew (2 validated, 1 watchdog-killed), now on dotfiles. Daemon healthy 15min. 0 PRs opened (known bug)."

## 3. Restart (bounded)

### Stale PID cleanup (most common issue)

```bash
minsky stop 2>&1 || true
rm -f ~/.minsky/daemon.pid
sleep 2
minsky daemon start --host <TARGET_REPO> 2>&1
sleep 3
minsky status 2>&1 | head -3   # verify
```

### Restart policy

- **Budget**: ≤5 restarts per 60-minute window.
- **Backoff**: 10s, 30s, 60s, 120s, 120s.
- **Always** clean the PID file before restart.
- **Always** verify with `minsky status` after restart.
- **Always** print: `⚠️ restart N/5 (reason: <class>)`.

If budget exhausted → **STOP** and jump to §5 (Swift-PR).

## 3b. Anti-stuck patterns (learned 2026-05-18)

| Pattern | Symptom | Fix |
|---|---|---|
| **Stale PID** | `minsky daemon start` says "already running" but status says "stale" | `rm -f ~/.minsky/daemon.pid` then retry |
| **Walker stuck on one host** | daemon.log shows same host for 10+ iterations | Per-host cap should be 3 (fixed 2026-05-18); if still stuck, restart daemon |
| **Devin stdin panic** | `spawn-failed` at <5s, stderr "unexpected argument" | Fixed 2026-05-18 (`--prompt-file` instead of stdin). If seen, pull latest minsky and rebuild. |
| **15min watchdog kills** | `spawn-failed` at exactly 900000ms | Devin iterations take 5-15min; watchdog is too aggressive. Known P0. Daemon auto-continues. |
| **GraphQL errors** | `Could not resolve to a Repository` in log | Cosmetic — gh token context mismatch. Non-fatal. Ignore. |
| **Two minsky-run processes** | `ps aux` shows 2 PIDs for minsky-run | `minsky stop` kills all; old daemon wasn't fully terminated. Always verify with `ps aux` after stop. |
| **scope-leak from dirty tree** | `scope-leak` after you edited files | Commit your changes first, then restart. Minsky detects uncommitted changes as scope violations. |

## 4. Safe-heal (very bounded)

The observer may attempt a code / config fix when ALL of these hold:

1. The failure pattern is in the catalogue below (exact signal match).
2. The Status column says `automated` — call the helper at the listed
   path. Status `operator-recipe` means run the recipe text manually.
   Status `blocked-by-policy` means escalate; do NOT automate.
3. For `automated` heals: the helper writes only to `.minsky/`,
   `node_modules/`, or `.tsbuildinfo` artifacts (regeneratable by
   definition). NEVER to source code, NEVER outside the worktree.

After this PR (M1.13 phase 1): **11 catalogued failure modes**,
classified as **4 automated**, **6 operator-recipe**, **1
blocked-by-policy**. Phase 2 (`promote-remaining-heal-recipes`)
promotes the remaining 6 where policy allows.

### Heal catalogue

| Status | Signal (in stderr / banner) | Safe-heal recipe |
|---|---|---|
| `operator-recipe` | `MINSKY_REPO=<path> but path does not exist` | Unset `MINSKY_REPO` in the current shell + retry. (Shell env in user's interactive session — promotion blocked by policy.) |
| `operator-recipe` | `host is not bootstrapped` | Run `minsky-bootstrap <host>`. Wait for it to finish, then retry `minsky`. |
| `operator-recipe` | `Run minsky-bootstrap <host> first` | Same — run the bootstrap. |
| `blocked-by-policy` | `node: command not found` | Out of scope — tell the operator to `nvm install 20` and exit. Promotion permanently blocked (modifying user shell env is out-of-policy). |
| `operator-recipe` | `Rule #9 is iron` (task missing required fields) | Do NOT edit the task. File the task-fix PR upstream (§5) — this is a host-repo content bug, not a runner bug. |
| **`automated`** | `stale PID file (PID XXXX not running)` | `novel/observer/heals/heal-stale-pid.mjs` — detects via `kill(0, pid) → ESRCH`, applies via `unlinkSync(pidPath)`. The #1 most common issue. |
| `operator-recipe` | `daemon already running (PID XXXX)` | Check `kill -0 XXXX 2>/dev/null`; if dead, the stale-pid heal above runs; if alive, the daemon is fine. |
| `operator-recipe` | `unexpected argument` from devin | Minsky build is stale — `cd $MINSKY_REPO && pnpm install && pnpm typecheck`. The `--prompt-file` fix must be compiled. |
| **`automated`** | `MODULE_NOT_FOUND` from biome/lefthook (worktree) | `novel/observer/heals/heal-worktree-missing-node-modules.mjs` — detects worktree + missing `node_modules/` + present `package.json`; applies `pnpm install --prefer-offline`. |
| **`automated`** | `.tsbuildinfo` references prior node version | `novel/observer/heals/heal-stale-tsbuildinfo.mjs` — detects via version mismatch in `.tsbuildinfo` JSON; applies via `unlinkSync` per stale file (recursive). |
| `operator-recipe` | `GraphQL: Could not resolve` | Non-fatal. Ignore — gh token context mismatch between launchd and interactive shell. |
| **`automated`** | Shell polled ≥3 times with no new output | `novel/observer/heals/heal-stuck-command.mjs` — invoked by the agent runtime's shell-polling loop (not the daemon). Detects via `pollsWithoutOutput >= 3`; applies via `kill_shell + retry narrowly`. See `templates/AGENTS.md` § "Stuck-command detection & recovery". |
| **`automated`** | `.minsky/state.json` is unparseable (truncated mid-write / JSON syntax error / empty) | `novel/observer/heals/heal-corrupt-state-json.mjs` — detects via `JSON.parse` throw on read; applies via atomic rename to `state.json.corrupt.<ts>` + reseed `{}`; verifies parse succeeds. Idempotent. |

**MTTR for automated heals** is published as `mttr-self-heal` in
METRICS.md. Source: `.minsky/heal-events.jsonl` per host, aggregated
by `node scripts/heal-mttr-report.mjs --window=30d --json`.

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
| Runner bug (spawn logic, CTO audit, walker, shim) | the minsky repo (`$MINSKY_REPO`) |
| `minsky-bootstrap` / sidecar bug | the minsky repo (`$MINSKY_REPO`) |
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
cd $MINSKY_REPO   # or the host repo
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

## 8. Tips & tricks (operational knowledge)

### Command timeout discipline

**NEVER run a minsky command as a blocking call that could hang.**
Every command should complete in <30s or be run non-blocking:

- `minsky status` — always fast (<2s). Safe to block.
- `minsky stop` — fast (<5s). Safe to block.
- `minsky daemon start` — returns immediately (daemon backgrounds). Safe.
- `minsky --host X --once --no-live` — can take minutes. Run non-blocking or with a timeout.
- `minsky --host X --once --live` — can take 5-15 min. NEVER block on this.
- `tail -N ~/.minsky/daemon.log` — always fast. Safe.
- `ps aux | grep devin` — always fast. Safe.

### Key files to read

| File | What it tells you |
|---|---|
| `~/.minsky/config.json` | Which agent + model this machine uses |
| `~/.minsky/daemon.log` | Daemon stdout — host walks, experiment writes |
| `~/.minsky/daemon.pid` | PID of the running daemon (stale = daemon died) |
| `<host>/.minsky/experiment-store/cross-repo/*.jsonl` | Per-task iteration records (verdict, PR URL, duration) |
| `<host>/.minsky/experiments/*.yaml` | Per-task experiment YAML (hypothesis, measurement) |
| `<host>/.minsky/observer.log` | Your own audit trail |
| `<host>/.minsky/repo.yaml` | Host config (repo slug, branch prefix, pre-commit) |

### Per-agent quirks

**Devin** (`cloud_agent: "devin"`):

- Brief delivery: `--prompt-file` (NOT stdin — devin panics on stdin pipe).
- Typical iteration time: 5-15 min (longer than Claude due to API routing).
- Watchdog: 900s (15 min) default — will kill slow-but-productive iterations. Known P0.
- PR creation: devin needs explicit instructions in the brief to run `gh pr create`.
- Permission mode: `--permission-mode dangerous` (unattended daemon).

**Claude Code** (`cloud_agent: "claude"`):

- Brief delivery: stdin (`child.stdin.end(brief)`).
- Typical iteration time: 3-10 min.
- Watchdog: 900s default, overridable via `MINSKY_CLAUDE_PRINT_TIMEOUT_MS`.
- May hang with 0% CPU — the 2026-05-07 hang ran 1h56m. The watchdog exists for this.

**Aider / local** (`--local` mode):

- Brief delivery: `--message-file` (written to temp file).
- Typical iteration time: 10-30 min (local models are slower).
- Watchdog: 1800s (30 min) default.
- Requires ollama running: `ollama serve` must be active.

### Multi-host walk behavior

- Hosts are walked **alphabetically** by directory name.
- Each host gets **at most 3 iterations** per walk pass (per-host cap).
- After all hosts are drained, the walker **loops** (starts over from the first host).
- `spawn-failed` on one host **skips** to the next (doesn't halt the walk).
- `scope-leak` on any host **halts** the entire walk.
- `empty-queue` on a host → advance to next host.

### Interpreting experiment records

```bash
# Quick session summary
# Adjust the path to match your hosts-dir or single --host target
for f in <HOSTS_DIR>/*/.minsky/experiment-store/cross-repo/*.jsonl; do
  [ -f "$f" ] || continue
  total=$(wc -l < "$f")
  validated=$(grep -c '"validated"' "$f")
  failed=$(grep -c '"spawn-failed"' "$f")
  prs=$(grep -c '"pr_url":"http' "$f")
  host=$(basename "$(dirname "$(dirname "$(dirname "$(dirname "$f")")")")")
  task=$(basename "$f" .jsonl)
  echo "$host/$task: $total total, $validated validated, $failed failed, $prs PRs"
done
```

### Always test with daemon stopped

After any change to `bin/minsky`, test BOTH states:

```bash
minsky stop; rm -f ~/.minsky/daemon.pid   # daemon off
minsky watch                               # must not crash
minsky status                              # must not crash
minsky daemon start --host $(pwd)              # start
minsky watch                               # must render with data
```

The empty-state path (no daemon, no PID, no log) is where most
`unbound variable` bugs hide. `set -u` catches them but only at
runtime.

### Reading CI results (integration + runtime tests)

CI runs 4 test layers. Check them before concluding "tests pass":

```bash
# Quick: did the last push's CI pass?
gh run list --limit 1 --json conclusion,name --jq '.[0]'

# Detailed: which jobs passed/failed?
gh run view --json jobs --jq '.jobs[] | {name, conclusion}'

# Integration test results specifically:
gh run view --json jobs --jq '.jobs[] | select(.name == "integration-tests") | {conclusion, steps: [.steps[] | {name, conclusion}]}'

# Download M1 metrics artifact from CI:
gh run download --name m1-metrics --dir /tmp/m1-ci-metrics
cat /tmp/m1-ci-metrics/m1-metrics.json | python3 -m json.tool
```

**CI jobs and what they cover:**

| Job | What it tests | Timeout |
|---|---|---|
| `test` | Unit tests + v8 coverage (3000+ tests) | 5min |
| `integration-tests` | Fixture-driven e2e + M1 TDD suite | 10min |
| `markdownlint` | Markdown formatting | 1min |
| `typecheck` | TypeScript compilation | 2min |

**Local equivalents:**

```bash
pnpm test                    # unit tests (fast)
pnpm test:integration        # integration tests (slow, 120s timeout)
pnpm test:m1-tdd             # M1 red-green acceptance tests
`bin/minsky m1 metrics`              # which M1 measurements pass
`bin/minsky m1 observability`        # which M1 tasks have observability gaps
`bin/minsky m1 coverage`             # 6-layer composite coverage number
```

### Proactive healing — observe-and-fix is ONE action (rule #17 — iron, no exemption)

**You don't observe errors. You fix them.** Every error surfaced by the
daemon, by `pnpm test`, by `pnpm typecheck`, by `gh pr checks`, by
`minsky status`, by ANY tool while watching minsky is treated as work
to be done in the SAME session, not noted for later.

The discipline:

1. **Observation = work item.** When you see `GraphQL 401`, `spawn-failed`,
   `ETIMEDOUT`, `scope-leak`, stack traces, hung processes, stale state —
   you do not "make a mental note", you do not "we'll address this next
   sprint". You do not even ask whether to fix it. You FIX IT NOW or you
   file a structured task block with `**Blocked**:` if completing it
   needs an external action — but never both: never silently move on.

2. **Fix the class, not the instance.** A 401 today means the auth path
   is fragile. Don't restart and pray — find the swallowing-catch, the
   missing timeout, the unbounded retry, the un-deduped error spam. Each
   fix lands as: (a) a failing test that reproduces the class, (b) the
   smallest minimal patch, (c) the lint rule or invariant that prevents
   the entire category from recurring. Rule #10 enforcement is the goal:
   "the same bug cannot reach CI twice." Anchor: Forsgren, Humble, Kim,
   *Accelerate*, 2018 (DORA — change-fail rate is reduced by preventing
   classes, not patching instances).

3. **Heal before reporting.** Every status message to the operator must
   already contain the verb "fixed", "patched", "rolled out", or
   "filed-blocked-because". A status that's only "I observed X" is a
   constitutional violation of rule #17 — it shifts work onto the
   operator the agent could have done.

4. **The same loop applies to minsky itself.** When the daemon spits a
   recurring failure mode (`spawn-failed` × 5, `scope-leak` × 3), the
   observer's next action is to: (a) read the root cause from
   `~/.minsky/daemon.log`, (b) land a fix in `novel/cross-repo-runner/`
   or `novel/tick-loop/` with a failing-test-first per rule #3, (c)
   `minsky update` to roll it forward, (d) re-verify stability rises.
   File a TASKS.md block ONLY if the fix requires external action
   (a credential, a sysctl, an upstream PR) — in which case the block
   carries `**Blocked**: <code>` and the unblock path is the first line.

5. **Anti-pattern: the watcher who narrates.** A monitoring session that
   produces a 10-bullet summary of failures and zero merged fixes is the
   exact thing rule #17 forbids. It looks like attentive work; it's
   actually load shed to the operator. The deterministic gate is:
   *if observed-errors > 0 and PRs-opened + tasks-filed = 0, the
   session is a violation.* Lint: `scripts/check-rule-17-proactive-heal.mjs`
   (P0, TASKS.md `rule-17-proactive-heal-lint`).

This is the same shape as rule #6 ("stay alive"; let-it-crash +
supervisor restart) but elevated to the observer's own conduct: if the
observer is silently degrading by watching-without-fixing, the
supervisor (the operator) loses information about the real failure
rate.

**Trigger phrases that activate rule #17 IMMEDIATELY (don't ask, just
fix):**

- "fix bugs before they happen" / "be proactive"
- "make sure minsky gracefully picks them up"
- "heal minsky on the way"
- "make it persist" / "make it iron rule"

Sources: Forsgren/Humble/Kim, *Accelerate*, 2018 (change-fail rate);
Beyer et al., *SRE*, 2016, Ch. 3 (error budgets — observation that
doesn't move the budget is dead weight); Armstrong, *Programming Erlang*,
2007 (let-it-crash applies to the observer itself); operator directive
2026-05-19 ("why aren't they being fixed by you right away? I expect
that"); rule #6 (stay alive); rule #10 (deterministic enforcement);
rule #16 (default by default — proactive healing is the default
observer behaviour, not an opt-in mode).

### Default by default (rule #16 — always follow)

Every new behavior ships as the default. Never hide behind an opt-in flag.

- If it's reasonable for all users → make it the default NOW
- Ship with: experiment + measurement + opt-out (for debugging only)
- The question is "why ISN'T this the default?" — not "should we enable it?"
- Opt-out flags go to DEPRECATED.md the moment they're never used

Examples already shipped:

- Scope-leak soft mode → default (daemon never halts on scope-leak)
- Launchd persistence → auto-installed on first `minsky` run
- Dynamic timeouts → computed from iteration history, not hardcoded
- Smart auto-attach → type `minsky` → it just works
- Stale PID cleanup → automatic on daemon startup

**When implementing a task**: if you catch yourself writing `MINSKY_ENABLE_X=1`,
stop — make X the default and write `MINSKY_DISABLE_X=1` as the escape hatch
instead. Then immediately file that escape hatch in DEPRECATED.md.

### When to commit before starting minsky

If you've made changes to the minsky repo (or any host repo) that are
uncommitted, **commit them first**. The scope-leak detector will flag
uncommitted changes as violations and halt the walk. This is the #1
cause of `scope-leak` in dogfood mode.

### Session handoff

If you're ending your agent session but minsky should keep running:

1. Verify `minsky status` shows running.
2. The daemon is SIGHUP-immune — it survives terminal close.
3. Log the current state: `minsky status 2>&1 > /tmp/minsky-handoff.txt`
4. Tell the next session: "minsky daemon PID XXXX is running on
   <hosts-dir>. Config: <agent> + <model>. Check `minsky status` and
   `tail ~/.minsky/daemon.log`."
