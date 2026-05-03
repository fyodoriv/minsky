# Minsky

> A reproducible recipe for running Claude Code agents 24/7 on a Max subscription — without going over budget, without manual babysitting, without untracked drift.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## What this is in 30 seconds

Minsky is a **curated stack + small custom layers** that wires existing tools (Claude Code, OMC personas, OpenTelemetry, systemd / launchd, the [tasks.md](https://github.com/tasksmd/tasks.md) queue, Apple Shortcuts) into a single supervised pipeline. The custom layers — published as `@minsky/*` on npm — fill the gaps that no upstream tool covers:

- **`@minsky/budget-guard`** — token-budget watchdog. Reads your usage, decides `NORMAL` / `THROTTLE` / `PAUSE` / `WEEKLY_WARN`, exposes the decision over a flag file (for shell consumers) and HTTP (`localhost:9876/budget`, for the dashboard / Watch).
- **`@minsky/observability`** — three-signal OpenTelemetry adapter (traces / metrics / logs) with `selfTest()` health probes.
- **`@minsky/handoff-spec`** — parseable record format for cross-agent handoffs (subject / from / to / status / artifacts / blockers / suggested next).
- **`@minsky/token-monitor`** — `TokenMonitor` interface; real Strategy against [Maciek's `claude-monitor`](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) (in flight).
- **`@minsky/mape-k-loop`** — the autonomic manager that runs the spec monitor, identifies the bottleneck, and A/Bs prompt variants (planned, largest novel layer).

Everything is MIT, every dependency lives behind an interface (`novel/adapters/`), every rule in [`vision.md`](./vision.md) traces to a published source, every change in this repo is a [pre-registered experiment](./vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes).

## What this is *not*

- **Not a framework.** No multi-agent runtime, no proprietary task queue, no proprietary loop driver. Each of those is an existing tool we adapt.
- **Not for one-off quick fixes.** This repo is a long-tail investment in a system that runs for years. Every change carries a hypothesis + measurement + pivot threshold under [iron rule #9](./vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes); if a fix can't justify that overhead, it belongs elsewhere.
- **Not an IDE plugin** · **not a productivity tool** · **not a chatbot.** Minsky targets the supervisor layer, not the editor.

## Status

**Pre-alpha. Active development.** What works today:

- ✅ Core decision logic + watchdog loop in `@minsky/budget-guard`
- ✅ Flag-file envelope (`${MINSKY_HOME}/.minsky/budget.flag`) and HTTP envelope (`localhost:9876/budget`)
- ✅ OpenTelemetry adapter with `selfTest()` (`@minsky/observability`)
- ✅ Handoff record format + parser + validator (`@minsky/handoff-spec`)
- ✅ Supervisor unit-file templates for systemd + launchd (`distribution/`)
- ✅ Iron rule #9 (pre-registered hypothesis-driven development) wired across `vision.md` / `AGENTS.md` / `TASKS.md` policy

What doesn't work yet — see [`TASKS.md`](./TASKS.md): the Maciek `TokenMonitor` Strategy, the MAPE-K loop, the spec-monitor, the Watch dashboard, the experiment runner / tracker (rule #9 automation layer).

## Quickstart

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
./setup.sh
```

`./setup.sh` is idempotent and ends with a GREEN / YELLOW / RED self-test. Re-run any time. `./setup.sh --doctor` runs self-tests only; `./setup.sh --reset` rebuilds from scratch.

Then in Claude Code from this directory:

```text
/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
/plugin install oh-my-claudecode
/plugin install ralph-wiggum
/next-task
```

`/next-task` is queue mode by default — it picks the highest-priority unblocked task in [`TASKS.md`](./TASKS.md), ships it as a PR, loops to the next, and stops only when the queue is empty across all `~/apps/*/TASKS.md` and the audit cascade is clean.

## Why it's interesting

Most agent stacks (OMC, CrewAI, MetaGPT, Microsoft Agent Framework, Composio AO) optimise the **inner** loop — make one task ship faster. Minsky optimises the **outer** loop:

- **Stay alive** under process death, rate limits, network partitions, OS sleep, upstream drift — Erlang/OTP supervision, not try/catch.
- **Stay on budget** by treating tokens as an SRE-style error budget (Beyer et al. 2016) and pre-empting the rate limiter, never being throttled by it.
- **Stay on mission** via runtime specification monitoring — the spec monitor reads `vision.md` plus recent work and reports drift (Havelund & Goldberg 2008).
- **Get better** via a MAPE-K loop (Kephart & Chess 2003): observe persona-level metrics, identify the bottleneck (Goldratt TOC), A/B test prompt variants via DSPy, roll out winners with a sustained-gain check.

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
| [`vision.md`](./vision.md) | Constitution: nine non-negotiable rules, glossary, pattern-conformance index, success criteria |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | All dependencies wired through interfaces; data flow; supervision tree |
| [`AGENTS.md`](./AGENTS.md) | How any agent (Claude Code, OMC, future tools) should behave when working in this repo |
| [`TASKS.md`](./TASKS.md) | Current work queue ([tasks.md](https://github.com/tasksmd/tasks.md) spec), every task carrying Hypothesis / Success / Pivot / Measurement / Anchor per rule #9 |
| [`research.md`](./research.md) | Living dependency scan, replacement candidates |
| [`competitors/`](./competitors/) | Gap analysis vs OMC, CrewAI, MetaGPT, Microsoft Agent Framework, Composio AO |
| [`user-stories/`](./user-stories/) | One file per story; metric, integration test, proof, failure modes |

Two governance disciplines are load-bearing: every Minsky-coined term resolves to a published source via the [Glossary](./vision.md#glossary--every-term-has-a-cs-anchor) (rule #5), and every artifact maps to a published pattern via the [Pattern conformance index](./vision.md#pattern-conformance-index) (rule #8) — deviations are declared explicitly. Both rules are enforced by CI lints (in flight).

## Tech defaults

- **Node.js + TypeScript** for everything in `novel/` (publishes to npm under `@minsky/*`)
- **pnpm** workspaces · **Biome** lint + format · **Vitest** with 90 % line / 85 % branch coverage gate · **lefthook** for pre-commit
- **Strictest TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- **OpenTelemetry** everywhere — every novel package emits at least one span per public method
- **systemd / launchd** for process supervision; let-it-crash discipline (Armstrong 2007)
- **MIT** throughout; every novel layer extracted as its own MIT repo from day one

[vision.md § Theoretical foundations](./vision.md#theoretical-foundations) lists the literature each choice is grounded in.

## License

MIT. See [LICENSE](./LICENSE).
