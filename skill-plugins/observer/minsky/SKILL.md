---
name: minsky
description: Start the Minsky autonomous run loop and PROACTIVELY monitor it. The caller launches minsky, then enters a monitoring loop — checking health every 30s, reading experiment records for verdicts + PR URLs, healing stale PIDs and spawn failures, restarting on crash, and reporting progress to the operator. Use when the user says "run minsky", "start minsky", "observe minsky", "watch minsky", "monitor minsky", "keep minsky running", or similar. CRITICAL — never block on a long-running command. Always use non-blocking spawns + periodic status checks.
allowed-tools: Bash, Read, Grep, Glob
protocol_version: v1
---

# Minsky observer

You are the **safety supervisor** sitting one layer above the minsky
daemon. Your job: launch it, watch it, heal it, report on it. You are
the operator's eyes while minsky runs autonomously.

## 0. Pre-flight (before starting)

Minsky runs on **any machine** with Node ≥20. It adapts to different
folder layouts, agents (Claude/aider), models, and OS (macOS/Linux)
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
// Machine A: Claude Code + Opus
{ "cloud_agent": "claude", "cloud_agent_model": "claude-opus-4-7-max" }

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
  && ps aux | grep 'claude.*print' | grep -v grep | wc -l | xargs echo "agent procs:" \
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
| `verdict: validated, pr_url: null` | agent worked but no PR | known bug — iterations still useful, will be fixed |
| `verdict: validated, pr_url: https://...` | **PR opened!** 🎉 | report to operator immediately |
| `verdict: spawn-failed, 900...ms` | watchdog killed a slow iteration | known issue — daemon continues automatically |
| `verdict: spawn-failed, <5000ms` | spawn died immediately | check agent auth (`claude --version`) |
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
| **15min watchdog kills** | `spawn-failed` at exactly 900000ms | Slow agent iterations take 5-15min; watchdog is too aggressive. Known P0. Daemon auto-continues. |
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
| **`automated`** | `MODULE_NOT_FOUND` from biome/lefthook (worktree) | `novel/observer/heals/heal-worktree-missing-node-modules.mjs` — detects worktree + missing `node_modules/` + present `package.json`; applies `pnpm install --prefer-offline`. |
| **`automated`** | `.tsbuildinfo` references prior node version | `novel/observer/heals/heal-stale-tsbuildinfo.mjs` — detects via version mismatch in `.tsbuildinfo` JSON; applies via `unlinkSync` per stale file (recursive). |
| `operator-recipe` | `GraphQL: Could not resolve` | Non-fatal. Ignore — gh token context mismatch between launchd and interactive shell. |
| **`automated`** | Shell polled ≥3 times with no new output | `novel/observer/heals/heal-stuck-command.mjs` — invoked by the agent runtime's shell-polling loop (not the daemon). Detects via `pollsWithoutOutput >= 3`; applies via `kill_shell + retry narrowly`. See `templates/AGENTS.md` § "Stuck-command detection & recovery". |
| **`automated`** | `.minsky/state.json` is unparseable (truncated mid-write / JSON syntax error / empty) | `novel/observer/heals/heal-corrupt-state-json.mjs` — detects via `JSON.parse` throw on read; applies via atomic rename to `state.json.corrupt.<ts>` + reseed `{}`; verifies parse succeeds. Idempotent. |
| **`automated`** | `~/.minsky/config.json` is unparseable (truncated mid-write / JSON syntax error / empty) | `novel/observer/heals/heal-partial-config-write.mjs` — detects via `JSON.parse` throw on read; applies via atomic rename to `config.json.corrupt.<ts>` + reseed `{}`; verifies parse succeeds. Idempotent. Scoped to fully-unparseable only — operator-provided fields (cost_tier, etc.) preserved via the backup file. |
| **`automated`** | Cloud agent returns HTTP 429 (rate-limit / too-many-requests) | `novel/observer/heals/heal-agent-rate-limited.mjs` — detects via stderr regex on `rate limit` / `429` / `too many requests` / `rate_limit_error`; applies via sleep-with-exponential-backoff (30s / 60s / 120s injectable); caller re-spawns. After 3 attempts exhausted, escalates to fleet-provider-mode-flip-to-local (`runtime-token-limit-auto-pivot-local-and-back` task). |
| **`automated`** | ollama daemon not running (`ECONNREFUSED 127.0.0.1:11434` or similar) | `novel/observer/heals/heal-ollama-down.mjs` — detects via stderr regex; applies via injected `kickFn` (production: `launchctl kickstart -k gui/$(id -u)/com.minsky.ollama-keepalive` OR `ollama serve &`); verifies via `GET /api/tags`. Idempotent. Refuses heal on sudo-required hosts (Linux system-mode) per pivot. |
| **`automated`** | Network partition mid-spawn (`ENOTFOUND` / `ETIMEDOUT` / `ECONNRESET` / `network unreachable`) | `novel/observer/heals/heal-network-partition-mid-spawn.mjs` — detects via stderr regex; applies via single 30s sleep then signals caller to retry once. If `alreadyRetried` is true on entry, refuses + escalates to fleet-provider-mode-flip-to-local (persistent network failure). Conservative single retry — multiple retries amplify duplicate-spawn risk. |
| **`automated`** | Brief exceeds the model's context window (`context window exceeded` / `input too long` / `prompt_tokens > model_max_input_tokens` / `maximum context length is N tokens`) | `novel/observer/heals/heal-brief-too-long-for-context-window.mjs` — detects via stderr regex; applies via injected `rebuildFn` that production binds to `scripts/build_brief.py --max-tokens=N` (once that flag ships per the `build-brief-supports-max-tokens` follow-up task); verifies via byte-count heuristic (~4 bytes/token). Closes the M1.13 ≥10-automated-heals bar. |

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

