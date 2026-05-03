# Research

Living scan of the tools Minsky depends on, the tools we've considered, and the tools we should keep watching. Updated whenever a dependency changes, a new candidate appears, or we re-evaluate a choice.

This document operationalizes constitutional principle 1 — *don't reinvent the wheel*. **Quarterly: every entry is reviewed; choices are reconsidered; replacements are scanned.**

## Hypothesis-driven development tooling

Per constitutional rule #9 (`vision.md` § 9), every Minsky change is an experiment with an automated measurement and a *pre-declared pivot threshold*. Tools that enable this discipline:

- **Promptfoo** (already chosen, see `Orchestrator` row below) — declarative prompt-eval framework with statistical reporting; satisfies the LLM-output-grading layer.
- **DSPy** (already chosen, see `PromptOptimizer` row below) — Stanford's "programming-not-prompting" framework; metric-as-reward optimization for prompt A / B; satisfies persona-prompt optimization (rolled out by `mape-k-loop`).
- **OpenTelemetry** (already chosen, see `Observability` row below) — universal metric / trace / log substrate; every measurement command in `vision.md` § "Success criteria" is an OTEL query against this stack.
- **GrowthBook** (proposed — open-source, MIT) — feature-flagging + A / B testing platform, self-hostable. Satisfies the *system-level* experiment layer: gates new persona / adapter rollouts behind flags; runs Bayesian or frequentist analysis on system metrics; produces audit trails of which variant was active when.

### GrowthBook vs Statsig

