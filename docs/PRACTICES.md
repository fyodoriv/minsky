# Scientifically proven practices

One-page index of the software-engineering practices Minsky applies today, the academic source behind each, and the exact place in this repo where the practice ships.

Every row is one of two states:

- **Applied** — the practice is enforced today, in CI, by a deterministic linter (per [vision.md rule #10](../vision.md)) or by the running daemon
- **Cited** — the practice informs the design and lives in [vision.md "Theoretical foundations"](../vision.md), but no automated enforcement exists yet

The README's tier-1 paragraph names the 5 most load-bearing ones (TDD, MAPE-K, hypothesis-driven development, let-it-crash supervision, error budgets). The full list is below.

## Applied today

### Test-Driven Development (TDD)

**Citation.** Beck, Kent. *Test-Driven Development: By Example*. Addison-Wesley, 2003. ISBN 978-0321146533.

**Claim.** Every code change starts with a failing test before the implementation. Red → Green → Refactor.

**Where in Minsky.** Constitution [rule #3](../vision.md) ("test-first, metric-first, doc-first"). The `scripts/check-rule-2-dep-coverage.mjs` linter rejects any new `novel/*` source file that lacks a matching `__tests__/` entry; the `scripts/check-rule-3-doc-first.mjs` linter rejects PRs that touch novel code without an accompanying doc change. Worker prompts include the `tdd` skill which enforces Red-Green-Refactor inside the agent loop.

### MAPE-K loop / Autonomic Computing

**Citation.** Kephart, Jeffrey O. & Chess, David M. "The Vision of Autonomic Computing." *IEEE Computer*, 36(1):41–50, 2003. [doi:10.1109/MC.2003.1160055](https://doi.org/10.1109/MC.2003.1160055).

**Claim.** Self-adaptive software is a Monitor → Analyze → Plan → Execute loop sharing a Knowledge base. The reference architecture for systems that manage themselves.

**Where in Minsky.** The tick-loop daemon literally maps to MAPE-K phases:

- **Monitor** — `novel/cross-repo-runner/src/runtime-invariants.ts` checks the actual system state before every iteration
- **Analyze** — `novel/cross-repo-runner/src/task-finder.ts` reads `TASKS.md` and picks the highest-priority task with complete rule-9 fields
- **Plan** — `novel/tick-loop/src/spawn-strategy.ts` decides which agent backend to invoke with what prompt
- **Execute** — `novel/tick-loop/src/daemon.ts` spawns the agent process and waits for the iteration verdict
- **Knowledge** — `.minsky/experiment-store/` (per-host iteration records) + `~/.minsky/config.json` (per-machine config)

### Hypothesis-driven development (pre-registered)

**Citation 1 — pre-registration discipline.** Nosek, Brian A. et al. "The Preregistration Revolution." *PNAS*, 115(11):2600–2606, 2018. [doi:10.1073/pnas.1708274114](https://doi.org/10.1073/pnas.1708274114).

**Citation 2 — Goal-Question-Metric structure.** Basili, Victor R., Caldiera, Gianluigi & Rombach, H. Dieter. "The Goal Question Metric Approach." *Encyclopedia of Software Engineering*, John Wiley, 1994.

**Claim.** Stating a hypothesis, success threshold, pivot threshold, measurement procedure, and literature anchor *before* observing the outcome prevents motivated reasoning and post-hoc rationalisation.

**Where in Minsky.** Constitution [rule #9](../vision.md) (iron rule; no exceptions, including bugfixes). Every P0/P1 task in `TASKS.md` must carry five fields:

```markdown
- [ ] Task description
  - **Hypothesis**: <one-line GQM claim — "doing X causes Y, measured by Z">
  - **Success**: <numeric or rubric threshold>
  - **Pivot**: <threshold at which the approach is abandoned>
  - **Measurement**: <exact runnable shell command>
  - **Anchor**: <Author, Title, Year — Section>
```

Enforced by `scripts/check-rule-9-tasksmd-fields.mjs` as a CI gate; the task picker silently drops tasks missing any field. The PR self-grade (`scripts/check-pr-self-grade.mjs`) evaluates against the *pre-registered* hypothesis, not a retrofitted one.

### Let-it-crash supervision

**Citation.** Armstrong, Joe. *Programming Erlang: Software for a Concurrent World*. Pragmatic Bookshelf, 2007. ISBN 978-1934356005. The pattern that produced decade-uptime telecom systems at Ericsson.

**Claim.** Don't defensively handle every failure. Let processes die. Let a supervisor restart them with policy. Avoids the slow-death-by-corruption that defensive error handling causes.

**Where in Minsky.** Constitution [rule #6](../vision.md) ("stay alive"). Three layers:

1. **Iteration-level** — when an iteration ends in `spawn-failed` or `scope-leak`, the tick-loop logs the verdict and moves to the next task. No exception is propagated.
2. **Daemon-level** — the launchd plist runs with `KeepAlive=true`; if the Node process dies, launchd respawns it within seconds, preserving `.minsky/` state.
3. **Lint-level** — `scripts/check-rule-6-let-it-crash.mjs` rejects PRs that add `try/catch` blocks around code that should be allowed to die (overspecified defensive handling).

### Error budgets

**Citation.** Beyer, Betsy et al. *Site Reliability Engineering: How Google Runs Production Systems*. O'Reilly, 2016. Chapter 3 ("Embracing Risk"). ISBN 978-1491929124.

**Claim.** Quantify acceptable failure as a budget you spend. When you go over budget, you trigger degradation (slow down, defer non-critical work), not panic.

**Where in Minsky.** The daemon caps per-iteration cost via `MINSKY_BUDGET_TOKENS` env var. When an iteration exceeds budget, the tracker records the overrun and the loop continues; it does not halt. Stability % (in the dashboard) is computed from `successful_iterations / total_iterations` — that's the error rate against which the budget is measured.

### OODA loop

**Citation.** Boyd, John R. *A Discourse on Winning and Losing* (lecture notes), 1987. Posthumously published as *Boyd: The Fighter Pilot Who Changed the Art of War* (Coram, 2002).

**Claim.** Observe → Orient → Decide → Act. Faster *correct* OODA wins; orienting on bad data is worse than slower iteration.

**Where in Minsky.** The per-tick decision cycle inside `novel/tick-loop/src/daemon.ts` (one tick = one OODA pass over the current task state). Distinct from the cross-tick MAPE-K outer loop above: MAPE-K is the strategic outer loop; OODA is the tactical inner loop that runs inside each tick.

### PDCA cycle (Plan-Do-Check-Act)

**Citation.** Shewhart, Walter A. *Statistical Method from the Viewpoint of Quality Control*, 1939. Popularised by Deming, W. Edwards. *Out of the Crisis*. MIT Press, 1986. The basis of kaizen and Lean.

**Claim.** Iterative quality improvement = plan a change, do it, check the result, act on what you learned.

**Where in Minsky.** Per-task structure:

- **Plan** — the TASKS.md entry with its Hypothesis + Success fields
- **Do** — the agent's PR
- **Check** — `pre-pr-lint` + tests + the self-grade against the pre-registered hypothesis
- **Act** — merge (if Success threshold met) or rollback + file a follow-up task

### Inverted pyramid (writing)

**Citation.** Williams, Joseph M. & Bizup, Joseph. *Style: Lessons in Clarity and Grace*. 11th edition, Pearson, 2014. Earlier editions trace back to 1981. (Lesson 5 — "Cohesion and Coherence.")

**Claim.** Lead with the conclusion the reader most needs; supporting detail follows in decreasing order of importance.

**Where in Minsky.** README structure and the `reader-priority-docs` skill (local to this repo). Six tiers — tier 1 ("what IS this") is the lede; tier 6 (license, retired terms) is the bottom. Every README section is placed by tier and verified by the skill's checklist before any docs PR.

### Calm Technology / Glanceable Information Display

**Citation.** Weiser, Mark & Brown, John Seely. "The Coming Age of Calm Technology." *Beyond Calculation: The Next Fifty Years of Computing*, Springer, 1997. Also Mark Weiser, "The Computer for the 21st Century," *Scientific American*, 265(3):94–104, 1991.

**Claim.** Information should sit at the periphery; the user pulls focus only when something demands action.

**Where in Minsky.** The `minsky watch` dashboard — three numbers (stability %, iterations, human-help-needed), no chrome. A glance answers "is anything wrong?" without context-switching.

### RED method (service metrics)

**Citation.** Wilkie, Tom. "The RED Method: How to Instrument Your Services." Grafana Labs blog, 2018. Codified the pattern named in Brendan Gregg's USE/RED talks.

**Claim.** Service health = Rate of requests + Errors + Duration.

**Where in Minsky.** Daemon per-iteration metrics in `.minsky/metric-snapshots/`:

- **Rate** — iterations-per-hour
- **Errors** — `spawn-failed` count / `scope-leak` count
- **Duration** — p95 iteration time (also drives the dynamic watchdog timeout via p95 × 1.5)

### Society of Mind (multi-agent intelligence)

**Citation.** Minsky, Marvin. *The Society of Mind*. Simon & Schuster, 1986. ISBN 978-0671657130.

**Claim.** Intelligence emerges from many simple specialised agents working together; none is intelligent alone.

**Where in Minsky.** The tool's namesake. Agents are pluggable (Devin, Claude, Aider, local LLM) and operate on a shared queue (`TASKS.md`) — no agent is privileged, and different tasks naturally route to the agent best suited to them. The plugin architecture is in `novel/tick-loop/src/spawn-strategy.ts`.

### Pattern conformance (named-architecture discipline)

**Citation.** Gamma, Erich, Helm, Richard, Johnson, Ralph & Vlissides, John. *Design Patterns: Elements of Reusable Object-Oriented Software*. Addison-Wesley, 1994. ISBN 978-0201633610. Generalised by Booch, Grady. *Object-Oriented Analysis and Design with Applications*, 1991.

**Claim.** Every architectural choice should map to a named, published pattern. Deviations from the pattern must be declared and justified.

**Where in Minsky.** Constitution [rule #8](../vision.md) (pattern conformance index). The `Pattern conformance index` table in vision.md maps each top-level artifact to its governing pattern. Every PR adding a new top-level artifact must add a row in the same commit; tracked in TASKS.md for full CI enforcement.

### Scope discipline (no scope creep)

**Citation 1.** Fagan, Michael. "Design and Code Inspections to Reduce Errors in Program Development." *IBM Systems Journal*, 15(3):182–211, 1976. The original code-inspection paper that introduced the scoping discipline.

**Citation 2.** Brooks, Frederick P. *The Mythical Man-Month*, 1975 (anniversary ed. 1995). Chapter on "the second-system effect" — scope creep as the most common failure mode.

**Claim.** A unit of work has a declared scope; touching anything outside that scope in the same PR is a defect.

**Where in Minsky.** Constitution [rule #12](../vision.md) (iron rule; no exemption). Enforced by `scripts/check-rule-12-scope-discipline.mjs` — analyses every PR's diff and rejects edits to files outside the task's declared scope.

### Chaos engineering (trust nothing unverified)

**Citation.** Basiri, Ali et al. "Chaos Engineering." *IEEE Software*, 33(3):35–41, 2016. [doi:10.1109/MS.2016.60](https://doi.org/10.1109/MS.2016.60). The Netflix Chaos Monkey paper.

**Claim.** Trust no component whose failure probability is not provably bounded. Until verified, assume it will fail and inject the failure deliberately in test.

**Where in Minsky.** Constitution [rule #7](../vision.md). Every adapter (`novel/cross-repo-runner/src/adapters/*.ts`) has chaos-coverage tests that inject failures — network drops, process crashes, GH 401, missing env vars. Enforced by `scripts/check-rule-7-chaos-coverage.mjs` as a CI gate.

### Proactive healing (observation IS the fix)

**Citation.** Patterson, David A. "Recovery-Oriented Computing: Building Multitier Dependability." *IEEE Computer*, 35(11):74–77, 2002. The recovery-as-feature paper.

**Claim.** When you observe a fixable problem, fix it immediately — don't file a task to look at it later. Observation without action is waste.

**Where in Minsky.** Constitution [rule #17](../vision.md) (iron rule; no exemption). Enforced by `scripts/check-rule-17-proactive-heal.mjs` — flags PRs that observe a problem (via log statement, comment, or scout-task) without ALSO landing a fix in the same diff (or an explicit `Blocked` marker that documents the unblock path).

### Glossary / ubiquitous language

**Citation.** Evans, Eric. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003. ISBN 978-0321125217. The "ubiquitous language" chapter (Part II).

**Claim.** Every domain term has a single canonical name, defined in one place, used identically by code and prose. Synonyms are debt.

**Where in Minsky.** Constitution [rule #5](../vision.md). Backticked terms in `vision.md` must resolve to the Glossary, the Pattern-index, or an allowlist of well-known generic terms. Enforced by `scripts/check-rule-5-glossary-discipline.mjs`.

### Threat-model-as-code (security-by-design)

**Citation.** Shostack, Adam. *Threat Modeling: Designing for Security*. Wiley, 2014. ISBN 978-1118809990. STRIDE methodology (Microsoft, 1999) is the underlying framework.

**Claim.** Every component documents its threat model — what it trusts, what it doesn't, and which threats it mitigates — alongside its code. Security is not a separate review pass.

**Where in Minsky.** Every `novel/*` package has a `THREAT-MODEL.md`. Enforced by `scripts/run-pre-pr-lint-stack.mjs` (the `threat-model-section` check) which rejects packages missing the section, and by `scripts/check-pr-security-review.mjs` which gates PRs touching security-sensitive paths.

## Cited but not yet enforced

These shape the design but don't have a deterministic linter yet. They live in [vision.md "Theoretical foundations"](../vision.md) and are listed here for honest tracking — adding an enforcement linter for any one of them is good first-PR material.

| Practice | Citation | Status |
| --- | --- | --- |
| Viable System Model | Beer, Stafford. *Brain of the Firm*, 1972. | Informs the layering plan; no enforcement linter. |
| Actor model | Hewitt, Carl. "A Universal Modular ACTOR Formalism for Artificial Intelligence." IJCAI, 1973. | Persona handoffs are queue-based but not formally actor-typed. |
| Theory of Constraints | Goldratt, Eliyahu M. *The Goal*, 1984. | Used in roadmap reasoning; no automated bottleneck detector. |
| Belief-Desire-Intention | Bratman, Michael. *Intention, Plans, and Practical Reason*. Harvard University Press, 1987. | Persona file structure aspires to BDI; not formally encoded. |
| Blackboard architecture | Hayes-Roth, Barbara. "A Blackboard Architecture for Control." *Artificial Intelligence*, 26(3):251–321, 1985. | TASKS.md + handoff files approximate this; controller is informal. |
| Autopoiesis | Maturana, Humberto R. & Varela, Francisco J. *Autopoiesis and Cognition*, 1980. | Long-term ambition; self-maintaining personas not yet shipped. |
| Strange loops | Hofstadter, Douglas R. *Gödel, Escher, Bach*, 1979. | The CTO audit self-reviews daemon output; not a closed loop yet. |
| DSPy ("programming, not prompting") | Khattab, Omar et al. *DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines*. Stanford NLP, 2023. [arXiv:2310.03714](https://arxiv.org/abs/2310.03714). | Persona prompts are hand-tuned; metric-driven optimization roadmapped. |
| Runtime verification | Havelund, Klaus & Goldberg, Allen. "Verify Your Runs." *VSTTE*, 2008. | Runtime invariants exist (`novel/cross-repo-runner/src/runtime-invariants.ts`); formal spec language not yet adopted. |
| USE method | Gregg, Brendan. "The USE Method." 2012. | Daemon doesn't yet publish Utilization / Saturation / Errors for its host resources. |

## How to add a new practice

If you want Minsky to enforce a new published practice:

1. Pick a citation that is **named, indexed (DOI / ISBN), and has been peer-reviewed or industry-validated**. Pattern, paper, or canonical book — not a blog post by an anonymous author.
2. Add a row in [`vision.md`](../vision.md) "Theoretical foundations" explaining the mapping from the published claim to the Minsky surface.
3. Write a deterministic linter ([rule #10](../vision.md) — every rule is a CI lint, not a hope) that catches violations. Place it at `scripts/check-<descriptive-name>.mjs` with a sibling `.test.mjs`.
4. Wire the linter into `scripts/run-pre-pr-lint-stack.mjs` so it runs on every PR.
5. Move the row from "Cited" to "Applied" above, citing the linter file path.

A practice that has no enforcement linter stays in the "Cited" table — that's the honest marker that the discipline isn't yet automated. Cited is not pejorative; the work is to move rows up.

## Reading next

- [`vision.md`](../vision.md) — the full constitution (17 rules) and the Theoretical foundations section
- [`README.md`](../README.md) — operator-facing summary
- [`MILESTONES.md`](../MILESTONES.md) — the roadmap with M1–M5 exit criteria
