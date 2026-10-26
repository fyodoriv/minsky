# Minsky

> Point Minsky at your code and it works through your to-do list while you're away — handing you drafts to review; nothing lands without your say-so.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> **Maintenance mode.** Not under active development, but still usable.
> Fixes and small changes are welcome — see [docs/DEPRECATED.md](docs/DEPRECATED.md).

## What this is

Minsky is a background program that does coding work. You point it at a git repo (a **host**) with a plain-text to-do list (`TASKS.md`); Minsky picks the most important unfinished task and asks a coding **agent** — Claude Code, Aider, or a local model — to do it.

It hands you each result as a draft. It never merges on its own, never touches `main`, runs through the night, and restarts if it crashes. Everything runs on your machine, as you, so the work shows up under your name.

Minsky adds what a bare agent lacks: a task picker, 18 numbered rule-checks run as CI lints on every draft, and an experiment harness where each change states a measurable hypothesis before any code.

## What this is not

- **Not an agent runtime.** It drives one, such as [OpenHands](https://github.com/All-Hands-AI/OpenHands), and makes its output safe to ship.
- **Not a config dump.** Per-machine setup is in [INSTALL.md](INSTALL.md); runtime config stays under `~/.minsky/`.
- **Not the roadmap.** See [MILESTONES.md](./MILESTONES.md).

## Install

In the git repo Minsky should work on, tell Claude Code (or Codex):

```text
Install or update Minsky on this machine by following https://github.com/fyodoriv/minsky/blob/HEAD/INSTALL.md (it updates an existing clone). Ask whether I only use Minsky or also contribute to it. Then run `bin/minsky daemon doctor` and fix every failing line with me. Audit the agent skills already on this machine against Minsky's and propose adopt or merge for each one. Then start Minsky for the first time on this repo and walk me through what it needs from me. At the end, list anything that could work better and offer an issue or PR for each.
```

No agent? One line, safe to rerun, ends with the doctor:

```bash
[ -d ~/minsky ] || git clone https://github.com/fyodoriv/minsky.git ~/minsky; cd ~/minsky && git pull --ff-only && pnpm install --frozen-lockfile && bin/minsky daemon doctor
```

Or, inside a repo: `npx -y @fyodoriv/minsky`. **Uninstall:** `minsky uninstall --force`. **Docs:** [docs/README.md](docs/README.md).

## Run

- **`minsky`** — the background daemon: picks tasks, ships draft PRs, works in 8-hour sessions, recording metrics each round.
- **`minsky transform`** — move the folder toward Minsky standards.
- **`minsky solve <id>`** — one round on one task.
- **`minsky submit-finding`** — task submission of a finding.

Each finished task arrives as a **draft pull request** to approve.

## Safety

- Every PR ships as a **draft**; **no direct pushes to `main`**.
- **Destructive operations are blocked** — a human decides.
- **15+ gates per PR**: scope-leak detection, secret scanning, security review.

## License

MIT. The rules: [vision.md](vision.md). Vs CrewAI, Devin, Aider: [docs/competitive-comparison.md](docs/competitive-comparison.md).
