# Minsky

> A reproducible recipe for running a team of AI coding agents on your own machine — supervised, on-budget, and observable. Named after [Marvin Minsky](https://en.wikipedia.org/wiki/Marvin_Minsky) and his [*Society of Mind*](https://en.wikipedia.org/wiki/Society_of_Mind) (1986), which argues that intelligence emerges from many simple specialists cooperating.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## Who this is for

If you've used Claude Code, Cursor, GitHub Copilot, or any other AI coding assistant and thought *"I wish this could just keep working overnight without me babysitting it"* — Minsky is a serious attempt at the supervisor layer that makes that possible.

- **If you're a junior** trying to ship more with one good AI agent: skip ahead to [Quickstart](#quickstart) and run `./setup.sh`. The setup is one command. Every other claim in this README is a link to either code or a paper.
- **If you're a tech lead or manager** worried about runaway token bills, hidden agent state, or "we shipped something nobody can explain": read [Why this exists](#why-this-exists) — this repo is structurally designed around three concerns that matter to you (cost predictability, observability, change traceability).
- **If you're a researcher or platform engineer** interested in how the guarantees compose: every architectural choice cites a paper. The supervision tree is Erlang/OTP, the budget guard is Google SRE, the autonomic loop is IBM MAPE-K, the experiment discipline is open-science pre-registration. See [Theoretical foundations](./vision.md#theoretical-foundations).

## What this actually is, in 30 seconds

A **curated stack + small custom layers** that wires together existing tools — [Claude Code](https://claude.com/claude-code), [oh-my-claudecode (OMC) personas](https://github.com/Yeachan-Heo/oh-my-claudecode), [OpenTelemetry](https://opentelemetry.io/), systemd / launchd, the [tasks.md queue spec](https://github.com/tasksmd/tasks.md), Apple Shortcuts — into one supervised pipeline. The custom layers, published as `@minsky/*` on npm, fill gaps no upstream tool covers:

- **`@minsky/budget-guard`** — token-budget watchdog. Reads your usage and decides `NORMAL` / `THROTTLE` / `PAUSE` / `WEEKLY_WARN`. Exposes the decision to shell scripts (a flag file) and HTTP (`localhost:9876/budget`).
- **`@minsky/observability`** — three-signal OpenTelemetry adapter (traces / metrics / logs) with health-probe `selfTest()`.
- **`@minsky/handoff-spec`** — parseable record format for handoffs between agents (subject / from / to / status / blockers / suggested next).
- **`@minsky/token-monitor`** — interface + planned Strategy against [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) (the Python tool that actually surfaces Anthropic's hidden usage numbers).
- **`@minsky/mape-k-loop`** — the autonomic manager that runs a spec monitor, identifies the bottleneck, A/Bs prompt variants, and rolls out winners. v0 ships pure `monitor` / `analyze` / `plan` / `execute` / `knowledge` decision functions plus the assembled `tick` cycle (sustained-gain + oscillation guards) — see [`novel/mape-k-loop/`](./novel/mape-k-loop/).

Everything is MIT, every dependency lives behind an interface (`novel/adapters/`), every rule traces to a published source, and every code change in this repo carries a [pre-registered hypothesis + measurement](./vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes).

## What this is *not*

- **Not a framework.** No multi-agent runtime, no proprietary task queue, no proprietary loop driver. We adapt existing tools rather than rebuild them.
- **Not for one-off quick fixes.** Every change in this repo carries the iron-rule overhead (hypothesis + measurement + pivot). If your fix can't justify that, it belongs in another repo.
- **Not an IDE plugin** · **not a productivity tool** · **not a chatbot.** Minsky targets the supervisor layer, not the editor.

## The `minsky` CLI (operator UX)

Minsky ships a single repo-rooted CLI: `pnpm minsky` (or `node novel/tick-loop/bin/minsky.mjs`). Sane defaults + auto-bootstrap:

```bash
pnpm minsky                  # start-or-attach worker 0 (default); auto-detects
                             # Claude exhaustion + offers to install local-LLM
                             # fallback (~17 GB Qwen3 weights via mlx-lm + aider)
                             # with one [Y/n] confirm prompt
pnpm minsky doctor           # read-only health probe — claude / pipx / mlx-lm /
                             # aider / model weights / mlx-lm.server reachable
pnpm minsky bootstrap-local-llm  # explicitly run the local-LLM install plan
pnpm minsky logs             # tail worker 0's log live
pnpm minsky stop             # SIGTERM the daemon; leave the log
```

The auto-bootstrap pre-flight is idempotent — re-running `pnpm minsky` on a set-up machine adds <500 ms wall-clock (one fetch against `127.0.0.1:8080/v1/models`) and threads `MINSKY_LOCAL_LLM=1 MINSKY_LLM_PROVIDER=local-preferred` into the spawned daemon.

**Operator escape hatches**: `MINSKY_NO_AUTO_BOOTSTRAP=1` skips the pre-flight entirely; `MINSKY_NON_INTERACTIVE=1` (or non-TTY stdin) auto-confirms the install prompt.

The CLI is intentionally repo-rooted (not a global `npm install -g` package) so the daemon's worktree, `.minsky/state.json`, and the workspace's pnpm dependencies stay co-located with the code. To run from outside the repo, alias it: `alias minsky="pnpm --dir ~/apps/minsky minsky"`.

## Why this exists

Most agent stacks ([OMC](https://github.com/Yeachan-Heo/oh-my-claudecode), [CrewAI](https://github.com/joaomdmoura/crewAI), [MetaGPT](https://github.com/geekan/MetaGPT), Microsoft Agent Framework, Composio AO) optimise the **inner** loop — make one task ship faster. Minsky optimises the **outer** loop. Three concrete promises, each with a track-record of being broken in real-world deployments and each addressed by a specific design choice here:

1. **Stay alive** under process death, rate limits, network partitions, OS sleep, upstream drift. Approach: Erlang/OTP supervision (Armstrong 2007), let-it-crash discipline, no try/catch chains.
2. **Stay on budget.** Treat tokens as an SRE-style error budget (Beyer et al., *Site Reliability Engineering*, 2016, ch. 3) and pre-empt the rate limiter rather than getting throttled by it. The budget watchdog ships in [`@minsky/budget-guard`](./novel/budget-guard/).
3. **Stay on mission.** Runtime specification monitoring (Havelund & Goldberg, *VSTTE* 2008) reads `vision.md` plus recent work and reports drift. *Every* change is a pre-registered experiment with a declared hypothesis, success threshold, pivot threshold, and measurement command (Munafò et al., *Nature Human Behaviour*, 2017 — pre-registration; Ries 2011 — build-measure-learn).
4. **Get better.** A MAPE-K autonomic loop (Kephart & Chess, *IEEE Computer* 2003): observe persona-level metrics, identify the bottleneck (Goldratt, *The Goal*, 1984), A/B test prompt variants, roll out winners with a sustained-gain check.

The named patterns aren't decoration — they're the debuggability promise. When something breaks at 3am, *"this is supervision-tree pattern, restart strategy is one-for-one"* is a debuggable answer; *"this is how I happened to wire it"* is not.

## Status

**Pre-alpha. Active development.** What works today:

- ✅ Core decision logic + watchdog loop in `@minsky/budget-guard`
- ✅ Flag-file envelope (`${MINSKY_HOME}/.minsky/budget.flag`) and HTTP envelope (`localhost:9876/budget`)
- ✅ OpenTelemetry adapter with `selfTest()` (`@minsky/observability`); OpenObserve install + dashboard `OpenObserveStrategy` (live PromQL read path)
- ✅ Handoff record format + parser + validator (`@minsky/handoff-spec`)
- ✅ Supervisor unit-file templates for systemd + launchd (`distribution/`)
- ✅ Maciek `TokenMonitor` Strategy (`@minsky/token-monitor` — reads `~/.claude/projects/<cwd>/<session>.jsonl` directly)
- ✅ MAPE-K autonomic loop v0 (`@minsky/mape-k-loop` — pure `monitor` / `analyze` / `plan` / `execute` / `knowledge` + assembled `tick`; sustained-gain + oscillation guards) + `mape-k-orchestrator` (rule-#9 self-improvement loop wiring; experiment-tracker → orchestrator ingestion closes the quarterly-close path)
- ✅ Tick-loop daemon v0 (`@minsky/tick-loop` — production default = `ProcessSpawnStrategy`; real `BudgetGuard` via facade; `MINSKY_TICK_DRY_RUN=1` opt-in dry-run for the rollout window)
- ✅ Persona spawner v0 (`@minsky/persona-spawner` — Adapter over `omc /team <persona>`; dispatch table maps task tags to OMC personas)
- ✅ Notifier v0 (`@minsky/notifier` — Adapter over push channels; `NtfyNotifier` Strategy + `StubNotifier` test fake)
- ✅ Spec monitor — deterministic CI lints (load-bearing per rule #10, see `scripts/check-rule-{1..7}-*.mjs` + `scripts/check-pattern-index.mjs` + `scripts/check-pr-self-grade.mjs` + `scripts/check-anchor-primary-source.mjs` + `scripts/check-pivot-success-margin.mjs` + `scripts/check-measurement-inspects-output.mjs` + `scripts/check-skill-rule-cap.mjs`) plus the residual-judgement advisory Claude Skill at `novel/spec-monitor/SKILL.md`
- ✅ Web dashboard with Lighthouse Mobile ≥0.85 CI gate (`@minsky/dashboard-web`, `.github/workflows/lighthouse.yml`); `GET /watch.json` data surface + `POST /control` pause/resume control endpoint
- ✅ Apple Shortcuts watch surface (`distribution/shortcuts/` — JSON manifests + on-device build runbook; pause/resume pair; host parameterized via Ask-Each-Time + Variable)
- ✅ Rule #9 automation layer — per-PR experiment runner (`scripts/run-experiment.mjs` + `.github/workflows/experiment.yml`), weekly–monthly tracker (`@minsky/experiment-record` + `.github/workflows/experiment-tracker.yml`), and the experiment-record format
- ✅ Read-only OMC → tasks.md bridge (`@minsky/omc-tasksmd-bridge` v0)
- ✅ Iron rule #9 (pre-registered hypothesis-driven development) + rule #10 (deterministic CI enforcement) wired across `vision.md` / `AGENTS.md` / `TASKS.md` policy

The 24/7-autonomy P0 path is end-to-end shippable: real-spawn daemon + real budget-guard gating + persona spawner + observability backend + Watch data surface + Watch control surface + push notifier + first user-story integration test driving the real daemon. What's still in flight — see [`TASKS.md`](./TASKS.md): the bidirectional OMC ↔ tasks.md watcher (`omc-tasksmd-bridge-v1-watcher`) and the next quarterly MAPE-K calibration cycle (`review-q3-2026`).

## Quickstart

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
./setup.sh
```

`./setup.sh` is idempotent and ends with a GREEN / YELLOW / RED self-test. Re-run any time. `./setup.sh --doctor` runs self-tests only; `./setup.sh --reset` rebuilds from scratch.

To start Minsky **on this repo** (Minsky-on-itself; rule #12 / `user-stories/001-loop-runs-overnight.md`):

```bash
pnpm dogfood          # one-command supervisor start (renders + loads launchd / systemd units)
pnpm dogfood:doctor   # read-only health probe
```

Then in [Claude Code](https://docs.claude.com/en/docs/claude-code) from this directory:

```text
/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
/plugin install oh-my-claudecode
/plugin install ralph-wiggum
/next-task
```

`/next-task` is queue mode by default — it picks the highest-priority unblocked task from [`TASKS.md`](./TASKS.md), ships it as a PR, loops to the next, and stops only when the queue is empty across all `~/apps/*/TASKS.md` and the audit cascade is clean.

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

Stafford Beer's [Viable System Model](https://en.wikipedia.org/wiki/Viable_system_model) (Beer, *Brain of the Firm*, 1972). Lower layers are existing tools (OMC, tasks.md, OTEL, systemd / launchd). Upper layers are the small custom packages, each extracted as `@minsky/*` on npm from day one.

[`ARCHITECTURE.md`](./ARCHITECTURE.md) has the full wiring, the adapter pattern, the dependency table, and the supervision tree.

## Read first

| File | Purpose |
| --- | --- |
| [`vision.md`](./vision.md) | Constitution: ten non-negotiable rules, glossary, pattern-conformance index, success criteria |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | All dependencies wired through interfaces; data flow; supervision tree |
| [`AGENTS.md`](./AGENTS.md) | How any agent (Claude Code, OMC, future tools) should behave when working in this repo |
| [`TASKS.md`](./TASKS.md) | Current work queue ([tasks.md](https://github.com/tasksmd/tasks.md) spec); every task carries Hypothesis / Success / Pivot / Measurement / Anchor per rule #9 |
| [`research.md`](./research.md) | Living dependency scan; replacement candidates |
| [`competitors/`](./competitors/) | Gap analysis vs OMC, CrewAI, MetaGPT, Microsoft Agent Framework, Composio AO |
| [`user-stories/`](./user-stories/) | One file per story; metric, integration test, proof, failure modes |

Two governance disciplines are load-bearing: every Minsky-coined term resolves to a published source via the [Glossary](./vision.md#glossary--every-term-has-a-cs-anchor) (rule #5), and every artifact maps to a published pattern via the [Pattern conformance index](./vision.md#pattern-conformance-index) (rule #8). Both are enforced by deterministic CI lints per [rule #10](./vision.md#10-deterministic-enforcement--every-rule-is-a-ci-lint-not-a-hope) (in flight).

## The namesake

Marvin Minsky (1927–2016) was a co-founder of MIT's AI Lab and one of the field's foundational figures. *The Society of Mind* (1986) argues that what we experience as a single intelligence is actually a collection of many simple "agents" with limited individual capability, organised into societies that produce coherent behaviour. Minsky's later book *The Emotion Machine* (2006) extends the argument to include affect and self-reflection.

The connection to this project is intentional: a useful AI coding stack is many small specialists (the OMC personas, the MCP tools, the supervisor, the budget guard, the spec monitor) cooperating under a shared discipline — not one monolithic super-agent. The discipline is the constitution in [`vision.md`](./vision.md).

Further reading on Marvin Minsky:

- [Marvin Minsky on Wikipedia](https://en.wikipedia.org/wiki/Marvin_Minsky)
- [*The Society of Mind* (1986)](https://en.wikipedia.org/wiki/Society_of_Mind) — the idea this project is named after
- [*The Emotion Machine* (2006)](https://en.wikipedia.org/wiki/The_Emotion_Machine) — extends the argument
- [MIT Memoir on Marvin Minsky](https://news.mit.edu/2016/marvin-minsky-obituary-0125)

## Tech defaults

- **Node.js + TypeScript** for everything in `novel/` (publishes to npm under `@minsky/*`)
- **pnpm** workspaces · **Biome** lint + format · **Vitest** with 90 % line / 85 % branch coverage gate · **lefthook** for pre-commit
- **Strictest TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- **OpenTelemetry** everywhere — every novel package emits at least one span per public method (rule #4)
- **systemd / launchd** for process supervision; let-it-crash discipline (Armstrong 2007)
- **MIT** throughout; every novel layer extracted as its own MIT repo from day one

[vision.md § Theoretical foundations](./vision.md#theoretical-foundations) lists the literature each choice is grounded in.

## Contributing

This repo is open-source MIT, but the contribution model is *strict by design*. Every change goes through the [iron-rule discipline of rule #9](./vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes): you declare a hypothesis, a measurement command, success and pivot thresholds, and a literature anchor *before* you write the code. If that sounds heavy, it is — by design. The repo is for long-tail, measurable improvement of a system that runs for years; not for one-off fixes.

If you want to contribute and that fits, the entry path is `/next-task` against [`TASKS.md`](./TASKS.md). Open issues for discussion before substantive work.

## License

MIT. See [LICENSE](./LICENSE).
