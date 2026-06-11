# Minsky

> Point Minsky at your code and it works through your to-do list while you're away — handing you drafts to review, never changing anything without your say-so.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## What this is

Minsky is a background program that does coding work. You point it at a git repo (a **host**) that keeps a plain-text to-do list; Minsky picks the most important unfinished task and asks a coding **agent** — Claude Code, Devin, Aider, or a local model — to do it.

Minsky isn't the agent — it drives the agent and hands you the result as a draft. It never pushes on its own, never touches `main`, runs through the night, and restarts if it crashes. Everything runs on your machine, as you, so the work shows up under your name.

Minsky adds what a bare agent lacks: a task picker, 18 numbered rule-checks run as CI lints on every draft, and an experiment harness where each change states a measurable hypothesis before any code.

## What this is not

- **Not an agent runtime.** [OpenHands](https://github.com/All-Hands-AI/OpenHands) spawns models and edits files; Minsky drives such an agent and makes its output safe to ship — a dependency, not a competitor.
- **Not a config dump.** Per-machine setup is in [INSTALL.md](INSTALL.md); runtime config stays under `~/.minsky/`.
- **Not the roadmap.** See [MILESTONES.md](./MILESTONES.md).

## Install

Inside any git repo:

```bash
npx -y @fyodoriv/minsky
```

Installs Minsky, writes `~/.minsky/config.json`, and runs one round. No cloud key needed by default.

**Uninstall:** `minsky uninstall --force`. **Contributors:** `git clone`, `pnpm install`, then `bin/minsky`.

## Run

- **`minsky`** — the background daemon: picks tasks, ships draft PRs, works an 8-hour session, recording metrics each round.
- **`minsky transform`** — move the folder toward Minsky standards; before/after delta.
- **`minsky solve <id>`** — one round on one task.
- **`minsky submit-finding`** — task submission of a finding.

Each finished task arrives as a **draft pull request** to approve. Minsky reports stability across watched projects and self-heals common failures.

## Safety

Enforced mechanically, not by convention:

- Every PR ships as a **draft**; **no direct pushes to `main`**.
- **Destructive operations are blocked** — a human decides.
- **15 gates per PR**: scope-leak detection, secret scanning, security review.

## How Minsky compares

| Capability | Minsky | CrewAI | Devin | Claude Code / Aider |
|---|---|---|---|---|
| **Shape** | ✅ Daemon | Framework | SaaS | CLI |
| **24/7 unattended** | ✅ | ❌ | ✅ Cloud | ❌ |
| **Cross-repo fleet** | ✅ | 🟡 | ❌ | ❌ |
| **Constitutional CI lints** | ✅ 18 rules | 🟡 | 🟡 | ❌ |
| **Pre-registered HDD** | ✅ every PR | ❌ | ❌ | ❌ |

Full table: [docs/competitive-comparison.md](docs/competitive-comparison.md).

## License

MIT — see [LICENSE](LICENSE). Read next: [docs/README.md](docs/README.md) · [AGENTS.md](AGENTS.md) · [vision.md](vision.md).
