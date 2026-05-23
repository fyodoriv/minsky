# Story 008 — Per-task agent backend selection + multi-persona pipelines

**Milestone(s)**: M1.9

> **Why this story exists.** Motivation bullet #3 in [README.md § "Why Minsky?"](../README.md#why-minsky): *"no single model is good at architecture, implementation, and review at the same time"*. The operator-facing promise: a docs-only task spawns Claude Sonnet (cheap, prose-fluent); a complex cross-repo refactor spawns Devin (large context, multi-file); a mechanical lint-fix spawns local Ollama (free, fast, deterministic). Per-task backend selection is shipped; per-task multi-persona pipelines (researcher → planner → developer → QA → reviewer running on the same task) is an M2 milestone.

## Story

As a solo developer, I check the daemon log after lunch. I see three iterations finished this morning:

1. Iteration #47 — task `readme-clarity-pass` → spawned claude-sonnet (tag matches `docs|prose`). Cost: $0.18. Time: 4 min.
2. Iteration #48 — task `refactor-cross-repo-runner-spawn-pipeline` → spawned devin (tag matches `refactor|architecture` AND scope spans ≥3 packages). Cost: $4.20. Time: 23 min.
3. Iteration #49 — task `lint-fix-novel-budget-guard` → spawned local Ollama qwen3-coder-30b (tag matches `lint|mechanical|test-only`). Cost: $0.00. Time: 7 min.

The selection happens automatically; I never edit per-task agent assignments. The daemon log shows the selection rationale per iteration so I can audit. Per-task cost stays within `MINSKY_BUDGET_TOKENS`.

(M2 milestone — not yet shipped.) Two months from now, iteration #200 will spawn a *multi-persona pipeline* for a single complex task: a researcher persona gathers context for 5 min, a planner produces a TASKS.md sub-decomposition, a developer implements, a QA persona writes tests, a reviewer produces the PR description. All within one task block. The story below describes the per-task backend selection that's shipped today AND the multi-persona pipeline target state.

## Acceptance criteria

**Shipped today (per-task backend selection):**

- `novel/tick-loop/src/llm-provider-selector.ts` reads each task's `**Tags**` field and selects an agent backend per a deterministic rule table:
  - `docs|prose|writing` → claude-sonnet
  - `refactor|architecture|cross-repo` AND `**Files**` touches ≥3 packages → devin
  - `lint|mechanical|test-only|format` → local Ollama (when bootstrapped; falls back to claude-sonnet if local stack is unhealthy)
  - default → claude-sonnet
- The daemon logs the backend choice + rationale in every iteration record: `backend=devin reason=touches-3-packages cost-estimate=$4.50`
- Operator can override via task-level `**Backend**: claude` field; the override wins over the heuristic
- Per-task cost is tracked; cumulative cost-per-day stays under `MINSKY_BUDGET_TOKENS`

**M2 milestone (per-task multi-persona pipelines):**

- A task tagged `pipeline` OR `decomposition-required` (sized XL by the task picker) spawns a multi-persona chain (researcher → planner → developer → QA → reviewer)
- Each persona writes its output to `.minsky/handoffs/<task-id>/<persona>-<iso-ts>.md` for the next persona to read
- The reviewer persona is responsible for the final PR description; QA writes tests; developer writes code; planner writes the decomposition; researcher writes the context brief
- Failure in any persona halts the pipeline and files a `pipeline-failed-<task-id>-<persona>` task with the failure context
- Per-persona budget cap is enforced (default: 5 min per non-developer persona, 30 min for developer)

## Metric

- **Name 1 (shipped)**: `backend_selection_correctness`
- **Definition**: per-week sample of 20 random iterations rated qualitatively (by the operator or a separate evaluator persona) on "right backend for the job" (1-5 scale). The rating includes both backend choice AND cost-effectiveness.
- **Threshold**: ≥4.0/5.0 average over trailing 4 weeks; ≤2 ratings below 3 per 20-iteration sample
- **Source**: weekly aggregator that picks 20 random iterations from `.minsky/experiment-store/`, prompts the operator (or evaluator persona) for the rating, stores in `metric-snapshots/backend-selection.jsonl`

- **Name 2 (M2)**: `pipeline_completion_rate`
- **Definition**: ratio of multi-persona pipelines that complete all 5 phases without hitting `pipeline-failed-*` divided by total pipelines spawned
- **Threshold**: ≥80% over trailing 30 days once the pipeline path is live
- **Source**: `Observability` adapter querying `.minsky/handoffs/` directory + `gh pr list` for pipeline-tagged PRs

## Integration test

- **File**: `user-stories/008-per-task-backend-and-personas.test.ts` (new; ships in the same PR as this story)
- **Setup**:
  - Fixture TASKS.md with 6 tasks covering each routing rule:
    - 1 `docs` task → expect `claude-sonnet`
    - 1 `refactor` task touching 4 packages → expect `devin`
    - 1 `lint` task → expect `local-ollama` (or `claude-sonnet` when local unhealthy)
    - 1 default-tag task → expect `claude-sonnet`
    - 1 task with explicit `**Backend**: devin` override on a docs-tagged task → expect `devin` (override wins)
    - 1 XL task tagged `pipeline` → expect multi-persona pipeline (M2 — test marked `it.skip` until milestone ships)
  - `selectBackend(task)` from `llm-provider-selector` is the system under test
  - `claudeProbeOk()` and `ollamaHealthOk()` mocked to known states
