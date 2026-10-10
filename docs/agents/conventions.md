# File, code, test, and documentation conventions

This file exists to hold the full repository conventions that `AGENTS.md` summarizes: the folder layout, filename casing, and the code, test, and documentation rules.

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
