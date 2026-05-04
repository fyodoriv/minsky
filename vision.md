# Vision

> A society of minds. Building yours.

## What Minsky is

Minsky is an **integration distribution**. It connects existing tools into a viable cybernetic system that produces software 24/7 on a Claude Code Max subscription, and stays alive — on-budget, on-mission, getting better — indefinitely.

Minsky is **not** a framework. It does not contain a multi-agent runtime. It does not own the task queue, the personas, the loop driver, the dashboard, or the mobile surface. Each of those is provided by an existing tool that someone else maintains. Minsky's job is to **choose them, configure them, wire them together through versioned interfaces, and add the small layers nobody else is building**.

Minsky is also explicitly **not** a vehicle for one-off quick fixes. Its scope is the long-tail viability of a cybernetic system that runs for years on a Claude Code subscription. Every change in this repo is a pre-registered experiment under rule #9 (hypothesis-driven development) — including bugfixes, including refactors, including docs. If a candidate change cannot state its expected metric movement in advance, either the metric source is missing (in which case ship a preparation PR first) or the change does not justify the discipline overhead and belongs elsewhere. See rule #9 below and `## What Minsky is not` for the explicit out-of-scope statement.

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

The system is designed to operate for years, not days. It throttles itself before hitting limits, recovers from crashes without human help, detects its own specification drift, and improves itself measurably over time.

"Stays useful indefinitely under constant pressure" is the goal. "Ships features fast" is a byproduct.

### 7. Chaos engineering — trust nothing unverified

Trust no component whose failure probability is not provably ≤1e-12. Until verified, every dependency is assumed hostile: it can crash, hang, lie about success, return malformed data, or slow to a crawl mid-call. Rule #6 ("stay alive") sets the goal; this rule makes it falsifiable. The system stays alive only because we enumerate the ways each piece can fail, exercise each failure in tests that run on every CI, and verify the supervisor handles them as designed.

Every novel package and every user-story file enumerates four things:

1. **Failure modes** — concrete things that can break, organized by *fault axis*: process death (`kill -9`), network (`tc qdisc netem` for latency / loss; `iptables -A OUTPUT … -j DROP` for partitions), clock (`libfaketime` for skew and jump), disk-full, OOM, dependency upstream-error, dependency upstream-malformed-response. The Netflix Simian Army catalog (Basiri et al., *Principles of Chaos Engineering*, IEEE Software 2016) is the starting list; extend per the package's surface.
2. **Expected behavior** for each failure — exactly one of:
   - `loud-crash-supervisor-restart` — let-it-crash (Armstrong, *Programming Erlang*, 2007); supervisor restarts the process per its policy. Never silent recovery.
   - `circuit-break-and-notify` — open the circuit (Nygard, *Release It!*, 2007); fire a notification at level ≥ user-set threshold; close on probe success.
   - `graceful-degrade` — switch to a reduced-capability mode (e.g., Haiku instead of Sonnet under budget pressure) while emitting an OTEL span tagged `degraded=true`.
3. **Deterministic chaos test** — a CI test that reproduces the failure exactly (same fault axis, same timing) and asserts the expected behavior. A *steady-state hypothesis* (Basiri et al. 2016) is declared per system: the metric whose value defines "healthy" *before* the fault is injected; the test passes only if the metric is restored within the package's recovery SLO after the fault is removed.
4. **Blast radius** — explicit upper bound on what one failure can damage (single tick / single user-story / single dependency / whole system) and the *operator escape hatch* — the one-command kill switch the user can invoke if a chaos test escapes its bounds.

Weekly production fault injection (Netflix Tech Blog, "Chaos Monkey released into the wild", 2012) on a low-stakes day: the supervisor randomly picks one declared failure mode and triggers it. If the system fails to recover per spec, the developer gets a Watch-level notification and the failure becomes the week's constraint per Goldratt TOC.

Two underlying patterns make recovery deterministic and are presumed by the rule: actor isolation (Hewitt, Bishop, Steiger, "A Universal Modular ACTOR Formalism for Artificial Intelligence", IJCAI 1973) — actors share no state, so one's death corrupts no one else; and log-replay (Kreps, "The Log: What every software engineer should know about real-time data's unifying abstraction", LinkedIn Engineering 2013) — durable input lets any actor recompute its state. Without both, "recovery" is wishful thinking.

**Anti-pattern**: silent retry-with-backoff loops that suppress the failure signal. They look like graceful handling and are in fact the opposite — they paper over a fault that should crash loudly so the supervisor can act and the developer can see. *Suppression of failure is itself a constitutional violation*; the spec-monitor flags it during runtime specification monitoring.

Sources: Basiri et al., "Principles of Chaos Engineering", IEEE Software 2016; Beyer et al., *Site Reliability Engineering*, Ch. 17 "Testing for Reliability", 2016; Armstrong, *Programming Erlang*, 2007; Nygard, *Release It!*, 2007; Hewitt, Bishop, Steiger, IJCAI 1973; Kreps, "The Log", 2013; Netflix Tech Blog, "Chaos Monkey released into the wild", 2012.

### 8. Pattern conformance — every artifact maps to a published pattern; deviations are declared

Rule #5 said *every Minsky-coined word has a CS anchor*. This rule generalises that commitment to *every artifact*: every file, every package, every interface, every architectural decision, every process step traces to a named, published pattern from computer science, control theory, cybernetics, formal methods, or systems engineering. The repo is 100% science-anchored, explicitly. There is no "we just decided to do it this way."

Two operational consequences:

1. **Pattern conformance index** (table immediately below) — a single living index lists each Minsky artifact with its (a) governing pattern, (b) literature source, (c) conformance level: `full` / `partial` / `deviation`. Every PR that adds a new file, package, interface, or architectural decision adds (or amends) a row in the same commit. Missing or stale rows are a CI failure (the linter scans for new top-level files / packages without index entries).
2. **Deviations are explicit, not silent.** Where Minsky's implementation deviates from the published pattern (timing constraints, single-machine scope, language idiom, performance tradeoff), the deviation is *declared* — in the index row, in the file's docstring or top-level comment, and in `research.md` if it represents a research-level departure. The declaration includes: which property of the published pattern is violated, why the deviation is acceptable for Minsky's scope, and what would have to change to restore full conformance. Silent deviation is itself a constitutional violation.