When a failure needs a code fix rather than a safe heal, open a swift PR against the upstream repo. Follow [reference/swift-pr.md](reference/swift-pr.md) for picking the upstream repo, the PR body template, and the PR creation commands.

**Always carry the `Protocol version: v<N>` line** in the PR body. It pins each escalation to the observer protocol version it followed.

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

## Recurring cadence (observer-on-self runs without an operator)

This skill is the **operator-initiated** observer. There is also a **weekly**
observer-on-self dogfood that runs without operator action: the GH Actions cron
`.github/workflows/observer-dogfood.yml` invokes
`scripts/observer-dogfood-runner.mjs`, which runs a single bounded
`minsky run --once --no-live --host .` against minsky's own checkout, counts
findings from the same cross-repo experiment-store records this skill's monitor
loop tails (§2), appends a `{run, findings_count, new_tasks_filed}` line to
`data/observer-dogfood-log.jsonl`, and opens a draft PR when findings > 0. The
cadence, ledger schema, and pre-registration live in `RECURRING.md` §
`observer-dogfood` and `experiments/observer-dogfood-recurring-2026-06-02.yaml`.
Continuous verification (Forsgren-Humble-Kim 2018) beats operator-initiated-only
runs — the cadence catches a regression before a user does (Beyer et al. 2016,
Ch. 27 — dogfooding as the pre-user canary).

## Checklist for the observer

Before considering the observing job done:

- [ ] Loop exited with a known `stopReason` OR was explicitly stopped.
- [ ] `.minsky/observer.log` exists and captures every action.
- [ ] If any PR was filed, its URL was printed to the operator.
- [ ] No silent retries (rule #7 discipline).
- [ ] The operator has a one-sentence summary of what happened.

## 8. Tips & tricks (operational knowledge)

Read [reference/tips-and-tricks.md](reference/tips-and-tricks.md) when the monitor loop hits something the steps above do not cover. It covers command timeout discipline, key files to read, per-agent quirks, multi-host walk behavior, interpreting experiment records, testing with the daemon stopped, reading CI results, proactive healing (rule #17), default by default (rule #16), when to commit before starting minsky, and session handoff.

## Changelog

The observer protocol is versioned so every observer-filed PR (§5)
cites the `Protocol version: v<N>` it followed — making each escalation
auditable against the protocol-as-of-that-PR rather than against the
current (possibly evolved) protocol. The version lives in this
SKILL.md's `protocol_version` frontmatter field; bump it here AND in the
frontmatter whenever the protocol changes substantively.

### v1 — initial versioned protocol

The five-section observer protocol the skill carries today:

1. **Watch** (§2 Monitor loop) — non-blocking health probes every
   30-60s, experiment-record reads for verdicts + PR URLs, and the
   signal-classification table.
2. **Restart** (§3 Restart, bounded) — stale-PID cleanup, the
   ≤5-restarts/60-min budget, and the 10s/30s/60s/120s/120s backoff.
3. **Safe-heal** (§4 Safe-heal, very bounded) — the catalogued
   automated/operator-recipe/blocked-by-policy heals, scoped to
   `.minsky/`, `node_modules/`, and `.tsbuildinfo` artefacts only.
4. **Swift-PR** (§5 Swift-PR) — the draft-PR escalation path, the
   upstream-repo picker, the PR-body template (now carrying the
   `Protocol version: v<N>` line), and the ≤2-PRs/hour rate limit.
5. **Log** (§6 Log) — one-JSON-object-per-line audit trail in
   `.minsky/observer.log`.

A version bump (v1 → v2) is warranted when any of these change
substantively: a new top-level section, a changed escalation boundary,
a new heal class promoted to `automated`, or a change to the Swift-PR
upstream-routing table.
