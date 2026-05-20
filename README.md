# Minsky

> A background daemon that runs AI coding agents against tasks in any git repo.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

Minsky attaches to a git repo and improves it over time, applying scientifically proven software-engineering practices — TDD, MAPE-K, hypothesis-driven development, let-it-crash supervision, error budgets — each backed by a literature citation ([PRACTICES](docs/PRACTICES.md)). It identifies issues, works on each one until it's fixed, then researches what to do next — by default it runs until you stop it.

**[Seven reasons you'd want this →](#why-minsky)** &nbsp;·&nbsp; Or skip to [getting started](#getting-started).

## Getting started

**Recommended — let your agent install it.** If you're inside Claude Code, Cursor, Windsurf, Devin, Codex, or any AI coding agent that can read files and run commands, paste this:

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

The agent reads [INSTALL.md](./INSTALL.md), clones minsky, registers your current folder as the host, asks you once about anonymized telemetry, and starts the daemon. Total: ~60 seconds, one human prompt.

**Manual install** — for when you don't have an agent handy:

```bash
git clone https://github.com/fyodoriv/minsky.git ~/apps/tooling/minsky
cd ~/apps/tooling/minsky && pnpm install && bin/minsky
```

The first run installs launchd persistence so minsky survives reboots; later runs in the same folder attach to the existing daemon. `Ctrl-C` detaches the dashboard without stopping the daemon; `minsky stop` shuts everything down (zero ghost processes).

## What it actually does

1. Reads `TASKS.md` from your **host** repo (the [tasks.md spec](https://github.com/tasksmd/tasks.md))
2. Picks the highest-priority task with complete rule-9 fields
3. Spawns Devin, Claude, or a local model (configurable per machine)
4. The agent implements the task on a feature branch
5. Opens a PR with a hypothesis self-grade
6. Records the iteration in `.minsky/experiment-store/` (inside the host repo)
7. Picks the next task. Repeats.

> **What's a "host"?** A host is a single git repository that minsky operates on — picks tasks from its `TASKS.md`, spawns agents inside its worktree, opens PRs against its remote. Selected via `default_host` in `~/.minsky/config.json`, or `--host <path>` flag, or the current working directory by default. Multi-host mode (`--hosts-dir <parent>`) walks every git repo under one parent directory in round-robin (3 iterations per host per pass).

## Why Minsky?

Seven things you get with minsky running on a repo:

- **Continuous, unattended repo improvement — with safety guards that hold.**
  Minsky reads `TASKS.md`, picks the highest-priority task with complete rule-9 fields, and gets to work. Every PR is a draft for your review; every iteration passes 15 lint gates including secret-scan, scope-discipline (rule #12), and security review (rule #13). No agent can push to `main`. No PR merges without your approval. The safety boundary is mechanical — enforced by deterministic linters, not by agent good behaviour.

- **Issues your agents notice get surfaced — instead of buried in logs.** *(opt-out via `MINSKY_CTO_AUDIT=off`)*
  After each iteration, an optional CTO-audit pass (`novel/cross-repo-runner/src/host-cto-audit.ts`) reviews the diff for things worth tracking — a test that started flaking, a deprecation warning, a TODO that's been around for 6 months. Anything it spots becomes a draft TASKS.md entry for your review. You decide what's worth keeping; the daemon never silently mutates your backlog.

- **Match the model to the task — pay Sonnet prices only for Sonnet work.** *(per-task backend today; multi-persona pipelines are an M2 milestone)*
  Minsky picks the agent backend per task (`novel/tick-loop/src/llm-provider-spawn-strategy.ts`): claude for prose-heavy work, devin for cross-repo refactors, local for mechanical lint fixes. You don't pay $4 for an iteration that a $0.20 model could have done. The "researcher → planner → implementer → QA → reviewer" pipeline on a single task is in flight as M2.

- **"Don't reinvent the wheel" enforced at PR time.** *(rule #1, enforced)*
  `scripts/check-rule-1-novel-justification.mjs` rejects any new `novel/` code whose README doesn't cite the existing libraries considered and explain why each didn't fit. Every PR ships with a research trail you can audit before you merge. Forced research, mechanically.

- **A tool that improves itself.**
  Minsky reads its own daemon metrics every iteration, files tasks against its own stability, and ships fixes through the same agent backends operators use. The daemon refactors the daemon — most P0s in this repo's `TASKS.md` were surfaced by daemon iterations.

- **Keep iterating when the cloud agent runs dry.** *(detection today; mid-run swap is P0 `runtime-token-limit-auto-pivot-local-and-back`)*
  When the cloud agent returns "quota exceeded", minsky detects exhaustion (`novel/tick-loop/src/claude-exhaustion-state.ts`) and swaps to a local Ollama model so the loop keeps making progress. When your tokens return, minsky swaps back. The loop never stops because you ran out of budget.

- **Async Q&A that respects your timezone.** *(P0 `minsky-human-comm-via-file`)*
  Agents drop questions into `.minsky/qa-log.md`. You answer when you open your laptop — by editing the file. The agent picks up your answer via `fs.watch` and continues. No sync meeting, no 4-hour-blocked iteration, no daily DMs to chase.

## Why "Minsky"?

Marvin Minsky (1927–2016) was a cognitive scientist whose 1986 book *The Society of Mind* proposed that intelligence emerges from many simple specialized agents working together. The tool borrows the metaphor: many AI agents working through a shared queue produce more than any single agent could.

## What works today (honest)

| Capability | Status | Confidence |
|---|---|---|
| Pick tasks from TASKS.md and spawn agents | ✅ Works | High — 26+ iterations |
| Open PRs autonomously | ✅ Works | PR #644 opened by devin |
| Walk multiple repos (3 iterations per host) | ✅ Works | Per-host cap, fair scheduling |
| Dynamic watchdog (adapts to machine speed) | ✅ Works | p95 × 1.5 from history |
| Live dashboard (`minsky watch`) | ✅ Works | Stability %, iterations, human-help |
| Survive reboots (launchd KeepAlive) | ✅ Works | Auto-installed on first run |
| One-command update (`minsky update`) | ✅ Works | Stop → pull → rebuild → restart |
| Zero ghost processes on stop | ✅ Works | Kills runners + agent children |
| Per-machine agent config | ✅ Works | `~/.minsky/config.json` |
| Switch between Devin, Claude, local models | 🟡 Partial | Claude primary, Devin experimental |
| 8h unattended runs with >90% stability | 🟡 In progress | Currently ~24%, improving |
| File-based human↔agent Q&A | 🔴 Not yet | P0 `minsky-human-comm-via-file` |
| `npx minsky` one-command install+run | 🔴 Not yet | P1 `minsky-npx-install-and-run` |
| Multi-file refactors | 🔴 Not yet | M2 milestone |
| GitHub Actions CI | 🔴 Not yet | M3 milestone |

## What it will NEVER do

- **Security-sensitive changes** — marked human-blocked, always
- **Destructive operations** (force push, delete, deploy) — hard-blocked
- **Architecture decisions** — files research tasks for humans
- **Run without your approval** — every PR is a draft, you review

## Principles

- **Soft by default** — when an iteration produces a scope-leak or spawn-failed verdict, the daemon logs it and moves on; it doesn't halt the whole loop. Halting on every weird event would mean a single bad task can wedge the daemon for the entire night you're asleep.
- **Sensible defaults, escape hatches for debugging** — every behaviour that is universally helpful ships **on** by default (launchd auto-install on first run, scope-leak soft-mode, dynamic timeouts, auto-install on `git pull`). Opt-out env vars exist (`MINSKY_NO_AUTO_INSTALL=1` etc.) but are intended only for debugging. Each default is **scoped** to a specific trigger so two defaults never compete.
- **Gradual improvement** — `minsky update` after every fix; the daemon resumes from the same task it was working on. Iteration history is preserved across restarts.
- **Honest metrics** — stability % is computed from real iteration data (`successful / total`); never a hand-typed number, never a stub.
- **Test the runtime, not just functions** — 95% unit coverage doesn't catch the bugs that bite production (auth env vars missing, plist sibling-vs-dict, GH 401 crash). Runtime invariants check the actual system before every iteration.

## How long does it run?

**Forever, by default.** There is no built-in time limit. The daemon:

- Survives reboots — launchd / systemd respawn it on boot (`KeepAlive=true`)
- Survives crashes — the supervisor respawns the daemon on any non-zero exit
- Survives terminal close — the parent process traps `SIGHUP` so closing your IDE doesn't kill it
- Survives token limits — when claude hits its quota, minsky auto-switches to local models and keeps going (tracked in P0 `runtime-token-limit-auto-pivot-local-and-back`)
- Survives empty queues — see below

The only ways to stop it are: `minsky stop`, machine power-off, or `minsky uninstall`.

Cap the runtime explicitly with `--max-iterations=N` (default: `Infinity`) or stop after one task with `minsky --once`.

## What if `TASKS.md` is empty or doesn't exist?

Minsky doesn't sit idle. The default flow is `--seed-on-empty` (on by default):

1. **`TASKS.md` missing** — `minsky init` creates a starter `TASKS.md` with the tasks.md spec headers and one example task.
2. **`TASKS.md` exists but no rule-#9-compliant tasks are left** — minsky runs a **CTO audit**: reads the repo (test count, lint health, doc coverage, dependency age, security warnings), proposes new tasks based on what it finds, and writes them back to `TASKS.md`. Then picks one of the newly-seeded tasks and starts working.
3. **CTO audit produces zero tasks too** — minsky exits the iteration with `empty-queue` and waits for the next tick (default 5 min) before retrying.

Opt out with `--no-seed-on-empty` — minsky will then halt cleanly when the queue runs dry.

## How does minsky talk to humans?

Today, three channels:

1. **Draft PRs** — every task ships as a draft PR you review. The agent's PR body includes a `self-grade` block with hypothesis + measurement + risk.
2. **`Blocked` markers in `TASKS.md`** — when an agent encounters a step it can't safely automate (security-sensitive change, force push, vendor selection), it adds `**Blocked**: needs-user-approval — <reason>` to the task block and moves on. Grep your `TASKS.md` for `Blocked` to see what's waiting on you.
3. **Daemon log** — `~/.minsky/daemon.log` tails warnings (`spawn-failed`, `scope-leak`, `gh 401`). View live via `minsky watch`.

**Coming soon — fast file-based Q&A** (P0 `minsky-human-comm-via-file`): a `.minsky/qa-log.md` file the agent writes questions to and watches for your answers. You edit the file in your normal editor and save; the agent picks up your answer within 500 ms. Designed for back-and-forth that's too quick for a PR review but too detailed for a TASKS.md `Blocked` field.

## CLI reference

```bash
minsky                    # start-or-attach: daemon + auto-install persistence + dashboard
minsky watch              # attach to live dashboard (Ctrl-C detaches, daemon keeps running)
minsky status             # quick health: PID, uptime, stability %
minsky logs               # tail daemon log
minsky stop               # thorough shutdown (launchd + runners + agents)
minsky update             # stop → git pull → rebuild → restart from same spot
minsky doctor             # check host readiness (node, git, gh, config, agents)
minsky report             # baseline / delta against .minsky/metric-snapshots/
minsky benchmark          # run the cross-repo runner N times and report pass-rate
minsky init               # one-command bootstrap on any git repo
minsky uninstall          # full removal (dry-run by default; --force to delete)
minsky install-daemon     # install launchd plist (auto-done on first run)
minsky uninstall-daemon   # remove launchd plist only (preserves config + logs)
```

## Configuration

Per-machine config at `~/.minsky/config.json`:

```json
{
  "cloud_agent": "devin",
  "cloud_agent_model": "claude-opus-4-7-max",
  "default_host": "/path/to/your/repo"
}
```

- **`cloud_agent`** — which CLI runs in cloud mode: `devin` | `claude`
- **`cloud_agent_model`** — passed as `--model` to the cloud agent
- **`default_host`** — the git repo minsky operates on by default (the "host"). Override per-invocation with `--host <path>`.

### Agent comparison

| Agent | Mode | How brief is sent | Strengths | Recommended for |
|---|---|---|---|---|
| `claude` | Cloud (Anthropic subscription) | stdin | Highest task-completion rate; OAuth/keychain auth | Default cloud workload |
| `devin` | Cloud (Windsurf subscription) | `--prompt-file` (stdin panics) | Polished IDE-style PR output | Cloud workload when claude is rate-limited |
| `aider` | Local (Ollama / MLX) | `--message-file` | $0 cost, runs on M-series Mac | Token-budget fallback; long sessions |

Switch agents with `MINSKY_CLOUD_AGENT=devin minsky` (one-shot) or edit the config (persistent). When the cloud budget hits zero, minsky auto-falls-back to the local agent (P0 `runtime-token-limit-auto-pivot-local-and-back` makes this seamless).

## Architecture (30 seconds)

```text
minsky (bash CLI shim)
  ↓
cross-repo-runner (minsky-run.mjs) — walks hosts, picks tasks, spawns agents
  ↓
Devin / Claude / Aider — the actual AI agent (pluggable)
  ↓
.minsky/ sidecar — config, experiment store, iteration records
```

## How Minsky works inside

Six things that make minsky distinctive at the implementation level. File paths included so any claim is auditable.

### 1. Multi-layer team of workers

A task can be worked by a single backend OR by a pipeline of specialised personas. Per-task backend selection ships today; multi-persona-per-task pipelines land at M2.

- **Per-task backend selection** (shipped). `novel/tick-loop/src/llm-provider-spawn-strategy.ts` reads the task's `**Tags**` field and picks the right agent: claude-sonnet for prose-heavy work, devin for cross-repo refactors, local Ollama for mechanical lint fixes. You don't pay $4 for a task a $0.20 model could do.
- **Multi-persona pipelines per task** *(M2 — tracked at `multi-persona-pipeline-handoff-spec`)*. When `novel/handoff-spec/` ships, a complex task spawns researcher → planner → developer → QA → reviewer in sequence. Each persona writes its handoff to `.minsky/handoffs/<task-id>/<persona>-<iso-ts>.md` for the next persona to read. Failure in any persona halts the pipeline and files `pipeline-failed-<task>-<persona>` for operator review.

### 2. MAPE-K control loop (Kephart & Chess 2003, IBM autonomic computing)

The tick-loop daemon literally maps to the four MAPE-K phases plus the shared Knowledge base. This isn't decorative — adding a new phase means adding to the right file.

- **Monitor** — `novel/cross-repo-runner/src/runtime-invariants.ts` checks system state before every iteration (PATH resolves, agent binary works, no zombie processes from previous iterations).
- **Analyze** — `novel/cross-repo-runner/src/task-finder.ts` reads `TASKS.md` and picks the highest-priority task with complete rule-9 fields.
- **Plan** — `novel/tick-loop/src/spawn-strategy.ts` decides which backend to invoke with what prompt.
- **Execute** — `novel/tick-loop/src/daemon.ts` spawns the agent process and waits for the iteration verdict.
- **Knowledge** — `.minsky/experiment-store/` (per-host iteration records, append-only JSONL per task) + `~/.minsky/config.json` (per-machine config).

### 3. Constitution = 18 rules, each enforced as a CI lint

`vision.md` documents the constitution. Every rule has a corresponding `scripts/check-rule-N-*.mjs` linter in the `pre-pr-lint` stack. PRs that violate a rule are rejected by CI before merge — not by a reviewer's good behaviour.

The load-bearing ones:

- **Rule #1 — don't reinvent the wheel** (`scripts/check-rule-1-novel-justification.mjs`) — rejects any new `novel/*` code whose README doesn't cite the existing libraries it considered and explain why each didn't fit.
- **Rule #9 — pre-registered hypothesis-driven development** (`scripts/check-rule-9-tasksmd-fields.mjs`, iron rule) — every P0/P1 task must declare Hypothesis / Success / Pivot / Measurement / Anchor on single lines before work begins. Tasks missing any field are silently dropped by the picker.
- **Rule #12 — scope discipline** (`scripts/check-rule-12-scope-discipline.mjs`, iron rule) — PRs that touch files outside the task's declared scope are rejected.
- **Rule #17 — proactive healing** (`scripts/check-rule-17-proactive-heal.mjs`, iron rule) — PRs that observe a problem without ALSO landing a fix in the same diff are rejected.
- **Rule #18 — fake data and deprecations explicitly marked** *(P0 `fake-data-and-deprecation-marker-discipline`)* — every stub and every `@deprecated` export must carry a canonical marker comment with a linked task id, so future readers can't mistake a temporary mock for production code.

Full list with literature citations in [`docs/PRACTICES.md`](docs/PRACTICES.md).

### 4. Soft-by-default failure modes

The daemon is designed to keep running. A single bad iteration shouldn't be able to wedge the whole loop for an overnight session. Three concentric supervisors:

- **Iteration-level** — when an iteration ends in `spawn-failed`, `scope-leak`, or `validated`, the verdict is logged and the loop moves on to the next task. No exception propagates.
- **Daemon-level** — the launchd plist (macOS) / systemd-user unit (Linux) runs with `KeepAlive=true`. If the Node process dies, the supervisor respawns it within seconds, preserving `.minsky/` state.
- **Network-level** — when the cloud agent returns "quota exceeded", `novel/tick-loop/src/claude-exhaustion-state.ts` records the exhaustion. The next iteration falls back to a local Ollama model. *(Mid-run swap-and-swap-back is tracked at P0 `runtime-token-limit-auto-pivot-local-and-back`.)*

This is the Erlang let-it-crash pattern (Armstrong 2007), composed with an OS-level supervisor.

### 5. Dynamic watchdog (p95 from history)

The iteration timeout isn't hardcoded. `novel/cross-repo-runner/src/dynamic-timeouts.ts` reads recent iteration durations from `.minsky/experiment-store/`, computes the p95, multiplies by 1.5, and uses that as the watchdog. Slower machine? Larger budget. Faster machine? Tighter loop. Same code, zero per-machine config.

The watchdog and the iteration cadence (`tick`) are both re-derived from the same history every iteration, so the loop adapts continuously rather than at install time.

### 6. Self-improvement on itself

Minsky runs on its own repo with the same daemon every operator runs on theirs. The `host-cto-audit.ts` pass after each iteration reviews the diff for things worth tracking and proposes new tasks for operator review. Most P0s in this repo's `TASKS.md` were surfaced by daemon iterations:

- `spawn-failed-exit-minus-one-silent-empty-stderr` — found by a daemon iteration that observed 4 consecutive spawn-failed verdicts and filed the task with the diagnostic capture.
- `walker-drains-one-host-forever` — found by daemon observation when the multi-host walker never advanced past the first host.

The daemon refactors the daemon. Opt-out via `MINSKY_CTO_AUDIT=off` in `~/.minsky/config.json`.

## Key files

Minsky adds **one tracked file to your host repo** (`TASKS.md`) and one gitignored dotfolder (`.minsky/`). Everything else lives in your home directory or inside the minsky repo itself.

**In your host repo:**

| File | Tracked? | What you do with it |
|---|---|---|
| `TASKS.md` | yes | Your work queue — add tasks, mark `Blocked: needs-user-approval` to gate them. Minsky picks tasks from here and writes new ones via CTO audit. |
| `.minsky/` | no (gitignored) | Sidecar dotfolder for iteration history, sentinels, daemon PID. Minsky owns it; don't touch. Safe to delete only for a fresh start on that host. |
| `AGENTS.md` | optional | Per-repo rules for AI agents (commit format, test commands). Customize when adopting minsky on a repo with its own conventions. |

**In your home directory** (per-machine, never in any repo):

| File | What you do with it |
|---|---|
| `~/.minsky/config.json` | Edit once to choose claude vs devin and your default host. Minsky reads it on every start. |
| `~/.minsky/daemon.log` | View live via `minsky watch`; grep for `spawn-failed` / `Blocked` when debugging. |

**Inside the minsky repo itself** (read-only from a host-repo user's perspective): `MILESTONES.md` (roadmap), `vision.md` (the constitution), `DEPRECATED.md` (retired features), `competitors/` (per-competitor analysis). You don't edit these unless you're contributing to minsky.

## Picking up upstream fixes

When new fixes land on `main`, pull them in:

```bash
git pull
```

A post-merge git hook handles most of the redeploy work automatically:

| Change in the pull | Auto-runs on `git pull` |
|---|---|
| `pnpm-lock.yaml` or `package.json` | `pnpm install` (refreshes `dist/`) |
| `bin/minsky` (and your plist exists) | Regenerates the launchd plist (no daemon kill) |
| `distribution/systemd/*.{service,target}` | `systemctl --user daemon-reload` (Linux) |
| Any of the above | `pre-pr-lint --stage=fast` as advisory sanity check |

**What it does NOT auto-do:** restart the running daemon. The current iteration may be mid-spawn and killing it would waste compute, so picking up new daemon-loop behavior still requires:

```bash
minsky update   # graceful stop → pull → rebuild → restart from next iteration
```

Tracked as P0 `minsky-auto-restart-daemon-on-pull` in `TASKS.md` — the goal is to make `minsky update` redundant by having the daemon notice the sentinel between iterations and gracefully restart itself. Opt out of any auto-install behavior with `MINSKY_NO_AUTO_INSTALL=1` (one-shot) or `touch ~/.minsky/no-auto-install` (per-machine).

## Uninstall

```bash
# Preview what would be removed (safe — no deletion)
minsky uninstall

# Full removal: stops daemon, removes launchd plist, deletes ~/.minsky/
minsky uninstall --force
```

The host repo and its `.minsky/` experiment store (your iteration history) are not touched — those are your data. Only per-machine state under `~/.minsky/` and `~/Library/LaunchAgents/com.minsky.daemon.plist` are removed.

> A single-command `minsky uninstall` with an interactive YES prompt (no `--force` needed) is tracked as P0 `minsky-uninstall-one-command-with-stop`.

## Roadmap

The README points to several in-flight P0/P1 tasks above. The full list lives in `TASKS.md`; `MILESTONES.md` carries the M1–M5 exit criteria.

## License

MIT — see [LICENSE](./LICENSE).
