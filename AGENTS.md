# AGENTS.md

> The agent runbook for the Minsky repo — setup, running, claiming tasks, and the constitutional rules every commit must honour.
> **Repository status — maintenance mode:** Minsky is not under active
> development, but it is not deprecated. It may still drive work for other
> repos. Fixes, security work, and small changes that a user of Minsky needs
> are in scope. Ask the owner before you start a large new feature.

## What this file is

This file is the canonical runbook for any AI agent (Claude Code, OMC personas, future tools) that works in the Minsky repo. It is a router: each section keeps the key instruction and links to the full text in [`docs/agents/`](docs/agents/). `CLAUDE.md` is a symlink to this file.

## What this file is not

- **Not the constitution** — see [vision.md](./vision.md) for the 17 non-negotiable rules.
- **Not the architecture doc** — see [ARCHITECTURE.md](./docs/ARCHITECTURE.md).
- **Not the install guide** — see [INSTALL.md](./INSTALL.md).
- **Not a task list** — see [TASKS.md](./TASKS.md).

The `Orchestrator discipline` and `15. Milestone alignment gate` sections are **load-bearing**: CI gates (`scripts/check-pr-self-grade.mjs`, `scripts/check-rule-6-let-it-crash.mjs`) and `CHANGELOG.md` cite them. Do not rename or renumber them.

## Start here

Minsky is an integration distribution: it connects existing tools into a system that works through a repo's `TASKS.md` and hands back draft PRs. It is not a framework; we do not build what already exists. Canonical repo: `github.com/fyodoriv/minsky`, branch `main`.

Read this file, then [`MILESTONES.md`](MILESTONES.md), [`vision.md`](vision.md), and `TASKS.md`. Before you build a feature, check [`docs/DEPRECATED.md`](docs/DEPRECATED.md). The docs map is [`docs/README.md`](docs/README.md). Code here is AI-authored; do not add attestation trailers or co-author tags ([`CONTRIBUTING.md`](CONTRIBUTING.md)).

**Agent support matrix:**

| Agent | Cloud | Local | Brief delivery | Model flag |
|---|---|---|---|---|
| `claude` | ✅ | — | stdin | `--model` |
| `aider` | — | ✅ | `--message-file` | `--model` via config args |
| `openhands` | 🟡 schema accepted, runtime pending 2026-06-01 (OpenHands Agent Canvas CLI — GitHub issue `OpenHands/OpenHands#14374`) | 🟡 planned | `stdin` (anticipated; confirms on June 1) | `--model` (LLM-agnostic via OpenAI-compatible API) |

Per-machine agents and models: `~/.minsky/config.json`. Per-host task source: `<host>/.minsky/repo.yaml`. Details: [docs/agents/running-minsky.md](docs/agents/running-minsky.md).

## Commands

Run from the repo root, with the pinned Node: prefix each line with `fnm exec --using=24.14.0`.

| Task | Command |
|---|---|
| Install (also builds and installs git hooks) | `pnpm install --frozen-lockfile` |
| Health check | `minsky daemon doctor` |
| One test file | `pnpm exec vitest run <path>.test.ts` |
| All unit tests (commit first, see Gotchas) | `pnpm test` |
| Integration tests | `pnpm test:integration` |
| Lint / typecheck | `pnpm lint` / `pnpm typecheck` |
| Pre-PR lint stack | `pnpm pre-pr-lint` |
| Milestone alignment (rule 15) | `node scripts/check-milestone-alignment.mjs` |
| Full gate (slow; run it in the background) | `pnpm check` |
| Run on a host once | `minsky run --once --host <dir>` |

## Where to change what

| I want to… | Change | Update this doc too |
|---|---|---|
| Change the CLI | `bin/minsky`, `novel/*/src/` | README, [running-minsky.md](docs/agents/running-minsky.md) |
| Change the tick loop or budget | `novel/tick-loop/` | [machine-budget.md](docs/machine-budget.md) |
| Change the observer or heals | `novel/observer/` | [self-diagnose-authoring.md](docs/self-diagnose-authoring.md) |
| Add or change an adapter | `novel/adapters/<name>/` (interface, vendor file, `selfTest()`) | [ARCHITECTURE.md](docs/ARCHITECTURE.md) dependency table |
| Change agent personas | `novel/personas/` | [working-tasks.md](docs/agents/working-tasks.md) |
| Add a deterministic lint | `scripts/check-*.mjs` + `.test.mjs`, wired in `.github/workflows/ci.yml` | [constitutional-rules.md](docs/agents/constitutional-rules.md) |
| Change launchd or systemd units | `distribution/launchd/`, `distribution/systemd/` | [machine-budget.md](docs/machine-budget.md) |
| Add or change a metric | `scripts/`, `METRICS.md` | [METRICS.md](docs/METRICS.md) |
| Add a competitor analysis | `competitors/<name>.md` | `competitors/README.md` |
| Add or close a task | `TASKS.md` (rule-9 fields, `**Touches**:`) | none |
| Add a doc | `docs/<name>.md` | a row in [docs/README.md](docs/README.md) |

## Rules

### Constitutional rules (non-negotiable)

