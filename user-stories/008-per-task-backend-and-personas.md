# Story 008 — Pick the right coding assistant for each task

**Milestone(s)**: M1.9

> Minsky picks a different coding assistant for each task, based on what the task needs.

## Story

Minsky is a background program that works on your code while you are away. It reads a project's to-do list, picks the most important unfinished item, and asks a coding assistant — Minsky calls this assistant the **agent** — to do the work. The agent can be Claude, Devin, or a model running on your own computer.

No single agent is best at everything. One is cheap and good at prose. One handles large, multi-file changes. One is free and fast for mechanical fixes. So Minsky picks the agent that fits each task, automatically, instead of using the same one for everything. This is the promise in [README.md § "Why Minsky?"](../README.md#why-minsky): *"no single model is good at architecture, implementation, and review at the same time."*

Here is what that looks like. You are a solo developer. You check the daemon log after lunch — the **daemon** is the part of Minsky that keeps running in the background. You see three rounds of work finished this morning. Minsky calls one round an **iteration**: pick a task, ask an agent to do it, capture the result.

1. Iteration #47 — task `readme-clarity-pass` picked claude-sonnet (task tag matches `docs|prose`, so it is prose work). Cost: $0.18. Time: 4 min.
2. Iteration #48 — task `refactor-cross-repo-runner-spawn-pipeline` picked devin (task tag matches `refactor|architecture` AND the change spans 3 or more packages). Cost: $4.20. Time: 23 min.
3. Iteration #49 — task `lint-fix-novel-budget-guard` picked local Ollama qwen3-coder-30b (task tag matches `lint|mechanical|test-only`, a mechanical fix). Cost: $0.00. Time: 7 min.

You never assigned an agent to any of these tasks by hand. Minsky chose. The daemon log shows why it chose each agent, so you can check its reasoning. Total cost stays within the budget you set in `MINSKY_BUDGET_TOKENS`.

There is a second, larger goal for the future: running several agent **personas** on one task. A persona is a role the agent takes on — researcher, planner, developer, QA, reviewer. Two months from now, iteration #200 could run all five on a single complex task: a researcher gathers context for 5 minutes, a planner breaks the task into sub-tasks, a developer writes the code, a QA persona writes tests, and a reviewer writes the pull-request description.

This story specifies both: the per-task agent selection that ships today, and the multi-persona pipeline.

## Acceptance criteria

**Per-task agent selection (shipped today):**

- `novel/tick-loop/src/llm-provider-selector.ts` reads each task's `**Tags**` field and picks an agent from a fixed rule table:
  - `docs|prose|writing` → claude-sonnet
  - `refactor|architecture|cross-repo` AND the task's `**Files**` field touches 3 or more packages → devin
  - `lint|mechanical|test-only|format` → local Ollama (when it is set up; falls back to claude-sonnet if the local stack is unhealthy)
  - default → claude-sonnet
- The daemon writes the choice and the reason into every iteration record: `backend=devin reason=touches-3-packages cost-estimate=$4.50`
- You can override the choice with a task-level `**Backend**: claude` field; the override always wins over the rule table
- Per-task cost is tracked; the running cost per day stays under `MINSKY_BUDGET_TOKENS`

**Multi-persona pipelines (M2 milestone — shipped via A2A):**

The personas hand work to each other through **A2A's Task lifecycle** — A2A is an open agent-to-agent protocol — not a custom JSON format. The driver `bin/minsky-multi-persona.sh` walks the five personas through the A2A adapter (`@minsky/a2a` → `A2AOpenHands.sendMessage`). An **adapter** is a small wrapper that lets Minsky talk to one outside tool through a fixed interface. Each transition logs its A2A task ID and the persona role to `.minsky/iterations.jsonl`. The handoff payload — a Minsky-side envelope that the A2A message points at, per rule #11 ("absorb") — lives at `.minsky/handoffs/<task-id>/<persona>.md`. See [`novel/personas/README.md`](../novel/personas/README.md) for the full A2A mapping.

- `bin/minsky-multi-persona.sh <task-id> <host>` runs a persona chain (researcher → planner → developer → QA → reviewer) on one task. A **host** is one code project that Minsky works on.
- Each persona writes its result to `.minsky/handoffs/<task-id>/<persona>.md`. The next persona's brief is built from it with `scripts/build_brief.py --persona <role> --prior-artifact <path>`, forming a chain from researcher through to reviewer.
- The reviewer persona writes the final PR description; QA writes tests; developer writes code; planner writes the breakdown; researcher writes the context brief.
- If any persona fails, the pipeline stops loudly (rule #6): the driver exits non-zero rather than feeding the next persona a brief built on a gap.
- A per-persona time cap is enforced (default: 5 min per non-developer persona, 30 min for developer).

## Metric

- **Name 1 (shipped)**: `backend_selection_correctness`
- **Definition**: each week, a sample of 20 random iterations is rated 1–5 (by you or a separate evaluator persona) on "right agent for the job." The rating covers both the agent choice AND cost-effectiveness.
- **Threshold**: average ≥4.0/5.0 over the trailing 4 weeks; no more than 2 ratings below 3 per 20-iteration sample
- **Source**: a weekly aggregator picks 20 random iterations from `.minsky/experiment-store/`, asks for the rating, and stores it in `metric-snapshots/backend-selection.jsonl`

- **Name 2 (M2)**: `pipeline_completion_rate`
- **Definition**: the share of multi-persona pipelines that finish all 5 phases without hitting `pipeline-failed-*`, divided by total pipelines started
- **Threshold**: ≥80% over the trailing 30 days once the pipeline path is live
- **Source**: the Observability adapter querying the `.minsky/handoffs/` directory plus `gh pr list` for pipeline-tagged PRs

## Integration test

- **File**: `user-stories/008-per-task-backend-and-personas.test.ts` (new; ships in the same PR as this story)
- **Setup**:
  - A fixture TASKS.md with 6 tasks, one per routing rule:
    - 1 `docs` task → expect `claude-sonnet`
    - 1 `refactor` task touching 4 packages → expect `devin`
    - 1 `lint` task → expect `local-ollama` (or `claude-sonnet` when local is unhealthy)
    - 1 default-tag task → expect `claude-sonnet`
    - 1 task with an explicit `**Backend**: devin` override on a docs-tagged task → expect `devin` (override wins)
    - 1 task tagged `pipeline` → runs the 5-persona A2A pipeline (M2 — shipped; covered by `test/integration/multi-persona-pipeline.test.ts`, which runs `bin/minsky-multi-persona.sh` against a fixture task and checks the artifact chain plus the transition log)
  - `selectBackend(task)` from `llm-provider-selector` is the system under test
  - `claudeProbeOk()` and `ollamaHealthOk()` are mocked to known states
- **Action**: for each task in the fixture, call `selectBackend(task, { ollamaHealthy: true })`, then `selectBackend(task, { ollamaHealthy: false })`
- **Assert**:
  - Each task produces the expected agent choice when the local stack is healthy
  - The lint task falls back to `claude-sonnet` when `ollamaHealthy: false`
  - The override task returns `devin` regardless of tags or local health
  - The pipeline test is **active** (M2 shipped): `test/integration/multi-persona-pipeline.test.ts` checks that the 5 personas run in order, that every transition is logged with `persona=<role>`, and that persona N's artifact reaches persona N+1
  - Every choice carries a non-empty `rationale` string ("matched tag: docs", "touches 4 packages > 3", "explicit operator override", "local unhealthy, falling back to claude-sonnet")

## Proof

- **Live**: the daemon log shows `backend=<choice> reason=<rationale> cost-estimate=$<n>` for every iteration
- **Dashboard**: an agent-distribution pie chart (per-host, trailing 7 days) and a cost-per-agent bar chart
- **Audit**: `grep "backend=" ~/.minsky/daemon.log | sort | uniq -c | sort -rn` shows the distribution
- **Notification**: none (this is a steady-state metric, not an event)

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: agent selection finishes within 50 ms per task (it is a pure-function lookup over the rule table); per-task cost stays within budget; you have to override the daemon's choice by hand no more than 10% of the time.
- **Blast radius**: a single iteration. If the daemon picks a bad agent, that iteration may waste tokens, but the next iteration's choice is independent.
- **Operator escape hatch**: set `**Backend**: <agent>` on the task, OR delete the rule from `llm-provider-selector` and redeploy.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Task has no tags | upstream-malformed | `graceful-degrade` — default to claude-sonnet | Fixture task with `**Tags**:` empty → assert backend=claude-sonnet, rationale="no tags, default" |
| 2 | Task has conflicting tags (`docs` AND `lint`) | upstream-malformed | `graceful-degrade` — first-match-wins per a fixed ordering documented in the rule table | Fixture task with both tags → assert backend per documented precedence |
| 3 | Local Ollama unhealthy when a lint task arrives | dependency upstream-error | `graceful-degrade` — fall back to claude-sonnet with the reason logged | Mock `ollamaHealthOk()=false`; assert backend=claude-sonnet, rationale="local unhealthy, falling back" |
| 4 | Devin auth fails when a refactor task is selected | dependency upstream-error | `circuit-break-and-notify` — fall back to claude-sonnet for one iteration, notify the operator | Mock devin spawn returning exit=-1 with an auth error in stderr; assert the iteration retries with claude-sonnet next pass, single ntfy push at level=warn |
| 5 | `MINSKY_BUDGET_TOKENS` would be exceeded by the selected agent's cost estimate | dependency upstream-error | `graceful-degrade` — downgrade to a local or smaller model | Mock cumulative cost near budget; assert the selector downgrades devin→claude-sonnet→local |
| 6 | Multi-persona pipeline starts but a persona crashes (M2) | upstream-malformed | `loud-crash-supervisor-restart` — the driver halts the pipeline non-zero | `test/integration/multi-persona-pipeline.test.ts` chaos #2 (missing task halts loudly, no partial run) |
| 7 | Multi-persona pipeline handoff artifact missing for the next persona (M2) | upstream-malformed | `loud-crash-supervisor-restart` — the driver halts at the gap | `test/integration/multi-persona-pipeline.test.ts` (artifact-chain test asserts the chain is contiguous); `novel/personas/README.md` chaos table #2 |
| 8 | Two iterations select the same task at once (multi-host concurrency) | concurrency | `graceful-degrade` — per-host lease | Spawn 2 hosts targeting the same task; assert only one acquires the lease via `tasks-mcp`-style semantics |
| 9 | Selector regex catastrophic backtracking on a pathological tag string | dependency upstream-error | `loud-crash-supervisor-restart` — fail closed | Fixture with a 10 KB tag string; assert the selector caps the input and exits with a clean error |

## Status

- **Phase**: Per-task selection — Implemented (`novel/tick-loop/src/llm-provider-selector.ts` ships the rule table; the daemon log records the choice). Multi-persona pipelines — **Implemented** via the A2A adapter (`bin/minsky-multi-persona.sh` + `novel/personas/*.md` + `scripts/build_brief.py --persona`). This story is the spec for both.
- **Handoff substrate**: A2A's Task lifecycle (`@minsky/a2a`), not a custom JSON schema. The superseded `multi-persona-pipeline-handoff-spec` design (a custom validator/writer at `novel/handoff-spec/`) is retired — the per-persona payload at `.minsky/handoffs/<task-id>/<persona>.md` is a Minsky-side envelope that the A2A message points at by URI (rule #11 "absorb"). The pipeline test cases are active in `test/integration/multi-persona-pipeline.test.ts`.
- **Theoretical anchor**: Society of Mind (Minsky 1986 — many specialists, none intelligent alone; here the specialists are the agents). Per-task routing is the operationalisation. Running multiple personas on one task is the deeper version (planned).

## Pattern conformance

- **Pattern**: Society of Mind / multi-agent specialisation (Minsky, M., *The Society of Mind*, 1986). Composed with the actor-model handoff pattern (Hewitt, C., IJCAI 1973 — independent actors that communicate via messages): once multi-persona ships, each persona is an actor and the handoff file is the message.
- **Conformance level**: partial — per-task selection is full; multi-persona is sketched.
- **Index row**: vision.md § "Pattern conformance index" — the row backing `llm-provider-selector.ts` is to be added by `llm-provider-selector-pattern-index-row` (filed P3 in this PR).

## Security & privacy

(Per vision.md rule #13, security and privacy.)

- **Trust boundary**: the selector's input is a task block from `TASKS.md`. You own that file; no untrusted data crosses the boundary at selection time. The downstream agent call has its own trust boundary (the claude or devin API).
- **Secrets**: agent auth (DEVIN_API_KEY, ANTHROPIC_API_KEY) lives in your environment, never in the task block. The selector reads only the `**Backend**` and `**Tags**` fields.
- **PII**: task bodies may reference host paths; the selector does not copy task bodies into logs — only the choice and the reason.
- **Sandbox**: the selector is a pure-function lookup with no filesystem or network access of its own; the agent it picks runs under its own sandbox.
- **Performance carve-out**: the selector is a pure-function lookup capped at under 50 ms. Even a 100x slowdown is invisible against an iteration p95 of 5+ minutes. There is no security-vs-performance trade-off.
