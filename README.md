# Minsky

> A background daemon that runs AI coding agents against tasks in any git repo.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

Minsky attaches to a git repo and improves it over time, using established software-engineering practices. It picks the next thing to fix, makes the fix on a feature branch, runs your tests, and opens a draft pull request for you to review. Then it picks the next thing — by default it runs until you stop it.

## Getting started

**Through your AI agent.** Copy-paste:

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

**Manual:**

```bash
git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install && ./bin/minsky
```

Full install runbook: [INSTALL.md](./INSTALL.md). Uninstall: [docs/uninstall.md](docs/uninstall.md).

## Why Minsky

- **Continuous, unattended improvement** — picks tasks, ships draft pull requests, never merges without you. ([details →](user-stories/001-loop-runs-overnight.md))
- **Finds new work for you to approve** *(can be turned off)* — after each fix, it audits the repo and proposes new tasks for your review. ([details →](user-stories/007-cto-audit-files-new-tasks.md))
- **Right model for each task** — Claude for prose, Devin for refactors, a local model for mechanical fixes (so cheap work stays cheap). ([details →](user-stories/008-per-task-backend-and-personas.md))
- **Refuses to reinvent the wheel** — every pull request has to cite the libraries it considered; if it skips the search, the build fails. ([details →](user-stories/009-forced-research-rule-1.md))
- **A tool that improves itself** — reads its own metrics, files tasks against its own weak spots, ships the fixes. ([details →](user-stories/003-mape-k-improves-prompts.md))
- **Keeps going when the cloud runs dry** — if your cloud-AI quota runs out, it falls back to a local model so the loop doesn't stall. ([details →](user-stories/004-budget-auto-pause.md))
- **Async Q&A across timezones** *(coming)* — agents leave questions in a file; you answer when you wake up. ([details →](user-stories/010-async-human-qa-via-file.md))

One-line how-it-works: Minsky reads your `TASKS.md`, picks the highest-priority task, spawns Devin/Claude/Aider on a feature branch, opens a draft PR with self-graded metrics, records the iteration, loops. Full architecture + 7-step flow at [docs/README-v1-detailed.md § How it works](docs/README-v1-detailed.md#how-it-works).

## Safety

Hard rules — mechanically blocked, not "tries not to":

- **Every PR is a draft** until you mark it ready. No agent can merge.
- **No direct pushes to `main`** — every change goes through a feature branch and a PR you review.
- **Security-sensitive changes** — flagged human-blocked, always.
- **Destructive operations** (force push, branch delete, deploy) — hard-blocked at the daemon level.
- **Architecture decisions** — Minsky files a research task for you rather than guessing.
- **Stay-in-your-lane check** — every iteration runs a scope-leak detector + secret scanner + security review across 15 automatic gates before the PR can open.

## How Minsky compares to other tools

The 5 highest-differentiation rows. Full 15-row table + tradeoffs + what-we-steal at [docs/competitive-comparison.md](docs/competitive-comparison.md).

| Capability | Minsky | OpenHands | CrewAI | Devin | Claude Code / Aider |
|---|---|---|---|---|---|
| **Shape** | ✅ Daemon | Framework + runtime | Python framework | SaaS | CLI |
| **24/7 unattended** | ✅ Survives reboots | ❌ Request-response | ❌ Stateless | ✅ Cloud sessions | ❌ Interactive |
| **Cross-repo fleet** | ✅ Built-in (`--hosts-dir`) | 🟡 Enterprise only | 🟡 Partial | ❌ One repo / session | ❌ One at a time |
| **Constitutional CI** | ✅ 18 rules · 53 lints · 65 CI jobs | ❌ LLM-advisory | 🟡 Optional | 🟡 Cognition-internal | ❌ |
| **Headline benchmark** | 🔴 None ([gap filed](TASKS.md)) | ✅ **65.8% SWE-bench** | ❌ | ✅ Cognition blog | ✅ Aider leaderboard |

✅ shipping · 🟡 partial · 🔴 planned. M1 progress: 39 / 81 measurable tasks ([details](MILESTONES.md#m1--stable-measurable-one-command--v010)). One-paragraph picker:

If you want a 24/7 daemon on your machine with your credentials and a constitution-as-CI gate — pick Minsky. SWE-bench leadership + Docker sandbox — OpenHands. Fortune-500 multi-agent — CrewAI. Managed cloud agent — Devin. Focused CLI pairing — Claude Code or Aider.

## License

MIT — see [LICENSE](LICENSE). Where to read next: [docs/README.md](docs/README.md) (full audience-segmented map) · [INSTALL.md](./INSTALL.md) · [AGENTS.md](AGENTS.md) · [vision.md](vision.md) · [TASKS.md](TASKS.md). Positioning vs other orchestrators + name-disambiguation: [docs/README-v1-detailed.md § Minsky's position in the landscape](docs/README-v1-detailed.md#minskys-position-in-the-landscape). About the name: Marvin Minsky (1927–2016), *The Society of Mind* (1986) — intelligence emerges from many simple specialised agents working together.
