# Architecture

> How Minsky's pieces fit together — entry points, the layered model, the adapter pattern, and the dependency table that closes rule #2.

## What this file is

The canonical wiring diagram for Minsky. It maps named code to named patterns (rule #8), names the entry points an agent or operator should read first, and lists every external dependency behind an interface (rule #2). Every choice here is downstream of `vision.md`; if you find a conflict between this file and the constitution, the constitution wins and this file is wrong.

**Current milestone**: M1 (Stable, Measurable, One-Command) — see [`MILESTONES.md`](./MILESTONES.md) for the roadmap and per-milestone capability tables. Architecture decisions in this document serve M1 first; M2+ features are noted as future.

The `## The dependency table` section below is **load-bearing** — it is parsed structurally by [`scripts/check-rule-2-dep-coverage.mjs`](./scripts/check-rule-2-dep-coverage.mjs) on every PR. Do not rename the section, change the column order, or remove the header row.

## What this file is not

- **Not the constitution** — see [vision.md](./vision.md) for the 17 non-negotiable rules.
- **Not a tutorial or quickstart** — see [README.md](./README.md) and [INSTALL.md](./INSTALL.md).
- **Not the agent runbook** — see [AGENTS.md](./AGENTS.md) for how to work in the repo.
- **Not the research log** — see [research.md](./research.md) for open exploration and tool evaluations.

## Entry points (read this first)

The user-visible surface is a one-line bash shim that delegates to the cross-repo runner:

- [`bin/minsky`](./bin/minsky) — the PATH-accessible CLI shim (`./bin/minsky`, `pnpm minsky`, or `minsky` once on PATH). Dispatches subcommands.
- [`novel/cross-repo-runner/`](./novel/cross-repo-runner/) — the task-walker that picks the next task, spawns an agent, captures the iteration, opens a draft PR. Bin entry: [`novel/cross-repo-runner/bin/minsky-run.mjs`](./novel/cross-repo-runner/bin/minsky-run.mjs).
- [`distribution/launchd/`](./distribution/launchd/) and [`distribution/systemd/`](./distribution/systemd/) — outer-supervisor units that restart the daemon on crash, re-claim work, and survive reboots (rule-#6 let-it-crash substrate).

The agent layer is pluggable per the adapter pattern below. Today: `claude` (Claude Code), `devin` (Devin CLI), `aider` (local with Ollama). Selected via `~/.minsky/config.json` or `MINSKY_CLOUD_AGENT` env. Historical note: the original v0 architecture (below) referenced OMC as the orchestrator and an `omc-tasksmd-bridge`; the v0.1 line replaced both with direct agent spawning + the cross-repo runner's task picker. Sections that mention OMC are retained as historical context — the current substrate is the cross-repo runner.

## Layered model

> **Pattern:** Viable System Model (Beer, *Brain of the Firm*, 1972). Conformance: full. See `vision.md` § "Pattern conformance index" row 2.

The vertical structure follows Stafford Beer's Viable System Model. Each layer operates at a different timescale and answers a different question.

```text
┌──────────────────────────────────────────────────────────────────┐
│ IDENTITY  — who we are, slowest changing (constitutional)         │
│   vision.md, principles.md (later: ethics.md)                     │
├──────────────────────────────────────────────────────────────────┤
│ INTELLIGENCE  — outside world & future                            │
│   research.md, competitors/, user-stories/                        │
├──────────────────────────────────────────────────────────────────┤
│ CONTROL  — present management, the MAPE-K loop                    │
│   mape-k-loop, error-budgets, constraint log, A/B optimizer       │
├──────────────────────────────────────────────────────────────────┤
│ COORDINATION  — anti-oscillation between operators                │
│   tasks.md (queue), handoffs/ (blackboard), claim protocol        │
├──────────────────────────────────────────────────────────────────┤
│ OPERATIONS  — the actual doing                                    │
│   OMC personas, MCP tools, hooks                                  │
├──────────────────────────────────────────────────────────────────┤
│ NERVOUS SYSTEM  — cross-cutting observability                     │
│   OTEL traces/metrics/logs, dashboards (CLI/web/Watch)            │
└──────────────────────────────────────────────────────────────────┘
```

The three lower layers (Coordination, Operations, Nervous System) are mostly other people's tools. The three upper layers (Identity, Intelligence, Control) are mostly Minsky's novel work.

## The adapter pattern (the most important section)

> **Pattern:** Adapter (structural) + Strategy (behavioral) per Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994. Conformance: full. See `vision.md` § "Pattern conformance index" row 3.

**Every external dependency is accessed through an interface defined in `novel/adapters/`.** Business logic never imports a vendor library directly. This is what makes "don't reinvent the wheel" tractable over a decade — without interfaces, "use someone else's tool" calcifies into vendor lock-in.

Pattern:

```text
novel/adapters/
  task-queue.ts             ← interface TaskQueue { next(), claim(id), complete(id), … }
  task-queue.tasksmd.ts     ← implements via tasks-mcp

  orchestrator.ts           ← interface Orchestrator { runTask(spec, mode), modes, … }
  orchestrator.omc.ts       ← implements via OMC slash commands

  token-monitor.ts          ← interface TokenMonitor { remaining(), willExceedBy(t), … }
  token-monitor.maciek.ts   ← implements via Claude-Code-Usage-Monitor cache

  notifier.ts               ← interface Notifier { push(event, level), … }
  notifier.ntfy.ts          ← implements via ntfy.sh HTTP API

  remote-access.ts          ← interface RemoteAccess { … }
  remote-access.tailscale.ts← implements via Tailscale CLI

  observability.ts          ← interface Observability { trace(), metric(), log(), query() }
  observability.otel.ts     ← implements via Claude Code's OTEL exporter

  prompt-optimizer.ts       ← interface PromptOptimizer { runABTest(variants, metric), … }
  prompt-optimizer.dspy.ts  ← implements via DSPy

  supervisor.ts             ← interface Supervisor { start(unit), restart(unit), status(unit) }
  supervisor.systemd.ts     ← implements via systemctl
  supervisor.launchd.ts     ← implements via launchctl
```

Replacing OMC with a hypothetical "Claude Code Agent Teams" upgrade: write `orchestrator.cc-agent-teams.ts`, switch the import, run integration tests. Done.

Replacing Tailscale with WireGuard direct: write `remote-access.wireguard.ts`. Done.

Adapters are tested both **against the interface** (does the implementation satisfy the contract?) and **against the real tool** (does the real tool's behavior match what the adapter promises?). This catches upstream behavior changes early.

## The dependency table

| # | Layer | Interface | Current implementation | Replacement candidates | Risk |
|---|-------|-----------|------------------------|------------------------|------|
| 1 | Persona orchestration | `Orchestrator` | OMC v4.13.x | claude-flow, MS Agent Framework, custom | Low — OMC active, large community |
| 2 | Inner loop primitive | `InnerLoop` | OMC Ralph mode + Anthropic ralph-wiggum plugin | frankbria/ralph-claude-code | Low — multiple implementations exist |
| 3 | Task queue | `TaskQueue` | tasks.md + tasks-mcp (yours) | beads, taskmd-driangle | Self-owned, no risk |
| 4 | Cross-repo Roam | `RoamCoordinator` | tasks.md `/next-task` Roam step | (novel to tasks.md) | Self-owned |
| 5 | Token monitor | `TokenMonitor` | Claude-Code-Usage-Monitor (Maciek-roboblog) | Gronsten/claude-usage-monitor, custom | Low — multiple OSS options |
| 6 | TUI dashboard | `LocalDashboard` | claude-dashboard (seunggabi) | claude-tmux-dashboard, custom | Low |
| 7 | Mobile dashboard | `MobileDashboard` | claude-code-monitor (onikan27) | custom cross-platform web app | Medium — onikan27 is macOS only |
| 8 | Remote VPN | `RemoteAccess` | Tailscale | WireGuard, ZeroTier, Cloudflare Tunnel | Low |
| 9 | Push notifications | `Notifier` | ntfy.sh | Pushover, Telegram bot | Low |
| 10 | Watch actions | `WatchActions` | Apple Shortcuts | (later: native WatchOS / Wear OS) | Medium — Apple-specific |
| 11 | Process supervision | `Supervisor` | systemd (Linux) / launchd (macOS) | s6, runit, supervisord | Low |
| 12 | Observability | `Observability` | Claude Code OTEL → local Loki/Tempo/Grafana | Honeycomb, Grafana Cloud | Low |
| 13 | Prompt optimization | `PromptOptimizer` | DSPy (Stanford) + Promptfoo | OpenAI Evals, custom | Medium — DSPy still evolving |
| 14 | Specification monitor | `SpecMonitor` | **Custom Claude Skill** (novel; extract as OSS) | (none yet — we may be first) | High — wholly ours |

## The novel layers (what's actually ours)

Five small packages. Each MIT, each its own GitHub repo, each with a clean interface so other people's stacks can use them too. The integration into Minsky depends only on the published interfaces; we are our own first downstream consumer.

### `claude-budget-guard`

Token-budget watchdog. Reads from the `TokenMonitor` adapter, exposes "remaining minutes / tokens / cost / weekly headroom" via:

- A flag file (`/var/run/minsky/budget.flag`) for shell scripts
- A JSON API (`http://localhost:9876/budget`) for the dashboard and supervisor

Other tools (the supervisor, the Watch query) read these to decide whether to start a new tick. Independent of OMC, tasks.md, anything.

**Extracted from day one.** Useful to anyone running Claude Code on a budget.

### `claude-handoff-spec`

A small spec, modeled after AGENTS.md and tasks.md, for structured persona-to-persona handoffs. Defines the format of a handoff record:

- Status (ok | blocked | needs-rework)
- Summary
- Artifacts produced
- Blockers (if any)
- Suggested next personas
- Pushback (if applicable)

Reference parser. Validator. Could be adopted by OMC, claude-flow, MetaGPT, or any multi-agent system. **A community-effort play to make handoff format the way tasks.md is becoming the way for queues.**

### `claude-spec-monitor` (advisory-only Skill)

The runtime-specification-monitoring layer is split per rule #10 (vision.md § 10). The *load-bearing* share lives in the deterministic CI linters at `scripts/check-rule-{1..7}-*.mjs`, `scripts/check-pattern-index.mjs`, and `scripts/check-pr-self-grade.mjs` — each a required status check, each runnable locally, no LLM in the verdict chain. The *residual judgement* share — concerns that genuinely resist mechanisation (hypothesis vagueness, pivot=success collisions, non-primary anchors, measurement-output unchecked, conformance-level mismatch) — lives in `novel/spec-monitor/` as an advisory-only Claude Skill (vision.md row 35), capped at ≤5 advisory rules, never gating CI. Adding a deterministic linter retires the matching Skill check (rule-#10 ratchet).

### `claude-mape-k-loop`

The autonomic manager (Kephart & Chess 2003): the meta-supervisor implementing the MAPE-K reference architecture (Monitor → Analyze → Plan → Execute over Knowledge). Periodically (configurable: every Nth scheduler iteration, every 6h, on-demand, or when budget below threshold) it:

1. **Monitor**: observes via the `Observability` adapter
2. **Analyze**: reads the deterministic-linter status (rule-#10 lint set: `scripts/check-rule-{1..7}-*.mjs` + `scripts/check-pattern-index.mjs` + `scripts/check-pr-self-grade.mjs`) and the advisory output of the `novel/spec-monitor/` Skill (advisory-only — never gates), then identifies the top constraint via Theory-of-Constraints discipline
3. **Plan**: if a persona prompt is implicated, proposes variants
4. **Execute**: runs an A/B test via `PromptOptimizer` adapter and rolls out the winner
5. **Knowledge**: logs the change to `constraints.md`; commits

The whole thing is itself a Claude Code subagent, so it inherits supervision. Recursive supervision tree.

### `omc-tasksmd-bridge`

Bidirectional sync between tasks.md (canonical) and OMC's internal task list. Translates priorities, claims, completions. Goes away when OMC adopts tasks.md upstream — **the success metric for this package is "this package becomes unnecessary."** We file the OMC issue proposing native tasks.md support on day one.

## Data flow per tick

```text
                ┌─────────────────────┐
                │ supervisor wakes    │  (cron or signal, every N min)
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │ budget-guard check  │
                └──────────┬──────────┘
              budget OK    │   below threshold
                  ┌────────┴────────┐
                  │                 │
                  ▼                 ▼
        ┌────────────────┐    ┌──────────────┐
        │ continue tick  │    │ sleep, notify│
        └────────┬───────┘    └──────────────┘
                 │
        ┌────────▼─────────────┐
        │ spec-monitor         │  (advisory Skill — never gates; deterministic share runs in CI per rule #10)
        └────────┬─────────────┘
                 │
        ┌────────▼─────────────┐
        │ tasks.md /next-task  │  (your own /next-task command)
        └────────┬─────────────┘
                 │  (claimed task, with Tags + Acceptance)
        ┌────────▼─────────────┐
        │ omc-tasksmd-bridge   │  (translate to OMC invocation, choose mode)
        └────────┬─────────────┘
                 │
        ┌────────▼─────────────┐
        │ OMC runs the task    │  (autopilot | team | ralph)
        │  - personas hand off │
        │  - OTEL captured     │
        └────────┬─────────────┘
                 │
        ┌────────▼─────────────┐
        │ task completes       │  (commit, push, tasks.md cleared)
        └────────┬─────────────┘
                 │
        ┌────────▼─────────────┐
        │ mape-k reads spans   │  (updates constraint log; maybe A/B)
        └────────┬─────────────┘
                 │
        ┌────────▼─────────────┐
        │ notifier (if level)  │  (ntfy → iPhone/Watch)
        └────────┬─────────────┘
                 │
                 └──── loop ───────────────────────────────► (back to start)
```

## Process supervision tree

> **Pattern:** OTP supervision behaviour (Armstrong, *Programming Erlang*, 2007). Conformance: partial — restart strategies match; supervisor primitive is systemd / launchd, not BEAM. See `vision.md` § "Pattern conformance index" row 4 for the deviation rationale.

Inspired by Erlang/OTP supervision. Every long-running process has a supervisor; if it dies, it restarts according to a policy. State is on disk so nothing is lost.

```text
systemd (Linux) or launchd (macOS)
└── minsky-supervisor                        (Restart=always)
    ├── budget-guard                         (Restart=always — must outlive tick failures)
    ├── tick-loop                            (Restart=on-failure with backoff)
    │   └── claude -p (per tick, ephemeral)  (no restart; supervisor relaunches loop)
    ├── mape-k-loop                          (cron-triggered, less frequent)
    ├── dashboard-web                        (Restart=always — UI must be reachable)
    └── notifier-relay                       (Restart=always)
```

Restart policies:

- `budget-guard` and `dashboard-web` use `one-for-one` — if they crash, only they restart
- `tick-loop` uses backoff (5s → 30s → 5min) to avoid hammering on systematic failures
- `mape-k-loop` is fire-and-forget per invocation; cron handles the watchdog schedule

**MAPE-K cadence (the schedule cron drives `mape-k-loop` on):** a three-priority hybrid — event-triggered overrides > time-based watchdog > tick-iteration backstop. The supervisor wakes `mape-k-loop` via `SIGUSR1` on event triggers (any rule-#10 deterministic linter going red on `main`, `budget-guard` at 85 %); cron fires the time-based watchdog every 12 h regardless; a tick-iteration backstop forces a pass every 1000 ticks. The full rationale, rejected alternatives (pure time-based, pure scheduler-iteration-based, pure event-triggered), token-cost estimate (≤ 5.7 % of weekly Max5 budget — itself adaptive per `mape-k-loop`'s monthly self-calibration), and literature anchors (Liu 2000, Kephart & Chess 2003, Astrom & Wittenmark 1997, Beyer SRE 2016) live in `research.md` § "MAPE-K cadence". Numeric thresholds are configurable via `config/mape-k.json`; they are not constants in code, matching the same adaptive-threshold discipline used by `budget-guard` (above, `## Token economy`).

## Observability

OpenTelemetry throughout. Claude Code natively emits OTEL and propagates `TRACEPARENT` to subprocesses, so every tool call by every persona nests under the tick that spawned it. End-to-end distributed tracing, free.

Local stack:

- **OpenObserve** as the single-binary backend for logs, traces, and metrics — primary recommendation per `research.md` § "Lighter OTEL backend" (resolved 2026-05-03). Smallest disk footprint, simplest install, satisfies all three query-shape constraints.
- **Runner-up**: VictoriaMetrics + VictoriaLogs + VictoriaTraces triad — the first port of call if a pivot away from OpenObserve fires.
- **Previously recommended** (kept for historical context until `observability-adapter-v0` ships against OpenObserve): Loki+Tempo+Prometheus+Grafana.

Three dashboard tiers, each reading from the same OTEL backend through the `Observability` adapter:

1. **CLI (claude-dashboard)** — for the developer at the terminal. k9s-style, shows all sessions, attach/detach.
2. **Web (custom, ~300 lines, mobile-friendly)** — reachable via Tailscale. Shows the 10 success metrics from `vision.md`, current task, recent handoffs, constraint of the week.
3. **Watch (Apple Shortcuts → ntfy → glance widget)** — three numbers only:
   - Tokens remaining in the current 5-hour window (color: green > 50%, yellow > 20%, red < 20%)
   - Last task status (✓ or ✗ or ⏳)
   - This week's constraint (one-word label)

The Watch shows the smallest set of facts that answer "is the organism still alive and on track?". If the answer requires more than one glance, the design is wrong.

## Token economy

Tier scope: **Claude Code Max5**. The exact budgets in tokens, requests / minute, and weekly cap are not published by Anthropic for this tier and change over time, so Minsky never hardcodes them. Instead, the system **observes** the current budget through the `TokenMonitor` adapter and reacts at *relative* thresholds. This keeps `claude-budget-guard` correct as Anthropic's numbers shift, and as the user upgrades or downgrades tiers.

Hard constraints (observed at runtime; placeholders until verified):

- 5h rolling window size: `<TBD: verify against anthropic.com/pricing>`
- Weekly cap (introduced August 2025; tier- and version-dependent): `<TBD: verify against anthropic.com/pricing>`
- Shared bucket with `claude.ai` usage on the same account: yes
- Behavior on cap hit: HTTP 429 from the API, surfaced by the `Orchestrator` adapter

Adaptive homeostasis (lives in `claude-budget-guard`; thresholds are *relative*, never absolute):

- **Below 70%** of the observed 5h window: normal cadence; full model routing per `Orchestrator` rules.
- **At 70%** of the 5h window: low-effort personas switch from Sonnet to Haiku (`graceful-degrade` per constitutional rule #7); OTEL span tagged `degraded=true`.
- **At 85%** of the 5h window: pause new tick claims; let in-flight ticks finish (`circuit-break-and-notify` per rule #7); fire a single notification at level=warn.
- **At weekly-cap warning** (Maciek's `TokenMonitor` surfaces this from its ML-based predictor): extend sleep cycles between ticks; favor Haiku.
- **After window reset** (TokenMonitor reports remaining > 50% again): resume normal cadence; clear the `degraded=true` tag; emit OTEL counter `budget_guard.resume`.

The numeric thresholds (70%, 85%) are configurable via `config/budget-guard.json`; they are not constants in code. The "observed peak" comes from the rolling max of `TokenMonitor.peakObserved()` over the last 30 days, recomputed at every reset.

Sustainable rate target:

- **≈30% of observed 5h-window peak per 5h window**, sustained. Rationale (Google SRE error-budget discipline, Beyer et al. 2016): leave 70% headroom for (a) human use of `claude.ai` on the same bucket, (b) unanticipated spikes from rule-#7 chaos tests, (c) recovery work after a `loud-crash-supervisor-restart`, and (d) the autonomic manager's MAPE-K cycles which themselves consume tokens. The 30% figure is itself adaptive: the `mape-k-loop` adjusts it monthly based on observed weekly-cap distance and the sustained-rate trend in `vision.md` § Success criteria #2 (tokens-per-closed-user-story).

Token-saving rules baked into adapters:

- `Orchestrator`: plan with Opus, execute with Sonnet (`/model opusplan` pattern); Haiku for high-volume scripted runs and post-70% degraded mode.
- `Orchestrator`: protect the prompt-cache prefix — don't add MCP servers or change models mid-session.
- `Observability`: hooks for deterministic checks (zero LLM-context cost), not prompts.

Failure modes & chaos verification: see `claude-budget-guard`'s README failure-modes section per constitutional rule #7, and `user-stories/004-budget-auto-pause.md` for the per-story failure table.

## Bootstrap (`./install.sh`)

The single command from zero to running. Idempotent. Re-runnable. Fails loud and early.

Steps:

1. Verify prerequisites: Claude Code CLI, brew (macOS) or apt (Linux), npm, tmux, systemd or launchd, gh
2. Install dependencies:
   - `brew install` / `apt install` for system tools (Tailscale, jq, etc.)
   - `npm install -g` for `@tasks-md/cli`, `tasks-mcp`
   - `pip install claude-monitor==3.1.0` (Python tool, pinned per `research.md` § "Token monitor")
   - `claude plugin install oh-my-claudecode@v4.13.x` (pinned)
   - `claude plugin install ralph-wiggum`
3. Configure:
   - Tailscale auth (`tailscale up`)
   - ntfy topic creation
   - OTEL endpoints (env vars in service files)
   - MCP server registration in OMC
4. Render systemd/launchd unit files from templates with the user's paths
5. Initialize `tasks.md` if absent; install `/next-task` for Claude Code
6. Run smoke tests against each adapter (each adapter has a `selfTest()` method)
7. Print:
   - Local dashboard URL
   - Tailscale-reachable URL
   - ntfy topic name (for Apple Shortcut configuration)
   - Status: GREEN / YELLOW / RED with explanation

## Versioning & dependency evolution

Pin major versions of all dependencies. Test integration on every dep update. The bridges layer (especially `omc-tasksmd-bridge`) absorbs breaking changes upstream so business logic doesn't see them.

Currently pinned (index — pins live in `package.json` / `.github/workflows/*.yml`; this list is the *index*, not a duplicate state):

- `@tasks-md/lint@^0.7.0` — `.github/workflows/ci.yml:39` (per PR #44)
- `markdownlint-cli2@0.15.0` — `.github/workflows/ci.yml:27` + `package.json:29` (per PR #44)
- `lighthouse@12.4.0` — `.github/workflows/lighthouse.yml:108` (per PR #66)
- `@anthropic-ai/sdk@^0.92.0` — `novel/adapters/prompt-optimizer/package.json` (per PR #55)
- `@opentelemetry/core@^1.30.0` — `novel/adapters/observability/package.json` (per PR #62)
- `@biomejs/biome@1.9.4`, `typescript@5.7.2`, `vitest@2.1.9`, `lefthook@1.10.10`, `@vitest/coverage-v8@2.1.9`, `@types/node@25.6.0` — `package.json` devDependencies
- `pnpm@9.12.0` — `packageManager` field, `package.json`

Quarterly review (recorded in `research.md`):

- For each dep: is there a better replacement now?
- For each novel layer: is there an upstream tool that subsumes it?
- For each adapter: is the interface still a good shape, or has the domain evolved?

Replacement procedure:

1. Add new adapter implementation alongside old (e.g., `orchestrator.NEW.ts`)
2. Switch the import in `config/adapters.json`
3. Run integration tests
4. If pass: delete old adapter; update `research.md` noting the swap, the rationale, and the date

## Open questions to resolve before implementation

These don't block writing `vision.md` and `ARCHITECTURE.md`, but they do block writing code. They go into `TASKS.md` as P1 research tasks. *Items struck through have been resolved by subsequent PRs — kept here as historical anchors per `AGENTS.md` § "Documentation rules".*

1. ~~**OMC handoff persistence** — does OMC's "shared task list" persist to disk in a parseable format, or only in process memory? Determines the complexity of `omc-tasksmd-bridge`.~~ **Resolved**: PRs #75/#77 — parseable on-disk persistence confirmed; `scripts/omc-roundtrip.mjs` enforces round-trip; see `research.md` § "OMC handoff persistence".
2. ~~**Apple Watch surface** — does Shortcut + ntfy suffice, or do we eventually need a real WatchOS app? Defer; start with Shortcuts and measure dwell time (success metric #6).~~ **Resolved**: PR #54 — native WatchOS app evaluated, deferred behind 90 s/day wrist-dwell trigger sustained 14 d; see `research.md` § "Native WatchOS app".
3. ~~**MAPE-K loop cadence** — every Nth scheduler iteration? Time-based (every 6h)? Event-triggered (when error budget below X)? Probably all three with priority. Test in production.~~ **Resolved**: PRs #59 + #70 — cadence-lint quartet (5.7% token-budget cap, tick-loop backoff, MAPE-K backstop/watchdog, cadence-pivot) enforces deterministic prose-anchored CI lints; see `ARCHITECTURE.md` § "MAPE-K cadence" + vision.md row 59.
4. ~~**Multi-machine** — initial scope is single-developer-machine. Multi-machine / team scope deferred to v1+.~~ **Resolved**: PR #45 — multi-machine scope deltas documented; see `research.md` § "Multi-machine scope".
5. **OMC version pinning strategy** — strict patch pin (v4.13.4 exactly) vs minor-floating (v4.13.x)? Recommend minor-floating with integration test gate, but verify their semver discipline first.
6. **OTEL backend choice** — *Resolved 2026-05-03* (see `research.md` § "Lighter OTEL backend"): OpenObserve for v0 (single binary, smallest disk footprint, satisfies all three query-shape constraints); VictoriaMetrics triad as runner-up. The previously-considered Loki/Tempo/Prometheus/Grafana stack is heavier than necessary for a single-dev setup.

## Competitive layer-by-layer

What Minsky has at each layer vs the orchestrator-tier competitors (CrewAI, AutoGen, LangGraph, MetaGPT, OpenAI Agents SDK). Use this table to see the moat shape architecturally — where Minsky is the only system with the property AND where competitors have something Minsky doesn't.

Symbol legend: ✅ has it, today; 🟡 partial / framework-level; ❌ doesn't have it; ⚪ rejected by design.

| Layer | Minsky | CrewAI | AutoGen | LangGraph | MetaGPT | OpenAI Agents SDK |
|---|---|---|---|---|---|---|
| **Daemon (operator attaches and walks away)** | ✅ launchd / systemd supervisor | ❌ framework (Python lib) | ❌ framework (Python lib) | ❌ framework (Python lib) | ❌ framework (Python lib) | ❌ framework (Python lib) |
| **Operator-machine identity (~/.gitconfig, ~/.config/gh/, ~/.ssh)** | ✅ `spawn(agent, args, { cwd: hostDir })` | ❌ platform identity (CrewAI Enterprise) | ❌ Python container identity | ❌ Python container identity | ❌ Python container identity | ❌ OpenAI account identity |
| **State persistence with checkpointing** | 🟡 `.minsky/orchestrate.jsonl` (iteration-level, not graph-level) | ✅ `@persist` + JsonProvider / SqliteProvider | 🟡 GroupChat memory; no first-class persistence | ✅ Postgres / Sqlite / InMemory savers + thread_id | ❌ stateless per task | ✅ sessions + tracing |
| **Multi-role / persona pipeline** | ✅ delegated to OpenHands' native MicroAgents + DelegateTool + TaskToolSet + AgentDefinition (per the Path C reshape — Minsky's `persona-spawner` adapter was deleted 2026-05-24) | ✅ Crew = roles | ✅ AssistantAgent / UserProxyAgent / GroupChat | ✅ graph nodes | ✅ Standardised Operating Procedure (PM / Architect / Engineer / QA) | ✅ handoffs |
| **MAPE-K self-improvement loop** | ✅ `novel/mape-k-loop/` mines iteration ledger | ❌ static once shipped | ❌ static once shipped | ❌ static once shipped | ❌ static once shipped | ❌ static once shipped |
| **Constitution + deterministic CI enforcement** | ✅ 17 rules + 53 pre-pr-lint stages + 65 CI jobs | ❌ no per-rule CI gate | ❌ no per-rule CI gate | ❌ no per-rule CI gate | ❌ no per-rule CI gate | 🟡 guardrails primitive (per-agent) |
| **Cross-repo fleet (walk N hosts)** | ✅ `--hosts-dir <parent>` + round-robin | ❌ one Flow at a time | ❌ one team at a time | ❌ one graph at a time | ❌ one task at a time | ❌ one agent at a time |
| **TASKS.md as operator surface** | ✅ plain markdown queue | ❌ Python code defines tasks | ❌ Python code defines agents | ❌ Python code defines graph | ❌ Python code defines roles | ❌ Python / TS code defines agents |
| **Pre-registered hypothesis-driven development (rule #9)** | ✅ Hypothesis/Success/Pivot/Measurement/Anchor on every task | ❌ no equivalent | ❌ no equivalent | ❌ no equivalent | ❌ no equivalent | ❌ no equivalent |
| **Headline benchmark (HumanEval / SWE-bench / GAIA)** | ❌ no number yet | ❌ no benchmark (adoption metrics only) | 🟡 GAIA SOTA March 2024 (no headline %) | ❌ third-party benchmarks only | ✅ HumanEval 0.859, MBPP 0.877 | ❌ no benchmark yet |
| **Enterprise distribution (Fortune 500-scale)** | ❌ ~1 deployment | ✅ 60% Fortune 500 | 🟡 Microsoft-internal | 🟡 LangChain community | ❌ research-grade | 🟡 OpenAI ecosystem |
| **Multi-agent ensembling within ONE task** | ❌ one agent per task | 🟡 Crew = multi-agent | ✅ GroupChat | ✅ graph nodes | ✅ assembly line | ✅ handoffs |
| **Graph-based time-travel debugging** | ⚪ rejected (linear iteration ledger is the moat) | 🟡 checkpoint replay | ❌ no equivalent | ✅ get_state_history + replay | ❌ no equivalent | 🟡 trace replay |
| **Python framework** | ⚪ rejected (TypeScript surface) | ✅ Python | ✅ Python | ✅ Python | ✅ Python | ✅ Python + TS |

The full moat analysis lives at [`competitors/README.md`](competitors/README.md). The four ❌ rows in the Minsky column above are filed as TASKS.md follow-ups:

- `benchmark-minsky-via-claude-on-humaneval` — close the headline-benchmark gap by running HumanEval on Minsky-via-Claude and publishing the score.
- `enterprise-deployment-readiness-audit` — close the distribution gap; M2-gated (M1's job is to make Minsky stable + measurable, not to chase enterprise sales).
- `explore-multi-agent-ensembling-experiment` — investigate whether the Augment Code pattern (Sonnet driver + o1 ensembler) lifts Minsky-via-Claude's HumanEval score; M2-gated.
- `gaia-benchmark-evaluation-substrate` — add `bin/minsky benchmark gaia` to compare to AutoGen's claimed GAIA SOTA.

The two ⚪ rows (graph-based time-travel + Python framework) are rejected by design — vision.md § "Honest gaps" explains the trade-offs.

## Reading next

- `MILESTONES.md` — product roadmap, per-milestone capability tables, what minsky will never do
- `vision.md` — the constitution this document serves; § "What Minsky uniquely does" enumerates the six moats
- `AGENTS.md` — how any agent should behave when working in this repo (includes rule #15: milestone alignment gate)
- `TASKS.md` — current work queue (137 open tasks; milestone-alignment-gate task is always first)
- `METRICS.md` — 10 canonical metrics (currently stubs — M1 wires real observations)
- `research.md` — living dependency scan
- `competitors/README.md` — strategic landscape + moat synthesis (read AFTER vision.md § "What Minsky uniquely does")
- `competitors/<id>.md` — per-vendor research files
- `user-stories/012-operator-machine-identity-moat.md` + `user-stories/013-daemon-not-framework-moat.md` — moats 1 and 2 as user stories
- `user-stories/` — one file per story with metric, integration test, proof