Code conventions that follow from this rule:

- **Identifiers match the pattern when the match is total.** When a class, function, type, or module *is* an instance of a published pattern, its identifier matches the pattern's canonical name (e.g., `aggregateStatus` for "worst-status aggregation"; future `MapeKLoop`, `SupervisionTree`, `CircuitBreaker`). When the match is partial, the identifier names what we built and a doc comment cites the pattern with the deviation declared.
- **Top-of-file pattern reference.** Every TS source file (and every shell script of substance) opens with a comment block stating: pattern, source, conformance, and (if not full) deviation rationale. JSDoc on public interfaces names the pattern.
- **Persona prompts** (when added under `.claude/agents/`) include a pattern reference for the role they play (e.g., `architect.md` → BDI rational agent; `qa-tester.md` → property-based testing; `verifier.md` → Hoare-style pre/post conditions).

Why this rule exists, separately from rule #5: at 3am, "this module implements X pattern with Y deviation because Z" is a debuggable answer. "It's named after a metaphor and the code does its own thing" is not. Rule #5 ensures the *vocabulary* points to literature; rule #8 ensures the *behavior* does.

Sources: Brooks, *No Silver Bullet*, 1986 (essential complexity comes from the problem; named patterns reduce accidental complexity); Lampson, "Hints for Computer System Design", SOSP 1983 ("use a good idea more than once"); Gabriel, *Patterns of Software*, 1996 (pattern languages as architectural commitment); the Gang of Four, *Design Patterns*, 1994 (the foundational catalogue).

### 9. Pre-registered hypothesis-driven development — *iron rule*; no exceptions, including bugfixes

Rule #3 said *every feature begins with a failing test, a metric with a numeric threshold, and the doc explaining why*. This rule formalises rule #3 into the discipline of **pre-registered hypothesis-driven development**: every change — every PR, every feature, every refactor, **every bugfix** — is a falsifiable experiment whose hypothesis, metric, success threshold, pivot threshold, and measurement command are *committed in advance of the change* (in the task block, the PR description, or a preparation PR). The repo develops by satisfying clearly measurable goals; if the metric doesn't move, the approach is abandoned, not the metric. Pre-registration (committing the prediction *before* observing the result) is what makes the experiment falsifiable; without it, the rule degenerates into post-hoc rationalisation. This discipline imports pre-registration from clinical-trials and reproducible-science methodology (Munafò et al. 2017) into day-to-day software change.

This rule is **iron**: it has no exemptions for "small fixes", "obvious changes", "just a refactor", or "blocked-by-business reasons". A bugfix's hypothesis is "the recurrence rate of this fault (or a stability metric to which it contributes) drops from X to Y after this change". If that statement cannot be made — including its threshold and its measurement command — the root cause has not been identified and the fix is not ready to ship. The only blanket exemption is a *trivially-correct* change whose existing CI gate IS the metric (typo fix in prose, formatting churn, no-op move covered by passing tests); even then the exemption is documented in the commit message rather than assumed.

Every change declares five things:

1. **Hypothesis.** The change improves which behaviour, by how much, why we believe so. Anchored in the Goal-Question-Metric paradigm (Basili, Caldiera, Rombach 1994): state the goal, derive the question that operationalises it, derive the metric that answers the question. Tasks that can't formulate a clear hypothesis aren't ready to start. Bugfix variant: the goal is the *stability metric* the bug threatened (error rate, MTTR, p99 latency, crash frequency, drift-rule-violation count); the question is "did this fix lower it"; the metric is the same observable, post-fix.
2. **Success threshold.** Numeric value (or rubric grade) at or above which the change is kept. Tracks the success-criterion column in `vision.md` § "Success criteria".
3. **Pivot threshold.** Value below which the *approach is abandoned* — not just the change reverted. The Lean Startup discipline (Ries 2011): build–measure–learn, validated learning, *pivot-or-persevere*. Without a pre-declared pivot, sunk-cost fallacy keeps a wrong approach alive long after the data has spoken.
4. **Measurement method (automated).** Exact shell command, OTEL query, or CI script that produces the metric. Reproducible by an outside observer with no manual steps. No English instructions ("count the lines"); literal syntax. If the prerequisite system isn't built yet, name the command and tag it `<TBD-AFTER: <task-id>>` linking to the task that lands the prerequisite.
5. **Literature anchor.** A paper or framework that justifies the metric's choice and the threshold's defensibility. Per rule #5 / rule #8.

The same five fields apply to the system-level table at `vision.md` § "Success criteria" — every metric carries them.

**Preparation-PR pattern.** When a candidate change targets a behaviour that is *not yet measurable* (no OTEL counter, no test harness, no log line that can be grepped), the discipline is to *first* ship a **preparation PR** that lands the instrumentation, *then* open the change PR against the now-measurable baseline. This is not bureaucratic overhead — it is the only way the change PR can carry a real before/after number. Preparation PRs are first-class work in `TASKS.md` and are explicitly endorsed (not deferred under "we'll instrument later"). When the metric source is missing and the change is non-trivial, propose the preparation PR as the next task instead of guessing the effect size.

Why a separate rule from #3: rule #3 says *do these things first*. Rule #9 says *make them executable, falsifiable, and pre-registered*. Without #9, "metric-first" degenerates into vague KPIs that nobody actually queries; without pre-registration, even measured changes degenerate into fishing expeditions.

**Anti-pattern: vanity metrics.** Counts that always go up (lines of code, commits made, hours spent, tasks "in flight") are *forbidden* as success metrics — they incentivise activity, not outcomes. Ries 2011 names this trap; Doerr 2018 (OKRs) reinforces: *measure outcomes, not activities*. The spec-monitor flags new tasks proposing vanity metrics during runtime specification monitoring.

**Anti-pattern: post-hoc metrics.** Picking the metric *after* seeing the change's effect is forbidden. The metric is part of the contract the change is being judged against; choosing it after the fact lets the change always "succeed" by the metric most flattering to it. Pre-registration (Munafò et al. 2017) is the correction: declare in the task block / PR description, *before* code is written, what observable will move and by how much.

