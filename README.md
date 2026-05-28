# Minsky

> A 24/7 self-improving code factory — a discipline pack on OpenHands.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## What this is

- The small bash-and-markdown layer (~5–10K LOC after the 2026-05 Path-A cut) that runs on top of OpenHands.
- A task picker + 18 constitutional rule lints + a pre-registered-experiment harness — every change is a hypothesis with a measurement command.
- The discipline pack: agent layer is OpenHands; what's in this repo is what makes OpenHands ship-safe.

## What this is not

- **Not an agent runtime.** See [OpenHands](https://github.com/All-Hands-AI/OpenHands) for the loop that spawns models and edits files.
- **Not the operator's machine state.** See [INSTALL.md](./INSTALL.md) for per-machine setup; `~/.minsky/` is excluded from the repo.
- **Not the M1 roadmap.** See [MILESTONES.md](./MILESTONES.md) for the live `pnpm milestone:check` scorecard.
- **Not the agent's runbook.** See [AGENTS.md](./AGENTS.md) for daemon setup, claiming tasks, and the 18 rules.

## Where we are vs. the vision

Honest scorecard, 2026-05-22 (the vision is the tagline above; the pillars are the substrate):

| Pillar | Today | Status |
|---|---|---|
| **24/7 daemon** | launchd / systemd KeepAlive supervisor; auto-restart; dynamic p95-watchdog | ✅ substrate ships · 🟡 [M1.1](MILESTONES.md) stability target (90% over 10h) blocked on `spawn-failed-exit-minus-one-silent-empty-stderr` |
| **Self-improving** | dogfood loop runs against `~/apps/minsky` itself; MAPE-K L1 records every iteration; observer heals 4 failure modes today | ✅ L1 ships · 🟡 closed-loop A/B prompt tuning (L2) is spec-only · constitutional self-revision (L3) is M3+ aspirational |
| **Code factory** | cross-repo runner walks N hosts (3 iterations / host); rule #12 forces stability work when queue empties | 🟡 throughput-at-scale unmeasured · M1.10 competitive scorecard ships but throughput row is empty |
| **Relies on OpenHands as orchestrator** | [`@minsky/agent-runtime-openhands`](novel/adapters/agent-runtime-openhands/README.md) wraps OpenHands SDK v1.19.1 via a Python shim; the TS adapter spawns it via `--brief-file`. `cloud_agent: "openhands"` is the default since 2026-05-24. Auto-detects local models (Ollama / LM Studio) via the model prefix. **Local models are the runtime default until M1.1 stability hits 90% clean-exit fraction** ([story 015](user-stories/015-local-models-until-stable.md)) — no cloud API key required. Runtime is **launcher-agnostic** — identical behavior regardless of which agent chat ran INSTALL.md ([story 014](user-stories/014-launcher-agnostic-feature-parity.md)). The shim is replaced one-for-one with the canonical `openhands solve` CLI on `2026-06-01`. | ✅ default agent shipped 2026-05-24 (PR #782) · ✅ live spawn end-to-end verified 2026-05-24 against Ollama + `ollama_chat/qwen3-coder:30b` (PR #786) · 🟡 cloud-model A/B vs. claude/devin on the M1.10 corpus pending (`openhands-vs-claude-m110-corpus-live-ab` filed; gated on stability per story 015) |
| **Comes up with tasks** | agents file P1–P3 tasks while iterating (rule #17 forces same-PR scout filings); `corpus-discover-quarterly` files competitor-research tasks autonomously every 90d; sweep / project-audit / standing-audit-gap-loop skills | 🟡 agents author tasks *inside* iterations; the daemon doesn't autonomously author tasks *between* ticks · file `autonomous-task-authoring-between-ticks` is the M2 gap |
| **Best way based on science** | rule #9 pre-registered HDD enforced as CI lint on every PR (Hypothesis / Success / Pivot / Measurement / Anchor); M1.10 corpus scorecard with primary-source citations; every PR carries a `## Hypothesis self-grade` block | ✅ strongest pillar — this is the moat |

**What landed 2026-05-24**: OpenHands is the canonical agent runtime, end-to-end verified — `cloud_agent: "openhands"` is the default, local models auto-detected via prefix. Full plan: [docs/plans/2026-05-22-path-c-openhands-reshape.md](docs/plans/2026-05-22-path-c-openhands-reshape.md).

**What also landed 2026-05-24**: a brutal-honest moat audit (across 35+ autonomous-coding competitors) determined that 2 of the 6 historically-claimed moats are genuinely unique and 4 are partial / easily replicated. The operator approved the **Path A aggressive cut**: shrink Minsky from ~62K LOC past the Path C target (~30K LOC) all the way to ~5-10K LOC by replacing `novel/cross-repo-runner/`, `novel/tick-loop/`, `novel/observer/`, `novel/spec-monitor/`, `novel/tui/`, `novel/handoff-spec/`, `novel/budget-guard/`, and `novel/bridges/omc-tasksmd/` with ~500 lines of bash + Python. The surviving Minsky surface is the constitutional discipline (rule lints + 65 CI jobs) + the MAPE-K substrate (across-session learning). The user-facing identity above doesn't change — Minsky is still a 24/7 self-improving code factory, just with 85% less implementation. Full plan: [docs/plans/2026-05-24-path-a-aggressive-cut.md](docs/plans/2026-05-24-path-a-aggressive-cut.md).

**Two invariants recorded 2026-05-24** (operator directive): (1) **Local models are the default until we're stable** — Minsky's runtime defaults to Ollama / LM Studio / MLX and explicitly does NOT require a cloud API key; the stance lifts when `scripts/measure-stability.mjs` reports ≥90% clean-exit fraction over a trailing 7-day window. See [`user-stories/015-local-models-until-stable.md`](user-stories/015-local-models-until-stable.md). (2) **Launcher-agnostic feature parity** — you can install + run Minsky from any agent chat (Claude Code, Cursor, Devin, Windsurf, Codex, Aider, or a local model talking to one of them) and the daemon's runtime behavior is byte-identical afterwards; the agent chat is a doorway, not a runtime. See [`user-stories/014-launcher-agnostic-feature-parity.md`](user-stories/014-launcher-agnostic-feature-parity.md). Both stories carry P1 tasks to ship the chaos test + the stability gate.

## Getting started

**Fastest path (release-candidate, gated on operator's first publish)**:

```bash
npx -y minsky init
minsky                 # start the 24/7 daemon
```

`npx minsky init` writes `~/.minsky/config.json` pointing at the current git repo. Subsequent `minsky` invocations pick up the config automatically. Cleanup: `minsky uninstall --force`.

Status: package.json is `0.1.0-rc.0`, the publishable tarball builds locally and `bin/minsky init` runs end-to-end from the unpacked tarball (regression-tested at `test/integration/npx-init-tarball.test.ts`). The first `npm publish` is an operator step — see TASKS.md `minsky-npm-publish-v0-1-0`.

**Inside an AI coding agent (Claude Code / Devin / Cursor / Windsurf), paste**:

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

**Manual clone (always works)**: `git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install && ./bin/minsky`. Full runbook: [INSTALL.md](./INSTALL.md) · uninstall: [docs/uninstall.md](docs/uninstall.md).

**Two ways to run**:

- **`minsky`** (or `minsky daemon start`) — the 24/7 loop. Picks tasks from `TASKS.md`, ships draft PRs, never merges without you. The default.
- **`minsky transform`** — single improvement session against the current folder. Captures a baseline (test count, lint exit, build exit, dependencies outdated, doc coverage), runs 8 iterations, prints a before/after delta. The killer-feature demo: `cd /any/repo && minsky transform`.
- **`minsky solve <task-id>`** — one iteration of one task (openhands-pattern killer-feature verb). Same code path as the daemon, just one-shot.

## Why Minsky

- **Unattended improvement** — picks `TASKS.md` tasks, ships draft PRs, never merges without you ([loop](user-stories/001-loop-runs-overnight.md)).
- **Right model per task** — OpenHands by default, with Claude / Devin / Aider as opt-in fallbacks per `~/.minsky/config.json` ([backends](user-stories/008-per-task-backend-and-personas.md), [config](novel/cross-repo-runner/src/agent-config.ts)).
- **Self-improving** — reads its own iteration ledger, files tasks against its own weak spots ([MAPE-K](user-stories/003-mape-k-improves-prompts.md)).
- **Talks to you in a file** — agents append `## Q:` to `.minsky/qa-log.md` and wait; you answer with `## A:`; `minsky qa` opens it in `$EDITOR` ([human-loop](novel/human-loop/README.md)).

[M1](MILESTONES.md) in flight: one-command run, fleet-wide stability reporting, 8h default sessions that drive a repo toward minsky standards, human-blocked unsafe ops, remote task submission. **OpenHands as the canonical agent runtime shipped 2026-05-24** (M1.14 substrate complete; live A/B benchmark vs. claude/devin still pending).

How it works: reads `TASKS.md` → picks task → spawns agent on a feature branch → draft PR with self-graded metrics → records iteration → loops. Full architecture: [docs/README-v1-detailed.md](docs/README-v1-detailed.md#how-it-works).

## Safety (mechanically enforced)

Every PR ships as draft (no auto-merge) · no direct pushes to `main` · destructive ops (force push, branch delete, deploy) hard-blocked · 15 gates per PR (scope-leak / secret-scan / security-review).

## How Minsky compares

Top 5 differentiation rows. Full table + tradeoffs: [docs/competitive-comparison.md](docs/competitive-comparison.md).

OpenHands is **not a row in this table** — it's the agent runtime Minsky depends on (see [`competitors/openhands.md`](competitors/openhands.md) — relationship flipped from *competitor* to *dependency (in-progress)* on 2026-05-22). The peers below are other orchestrator-tier tools that, like Minsky, could choose any agent runtime; the columns compare what they add *on top of* the runtime.

| Capability | Minsky | CrewAI | Devin | Claude Code / Aider | AutoGen / LangGraph |
|---|---|---|---|---|---|
| **Shape** | ✅ Daemon | Python framework | SaaS | CLI | Python framework |
| **24/7 unattended** | ✅ | ❌ Stateless | ✅ Cloud | ❌ Interactive | ❌ Request-response |
| **Cross-repo fleet** | ✅ `--hosts-dir` | 🟡 Partial | ❌ | ❌ | ❌ |
| **Constitutional CI (rule lints)** | ✅ 18 rules · 53 lints | 🟡 Optional | 🟡 Internal | ❌ | ❌ |
| **Pre-registered HDD (rule #9)** | ✅ Iron lint, every PR | ❌ | ❌ | ❌ | ❌ |
| **Headline runtime benchmark** | ✅ Inherits from runtime (OpenHands 65.8% SWE-bench `2026-06-01+`) | ❌ | ✅ Cognition blog | ✅ Aider leaderboard | ❌ |

24/7 daemon + operator-machine identity + constitution-as-CI + pre-registered HDD → Minsky. Fortune-500 multi-agent → CrewAI. Managed cloud → Devin. CLI pairing → Claude Code / Aider. Graph-based workflow DSL → LangGraph.

## License

MIT — [LICENSE](LICENSE). Read next: [docs/README.md](docs/README.md) · [INSTALL.md](./INSTALL.md) · [AGENTS.md](AGENTS.md) · [vision.md](vision.md). Named after Marvin Minsky, *The Society of Mind* (1986).
