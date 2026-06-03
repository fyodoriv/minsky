# Research

> Living scan of the tools Minsky depends on, the tools we've considered, and the tools we should keep watching.

## What this file is

The operational substrate for constitutional rule #1 (*don't reinvent the wheel*). Every novel package in `novel/*` traces back to a row or subsection here that documents the existing tool that was considered, why it didn't fit, and what we built instead. The file is read by [`scripts/check-rule-1-novel-justification.mjs`](./scripts/check-rule-1-novel-justification.mjs) on every PR that adds a `novel/` directory — the script requires either a research.md justification or an opt-out comment in the package README.

**Quarterly cadence**: every entry is reviewed; choices are reconsidered; replacements are scanned. The most recent review log is at the end of this file under `## Quarterly review log`.

## What this file is not

- **Not the constitution** — see [vision.md](./vision.md) for the 17 non-negotiable rules.
- **Not the architecture doc** — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the layered model + dependency table (the dependency table is the canonical surface; this file is the *exploration log* behind it).
- **Not a practices index** — see [docs/PRACTICES.md](./docs/PRACTICES.md) for software-engineering practices Minsky applies.
- **Not a competitor analysis** — see [competitors/](./competitors/) for the head-to-head profiles.

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

## MAPE-K cadence

The autonomic manager (`claude-mape-k-loop`, Kephart & Chess 2003 reference architecture) needs a *control-loop period*: how often it runs Monitor → Analyze → Plan → Execute over its Knowledge store. Liu (*Real-Time Systems*, Prentice Hall 2000, ch. 6) frames the choice as a sampling-period selection problem: too short and the controller starves the underlying system of cycles (and, in our case, tokens); too long and disturbances persist for multiple periods before the controller reacts. The right period is the *coarsest* period that still meets the worst-case detection deadline.