The 17 rules live in [vision.md](./vision.md); full text per rule: [docs/agents/constitutional-rules.md](docs/agents/constitutional-rules.md).

| # | Rule | Key instruction |
|---|---|---|
| 1 | Don't reinvent the wheel | Find an existing tool and wrap it in an adapter. |
| 2 | Every dependency through an interface | No tool name in business logic; `selfTest()`; an `ARCHITECTURE.md` row. |
| 3 | Test-first, metric-first, doc-first | Failing test, metric with a threshold, and docs in the same commit. |
| 3a | Runtime invariants | Every production bug becomes a runtime invariant. |
| 3b | Integration tests for CLI features | Each CLI feature ships a test in `test/integration/` that runs the real binary. |
| 4 | Everything measurable | New components emit OpenTelemetry. |
| 5 | Theoretical grounding | Cite named patterns. |
| 6 | Stay alive | Handle process death and rate limits; let it crash under a supervisor. |
| 7 | Chaos engineering | A deterministic chaos test per failure mode. No silent retry. |
| 8 | Pattern conformance | Each new artifact adds a row to the vision.md pattern index. |
| 9 | Pre-registered hypothesis (iron) | Hypothesis, success, pivot, measurement, anchor before code. |
| 10 | Deterministic enforcement (iron) | Every rule is a CI check; LLM checks are advisory only. |
| 11 | Default by default (rule #16) | New behavior ships as the default; prefer flags to new subcommands. |
| 12 | Proactive healing (rule #17, iron) | Fix the observed class in the same session. |
| 14b | Dynamic settings | Compute timeouts and limits from history; no hardcoded values. |
| 15 | Milestone alignment gate | See below. |

### 15. Milestone alignment gate (supersedes task picking)

Before you pick an implementation task, check that the seven surfaces in `MILESTONES.md` match the current milestone. A stale surface is your first task. Put the output of `scripts/check-milestone-alignment.mjs` in the PR body as `Milestone alignment check`.

### Orchestrator discipline (sub-agent launches)

1. At most two parallel agents may touch a shared file (`ci.yml`, `TASKS.md`, root configs, `vision.md`, `AGENTS.md`, `README.md`).
2. Every PR body has a `Hypothesis self-grade` block: `Predicted:`, `Observed:`, `Match:`, `Lesson:`. The `pr-self-grade` gate checks it.

Full text: [operating-notes.md](docs/agents/operating-notes.md#orchestrator-discipline-sub-agent-launches).

### `**Touches**:` field on task blocks

P0/P1 task blocks declare `**Touches**: <globs>` or `**Touches**: <none>` ([operating-notes.md](docs/agents/operating-notes.md)).

### Test conventions and documentation rules

Tests sit next to their code. Every doc opens with one paragraph on why it exists. Details: [conventions.md](docs/agents/conventions.md).

### Never

Never commit secrets, `node_modules/`, build output, or runtime state. Never edit `vision.md` from a task. Never re-add Windsurf or Devin; Augment is frozen. Never run `minsky enable-autostart` unless the owner asks. More: [operating-notes.md](docs/agents/operating-notes.md).

## Gotchas

- **Commit before `pnpm test`.** A git-guard test (`scripts/git-shim-guard.test.mjs`) can revert uncommitted tracked changes in the checkout when the guard does not block. Untracked files survive.
- Use the pinned Node (`.node-version` is 24.14.0): `fnm exec --using=24.14.0 pnpm …`. The machine default differs.
- This repo sets a local `core.hooksPath=.git/hooks` (lefthook). Keep it; the global hooks path points elsewhere.
- Work in a git worktree (for example `<repos-parent>/wt/<name>`) and run `pnpm install` there.
- The owner's global gitignore lists `TASKS.md`. Fixture git repos in tests need `GIT_CONFIG_GLOBAL=/dev/null`.
- PR-body gates (`pr-vision-trace`, `pr-security-review`, `pr-self-grade`) read the live body. Edit the body, then `gh run rerun <id> --failed`. The aggregate `ci` job fails only because one of them failed.
- `scripts/check-readme-byte-budget.mjs` caps the README size. Put detail in `docs/`.
- `scripts/check-docs-frame-coherence.mjs` requires the H1, `>` tagline, and "What this file is / is not" frame on this file.

## Delivery

1. Branch `type/short-description` from `main`, in a worktree.
2. Commit, then run `pnpm check` (or the relevant tests plus `pnpm lint` and `pnpm typecheck`).
3. Use a conventional commit header; no attestation trailers.
4. The PR body has `## Summary`, `## Details`, `## Docs`, `## Vision trace`, `## Security & privacy`, `## Hypothesis self-grade`, and `## Milestone alignment check`.
5. Merge when every CI check is green. Remove the worktree and the branch.

## Docs upkeep

- Every behavior change updates its docs in the same PR. The routing table names the doc.
- A gotcha that cost you time goes into `## Gotchas`, or becomes a lint if a machine can check it.
- Every PR body has `## Docs`: the docs you changed, or `Docs: none — <reason>`.
- A new top-level `docs/*.md` needs a row in [docs/README.md](docs/README.md). `scripts/agent-guide-contract.test.mjs` checks this file, the map, and the README opening.
