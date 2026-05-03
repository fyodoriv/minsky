# Minsky

> A society of minds. Building yours.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

Minsky is an **integration distribution** for autonomous Claude Code: a curated stack
that runs on a single $100/mo Claude Max 5x subscription and produces software 24/7,
on-budget, on-mission, getting better — indefinitely.

It is not a framework. It does not contain a multi-agent runtime, a task queue, a
loop driver, a dashboard, or a mobile surface. Each of those already exists and is
maintained by someone else. Minsky's job is to **choose them, configure them, wire
them together through versioned interfaces, and add the small layers nobody else is
building**.

## Why

Long-horizon autonomy is a different problem from "make one task ship faster." Most
agent stacks (OMC, CrewAI, MetaGPT, Microsoft Agent Framework, Composio AO) optimise
the inner loop. Minsky optimises the outer loop:

- **Stay alive** under process death, rate limits, network partitions, OS sleep, and
  upstream behaviour drift — Erlang/OTP supervision, not try/catch.
- **Stay on budget** by treating tokens as an error budget (Google SRE) and pre-empting
  the rate limiter, never being throttled by it.
- **Stay on mission** via runtime specification monitoring — a Claude Skill reads the
  project specification (`vision.md`) plus recent work, reports drift.
- **Get better** via a MAPE-K loop (Kephart & Chess 2003 autonomic computing): the
  *autonomic manager* observes persona-level metrics, identifies the bottleneck
  (Goldratt TOC), runs A/B tests via DSPy, rolls out winners.

See [`vision.md`](./vision.md) for the full constitution, and the
[Glossary](./vision.md#glossary--every-term-has-a-cs-anchor) for the term-to-CS-source
mapping rule (every Minsky-coined word has a literature anchor).

## How it fits together

```text
┌─────────────────────────────────────────────────────────────────┐
│ IDENTITY    vision.md                                            │
│ INTELLIGENCE research.md, competitors/, user-stories/            │
│ CONTROL     mape-k-loop, spec-monitor, error budgets             │
│ COORDINATION tasks.md (queue), handoffs/ (blackboard)            │
│ OPERATIONS  OMC personas, MCP tools                              │
│ NERVOUS SYS OpenTelemetry → dashboards (CLI/web/Watch)           │
└─────────────────────────────────────────────────────────────────┘
```

Stafford Beer's Viable System Model. The lower layers are existing tools (OMC,
tasks.md, OTEL, systemd/launchd). The upper layers are the small custom packages
this repo extracts as `@minsky/*` on npm from day one.

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full wiring, the adapter pattern,
the dependency table, and the supervision tree.

## Quickstart

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
./setup.sh
```

`./setup.sh` is idempotent, prints loading + error states, and ends with a
`GREEN/YELLOW/RED` self-test report. Re-run any time. `./setup.sh --doctor` runs
self-tests only; `./setup.sh --reset` rebuilds from scratch.

After setup, in Claude Code from this directory:

```text
/plugin install oh-my-claudecode
/plugin install ralph-wiggum
/next-task
```

## Read first

| File | Purpose |
| --- | --- |
| [`vision.md`](./vision.md) | Constitution, principles, success criteria, glossary |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Wiring of all dependencies, adapter pattern, data flow |
| [`AGENTS.md`](./AGENTS.md) | How any agent should behave when working in this repo |
| [`TASKS.md`](./TASKS.md) | Current work queue ([tasks.md](https://github.com/tasksmd/tasks.md) spec) |
| [`research.md`](./research.md) | Living dependency scan, replacement candidates |
| [`competitors/`](./competitors/) | Gap analysis vs OMC, CrewAI, MetaGPT, Microsoft, Composio AO |
| [`user-stories/`](./user-stories/) | One file per story; each with metric, integration test, proof, failure modes |

## Tech defaults

- **Node.js + TypeScript** for everything in `novel/` (publishes to npm under `@minsky/*`)
- **pnpm** workspaces; **Biome** for lint+format; **Vitest** for tests with 90% line / 85% branch coverage gate; **lefthook** for pre-commit
- **Strictest TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- **OpenTelemetry** everywhere — every novel package emits at least one span per public method
- **systemd / launchd** for process supervision; let-it-crash discipline
- **MIT** throughout; every novel layer extracted as its own MIT repo from day one

See [vision.md § Theoretical foundations](./vision.md#theoretical-foundations) for the
literature each choice is grounded in.

## Status

Pre-alpha. Active development. Following PR-by-PR delivery — every change merges only
after CI is green. See [TASKS.md](./TASKS.md) for the current priority queue.

## License

MIT. See [LICENSE](./LICENSE).