- **Action**: for each task in the fixture, call `selectBackend(task, { ollamaHealthy: true })` then `selectBackend(task, { ollamaHealthy: false })`
- **Assert**:
  - Each task produces the expected backend choice with healthy local
  - The lint task falls back to `claude-sonnet` when `ollamaHealthy: false`
  - The override task returns `devin` regardless of tags or local health
  - The pipeline test stays `it.skip` until M2 ships
  - Every choice includes a non-empty `rationale` string ("matched tag: docs", "touches 4 packages > 3", "explicit operator override", "local unhealthy, falling back to claude-sonnet")

## Proof

- **Live**: the daemon log shows `backend=<choice> reason=<rationale> cost-estimate=$<n>` per iteration
- **Dashboard**: backend-distribution pie chart (per-host, trailing 7 days); cost-per-backend bar chart
- **Audit**: `grep "backend=" ~/.minsky/daemon.log | sort | uniq -c | sort -rn` shows the distribution
- **Notification**: none (this is a steady-state metric, not an event)

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: backend selection completes within 50 ms per task (a pure-function lookup over the rule table); per-task cost stays within budget; the operator never has to manually override the daemon's choice >10% of the time.
- **Blast radius**: a single iteration. If the daemon picks a bad backend, the iteration may waste tokens, but the next iteration's selection is independent.
- **Operator escape hatch**: set `**Backend**: <agent>` on the task, OR delete the rule from `llm-provider-selector` and re-deploy.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Task has no tags | upstream-malformed | `graceful-degrade` — default to claude-sonnet | Fixture task with `**Tags**:` empty → assert backend=claude-sonnet, rationale="no tags, default" |
| 2 | Task has conflicting tags (`docs` AND `lint`) | upstream-malformed | `graceful-degrade` — first-match-wins per a deterministic ordering documented in the rule table | Fixture task with both tags → assert backend per documented precedence |
| 3 | Local Ollama unhealthy when a lint task arrives | dependency upstream-error | `graceful-degrade` — fall back to claude-sonnet with rationale logged | Mock `ollamaHealthOk()=false`; assert backend=claude-sonnet, rationale="local unhealthy, falling back" |
| 4 | Devin auth fails when a refactor task is selected | dependency upstream-error | `circuit-break-and-notify` — fall back to claude-sonnet for one iteration, notify operator | Mock devin spawn returning exit=-1 with auth error in stderr; assert iteration retries with claude-sonnet next pass, single ntfy push at level=warn |
| 5 | `MINSKY_BUDGET_TOKENS` would be exceeded by the selected backend's cost estimate | dependency upstream-error | `graceful-degrade` — downgrade to local or smaller model | Mock cumulative cost near budget; assert selector downgrades devin→claude-sonnet→local |
| 6 | Multi-persona pipeline starts but researcher persona crashes (M2) | upstream-malformed | `loud-crash-supervisor-restart` — file `pipeline-failed-<task>-researcher` | Skip until M2 |
| 7 | Multi-persona pipeline handoff file is malformed (planner produces garbage) (M2) | upstream-malformed | `circuit-break-and-notify` — fail at the handoff-spec validator | Skip until M2 |
| 8 | Two iterations select the same task simultaneously (multi-host concurrency) | concurrency | `graceful-degrade` — per-host lease | Spawn 2 hosts targeting the same task; assert only one acquires the lease via `tasks-mcp`-style semantics |
| 9 | Selector regex catastrophic backtracking on a pathological tag string | dependency upstream-error | `loud-crash-supervisor-restart` — fail closed | Fixture with a tag string of 10 KB; assert selector caps input and exits with a clean error |

## Status

- **Phase**: Per-task selection — Implemented (`novel/tick-loop/src/llm-provider-selector.ts` ships the rule table; the daemon log records the choice). Multi-persona pipelines — M2 milestone, not started. This story is the spec for both states.
- **Blocking**: the M2 multi-persona pipeline is blocked on the `handoff-spec` package being finalised (`novel/handoff-spec/` exists as a sketch; needs schema + validator + writer). Tracked as `multi-persona-pipeline-handoff-spec` P1 (this PR files it). The story's `it.skip` test cases activate when handoff-spec is shipped.
- **Theoretical anchor**: Society of Mind (Minsky 1986 — many specialists, none intelligent alone; here the specialists are LLM backends). Per-task routing is the operationalisation. Multi-persona pipelines on a single task are the deep version (planned).

## Pattern conformance

- **Pattern**: Society of Mind / multi-agent specialisation (Minsky, M., *The Society of Mind*, 1986). Composed with the actor-model handoff pattern (Hewitt, C., IJCAI 1973 — independent actors that communicate via messages) — once multi-persona ships, each persona is an actor and the handoff file is the message.
- **Conformance level**: partial — per-task selection is full; multi-persona is sketched.
- **Index row**: vision.md § "Pattern conformance index" — row backing `llm-provider-selector.ts` is to be added by `llm-provider-selector-pattern-index-row` (filed P3 in this PR).

## Security & privacy

(Per vision.md rule #13.)

- **Trust boundary**: the selector's input is a task block from `TASKS.md`. The operator owns the file; no untrusted data crosses the boundary at selection time. The downstream backend invocation has its own trust boundary (e.g., claude / devin API).
- **Secrets**: backend auth (DEVIN_API_KEY, ANTHROPIC_API_KEY) is held in the operator's environment, never in the task block. The selector reads only the `**Backend**` and `**Tags**` fields.
- **PII**: task bodies may reference host paths; the selector doesn't propagate task bodies into logs (only the choice + rationale).
- **Performance carve-out**: the selector is a pure-function lookup capped at <50 ms; even a 100x slowdown is invisible against iteration p95 of 5+ minutes. No security-vs-performance trade-off.
