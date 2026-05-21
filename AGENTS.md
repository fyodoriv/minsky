# AGENTS.md

This file tells any AI agent (Claude Code, OMC personas, future tools) how this repository expects to be worked on. It complements `vision.md` (the constitution) and `ARCHITECTURE.md` (the wiring).

If you're an agent reading this for the first time: read `MILESTONES.md` first (the roadmap + capability tables), then `vision.md` (the constitution), then `TASKS.md` (the work queue), then come back here.

**Before implementing any feature**, check `DEPRECATED.md` — it lists features that should NOT receive new work (hard scope-leak mode, observer-watch.sh, dogfood scripts, dashboard-web, hardcoded timeout env vars, manual stop/start flows). Use the replacement instead.

## Repository setup

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
pnpm install   # prepare hook: (a) tsc -b builds all workspace dist/; (b) lefthook installs git hooks
pnpm minsky doctor   # verify health
```

No separate build step needed. `pnpm install` runs the root `prepare` hook which calls `tsc -b` to compile every workspace package's `dist/` (including `@minsky/tick-loop`). If `dist/` is missing at runtime, `pnpm minsky` exits 1 with a one-line actionable message rather than a node stack trace.

## Running minsky

```bash
minsky --daemon --hosts-dir <repos-parent-dir>  # background daemon across repos
minsky --local --daemon                     # local-only (zero cloud tokens)
minsky status                               # PID, uptime, log tail
minsky logs                                 # tail -f daemon log
minsky stop                                 # SIGTERM → graceful drain
```

**`--daemon`** backgrounds the process (logs to `~/.minsky/daemon.log`, PID file at `~/.minsky/daemon.pid`). SIGHUP-immune — survives terminal close / IDE restart.

**`--local`** forces local-only mode (`MINSKY_LLM_PROVIDER=local-only`). Uses the local agent (aider + ollama) from `~/.minsky/config.json`. Zero cloud tokens.

### Per-machine agent config — `~/.minsky/config.json`

**Always check this file first** when starting minsky on any machine. It determines which agents and models run.

```json
{
  "cloud_agent": "devin",               // "devin" | "claude"
  "cloud_agent_model": "claude-opus-4-7-max",  // passed as --model
  "local_agent": "aider",               // local-only mode agent
  "local_agent_model": "ollama_chat/qwen3-coder:30b",
  "local_agent_args": ["--model", "ollama_chat/qwen3-coder:30b", "--no-auto-commits"],
  "ollama_base_url": "http://localhost:11434"
}
```

**Resolution priority** (highest wins, per key):

| Layer | When | Example |
|---|---|---|
| Env var (one session) | `MINSKY_CLOUD_AGENT=claude minsky ...` | override for one run |
| `~/.minsky/config.json` | persistent per-machine | edit file to change permanently |
| Default | no config, no env | `claude` for cloud, `aider` for local |

**Agent support matrix:**

| Agent | Cloud | Local | Brief delivery | Model flag |
|---|---|---|---|---|
| `claude` | ✅ | — | stdin | `--model` |
| `devin` | ✅ | — | `--prompt-file` (stdin panics) | `--model` |
| `aider` | — | ✅ | `--message-file` | `--model` via config args |

## Identity

You're working on **Minsky** — an integration distribution that connects existing tools into a viable cybernetic system that produces software 24/7 and stays alive indefinitely. Minsky is not a framework. We do not build what already exists.

Code in this repo is AI-authored — cloud agents and local models both count. Add `Authored-by-agent: <id>`, `Co-Authored-By:`, or a `🤖 Authored by <agent>` PR-body footer to every commit you ship. The convention is human-readable, not mechanically enforced; we trust attestation honesty. Full policy at [`CONTRIBUTING.md`](CONTRIBUTING.md).

See `vision.md` § "What Minsky is" for full identity.

## Constitutional rules (non-negotiable)

These come from `vision.md`. Violations are reported by the MAPE-K loop's specification monitor (`claude-spec-monitor`) — runtime specification monitoring per Havelund & Goldberg 2008.

### 1. Don't reinvent the wheel

Before writing any new code, search for an existing tool. If one exists, write an adapter (see rule 2). If none exists, design the new code as an extractable OSS package from day one — not a private module. Apply continuously, not only at start.

### 2. Every dependency is accessed through an interface

No tool name appears in business logic. New external dependencies require:

- An interface file in `novel/adapters/<name>.ts`
- An implementation file in `novel/adapters/<name>.<vendor>.ts`
- A `selfTest()` method on the implementation, runnable from `setup.sh`
- A row added to the dependency table in `ARCHITECTURE.md`

### 3. Test-first, metric-first, doc-first

Every change starts with:

1. A failing test (red)
2. A metric in the relevant `user-stories/*.md` file with a numeric threshold and an SLI source
3. Updated documentation in the same commit as the code change

Then write the minimum code to pass (green). Then refactor.

No exceptions. Apply at every level: code, persona behavior, orchestration logic, even the autonomic manager's own decisions.

**Acceptance-scenario gate (spec-kit Article III reinforcement).** Before a test file is written, the acceptance criteria the test will assert must exist as Given/When/Then scenarios in either `user-stories/<id>.md` or `.minsky/specs/<task-id>.md`. A test without a traceable GWT scenario is orphaned — it can pass for the wrong reason and cannot be falsified against the original intent. Order: write GWT scenarios first (via `/task-spec`), then the test, then implement. Source: spec-kit `spec-template.md` § "User Scenarios & Testing"; conforming pattern: BDD acceptance-test specification (Wynne & Hellesøy, *The Cucumber Book*, 2012).

**Independent testability gate.** Every user story or vertical slice — whether in `user-stories/*.md` or in a spec's story decomposition — must pass the spec-kit independent-testability test: "If you implement just this one story, do you have a viable, demonstrable unit of value?" If yes, the story is correctly bounded. If no, the story spans too many concerns and must be split before `/task-slice`. Source: spec-kit `spec-template.md` IMPORTANT comment block; conforming pattern: vertical-slice delivery (Cockburn, *Crystal Clear*, 2004, Ch. 3).

### 4. Everything measurable, everything visible

New components emit OpenTelemetry. New metrics appear on a dashboard. If a metric matters enough to track, it's reachable from the Watch.

If you can't see it, it doesn't exist. If you have to dig for it, you won't.

### 5. Theoretical grounding

Architectural choices reference named patterns (Hewitt actor model, Beer VSM, Armstrong supervision, Boyd OODA, etc. — see `vision.md` § "Theoretical foundations"). Don't invent terminology when literature has a word for it.

### 6. Stay alive

Code paths must handle: process death, rate limit hits, dependency failures, mid-task interruption. Idempotency is default. Long try-catch chains are a smell — prefer "let it crash" with supervisor restart, per Erlang/OTP discipline.

### 7. Chaos engineering

Trust no component whose failure probability is not provably ≤1e-12. Every novel package and every user-story file enumerates failure modes, expected behavior (`loud-crash-supervisor-restart` / `circuit-break-and-notify` / `graceful-degrade`), a deterministic chaos test, and explicit blast radius + operator escape hatch. Silent retry-with-backoff that suppresses failure is itself a constitutional violation. See `vision.md` § 7 for the full rule + sources.

### 8. Pattern conformance

Every artifact (file, package, interface, architectural decision, process step) traces to a named, published pattern. New artifacts add a row to `vision.md` § "Pattern conformance index" *in the same commit*. Deviations from the published pattern are declared explicitly in the row's notes column (which property differs, why it's acceptable, what would restore full conformance) and, for substantive deviations, in `research.md`. Identifiers match pattern names when the match is total (`aggregateStatus`, future `MapeKLoop`, `SupervisionTree`, `CircuitBreaker`). Top-of-file comments name the pattern; JSDoc on public interfaces cites it. Silent deviation is itself a constitutional violation. See `vision.md` § 8 for the full rule + sources.

### 9. Pre-registered hypothesis-driven development (iron rule)

Every change — every PR, every novel package, **every bugfix**, every refactor — declares, **before code is written**: **hypothesis** (Goal-Question-Metric, Basili 1994), **success threshold** (numeric or rubric), **pivot threshold** (numeric — the value below which the *approach* is abandoned, per Ries 2011 build-measure-learn), **measurement method** (exact runnable shell / OTEL / CI command — no English instructions; tag `<TBD-AFTER: <task-id>>` if the system isn't built yet), and **literature anchor** for the metric.

This is **iron**: no exemption for "small fixes", "obvious bugs", or "just a refactor". A bugfix's hypothesis is "the recurrence rate (or a stability metric to which it contributes) drops from X to Y after this fix"; if that statement can't be made, the root cause hasn't been identified.

If the metric source doesn't exist yet, ship a **preparation PR** that lands the instrumentation, then open the change PR against the now-measurable baseline. Preparation PRs are first-class work; never skip the metric on the grounds that "we'll instrument later".

**Automation layer.** Rule #9 commits the repo to executing the contract, not just declaring it. Three timescales: per-PR (daily — `ci-experiment-runner-v0`), weekly–monthly (`experiment-tracker-v0`), quarterly (folded into `mape-k-loop-v0` and `review-q3-2026`). Pre-registration without execution is half a rule. See `vision.md` § 9 for the full architecture.

Vanity metrics (counts that always go up — LOC, commits, hours, tasks-in-flight) are forbidden. Post-hoc metrics (chosen after seeing the result) are forbidden. See `vision.md` § 9 for the full rule + sources, including the pre-registration anchor (Munafò et al. 2017, *Nature Human Behaviour*).

**NEEDS-CLARIFICATION inventory gate (spec-kit reinforcement).** Before a task is claimed and before code is written, every item in the task block or its spec that cannot be answered from existing files must be listed explicitly as `[NEEDS CLARIFICATION: <exact question>]` — not silently assumed away. Assumptions block falsifiability: an assumed input means the hypothesis was never fully stated. Use `/task-spec` to surface the inventory; resolve it via `/grill-task`; commit the resolved list to `.minsky/specs/<task-id>.md`. A task with unresolved NEEDS-CLARIFICATION items must stay in `needs-info` state (see `/triage`). Source: spec-kit `spec-template.md` "NEEDS CLARIFICATION" convention; conforming pattern: explicit-assumption logging (Cockburn, *Writing Effective Use Cases*, 2001, Ch. 5).

### 10. Deterministic enforcement (iron rule)

Every constitutional rule must be enforced by a deterministic CI check — not a Skill, not an LLM, not "the agent will remember". Same input, same output, no model call in the chain. LLM-driven checks (Claude Skills like `claude-spec-monitor`) are *advisory only* and useful for *discovering* rule gaps; they are never load-bearing for *enforcing* rules. When a rule resists mechanisation, split it into a deterministic substrate (the lint catches presence/shape) plus an explicit human-judgement layer — never quietly delegated to a Skill. When a deterministic linter ships for a rule, any prior Skill-based enforcement is *removed* in the same PR (the ratchet rule — never two enforcement mechanisms competing). See `vision.md` § 10 for the full rule + sources.

**Constitutional-gate pattern (spec-kit reinforcement).** Deterministic CI gates should be structured as explicit phase gates: a check that must pass before the next phase of work begins. Concretely: GWT scenarios must exist before tests are written (spec gate); tests must fail before implementation begins (red gate); rule-#9 pre-registration must be committed before code is merged (pre-reg gate). These gates are additive — each new deterministic lint added under rule #10 should declare which phase it guards and which constitutional rule it enforces, both in the CI workflow comment and in `vision.md` § "Pattern conformance index". Source: spec-kit `plan-template.md` § "Phase -1: Pre-Implementation Gates"; conforming pattern: phase-gate process (Cooper, *Winning at New Products*, 2001, Ch. 3 — stage-gate model adapted to software).

### 11. Default by default (rule #16)

When you implement a new behavior or fix, **make it the default immediately** — not an opt-in flag behind an env var. If a behavior is reasonable for all users, it should be on by default the moment it ships.

Examples of "default by default":

- Scope-leak soft mode → default (not `MINSKY_SCOPE_LEAK_MODE=warn`)
- Launchd persistence → auto-installed on first `minsky` run (not a separate `install-daemon` step)
- Dynamic timeouts → computed automatically (not `MINSKY_CLAUDE_PRINT_TIMEOUT_MS=...`)
- Smart auto-attach → just works when you type `minsky` (not `minsky --attach-or-start`)

**Every new default ships with:**

1. **An experiment** in `.minsky/experiments/<id>.yaml` with hypothesis + success threshold
2. **A measurement** — a runnable command that verifies the default works
3. **An opt-out** — an env var or flag to disable (for debugging only, documented in DEPRECATED.md as soon as it's never used)

The burden of proof is on the opt-in side: "why ISN'T this the default?" not "why SHOULD this be the default?"

### 12. Proactive healing (rule #17 — iron, no exemption)

**Observation IS the fix.** Every error you see — `spawn-failed`, `scope-leak`, `ETIMEDOUT`, `GraphQL 401`, stack traces, hung processes, flaky tests, red CI checks — is treated as work to ship in the SAME session, the SAME PR if possible. "Observe and report" is forbidden. "Mental note for later" is forbidden.

Four mandatory parts:

1. **Same-session action.** The agent who observed the error owns the fix before its session ends. If the fix needs an external action, file a `TASKS.md` block with `**Blocked**: <one-word-code>` and the unblock path on the first line — never both fix-attempted and silently-moved-on.
2. **Fix the class, not the instance.** Land the lint or invariant that prevents the entire category (rule #10 shape). A 401 today means the auth path is fragile — add a CI lint, not just a retry.
3. **Heal before reporting.** Every status message to the operator must carry an active verb: `fixed`, `patched`, `rolled out`, or `filed-blocked-because`. A bulleted summary of failures with zero merged fixes is the exact pattern this rule forbids.
4. **Deterministic gate.** `scripts/check-rule-17-proactive-heal.mjs` runs on every PR: if observed-error tokens > 0 and `(prs-opened + tasks-filed + commits-landed) == 0`, the PR is rejected. Same shape as rule #9's missing-`EXPERIMENT.yaml`.

Trigger phrases that activate this rule IMMEDIATELY (don't ask, just fix): "fix bugs before they happen", "be proactive", "heal minsky", "make sure minsky picks them up", "make it persist", "make it iron rule".

### 3a. Runtime invariants (coverage ≠ correctness)

High unit-test coverage (95%+) is necessary but NOT sufficient. Every bug found in production during the 2026-05-18 session (devin stdin panic, permission mode missing, walker starvation, scope-leak false positives, brief missing PR instructions, watchdog kills) had passing unit tests — because unit tests mock the integration seams where real bugs live.

**Runtime invariants** (`novel/cross-repo-runner/src/runtime-invariants.ts`) run before EVERY iteration and check the **system** — not the pure functions. They verify:

- Agent argv includes required flags for the configured agent (catches devin without `--permission-mode`)
- Brief includes PR creation instructions (catches the no-PR-opened bug class)
- Git tree is clean before spawn (catches scope-leak false positives)
- Task not stuck in a re-pick loop (catches walker starvation)
- Daemon PID is actually alive (catches stale PID, the #1 ops failure)

When a runtime invariant fails with `severity: "error"`, the iteration **must not proceed** — the bug class it guards against wastes the entire iteration's compute. When it fails with `severity: "warn"`, log it and continue (the operator sees it in `minsky watch`).

**Adding new invariants**: every bug found in production becomes a runtime invariant in the same PR that fixes it. The pattern: `(ctx: InvariantContext) => InvariantResult`. Pure function, no I/O — the caller builds the context.

### 3b. Integration tests for CLI features (reinforcement)

Every CLI-facing feature (`bin/minsky` subcommands, `minsky watch`, `minsky status`, any operator-visible UX) must ship with an integration test in `test/integration/`. The test must:

1. Exercise the real script/binary (not a mock).
2. Use fixture data (temp dirs with synthetic jsonl/yaml) for deterministic results.
3. Assert on the output format the operator sees.

A dashboard feature without an integration test is a regression waiting to happen. Paired unit tests in `novel/*/src/*.test.ts` are not sufficient — the integration test catches the wiring between the bash shim, node scripts, and file-system state.

### 14b. Dynamic settings (no hardcoded timeouts)

All timeouts, intervals, thresholds, and resource limits must be **dynamically computed** from actual iteration history on the current machine — never hardcoded. Different machines have different CPUs, network latencies, and model routing speeds. A watchdog that's correct for Claude on a fast machine kills Devin on a slow one.

The implementation (`novel/cross-repo-runner/src/dynamic-timeouts.ts`):

- **Spawn watchdog** = p95(successful iteration durations) × 1.5, clamped to [2min, 45min]. With <5 data points, defaults to 20min.
- **Tick interval** = p50(successful iteration durations) × 0.1, clamped to [30s, 5min].
- History source: `.minsky/experiment-store/cross-repo/*.jsonl` — the same iteration records the runner already writes.
- Env var `MINSKY_LIVE_SPAWN_TIMEOUT_MS` overrides the dynamic value (escape hatch).

When adding any new configurable constant, follow this pattern: compute from data first, hard-default second, env-override third. Log the computed value so the operator sees it in the daemon log.

### 15. Milestone alignment gate (supersedes task picking)

Before picking ANY implementation task, verify that **seven surfaces** are up-to-date and aligned with the current milestone in `MILESTONES.md`. If any surface is stale or misaligned, updating it IS your first task — not picking an implementation task. This is iron: no exemption.

The seven surfaces:

1. **`README.md`** — reflects the current milestone's install, run, benefits, and competitive positioning. The quickstart section must match the actual one-command flow that works today, not a future aspiration.
2. **Quickstart** — whatever `README.md` says you can do, you can actually do it right now. If the quickstart says `npx minsky init`, that command must work.
3. **`vision.md`** — milestone goals are reflected in the success criteria section. Milestones and vision must not contradict.
4. **`user-stories/`** — each exit criterion in the current milestone's table in `MILESTONES.md` has a corresponding user story file with a metric, integration test reference, proof, and failure modes. Missing user stories for shipped milestone criteria are a gap.
5. **Integration tests** — user-story tests in `user-stories/*.test.ts` exist and pass for every exit criterion the current milestone claims as shipped. A milestone criterion without a passing integration test is not shipped.
6. **Logs + observability** — OTEL spans, daemon logs (`orchestrate.jsonl`), and any other observability surfaces capture the data needed to verify the current milestone's exit criteria. If a milestone criterion requires measuring X, the system must actually emit X.
7. **`METRICS.md`** — every metric the current milestone depends on has a **real observation** (not a `(stub)`). Stub metrics mean the milestone cannot be verified and therefore cannot be considered progressing.

**Enforcement**: when `scripts/check-milestone-alignment.mjs` exists, run it. Until then, manually audit the 7 surfaces. The audit output goes into the PR body as a `Milestone alignment check` section.

**Operator directive 2026-05-18**: this gate is the #1 priority in all minsky work. Implementation tasks that skip it are constitutional violations.

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

### Choosing an OMC mode for a task

When you invoke OMC commands inside a task, choose the mode based on the task's `**Tags**`:

| Mode | When to use | Trigger |
|------|-------------|---------|
| `/autopilot` | Default. Single coherent feature, sequential pipeline | Tag: any |
| `/team N:role` | Coordinated specialists with shared task list | Tag: `multi-domain`, `coordination` |
| `/ultrawork` (or `ulw`) | Maximum parallelism. Fullstack features, large refactors | Tag: `parallel`, `refactor` |
| `/ralph` | Hairy bugs, high-stakes; won't quit until architect-verified | Tag: `relentless`, `verify-required` |

When in doubt, just describe the work — OMC auto-selects.

### Investor / growth-hacker personas

These OMC personas (`product-manager`, `product-analyst`, `analyst`) only run when the task's `**Tags**` includes one of: `business`, `growth`, `revenue`, `customer`, `pricing`. Otherwise skip them — saves tokens and prevents drift into unrelated commentary.

## File and folder conventions

```text
minsky/
├── vision.md                   ← behavioral specification; only the MAPE-K loop modifies this
├── ARCHITECTURE.md             ← wiring; updated when integration changes
├── AGENTS.md                   ← this file; operating procedures
├── TASKS.md                    ← work queue; tasks.md spec
├── research.md                 ← living dep scan; updated when deps change
├── README.md                   ← brief; entry point
├── LICENSE                     ← MIT
├── setup.sh                    ← bootstrap script
├── user-stories/               ← one file per story; each has Story / Metric / Test / Proof
├── competitors/                ← one file per competitor; each has Strengths / Gaps / Extract
├── novel/                      ← the small custom code (~400-1000 lines total)
│   ├── adapters/               ← interface files + implementations
│   ├── budget-guard/           ← extracted as @minsky/budget-guard
│   ├── handoff-spec/           ← extracted as @minsky/handoff-spec
│   ├── spec-monitor/           ← extracted as @minsky/spec-monitor (Claude Skill)
│   ├── mape-k-loop/            ← extracted as @minsky/mape-k-loop
│   └── bridges/                ← omc-tasksmd-bridge, etc.
└── distribution/               ← configs, systemd/launchd units, install templates, Apple Shortcuts
```

Filename casing:

- `vision.md` — lowercase by convention (constitution)
- `AGENTS.md`, `TASKS.md`, `ARCHITECTURE.md`, `LICENSE`, `README.md` — uppercase (standard spec files)
- Everything else — lowercase with hyphens (`error-budgets.md`, `claim-protocol.md`)

## Code conventions

(Fleshed out as we add code; for now, the rules.)

- TypeScript for `novel/` packages (we publish to npm under `@minsky/*` scope)
- Prettier defaults; no debate
- One adapter per file; interface and implementation in separate files
- Every adapter exports `selfTest(): Promise<TestResult>` for the bootstrap
- Every public function: JSDoc including the metric it affects (if any)
- No business logic inside adapter implementations — adapters are translators only

## Test conventions

- Unit tests next to the code they test (`foo.ts` + `foo.test.ts`)
- Integration tests in `user-stories/*.test.ts`, named to match the user-story file
- Every PR runs the full integration suite against real dependencies (no mocks for adapters in integration tests)
- Coverage thresholds: 80% statements / 70% branches for `novel/` code; adapters tested via integration only

## Documentation rules

- Every doc starts with one paragraph answering "why does this file exist?"
- Cross-link aggressively — the docs form a graph, not a hierarchy
- When code disagrees with docs, the docs win until proven otherwise (then both are fixed in the same commit)
- "last updated" is implied by git; don't manually maintain timestamps in docs

## What to do when stuck

If you're an agent and you're stuck:

1. Re-read `vision.md` and check for a constitutional answer
2. Check `research.md` for a tool that solves your sub-problem
3. Check `competitors/` for how others handled it
4. Add `**Status**: blocked` to the task with a clear `**Reason**:` and move on to the next task
5. Add a new task to `TASKS.md` describing the blocker for the human or a different agent to address

Do not loop. Do not try the same approach repeatedly. Per the constitution, "let it crash" — escalate visibly and continue.

## `**Touches**:` field on task blocks (parallel-launch coordination)

When the daemon runs in parallel mode (`pnpm dogfood --worker-id=N --workers-total=M`), each task block in `TASKS.md` may declare a `**Touches**: <glob>[, <glob>…]` field listing the file globs the task is expected to modify. The daemon's pre-spawn collision check (slice 3 of `daemon-parallel-worktree-launch`, see `novel/tick-loop/src/touches-glob.ts`) refuses to start a worker on a task whose globs overlap any open daemon PR's changed-file list — the second line of defense after `acquireTaskClaim` (slice 1).

Format:

```markdown
- **Touches**: `novel/tick-loop/**`, `scripts/foo.mjs`
```

Multiple comma-separated globs allowed; backticks optional but encouraged for markdown rendering. Supported glob syntax (per `globMatchesPath`): `*` matches any chars including `/`, `?` matches a single char, exact text matches literally — no brace expansion, no character classes. The matcher is intentionally minimal to avoid a `micromatch` / `minimatch` dependency.

Single-process daemon (no `--worker-id`) ignores the field entirely. Empty / absent `**Touches**` is treated as "no globs declared" — the collision check returns `proceed` (lenient default during rollout); strict mode is a future policy choice.

Declare `**Touches**:` on tasks the daemon is likely to pick. Broad meta-tasks (e.g. `security-privacy-priority-substrate`) that span many directories should be decomposed into narrower sub-tasks rather than declaring `novel/**` as a glob — the latter would over-collide.

## Pushback is welcome

If a task description is wrong, or a constitutional rule is being misapplied, push back. Add a `**Pushback**:` block to the task explaining the issue. The human or the MAPE-K loop will resolve it. Silent compliance with a bad spec is itself a constitutional violation.

## What never to commit

- `.env` files or any secret material
- `node_modules/`, build artifacts, runtime state — see `.gitignore`
- Vendor lock-in: hardcoded tool names in business logic — caught by the dep-interface lint check
- Edits to `vision.md` from a working task — only the MAPE-K loop's specification-monitor process amends the behavioral spec

## Reading next

- `MILESTONES.md` — the roadmap, per-milestone capability tables, what minsky will never do
- `TASKS.md` — what to do (137 open tasks; the milestone-alignment-gate task is always first)
- `METRICS.md` — the 10 canonical metrics (currently stubs — M1 wires real observations)
- `research.md` — what's in the stack and why
- `user-stories/` — what success looks like, with metrics
