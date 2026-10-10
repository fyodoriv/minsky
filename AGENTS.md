# AGENTS.md

> The agent runbook for the Minsky repo — setup, running, claiming tasks, and the constitutional rules every commit must honour.
> **Repository status — deprecated (2026-09-21):** Do not claim or implement
> new feature tasks here. Work is limited to migration, security, and critical
> repairs. Use AgentBrew and mirror-setup for new tooling automation.

## What this file is

The canonical runbook for any AI agent (Claude Code, OMC personas, future tools) working in the Minsky repo. It tells you how to set up the workspace, run the daemon, claim a task from `TASKS.md`, and the operational rules — which rules apply, where to find them, and which are locally enforced.

If you're an agent reading this for the first time, read in this order: `MILESTONES.md` (the roadmap), then `vision.md` (the constitution), then `TASKS.md` (the work queue), then come back here.

**Before implementing any feature**, check `DEPRECATED.md` — it lists features that should NOT receive new work (hard scope-leak mode, observer-watch.sh, dashboard-web, hardcoded timeout env vars, manual stop/start flows). Use the replacement instead.

This file keeps each rule and procedure short, with its name and the key instruction. The full text lives in [`docs/agents/`](docs/agents/): follow the link at each section for detail.

## What this file is not

- **Not the constitution** — see [vision.md](./vision.md) for the 17 non-negotiable rules. This file references them but doesn't redefine them.
- **Not the architecture doc** — see [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the layered model, adapter pattern, and dependency table.
- **Not the install guide** — see [INSTALL.md](./INSTALL.md) for first-time setup of a freshly-cloned host.
- **Not a task list** — see [TASKS.md](./TASKS.md) for active work.

The `## Orchestrator discipline` and `### 15. Milestone alignment gate` sections below are **load-bearing** — they are cited by deterministic CI gates (`scripts/check-pr-self-grade.mjs`, `scripts/check-rule-6-let-it-crash.mjs`) and by `CHANGELOG.md`. Do not rename or renumber them.

## Repository setup

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
pnpm install            # prepare hook: (a) tsc -b builds all workspace dist/; (b) lefthook installs git hooks
minsky daemon doctor    # verify health (no separate build step)
```

No separate build step is needed. Details: [docs/agents/running-minsky.md](docs/agents/running-minsky.md).

## Running minsky

Run `minsky daemon start --hosts-dir <repos-parent-dir>` to work across repos in the background, or add `--local` for local models only (zero cloud tokens). Manage it with `minsky daemon status`, `logs`, and `stop`. One-shot verbs are `minsky transform`, `minsky solve <task-id>`, and `minsky run --once --host <dir>`. The full command list and the legacy flag forms are in [docs/agents/running-minsky.md](docs/agents/running-minsky.md).

### Per-machine agent config — `~/.minsky/config.json`

**Always check this file first** when starting minsky on any machine. It picks the agents and models: `cloud_agent`, `cloud_agent_model` (the brain), `local_agent`, `local_agent_model` (the workers), `review_model`, and `brain_effort`. Env vars override it for one session. Schema and resolution order: [docs/agents/running-minsky.md](docs/agents/running-minsky.md).

**Agent support matrix:**

| Agent | Cloud | Local | Brief delivery | Model flag |
|---|---|---|---|---|
| `claude` | ✅ | — | stdin | `--model` |
| `aider` | — | ✅ | `--message-file` | `--model` via config args |
| `openhands` | 🟡 schema accepted, runtime pending 2026-06-01 (OpenHands Agent Canvas CLI — GitHub issue `OpenHands/OpenHands#14374`) | 🟡 planned | `stdin` (anticipated; confirms on June 1) | `--model` (LLM-agnostic via OpenAI-compatible API) |

The `openhands` row is schema-only until its external dependency ships; the daemon refuses to spawn it until then. Details: [docs/agents/running-minsky.md](docs/agents/running-minsky.md).

### Per-host overlay — `<host>/.minsky/repo.yaml`

`task_source` picks where the daemon reads work: `tasks-md` (default) or `github-issues`. An unknown value fails loud. Details: [docs/agents/running-minsky.md](docs/agents/running-minsky.md).

## Identity

You're working on **Minsky** — an integration distribution that connects existing tools into a viable cybernetic system that produces software 24/7 and stays alive indefinitely. Minsky is not a framework. We do not build what already exists.

Code in this repo is AI-authored — cloud agents and local models both count. Don't add an attestation trailer, footer, or co-author tag to commits; provenance is established by live observation of the session, not by self-declaration. The convention is descriptive, not mechanically enforced. Full policy at [`CONTRIBUTING.md`](CONTRIBUTING.md). See `vision.md` § "What Minsky is" for full identity.

## Constitutional rules (non-negotiable)

These come from `vision.md`. Violations are reported by the MAPE-K loop's specification monitor (`claude-spec-monitor`) — runtime specification monitoring per Havelund & Goldberg 2008. Each rule's full text is in [docs/agents/constitutional-rules.md](docs/agents/constitutional-rules.md).

| # | Rule | The key instruction |
|---|---|---|
| 1 | Don't reinvent the wheel | Search for an existing tool first and wrap it in an adapter. New code is an extractable OSS package. |
| 2 | Every dependency through an interface | No tool name in business logic: interface file, vendor file, `selfTest()`, and an `ARCHITECTURE.md` row. |
| 3 | Test-first, metric-first, doc-first | Failing test, metric with a threshold, and docs in the same commit. Given/When/Then scenarios come before tests. |
| 3a | Runtime invariants | Every production bug becomes a runtime invariant checked before each iteration. |
| 3b | Integration tests for CLI features | See below. |
| 4 | Everything measurable, everything visible | New components emit OpenTelemetry; metrics reach a dashboard. |
| 5 | Theoretical grounding | Cite named patterns; don't invent terminology. |
| 6 | Stay alive | Handle process death, rate limits, and failures. Let it crash under a supervisor. |
| 7 | Chaos engineering | List failure modes with a deterministic chaos test and blast radius. No silent retry. |
| 8 | Pattern conformance | Every new artifact adds a row to the vision.md pattern conformance index in the same commit. |
| 9 | Pre-registered hypothesis-driven development (iron) | Hypothesis, success, pivot, measurement, and anchor before code. No exemption. |
| 10 | Deterministic enforcement (iron) | Every rule is a deterministic CI check. LLM checks are advisory only. |
| 11 | Default by default (rule #16) | New behaviour ships as the default. **CLI surface consolidation**: prefer flags or defaults over new subcommands. |
| 12 | Proactive healing (rule #17, iron) | Observation IS the fix: same-session action, fix the class, heal before reporting. |
| 14b | Dynamic settings | See below. |
| 15 | Milestone alignment gate | See below. |

### 3b. Integration tests for CLI features (reinforcement)

Every CLI-facing feature ships an integration test in `test/integration/`. It runs the real binary on fixture data and asserts the output the operator sees. Unit tests alone are not enough. [Full text](docs/agents/constitutional-rules.md).

### 14b. Dynamic settings (no hardcoded timeouts)

Timeouts, intervals, thresholds, and limits are computed from iteration history on this machine. Compute from data first, hard default second, env override third, and log the value. [Full text](docs/agents/constitutional-rules.md).

### 15. Milestone alignment gate (supersedes task picking)

Before picking ANY implementation task, check that seven surfaces match the current milestone in `MILESTONES.md`: `README.md`, the quickstart, `vision.md`, `user-stories/`, integration tests, logs and observability, and `METRICS.md`. A stale surface is your first task. This is iron: no exemption. Run `scripts/check-milestone-alignment.mjs` and put its output in the PR body as a `Milestone alignment check` section. [Full text](docs/agents/constitutional-rules.md).

## Orchestrator discipline (sub-agent launches)

When the harness launches sub-agents in parallel (worktree-isolated PRs), two rules are non-negotiable. Both came from the post-batch audit of the #22-#26 cycle and are now mechanically enforced.

1. **At most two parallel agents may touch any shared file.** Specifically `.github/workflows/ci.yml`, `TASKS.md`, root `vitest.config.ts`, root `tsconfig.json`, and any `vision.md` / `AGENTS.md` / `README.md` are shared. If a batch needs to ship N>2 PRs that all add a CI job, batch their job-additions into a single coordinator PR (one agent ships all N scripts; one PR wires them all into ci.yml at the end). The orchestrator must verify file-set disjointness before launch; this check is itself part of the brief.

2. **Every sub-agent's PR body must include a `Hypothesis self-grade` block.** The block carries four lines: `Predicted: …` (re-states the hypothesis), `Observed: …` (the actual measurement output), `Match: yes / no / partial`, `Lesson: …`. This closes the loop on rule #9's pre-registered HDD discipline — pre-registration without observation-vs-prediction is half a rule. The deterministic CI gate (`pr-self-grade`, runs on `pull_request` events) reads the PR body and fails the merge if any of the four lines is missing or empty. The orchestrator's brief template MUST instruct the sub-agent to fill the block; failures here are an orchestrator bug, not a sub-agent bug.

These rules apply to every Agent-tool-launched sub-agent. Human-authored PRs are subject to rule (2) only — the same self-grade block, enforced by the same gate.

## How to claim and work a task

Tasks live in `TASKS.md` and follow the [tasks.md spec](https://github.com/tasksmd/tasks.md).

0. Run `/karpathy-disciplines` — prime working memory with the four engineering disciplines BEFORE reading the task block. This takes seconds and prevents the most common worker failure modes (silent assumption, scope creep, vague completion).
1. Run `/next-task` (installed by `setup.sh` via `npx @tasks-md/cli install`)
2. The command reads `TASKS.md`, picks the highest-priority unblocked task, claims it with `(@your-agent-id)`, and orients you
3. Follow the constitutional rules above
4. When the task is complete, **remove its entire block from `TASKS.md`** — history lives in git log per the tasks.md spec
5. Commit and push

### Task hygiene

Delete a delivered task block; never keep it as `**Blocked**: … DELIVERED; block retained`. The `no-delivered-retained-blocks` gate rejects that. Details: [docs/agents/working-tasks.md](docs/agents/working-tasks.md).

### Tool-call discipline (load-bearing for non-Claude models)

**EVERY reply you emit must include a tool call.** A prose-only reply ends the conversation in OpenHands-style frameworks, so the work never ships. Follow each planning sentence with its tool call in the same reply. Details: [docs/agents/working-tasks.md](docs/agents/working-tasks.md).

### Choosing an OMC mode for a task

Pick the mode from the task's `**Tags**`: `/autopilot` by default; `/team N:role` for `multi-domain` or `coordination`; `/ultrawork` for `parallel` or `refactor`; `/ralph` for `relentless` or `verify-required`. Details: [docs/agents/working-tasks.md](docs/agents/working-tasks.md).

### Investor / growth-hacker personas

These OMC personas (`product-manager`, `product-analyst`, `analyst`) only run when the task's `**Tags**` includes one of: `business`, `growth`, `revenue`, `customer`, `pricing`.

### All user interface is P0-P1 (by definition)

Every user-facing CLI surface, help text, error message, dashboard widget, `init` flow, and `doctor` output is P0 or P1, never P2-P3. Keep one canonical command per operation and sane defaults. Details: [docs/agents/working-tasks.md](docs/agents/working-tasks.md).

## File and folder conventions

**Filename casing:** `vision.md` is lowercase; `AGENTS.md`, `TASKS.md`, `ARCHITECTURE.md`, `LICENSE`, and `README.md` are uppercase; everything else is lowercase with hyphens. The folder layout is in [docs/agents/conventions.md](docs/agents/conventions.md).

## Code conventions

TypeScript for `novel/` packages, Prettier defaults, one adapter per file with a `selfTest()`, JSDoc on public functions, and no business logic inside adapters. Details: [docs/agents/conventions.md](docs/agents/conventions.md).

## Test conventions

Unit tests sit next to their code; integration tests run against real dependencies; coverage is 80% statements / 70% branches for `novel/`. Details: [docs/agents/conventions.md](docs/agents/conventions.md).

## Documentation rules

Every doc opens with one paragraph on why it exists. Cross-link docs. When code and docs disagree, fix both in the same commit. Don't hand-maintain timestamps. Details: [docs/agents/conventions.md](docs/agents/conventions.md).

## What to do when stuck

Re-read `vision.md`, check `research.md` and `competitors/`, then mark the task blocked with a reason, file the blocker as a task, and move on. Do not loop. Details: [docs/agents/operating-notes.md](docs/agents/operating-notes.md).

## Operator directive vocabulary (load-bearing translations)

If the literal reading of an operator phrase ("monitor it", "fix all those issues") would stop you short of shipping a PR, the active reading is correct. Examples: [docs/agents/operating-notes.md](docs/agents/operating-notes.md).

## `**Touches**:` field on task blocks (parallel-launch coordination)

P0/P1 task blocks must declare `**Touches**:` file globs, or `**Touches**: <none>`. The `check-touches-field` lint enforces it. Format and rules: [docs/agents/operating-notes.md](docs/agents/operating-notes.md).

## Pushback is welcome

If a task description is wrong, or a constitutional rule is being misapplied, push back. Add a `**Pushback**:` block to the task explaining the issue. The human or the MAPE-K loop will resolve it. Silent compliance with a bad spec is itself a constitutional violation.

## Pipeline-managed repos — dedicated worktree pattern

For a multi-PR batch, never work in the main checkout; other agents reset it. Use a dedicated worktree and remove it after the merge. Steps, plus the PR-drain tactics in [`.claude/skills/pr-merge-no-shortcuts/SKILL.md`](.claude/skills/pr-merge-no-shortcuts/SKILL.md): [docs/agents/operating-notes.md](docs/agents/operating-notes.md).

## What never to commit

Never commit `.env` files or any secret material; `node_modules/`, build artifacts, or runtime state (see `.gitignore`); hardcoded tool names in business logic (vendor lock-in, caught by the dep-interface lint check); or edits to `vision.md` from a working task (only the MAPE-K loop's specification-monitor process amends the behavioral spec).

## Frozen agents

Windsurf and Devin support was removed on 2026-10-08 (owner decision). Do not re-add runners, launchers, sync targets, config keys, or tests for them. Augment (Auggie) stays deprecated and frozen (owner decision 2026-10-02): keep its existing paths and tests, never implement a fix or a feature for it as a tool, and never file tasks for it. Competitor research and benchmark readings about Devin or Augment Code are not tool support and stay in scope. If work for a supported backend breaks a frozen agent's existing test, skip that test with a note naming this section.

## Reading next

This repo conforms to the [`load-project-context`](https://github.example.com/example-org/agentbrew/blob/main/src/catalog.yaml) canonical-doc layout (cardinal docs at root + multi-file dirs at root or `docs/`). Any agentbrew-managed agent session entering this repo auto-loads the docs below into context via the catalog rule + Claude Code `SessionStart` hook. Read them in this order:

- `MILESTONES.md` — the roadmap, per-milestone capability tables, what minsky will never do
- `vision.md` — the 17-rule constitution; load-bearing for every constitutional decision
- `ARCHITECTURE.md` — the layered model + adapter pattern + dependency table
- `TASKS.md` — what to do (137 open tasks; the milestone-alignment-gate task is always first)
- `METRICS.md` — the 10 canonical metrics (currently stubs — M1 wires real observations)
- `research.md` — what's in the stack and why
- `user-stories/` — what success looks like, with metrics
- `competitors/` — per-competitor strategic analysis (M1.10 corpus + delegate/contribute/absorb verdicts)
- `DEPRECATED.md` — features that should NOT receive new work; check before implementing
- `INSTALL.md` — first-time setup of a freshly-cloned host
