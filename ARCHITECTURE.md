# Architecture

This document describes how Minsky's pieces fit together. Every choice here is downstream of `vision.md`; if you find a conflict between this file and the constitution, the constitution wins and this file is wrong.

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

### `claude-spec-monitor`

A Claude Skill implementing runtime specification monitoring (Havelund & Goldberg 2008): reads a behavioral-specification document (defaults to `vision.md`, pluggable via skill input) plus the most recent N actions / handoffs from any source, and produces a structured specification-drift report. Reusable in any Claude Code project.

### `claude-mape-k-loop`

The autonomic manager (Kephart & Chess 2003): the meta-supervisor implementing the MAPE-K reference architecture (Monitor → Analyze → Plan → Execute over Knowledge). Periodically (configurable: every Nth scheduler iteration, every 6h, on-demand, or when budget below threshold) it:

1. **Monitor**: observes via the `Observability` adapter
2. **Analyze**: runs `claude-spec-monitor` (the runtime specification monitor) and identifies the top constraint via Theory-of-Constraints discipline
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
        │ spec-monitor         │  (light every tick, deep every Nth)
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
- `mape-k-loop` is fire-and-forget per invocation; cron handles scheduling

## Observability

OpenTelemetry throughout. Claude Code natively emits OTEL and propagates `TRACEPARENT` to subprocesses, so every tool call by every persona nests under the tick that spawned it. End-to-end distributed tracing, free.

Local stack:

- **Loki** for logs
- **Tempo** for traces
- **Prometheus** for metrics
- **Grafana** as the dashboard surface

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
   - `npm install -g` for `@tasks-md/cli`, `tasks-mcp`, `claude-monitor`
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

These don't block writing `vision.md` and `ARCHITECTURE.md`, but they do block writing code. They go into `TASKS.md` as P1 research tasks.

1. **OMC handoff persistence** — does OMC's "shared task list" persist to disk in a parseable format, or only in process memory? Determines the complexity of `omc-tasksmd-bridge`.
2. **Apple Watch surface** — does Shortcut + ntfy suffice, or do we eventually need a real WatchOS app? Defer; start with Shortcuts and measure dwell time (success metric #6).
3. **MAPE-K loop cadence** — every Nth scheduler iteration? Time-based (every 6h)? Event-triggered (when error budget below X)? Probably all three with priority. Test in production.
4. **Multi-machine** — initial scope is single-developer-machine. Multi-machine / team scope deferred to v1+.
5. **OMC version pinning strategy** — strict patch pin (v4.13.4 exactly) vs minor-floating (v4.13.x)? Recommend minor-floating with integration test gate, but verify their semver discipline first.
6. **OTEL backend choice** — local Loki+Tempo+Prometheus+Grafana is heavier than necessary for a single-dev setup. Consider a lighter alternative (e.g., a single SQLite-backed exporter) for the default install, with the heavy stack as opt-in.

## Reading next

- `vision.md` — the constitution this document serves
- `AGENTS.md` (forthcoming) — how any agent should behave when working in this repo
- `TASKS.md` (forthcoming) — current work queue
- `research.md` (forthcoming) — living dependency scan
- `competitors/` (forthcoming) — gap analysis vs OMC, MetaGPT, AO, Intent, etc.
- `user-stories/` (forthcoming) — one file per story with metric, integration test, proof
