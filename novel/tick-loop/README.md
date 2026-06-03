# `@minsky/tick-loop`

<!-- rule-1: a generic redaction library (e.g. `redact-pii`, `scrubbr`) rejected because: the finding shape is Minsky-specific (FindingType enum mapped to the rule-#17 proactive-heal vocabulary, the AnonymizedFinding egress contract, the renderPreview/renderIssueBody surfaces) and the redaction rule-set is deliberately co-defined with `scripts/check-otel-no-pii.mjs` so the egress boundary and the OTEL boundary agree on what a secret is — a single seam (rule #2). An off-the-shelf scrubber would only cover the regex layer and would drift from the OTEL classifier; the DTO + preview/issue-body rendering have no off-the-shelf equivalent. -->

This package exists to hold the pure, unit-testable cores of the per-iteration tick loop — two concerns whose I/O lives at the edge so the load-bearing decisions are testable in isolation. **(1)** The remote-task-submission core lets a minsky installation submit a self-observed finding (a bug, limitation, crash, or flaky test) back to `fyodoriv/minsky` **without ever leaking code, secrets, or file paths**: the data shape (`RawFinding` → `AnonymizedFinding`), the redaction pass (`redact`), the leak re-scan (`containsPii`), and the two renderers (`renderPreview` for the operator's `[Y/n]` approval, `renderIssueBody` for the GitHub issue). All I/O — `gh issue create`, the approval prompt — lives in [`scripts/submit-finding.mjs`](../../scripts/submit-finding.mjs). **(2)** The `gh-auth-classifier` core (`classifyGhFailure`, `extractHttpStatus`) decides what a failed per-iteration `gh` / `gh api` call means: a transient GitHub `401`/`403`/`429` is absorbed (the sub-step is skipped, or just that one iteration fails) and a `gh-transient-auth` failure class is emitted — so a token-refresh blip **never** `process.exit(1)`s the worker daemon (rule #6, stay alive). Only a non-recoverable status, a spawn-level failure, or a *persisted* run of ≥3 consecutive auth failures escalates to a let-it-crash. The `gh` spawn I/O lives in the call sites under [`scripts/orchestrate.mjs`](../../scripts/orchestrate.mjs) / [`scripts/local-gate-merge.mjs`](../../scripts/local-gate-merge.mjs); this package stays pure so both concerns are deterministically testable.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index):

- **Data Transfer Object (DTO)**: Fowler, *Patterns of Enterprise Application Architecture*, 2002. `RawFinding` (internal) → `AnonymizedFinding` (egress projection). **Conformance: full.**
- **Sanitizer / redaction before egress**: vision.md rule #13.7 (privacy by default); GDPR Art. 25 (data protection by design). The redaction rule-set mirrors `scripts/check-otel-no-pii.mjs`'s classifier — one definition of "secret", two enforcement points. **Conformance: full.**
- **Opt-in telemetry**: Mozilla Crash Reporter; VSCode telemetry (transparent + anonymized + approval-gated). **Conformance: full** — nothing egresses without the operator approving the rendered preview.
- **Circuit Breaker (transient-fault classifier)**: Nygard, *Release It!*, 2007. `classifyGhFailure` fails fast only on a *persisted* fault (≥3 consecutive auth failures); single/transient `401`/`403`/`429` are absorbed. **Conformance: partial** — there is no half-open re-probe state (the daemon's next tick is the implicit probe); full conformance would add a half-open timer, unnecessary here because the tick cadence already bounds re-probe frequency.
- **Let-it-crash carve-out**: Armstrong, *Programming Erlang*, 2007. A genuinely-unexpected fault (no HTTP status, non-recoverable status) returns `"crash"` so the supervisor restart handles it; a known-recoverable remote status is handled-locally, not crashed. **Conformance: full.**
- **MAPE-K Plan phase (autonomic computing)**: Kephart & Chess, *The Vision of Autonomic Computing*, IEEE Computer, 2003. `audit-pass-trigger`'s `shouldTriggerAuditPass` is the Plan stage — it synthesises a new action ("run an audit pass to author tasks") from the Analyse-stage observation ("the host queue is empty"). **Conformance: full** — the Monitor/Analyse (the picker result + empty-tick counter) and the Execute (spawn the audit-pass agent) live at the daemon edge; this module is the pure Plan decision.
- **State Machine guard (automaton transition)**: Hopcroft & Ullman, *Introduction to Automata Theory*, 1979. The empty-tick cadence is a deterministic transition guard `(consecutiveEmptyTicks - 1) % cadence === 0`. **Conformance: full.**
- **UUID-from-random namespacing**: Leach, Mealling & Salz, RFC 4122 §4.4, 2005. `worker-config`'s run-id `<repo-hash>-<pid>-<rand>` is a per-run namespace prefix so dozens of concurrent `minsky` processes on one machine never collide on a string namespace (worktree / branch / launchd label / ledger); the random token is the tiebreaker even when pids recycle. The derived port is only a *hint* — a finite shared resource the OS bind loop arbitrates (`EADDRINUSE` → next free port), not a uniquely-keyed namespace. **Conformance: partial** — we don't emit a canonical 128-bit UUID (a short FNV-1a repo hash + pid + 32-bit random is enough to disambiguate same-machine runs and stays grep-friendly); full conformance would swap the prefix for `crypto.randomUUID()`, unnecessary for a same-machine namespace and costlier to scan in a ledger.
- **Mutual exclusion via uniquely-keyed locks**: Lamport, "A New Solution of Dijkstra's Concurrent Programming Problem", CACM 1974. `deriveClaimKey(repo, task)` derives one shared O_EXCL lock path per `(repo, task)` so two processes on the same repo serialise to one task winner, while different tasks (or different repos) never cross-block. **Conformance: full** — the OS `O_EXCL` create IS the bakery-ticket; this module supplies the per-(repo,task) ticket name.

### machine-budget-autoscaler

- **Closed-loop feedback controller**: Åström & Murray, *Feedback Systems*, 2008; classic control theory. `computeWorkerTarget` is a discrete controller that drives the measured utilisation toward the budget set-point, ratcheting by ≤1 (no overshoot doubling) and circuit-breaking on the gridlock signature. **Conformance: partial** — it is a bang-bang/ratchet controller, not a full PID (no integral/derivative terms); the per-step ±1 ramp + halving-backoff is deliberately simpler to avoid the oscillation the Pivot clause warns against. Full PID would add windup-guarded integral action, unnecessary at this control cadence.
- **Functional core / imperative shell**: Bernhardt, *Boundaries*, 2012. The controller and resolver are pure functions over an observed-state struct; all I/O (os/loadavg, config read, plist read) lives in `bin/tick-loop.mjs`. **Conformance: full.**
- **Little's Law (capacity-bounded throughput)**: Little 1961. Past the saturation knee, adding workers only adds contention, so the controller measures *effective* throughput (active subprocs + PRs) rather than nominal worker count. **Conformance: full** — the knee-hold regime is the operational expression of the law.

### os-throttle-detect

- **Drift detector (declarative-state vs actual)**: Burgess, *Cfengine* convergent-maintenance; the gate compares the desired budget contract against the host's actual throttle surface. **Conformance: full.**
- **Functional core / imperative shell**: Bernhardt, *Boundaries*, 2012. `detectThrottles` / `renderMirrorTasks` are pure over a gathered-evidence struct; the host probe I/O lives in `bin/tick-loop.mjs`. **Conformance: full.**
- **Propagation-not-one-off (rule #1)**: every detected host change renders a durable task for the mirror that owns it (dotfiles for launchd/shell, agentbrew for agent rules) so minsky *pulls* the fix instead of re-applying it. **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: (finding-reporter) `anonymizeFinding(raw)` returns an `AnonymizedFinding` whose free-text fields contain zero secret/PII spans, for every `RawFinding` input; `containsPii(anonymized)` returns `false` on that output. (gh-auth-classifier) for every single recoverable GitHub status (`401`/`403`/`429`), `classifyGhFailure` returns a disposition that is **never** `"crash"` — the daemon stays up. (worker-config) for N concurrent runs on the same repo, every per-run STRING namespace derived by `deriveRunNamespace` (worktree / lock / branch / launchd label / ledger) is disjoint (the run-id keys it) and every `(repo, task)` pair maps to one shared claim key, so at most one process wins the O_EXCL claim — zero collisions, zero double-claims, zero corrupt worktrees (the port is a finite hint the OS bind loop arbitrates, excluded from the hard-collision count).
- **Blast radius**: (finding-reporter) a single finding submission. (gh-auth-classifier) a single per-iteration `gh` call — at worst one skipped advisory sub-step or one abandoned iteration; the daemon process is never the blast radius of a transient GitHub status. The package is pure (no I/O), so a defect cannot corrupt state or leak beyond the one payload/decision the caller is about to act on.
- **Operator escape hatch**: (finding-reporter) the submission is preview-then-approve (`renderPreview` → `[Y/n]` in `scripts/submit-finding.mjs`); declining the prompt sends nothing — no auto-submit path. (gh-auth-classifier) the touches-collision sub-step that most often surfaces a transient 401 already documents `MINSKY_TOUCHES_GLOB_CHECK=0` to disable it entirely (the claim layer stands alone); the persisted-failure threshold (`PERSISTED_AUTH_FAILURE_THRESHOLD = 3`) is the cap past which a genuinely-revoked token still surfaces loudly. (worker-config) `MINSKY_RUN_ID` pins a run's namespace explicitly (e.g. to attach a debugger to a known worktree); the per-run port range is tunable via `basePort`/`portSpan`.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Secret in a free-text field (API key, PAT, Slack token, AWS key) | upstream-leak | `graceful-degrade` — `redact` replaces every matched span with `[redacted]` | `novel/tick-loop/src/finding-reporter.test.ts` (per-rule redaction assertions) |
| 2 | User-home path leaks the operator's username (`/Users/<name>`, `/home/<name>`) | upstream-leak | `graceful-degrade` — path prefix redacted | `novel/tick-loop/src/finding-reporter.test.ts` (home-path assertions) |
| 3 | Email or bare IPv4 that could de-anonymize the reporter | upstream-leak | `graceful-degrade` — span redacted | `novel/tick-loop/src/finding-reporter.test.ts` (email + ipv4 assertions) |
| 4 | A leak slips past redaction and reaches the egress boundary | redaction-miss | `loud-crash-supervisor-restart` — `containsPii` returns `true`; the CLI aborts before `gh issue create` | `novel/tick-loop/src/finding-reporter.test.ts` (containsPii assertions) + `scripts/submit-finding.test.mjs` (abort-on-leak assertion) |
| 5 | Multiple secrets in one field | upstream-leak | `graceful-degrade` — every occurrence redacted (global-flag rules) | `novel/tick-loop/src/finding-reporter.test.ts` (global-flag + stateless assertions) |
| 6 | Transient GitHub `401`/`403`/`429` on a per-iteration `gh` call (token-refresh window, keychain blip, rate-limit-adjacent de-auth) | dependency-failure | `graceful-degrade` — `classifyGhFailure` returns `skip-substep`/`fail-iteration` + `gh-transient-auth` failure class; daemon stays up, never `process.exit(1)` | `novel/tick-loop/src/gh-auth-classifier.test.ts` (recoverable-status absorbed assertions) |
| 7 | Persisted GitHub auth failure (≥3 consecutive — a genuinely-revoked token, not a blip) | dependency-failure | `loud-crash-supervisor-restart` — `classifyGhFailure` reclassifies to `"crash"`/`gh-fatal` at `PERSISTED_AUTH_FAILURE_THRESHOLD` so the supervisor restart re-authenticates | `novel/tick-loop/src/gh-auth-classifier.test.ts` (Pivot-clause persisted-de-auth assertions) |
| 8 | Spawn-level `gh` failure (binary missing / ENOENT / network unreachable — no HTTP status) | dependency-failure | `loud-crash-supervisor-restart` — no recoverable status ⇒ `"crash"` with a null failure class; an unexpected fault is let-it-crash | `novel/tick-loop/src/gh-auth-classifier.test.ts` (no-status crashes assertions) |
| 9 | Host queue empties (`pickHostTask → null`) — the daemon would otherwise idle waiting for the operator | starvation | `graceful-degrade` — `shouldTriggerAuditPass` triggers an audit pass that authors the next batch of tasks instead of idling | `novel/tick-loop/src/audit-pass-trigger.test.ts` (empty-queue trigger assertions) |
| 10 | Empty queue while recent ticks show stability debt (`scope-leak`, `spawn-failed`, …) — a broad audit would propose feature work rule #12 rejects | scope-collision | `graceful-degrade` — `chooseAuditScope` narrows the audit to `stability-only` (the rule-#12 Pivot clause) | `novel/tick-loop/src/audit-pass-trigger.test.ts` (stability-only scope assertions) |
| 11 | Misconfigured (non-finite / non-positive) audit-pass cadence reaches the decision | config-error | `graceful-degrade` — `normalizeCadence` clamps to `DEFAULT_EMPTY_QUEUE_CADENCE`; the daemon never crashes on a bad knob (rule #6) | `novel/tick-loop/src/audit-pass-trigger.test.ts` (normalizeCadence clamp assertions) |
| 12 | Corrupt / partially-written JSONL tick line in the audit-pass coverage store | upstream-corruption | `graceful-degrade` — `parseTickEvents` drops the bad line, never throws; coverage is computed from the good lines | `scripts/audit-pass-empty-queue-coverage.test.mjs` (drops-unparseable-lines assertions) |
| 13 | Degenerate idle sample (no idle measurements yet) when computing the p50 | empty-sample | `graceful-degrade` — `percentile` returns `null`, never `NaN`/`Infinity`; coverage `success` is not failed for insufficient data | `scripts/audit-pass-empty-queue-coverage.test.mjs` (null-p50 vacuously-passes assertions) |
| 14 | N concurrent `minsky` runs on the SAME repo collide on a per-run namespace (worktree dir / branch / launchd label / ledger) | concurrency-collision | `graceful-degrade` — every string namespace is run-id-keyed (`deriveRunNamespace`), so N independently-derived namespaces are provably disjoint; zero collisions (the port is a finite resource excluded from the hard count — it's a hint the OS bind loop arbitrates) | `novel/tick-loop/src/worker-config.test.ts` (countNamespaceCollisions assertions) + `scripts/chaos-multitenant.test.mjs` (N=10/50 zero-collision assertions) |
| 15 | Two processes on the same repo race to claim the same task (double-claim) | concurrency-collision | `loud-crash-supervisor-restart` boundary at the OS `O_EXCL` create — `deriveClaimKey(repo, task)` makes both processes derive the SAME lock path so the kernel grants the create to exactly one; the loser fails the create and picks the next task | `novel/tick-loop/src/worker-config.test.ts` (deriveClaimKey same-key assertions) + `scripts/chaos-multitenant.test.mjs` (zero-double-claim assertions) |
| 16 | A run starts with a missing/empty random token, threatening a silent namespace clash with a sibling | config-error | `loud-crash-supervisor-restart` — `deriveRunId` throws on an empty `rand` rather than emit a colliding namespace (rule #6 — a programming bug crashes loud, never collides silently) | `novel/tick-loop/src/worker-config.test.ts` (empty-rand-throws assertions) |
| 17 | Concurrency over-ramped past the saturation knee (load runaway, active subprocs collapse toward 0) | resource-exhaustion | `graceful-degrade` — `computeWorkerTarget` returns the `gridlock-backoff` regime and halves the target immediately, regardless of nominal worker count | `novel/tick-loop/src/machine-budget-autoscaler.test.ts` (gridlock backoff assertions) |
| 18 | Garbage / out-of-range budget value from env or config | upstream-bad-input | `graceful-degrade` — `resolveMachineBudgetPct` rejects NaN/out-of-range and falls through to the next layer, then the pinned default (70) | `novel/tick-loop/src/machine-budget-autoscaler.test.ts` (resolveMachineBudgetPct fall-through assertions) |
| 19 | OS throttle contradicts the budget (launchd `Background` QoS / `Nice` / low `ulimit` / stale `MINSKY_*` cap) makes the budget physically unreachable | misconfiguration | `circuit-break-and-notify` — `detectThrottles` flags it, `renderMirrorTasks` emits the durable mirror-repo fix; the gate `scripts/check-machine-budget.mjs` hard-fails CI on a `Background` plist | `novel/tick-loop/src/os-throttle-detect.test.ts` (throttle-detection assertions) + `scripts/check-machine-budget.test.mjs` (Background-fixture fail assertion) |
| 20 | Non-launchd / partial host probe (Linux, missing plist) | dependency-degrade | `graceful-degrade` — absent evidence fields degrade to a clean (no-throttle) result rather than crashing the probe | `novel/tick-loop/src/os-throttle-detect.test.ts` (partial-evidence assertions) |

## Related: bash-CLI runtime resilience (minsky-runtime-resilience)

The pure cores here keep the per-iteration loop alive across GitHub-auth
blips, queue exhaustion, and same-machine concurrency (failure modes 6–16
above). The bash entrypoint that *invokes* this loop —
[`bin/minsky-run.sh`](../../bin/minsky-run.sh) — carries the same
loud-fail-AT-the-right-boundary discipline for the host I/O it owns, so a
live runtime failure surfaces an operator-actionable message instead of a
raw shell/errno:

- **Unwritable experiment-store dir** (wrong-owner `MINSKY_HOME`, read-only
  mount) → `invariant_host_experiment_store_writable` prints the offending
  path + the recovery command (`chmod u+w …` or `MINSKY_HOME=<writable>`)
  and exits non-zero cleanly — never a bare `mkdir` errno.
- **Unwritable log/brief target dir** → `resilient_logfile` falls back to
  `${TMPDIR:-/tmp}/minsky-<user>-<id>.log` with a one-line warn and the
  iteration continues (graceful degradation, SRE 2016 Ch. 6).
- **Missing/non-executable run target (spawn shim)** → `preflight_run_target`
  names the path + the fix (`pnpm install` / `chmod +x`) and records a
  `spawn-failed` verdict instead of letting python surface a raw `ENOENT`.

`minsky doctor` reports state-dir writability up front via the
`state-dir-writable` probe in
[`scripts/bash-doctor-probes.sh`](../../scripts/bash-doctor-probes.sh), so
the condition is caught before an iteration aborts on it. Branch coverage:
[`tests/runtime-resilience.bats`](../../tests/runtime-resilience.bats).
Anchor: Armstrong 2003 (let-it-crash AT the boundary); Beyer et al., *SRE*,
2016, Ch. 6 (graceful degradation). Sibling slice:
`minsky-cli-fresh-clone-bootstrap` (same discipline at install time).

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: the `RawFinding` free-text fields (`title`, `reproSteps`) — scraped from a failing iteration on an arbitrary host; may contain code, absolute paths, API keys, or PII.
- **Trusted state**: the redaction rule-set is an in-source constant (`REDACTION_RULES`); the package is pure (no I/O, no env reads); the only shape that crosses the trust boundary is `AnonymizedFinding`.
- **Trust boundary**: `anonymizeFinding(raw)` is the boundary — its output is the only thing the CLI renders and submits; `containsPii` is the defense-in-depth re-scan the CLI runs before egress.
- **STRIDE focus**: **I**nformation disclosure — the entire package exists to prevent it; `redact` strips credential/PII/path spans and `containsPii` fails-closed if redaction missed one. **T**ampering — the structured metadata (`type`, `minskyVersion`, `os`, `agent`) is typed (an enum + plain strings) so a malicious field cannot smuggle markup into the issue body beyond inert text.
- **Performance-first carve-out** (rule #13's relief valve): none declared — redaction runs once per submission, far off any hot path.
- **machine-budget / os-throttle inputs**: the budget value (`MINSKY_MACHINE_BUDGET_PCT`, config) and the throttle evidence (launchd plist text, `ulimit`, `MINSKY_*` env) are operator-local, not network-sourced — the trust boundary is the parser. **Tampering** focus: `resolveMachineBudgetPct` validates + clamps every value to `[floor, ceiling]` so a hostile/garbage env var can never drive concurrency above the swarm ceiling or below 1; the swarm ceiling (80) is an in-source constant a remote input cannot raise. The mirror task blocks are inert Markdown (no shell interpolation) appended by the I/O edge.

## Hypothesis-driven development (rule #9)

### finding-reporter

- **Hypothesis**: a pure DTO + redaction core makes the privacy guarantee ("no code, no secrets, no file paths egress") unit-testable in isolation, so every secret-shape class is covered by a deterministic test rather than a hope.
- **Success threshold**: `pnpm vitest run novel/tick-loop/src/finding-reporter.test.ts` exits 0 with a test asserting redaction for each of the 9 secret/PII shapes in `REDACTION_RULES`, plus a `containsPii` fail-closed test.
- **Pivot threshold**: if the regex rule-set produces ≥2 false negatives (a real leak slips through) in any review window, pivot from regex redaction to an allow-list projection (only emit the structured metadata + a fixed-vocabulary finding type, drop free text entirely).
- **Measurement**: see "Success threshold" above.
- **Literature anchor**: Fowler 2002 (DTO); GDPR Art. 25 (privacy by design); Mozilla Crash Reporter / VSCode telemetry (opt-in, anonymized).

### gh-auth-classifier

- **Hypothesis**: today a transient GitHub 401 in a per-iteration `gh` call propagates to `process.exit(1)` and crashes the worker daemon (observed: 1 crash / 2 runs in the first hour, `com.minsky.opus-sonnet-run` `last exit code = 1`). After routing those call sites through `classifyGhFailure`, a single 401/403/429 is absorbed (sub-step skipped or iteration failed) + a `gh-transient-auth` span is emitted, so the daemon-crash count over a rolling 10h window drops from ≥1 to 0.
- **Success threshold**: 0 daemon crashes attributable to a recoverable GitHub status over a rolling 10h window in which ≥1 transient 401 occurred and was absorbed.
- **Pivot threshold**: if classification proves brittle (GitHub returns 401 for a genuinely-fatal de-auth that we keep absorbing), keep the crash for *persisted* auth failure — `PERSISTED_AUTH_FAILURE_THRESHOLD = 3` consecutive 401s across iterations escalate to `"crash"` — but still absorb single/transient ones.
- **Measurement**: `pnpm vitest run novel/tick-loop/src/gh-auth-classifier.test.ts` exits 0 (the pure decision is pinned: no single recoverable status returns `"crash"`; the 3rd consecutive does); at runtime, `grep -c '"failure_class":"gh-transient-auth"' .minsky/opus-sonnet-run.*.log` shows absorbed events with the daemon still up, and `launchctl print … | grep 'last exit code'` shows no 401-attributable exit-1.
- **Literature anchor**: Armstrong 2007 / rule #6 (let-it-crash is for *unexpected* faults; a known-recoverable remote status is handled-locally); Nygard, *Release It!*, 2007 (Circuit Breaker — fail fast only on persisted faults); Beyer et al. *SRE* 2016 Ch. 22 (retry/skip budget with a cap for transient dependency errors).

### audit-pass-trigger

- **Hypothesis**: rule #17 makes agents author tasks INSIDE iterations, but when the queue empties the daemon idles (idle→next-task latency = ∞, waiting for the operator). Routing the `pickHostTask → null` tick through `shouldTriggerAuditPass` so the daemon runs an audit pass produces ≥1 new actionable task on ≥80% of empty-queue ticks and drops the idle→next-task p50 below 5 min.
- **Success threshold**: `node scripts/audit-pass-empty-queue-coverage.mjs --json` reports `empty_queue_ticks == audit_pass_invocations` (every empty tick authors work) AND `idle_to_next_task_p50_minutes < 5`; the unit suite (`novel/tick-loop/src/audit-pass-trigger.test.ts` + `scripts/audit-pass-empty-queue-coverage.test.mjs`) exits 0 pinning the decision + the Measurement shape.
- **Pivot threshold**: if ≥30% of audit-pass output on empty-queue ticks is feature work that rule #12 rejects, the broad audit is wrong — narrow permanently to `stability-only` (the `chooseAuditScope` path already exists; the pivot makes it the only path).
- **Measurement**: `node scripts/audit-pass-empty-queue-coverage.mjs --window=10ticks` returns the pre-registered object `{ empty_queue_ticks, audit_pass_invocations, new_tasks_produced, idle_to_next_task_p50_minutes }`.
- **Literature anchor**: Kephart & Chess 2003 (MAPE-K — the Plan phase synthesises new actions from Analyse observations); the operator's "comes up with tasks" vision directive; rule #12 (scope discipline); Ries 2011 + Munafò et al. 2017 (falsifiable, pre-registered metric).

### worker-config

- **Hypothesis**: today dozens of concurrent `minsky` runs on the same repo can collide — a shared launchd label, branch, lock, or ledger path means run B clobbers run A (corrupt worktree, double-claimed task, kickstart hits the wrong daemon). After keying every per-run mutable namespace by a unique run-id `<repo-hash>-<pid>-<rand>` and scoping the task claim by `(repo, task)`, N=10 concurrent same-repo runs for 30 min produce 0 collisions, 0 corrupt worktrees, and 0 double-claims.
- **Success threshold**: `node scripts/chaos-multitenant.mjs --runs=10 --minutes=30 --json` reports `{collisions:0, corruptWorktrees:0, doubleClaims:0}`; the unit suite (`novel/tick-loop/src/worker-config.test.ts` + `scripts/chaos-multitenant.test.mjs`) exits 0 pinning the derivation + the Measurement shape.
- **Pivot threshold**: if cross-process O_EXCL flock arbitration proves unreliable on the host FS (a double-claim ever surfaces in the chaos sim or in production), fall back to a single per-machine arbiter daemon that hands out task leases (still no central orchestrator — just a lock broker). The repo+task-scoped claim key stays the lease key under either approach.
- **Measurement**: `node scripts/chaos-multitenant.mjs --runs=10 --minutes=30 --json` returns the pre-registered object `{ collisions, corruptWorktrees, doubleClaims }`, all 0.
- **Literature anchor**: Leach, Mealling & Salz, RFC 4122 §4.4, 2005 (UUID from random — the run-id namespace prefix); Lamport, CACM 1974 (mutual exclusion — the per-(repo,task) lock key); Basiri et al., IEEE Software 2016 (chaos steady-state hypothesis); rule #7 (chaos engineering); rule #6 (a namespace clash never crashes a sibling).

### machine-budget-autoscaler

- **Hypothesis**: a fixed worker count + `ProcessType=Background` either under-uses the box (idle budget) or gridlocks it (20 workers → 0 useful work at runaway load); a budget-matched effective-throughput controller with throttles removed holds utilisation at the operator's % and maximises PRs/hour, auto-finding the saturation knee per host without hand-tuning.
- **Success threshold**: with budget=80 the fleet sustains ≈80% utilisation with effective throughput at/above the hand-tuned 10-worker baseline (PRs produced/merged per hour ≥ baseline) and never gridlocks; with budget=70 (default) it sits at ≈70%. The controller's three regimes (ramp-up, knee-hold, gridlock-backoff) are pinned green by the paired test suite.
- **Pivot threshold**: if the closed-loop controller oscillates (concurrency hunting) in any observation window, fall back to a per-host calibrated constant table (measured knee per core-count) selected by the budget — still no `Background` throttle, still cross-repo-propagated; never revert to a single hand-edited global constant.
- **Measurement**: `pnpm vitest run novel/tick-loop/src/machine-budget-autoscaler.test.ts` exits 0 (ramp-up steps by 1, knee holds, gridlock halves); `node scripts/check-machine-budget.mjs` exits 0 (budget contract pinned, no contradicting throttle); at runtime `node novel/tick-loop/bin/tick-loop.mjs --json` reports `{budgetPct, decision:{target,reason}}` matched against `os.loadavg()`/cores.
- **Literature anchor**: Åström & Murray, *Feedback Systems*, 2008 (closed-loop control); Little 1961 (capacity-bounded throughput); Ries 2011 (pivot-or-persevere); Apple `launchd.plist(5)` (`ProcessType` QoS).

### os-throttle-detect

- **Hypothesis**: OS throttles that contradict the budget (launchd `Background` QoS, positive `Nice`, low fd `ulimit`, stale `MINSKY_*` caps) make the budget physically unreachable and regress silently; a pure detector that flags them AND renders the durable mirror-repo fix closes the "fixed it in-session, lost it next reboot" gap (rule #1 — propagate, don't hand-maintain).
- **Success threshold**: `detectThrottles` flags each of the four throttle kinds against a non-trivial budget and stays clean for a `Standard` host; `renderMirrorTasks` produces one tasks.md-spec block per owning mirror; the gate hard-fails on a `Background` worker plist.
- **Pivot threshold**: if `ProcessType` stops being the throttle that makes the budget unreachable (macOS removes the QoS clamp, or minsky moves workers off launchd), retire the `process-type-background` detector and replace it with one over the new throttle surface — never weaken it to a warning.
- **Measurement**: `pnpm vitest run novel/tick-loop/src/os-throttle-detect.test.ts` exits 0; `node scripts/check-machine-budget.mjs` exits 0; `node scripts/check-machine-budget.test.mjs` (via vitest) confirms the `Background`-fixture fail path.
- **Literature anchor**: Burgess (convergent maintenance / drift detection); Saltzer & Schroeder 1975 (fail-safe defaults — a missing probe is dormant, not a green pass); rule #1 (don't reinvent / hand-maintain).

## Usage

```ts
import { anonymizeFinding, containsPii, renderPreview } from "@minsky/tick-loop";

const anon = anonymizeFinding(rawFinding);
if (containsPii(anon)) throw new Error("redaction missed a leak — aborting submission");
console.log(renderPreview(anon)); // operator approves this exact payload before egress
```

The CLI ([`scripts/submit-finding.mjs`](../../scripts/submit-finding.mjs)) wires this into `minsky submit-finding --preview` (default) and `minsky submit-finding --submit` (preview → `[Y/n]` → `gh issue create` on `fyodoriv/minsky`).

The `gh-auth-classifier` core wraps every per-iteration `gh` / `gh api` call site so a transient GitHub status never crashes the daemon:

```ts
import { classifyGhFailure } from "@minsky/tick-loop";

// `result` is the captured failure of a `gh pr list` / `gh api` spawn.
const verdict = classifyGhFailure({
  status: result.httpStatus, // or omit and pass `stderr` to recover it
  loadBearing: false, // the touches-collision fetch is advisory
  consecutiveAuthFailures: state.ghAuthFailureStreak, // caller tracks this
});
if (verdict.disposition === "crash") throw new Error(verdict.reason); // let-it-crash
logSpan({ failure_class: verdict.failureClass, reason: verdict.reason }); // visible-not-silent
// otherwise: skip the sub-step (skip-substep) or abandon this iteration
// (fail-iteration) — the daemon process stays up either way.
```

The `worker-config` core derives a collision-free per-run namespace so dozens of concurrent `minsky` processes on one machine never clobber each other:

```ts
import { deriveRunNamespace, deriveClaimKey } from "@minsky/tick-loop";

// Each process calls this once at boot (the caller supplies pid + a random
// token; the core stays pure). Every field is keyed by the run-id.
const ns = deriveRunNamespace({ repoPath, pid: process.pid, rand: cryptoRandHex() });
// ns.worktreeDir / ns.branchName / ns.launchdLabel / ns.ledgerPath / ns.port
// are all `<repo-hash>-<pid>-<rand>`-keyed → provably disjoint across runs.

// Cross-process task arbitration: both processes derive the SAME lock path for
// the same (repo, task), so the OS `O_EXCL` create grants it to one winner.
const lock = deriveClaimKey(repoPath, taskId); // open(lock, "wx") → EEXIST loses
```

The `machine-budget-autoscaler` core drives worker concurrency to the operator's machine budget instead of a fixed `--spawn-additional-workers` constant. The I/O edge ([`bin/tick-loop.mjs`](bin/tick-loop.mjs)) gathers the live host state and prints the target:

```ts
import { computeWorkerTarget, resolveMachineBudgetPct } from "@minsky/tick-loop";

const budgetPct = resolveMachineBudgetPct({
  envPct: process.env.MINSKY_MACHINE_BUDGET_PCT, // override
  configPct: cfg.machineBudgetPct, // persistent per-machine
  swarmMode: process.env.MINSKY_SWARM_MODE === "1", // weekly-gated ≤80% ceiling
});
const { target, reason } = computeWorkerTarget({
  budgetPct,
  cores: os.cpus().length,
  loadAvg: os.loadavg()[0],
  recentActiveSubprocs, // measured effective work, never nominal worker count
  recentPrRate,
  lastTargets, // controller history → knee detection
});
// reason ∈ ramp-up | knee-hold | gridlock-backoff | at-budget
```

The `os-throttle-detect` core flags host throttles that make the budget unreachable and renders durable mirror-repo fixes (rule #1):

```ts
import { detectThrottles, renderMirrorTasks } from "@minsky/tick-loop";

const throttles = detectThrottles({ budgetPct, processType, nice, ulimitNofile, staleMinskyCaps });
for (const task of renderMirrorTasks(throttles)) {
  // task.tasksMdPath = "~/apps/dotfiles/TASKS.md" | "~/apps/agentbrew/TASKS.md"
  // append task.taskBlock there so minsky pulls the durable fix, not a one-off
}
```

Run the edge directly: `node novel/tick-loop/bin/tick-loop.mjs --json` (or `MINSKY_MACHINE_BUDGET_PCT=80 MINSKY_SWARM_MODE=1 node … --json` for a swarm window). See [`docs/machine-budget.md`](../../docs/machine-budget.md) for the full budget + propagation runbook.