| Dimension | GrowthBook | Statsig |
|---|---|---|
| Licence | MIT, self-hostable | Commercial (free tier ≤ 1 M events / mo) |
| Statistical engine | Bayesian + frequentist | Bayesian + sequential |
| Vendor lock-in risk | None (OSS) | High (proprietary cloud) |
| Solo-dev fit | Excellent — Docker compose, no cloud account | Acceptable — free tier covers solo use, but cloud-only |
| Constitutional fit (rule #1: don't reinvent the wheel; rule #2: every dep behind interface) | Full — fits the future `Experiment` adapter without lock-in | Partial — closed control plane breaks the data-plane-OSS-only preference (cf. Tailscale's exception) |

**Decision:** adopt **GrowthBook** for the v0 `Experiment` adapter. Revisit only if scale exceeds 10 M events / month (we don't expect to). Tracked in the dependency table under a forthcoming `Experiment` interface row.

### Operative literature

The five papers / books rule #9 cites are operative reading for anyone proposing a new metric or task spec.

- **Basili, Caldiera, Rombach — Goal-Question-Metric** (*Encyclopedia of Software Engineering* 1994). The canonical "goal → question → metric" formalisation. Every measurement-method cell in `vision.md` is a GQM-derived query.
- **Ries — *The Lean Startup*** (2011). Supplies the pivot-or-persevere semantics. Pivot threshold = "if metric is below X for window Y, the *approach* (not the patch) is abandoned".
- **Kohavi, Tang, Xu — *Trustworthy Online Controlled Experiments*** (Cambridge UP 2020). Mandatory before designing any A / B for system metrics; chapters 3, 5, 17 are the working subset.
- **Forsgren, Humble, Kim — *Accelerate*** (2018). DORA's four-key-metrics — deployment frequency, lead time, MTTR, change-fail rate — feed `vision.md` success criteria #5 (MTTR) and #10 (throughput).
- **Manzi — *Uncontrolled*** (2012). Calibrates the "we ran an A / B and it was significant" overclaim; the chapter on quasi-experimental causal inference is the one to internalise.
- **Doerr — *Measure What Matters*** (2018). Outcome-vs-activity discipline. The rule's anti-pattern (vanity metrics) is operationalised here.

## How to read this file

Each active dependency follows the same shape:

> **Layer — `Interface`**
>
> - **Current**: tool, version, since
> - **Gives us**: what we use it for
> - **Why we picked it**: rationale
> - **Replacement candidates**: alternatives, with status
> - **Risks**: concrete failure modes
> - **Adapter**: file path
> - **Last reviewed**: date

---

## Active dependencies

### Persona orchestration — `Orchestrator`

- **Current**: OMC (oh-my-claudecode) v4.13.x, since 2026-05
- **Gives us**: 32 specialist agents (architect, executor, qa-tester, code-reviewer, designer, security-reviewer, debugger, verifier, test-engineer, planner, etc.); 4 execution modes (autopilot, ultrawork, team, ralph); inter-agent messaging; Haiku/Sonnet/Opus smart routing claiming 30-50% token savings; architect verification gate
- **Why we picked it**: Most mature multi-agent orchestrator in the Claude Code ecosystem (31.3k stars), MIT, zero-config, plugin install. Adopting it cuts our scope by ~half.
- **Replacement candidates**: claude-flow (overlapping, less mature); Microsoft Agent Framework (wrong stack, .NET/Python); Anthropic's official Agent Teams (still evolving); custom (only if OMC's pace becomes unmanageable)
- **Risks**: Fast-moving (v4.13.x in early May 2026); roadmap may diverge from ours (they optimize for "ship features fast"; we optimize for "stay alive for years"); internal task list is OMC-specific, not tasks.md compatible (yet — see omc-tasksmd-bridge)
- **Adapter**: `novel/adapters/orchestrator.omc.ts` (forthcoming)
- **Last reviewed**: 2026-05-03

### Inner loop primitive — `InnerLoop`

- **Current**: OMC Ralph mode + Anthropic's official ralph-wiggum plugin
- **Gives us**: In-session relentlessness — the agent doesn't say "done" until verified
- **Why we picked it**: Ralph technique is the canonical pattern; Anthropic's official plugin formalizes it; OMC integrates the pattern into its team modes
- **Replacement candidates**: frankbria/ralph-claude-code (third-party, more safety rails: rate limiting, circuit breaker, 5h Max limit handling)
- **Risks**: Low — multiple implementations exist; pattern is well-documented
- **Adapter**: `novel/adapters/inner-loop.ts` (forthcoming)
- **Last reviewed**: 2026-05-03

### Task queue — `TaskQueue`

- **Current**: tasks.md spec + `@tasks-md/cli` + `tasks-mcp` (we own this)
- **Gives us**: Single-file P0–P3 priority queue, `/next-task` command across 6 agents, MCP server for programmatic access, linter, GitHub Action
- **Why we picked it**: We own it. Single-file design (vs directory-of-files like taskmd-driangle or Batty) optimizes for solo-dev workflow.
- **Replacement candidates**: beads, taskmd-driangle (different design choice; we deliberately diverge)
- **Risks**: None — self-owned
- **Adapter**: `novel/adapters/task-queue.tasksmd.ts` (forthcoming)
- **Last reviewed**: 2026-05-03

### Cross-repo Roam coordination — `RoamCoordinator`

- **Current**: tasks.md `/next-task` Roam step (scans `~/apps/*/TASKS.md` when current queue is empty)
- **Gives us**: Multi-repo task draining without orchestration overhead
- **Why we picked it**: Already implemented in tasks.md
- **Replacement candidates**: None — novel to tasks.md
- **Risks**: Self-owned; pace of change is ours
- **Last reviewed**: 2026-05-03

### Token monitor — `TokenMonitor`

- **Current**: Claude-Code-Usage-Monitor (Maciek-roboblog), Python tool
- **Gives us**: Real-time 5h-window and weekly token tracking with ML-based predictions, Max5/Max20 plan support, color thresholds, log export
- **Why we picked it**: Most feature-complete OSS option; actively maintained
- **Replacement candidates**: Gronsten/claude-usage-monitor (simpler); custom
- **Risks**: Python dep adds install complexity for JS-first users; verify cache file format is stable across versions
- **Adapter**: `novel/adapters/token-monitor.maciek.ts` (forthcoming)
- **Last reviewed**: 2026-05-03

### TUI dashboard — `LocalDashboard`

- **Current**: claude-dashboard (seunggabi)
- **Gives us**: k9s-style TUI listing all sessions with real-time status (CPU/memory/uptime), conversation log viewer (`l` key), attach/detach via tmux, vim navigation
- **Why we picked it**: Closest existing match for "all sessions in one place" CLI requirement
- **Replacement candidates**: ybouhjira/claude-tmux-dashboard (simpler); custom
- **Risks**: Less mature; alternative implementations exist with overlapping naming (schmoli/claude-dashboard) — pin source
- **Last reviewed**: 2026-05-03

### Mobile dashboard — `MobileDashboard`

- **Current**: claude-code-monitor (onikan27) for v0; **likely replaced by custom web app**
- **Gives us**: CLI + Mobile Web UI with QR-code access, terminal focus switching, Tailscale support, smartphone messaging
- **Why we picked it**: Closest existing tool to mobile/remote requirements
- **Replacement candidates**: Custom cross-platform web app (Hono + minimal UI, ~300 lines) is preferred long-term
- **Risks**: macOS-only (uses AppleScript); blocks Linux users from this dep
- **Last reviewed**: 2026-05-03
- **Decision pending**: Adopt onikan27 v0 vs build custom web app from start. Open task in TASKS.md.

### Remote VPN — `RemoteAccess`

- **Current**: Tailscale (free tier sufficient for solo use)
- **Gives us**: Secure mesh VPN; iPhone reaches Mac/Linux dashboard URL from anywhere; WireGuard underneath
- **Why we picked it**: Industry standard; free tier; zero-config; both onikan27 and many other tools support it natively
- **Replacement candidates**: WireGuard direct (more setup); ZeroTier (alternative mesh); Cloudflare Tunnel (no client needed but requires CF account)
- **Risks**: Closed-source control plane (data plane is OSS); free-tier limits
- **Last reviewed**: 2026-05-03

### Push notifications — `Notifier`

- **Current**: ntfy.sh (free tier, OSS, iOS app with Apple Watch propagation)
- **Gives us**: Pub/sub HTTP push to topics; iOS app surfaces to Apple Watch via standard iOS notifications
- **Why we picked it**: Simplest stack; HTTP-curl event firing; no auth complexity for solo use
- **Replacement candidates**: Pushover (paid, native Apple Watch app); Telegram bot (richer but heavier)
- **Risks**: Free tier rate limits if used aggressively; topic-based auth is weak (use random topic names)
- **Adapter**: `novel/adapters/notifier.ntfy.ts` (forthcoming)
- **Last reviewed**: 2026-05-03

### Watch actions — `WatchActions`

- **Current**: Apple Shortcuts (read-only glance widgets that hit local web app via Tailscale)
- **Gives us**: Three-number Watch surface (tokens-remaining, last-task-status, this-week's-constraint); one-tap pause action
- **Why we picked it**: Zero app development; Shortcuts already on every iOS device
- **Replacement candidates**: Native WatchOS app (deferred — more capability but high effort); Wear OS equivalent (deferred — non-Apple users)
- **Risks**: iOS-only; Apple deprecation risk for Shortcuts; complex actions hit Shortcut UI limits
- **Last reviewed**: 2026-05-03

### Process supervision — `Supervisor`

- **Current**: systemd (Linux) / launchd (macOS) — built into the OS
- **Gives us**: Restart policies, logging, dependency ordering, crash recovery
- **Why we picked it**: Already installed; Erlang/OTP-style supervision discipline maps cleanly; no extra runtime
- **Replacement candidates**: s6, runit, supervisord (extra runtimes, no benefit for solo use)
- **Risks**: Different unit-file syntax between systemd and launchd — bridge in adapter
- **Adapter**: `novel/adapters/supervisor.systemd.ts` and `supervisor.launchd.ts` (forthcoming)
- **Last reviewed**: 2026-05-03

### Observability — `Observability`

- **Current**: Claude Code's native OpenTelemetry exporter → local Loki/Tempo/Prometheus/Grafana
- **Gives us**: TRACEPARENT propagation through subagents; structured event log; metric series; dashboard surface
- **Why we picked it**: OTEL is the universal standard; Claude Code emits it natively; Grafana stack is OSS and battle-tested
- **Replacement candidates**: Honeycomb (paid, hosted, much easier); Grafana Cloud (paid free tier); SQLite-backed lightweight exporter (custom — open task to evaluate)
- **Risks**: Local stack is heavy for single-dev install (~4 services); install friction may push us to a lighter alternative
- **Adapter**: `novel/adapters/observability.otel.ts` (forthcoming)
- **Last reviewed**: 2026-05-03
- **Open question**: Lighter backend? See P2 task `otel-lite-backend`.

### Prompt optimization — `PromptOptimizer`

- **Current**: DSPy (Stanford) for the optimizer + Promptfoo for evaluation harness
- **Gives us**: Programmatic prompt A/B testing with metrics as reward; declarative optimizer pipelines
- **Why we picked it**: DSPy is the leading "programming-not-prompting" framework; Promptfoo is the OSS eval standard
- **Replacement candidates**: OpenAI Evals; custom (simple ring-buffer of variants with metric voting)
- **Risks**: DSPy still evolving; idiom may not perfectly fit Claude Code's prompt model — open question for first practical attempt
- **Adapter**: `novel/adapters/prompt-optimizer.dspy.ts` (forthcoming)
- **Last reviewed**: 2026-05-03

### Specification monitor — `SpecMonitor`

- **Current**: **Custom Claude Skill** — `novel/spec-monitor/SKILL.md` (forthcoming)
- **Gives us**: Runtime specification monitoring (Havelund & Goldberg, "Verify Your Runs", VSTTE 2008) — reads a behavioral-specification document plus recent N actions/handoffs; produces structured drift report
- **Why we built it**: No existing runtime tool monitors a project-level behavioral specification. Anthropic's Constitutional AI applies at *training* time; we want it at *runtime* against the project spec (`vision.md`).
- **Replacement candidates**: None known. Adjacent: existing runtime-verification tools (Java PathExplorer, RV-Monitor) target program traces, not LLM-agent behavior — different domain.
- **Risks**: Wholly novel — most likely place for our design to be wrong; needs iteration based on actual drift patterns observed
- **Last reviewed**: 2026-05-03
- **Extraction target**: Yes — published as `@minsky/spec-monitor` from day one
- **Glossary**: see [vision.md § Glossary](./vision.md#glossary--every-term-has-a-cs-anchor) for the term-in-use → CS-source mapping (and the retired-terms list)

---

## Tools evaluated and not picked

### MetaGPT (FoundationAgents)

- **Date**: 2026-05-03
- **Verdict**: Closest conceptually (simulated software company with PM/architect/PM/engineer roles), but wrong stack (Python framework around GPT models, not Claude Code-native). No 24/7 viability framing. No self-improvement loop. See `competitors/metagpt.md`.

### CrewAI

- **Date**: 2026-05-03
- **Verdict**: Generic role-play orchestration, not coding-specific. Doesn't compose with Claude Code Max economy. See `competitors/crewai.md`.

### Microsoft Agent Framework

- **Date**: 2026-05-03
- **Verdict**: Enterprise framing (.NET + Python, OpenTelemetry, time-travel debugging, MCP, A2A). Not solo-developer-organism shaped. See `competitors/microsoft-agent-framework.md`.

### ComposioHQ Agent Orchestrator (AO)

- **Date**: 2026-05-03
- **Verdict**: Strong autonomy + dashboard combo (agents in worktrees, autonomous PR lifecycle). PR-centric framing; not a viable system; no self-improvement; no theoretical grounding. See `competitors/composio-ao.md`.

### Intent

- **Date**: 2026-05-03
- **Verdict**: Spec-driven verification — strong on auditability. Spec-as-source-of-truth model is heavier than substrate-first. Not solo-dev-friendly out of the box.

### Pask (NTU/Tsinghua, arXiv 2604.08000)

- **Date**: 2026-05-03
- **Verdict**: Research artifact — proactive AI agent system with hybrid memory. Not a usable tool. Also occupies the name we briefly considered for this project.

### taskmd (driangle / German Greiner)

- **Date**: 2026-05-03
- **Verdict**: Adjacent task spec (directory-of-files + YAML frontmatter). Different design choice from tasks.md (single-file + inline metadata). We deliberately diverge; tasks.md is ours.

### Ralph (Geoffrey Huntley original)

- **Date**: 2026-05-03
- **Verdict**: The original `while :; do cat PROMPT.md | claude-code; done` technique. We use the formalized version (Anthropic's official ralph-wiggum plugin) and the safety-railed implementation (frankbria/ralph-claude-code). The bash-loop original is a useful reference but not a runtime dependency.

---

## Open questions for next research pass

- Apple Watch surface — does Shortcuts + ntfy suffice long-term, or do we eventually need a native WatchOS app?
- DSPy idiom fit with Claude Code's prompt model — needs first practical attempt
- Lighter OTEL backend — Loki+Tempo+Prometheus+Grafana is heavy for single-dev installs; SQLite-backed alternative?
- Cross-language equivalent of tasks.md — can the spec be ported to Python/Rust ecosystems? (taskmd-driangle covers some of this with directory-of-files)
- Multi-machine scope — initial scope is single-developer-machine; what changes for distributed setups?
- OMC handoff persistence — do they parseably persist their internal task list to disk? Determines bridge complexity.

---

## Quarterly review log

(Empty at start; entries added each quarter per `vision.md` § "License & openness".)

- **2026-05-03 — Initial pass.** Dependency table established. Each row first-time-reviewed. OMC adopted. tasks.md confirmed as substrate. Constitutional review identified as the single wholly-novel layer. Five extraction targets named.
