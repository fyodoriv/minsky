# Vision

> A society of minds. Building yours.

## What Minsky is

Minsky is an **integration distribution**. It connects existing tools into a viable cybernetic system that produces software 24/7 on a Claude Code Max subscription, and stays alive — on-budget, on-mission, getting better — indefinitely.

Minsky is **not** a framework. It does not contain a multi-agent runtime. It does not own the task queue, the personas, the loop driver, the dashboard, or the mobile surface. Each of those is provided by an existing tool that someone else maintains. Minsky's job is to **choose them, configure them, wire them together through versioned interfaces, and add the small layers nobody else is building**.

## The reframe: a distribution, not a framework

Linux distributions don't write the kernel. They curate, configure, integrate. Ubuntu's value isn't the kernel — it's that everything Just Works together.

Minsky is the Ubuntu of autonomous Claude Code: a curated, pre-configured stack with strong opinions about how the pieces fit, plus the small custom layers (MAPE-K loop, specification monitor, budget guard, handoff spec) that make the whole thing self-improving and viable.

The success criterion changes accordingly. Not "did we ship features faster" — that's a byproduct. The criterion is: **is the integration durable?** Every dependency behind an interface. Every novel layer extractable as its own OSS. Every choice defended by reference to a named, decades-tested pattern.

## The constitution

These principles are non-negotiable. The MAPE-K loop (the *autonomic manager*, in IBM autonomic-computing terms) reviews behavior against them. Specification drift triggers correction.

### 1. Don't reinvent the wheel

Strict preference order:

1. Use someone else's tool.
2. If you must build, extract reusable parts as separate OSS from day one — designed for others to use, not just us.
3. Only keep proprietary what's genuinely unique.

Apply continuously, not only at project start. Quarterly: scan whether each novel layer is now solvable upstream — and replace yourself.

### 2. Every dependency behind an interface

No tool we depend on is hardcoded. Each is accessed through an adapter — a Minsky module that defines an interface, then implements it against the currently chosen tool. Swapping OMC for a future better orchestrator is a one-file change. See `ARCHITECTURE.md` for the adapter pattern applied to all dependencies.

This is what makes principle 1 *tractable* over a decade. Without interfaces, "use someone else's tool" calcifies into vendor lock-in. With interfaces, the stack is a Ship of Theseus — every plank replaceable.

### 3. Test-first, metric-first, doc-first

Every feature begins with a failing test (red). Then minimal code to pass (green). Then refactor.

Before any code:

- The metric that will prove it works, with a numeric threshold
- The doc explaining why it exists
- The user-story file declaring what's being built and how we'll know it's done

No exceptions. Apply at every level: code, persona behavior, orchestration logic, even the autonomic manager's own decisions.

### 4. Everything measurable, everything visible

The system has no hidden state. Every component reports to OpenTelemetry. Every metric appears on a dashboard. The dashboard is reachable from your wrist.

If you can't see it, it doesn't exist. If you have to dig for it, you won't.

### 5. Theoretical grounding — every term has a CS anchor

Each architectural choice references a named, decades-tested pattern. We do not invent terminology when established literature has a word for it. We do not invent architecture when half a century of research has named the right one.

