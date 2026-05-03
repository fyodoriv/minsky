# Minsky

> A society of minds. Building yours.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

An **integration distribution** for autonomous Claude Code: a curated stack that produces software 24/7 — on-budget, on-mission, getting better — and stays alive indefinitely.

Not a framework. Doesn't ship a multi-agent runtime, a task queue, a loop driver, a dashboard, or a mobile surface. Each of those exists already. Minsky **picks them, configures them, wires them through versioned interfaces, and adds the small layers nobody else is building**.

## Quickstart

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
./setup.sh
```

Then in Claude Code from this directory:

```text
/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
/plugin install oh-my-claudecode
/plugin install ralph-wiggum
/next-task
```

`./setup.sh` is idempotent and ends with a GREEN / YELLOW / RED self-test. Re-run any time. `./setup.sh --doctor` runs self-tests only; `./setup.sh --reset` rebuilds from scratch.

`/next-task` is queue mode by default — it picks the highest-priority unblocked task in [`TASKS.md`](./TASKS.md), ships it as a PR, loops to the next, and stops only when the queue is empty across all `~/apps/*/TASKS.md` and the audit cascade is clean.

## What it does

Most agent stacks (OMC, CrewAI, MetaGPT, Microsoft Agent Framework, Composio AO) optimise the *inner* loop — make one task ship faster. Minsky optimises the *outer* loop:

- **Stay alive** under process death, rate limits, network partitions, OS sleep, upstream drift — Erlang / OTP supervision, not try / catch.
- **Stay on budget** by treating tokens as an error budget (Google SRE) and pre-empting the rate limiter, never being throttled by it.
- **Stay on mission** via runtime specification monitoring — a Claude Skill reads `vision.md` plus recent work and reports drift.
- **Get better** via a MAPE-K loop (Kephart & Chess 2003): observe persona-level metrics, identify the bottleneck (Goldratt TOC), A / B test prompt variants via DSPy, roll out winners.

## How it fits together

```text
┌─────────────────────────────────────────────────────────────────┐
│ IDENTITY     vision.md                                           │
│ INTELLIGENCE research.md, competitors/, user-stories/            │
│ CONTROL      mape-k-loop, spec-monitor, error budgets            │
│ COORDINATION tasks.md (queue), handoffs/ (blackboard)            │
│ OPERATIONS   OMC personas, MCP tools                             │
│ NERVOUS SYS  OpenTelemetry → dashboards (CLI / web / Watch)      │
└─────────────────────────────────────────────────────────────────┘
```

Stafford Beer's Viable System Model. Lower layers are existing tools (OMC, tasks.md, OTEL, systemd / launchd). Upper layers are the small custom packages, each extracted as `@minsky/*` on npm from day one.

[`ARCHITECTURE.md`](./ARCHITECTURE.md) has the full wiring, the adapter pattern, the dependency table, and the supervision tree.

## Read first

| File | Purpose |
| --- | --- |
| [`vision.md`](./vision.md) | Constitution, eight rules, glossary, pattern-conformance index, success criteria |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | All dependencies wired through interfaces; data flow; supervision tree |
| [`AGENTS.md`](./AGENTS.md) | How any agent should behave when working in this repo |
| [`TASKS.md`](./TASKS.md) | Current work queue ([tasks.md](https://github.com/tasksmd/tasks.md) spec) |
| [`research.md`](./research.md) | Living dependency scan, replacement candidates |
| [`competitors/`](./competitors/) | Gap analysis vs OMC, CrewAI, MetaGPT, Microsoft, Composio AO |
| [`user-stories/`](./user-stories/) | One file per story; metric, integration test, proof, failure modes |

Two governance rules are load-bearing: every Minsky-coined term resolves to a published source via the [Glossary](./vision.md#glossary--every-term-has-a-cs-anchor) (rule #5), and every artifact maps to a published pattern via the [Pattern conformance index](./vision.md#pattern-conformance-index) (rule #8) — deviations are declared explicitly.

## Tech defaults

- **Node.js + TypeScript** for everything in `novel/` (publishes to npm under `@minsky/*`)
- **pnpm** workspaces · **Biome** lint + format · **Vitest** with 90 % line / 85 % branch coverage gate · **lefthook** for pre-commit
- **Strictest TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- **OpenTelemetry** everywhere — every novel package emits at least one span per public method
- **systemd / launchd** for process supervision; let-it-crash discipline
- **MIT** throughout; every novel layer extracted as its own MIT repo from day one

[vision.md § Theoretical foundations](./vision.md#theoretical-foundations) lists the literature each choice is grounded in.

## Status

Pre-alpha. Active development. PR-by-PR delivery — every change merges only after CI is green. See [TASKS.md](./TASKS.md) for the current priority queue.

## License

MIT. See [LICENSE](./LICENSE).
