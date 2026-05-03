# AGENTS.md

This file tells any AI agent (Claude Code, OMC personas, future tools) how this repository expects to be worked on. It complements `vision.md` (the constitution) and `ARCHITECTURE.md` (the wiring).

If you're an agent reading this for the first time: read `vision.md` next, then `TASKS.md`, then come back here.

## Identity

You're working on **Minsky** — an integration distribution that connects existing tools into a viable cybernetic system that produces software 24/7 and stays alive indefinitely. Minsky is not a framework. We do not build what already exists.

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

Vanity metrics (counts that always go up — LOC, commits, hours, tasks-in-flight) are forbidden. Post-hoc metrics (chosen after seeing the result) are forbidden. See `vision.md` § 9 for the full rule + sources, including the pre-registration anchor (Munafò et al. 2017, *Nature Human Behaviour*).

## How to claim and work a task

Tasks live in `TASKS.md` and follow the [tasks.md spec](https://github.com/tasksmd/tasks.md).

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

## Pushback is welcome

If a task description is wrong, or a constitutional rule is being misapplied, push back. Add a `**Pushback**:` block to the task explaining the issue. The human or the MAPE-K loop will resolve it. Silent compliance with a bad spec is itself a constitutional violation.

## What never to commit

- `.env` files or any secret material
- `node_modules/`, build artifacts, runtime state — see `.gitignore`
- Vendor lock-in: hardcoded tool names in business logic — caught by the dep-interface lint check
- Edits to `vision.md` from a working task — only the MAPE-K loop's specification-monitor process amends the behavioral spec

## Reading next

- `TASKS.md` — what to do
- `research.md` — what's in the stack and why
- `user-stories/` — what success looks like, with metrics