**Pre-registration without execution is half a rule.** Pre-registered hypotheses that are never re-measured collapse into wish-lists; pre-registered hypotheses that *are* re-measured but only by hand collapse into "we'll check eventually" and silently rot. Rule #9 therefore commits the repo to a three-timescale **automation layer** that closes the loop from declaration to verdict. Each timescale ships as its own task; together they form the operational substrate of the rule.

1. **Daily / per-PR layer — the experiment runner.**
   - Every non-trivial PR ships an `EXPERIMENT.yaml` (or equivalent structured frontmatter) parsed from the PR description, carrying the five fields. CI fails fast when the file is missing or malformed.
   - The runner executes `Measurement` against the merge-base ref (baseline), and again against the post-merge `main` ref (treatment), recording both numbers tagged with the experiment-id into the OTEL backend (or the lightweight `experiment-store` until the OTEL backend lands — see `otel-lite-backend`).
   - Verdict at this layer is provisional ("first observation"); the structural test it enforces is "the measurement command is runnable and produces a number". This is the executability gate — the rest of the layer assumes commands can be run.
   - Failure modes: missing YAML → block merge; non-runnable command → block merge; baseline ≈ treatment within instrument noise → flag as "no observable effect, requires longer window or larger sample" and route to the weekly layer.
   - Implementation: `ci-experiment-runner-v0` (in `TASKS.md`).

2. **Weekly / monthly layer — the sustained-gain check.**
   - A scheduled job re-runs each merged experiment's `Measurement` at +7 / +30 days (configurable per-experiment), compares against the declared `Success` and `Pivot` thresholds, and emits a verdict per experiment: `validated` / `regressed` / `inconclusive`.
   - The 7-day floor is the sustained-gain discipline already cited in `mape-k-loop-v0` (Ries 2011 build–measure–learn, validated learning); the 30-day window catches mid-term regressions that disappear from short A/B windows (Kohavi/Tang/Xu 2020 ch. 5–7 "trustworthy" rather than "fast").
   - `regressed` triggers an automated revert/pivot task in `TASKS.md` linking the experiment-id; `inconclusive` lengthens the window or asks for a re-design.
   - Implementation: `experiment-tracker-v0` (in `TASKS.md`).

