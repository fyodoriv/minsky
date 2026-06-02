# Minsky

> A 24/7 self-improving code factory — a discipline pack on OpenHands.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## What this is

Point Minsky at a repo and it works **unattended**: picks `TASKS.md` tasks, spawns an agent, ships draft PRs, never merges without you. It adds the discipline OpenHands lacks — a task picker, 18 constitutional rule lints, and a pre-registered-experiment harness where every change is a hypothesis with a measurement command.

It runs from Claude Code, Devin, or **local models** — same core behavior, no cloud key required by default.

## What this is not

- **Not an agent runtime.** [OpenHands](https://github.com/All-Hands-AI/OpenHands) spawns models and edits files; Minsky makes that ship-safe.
- **Not a config dump.** Per-machine setup lives in [INSTALL.md](./INSTALL.md); `~/.minsky/` stays out of the repo.
- **Not the roadmap.** See [MILESTONES.md](./MILESTONES.md) for the live M1 scorecard.

## Install

```bash
git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install && ./bin/minsky
```

One-command **install** is also gated behind `npx -y minsky init` (release-candidate). **Clean uninstall**: `minsky uninstall --force`. Full runbook: [INSTALL.md](./INSTALL.md).

## Run

- **`minsky`** — the 24/7 daemon. Picks tasks, ships draft PRs, drives the **project** toward Minsky **standards** over an 8h session, captures **metrics** baselines per cycle.
- **`minsky transform`** — one improvement session on the current folder with a before/after delta. The demo: `cd /any/repo && minsky transform`.
- **`minsky solve <task-id>`** — one iteration of one task.

The daemon emits **fleet-wide stability reporting** and supports **remote** finding **submission** (`minsky submit-finding`) with an anonymized preview. **Agents** self-heal common failures without you. How it works: [docs/README-v1-detailed.md](docs/README-v1-detailed.md#how-it-works).

## Safety (mechanically enforced)

Every PR ships as a draft · no direct pushes to `main` · destructive ops are human-blocked, never executed · 15 gates per PR (scope-leak / secret-scan / security-review).

## How Minsky compares

| Capability | Minsky | CrewAI | Devin | Claude Code / Aider |
|---|---|---|---|---|
| **Shape** | ✅ Daemon | Framework | SaaS | CLI |
| **24/7 unattended** | ✅ | ❌ | ✅ Cloud | ❌ |
| **Cross-repo fleet** | ✅ | 🟡 | ❌ | ❌ |
| **Constitutional CI lints** | ✅ 18 rules | 🟡 | 🟡 | ❌ |
| **Pre-registered HDD** | ✅ every PR | ❌ | ❌ | ❌ |

OpenHands is the agent runtime Minsky depends on, not a row. Full table + tradeoffs: [docs/competitive-comparison.md](docs/competitive-comparison.md).

## License

MIT — [LICENSE](LICENSE). Read next: [docs/README.md](docs/README.md) · [AGENTS.md](AGENTS.md) · [vision.md](vision.md). Named after Marvin Minsky, *The Society of Mind* (1986).
