# Minsky

> Point Minsky at your code and it works through your to-do list while you're away — handing you drafts to review; nothing lands without your say-so.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> **Maintenance mode.** Not under active development, but still usable.
> Fixes and small changes are welcome — see [docs/DEPRECATED.md](docs/DEPRECATED.md).

In the git repo Minsky should work on, tell Claude Code (or Codex):

```text
Install or update Minsky by following https://github.com/fyodoriv/minsky/blob/HEAD/INSTALL.md (it updates an existing clone). Ask whether I only use Minsky or also contribute to it. Then run `bin/minsky daemon doctor` and fix every failing line with me. Audit the agent skills already on this machine against Minsky's and propose adopt or merge for each one. Then start Minsky for the first time on this repo and walk me through what it needs from me. At the end, list anything that could work better and offer an issue or PR for each.
```

No agent? One line, safe to rerun, ends with the doctor:

```bash
[ -d ~/minsky ] || git clone https://github.com/fyodoriv/minsky.git ~/minsky; cd ~/minsky && git pull --ff-only && pnpm install --frozen-lockfile && bin/minsky daemon doctor
```

Or, inside a repo: `npx -y @fyodoriv/minsky`. **Uninstall:** `minsky uninstall --force`. **Docs:** [docs/README.md](docs/README.md).

## Use cases

- **`minsky`**: work through `TASKS.md` unattended, in 8-hour sessions, recording metrics each round.
- **`minsky solve <id>`**: one round on one task.
- **`minsky transform`**: move a folder toward Minsky standards.
- **`minsky submit-finding`**: task submission of a finding.

## Features

- Picks the most important open task in a git repo (a **host**).
- Asks a coding **agent** to do it: Claude Code, Aider, or a local model.
- Ships each result as a **draft PR**. It never merges and never pushes to `main`.
- Blocks destructive operations. A human decides.
- Runs 15+ gates per PR: scope leaks, secrets, security review, 18 rule-checks.
- Each change states a measurable hypothesis before any code.
- Reports stability, self-heals common failures, and restarts after a crash.
- Runs on your machine, as you.

## Proof

<!-- proof:start -->
Numbers come from content-free usage counts ([how and privacy](docs/proof/README.md)). Until field data arrives, a row shows a local run and names it.

| Claim | Theory | Metric | Result | Source |
|---|---|---|---|---|
| Works through `TASKS.md` unattended | Unattended rounds must finish ok; MTBF thinking (Nygard, *Release It!*, 2018) | Share of work rounds (`run`, `solve`, `transform`) that exit 0 | not measured yet (field recording on since 2026-10-26): 0 rounds | `docs/proof/metrics.json`, local run, 2026-10-26, machine d570f14f, n=1 |
| Reports stability (restarts not measured yet) | Errors per real run should stay low (Google SRE, 2016, error budgets) | Share of all real `minsky` runs that exit 0 | 88.9 % of 9 runs | `docs/proof/metrics.json`, local run, 2026-10-26, machine d570f14f, n=1 |
| Ships each result as a **draft PR** | A reviewable PR per round is the product (Forsgren et al., *Accelerate*, 2018) | Draft PRs opened per work round | not measured yet (field recording on since 2026-10-26); task `proof-draft-prs-per-round` | none |
| Blocks destructive operations | Guardrails must fire, not only exist (Reason, *Human Error*, 1990) | Destructive commands blocked per work round | not measured yet (field recording on since 2026-10-26); task `proof-destructive-blocks` | none |

```mermaid
pie title Real minsky runs by exit (local run, 2026-10-26, machine d570f14f)
  "ok" : 8
  "error" : 1
```
<!-- proof:end -->

## What this is

A background program (a daemon) that drives a coding agent through the `TASKS.md` of a repo.

## What this is not

- **Not an agent runtime.** It drives one, such as [OpenHands](https://github.com/All-Hands-AI/OpenHands).
- **Not a config dump.** Setup: [INSTALL.md](INSTALL.md). Config: `~/.minsky/`.
- **Not the roadmap.** See [MILESTONES.md](./MILESTONES.md).

## License

MIT. The rules: [vision.md](vision.md). Vs CrewAI, Devin, Aider: [docs/competitive-comparison.md](docs/competitive-comparison.md).