3. **Quarterly layer — cross-experiment calibration.**
   - The store accumulates `{predicted Δ, observed Δ at +7, observed Δ at +30, observed Δ at +90}` tuples. A periodic analysis (folded into `mape-k-loop-v0`'s Knowledge phase and into the existing `review-q3-2026` cadence) tests *meta*-questions: are predictions tracking observations? Which categories of hypothesis are systematically over-optimistic (e.g., "this refactor reduces tokens-per-story" claims that never show up)? Which thresholds are calibrated, which are theatre?
   - The quarterly verdict feeds back into rule #9 itself: if a class of hypothesis cannot be calibrated after multiple iterations, the rule's pivot-threshold contract is wrong for that class and the rule must adapt (e.g., add a research-task exemption).
   - Implementation: scope expansion of `mape-k-loop-v0` (Knowledge phase) and `review-q3-2026`.

The three timescales together form a MAPE-K loop over the rule itself (Kephart & Chess 2003 applied recursively): the daily layer is Monitor, the weekly layer is Analyze, the quarterly layer is Knowledge + Plan. Without all three, rule #9 degrades to spec without an interpreter.

Sources: Basili, Caldiera, Rombach, "The Goal-Question-Metric Approach", *Encyclopedia of Software Engineering* 1994; Ries, *The Lean Startup*, 2011 (build-measure-learn; pivot-or-persevere); Kohavi, Tang, Xu, *Trustworthy Online Controlled Experiments*, Cambridge University Press 2020 (statistical rigour in A/B testing); Munafò et al., "A Manifesto for Reproducible Science", *Nature Human Behaviour* 1, 0021, 2017 (pre-registration; the falsifiability discipline imported from open science); Fagerholm, Sanchez Guinea, Mäenpää, Münch, "Building Blocks for Continuous Experimentation", *RCoSE* 2014 (continuous experimentation in software); Kitchenham, Dybå, Jørgensen, "Evidence-Based Software Engineering", *ICSE* 2004; Forsgren, Humble, Kim, *Accelerate*, 2018 (DORA's four-key-metrics for software-delivery performance — deployment frequency, lead time, MTTR, change-fail rate); Manzi, *Uncontrolled*, 2012 (causal inference outside the lab); Doerr, *Measure What Matters*, 2018 (OKR discipline; outcomes not activities).

### 10. Deterministic enforcement — every rule is a CI lint, not a hope

Rules #1–9 are the *contract*. Rule #10 is the *enforcement model*: every constitutional rule is enforced by a deterministic CI check, not by an LLM-judgement Skill, not by a human reviewer's vigilance, not by "the agent will remember". Whatever cannot be deterministically checked is *not* a constitutional rule — it is a heuristic, and it must be marked as such or rephrased until it is mechanisable. This is a tightening of the meta-rule that makes #1–9 load-bearing rather than aspirational.

The discipline:

1. **Every rule maps to one or more CI lint scripts** (under `scripts/check-rule-<n>-*.mjs` or equivalent), each runnable locally (`pnpm run check:rule-<n>`) and wired into `.github/workflows/ci.yml` as a *required* status check. The lint exits non-zero on violation; zero otherwise. No human triage, no LLM in the loop.
2. **LLM-driven checks are advisory only.** A Claude Skill (e.g., `claude-spec-monitor`) can *augment* the deterministic linters with judgement-heavy questions ("does this hypothesis pass the smell test?"), but its verdict is never load-bearing. If a Skill flags a violation that the deterministic linter doesn't catch, the response is to *write the deterministic linter*, not to trust the Skill's word. Skills are useful for *discovering* rule gaps; they are not useful for *enforcing* rules. (Determinism in this rule means: same input ⇒ same output, with no model call in the chain. A `grep` is deterministic; a Claude prompt is not.)
3. **Rules that resist mechanisation are reframed.** When a rule is genuinely impossible to deterministically enforce (e.g., "is this hypothesis a *good* hypothesis?"), it is split into a deterministic substrate (presence and shape of the hypothesis block) plus an explicit human-judgement layer (reviewer signs off; no LLM substitute). The judgement layer is documented as such — never quietly delegated to a Skill.
4. **Rule #9's automation layer is the template.** The three-timescale enforcement architecture (per-PR runner / weekly tracker / quarterly calibration) is the worked example: the contract is declared; the CI runs the measurement; the cron checks the threshold; the verdict is mechanical. Every other rule should aspire to the same shape.
5. **The ratchet rule.** When a deterministic linter is added for a rule, the matching Skill-based or human-vigilance enforcement is *removed* in the same PR — never run both, never let the Skill become a fallback. Two enforcement mechanisms competing produces ambiguity about which is authoritative; the deterministic one always wins.

This rule is also iron: no constitutional rule is permitted to ship without its deterministic check, and rules that lack one today are tracked in `TASKS.md` under `ci-rule-<n>-*` tasks until they ship.

Why a separate rule and not a clause inside others: because the *enforcement model* is itself a constitutional commitment. Without rule #10, the project drifts back toward "we'll review carefully" — which is the failure mode the entire constitution exists to prevent.

Sources: Lampson, "Hints for Computer System Design", *SOSP* 1983 (move the constraint to the cheapest possible point — CI is cheaper than human review); Beck, *Extreme Programming Explained*, 1999 (continuous integration as the constraint enforcer); Hunt & Thomas, *The Pragmatic Programmer*, 1999, Tip 32 ("crash early"); Brooks, *No Silver Bullet*, 1986 (accidental complexity comes from the absence of mechanisation); Forsgren, Humble, Kim, *Accelerate*, 2018 (deployment-pipeline determinism is a DORA prerequisite); Munafò et al. 2017 (the open-science argument that pre-registration *plus mechanical verification* is what changes outcomes — pre-registration alone does not).

## Pattern conformance index

Operationalises rule #8. Each row maps a Minsky artifact (file path, package, interface, architectural decision, process step) to its governing pattern, the published source, and its conformance level. **Every PR that adds a new top-level artifact adds a row in the same commit** (a CI lint will eventually enforce this; tracked in TASKS.md).

Conformance levels:

- **full** — implementation matches the pattern as published in all properties relevant to our scope.
- **partial** — matches the structure / intent; one or more orthogonal properties differ. The differing property is named.
- **deviation** — substantive departure from the published pattern. Rationale is given in the same row plus, where load-bearing, in `research.md`.

| # | Artifact | Pattern | Source | Conformance | Notes / declared deviation |
|---|---|---|---|---|---|
| 1 | `vision.md` (this file) | Behavioral specification | Lamport, "Specifying Concurrent Program Modules", *TOPLAS* 1983 | full | Spec is the source of truth; runtime is monitored against it (rule #5 + the spec-monitor Skill). |
| 2 | `ARCHITECTURE.md` § layered model | Viable System Model (VSM) | Beer, *Brain of the Firm*, 1972 | full | Five-level hierarchy (Identity / Intelligence / Control / Coordination / Operations) plus a cross-cutting Nervous System; layers map 1:1. |
| 3 | `novel/adapters/` (the adapter pattern itself) | Adapter (structural) + Strategy (behavioral) | Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994 | full | Each adapter file pair = interface + Strategy implementation. Switching implementations is a one-line config change. |
| 4 | `ARCHITECTURE.md` § "Process supervision tree" | OTP supervision behaviour (one-for-one, restart-with-backoff) | Armstrong, *Programming Erlang*, 2007 | partial | Restart strategies match. Supervisor primitive is systemd / launchd (POSIX), not BEAM. **Deviation:** Erlang spawns processes in microseconds; systemd respawn is ~100ms. **Why acceptable:** tick cadence is minutes-to-hours, so 100ms respawn is invisible. **What would restore full conformance:** a BEAM-based supervisor — out of scope for solo-dev tier. |
| 5 | `claude-mape-k-loop` (planned) | MAPE-K reference architecture for autonomic computing | Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003 | full (planned) | Monitor → Analyze → Plan → Execute over a Knowledge base; one OTEL span per phase. Plug for `PromptOptimizer` adapter (DSPy) is the Execute primitive. |
| 6 | Per-tick decision cycle inside personas | OODA loop | Boyd, "Discourse on Winning and Losing", 1976 | full | Tactical inner loop; distinct from the cross-tick MAPE-K outer loop (rule #4 of MAPE-K is the outer Execute, not OODA's Act). |
| 7 | Per-task structure | PDCA (Plan-Do-Check-Act) | Shewhart 1939; Deming 1986 | full | Each task has plan → implement → verify → ship phases; the `/next-task` skill enforces them. |
| 8 | `tasks.md` task queue (single file + git) | Blackboard architecture | Hayes-Roth, "A Blackboard Architecture for Control", *Artif. Intell.* 1985 | partial | Specialists write partial solutions to a shared file; controller (the picker rules in `/next-task`) decides who acts next. **Deviation:** no centralized arbiter process — git's optimistic concurrency is the arbiter. **Why acceptable:** solo-dev workflow has at most a handful of agents; merge conflicts are rare and recoverable. **What would restore full conformance:** a long-running blackboard controller process — over-engineered for our scope. |
| 9 | `claude-handoff-spec` (planned) | Actor message-passing with continuation | Hewitt, Bishop, Steiger, "A Universal Modular ACTOR Formalism for Artificial Intelligence", *IJCAI* 1973 | full (planned) | Status / artifacts / blockers / suggested next persona = the message; the next persona is the continuation. |
| 10 | `ARCHITECTURE.md` § "Token economy" | Error budget | Beyer et al., *Site Reliability Engineering*, 2016, Ch. 3 | full | Tokens treated as the budget you spend; `claude-budget-guard` is the SRE-style burn-rate alerting. |
| 11 | `claude-spec-monitor` (planned) | Runtime verification | Havelund & Goldberg, "Verify Your Runs", *VSTTE* 2008 | full (planned) | Reads behavioral spec (`vision.md`) plus recent traces; produces structured drift report. |
| 12 | Watch surface (3 numbers) | Glanceable / ambient information display | Card & Mackinlay, *Readings in Information Visualization*, 1999; Weiser & Brown, "Calm Technology", 1995 | full | Three values, no chrome; design discipline forbids a fourth (story 005). |
| 13 | Dashboard methodology (CLI / web tiers) | USE method (utilization, saturation, errors) + RED method (rate, errors, duration) | Gregg, *Systems Performance*, 2014; Wilkie, "RED Method", 2018 | full | Resources use USE; services use RED; both surface on the same dashboard. |
| 14 | Constitutional rule #7 + per-package failure-mode tables | Chaos engineering principles | Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016 | full | Steady-state hypothesis, fault axis, blast radius, operator escape hatch — all explicit per artifact. |
| 15 | `aggregateStatus()` in `novel/adapters/observability/src/index.ts` | Worst-status aggregation over a status lattice | Avizienis et al., "Basic Concepts and Taxonomy of Dependable and Secure Computing", *IEEE TDSC* 2004 (status hierarchies) | full | Red ⊐ yellow ⊐ green; meet operation in the lattice; same as Kubernetes pod-phase aggregation. |
| 16 | `selfTest()` adapter contract | Self-checking software / health probe | Avizienis, "The N-Version Approach to Fault-Tolerant Software", *IEEE TSE* 1985; Burns et al., "Borg, Omega, and Kubernetes", *ACM Queue* 2016 (liveness probe) | full | Each adapter exposes a `selfTest()` returning a status / message / latency / lastCheck record. |
| 17 | `setup.sh` ledger (`.minsky/state.json`) | Idempotent step ledger / write-ahead log idempotency | Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (immutable log of completed steps) | partial | Single-file JSON ledger; `mkdir`-based atomic lock. **Deviation:** not durable across machine death (no fsync barriers; no replication). **Why acceptable:** single-machine bootstrap; if the laptop dies mid-setup, `--reset` is the recovery path. **What would restore full conformance:** SQLite + WAL mode for the ledger — over-engineered today, on the table when the multi-machine task lands. |
| 18 | `.mcp.json` (project-scope MCP registration) | Configuration as code / 12-factor config | Wiggins, "The Twelve-Factor App", 2011, factor III; HashiCorp Terraform IaC pattern | full | All adapter / MCP wiring lives in repo, version-controlled, identical for every contributor. |
| 19 | `/next-task` skill (queue-mode loop) | Fixed-priority preemptive scheduling | Liu & Layland, "Scheduling Algorithms for Multiprogramming in a Hard Real-Time Environment", *JACM* 1973; Liu, *Real-Time Systems*, 2000 | partial | Discrete priority levels (P0–P3) instead of numerical; preemption is at task boundaries (cooperative), not interrupt-level. **Why acceptable:** task durations are minutes-to-hours, so cooperative scheduling has no observable cost; discrete levels match human triage. |
| 20 | TypeScript strict++ + Biome + lefthook | Defensive programming + early-failure / fail-fast | Hunt & Thomas, *The Pragmatic Programmer*, 1999 (Tip 32 "crash early"); Lampson 1983 (above) hint "use exceptions only for exceptional conditions"; Beck, *Extreme Programming Explained*, 1999 (continuous integration) | full | Strict types catch defects at compile; Biome catches style/complexity at lint; lefthook fails fast on commit. The constraint (rule #6) is moved to the cheapest possible point. |
| 21 | The `(@agent-id)` claim convention in TASKS.md | Lease | Gray & Cheriton, "Leases: An Efficient Fault-Tolerant Mechanism for Distributed File Cache Consistency", *SOSP* 1989 | partial | Time-bounded exclusive access. **Deviation:** no explicit timeout; staleness is detected by the picker rule "Found + stale (no related code) → unclaim". **Why acceptable:** humans + git history are the timeout signal. |
| 22 | This index | Pattern language / pattern catalogue | Alexander et al., *A Pattern Language*, 1977; Gabriel, *Patterns of Software*, 1996 | full | A living catalogue indexed by artifact, anchored in source, with explicit conformance level — the form pattern languages take in software architecture per Gabriel. |
| 23 | Constitutional rule #9 + the per-task measurement contract | Goal-Question-Metric + pre-registration | Basili, Caldiera, Rombach, "The Goal-Question-Metric Approach", *Encyclopedia of Software Engineering* 1994; Munafò et al., "A Manifesto for Reproducible Science", *Nature Human Behaviour* 1, 0021, 2017 (pre-registration); Fagerholm et al., "Building Blocks for Continuous Experimentation", *RCoSE* 2014 | full | Goal = success criterion. Question = "what would tell us the goal is being met?". Metric = the OTEL query / shell command in the measurement-method cell. Pre-registration (committing the prediction before observing) is what makes the experiment falsifiable; pivot threshold operationalises Ries 2011's pivot-or-persevere. Iron rule: no exemption for bugfixes — preparation PRs land the metric source first when missing. |
| 24 | `@minsky/observability` (`Observability` interface + `OtelObservability` strategy) | Adapter (structural) + Strategy (behavioral); three-signal observability (traces / metrics / logs) | Gamma et al., *Design Patterns*, 1994; OpenTelemetry specification (CNCF 2020+) | partial | OTEL implementation deviates from the standard convention by *not* registering its providers globally (`trace.setGlobalTracerProvider`, etc.) — see the package README's "v0 deviation declared" section. Restoring full conformance: a single explicit `setup.sh`-driven global registration at process start, tracked as future task `register-otel-globals-at-bootstrap`. |
| 25 | `@minsky/token-monitor` (`TokenMonitor` interface + `StubTokenMonitor`) | Adapter + Strategy; test double / fake | Gamma et al. 1994; Meszaros, *xUnit Test Patterns*, 2007 (test double / fake) | full | Interface + in-memory stub for tests. Real Strategy against Maciek's `claude-monitor` Python tool ships in `budget-guard-maciek-impl` follow-up. |
| 26 | `@minsky/budget-guard` (`BudgetGuard` watchdog + `decide()` pure decision function) | Watchdog (periodic-deadline check loop, hardware / OS literature) + error-budget burn-rate alerting | Beyer et al., *Site Reliability Engineering*, Ch. 3, 2016 (error budgets); failure-mode response labels from rule #7 | partial | Core decision logic + watchdog loop + HTTP envelope (row 28) shipped. Flag-file envelope and Maciek-impl Strategy still pending sub-tasks (`budget-guard-flag-file`, `budget-guard-maciek-impl`). Path deviation: original task brief specified `/var/run/minsky/budget.flag` which would need root; v0 follow-up uses `${MINSKY_HOME}/.minsky/budget.flag` instead — root-required paths out of scope for solo-dev tier. |
| 27 | `@minsky/handoff-spec` (record format spec + parser + validator) | Actor message-passing with continuation; recursive-descent parsing; schema validation | Hewitt, Bishop, Steiger, *IJCAI* 1973 (actor model); Aho-Sethi-Ullman, *Compilers*, 1986 (recursive-descent) | full | The record IS the message; `Suggested next` IS the continuation. v0 covers all 5 reference fixtures + all 3 invalid fixtures at 100 % branch coverage. |
| 28 | `@minsky/budget-guard` HTTP envelope (`BudgetServer` interface + `HonoBudgetServer` strategy + `budgetResponse` JSON renderer) | Adapter + Strategy + DTO (Data Transfer Object) | Gamma et al., *Design Patterns*, 1994; Fowler, *Patterns of Enterprise Application Architecture*, 2002 (DTO) | full | `BudgetServer` is the adapter; Hono is one Strategy (Fastify / native http would be alternatives). DTO shape is fixed by `ARCHITECTURE.md` § "Token economy". `cost` field is `null` until `budget-guard-maciek-impl` ships the real `TokenMonitor`. |
| 29 | `@minsky/experiment-record` (`EXPERIMENT.yaml` schema + parser + validator + CLI) | Pre-registration record + JSON-Schema-validated DTO + recursive-descent parser | Munafò et al., "A Manifesto for Reproducible Science", *Nature Human Behaviour* 1, 0021, 2017 (pre-registration); Fowler 2002 (DTO); Aho-Sethi-Ullman, *Compilers*, 1986 (parser shape); AsPredicted.org schema (concrete pre-registration template) | full | The metric source for the rule-#9 automation layer (`ci-experiment-runner-v0`, `experiment-tracker-v0`). Schema is intentionally tiny — every field already exists as a rule-#9 declaration; nothing new invented. Vanity-metric phrases are rejected at parse time per rule #9's anti-pattern list. `timeout_seconds` (default 60) is the per-experiment wall-clock cap consumed by `ci-experiment-runner-v0`. |
| 30 | `@minsky/adapter-types` (`SelfTestStatus` / `SelfTestResult` / `aggregateStatus()` leaf package) | Shared-types module + status lattice + acyclic dependency principle | Avizienis et al., "Basic Concepts and Taxonomy of Dependable and Secure Computing", *IEEE TDSC* 2004 (status lattice); Martin, *Clean Architecture*, 2017 (acyclic dependency principle); Wiggins, *The Twelve-Factor App*, 2011 (factor II — explicit dependencies) | full | Hoisted out of `@minsky/observability` so future adapters depend on this leaf directly instead of forming a `budget-guard → observability` cycle through a base type. `@minsky/observability` re-exports for back-compat; canonical home is the leaf. Zero internal Minsky deps — that is what makes it a leaf. Supersedes row 15's path (`aggregateStatus` now lives at `novel/adapters/types/src/index.ts`); row 15 kept for historical context until the next vision.md sweep. |
| 31 | `ci-experiment-runner-v0` (`scripts/run-experiment.mjs` + `.github/workflows/experiment.yml`) | Continuous experimentation runner (per-change experiment execution) + GitHub Actions deterministic CI | Fagerholm et al., "Building Blocks for Continuous Experimentation", *RCoSE* 2014 (the per-change experiment runner is the first building block); Kohavi/Tang/Xu, *Trustworthy Online Controlled Experiments*, 2020, ch. 4 (running every change as an experiment); Beck, *Extreme Programming Explained*, 1999 (CI as constraint enforcer); rule #10 (deterministic enforcement) | full | Closes the daily layer of rule #9. Job `gate` validates `EXPERIMENT.yaml` + measurement-runnability per PR; job `record` re-runs measurement against merge-base + main and appends a JSONL line to `experiment-store/<id>.jsonl`. Pure decision function `runExperiment(...)` is referentially transparent (rule #10); the CLI wrapper owns I/O. Trivial-PR exemption is two-factor (label + body comment, matching the rule-3 deferral pattern). |
| 32 | `scripts/check-rule-6-let-it-crash.mjs` (TS-AST diff-based lint for rule #6) | Deterministic CI gate over a TypeScript AST; let-it-crash supervision discipline | Armstrong, *Programming Erlang*, 2007 (let it crash); Lampson 1983 (use exceptions only for exceptional conditions); rule #10 (deterministic enforcement) | full | Walks every PR-touched `novel/**/*.ts` file (non-test); flags `try/catch` blocks nested deeper than 1 level (`nested-try`) or catch clauses whose body neither re-throws nor calls the bare-identifier supervisor `supervise(...)` (`swallowing-catch`). Per-catch opt-out: `// rule-6: handled-locally — <reason ≥3 chars>` immediately above the `catch` keyword. Diff-based — existing catch chains are grandfathered until the file is modified again (rule-1 / rule-3 precedent). |
| 33 | `scripts/check-rule-4-otel-coverage.mjs` (CI lint enforcing rule #4) | Deterministic conformance gate over a PR diff; TypeScript compiler-API AST walk + JSDoc-tag contract | OpenTelemetry specification (CNCF 2020+); Gregg, *Systems Performance*, 2014 (USE method — instrumentation as a structural property); Lampson, "Hints for Computer System Design", *SOSP* 1983 (move the constraint to the cheapest possible point); rule #10 (deterministic enforcement) | full | Diff-based: only files newly added or modified relative to `origin/main` are scanned. Existing un-annotated code is grandfathered — same precedent as rule-1, rule-3. Pure function (`checkOtelCoverage`) over `{ files: { path, source }[] }` is the load-bearing contract; the CLI is the I/O boundary. Tests cover all top-level export shapes (function declaration, default export, arrow + function expression assigned to `export const`, class methods including private/`#name`, constructors). |
| 34 | `scripts/check-pattern-index.mjs` (CI lint enforcing rule #8) | Deterministic CI gate over a PR diff; pattern-catalogue conformance check | Beck, *Extreme Programming Explained*, 1999 (CI as the constraint enforcer); Alexander et al., *A Pattern Language*, 1977 (catalogue indexed by artefact); rule #8 (pattern conformance — every artefact maps to a published pattern); rule #10 (deterministic enforcement) | full | Diff-based: every newly-added (status A) file under `novel/**`, root `*.md`, `setup.sh`, `distribution/**`, or `.github/workflows/**` must be mentioned by `vision.md` § "Pattern conformance index" (full path, package-prefix, or basename), unless the file's first ~20 lines carry `<!-- pattern: not-applicable — <reason> -->` (≥3-char reason). Test files (`*.test.ts`, `*.test.mjs`), fixture files, and node_modules are skipped. Modifications/renames/deletions are skipped — same grandfathering precedent as rule-1 / rule-3 / rule-4. Pure function `checkPatternIndex({ changedFiles, visionMdContent, optOuts })` is the load-bearing contract; CLI is the I/O boundary. |

When you add a new top-level artifact (file, package, interface, named architectural decision, named process step), append a row here in the same commit. When a deviation evolves, edit the row's notes column. When an artifact is removed, remove its row.

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

**Klaus Havelund & Allen Goldberg — Runtime Verification.** Monitor an executing system's traces against a formal specification; flag violations as they occur. Maps to: runtime specification monitoring — the project specification lives in `vision.md`; the monitor is a Claude Skill (`claude-spec-monitor`) that reads traces + commits and reports specification drift.

**Mark Weiser — Calm Technology / Ambient Display** and **Stuart Card / Jock Mackinlay — Glanceable Information Display.** Information should be available at the periphery; the user pulls focus only when something demands it. Maps to: the wrist surface (Apple Watch glance widget) — three numbers, no chrome.

**Brendan Gregg — USE Method** (Utilization, Saturation, Errors, for resources) and **Tom Wilkie — RED Method** (Rate, Errors, Duration, for services). Maps to: dashboard methodology.

These are organs of one body, not a checklist. They cohere.

## Glossary — every term has a CS anchor

This table operationalizes constitutional principle 5. Every word Minsky introduces — whether a metaphor for narrative ease or a technical label — points back to a published computer-science / control-theory / formal-methods source. **Code, package names, file paths, test names, and CLI flags use the precise term in the right column.** Prose may use the metaphor in the left column, provided the precise term has been introduced once on the same page.

Default discipline: **use the right-column term directly**. The left-column metaphor is permitted only when (a) it's a primary literature term in its own right (e.g., "society of minds" — Minsky 1986; "strange loop" — Hofstadter 1979) or (b) the metaphor adds narrative weight that the precise term loses (currently: "constitution" for the project-spec-as-authority framing). Every coined word that has a precise alternative in the right column is **retired** for new prose unless the row notes otherwise — see "Retired terms" below the table.

| Term in use | Precise / canonical anchor | Source |
|---|---|---|
| MAPE-K loop / autonomic manager | autonomic computing reference architecture | Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003 |
| Manager agent | manager / dispatcher role in multi-agent systems | Wooldridge, *An Introduction to MultiAgent Systems* (2009); CrewAI's own term |
| Constitution / constitutional rule N | behavioral specification / invariants | Lamport, "Specifying Concurrent Program Modules", *TOPLAS* 1983 |
| Specification drift (system) / concept drift (data) | standard ML / runtime-verification term | Widmer & Kubat, "Learning in the Presence of Concept Drift", *Machine Learning* 1996 |
| Glanceable / ambient display ("Watch surface" remains as the *specific affordance* name) | calm-technology display | Card & Mackinlay 1999; Weiser & Brown, "Calm Technology" 1995 |
| Scheduler iteration ("tick" is acceptable shorthand — already a real-time-systems term) | control-loop period | Liu, *Real-Time Systems* (2000) |
| Lease ("claim" remains in the tasks.md spec as the verb; the underlying mechanism is a lease) | mutual exclusion with timeout | Gray & Cheriton, "Leases", *SOSP* 1989 |
| Handoff (industry-standard in agentic systems; Anthropic Agent Teams uses it explicitly) | actor message-passing with continuation | Hewitt, Bishop, Steiger 1973 |
| Specialist agent / persona | role-based agent | Wooldridge 2009 |
| Society of minds | (primary literature term) | Marvin Minsky, *The Society of Mind* (1986) |
| Strange loop | (primary literature term) | Hofstadter, *Gödel, Escher, Bach* (1979) |
| Watchdog (in `claude-budget-guard`) | (already a precise CS term) | Watchdog timer, hardware / OS literature |
| Inner loop / outer loop | (already precise) | Optimization & control systems |
| Bottleneck | (already precise) | Goldratt TOC (cited above) |
| Error budget | (already precise) | Beyer et al., *Site Reliability Engineering* (Google, 2016) |
| Failure-mode response: `loud-crash-supervisor-restart` / `circuit-break-and-notify` / `graceful-degrade` | (labels for established patterns) | Armstrong, *Programming Erlang* 2007 (let-it-crash); Nygard, *Release It!* 2007 (circuit breaker); AWS Well-Architected, Reliability pillar (graceful degradation) |
| Fault axis | (chaos-engineering term) | Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016 |
| Steady-state hypothesis | (chaos-engineering term) | Basiri et al. 2016 (above) |
| Blast radius | (established term) | AWS Well-Architected, Reliability pillar; Beyer et al., *SRE* Ch. 17 2016 |
| Operator escape hatch / kill switch | (established term) | Beyer et al., *SRE* Ch. 17 2016 |

### Retired terms (do not use in new prose)

These coined terms appeared in earlier drafts. Use the canonical term in the right column instead. New PRs that re-introduce a retired term are flagged in review.

| Retired | Use instead |
|---|---|
| CTO loop / CTO meta-loop | MAPE-K loop (and *autonomic manager* for the component) |
| TPM (technical-program-manager agent) | manager agent |
| Constitutional review | runtime specification monitoring (or just *spec-monitor* / `claude-spec-monitor`) |
| Drift (standalone) | specification drift (system behavior) or concept drift (data) |

When you introduce a new word in any Minsky doc, **add a row to the in-use table in the same commit** — or, preferably, remove the new word and use an existing row's right-column term.

## What Minsky is not

- Not an IDE plugin
- Not a multi-agent framework — use OMC
- Not a task queue — use tasks.md
- Not a CLI dashboard — use claude-dashboard
- Not a token monitor — use Claude-Code-Usage-Monitor
- Not a mobile app — use Tailscale + claude-code-monitor + ntfy + Apple Shortcuts
- Not a session tool — sessions are an implementation detail; viability is the point
- Not a productivity tool — productivity tools die when you stop maintaining them; viable systems maintain themselves
- Not a vehicle for quick small fixes. Minsky is a long-tail investment in a cybernetic system that runs for years; every change carries the full pre-registered hypothesis-driven contract per rule #9 (hypothesis, success, pivot, measurement, anchor). One-off bugfixes that don't justify that overhead probably belong in another repo. If a change is genuinely too small for HDD discipline, it is too small for Minsky.

## Success criteria

These metrics are tracked on the dashboard from day one. Each has a corresponding integration test in `user-stories/`. Targets are starting points; the MAPE-K loop adjusts them based on observed reality.

Per constitutional rule #9, every row carries a **success threshold**, a **pivot threshold** (below which the *approach* is reconsidered), and a **measurement method** that is an exact runnable command — reproducible by an outside observer with no manual steps. Where the prerequisite system isn't built yet, the command names the future query and tags it `<TBD-AFTER: <task-id>>` linking to the task that lands it.

| # | Metric | Success threshold | Pivot threshold | Measurement method (automated) | Literature anchor |
|---|--------|-------------------|-----------------|-------------------------------|-------------------|
| 1 | Loop uptime, 30 / 90 / 365 d | 99 % / 97 % / 95 % | <90 % over 30 d → reconsider supervisor design | `systemctl --user is-active minsky-tick-loop && journalctl --user -u minsky-tick-loop --since="30 days ago" -o json \| node scripts/uptime.mjs` ⟨TBD-AFTER: supervisor-setup⟩ | Beyer et al., *SRE* 2016, Ch. 4 (SLI / SLO) |
| 2 | Tokens per closed user-story | Decreasing trend month-over-month (≥5 % MoM) | Flat or rising for 3 consecutive months → MAPE-K loop isn't helping; pivot the autonomic manager | OTEL trace query: `sum(token_count{event="user_story.complete"}[30d]) / count(span{name="user_story.complete"}[30d])` ⟨TBD-AFTER: observability-adapter-v0⟩ | Goldratt TOC (improving the constraint should move this metric) |
| 3 | Specification alignment | ≥95 % of spec-monitor runs find no specification drift | <85 % over 7 d → spec is wrong OR system is misaligned; trigger spec audit | `claude-spec-monitor --report --json \| jq '.passed / .total'` ⟨TBD-AFTER: spec-monitor-skill⟩ | Havelund & Goldberg, "Verify Your Runs", *VSTTE* 2008 |
| 4 | Self-improvement velocity | ≥4 prompt rollouts / month with sustained gain (≥10 %, p < 0.05, 7 d post-rollout) after Q1 | <2 / month sustained 3 months → MAPE-K design or DSPy choice is wrong; pivot | `git log --grep='mape-k rollout' constraints.md --since="30 days ago" \| wc -l` plus DSPy A/B export ⟨TBD-AFTER: mape-k-loop-v0⟩ | Khattab DSPy 2023; Kohavi *Trustworthy* 2020 (statistical rigour) |
| 5 | Mean time to recovery (MTTR) | <5 min p95 from process death to next claim | p95 >10 min sustained 7 d → supervisor backoff or claim-resume is wrong | OTEL: `histogram_quantile(0.95, supervisor_restart_to_claim_latency_seconds[7d])` ⟨TBD-AFTER: observability-adapter-v0⟩ | Forsgren et al., *Accelerate* 2018 (DORA MTTR) |
| 6 | Wrist dwell (inverted) | ≤60 s / day | >120 s / day for 14 d → surface is too informative or system is too unhealthy; redesign | `count(http_get_total{path="/watch.json"}[1d]) * estimated_dwell_seconds_per_request` (constant ≈ 2 s) ⟨TBD-AFTER: dashboard-web-v0⟩ | Card & Mackinlay 1999; Weiser & Brown 1995 (calm tech: dwell as friction) |
| 7 | Extraction count | ≥4 OSS repos extracted by month 6 | <2 by month 4 → re-evaluate extraction policy / scope | `gh repo list fyodoriv --json name,createdAt,description --jq '[.[] \| select(.description \| test("@minsky\|claude-")) ] \| length'` | rule #1 (don't reinvent the wheel) — extraction is the operationalisation |
| 8 | Dependency interface coverage | 100 % of named deps behind adapter | ≥1 unhidden dep persisting >1 sprint → fix with adapter wrap or task | `node scripts/check-rule-2-dep-coverage.mjs` (greps `novel/**/*.ts` excluding `novel/adapters/**` for vendor imports listed in ARCHITECTURE.md dependency table; exit 1 on any hit) | rule #2 (every dep behind interface) |
| 9 | Token-budget honoring | 0 hard 429 / week sustained 30 d | ≥1 / week sustained 4 weeks → budget-guard logic is broken; pivot | OTEL counter: `sum(rate(claude_code_api_errors_total{status="429"}[7d]))` ⟨TBD-AFTER: observability-adapter-v0 + budget-guard-v0⟩ | Beyer SRE 2016 (error budget) |
| 10 | Task throughput | Sustained tasks / day at observed budget (≥1 / day at green budget) | <1 / day for 14 d at green budget → bottleneck elsewhere; analyse via TOC | `git log --since="30 days ago" --oneline --grep='^feat\|^fix\|^docs\|^chore' \| wc -l` divided by 30 (close-task removal commits) | Goldratt TOC (throughput as the goal of any system) |

Tooling note: GrowthBook (open-source feature flags + A/B testing, MIT) is the planned `Experiment` adapter for system-level rollouts behind these metrics; see `research.md` § "Hypothesis-driven development tooling".

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
