# Minsky

> A background daemon that runs AI coding agents against tasks in any git repo. 24/7, unattended, on your machine, with your credentials.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## Getting started

Inside Claude Code / Devin / Cursor, paste:

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

Manual: `git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install && ./bin/minsky`. Full runbook: [INSTALL.md](./INSTALL.md) · uninstall: [docs/uninstall.md](docs/uninstall.md).

## Why Minsky

- **Unattended improvement** — picks `TASKS.md` tasks, ships draft PRs, never merges without you ([loop](user-stories/001-loop-runs-overnight.md)).
- **Right model per task** — Claude / Devin / Aider / local, configurable per machine ([backends](user-stories/008-per-task-backend-and-personas.md)).
- **Self-improving** — reads its own iteration ledger, files tasks against its own weak spots ([MAPE-K](user-stories/003-mape-k-improves-prompts.md)).
- **Talks to you in a file** — agents append `## Q:` to `.minsky/qa-log.md` and wait; you answer with `## A:`; `minsky qa` opens it in `$EDITOR` ([human-loop](novel/human-loop/README.md)).

How it works: reads `TASKS.md` → picks task → spawns agent on a feature branch → draft PR with self-graded metrics → records iteration → loops. Full architecture: [docs/README-v1-detailed.md](docs/README-v1-detailed.md#how-it-works).

## Safety (mechanically enforced)

Every PR ships as draft (no auto-merge) · no direct pushes to `main` · destructive ops (force push, branch delete, deploy) hard-blocked · 15 gates per PR (scope-leak / secret-scan / security-review).

## How Minsky compares

Top 5 differentiation rows. Full table + tradeoffs: [docs/competitive-comparison.md](docs/competitive-comparison.md).

| Capability | Minsky | OpenHands | CrewAI | Devin | Claude Code / Aider |
|---|---|---|---|---|---|
| **Shape** | ✅ Daemon | Framework | Python framework | SaaS | CLI |
| **24/7 unattended** | ✅ | ❌ Request-response | ❌ Stateless | ✅ Cloud | ❌ Interactive |
| **Cross-repo fleet** | ✅ `--hosts-dir` | 🟡 Enterprise | 🟡 Partial | ❌ | ❌ |
| **Constitutional CI** | ✅ 18 rules · 53 lints | ❌ Advisory | 🟡 Optional | 🟡 Internal | ❌ |
| **Headline benchmark** | 🔴 None | ✅ **65.8% SWE-bench** | ❌ | ✅ Cognition blog | ✅ Aider leaderboard |

24/7 daemon + your credentials + constitution-as-CI → Minsky. SWE-bench + Docker sandbox → OpenHands. Fortune-500 multi-agent → CrewAI. Managed cloud → Devin. CLI pairing → Claude Code / Aider.

## License

MIT — [LICENSE](LICENSE). Read next: [docs/README.md](docs/README.md) · [INSTALL.md](./INSTALL.md) · [AGENTS.md](AGENTS.md) · [vision.md](vision.md). Named after Marvin Minsky, *The Society of Mind* (1986).