Concretely: **every Minsky-coined word has an entry in the [Glossary](#glossary--every-term-has-a-cs-anchor) below pointing to its computer-science / control-theory / formal-methods source.** If a metaphor (e.g., "the constitution") is useful for narrative, it must be introduced *as a label for* a precisely-named pattern (e.g., a behavioral specification monitored at runtime), and the precise term is what the code, package names, and tests use. New terminology requires either (a) an existing literature citation or (b) a justification for why no published term fits — recorded in `research.md`.

This is also a hedge: when something breaks at 3am, "this is supervision-tree pattern, restart strategy is one-for-one" is a debuggable answer. "This is how I happened to wire it" is not.

### 6. Stay alive

The system is designed to operate for years, not days. It throttles itself before hitting limits, recovers from crashes without human help, detects its own drift, and improves itself measurably over time.

"Stays useful indefinitely under constant pressure" is the goal. "Ships features fast" is a byproduct.

## Theoretical foundations

Minsky stands on the shoulders of named giants. Each layer in the architecture maps to a tested pattern with literature behind it.

**Marvin Minsky — Society of Mind.** Intelligence is not a unified mind; it's a society of small specialists, none intelligent alone. Maps to: the persona/agent layer (provided by OMC).

**Stafford Beer — Viable System Model (VSM).** Five recursive levels at increasing timescales: Operations, Coordination, Control, Intelligence, Identity. Maps to: the project's vertical layering.

**Carl Hewitt — Actor Model.** Independent actors that communicate only via messages, never shared state. Maps to: persona-to-persona handoffs through the shared blackboard.

**Joe Armstrong — OTP Supervision Trees.** Let processes die; supervisors restart them with policy. The pattern that produced decade-uptime telecom systems. Maps to: how Minsky recovers from any failure.

**Jeffrey Kephart & David Chess — MAPE-K Loop / Autonomic Computing** (IBM, 2003). Monitor → Analyze → Plan → Execute, sharing a Knowledge base. The reference architecture for self-adaptive software systems. Maps to: the MAPE-K loop (informal label: the *autonomic manager*).

**John Boyd — OODA Loop.** Observe, Orient, Decide, Act. Faster *correct* OODA wins. Maps to: the per-tick decision cycle inside each persona (a tactical inner loop, distinct from the cross-tick MAPE-K outer loop above).

**Walter Shewhart / W. Edwards Deming — PDCA Cycle.** Plan, Do, Check, Act. The basis of kaizen and Lean. Maps to: per-task structure.

**Eliyahu Goldratt — Theory of Constraints.** At any moment one thing is the bottleneck. Improving anything else is waste. Maps to: the autonomic manager's attention discipline.

**Michael Bratman — Belief-Desire-Intention (BDI).** The standard rational agent architecture: Beliefs (what you know), Desires (goals), Intentions (committed plan). Maps to: persona file structure.

**Barbara Hayes-Roth — Blackboard Architecture.** Specialists write partial solutions to a shared workspace; a controller decides who acts next. Maps to: tasks.md + handoffs/ folder.

**Google SRE — Error Budgets.** Quantify acceptable failure as a budget you spend. Maps to: token budget = error budget.

**Maturana & Varela — Autopoiesis.** Self-creating systems whose components participate in producing the network that produces them. Maps to: the long-term ambition — the autonomic manager maintains the personas that maintain the codebase that produces value.

**Douglas Hofstadter — Strange Loops.** Self-referential systems that gain capabilities by observing themselves. Maps to: the autonomic manager observing its own performance.

**Omar Khattab — DSPy / "programming, not prompting".** Treat prompts as code; optimize them with metrics as reward signal. Maps to: how the autonomic manager improves persona prompts over time.

**Klaus Havelund & Allen Goldberg — Runtime Verification.** Monitor an executing system's traces against a formal specification; flag violations as they occur. Maps to: specification monitoring (informal label: *constitutional review*) — the project specification lives in `vision.md`; the monitor is a Claude Skill that reads traces + commits and reports drift.

**Mark Weiser — Calm Technology / Ambient Display** and **Stuart Card / Jock Mackinlay — Glanceable Information Display.** Information should be available at the periphery; the user pulls focus only when something demands it. Maps to: the wrist surface (Apple Watch glance widget) — three numbers, no chrome.

**Brendan Gregg — USE Method** (Utilization, Saturation, Errors, for resources) and **Tom Wilkie — RED Method** (Rate, Errors, Duration, for services). Maps to: dashboard methodology.

These are organs of one body, not a checklist. They cohere.

## Glossary — every term has a CS anchor

This table operationalizes constitutional principle 5. Every word Minsky introduces — whether a metaphor for narrative ease or a technical label — points back to a published computer-science / control-theory / formal-methods source. **Code, package names, file paths, test names, and CLI flags use the precise term in the right column.** Prose may use the metaphor in the left column, provided the precise term has been introduced once on the same page.

| Minsky term | Precise term | Anchor / source |
|---|---|---|
| CTO loop / CTO meta-loop | **MAPE-K loop** (component name: *autonomic manager*) | Kephart & Chess, "The Vision of Autonomic Computing", IEEE Computer 2003 |
| TPM (technical-program-manager agent) | **Manager agent** | Multi-agent systems literature; CrewAI's own term |
| Constitution / constitutional rules | **Behavioral specification** / **invariants** | Lamport, "Specifying Concurrent Program Modules", TOPLAS 1983 |
| Constitutional review | **Runtime specification monitoring** | Havelund & Goldberg, "Verify Your Runs", VSTTE 2008 |
| Watch surface / Watch glance | **Glanceable / ambient display** | Card & Mackinlay 1999; Weiser & Brown, "Calm Technology" 1995 |
| Tick | **Scheduler iteration** / **control-loop period** | Liu, *Real-Time Systems* (2000) |
| Claim (a task) | **Lease** / **mutual exclusion** | Gray & Cheriton, "Leases", SOSP 1989 |
| Handoff | **Actor message-passing** with continuation | Hewitt, Bishop, Steiger 1973 |
| Persona | **Specialist agent** / **role-based agent** | Wooldridge, *An Introduction to MultiAgent Systems* (2009) |
| Drift | **Specification drift** (system) / **concept drift** (data) | Widmer & Kubat, "Learning in the Presence of Concept Drift", *Machine Learning* 1996 |
| Society of minds | (kept as-is — primary literature term) | Marvin Minsky, *The Society of Mind* (1986) |
| Strange loop | (kept as-is — primary literature term) | Hofstadter, *Gödel, Escher, Bach* (1979) |
| Watchdog (in `claude-budget-guard`) | (kept as-is — already a precise CS term) | Watchdog timer, hardware/OS literature |
| Inner loop / Outer loop | (kept as-is — already precise) | Optimization & control systems |
| Bottleneck | (kept as-is — already precise) | Goldratt TOC (cited above) |
| Error budget | (kept as-is — already precise) | Beyer et al., *Site Reliability Engineering* (Google, 2016) |

When you introduce a new word in any Minsky doc, **add a row here in the same commit** (or remove the new word and use an existing row's right-column term).

## What Minsky is not

- Not an IDE plugin
- Not a multi-agent framework — use OMC
- Not a task queue — use tasks.md
- Not a CLI dashboard — use claude-dashboard
- Not a token monitor — use Claude-Code-Usage-Monitor
- Not a mobile app — use Tailscale + claude-code-monitor + ntfy + Apple Shortcuts
- Not a session tool — sessions are an implementation detail; viability is the point
- Not a productivity tool — productivity tools die when you stop maintaining them; viable systems maintain themselves

## Success criteria

These metrics are tracked on the dashboard from day one. Each has a corresponding integration test in `user-stories/`. Targets are starting points; the MAPE-K loop adjusts them based on observed reality.

| # | Metric | Target | SLI source |
|---|--------|--------|------------|
| 1 | Loop uptime, 30/90/365 day | 99% / 97% / 95% | systemd active state |
| 2 | Tokens per closed user-story | Decreasing trend month-over-month | OTEL token sum / closed-stories count |
| 3 | Specification alignment ("constitutional alignment") | 95%+ specification-monitor runs finding no drift | spec-monitor log pass rate |
| 4 | Self-improvement velocity | ≥4 prompt improvements/month with measured gains, after Q1 | A/B test win count from DSPy adapter |
| 5 | Mean time to recovery (MTTR) | <5 min from process death to next claim | Supervisor restart-to-claim latency |
| 6 | Time on user's wrist (inverted) | <60 sec/day to confirm health | Watch surface dwell time |
| 7 | Extraction count | ≥4 OSS repos extracted by month 6 | GitHub repo count under user account |
| 8 | Dependency interface coverage | 100% of deps behind adapter | Static check in CI |
| 9 | Token-budget honoring | Zero hard-rate-limit hits per week | OTEL 429 count |
| 10 | Task throughput | Sustained tasks/day at chosen budget | tasks.md commit log |

## License & openness

MIT throughout. Every novel layer extracted from day one as its own MIT repo with clean interface, documentation, and tests sufficient for others to adopt without depending on Minsky proper. Configuration, persona prompts, and the integration spec are open.

Closed parts: nothing.

## North star

> A solo developer, on a $200/month subscription, sleeps soundly while a society of specialists builds their software, supervises itself, repairs itself, improves itself, and pings the developer's wrist only when something genuinely matters. The system stays alive and useful for the developer's career. When better tools appear, Minsky absorbs them and replaces its own pieces. The integration outlives any single tool in the stack.

## Reading next

- `ARCHITECTURE.md` — how the pieces wire together; the adapter pattern; the dependency table; data flow; supervision tree
- `AGENTS.md` (forthcoming) — how any agent should behave when working in this repo
- `TASKS.md` (forthcoming) — current work queue, eats own dog food
- `research.md` (forthcoming) — living scan of replaceable parts and incoming candidates
- `competitors/` (forthcoming) — one doc per competitor with extraction notes
- `user-stories/` (forthcoming) — one file per story with metric, integration test, proof