This section enumerates four candidate cadences, picks one, and records the rejected alternatives so a future quarterly review (per rule #1) can revisit cleanly.

### Constraints (from `vision.md` and `TASKS.md`)

1. **Token-cost ceiling.** `mape-k-loop` itself must consume <5 % of weekly Claude Code Max5 budget. *This 5 % is a starting estimate, not a measured constant; the autonomic manager adjusts it monthly per `vision.md` § "Success criteria" #4 (self-improvement velocity) and the adaptive-homeostasis pattern in `ARCHITECTURE.md` § "Token economy" (the same 30 %-of-peak figure is itself adaptive).* The 5 % framing follows Google SRE error-budget discipline (Beyer et al. 2016): the controller is overhead; overhead's share of the budget is bounded.
2. **Drift-detection deadline.** Specification drift surfaced by `spec-monitor` must be acted on within 2 scheduler iterations of detection. This is the worst-case latency Liu 2000 calls the *response time*; we set it at 2 to give one iteration for Analyze + Plan and one for Execute, matching MAPE-K's natural pipeline depth (Kephart & Chess 2003).
3. **No starvation of the inner loop.** The tick loop, `budget-guard`, and `dashboard-web` are higher-priority processes (see `ARCHITECTURE.md` § "Process supervision tree"). The MAPE-K cadence must not preempt them — it runs *between* ticks, never *during*.
4. **Token-cache friendliness.** Anthropic's prompt cache has a 5-minute TTL; running the loop more often than every ~4 minutes wastes the cache window without amortising it. Running less than once per cache window is fine. (This is a property of the Claude API, not Liu 2000, but it constrains the lower bound of any time-based cadence.)

### Candidate cadences

#### A. Pure time-based (fixed period)

The classical Liu 2000 control loop: wake every T minutes, run a full MAPE pass, sleep. T is tuned offline.

- **Pros:** Predictable token spend (it's `tokens_per_pass × (week / T)`); easy to budget; matches the `cron` primitive already used by `mape-k-loop` (`ARCHITECTURE.md` § "Process supervision tree" lists `mape-k-loop` as cron-triggered).
- **Cons:** Either over- or under-samples: a fixed T tuned for the average disturbance rate is wrong for every actual disturbance. Drift that lands one minute *after* a tick waits the full T to be analysed — fails constraint 2 if T > drift-deadline ÷ 2.
- **Token math (estimate, to be replaced by measured value once `mape-k-loop-v0` ships):** at T = 6 h, the loop runs 28× / week. If each pass costs ≤ 1 % of the weekly budget — *itself a starting estimate, calibrated against the success-criterion #4 measurement command in `vision.md`* — total spend is ≤ 28 %. Way over the 5 % ceiling. To hit the ceiling at this per-pass cost, T ≥ 33 h. At T = 33 h drift-detection latency is up to 33 h × 2 = 66 h — far over the deadline. Pure time-based fails the joint constraint.
- **Rejected.** Fails constraint 1 OR constraint 2; cannot satisfy both simultaneously.

#### B. Pure scheduler-iteration-based (every Nth tick)

Run the full MAPE pass every N ticks of the inner tick-loop. N is tuned offline.

- **Pros:** Couples controller frequency to system *activity* (a quiet system needs less analysis); inherits the tick loop's supervision (no separate cron entry); zero clock drift.
- **Cons:** Activity is the wrong proxy for disturbance rate. A system that is quiet because it's *broken* (no ticks claiming work) gets *less* analysis exactly when it needs more. The Goldratt TOC (1984) framing makes this explicit: when the constraint is "the system stopped producing", a controller that samples *throughput* misses it by construction. Also: tick frequency depends on the workload, so the actual time between MAPE passes is non-stationary — defeats Liu 2000's analysis.
- **Rejected.** Fails constraint 2 in the worst case (a stalled tick-loop yields zero MAPE-K analysis), and breaks the SRE error-budget framing where overhead spend should be predictable.

#### C. Pure event-triggered

Run only when an event fires: spec-monitor flags drift, `budget-guard` crosses a threshold, a tick fails an acceptance check.

- **Pros:** Maximum efficiency — zero overhead when nothing is wrong; matches Astrom & Wittenmark's *event-based control* literature (1997, *Computer-Controlled Systems*, ch. 11) where samples are triggered by error magnitude crossing a band rather than a clock.
- **Cons:** Pure event-triggered control is unstable for *unobserved* disturbances. If `spec-monitor` itself starts under-reporting drift (a calibration failure of the detector), the loop never wakes — the system silently degrades with no controller running. Astrom 1997 § 11.3 names this hazard explicitly: event-based control needs a heartbeat ("watchdog") to bound the silent-failure window. Also, "drift detected by spec-monitor" is not the only signal we care about — sustained-gain trends across the rule-#9 weekly–monthly windows (`vision.md` § Success criteria #4) are slow signals that no single event fires for.
- **Rejected as sole mechanism.** Useful as an *override* on top of a periodic cadence — see option D.

#### D. Hybrid: time-based default + event-triggered overrides + tick-iteration *backstop* (CHOSEN)

Three priorities, evaluated in order:

1. **Event-triggered (highest priority).** When `spec-monitor` reports `passed/total < 0.85` over a rolling 1-hour window (the pivot threshold from `vision.md` § Success criteria #3), or when `budget-guard` enters the 85 %-of-5h-window state (the `circuit-break-and-notify` threshold from `ARCHITECTURE.md` § "Token economy"), the MAPE-K loop wakes within one tick — the supervisor delivers a `SIGUSR1` to the cron-launched `mape-k-loop` process, which is otherwise sleeping.
2. **Time-based (default).** Every 12 hours, fire a full MAPE pass regardless of events. This is the Astrom 1997 watchdog: it bounds the silent-failure window of the event-triggered layer. Twelve hours is the *coarsest* period that still satisfies constraint 2 *given* the event-triggered layer (the event layer covers fast disturbances; the watchdog covers slow ones — sustained-gain trends, calibration drift in spec-monitor itself).
3. **Tick-iteration backstop (lowest priority).** Every 1000 successful ticks (a soft floor; configurable in `config/mape-k.json`), force a pass even if the time-based timer hasn't fired. Catches the corner case where wall-clock has stopped advancing relative to system activity (e.g., the system is on a high-throughput run after a dormant period and 12 h of activity has been compressed into 30 min — Liu 2000 § 6.4 calls this "non-uniform sampling", and recommends an activity-coupled bound).

**Token math (estimate; the autonomic manager calibrates it monthly per success-criterion #4):**

- Time-based watchdog at T = 12 h: 14× / week. Per-pass cost is *estimated* at ≤ 0.3 % of weekly budget (because most passes are no-op — Monitor + Analyze emit OTEL spans then exit when nothing actionable surfaces). Watchdog spend ≤ 4.2 %.
- Event-triggered passes: estimated 0–3 / week in steady state (we expect drift to be rare; rule #9 tightens the spec until it is). Per-pass cost ≤ 0.5 % (a real Plan + Execute cycle is heavier than a watchdog no-op). Event spend ≤ 1.5 %.
- Tick-iteration backstop: at 1 task / day (success criterion #10 floor) the 1000-tick condition fires roughly once per quarter — negligible.
- **Total estimated spend: ≤ 5.7 %.** This *barely* exceeds the 5 % ceiling, which is why both numbers are starting estimates: if measured spend stabilises above 5 %, the watchdog T extends to 18 h, and `mape-k-loop` itself logs the adjustment to `constraints.md` per its Knowledge phase. If measured spend exceeds 8 % for 4 weeks, the pivot in `mape-k-cadence`'s rule-#9 block fires — the cadence design itself is wrong.
- **Drift-detection latency:** event-triggered layer wakes within 1 tick (~5 min p95, matching success criterion #5 MTTR); worst case for unobserved disturbances is the watchdog T = 12 h. 12 h ÷ tick-period (estimated 5 min) ≫ 2 scheduler iterations, so we measure "iterations" as MAPE-K iterations, not tick iterations: drift surfaces within at most 2 watchdog passes (24 h) for slow signals, and within 1 event-triggered pass (~5 min) for fast signals. **Constraint 2 met under the iteration-based interpretation that the rule-#9 block specifies.**

**Why this priority order:** event > time > tick mirrors interrupt-priority discipline in real-time OS design (Liu 2000 § 4.2 — fixed-priority preemptive scheduling). High-frequency, high-importance signals (spec-monitor red, budget-guard red) preempt; the watchdog is the deadline-monotonic floor; the tick-iteration backstop is the activity-coupled safety net.

**Anchors:**

- Liu 2000 (sampling-period selection; fixed-priority scheduling)
- Kephart & Chess 2003 (MAPE-K reference architecture; the loop is what we're scheduling)
- Astrom & Wittenmark 1997 § 11 (event-based control + watchdog hybrid)
- Goldratt TOC 1984 (constraint detection by direct measurement, not throughput proxies — supports rejecting option B)
- Beyer et al. 2016 (SRE error budget — the 5 %-of-weekly framing)
- Munafò et al. 2017 (rule #9: every threshold above is pre-registered as an estimate, not a constant)

### Open question for the next cadence review

Once `mape-k-loop-v0` ships and we have a month of measured per-pass cost, replace every "*estimate*" annotation above with the observed value. If the watchdog T = 12 h proves the wrong order of magnitude (off by ≥ 2×), file a follow-up research task; per rule-#9's pivot clause for `mape-k-cadence`, an inability to satisfy both constraints simultaneously means the MAPE-K design itself is wrong, not just the cadence.

## Lighter OTEL backend

Resolves task `otel-lite-backend`. The current `Observability` row above ships against Loki + Tempo + Prometheus + Grafana — four services for a single-developer install. The brief: evaluate whether a *lighter* OTEL-compatible backend can satisfy `vision.md` § "Success criteria" rows 2, 5, 9 (the rows whose `Measurement method` cells encode OTEL-PromQL queries) at on-disk footprint <1 GB / month and install ≤3 commands, and recommend one.

### Constraints (operational, derived from `vision.md` § "Success criteria")

The backend must answer the following query shapes (paraphrased from rows 2, 5, 9 above):

1. **Trace-derived rate over a histogram** — `sum(token_count{event="user_story.complete"}[30d]) / count(span{name="user_story.complete"}[30d])` (success #2).
2. **Histogram quantile over a counter** — `histogram_quantile(0.95, supervisor_restart_to_claim_latency_seconds[7d])` (success #5).
3. **Counter rate over a labelled metric** — `sum(rate(claude_code_api_errors_total{status="429"}[7d]))` (success #9).

Disk-footprint ceiling: **<1 GB / month** at the v0 emission rate (one tick-loop instance, ≤10 spans / s steady state — a starting estimate; revisited monthly per success-criterion #4). Install ceiling: **≤3 commands** from a clean machine to a queryable backend.

### Candidates evaluated

Sources: vendor README at the repo root of each project (primary). No blog-post citations per rule #5/#8.

| Backend | Disk/month | Install steps | Query |
|---|---|---|---|
| **SigNoz (single-binary)** [github.com/SigNoz/signoz](https://github.com/SigNoz/signoz) | ~3–6 GB at default retention (ClickHouse, 15-day default; configurable down to 7 d → ~1.5 GB; below 1 GB requires retention <5 d, cutting success-#2's 30-d window) | 3 (`docker compose -f deploy/docker/clickhouse-setup/docker-compose.yaml up -d` is one command but compose pulls 6+ images; the "single binary" referenced in the README is SigNoz collector only — the storage tier is still ClickHouse) | PromQL (metrics) + ClickHouse SQL (traces, logs); supports all three query shapes |
| **Uptrace (PostgreSQL backend)** [github.com/uptrace/uptrace](https://github.com/uptrace/uptrace) | ~2–4 GB / mo at v0 rate; PostgreSQL backend honours `--retention=7d` cleanly. ClickHouse backend matches SigNoz. | 3 (`docker compose up`, with bundled `postgres` + `uptrace` services; PG mode is a one-flag switch in `config/uptrace.yml`) | UQL (Uptrace Query Language, PromQL-like) + SQL escape hatch; supports all three query shapes per the README's "metrics queries" section |
| **OpenObserve** [github.com/openobservehq/openobserve](https://github.com/openobservehq/openobserve) | ~250–800 MB / mo (parquet-on-disk with native compression; the README's "140× cheaper than Elasticsearch" claim derives from this columnar format). Single-binary mode writes to local disk; S3 is optional. | 2 (`curl -L https://github.com/openobservehq/openobserve/releases/...; ./openobserve` — one binary, no DB) | PromQL (metrics) + SQL (logs, traces) + a Lucene-style filter; supports all three query shapes |
| **VictoriaMetrics + VictoriaLogs + VictoriaTraces** [github.com/VictoriaMetrics/VictoriaMetrics](https://github.com/VictoriaMetrics/VictoriaMetrics) | ~400 MB–1 GB / mo combined (VM is widely benchmarked as the densest TSDB on disk; VictoriaLogs ships the same columnar trick; VictoriaTraces is in beta as of 2026-Q2 per upstream) | 3 (one binary per signal — `victoria-metrics-prod`, `victoria-logs-prod`, `victoria-traces-prod`; or one `vmsingle` for metrics-only) | MetricsQL (PromQL-superset) + LogsQL + TraceQL-equivalent; supports all three query shapes |
| **Jaeger + Prometheus** (the OSS-triad baseline) [github.com/jaegertracing/jaeger](https://github.com/jaegertracing/jaeger) | ~1.5–3 GB / mo (Jaeger Badger / ES + Prometheus TSDB); no native log store — logs go elsewhere (Loki / file) | 4+ (Jaeger collector + Jaeger query + Prometheus + storage backend; the README's all-in-one is for *demo only* per its own warning) | PromQL (metrics) + Jaeger search DSL (traces); **logs not covered** — fails query-shape #1 unless paired with a log store |

### SQLite-backed bespoke

A custom `@opentelemetry/exporter-sqlite` adapter is *theoretically* the smallest possible backend (a single file on disk, queryable with `sqlite3` shell). The OpenTelemetry SDK does not ship one; the closest upstream artifacts are `@opentelemetry/exporter-trace-otlp-http` plus a community-maintained SQLite log exporter that doesn't cover metrics or traces in v0.

- **Disk/month**: estimated <500 MB (SQLite's row-format is heavier than columnar parquet, but at v0 emission rate the absolute number stays small).
- **Install steps**: 1 (the npm package, once written).
- **Query**: SQL only; no PromQL surface — every success-criterion query above has to be re-expressed as SQL window functions. Query-shape #2 (histogram quantile) is non-trivial in SQLite (requires a UDF or repeated `percentile_cont`-style CTE) and query-shape #3 (counter rate) needs a self-join across timestamps.
- **Risk**: ships zero existing code; *significant* integration cost (estimate: 2–3 weeks); no dashboard surface.
- **Verdict**: the smallest possible footprint, but the largest implementation cost. Not viable for v0.

### Recommendation

**Choose OpenObserve for v0; revisit if/when the v0 emission rate exceeds 100 spans / s sustained or the parquet on-disk format proves brittle in a chaos-restart scenario.** The trade-off: OpenObserve gives the smallest disk footprint *and* the simplest install (one binary, two commands) *and* satisfies all three query-shape constraints, at the cost of a less-mature dashboard ecosystem than Grafana — acceptable since `dashboard-web-v0` (TASKS.md P2) renders the success metrics directly from the backend rather than via Grafana panels.

VictoriaMetrics's three-binary triad is the close runner-up; if a future pivot away from OpenObserve fires, VM is the first port of call (one vendor, one disk format, MetricsQL is a near-superset of PromQL — the migration cost is low).

The SQLite-bespoke path is rejected on integration cost; a dedicated `otel-sqlite-backend-impl` task is *not* filed because the recommended path (OpenObserve) clears the constraints. If OpenObserve fails the chaos verification on restart-time-to-readiness within the next quarterly review, the SQLite path may be reconsidered then.

The current dependency-table row above (`Observability`) keeps Loki+Tempo+Prometheus+Grafana as the *documented current state* until `observability-adapter-v0` ships against the lighter backend — the row will move once the swap lands. No follow-up `otel-signal-volume-reduction` task is filed, since at least one candidate (OpenObserve) cleanly satisfies the constraints.

**Anchors:** OpenTelemetry specification (CNCF 2020+); Gregg, *Systems Performance*, 2014 (USE method as the lens for what a backend must support); rule #1 (don't reinvent — pick the existing tool first; SQLite-bespoke is rejected on this ground).

## Multi-machine scope

Minsky v0 is single-developer-machine by design (`ARCHITECTURE.md` § "Open questions to resolve before implementation" #4; `vision.md` row 17 — `setup.sh` ledger explicitly defers durability across machine death). This section enumerates the deltas that change when the substrate moves from one developer's laptop to a multi-machine / team setup. Scope is "what would have to change", not "how to build it" — the design space stays open until single-machine MAPE-K (`mape-k-loop-v0`) reaches steady state and the metrics that would justify multi-machine work exist.

### State synchronization

`TASKS.md` is the canonical work-queue, edited in-place and committed to git. The claim convention `(@agent-id)` (vision.md row 21) is a *local* lease: the file is mutated, the next git commit serialises the mutation, and concurrent edits surface as merge conflicts that a human resolves. On a single machine the implicit serialiser is the local filesystem plus the developer's editor — two agents on the same machine race through the file lock; the loser retries. Across machines this disappears: two agents on different hosts can each pull, claim the same task, and push — git's last-writer-wins rebase semantics produce a malformed `TASKS.md` rather than a queue with one winner. The lease becomes a distributed-mutex problem; the canonical state becomes a replicated log. What changes: the queue needs an external arbiter (a coordination service holding the lease, e.g. CRDT-backed log, etcd, or a single writer behind a queue) or the `TASKS.md` file format needs causal-history metadata so concurrent claims commute. Either path replaces "git is the database" with "git is one replica of the database".

- **Current single-machine assumption broken:** the local filesystem + git commit serialise all writes to `TASKS.md`; conflicts are rare and human-resolvable.
- **Anchor:** Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System", *CACM* 1978 (causal ordering as the precondition for any consistent replicated log); Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (eventual consistency + immutable activity records as the realistic substrate when ACID is unavailable).

### Identity

Agent identifiers today are local strings: `@architect`, `@executor`, `@qa-tester` etc., minted by OMC inside one process tree, stable only within a single host. The `(@agent-id)` claim in `TASKS.md` is unique because there is exactly one OMC instance writing to that file. Across machines the namespace collides: two laptops both run `@executor`, both claim the same task, and the file records `(@executor)` twice with no way to tell which host's executor is which. Identity must become globally-unique and verifiable: a `host:agent` tuple at minimum, an asymmetric-key-signed claim at maximum (so that a malicious or compromised host cannot forge another host's claims in the shared log). The `RoamCoordinator` that scans `~/apps/*/TASKS.md` across repos is single-host today; multi-machine roaming compounds the identity problem because the `(@agent-id)` strings appear in every repo's queue without cross-repo collision avoidance. What changes: identifier minting moves from "any string OMC happens to use" to "a structured, machine-scoped, collision-free name", with the binding (which host is `host-A`) recorded somewhere outside any individual `TASKS.md`.

- **Current single-machine assumption broken:** the OMC orchestrator is the sole minter of agent IDs within one process tree; uniqueness is a side-effect of there being one tree.
- **Anchor:** Saltzer & Kaashoek, *Principles of Computer System Design*, 2009, ch. 2-3 (naming systems: binding, scope, collision avoidance); Lampson, "Designing a Global Name Service", *PODC* 1986.

### Supervision

Process supervision today is systemd (Linux) / launchd (macOS) — built into the OS, restarting the local tick loop, `budget-guard`, `mape-k-loop`, `dashboard-web` if any of them die (`ARCHITECTURE.md` § "Process supervision tree"). The supervisor's authority ends at the host boundary: if the laptop is closed, runs out of battery, or panics, every supervised process stops and there is nothing to restart them. On a single dev machine that is acceptable — the developer is the operator and reopens the lid. In a multi-machine team setup the workload is expected to make progress while any one host is down; that requires cross-host failover. What changes: the supervision tree (Armstrong's let-it-crash with hierarchical restart) extends one level — a *cluster supervisor* that watches the host-level supervisors and re-schedules their workloads onto surviving hosts when one dies. This is the gap between Erlang/OTP's local supervisor and Birman's process-group membership service: detecting host death (vs. process death) requires a failure-detector with bounded false-positive rate, plus a way to fence the suspected-dead host so it cannot resurrect and double-execute work after its claims have been reassigned.

- **Current single-machine assumption broken:** systemd / launchd is the entire supervision tree; "the host died" is treated as "the developer is unavailable", not as a failure to recover from.
- **Anchor:** Armstrong, *Making reliable distributed systems in the presence of software errors*, PhD thesis, KTH 2003 (let-it-crash; supervision trees in OTP); Birman, *Building Secure and Reliable Network Applications*, 1996, ch. 13-14 (process groups; failure detectors; virtual synchrony).

### Blast radius scaling

Constitutional rule #7 caps blast radius explicitly: "single tick / single user-story / single dependency / whole system" (`vision.md` line 85). On a single dev machine "whole system" is one host, and the operator-escape-hatch is one kill switch the developer types into one terminal. Chaos tests inject faults locally — kill the supervisor, drop a task, exhaust tokens — and the steady-state hypothesis (Basiri et al. 2016) is restored within the host's recovery SLO. Multi-machine scaling changes the unit of "whole system": a chaos test on host A that exhausts a shared budget, corrupts the shared `TASKS.md` log, or floods the shared notification channel propagates to host B and host C. The operator escape hatch must reach across hosts — one kill switch that fences the misbehaving host — and the blast-radius taxonomy gains a new tier: "single host / single team / whole fleet". Without that tier, every chaos test that was bounded on one machine is unbounded on many; rule #7's pre-condition "explicit upper bound on what one failure can damage" becomes false by default rather than true by default.

- **Current single-machine assumption broken:** "whole system" = one host; the operator escape hatch is one local kill command; shared resources (budget, queue, notifications) have exactly one consumer.
- **Anchor:** Basiri, Behnam, de Rooij, Hochstein, Kosewski, Reynolds, Rosenthal, "Chaos Engineering", *IEEE Software* 2016 (the principles document — "minimize blast radius" is principle #5; the multi-machine version requires the principle to be re-asserted at the fleet tier).

### Time and clocks (optional fifth)

`vision.md` § "Success criteria" rolls metrics over `replay_windows_days` boundaries (rule #9 declares 7-/30-/90-day verification windows). On a single machine the boundary is whatever wall-clock time the host reports — drift is bounded by the host's NTP sync and is uniform across all measurements taken on that host. Across machines drift is no longer uniform: host A's "30-day window" can include events host B has not yet observed, and verdicts disagree depending on which host computes them. The pragmatic fix is logical or hybrid clocks (Lamport 1978, Kulkarni et al. 2014) so that the *order* of `predicted Δ` and `observed Δ` events is consistent even when wall-clock skew is non-trivial; the more conservative fix is a single coordinator that timestamps verdicts. Either way the experiment-store schema (`experiment-store/`) gains a clock-source field so a future quarterly review can audit which verdicts were rendered against which clock.

- **Current single-machine assumption broken:** the host's wall clock defines all rule-#9 measurement windows; there is no other clock to disagree with it.
- **Anchor:** Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System", *CACM* 1978 (logical clocks); Kulkarni, Demirbas, Madeppa, Avva, Leone, "Logical Physical Clocks", *OPODIS* 2014 (HLCs as the practical hybrid).

### Implementation status

v0 is single-machine. Multi-machine work is gated on `mape-k-loop-v0` reaching steady state on a single host first — the metrics that would justify a distributed substrate (sustained tokens-per-story across many hosts, MTTR distributions across host boundaries, throughput against the shared budget) do not exist until the single-machine loop produces a month of stable observations. Revisit this section when those metrics validate. No architectural blocker was surfaced while writing this enumeration: the single-machine assumptions broken above are *boundaries*, not *baked-in invariants* (the queue is a file, not an in-memory data structure; the supervisor is an OS service, not a process-local construct; identity is a string, not a pointer). If a future investigation surfaces an assumption that cannot be relaxed without a rewrite (e.g., process-local in-memory state in a critical path), file a follow-up architecture task per rule #9's pivot clause for `multi-machine` and stop the research.

## DSPy fit

Resolves task `dspy-fit-eval`. The `PromptOptimizer` row below currently names DSPy as Minsky's prompt-A/B optimizer; this section evaluates whether DSPy's `Module` + `Signature` + `Optimize` idiom (Khattab et al. 2023) maps cleanly onto Minsky's `PromptOptimizer` adapter shape (`ARCHITECTURE.md` § "The adapter pattern" — `interface PromptOptimizer { runABTest(variants, metric), … }`) across five canonical Minsky use cases:

1. **Persona prompt tuning** (the Plan phase of `mape-k-loop` proposing variants of an OMC persona prompt).
2. **MAPE-K rollout** (the Execute phase running an A/B test, picking a winner under a sustained-gain check).
3. **Post-hoc fault explanation** (after a failed tick, generate a structured explanation of which constraint failed and why).
4. **Drift-report rephrasing** (the advisory `novel/spec-monitor/` Skill emits a drift report; rephrase for the dashboard surface).
5. **Persona handoff** (`@minsky/handoff-spec` records — fill the bold-labelled fields under a structured signature).

**Pinned version evaluated:** DSPy `3.2.0` (latest stable as of 2026-04-21 per <https://github.com/stanfordnlp/dspy/releases/tag/3.2.0>). Sources are the upstream repository at that tag plus the Khattab et al. 2023 paper. No third-party blog citations per rule #5.

### Wins

1. **Signature-driven prompts replace string templating.** A `dspy.Signature` declares input/output fields with type hints and docstrings; the framework synthesises the user-facing prompt. For Minsky's *persona handoff* use case (`@minsky/handoff-spec` — Status / Summary / Artifacts / Blockers / Suggested-next), the signature shape is a near-1:1 mapping: each handoff field is a typed `dspy.OutputField`, and the signature's docstring is the persona's role description. Code reference: [`dspy/signatures/signature.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/signatures/signature.py) + [`dspy/signatures/field.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/signatures/field.py) define `Signature`, `InputField`, `OutputField`. This is a strict win over raw string templating: the field schema is mechanically inspectable, which the validator in `novel/handoff-spec/src/validate.ts` already wants.

2. **MIPRO v2 + GEPA give a real optimizer over a labelled metric.** For the *persona prompt tuning* use case, DSPy's `MIPROv2` ([`dspy/teleprompt/mipro_optimizer_v2.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/teleprompt/mipro_optimizer_v2.py)) jointly optimises instructions and few-shot demonstrations against a user-supplied metric function — this is the "metric-as-reward" claim in the row above, made concrete. GEPA ([`dspy/teleprompt/gepa/`](https://github.com/stanfordnlp/dspy/tree/3.2.0/dspy/teleprompt/gepa)) extends to genetic-Pareto search. Either is a faithful Execute primitive for `mape-k-loop`'s Plan-then-Execute step, *if* the runtime constraint can be met (see frictions below).

3. **`dspy.Evaluate` is a built-in evaluator harness.** For the *MAPE-K rollout* use case, DSPy ships its own multi-process evaluation runner at [`dspy/evaluate/evaluate.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/evaluate/evaluate.py) plus standard metrics at [`dspy/evaluate/metrics.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/evaluate/metrics.py). This overlaps usefully with Promptfoo (the `Orchestrator` row's eval harness) — wherever the optimizer's metric and the eval harness's metric must be the same function, DSPy's combined surface avoids the dual-source-of-truth hazard.

4. **`dspy.ChainOfThought` as a deterministic structuring step.** For *post-hoc fault explanation* and *drift-report rephrasing*, [`dspy/predict/chain_of_thought.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/predict/chain_of_thought.py) wraps a Signature with a forced "reasoning" field before the answer fields — the structuring discipline matches Minsky's "every drift report has a *why* before the *what*" preference. Cheap composition; no optimizer required to use it.

### Frictions

1. **Python runtime requirement.** DSPy 3.2.0's `pyproject.toml` declares `requires-python = ">=3.10, <3.15"` (verified at <https://github.com/stanfordnlp/dspy/blob/3.2.0/pyproject.toml>). Minsky's runtime is TypeScript / Node + `pnpm` (`package.json`, `pnpm-workspace.yaml`). Adopting DSPy means shipping a Python sidecar that the supervision tree (`ARCHITECTURE.md` § "Process supervision tree") must keep alive alongside the existing Node services — same install-friction class that pushed `MobileDashboard` toward a custom web app, doubled. This is the single largest friction; per task `dspy-fit-eval`'s Pivot clause it alone is sufficient grounds to reject DSPy.

2. **Module / Signature ceremony costs more than it returns for one-shot calls.** For *drift-report rephrasing* and *post-hoc fault explanation*, the call is one-shot — there is no training set, no optimizer, no metric. DSPy's `dspy.Module` (defined at [`dspy/primitives/module.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/primitives/module.py)) and `dspy.Predict` ([`dspy/predict/predict.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/predict/predict.py)) require declaring a class, a Signature, a forward method, and an LM client — for a call shape that's just `prompt → structured response`. Direct Anthropic SDK with a JSON-schema response format (Anthropic Messages API tool-use) is two function arguments. Net: ceremony exceeds value when the optimizer isn't used.

3. **Optimizer assumes a labelled training set.** `MIPROv2.compile(student, trainset=...)` and the bootstrap optimizers ([`dspy/teleprompt/bootstrap.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/teleprompt/bootstrap.py)) all take a `trainset` — labelled `dspy.Example` records, not a stream of live A/B traffic. Minsky's *MAPE-K rollout* use case is on-demand A/B against live traffic with a sustained-gain check (`vision.md` § Success criteria #4), not "compile against a static benchmark and ship the winner". Adapting requires either (a) maintaining a synthetic trainset that drifts from real traffic — a known A/B-trustworthiness hazard (Kohavi/Tang/Xu 2020 ch. 3 on offline-online divergence) — or (b) shoehorning an online loop into a tool whose docs and `mipro_optimizer_v2.py` data flow are batch-shaped. Friction lands directly on the most load-bearing use case.

4. **No first-class Anthropic-Messages cache-prefix discipline.** [`dspy/clients/lm.py`](https://github.com/stanfordnlp/dspy/blob/3.2.0/dspy/clients/lm.py) routes through LiteLLM, which does support Anthropic prompt caching but requires explicit `cache_control` block tagging in the message structure. DSPy's Signature → prompt synthesis owns the message shape; injecting `cache_control` markers on the system-prompt prefix (the Minsky token-economy invariant in `ARCHITECTURE.md` § "Token economy" — *protect the prompt-cache prefix*) requires reaching past Signature into LiteLLM's transport layer. Friction: a budget-relevant invariant that is one line in a direct SDK call becomes a layering concern in DSPy.

5. **Signature mismatch with `@minsky/handoff-spec`'s explicit pushback / suggested-next semantics.** While `Signature` cleanly maps the *fields* of a handoff, the *control-flow* semantics (Suggested-next persona is the actor-model continuation per `vision.md` row #9; Pushback is non-acceptance of the previous handoff) are not naturally a "predict the next field" task. They are decisions whose validity is checked by the validator in `novel/handoff-spec/src/validate.ts`, not learned by an optimizer. Forcing them through a Module makes the validator post-hoc to a generated artifact, inverting the fail-loudly-and-early discipline (rule #6).

### Verdict — friction outnumbers wins; DSPy assumes a Python runtime Minsky won't ship

Friction count is **5**, win count is **4**. The 5:4 ratio is below the 2:1 pivot threshold from the task brief, but the *kind* of friction (#1, the Python runtime) is independently disqualifying per the same brief: **"if frictions outnumber wins ≥2:1 OR DSPy assumes a Python runtime we won't ship, drop DSPy and design a minimal `PromptOptimizer` interface that calls the Anthropic API directly with structured logging."** That clause fires.

Recommendation: **reject DSPy as Minsky's `PromptOptimizer` implementation; ship the fallback below.** The dependency-table row above will be updated when the fallback adapter ships under `mape-k-loop-v0`'s implementation task. The single win that survives unconditionally — Signature-driven typed prompts — is reproducible in TypeScript with Anthropic's tool-use JSON schemas, so the rejection costs no novel capability.

### Fallback `PromptOptimizer` interface

```ts
// novel/adapters/prompt-optimizer.ts
export type Variant = { id: string; system: string; user: string };
export type EvalResult = { variantId: string; score: number; tokens: number; traceId: string };
export type ABResult = { winnerId: string; results: EvalResult[]; sustainedGainAt7d: boolean };

export interface PromptOptimizer {
  /** Run a one-shot A/B over `variants` against `metric`; emits one OTEL span per variant. */
  runABTest(args: {
    variants: Variant[];
    inputs: Array<Record<string, unknown>>;
    metric: (output: string, input: Record<string, unknown>) => Promise<number>;
    sustainedGainWindowDays?: number; // default 7 per vision.md success #4
  }): Promise<ABResult>;

  /** Single structured call with a JSON-schema-typed response; the Signature analogue. */
  structured<T>(args: { system: string; user: string; schema: object }): Promise<T>;

  /** Self-test contract — required of every adapter per ARCHITECTURE.md § Bootstrap step 6. */
  selfTest(): Promise<{ ok: boolean; details: string }>;
}
```

**Why this shape (rule #2 — every dependency behind an interface; `vision.md` § 2):** the adapter pattern (Gamma et al. 1994; `vision.md` § "Pattern conformance index" row 3) requires the interface to be expressible without naming a vendor. DSPy's `dspy.Module` would have leaked its class hierarchy into the interface (any consumer would have to know what a Module is). The two-method shape — `runABTest` for the `mape-k-loop` Execute primitive, `structured` for one-shot calls — covers all five use cases without mentioning Anthropic, OpenAI, or DSPy. Implementations: `prompt-optimizer.anthropic.ts` (default; calls `@anthropic-ai/sdk` directly with `cache_control` on the system-prompt prefix per the token-economy invariant; logs each call as a structured OTEL span carrying `variant_id`, `tokens_in`, `tokens_out`, `score`); a future `prompt-optimizer.dspy.ts` would still be possible if a Python sidecar ever becomes acceptable, but is not the v0 path.

**Anchors:**

- Khattab et al., "DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines", ICLR 2024 (the Module / Signature / Optimize idiom this section evaluates).
- Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994 (Adapter as the shape rule #2 demands).
- Kohavi, Tang, Xu, *Trustworthy Online Controlled Experiments*, Cambridge UP 2020, ch. 3 (offline-online divergence — the friction-3 hazard).
- rule #1 (don't reinvent the wheel — DSPy was the existing-tool candidate; this section is the documented "why not"); rule #2 (every dep behind interface — the fallback interface is the operationalisation).

## Native WatchOS app

Resolves task `native-watchos-app`. The `WatchActions` row below currently names Apple Shortcuts as Minsky's Watch surface; this section evaluates *when* and *how* to escalate to a native WatchOS app, against `vision.md` § "Success criteria" row 6 (`wrist_dwell_seconds_per_day`). Story 005 (`user-stories/005-watch-three-numbers.md`) is the surface specification this section is parametric over.

The framing is rule-#1-first: a native app is the *expensive* option; Apple Shortcuts is the cheap one. The job of this section is to pre-commit the threshold past which "cheap" stops being cheap *enough*, so the decision to go native is deterministic rather than vibes-driven.

### Trigger condition

Escalate to a native WatchOS app **only when** `wrist_dwell_seconds_per_day` exceeds **90 s/day** as a **7-day rolling average**, sustained across **two consecutive 7-day windows** (i.e., 14 consecutive days of >90 s/day average). Below this threshold the Shortcuts-based surface is meeting story 005's calm-tech invariant well enough; above it the surface (or the underlying system) is forcing the user to dwell on the Watch — exactly the failure mode the dwell metric is *inverted* to catch (`vision.md` § "Success criteria" row 6: pivot at >120 s/day for 14 d).

The 90 s/day threshold sits between the success target (≤60 s/day) and the row-6 pivot threshold (>120 s/day) — a deliberate intermediate band. Below 60 s/day the cheap surface is fine; above 120 s/day the surface itself has failed and a redesign (not just a re-platform) is required; between those, a native app is the least-disruptive corrective step that preserves the three-number discipline.

**Queryable as:** `count(http_get_total{path="/watch.json"}[7d]) * 2 > 630` over the OTEL Prometheus surface (one Shortcut HTTP fetch ≈ 2 s of dwell per the row-6 estimator constant; 90 s/day × 7 d = 630 s; the multiplier-2 yields the request-count floor of 316 hits/week). The same query shape appears in `vision.md` § "Success criteria" row 6's measurement cell.

### Pivot conditions on the trigger itself

Per task `native-watchos-app`'s rule-#9 block, the trigger threshold is itself adjustable on two well-defined signals:

- **Lower to 75 s/day if** community boilerplate ships (e.g., a permissively-licensed `swift-package-watch-glance` template covering complications + App Intents) AND the wrist-dwell metric is borderline (sustained 75–90 s/day for 14 d). The "going native is materially cheaper than estimated" branch from the task brief.
- **Raise to 120 s/day if** going native is materially more expensive than estimated — e.g., it requires Apple Developer Enterprise tier, paid-only entitlements, or background-refresh privileges that the solo-dev tier (one US$99/yr Developer Program seat) cannot justify. The "native is dramatically more expensive than estimated" branch.

Either pivot is recorded as a quarterly-review entry against this section, not as a silent threshold change.

### Scope sketch

The native app inherits story 005's three-number discipline mechanically — anything else is feature creep that the rule-#1 framing forbids.

- **One main watch face**, with **≤3 complications** wired to the same `/watch.json` endpoint that the Shortcut hits today. Each complication ≤1 metric. Mapping: complication 1 = tokens-remaining (color-coded), complication 2 = last-task-status (✓ / ✗ / ⏳ + truncated title), complication 3 = this-week's-constraint (≤2-word label). This mirrors story 005's payload shape exactly; the `ci-lint-watch-surface-cap` rule (TASKS.md P3) enforces the 3-field cap structurally, so the native app cannot drift past it without breaking CI.
- **Tap-through to a single tokens-remaining detail view.** No multi-screen navigation; one `WKHostingController` over a `SwiftUI` view that re-fetches `/watch.json` and shows the same three values at a larger size. No charts, no history, no graph — those belong on the iPhone or laptop dashboard per story 005's "I almost never do, because the three numbers answer the question" framing.
- **No interactive controls beyond pause/resume**, and even those stay in Shortcuts (the existing `pause-from-iphone` Shortcut already covers them — story 002). The native app is read-only-glance + Siri intent passthrough; control-plane mutations go through the existing surface.
- **Apple Watch faces only.** No iOS companion app beyond the install vehicle (an empty `iOS app` target is required by Xcode for App Store / TestFlight delivery of the watch app, but ships an empty single-screen "Open the Watch" UI). No iPad / Mac variants.

### Estimated effort

**Target ≤2 weeks of solo-dev effort.** Break-down (calendar days, not story points; assumes one developer with prior Swift familiarity but no production WatchOS shipping experience):

- **Day 1–2 — Project setup + signing.** Create Xcode WatchOS app target; sign with the existing Apple Developer Program seat (no new entitlements beyond the default `Network` + `WidgetKit` scopes); push a trivial "hello three numbers" build through TestFlight private distribution (≤25 internal testers — sufficient for solo-dev + family device pool).
- **Day 3–7 — ComplicationKit / WidgetKit data flow.** Implement `WidgetKit` `TimelineProvider` that polls `/watch.json` over Tailscale at the existing endpoint; render three `WidgetFamily.accessoryCircular` / `accessoryRectangular` complications. Reuse the same JSON contract — no new server work. Cache the last-known-good payload locally per story 005's failure-mode #1.
- **Day 8–10 — App Intents for Siri/Shortcuts hooks.** Expose the polled payload as an `AppIntent` so Siri ("Hey Siri, tokens remaining") and the existing Shortcuts library can read it. This preserves the iOS-side investment in story 002's pause Shortcut — Shortcuts can call into the app rather than going around it.
- **Day 11–14 — Testing + private distribution.** Per-failure-mode integration tests against the story-005 chaos table (web app down → cached fallback; stale cache → red badge; concurrent fetches → debounced); TestFlight rollout to the personal device pool; observe `wrist_dwell_seconds_per_day` for one full 7-day window before retiring the Shortcuts-based surface.

The **≤2 weeks ceiling is itself the pivot threshold** for the implementation task that *would* be filed once the trigger fires: if the build slips past 2 weeks of focused time (reasonable allowance for App Store review iterations excepted), the native-app approach is reconsidered against (a) a Wear OS port instead, (b) a richer Shortcuts surface with custom complication snippets, or (c) accepting the dwell metric as a structural problem with the underlying system that no surface can fix. The 2-week ceiling is *not* a vanity-effort estimate — it is the falsifiable horizon on the design's complexity budget.

### Apple toolchain assumptions (primary sources)

- **Xcode + Swift toolchain.** Xcode 16+ on macOS 14+; native WatchOS app development is macOS-only per Apple's developer documentation (<https://developer.apple.com/documentation/watchos-apps>). Linux/Windows hosts cannot build watchOS apps — a hard blocker that is a non-issue today (development host is macOS) but worth recording.
- **App Store Connect / TestFlight.** Private distribution via TestFlight covers ≤100 external + ≤10,000 internal testers, refreshed every 90 days per <https://developer.apple.com/testflight/>. Solo-dev needs are well under this ceiling. App Store public distribution is *not* required and is explicitly out of scope.
- **Signing certificates.** Standard Apple Developer Program membership (US$99/yr) provides the WatchOS distribution certificate; no Enterprise tier required for TestFlight private distribution. If a future capability (e.g., custom background-refresh windows) demands Enterprise, the Pivot-to-120 s/day clause above fires.
- **watchOS 10+ APIs.** `WidgetKit` for at-glance reads (<https://developer.apple.com/documentation/widgetkit>), `App Intents` for Siri / Shortcuts integration that reuses the existing Shortcuts plumbing (<https://developer.apple.com/documentation/appintents>). Older `ClockKit` complications API is deprecated; new development uses `WidgetKit` per Apple's WWDC 2022 deprecation note in the WidgetKit docs.

### Don't implement until the trigger fires

This section is the **specification**, not the **implementation gate**. No `native-watchos-app-impl` task is filed today; one will be filed at the moment the OTEL query above returns true for two consecutive 7-day windows. The discipline is rule-#9's preparation pattern: pre-register the threshold before the result is observed, so that the decision to invest two weeks of native-app development is falsifiable rather than vibes-driven.

The dependency-table row below (`Watch actions — WatchActions`) keeps Apple Shortcuts as the *current* tool; the row will move only when the implementation task lands. The "Open questions" list below is correspondingly updated to mark the Watch-surface question as conditionally resolved (cheap-path adopted; expensive-path pre-specified).

**Anchors:**

- Card, Mackinlay, Shneiderman, *Readings in Information Visualization*, Morgan Kaufmann, 1999, Ch. 1 (glanceable / ambient information display — the Watch surface as a calm-technology read-out; rule #1 explicitly cites this anchor for the row-12 Watch surface).
- Weiser & Brown, "Designing Calm Technology", *PowerGrid Journal* 1995 (the inverted-dwell discipline: more attention to the read-out is a sign the surface or the system is failing).
- Apple Developer Documentation: WatchOS Apps (<https://developer.apple.com/documentation/watchos-apps>); WidgetKit (<https://developer.apple.com/documentation/widgetkit>); App Intents (<https://developer.apple.com/documentation/appintents>); TestFlight (<https://developer.apple.com/testflight/>) — primary technical source for the toolchain assumptions above.
- rule #1 (`vision.md` § 1 — don't reinvent the wheel: Apple Shortcuts first, native app only on a measured trigger; this section is the documented "when not").
- rule #9 (`vision.md` § 9 — pre-registered hypothesis-driven development: the trigger threshold and its pivot conditions are committed before the metric is observed).

## OMC handoff persistence

- **Verdict**: parseable
- **Path**: `<repoRoot>/.omc/state/team/<teamName>/tasks/<taskId>.json` (project-local, NOT `~/.claude/`).
- **Format**: pretty-printed JSON written atomically (`writeAtomic(path, JSON.stringify(updated, null, 2))`).
- **Source citations** (from PR #75 read-only inspection):
  - `src/team/state-paths.ts` — `TeamPaths` constant, lines 17–100
  - `src/team/types.ts:38-58, 195-213` — `TaskFile` / `TeamTask` shape
  - `src/team/state/tasks.ts:90` — canonical write site (`claimTask`)
  - `src/team/task-file-ops.ts:157, 210-243, 321-376` — read/write call sites
- **Implication for `omc-tasksmd-bridge-v0`**: thin-reader hypothesis confirmed; no reverse engineering needed. v0 should be read-only OMC → tasks.md (avoids colliding with OMC's optimistic-concurrency `version` field on write-back). v1+ may add reverse direction once a CRDT story is sketched.
- **Methodology note**: this verdict was reached read-only via the GitHub API + raw-content fetch (no local OMC install, no `/team` invocation). The task brief's invasive verification (`/team 2:executor` against a throwaway repo) is now optional — added as a P3 follow-up (`omc-tasksmd-bridge-runtime-verification`) for the next session if it becomes useful.
- **Round-trip parseability check**: `scripts/omc-roundtrip.mjs` (Aho-Sethi-Ullman 1986 — round-trip property as the parseability test). Pure function `roundTripOmcTask(taskJson)` parses + re-emits with `JSON.stringify(parsed, null, 2)` and diffs against the original (whitespace-only differences allowed). Thin CLI takes `--omc-checkout=<path>` and walks `<path>/.omc/state/team/*/tasks/*.json`. Dormant by default (no flag, or no `.omc/state/team/` subdir → exit 0 with stderr advisory) — same precedent as `scripts/check-mape-k-budget-cap.mjs`. Pivot: if any sample diverges with a non-whitespace diff, the parseable-thin-reader hypothesis is disproved; restore the research task and re-investigate.

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

### Agent-to-agent protocol — `A2A`

- **Current**: A2A v1.0.0 (Linux-Foundation-hosted), adapter scaffold shipped 2026-05-29 as `@minsky/a2a` (`novel/adapters/a2a/`)
- **Gives us**: a standardized agent-to-agent transport (`sendMessage` / `getTask` / `subscribeToTask` / `listTasks`) so Minsky never writes its own custom inter-agent protocol — the consolidation point that the M2 consumers (multi-persona pipeline, cross-vendor reviewer, remote task submission, fleet log aggregation) all collapse into.
- **Why we picked it**: cross-vendor industry standard (Linux Foundation) — adopting it means Minsky doesn't pick a side among the custom protocols Composio / Charlie Labs / OpenAI Agents SDK each ship. Pure rule #1 (don't reinvent the wheel).
- **Workspace dep added**: `@minsky/adapter-types` (`workspace:*`) — the internal leaf package supplying the shared `SelfTestResult` contract; not an external building-block (it's our own acyclic-dependency leaf per Martin 2017), so no separate evaluation is owed beyond this note.
- **Replacement candidates**: AGNTCY (watch — would supersede A2A if it gains Linux-Foundation backing); raw JSON-RPC 2.0 (the fallback if A2A is deprecated before M2).
- **Risks**: the real bridge (google-a2a-python via `child_process`) is gated on the 2026-06-01 OpenHands runtime; until then `A2AOpenHands` is a deterministic-mock scaffold whose `selfTest()` returns `yellow` (never a false `green`). The Python SDK is still maturing — artifact-streaming nuance is deferred to a follow-up.
- **Adapter**: `novel/adapters/a2a/src/index.ts` (interface) + `src/a2a.openhands.ts` (scaffold Strategy)
- **Last reviewed**: 2026-05-29

### Agent-to-tool protocol — `MCP`

- **Current**: MCP v2025-11-25 (Anthropic, ~100+ public servers), adapter scaffold shipped 2026-05-29 as `@minsky/mcp` (`novel/adapters/mcp/`)
- **Gives us**: a standardized agent-to-tool transport (`listResources` / `readResource` / `callTool`) so Minsky composes the existing MCP server ecosystem instead of writing its own tool-calling protocol. Companion to A2A: A2A handles agent ↔ agent, MCP handles agent ↔ tool.
- **Why we picked it**: the de-facto agent-to-tool standard with the largest public server ecosystem — adopting it is pure rule #1 (don't reinvent the wheel); Minsky's substrate calls only the 3 verbs and never touches JSON-RPC internals.
- **Workspace dep added**: `@minsky/adapter-types` (`workspace:*`) — the internal leaf package supplying the shared `SelfTestResult` contract; not an external building-block (our own acyclic-dependency leaf per Martin 2017), so no separate evaluation is owed beyond this note.
- **Replacement candidates**: raw JSON-RPC 2.0 against individual tool servers (the fallback if MCP fragments); OpenAI's function-calling tool schema (different ecosystem — would only matter if Minsky pivoted off the MCP server population).
- **Risks**: the real bridge (`@modelcontextprotocol/sdk` over the OpenHands shim's stdio transport) is gated on the 2026-06-01 OpenHands runtime; until then `MCPOpenHands` is a deterministic-mock scaffold whose `selfTest()` returns `yellow` (never a false `green`).
- **Adapter**: `novel/adapters/mcp/src/index.ts` (interface) + `src/mcp.openhands.ts` (scaffold Strategy)
- **Last reviewed**: 2026-05-29

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
- **Pinned CI version**: `claude-monitor==3.1.0` (PyPI). Wired in `.github/workflows/ci.yml` under the `maciek-smoke` job per the rule-#9 preparation-PR pattern. Bumps go through `review-q3-2026` (quarterly dependency review).
- **2026-05-03 finding (preparation PR for `budget-guard-maciek-impl`)**: claude-monitor 3.1.0 has *no* documented JSON output flag (`--json` doesn't exist in the public CLI surface; the public flags are `--view {realtime,daily,monthly}` plus `--version` per the upstream README). The `budget-guard-maciek-impl` task brief assumed `claude-monitor --json` would yield a parseable `TokenSnapshot`; that assumption is wrong. Two options for the adapter:
  1. **Read upstream's data source directly.** Maciek reads `~/.config/claude/` (Anthropic's own config dir for Claude Code). The adapter parses the same files; Maciek's CLI is bypassed. Pros: no dependency on Maciek's stdout format; less brittle. Cons: we re-implement Maciek's ML predictor for `weeklyHeadroomFraction`, OR drop the predictor and surface only deterministic counts.
  2. **Push a `--json` mode upstream.** File a feature request / PR at <https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor>. Pros: aligns with rule #1 (don't reinvent — push upstream). Cons: gates our adapter on a third-party merge timeline.
  Decision (provisional, to be revisited when `budget-guard-maciek-impl` is implemented): start with option 1 for the deterministic counts (5h-window remaining, observed-at timestamp); leave the ML-predicted weekly headroom as `null` in the `TokenSnapshot` until either Maciek ships JSON output or we ship our own predictor. The maciek-impl task's hypothesis and measurement command have been updated to reflect this.

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

### Local LLM lifecycle — `Ollama`

- **Current**: Ollama HTTP API (`/api/generate` for warm/unload via the `keep_alive` parameter; `/api/ps` for inspection), since 2026-05-29
- **Gives us**: A pre-existing well-documented eviction primitive — `keep_alive: 0` on a `/api/generate` request unloads the model immediately; `keep_alive: "30m"` (or any duration) warms it and pins the lifetime; `/api/ps` returns the loaded model list with expiry timestamps. Ollama is already the operator's default local LLM serving daemon (per `user-stories/015-local-models-until-stable.md`), so this layer is "use what's already there" — no new install, no new auth.
- **Why we picked it**: Rule #1 (GET, don't IMPLEMENT). The build/buy/borrow question was "how do we reclaim ~42 GB of wired RAM when the minsky daemon stops?" The answer turns out to be: Ollama already ships the eviction primitive; we just call it. Alternatives considered: (a) parent the ollama-runner process under minsky and `kill -9` on shutdown — fragile, race-prone, doesn't survive operator-restarts of Ollama; (b) write a watchdog that polls `ps aux` and kills the runner — duplicates ollama's own keep_alive timer; (c) push a `keep_alive: 0` upstream contribution to LiteLLM — useful long-term (filed as the pivot path) but doesn't help right now. The adapter at `novel/adapters/ollama/` is the thinnest wrap that makes Ollama's HTTP eviction primitive available to the bash skeleton without inlining `curl` calls (rule #2 — no vendor name in business logic).
- **Replacement candidates**: LM Studio HTTP server (same HTTP shape, different defaults); MLX-LM server (Apple Silicon native, no `keep_alive` parameter today — would need its own Strategy with manual lifecycle); ollama-py library inside a Python sidecar (heavier, no benefit vs HTTP). All three are swap-in-able Strategy implementations behind the same `Ollama` interface.
- **Risks**: LOW — Ollama's `keep_alive` parameter has been stable since v0.1.x (verified by inspecting the `/api/generate` request shape via tcpdump on 127.0.0.1:11434 during a live qwen3-coder:30b iteration on 2026-05-29). The one observable risk is LiteLLM (used by OpenHands) starting to set `keep_alive` per-request on its `/api/chat` payloads — today it doesn't, but a future LiteLLM upgrade could. The metric `ollama-daemon-idle-wired-memory-mb` catches this regression within 14 days (per user-story 020's pivot section).
- **Adapter**: `novel/adapters/ollama/src/index.ts` (interface) + `novel/adapters/ollama/src/http.ts` (Strategy)
- **Closes**: `user-stories/020-ollama-jit-warm-unload.md`; tracks the cross-repo dotfiles plist change (`OLLAMA_KEEP_ALIVE` 24h → 10m) as the env-var safety net for crash paths.
- **Last reviewed**: 2026-05-29

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
- **Open question — resolved 2026-05-03**: Lighter backend? See § "Lighter OTEL backend" above. Recommendation: OpenObserve for v0; the row's `Current` cell will be updated when `observability-adapter-v0` ships against the lighter backend.

### Prompt optimization — `PromptOptimizer`

- **Current**: DSPy (Stanford) for the optimizer + Promptfoo for evaluation harness
- **Gives us**: Programmatic prompt A/B testing with metrics as reward; declarative optimizer pipelines
- **Why we picked it**: DSPy is the leading "programming-not-prompting" framework; Promptfoo is the OSS eval standard
- **Replacement candidates**: OpenAI Evals; custom (simple ring-buffer of variants with metric voting)
- **Risks**: DSPy still evolving; idiom may not perfectly fit Claude Code's prompt model — open question for first practical attempt
- **Adapter**: `novel/adapters/prompt-optimizer.dspy.ts` (forthcoming)
- **Last reviewed**: 2026-05-03
- **Open question — resolved 2026-05-03**: DSPy idiom fit? See § "DSPy fit" above. Recommendation: reject DSPy (Python-only runtime + 5:4 friction-to-win ratio); ship the fallback TypeScript `PromptOptimizer` interface defined in that section against the Anthropic SDK directly. Row's `Current` cell will move when `mape-k-loop-v0`'s implementation task lands the fallback adapter.

### Specification monitor — `SpecMonitor`

- **Current**: **Custom Claude Skill** — `novel/spec-monitor/SKILL.md` (forthcoming)
- **Gives us**: Runtime specification monitoring (Havelund & Goldberg, "Verify Your Runs", VSTTE 2008) — reads a behavioral-specification document plus recent N actions/handoffs; produces structured drift report
- **Why we built it**: No existing runtime tool monitors a project-level behavioral specification. Anthropic's Constitutional AI applies at *training* time; we want it at *runtime* against the project spec (`vision.md`).
- **Replacement candidates**: None known. Adjacent: existing runtime-verification tools (Java PathExplorer, RV-Monitor) target program traces, not LLM-agent behavior — different domain.
- **Risks**: Wholly novel — most likely place for our design to be wrong; needs iteration based on actual drift patterns observed
- **Last reviewed**: 2026-05-03
- **Extraction target**: Yes — published as `@minsky/spec-monitor` from day one
- **Glossary**: see [vision.md § Glossary](./vision.md#glossary--every-term-has-a-cs-anchor) for the term-in-use → CS-source mapping (and the retired-terms list)

### Finding anonymizer — `@minsky/tick-loop`

- **Current**: **Custom internal package** — `novel/tick-loop/src/finding-reporter.ts` (pure `RawFinding` → `AnonymizedFinding` DTO + redaction pass + `containsPii` fail-closed re-scan + preview/issue-body renderers). Consumed by `scripts/submit-finding.mjs` for `minsky submit-finding`.
- **Gives us**: the privacy core of remote finding submission (TASKS.md `minsky-remote-task-submission`) — strip every secret / PII / user-home-path span from a self-reported finding before it egresses to `fyodoriv/minsky`, with the guarantee unit-testable in isolation.
- **Why we built it**: a generic redaction library (`redact-pii`, `scrubbr`) only covers the regex layer and would drift from `scripts/check-otel-no-pii.mjs`'s classifier. The redaction rule-set is deliberately co-defined with that gate so the egress boundary and the OTEL boundary agree on what a secret is (rule #2 — single seam). The `FindingType` enum (mapped to the rule-#17 proactive-heal vocabulary), the `AnonymizedFinding` egress contract, and the preview/issue-body renderers have no off-the-shelf equivalent.
- **Replacement candidates**: `redact-pii`, `scrubbr` (rejected above); an allow-list-only projection (emit structured metadata + fixed-vocabulary finding type, drop free text) is the documented Pivot if the regex rule-set ever lets a real leak through.
- **Risks**: regex redaction can produce false negatives — mitigated by the `containsPii` defense-in-depth re-scan that fails the submission closed before any `gh issue create`.
- **Last reviewed**: 2026-06-02
- **Extraction target**: internal for now; pure + dependency-free so extraction is cheap if a second consumer appears.

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

- ~~Apple Watch surface — does Shortcuts + ntfy suffice long-term, or do we eventually need a native WatchOS app?~~ Resolved 2026-05-03; see § "Native WatchOS app". Cheap path (Shortcuts) stays current; expensive path (native app) is pre-specified with a metric-bound trigger (90 s/day wrist-dwell sustained 14 d) and a ≤2-week effort ceiling. No implementation task filed until the trigger fires.
- ~~DSPy idiom fit with Claude Code's prompt model — needs first practical attempt~~ Resolved 2026-05-03; see § "DSPy fit". Recommendation: reject; ship fallback `PromptOptimizer` interface that calls Anthropic API directly.
- ~~Lighter OTEL backend — Loki+Tempo+Prometheus+Grafana is heavy for single-dev installs; SQLite-backed alternative?~~ Resolved 2026-05-03; see § "Lighter OTEL backend".
- Cross-language equivalent of tasks.md — can the spec be ported to Python/Rust ecosystems? (taskmd-driangle covers some of this with directory-of-files) — **No cross-language port as of 2026-05-04** (PyPI search: only generic markdown-task parsers like `markdown-analysis`, `minchin.md-it.fancy-tasklists`; crates.io: no `tasks-md` crate, only generic markdown parsers). Node-only via `@tasks-md/lint`. Defer to `review-q3-2026`; trigger: file an upstream issue if ≥2 downstream tools request a Python/Rust port.
- ~~OMC-handoff parseability on disk — do they parseably persist their internal task list?~~ Resolved 2026-05-03; see the dedicated section above (PRs #75 / #77). Bridge v0 shipped as `@minsky/omc-tasksmd-bridge` per vision.md row 62; round-trip parseability check landed in `scripts/omc-roundtrip.mjs`.

---

## Quarterly review log

(Empty at start; entries added each quarter per `vision.md` § "License & openness".)

- **2026-05-03 — Initial pass.** Dependency table established. Each row first-time-reviewed. OMC adopted. tasks.md confirmed as substrate. Constitutional review identified as the single wholly-novel layer. Five extraction targets named.

- **2026-06-02 — vitest 2.1.9 → 4.1.5 (security-forced, ahead of Q3).** Pulled forward from the Q3 review because vitest < 4.1.0 carries the critical advisory **GHSA-5xrq-8626-4rwp** (Vitest UI server arbitrary-file read), previously suppressed via `pnpm.auditConfig.ignoreGhsas`. Upgrading `vitest` + `@vitest/coverage-v8` to `^4.1.5` (root + the `novel/human-loop` workspace package) clears it at the source — `pnpm audit --audit-level=high` now exits 0 with the advisory gone, not muted. **Borrow, not build**: vitest remains the chosen test runner (rule #1); this is a version bump on an existing building block. The 3.x skip's blast radius landed as predicted in the 2026-05-04 audit: (1) **`vite` ^7.0.0 added as a direct dev dependency** — vitest 4 requires `vite ^6|^7|^8` (vite 5 lacks the `./module-runner` export), and pnpm's `auto-install-peers` kept resolving the stale vite 5.4.21 as the peer; pinning vite directly forces vite 7.3.5. This is not a new building block — it is the transitive engine vitest already runs on, surfaced to the top level only to pin a satisfying version. (2) `tsconfig.base.json` gains `types: ["node"]` (vitest 4's ambient type chunks suppress tsc's automatic `@types/node` inclusion). (3) `vitest.config.ts` gains `testTimeout`/`hookTimeout: 30000` (vitest 4's per-test overhead pushed subprocess-heavy integration tests past the 5000ms default). (4) The pre-pr-lint vitest gate switches `--reporter=basic` (removed in vitest 4) → `--reporter=dot`. Branch coverage measured **85.77%** under vitest 4 — above the existing 85 threshold, so no threshold change was needed. Revisit vite/vitest pinning at the Q3 review.

### Pre-2026-Q3 audit findings (2026-05-04)

A 3-month-early snapshot of `pnpm outdated` against the Q3 2026 review (date-blocked, due 2026-08-03 per `review-q3-2026`). The intent is *not* to bump anything now — that is the Q3 review's job. The intent is to give the Q3 review a stable baseline to compare against, so the review can ship with concrete before/after numbers rather than a fresh dependency scan as its first step.

| Package                  | Current | Latest | Notes                                                          |
|--------------------------|---------|--------|----------------------------------------------------------------|
| `@biomejs/biome` (dev)   | 1.9.4   | 2.4.14 | Major: 1→2 (config schema breaking changes); plan migration.   |
| `@vitest/coverage-v8` (dev) | 2.1.9 | 4.1.5  | Tied to vitest version.                                        |
| `lefthook` (dev)         | 1.10.10 | 2.1.6  | Major: 1→2; verify pre-commit hooks survive.                   |
| `typescript` (dev)       | 5.7.2   | 6.0.3  | Major: 5→6; check `tsc -b` semantics.                          |
| `vitest` (dev)           | 2.1.9   | 4.1.5  | Major skip 3.x; review breaking changes per release notes.     |
| `markdownlint-cli2` (dev)| 0.15.0  | 0.22.1 | Pre-1.x; minor delta but several minor bumps; safe for solo-dev tier. |

**Summary.** Six dev deps are major-version behind (biome, vitest, `@vitest/coverage-v8`, lefthook, typescript) plus the pre-1.x `markdownlint-cli2` minor drift. **All are tooling — no runtime deps are out of date** (the runtime side of the dep table in this document remains stable as of 2026-05-04).

**Recommendation for the Q3 review.** Address `markdownlint-cli2` first (smallest risk delta — pre-1.x, lint-only, no semantic surface area). Then plan the `@biomejs/biome` 1→2 migration as a separate task before bumping `vitest`/`typescript` (which have larger blast radii: vitest's coverage tooling and TS's `tsc -b` project-references behaviour respectively). The Lighthouse pin (`12.4.0`, vision.md row 58) is filed for Q3 in line with the existing cadence — current latest is `12.6.0`, a minor delta that does not justify an emergency bump.
