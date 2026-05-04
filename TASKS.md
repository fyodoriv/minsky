# Tasks

<!-- policy: Every task starts with a failing test (red), then minimal code to pass (green), then refactor. Define metrics and docs BEFORE writing code. See AGENTS.md. -->
<!-- policy: Every external dependency is accessed through an interface in novel/adapters/. No vendor names in business logic. -->
<!-- policy: When closing a task, remove its entire block. History lives in git log per the tasks.md spec. -->
<!-- policy: Investor / product-manager / growth-analyst personas only run when **Tags** contains business, growth, revenue, customer, or pricing. -->
<!-- policy: Every term used here must appear in vision.md § Glossary or be sourced from a cited paper. New jargon → glossary entry in the same commit. -->
<!-- policy: Per constitutional rule #9 (pre-registered hypothesis-driven development — iron rule), every new task entry MUST include — in addition to the existing Details / Files / Verification / Acceptance / Risk fields — a runnable Measurement command (shell / OTEL query / CI script that produces the metric) and an explicit Pivot threshold (the value below which the *approach* is abandoned, not just the change reverted). The rule is iron: no exemption for bugfixes, refactors, or "small" fixes — a bugfix declares the stability metric (error rate, recurrence count, MTTR, etc.) it expects to move and by how much. If the metric source doesn't exist yet, ship a preparation PR first that lands the instrumentation. Vanity metrics (counts that always go up — LOC, commits, hours, tasks-in-flight) and post-hoc metrics (chosen after the result) are forbidden. Existing tasks predating rule #9 are retrofitted under task `rule-9-backfill-existing-tasks`. -->
<!-- policy: Per constitutional rule #8 (pattern conformance), every new top-level artifact (file under novel/ or distribution/, root-level *.md, novel pnpm workspace package) requires a row in vision.md § Pattern conformance index in the same commit. -->
<!-- policy: Per constitutional rule #7 (chaos engineering), every new novel package's README and every new user-story includes a "Failure modes & chaos verification" section with steady-state hypothesis, blast radius, operator escape hatch, and a failure-mode table (failure mode | trigger / fault axis | expected behavior — loud-crash-supervisor-restart / circuit-break-and-notify / graceful-degrade | chaos test). -->

## P0

(empty — work the highest-priority unblocked item from P1.)

## P1

<!-- The first three P1 tasks below operationalise constitutional rule #9's automation layer (per-PR runner / weekly-monthly tracker / quarterly calibration). The next eight operationalise rule #10 (deterministic enforcement — every rule is a CI lint, not a hope). They are intentionally bundled at P1 because rules #9 and #10 are iron and a rule without its lint is a rule on the honour system. -->

- [ ] File OMC issue proposing native tasks.md integration
  - **ID**: omc-tasksmd-issue
  - **Tags**: community, integration
  - **Estimate**: 1h
  - **Blocked**: needs-user-approval — `gh issue create` against a third-party repo is blocked-by-default per the `/next-task` skill. User must either approve in-session or file the issue themselves.
  - **Hypothesis**: An issue framed as "ecosystem alignment with the tasks.md spec" (with line-level citations in OMC source) lands tasks.md adoption upstream and obsoletes our `omc-tasksmd-bridge-v0`.
  - **Details**: Open an issue at <https://github.com/Yeachan-Heo/oh-my-claudecode/issues> proposing that `/team` mode optionally reads from a `TASKS.md` at repo root following the [tasks.md spec](https://github.com/tasksmd/tasks.md). High-leverage community contribution — if accepted, lands tasks.md in 31k+ developer workflows.
  - **Verification**: `gh issue view <url> --repo Yeachan-Heo/oh-my-claudecode` returns the filed issue; URL added to `research.md` and `competitors/omc.md`
  - **Measurement**: `gh issue view <url> --repo Yeachan-Heo/oh-my-claudecode --json state,reactionGroups --jq '.state, ([.reactionGroups[] | select(.content == "THUMBS_UP") | .users.totalCount] // [0] | add)'` — first line "OPEN", second line ≥3 thumbs-up within 14 days indicates community resonance.
  - **Pivot**: if the issue is closed `not-planned` or stays at <2 reactions for 30 days → don't escalate; instead invest in `omc-tasksmd-bridge-v0` and treat OMC adoption as out-of-reach.
  - **Acceptance**: Issue filed; URLs linked from `research.md` and `competitors/omc.md`
  - **Anchor**: Raymond, *The Cathedral and the Bazaar*, 1999 (community contribution as scaling lever); rule #1 (don't reinvent the wheel — push upstream when possible).
  - **Risk**: Maintainer may reject if framed as a Minsky-specific need. Frame as "ecosystem alignment with the tasks.md spec" with concrete code-level changes pinned to specific OMC files.

- [ ] `claude-budget-guard` v0 — full package shipped + extracted
  - **ID**: budget-guard-v0
  - **Tags**: novel, extraction-target, parent
  - **Estimate**: tracker — see sub-tasks
  - **Blocked by**: budget-guard-maciek-impl, budget-guard-publish-dry-run
  - **Hypothesis**: The decomposed sub-tasks (core decision logic, flag-file envelope, HTTP envelope, Maciek strategy, dry-run) compose into a working budget-guard that user-story 004 (`budget-auto-pause`) drives end-to-end without further integration glue.
  - **Details**: This PR (the core decision logic + watchdog loop + tests) shipped under the same name; sub-tasks below ship the runtime envelopes (flag file, HTTP API, real Maciek Strategy) plus the npm dry-run. When the last sub-task lands, the full package is shipped and this tracker is removed.
  - **Verification**: all four sub-tasks below complete; integration test for `user-stories/004-budget-auto-pause.md` passes against the assembled package.
  - **Measurement**: `pnpm vitest run user-stories/004-budget-auto-pause.test.ts` exits 0 once the prerequisite sub-tasks ship; before that, count of merged PRs with title prefix `feat: @minsky/budget-guard` should be ≥4 — `gh pr list --state merged --search 'in:title @minsky/budget-guard' --json number --jq length` ≥ 4.
  - **Pivot**: if any sub-task discovers the original epic-level shape is wrong (e.g., flag-file model is too coarse for the dashboard, or the Maciek cache format makes the Strategy interface unworkable), revisit the parent acceptance and split into a new epic before continuing the chain.
  - **Acceptance**: tracker task removed once all four sub-tasks merge.
  - **Anchor**: Beyer et al., *Site Reliability Engineering*, 2016, Ch. 3 (error budgets); watchdog-timer literature (hardware / OS).

- [ ] `@minsky/token-monitor` — Maciek `claude-monitor` Strategy implementation
  - **ID**: budget-guard-maciek-impl
  - **Tags**: novel, extraction-target
  - **Parent**: budget-guard-v0
  - **Estimate**: 4–6h
  - **Hypothesis**: claude-monitor 3.1.0 (PyPI, pinned in `.github/workflows/ci.yml` `maciek-smoke` job) reads its data from `~/.config/claude/`. A thin adapter that reads the same Anthropic-managed config files (bypassing Maciek's CLI, since claude-monitor 3.1.0 has no `--json` output) can derive a deterministic `tokensRemainingInWindow` and `observedAt`; `weeklyHeadroomFraction` is left `null` in v0 because Maciek's ML predictor is not exposed. The adapter's deterministic counts match Maciek's `--view realtime` displayed values to within 1 % across 100 consecutive ticks (verified by a parser test against snapshotted Maciek terminal output, not by shelling out to Maciek itself).
  - **Details**: Real `TokenMonitor` Strategy against the same data Maciek reads — `~/.config/claude/` (Anthropic's config dir for Claude Code). Polls the directory, parses, returns `TokenSnapshot`. Adapter test verifies the parser against committed fixtures rather than a live Maciek install — Maciek's role in CI is to serve as a *cross-check* (the `maciek-smoke` job confirms the upstream tool is installable, not that we depend on its stdout). **Why this changed from the prior brief**: the prior brief assumed `claude-monitor --json` exists; the rule-#9 preparation PR (CI smoke + research note) discovered it doesn't (claude-monitor 3.1.0 only exposes `--view {realtime,daily,monthly}` and `--version`). See `research.md` § "Token monitor — `TokenMonitor`" for the full finding and the two upstream options weighed.
  - **Files**: `novel/adapters/token-monitor/src/maciek.ts`, `novel/adapters/token-monitor/src/maciek.test.ts`, `novel/adapters/token-monitor/test/fixtures/claude-config-snapshot/` (committed Anthropic config-dir fixture).
  - **Verification**: `new MaciekTokenMonitor({ configDir: <fixture> }).snapshot()` returns a `TokenSnapshot` whose `tokensRemainingInWindow` matches the value visible in the paired Maciek `--view realtime` snapshot for the same fixture.
  - **Measurement**: `pnpm vitest run novel/adapters/token-monitor/src/maciek.test.ts` exits 0 against the committed fixture; assertion: `Math.abs(snapshot.tokensRemainingInWindow - fixture.maciekRealtimeReportedRemaining) / fixture.maciekRealtimeReportedRemaining < 0.01`. The CI smoke job (`maciek-smoke`) separately verifies that `claude-monitor==3.1.0` installs and reports `3.1.0` for `--version`, anchoring the upstream cross-check.
  - **Pivot**: if Anthropic's `~/.config/claude/` format changes more than once in a 90-day window — pivot to filing an upstream feature request for a `--json` mode in claude-monitor (rule #1: push upstream first), and only as a last resort write our own cache-tap by hooking the Claude Code API client.
  - **Acceptance**: Maciek-backed `TokenMonitor.snapshot()` round-trips real cache values; integration test passes; pattern conformance row updated.
  - **Anchor**: Gamma et al., *Design Patterns*, 1994 (Adapter / Strategy); Meszaros, *xUnit Test Patterns*, 2007 (test fake / real-implementation contract test).
  - **Risk**: Maciek's format changes upstream. Mitigation: pin a specific Maciek version in the adapter test; gate updates with the test (rule #7 chaos discipline).

- [ ] `@minsky/budget-guard` + `@minsky/token-monitor` — npm publish dry-run + extraction
  - **ID**: budget-guard-publish-dry-run
  - **Tags**: extraction, publish
  - **Parent**: budget-guard-v0
  - **Blocked by**: budget-guard-maciek-impl
  - **Estimate**: 1h
  - **Hypothesis**: The two packages already declare correct `files`, `main`, `types`, and `exports`; a dry-run produces tarballs whose contents match the documented manifest (no source maps, no tsconfig, no test files) and whose total size is <100 KB each.
  - **Details**: Run `pnpm publish --dry-run --workspace novel/budget-guard` and the same for `@minsky/token-monitor`; ensure the published artifact has the right `files`, `main`, `types`, and a matching `README.md`. Publish under the `@minsky/*` scope when ready (separate manual step — `npm publish` is blocked-by-default per the `/next-task` skill, so this task only does the dry-run).
  - **Files**: `novel/budget-guard/package.json`, `novel/adapters/token-monitor/package.json`
  - **Verification**: dry-run output lists the documented files only (no `dist/*.d.ts.map`, no `tsconfig.json`); `gh pr` description records the dry-run output.
  - **Measurement**: `pnpm publish --dry-run --workspace novel/budget-guard 2>&1 | grep -c '\.tgz'` returns 1; `pnpm publish --dry-run --workspace novel/adapters/token-monitor 2>&1 | grep -c '\.tgz'` returns 1; `pnpm publish --dry-run --workspace novel/budget-guard 2>&1 | awk '/package size/{print $3}'` < 102400.
  - **Pivot**: if either package's dry-run tarball exceeds 100 KB or includes files outside the manifest, the `files` field is misconfigured — audit and tighten before publishing under `@minsky/*`. If after audit the size still exceeds 100 KB, the package is too coarse and should be split.
  - **Acceptance**: Both packages dry-run cleanly; PR description records the published filenames + sizes.
  - **Anchor**: Wiggins, *The Twelve-Factor App*, 2011 (factor V — build, release, run; the published artifact is the release contract).
  - **Risk**: TS declaration files reference cross-package types. Mitigation: ensure `composite: true` + `references` is set everywhere (already done for token-monitor / budget-guard).

## P2

<!-- spec-monitor-skill and its successor `spec-monitor-deterministic-rewrite` both shipped: the deterministic linters under `scripts/check-rule-{1..7}-*.mjs` + `scripts/check-pattern-index.mjs` + `scripts/check-pr-self-grade.mjs` carry the load-bearing share of runtime verification (rule #10's enforcement model), and the residual judgement-heavy scope ships as the advisory-only Claude Skill at `novel/spec-monitor/SKILL.md` — capped at ≤5 advisory rules per the rule-#10 ratchet. See `vision.md` § "Pattern conformance index" rows 11 and 35. -->

- [ ] Implement `omc-tasksmd-bridge` v0
  - **ID**: omc-tasksmd-bridge-v0
  - **Tags**: novel, extraction-target, bridge
  - **Estimate**: 1–2d (scales with the persistence answer)
  - **Blocked by**: research-omc-handoff-persistence
  - **Hypothesis**: Bidirectional sync between tasks.md (canonical) and OMC's internal task list survives a 100-trial round-trip property test (random TASKS.md → push to OMC → pull back → byte-equal modulo whitespace) and propagates a claim in either direction within 1 scheduler iteration.
  - **Details**: Bidirectional sync between tasks.md (canonical) and OMC's internal task list. Goes away when OMC adopts tasks.md upstream — the success metric for this package is "this package becomes unnecessary."
  - **Files**: `novel/bridges/omc-tasksmd/`
  - **Verification**:
    - Round-trip property test: arbitrary `TASKS.md` → push to OMC → pull back → diff against original is empty (modulo whitespace)
    - End-to-end: claim a task in OMC; observe it claimed in `TASKS.md` within 1 scheduler iteration; vice versa
  - **Measurement**: `pnpm vitest run novel/bridges/omc-tasksmd/src/round-trip.property.test.ts` exits 0 with ≥100 passed property cases; `pnpm vitest run novel/bridges/omc-tasksmd/src/claim-propagation.e2e.test.ts` exits 0.
  - **Pivot**: if the round-trip property test cannot reach 95 % pass rate at 100 trials due to OMC field shape divergence (lossy fields, encoding incompatibilities), the bridge isn't viable; pivot to one-way sync (TASKS.md → OMC only) and document the asymmetry, OR escalate `omc-tasksmd-issue` to push spec adoption upstream.
  - **Acceptance**: Round-trip preserves all task fields; integration test for both directions passes; published as `@minsky/omc-tasksmd-bridge`
  - **Anchor**: Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (eventual consistency / convergence under bidirectional sync); Hewitt 1973 (actor model — TASKS.md as the message store).
  - **Risk**: Bridge becomes unnecessary upstream — keep scope minimal; don't over-engineer for features OMC may absorb.

- [ ] First user-story integration test passes (001)
  - **ID**: first-integration-test
  - **Tags**: testing, validation
  - **Estimate**: 6h
  - **Blocked by**: budget-guard-v0
  - **Hypothesis**: A 60-minute compressed simulation reproduces the failure modes that matter for an 8h overnight run with ≥80 % coverage of the failure-mode rows declared in the user-story file, while keeping CI runtime under 10 minutes.
  - **Details**: Implement integration test for `user-stories/001-loop-runs-overnight.md`. Compressed simulation, 60-minute window standing in for an 8h overnight run.
  - **Verification**: `npm test user-stories/001-loop-runs-overnight.test.ts` passes locally and on CI; OTEL collector receives ≥1 span per task type; CI workflow shows green
  - **Measurement**: `pnpm vitest run user-stories/001-loop-runs-overnight.test.ts` exits 0; `gh run list --workflow ci.yml --status success --limit 1 --json durationMS --jq '.[0].durationMS'` < 600000 (10 min); OTEL collector replay shows ≥1 span per declared task type.
  - **Pivot**: if the 60-min sim's CI runtime exceeds 10 min OR misses >2 of the user-story's failure modes → reframe as a pair (10-min smoke in CI + nightly self-hosted run that does the full 60-min). If neither works, the story's overnight assumption is wrong and the story needs splitting.
  - **Acceptance**: Test passes; metrics emit valid OTEL; CI green
  - **Anchor**: Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016 (steady-state hypothesis); Beck, *Extreme Programming Explained*, 1999 (CI keeps the build fast).
  - **Risk**: 60min compressed sim may miss real overnight failure modes (memory leaks, log rotation, OS sleep). Document the gap; plan a quarterly real-overnight test.

- [ ] Apple Shortcuts JSON for Watch surface
  - **ID**: watch-shortcuts
  - **Tags**: novel, ux
  - **Estimate**: 4–6h
  - **Blocked by**: budget-guard-v0
  - **Hypothesis**: Three Apple Shortcuts (tokens-remaining, last-task-status, constraint-of-the-week) polling the local Tailscale-reachable JSON API render in <2 s p95 on Watch and keep the user's wrist-dwell metric (success #6) at ≤60 s/day average over a 7-day window.
  - **Details**: Three Shortcuts: tokens-remaining, last-task-status, constraint-of-the-week. Each polls the local Tailscale-reachable JSON API. Plus a pause/resume Shortcut.
  - **Files**: `distribution/shortcuts/`
  - **Verification**:
    - Shortcuts JSON imports cleanly via iCloud/AirDrop on iOS 17+
    - Each Shortcut, run on Watch, completes in <2s end-to-end
    - Pause Shortcut writes a sentinel file the supervisor honors within 1 scheduler iteration
  - **Measurement**: `pnpm vitest run user-stories/005-three-numbers-watch.test.ts` exits 0; user-story 002 pause integration test exits 0; manual measurement on real Watch over 7 days: `count(http_get_total{path="/watch.json"}[7d]) * 2` (constant ≈ 2 s/poll) ≤ 420 (avg ≤60 s/day).
  - **Pivot**: if Watch p95 latency exceeds 2 s sustained 7 days OR wrist-dwell exceeds 90 s/day for 14 consecutive days → Apple Shortcuts has hit its complexity ceiling; escalate to `native-watchos-app`.
  - **Acceptance**: Shortcuts importable on iPhone; visible on Watch; integration test for user-story 002 (pause from iPhone) passes; integration test for user-story 005 (three-numbers Watch) passes
  - **Anchor**: Card & Mackinlay, *Readings in Information Visualization*, 1999 (glanceable display: three numbers, no chrome); Weiser & Brown, "Calm Technology", 1995.
  - **Risk**: Apple Shortcuts complexity ceiling — track wrist-dwell metric (success #6); if it climbs, escalate to `native-watchos-app`.

- [ ] Web dashboard v0
  - **ID**: dashboard-web-v0
  - **Tags**: novel, ux
  - **Estimate**: 1–2d
  - **Hypothesis**: A ≤300-line Hono SSR web app reading the OTEL backend through `@minsky/observability` renders all 10 success metrics from `vision.md` with first-paint <1 s on iPhone over Tailscale and Lighthouse Mobile score ≥90.
  - **Details**: Hono or similar minimal web app, ~300 lines. Reads OTEL backend through Observability adapter. Mobile-friendly. Reachable via Tailscale. Shows the 10 success metrics from `vision.md`.
  - **Verification**:
    - `curl localhost:8080/` returns SSR HTML with all 10 metrics
    - Lighthouse Mobile score ≥90 in CI
    - Tailscale-reachable URL loads in <1s on iPhone (manual)
  - **Measurement**: `curl -s localhost:8080/ | grep -c 'data-metric-id='` returns 10; `npx -y lighthouse@12 http://localhost:8080/ --preset=mobile --quiet --output=json | jq '.categories.performance.score'` ≥ 0.9; `wc -l novel/dashboard-web/src/*.ts` ≤ 300.
  - **Pivot**: if the line cap is breached >50 % to satisfy the metric requirements (>450 LoC), Hono is the wrong shape for "≤300 lines and 10 metrics"; pivot to a thin Astro static-site-generator or a server-rendered template-only approach without a JS runtime.
  - **Acceptance**: All 10 vision.md success metrics visible; loads in <1s on iPhone over Tailscale; passes Lighthouse mobile usability
  - **Anchor**: Card & Mackinlay 1999 (information visualization); Wilkie, "RED Method", 2018 (rate / errors / duration as the right service-level lens).
  - **Risk**: Scope creep into a "real" dashboard. Cap line count; refuse new features without removing one.

## P3

- [ ] `traceparent-subagent-propagation-test` — chaos test for OTEL TRACEPARENT propagation across subagent boundaries
  - **ID**: traceparent-subagent-propagation-test
  - **Tags**: testing, observability, chaos
  - **Estimate**: 3h
  - **Hypothesis**: A subprocess that does not honour `OTEL_PROPAGATORS` breaks TRACEPARENT propagation silently — a single unit test that spawns such a subprocess and asserts the parent / child trace ids diverge would have surfaced this regression in <1 CI run, where today the failure is invisible until a manual trace-graph inspection.
  - **Details**: Add a `test/traceparent-subagent.test.ts` file under `novel/adapters/observability/` that spawns a subprocess with `OTEL_PROPAGATORS=` (empty) and asserts the child span's `traceparent` differs from the parent's. The test fixture is a small Node script that emits one span via `@opentelemetry/api` and writes the resulting traceparent to stdout. Surfaced from the `mape-k-knowledge-and-integration` PR's resilience-scout pass — the observability README's row 4 now defers to this task.
  - **Files**: `novel/adapters/observability/test/traceparent-subagent.test.ts`, `novel/adapters/observability/test/fixtures/emit-traceparent.mjs`
  - **Verification**: `pnpm vitest run novel/adapters/observability/test/traceparent-subagent.test.ts` exits 0 with ≥1 assertion that proves divergence under the empty-propagator config and convergence under the default config.
  - **Measurement**: `pnpm vitest run novel/adapters/observability/test/traceparent-subagent.test.ts --reporter=json | jq -e '.numPassedTests >= 1 and .numFailedTests == 0'`.
  - **Pivot**: if the test cannot be made deterministic on GH-hosted runners (e.g., the subprocess inherits a propagator from the harness in some configurations), pivot to recording the OS-level env-var diff and asserting on that instead of on the trace ids.
  - **Acceptance**: chaos test ships; the deferred row in `novel/adapters/observability/README.md` is updated to point at the test file.
  - **Anchor**: rule #7 (vision.md § 7 — chaos engineering); Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016 (steady-state hypothesis); OpenTelemetry specification (CNCF 2020+, propagator contract).
  - **Risk**: Subprocess-level env tests can be flaky on Windows / shared CI sandboxes. Mitigation: gate on `process.platform !== 'win32'` and document the carve-out.

- [ ] `mape-k-cost-schedule-from-vision` — wire per-rule cost weights from vision.md into `analyze`'s `costs` argument
  - **ID**: mape-k-cost-schedule-from-vision
  - **Tags**: novel, mape-k, follow-up
  - **Estimate**: 2h
  - **Hypothesis**: Goldratt's flat product `violationCount × 1` over-collapses high-frequency low-cost rules (typo lints) against rare high-cost rules (rule-#9 misses). A per-rule cost schedule sourced from a numbered table in `vision.md` § "Pattern conformance index" — read once at startup by the CLI wrapper around `tick(...)` — restores the severity ordering without an API change (the `costs` arg is already the seam).
  - **Details**: Add a small parser that reads a new `## Cost schedule` section in `vision.md`, validates the keys are known ruleIds, and produces the `CostSchedule` map `analyze` consumes. Pure function; CLI is the I/O boundary. Integration test asserts that with the schedule, a high-volume `rule-typo` cannot outrank a single `rule-9` violation. Surfaced from the `mape-k-knowledge-and-integration` PR.
  - **Files**: `novel/mape-k-loop/src/cost-schedule.ts`, `novel/mape-k-loop/src/cost-schedule.test.ts`, `vision.md` (new `## Cost schedule` table)
  - **Verification**: `pnpm vitest run novel/mape-k-loop/src/cost-schedule.test.ts` exits 0; the integration test from user-story 003 still passes once the schedule is plumbed into `tick`.
  - **Measurement**: `pnpm vitest run novel/mape-k-loop/src/cost-schedule.test.ts user-stories/003-mape-k-improves-prompts.test.ts --reporter=json | jq -e '.numPassedTests >= 5 and .numFailedTests == 0'`.
  - **Pivot**: if the schedule is too rigid (every PR adds a new rule, the table goes stale), pivot to a heuristic over rule severity ranges sourced from each rule's own README.
  - **Acceptance**: schedule parser ships; `tick(...)` consumes it; vision.md row 54 notes column updated to mark `costEstimate` full-conformance.
  - **Anchor**: Goldratt, *The Goal*, 1984 (Theory of Constraints); rule #4 (vision.md § 4 — every constant in source).
  - **Risk**: Bikeshedding the weight numbers. Mitigation: ship a defensible v0 (rule-#9 = 100, rule-#7 = 50, rule-typo = 1) and revisit at the next quarterly review.

- [ ] `mape-k-constraints-md-size-cap` — CI lint capping `constraints.md` size before it goes unreadable
  - **ID**: mape-k-constraints-md-size-cap
  - **Tags**: ci, mape-k, follow-up
  - **Estimate**: 1h
  - **Hypothesis**: `novel/mape-k-loop/constraints.md` is append-only — without a size cap it grows unbounded. A CI lint that fires when the file exceeds 200 entries (the brief's pivot threshold) forces an archive split before the live log becomes unreadable.
  - **Details**: Add `scripts/check-mape-k-constraints-md-size.mjs` — a pure function `checkConstraintsMdSize({ content, capEntries })` that counts `## <date>` headings and exits 1 when the count exceeds the cap. CLI is the I/O boundary. Surfaced from the `mape-k-knowledge-and-integration` PR's resilience-scout pass.
  - **Files**: `scripts/check-mape-k-constraints-md-size.mjs`, `scripts/check-mape-k-constraints-md-size.test.mjs`, `.github/workflows/ci.yml`
  - **Verification**: synthetic constraints.md with 199 entries → exit 0; with 201 entries → exit 1 with a clear "split into archive" suggestion.
  - **Measurement**: `pnpm vitest run scripts/check-mape-k-constraints-md-size.test.mjs --reporter=json | jq -e '.numPassedTests >= 2 and .numFailedTests == 0'`.
  - **Pivot**: if the 200 cap proves arbitrary (the file is still readable at 400), raise the cap rather than removing the lint.
  - **Acceptance**: lint ships; CI runs it; the README's follow-up note is removed.
  - **Anchor**: rule #10 (vision.md § 10 — deterministic enforcement); Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (immutable-log archive split).
  - **Risk**: Cap timing — too tight forces premature archive splits, too loose is theatre. Mitigation: ship the brief's documented 200 default; revisit if the archive cadence diverges from quarterly.

- [ ] Quarterly dependency review (Q3 2026)
  - **ID**: review-q3-2026
  - **Tags**: governance
  - **Estimate**: 1d (when due)
  - **Hypothesis**: A quarterly scan of all 14 deps + 5 novel layers surfaces ≥1 dependency whose situation changed materially since the last review (new alternative, deprecation, security advisory) — enough to justify the review's standing existence per rule #1. *Additionally*, the quarterly review reads `validated-learnings.md` and the experiment-tracker verdict log, summarising the calibration of rule #9's predictions (predicted Δ vs observed Δ by hypothesis category) — closing rule #9's quarterly automation layer for any window the MAPE-K loop has not yet covered.
  - **Details**: Per vision.md principle 1, scan all 14 deps and 5 novel layers; reconsider choices. Append to `research.md` "Quarterly review log". **Rule-#9 quarterly-layer scope:** the review's standing checklist now includes (a) total experiments tracked, (b) % `validated`/`regressed`/`inconclusive`, (c) calibration table (mean predicted Δ vs mean observed Δ, grouped by hypothesis category — feature / refactor / bugfix / docs), (d) rule-#9 amendment proposals if any category is systematically miscalibrated.
  - **Verification**: `research.md` has a 2026-Q3 entry under "Quarterly review log" with one line per dep + one line per novel layer
  - **Measurement**: `awk '/^### 2026-Q3/{flag=1; next} /^### /{flag=0} flag' research.md | grep -c '^- '` ≥ 19 (14 deps + 5 novel layers); follow-up tasks filed for any dep flagged → `gh issue list --label dep-review --search '2026-Q3'` recorded in the entry.
  - **Pivot**: if 3 consecutive quarterly reviews surface zero material changes, drop the cadence to semi-annual; if a review surfaces ≥3 material changes, raise to bi-monthly until the rate normalises.
  - **Acceptance**: research.md updated with findings; any dep changes filed as separate P1/P2 tasks
  - **Anchor**: rule #1 (don't reinvent the wheel); Fowler, *Refactoring*, 1999 (review cadence as a refactoring discipline at the architectural scale).
  - **Risk**: Skipped if no calendar reminder set. Add a calendar event before this task is due.

- [ ] OMC handoff persistence proposal upstream (conditional)
  - **ID**: omc-persistence-proposal
  - **Tags**: community
  - **Estimate**: 1–2h
  - **Blocked by**: research-omc-handoff-persistence
  - **Blocked**: needs-user-approval — `gh issue create` / `gh pr create` against a third-party repo is blocked-by-default per the `/next-task` skill. Conditional task: only unblocks if `research-omc-handoff-persistence` finds non-parseable AND the user pre-approves the upstream filing.
  - **Hypothesis**: An upstream proposal for a parseable handoff artifact in OMC is accepted (or seriously discussed) within 30 days of filing, removing the need for `omc-tasksmd-bridge`'s reverse-engineering layer.
  - **Details**: If P0 research finds OMC handoffs are not parseable, file upstream issue/PR adding parseable artifact.
  - **Verification**: `gh issue view` / `gh pr view` returns the filed item; URL recorded in `research.md`
  - **Measurement**: `gh issue view <url> --repo Yeachan-Heo/oh-my-claudecode --json state,comments --jq '.state, (.comments | length)'` — first line "OPEN" within 30 days, second line ≥1 (maintainer engagement).
  - **Pivot**: if the issue is closed `not-planned` or stays at zero engagement for 30 days → reverse-engineer in `omc-tasksmd-bridge-v0` and accept the maintenance burden until OMC absorbs the spec organically.
  - **Acceptance**: Issue/PR filed; linked from research.md
  - **Anchor**: Raymond, *The Cathedral and the Bazaar*, 1999.
  - **Risk**: Conditional — only fires if P0 research finds non-parseable. If parseable, this task is removed instead of completed.

- [ ] Resolve OMC handoff persistence question
  - **ID**: research-omc-handoff-persistence
  - **Tags**: research
  - **Estimate**: 2–3h (read source + experiment)
  - **Blocked**: needs-user-approval — task involves running OMC plugin commands locally (invasive machine state) and, conditionally, filing a GitHub issue at `Yeachan-Heo/oh-my-claudecode` (`gh issue create` is blocked-by-default per `/next-task` skill). User to either confirm in-session approval and unblock, or perform the public-surface action themselves and record the URL in research.md.
  - **Hypothesis**: OMC persists handoffs to disk in a parseable enough format (JSON / YAML / structured markdown) that `omc-tasksmd-bridge-v0` can be a thin reader rather than a reverse-engineered scraper.
  - **Details**: Determine whether OMC's "shared task list" persists to disk in a parseable format, or only in process memory. Read OMC source; experiment by running `/team N:role` and checking the working tree + `~/.claude/` for new artifacts. Determines complexity of `omc-tasksmd-bridge`.
  - **Files**: `research.md`, `competitors/omc.md`
  - **Verification**:
    - `grep -RInE 'writeFileSync|saveTo|persist|JSON\.stringify' <omc-checkout>/` and triage hits
    - Run OMC `/team 2:executor` against a throwaway repo, then `find . ~/.claude -newer /tmp/.start_marker` to spot any artifacts
  - **Acceptance**:
    - `research.md` has a "OMC handoff persistence" subsection: yes/no/partial, file path(s), format, parseability assessment
    - If not parseable: GitHub issue filed at `Yeachan-Heo/oh-my-claudecode` requesting a parseable artifact, URL recorded in research.md
  - **Measurement**: `grep -c '^## OMC handoff persistence' research.md` returns 1; the section's verdict line matches `^- \*\*Verdict\*\*: (parseable|partial|not-parseable)$`. Round-trip check: if "parseable", `node scripts/omc-roundtrip.mjs --omc-checkout=<path>` exits 0 (parses an OMC artifact, re-emits, and the diff is whitespace-only).
  - **Pivot**: if the verdict is "not-parseable" and the parseable-by-construction route fails (`omc-persistence-proposal` rejected), the bridge work shifts from "thin reader" to "full reverse-engineering"; raise `omc-tasksmd-bridge-v0`'s estimate to ≥1 week and consider deprioritising the bridge entirely.
  - **Anchor**: Aho-Sethi-Ullman, *Compilers*, 1986 (round-trip property as the parseability test); rule #2 (every dep behind interface — bridge is exactly that).
  - **Risk**: OMC may persist in an opaque format (e.g., serialized in-process state) that only resembles parseable on the surface — verify with a round-trip parse, not eyeballing.

- [ ] `audit-spec-monitor-coverage-q3-2026` — Q3 2026 quarterly audit of spec-monitor advisory rules (due 2026-08-03)
  - **ID**: audit-spec-monitor-coverage-q3-2026
  - **Tags**: audit, conformance, rule-10
  - **Estimate**: 30m / quarter
  - **Hypothesis**: A quarterly read-through of `novel/spec-monitor/SKILL.md`'s ≤5 advisory rules, comparing each against the current `scripts/check-rule-*.mjs` lints (and any newly-shipped `ci-lint-*` linters since the Q2 2026 audit), catches scope-creep before the Skill becomes load-bearing — preserving rule #10's "deterministic checks are authoritative" invariant. Quarterly cadence is the Risk-mitigation note from the original `audit-spec-monitor-coverage` task.
  - **Details**: Re-read SKILL.md. For each advisory rule, ask: "could this be a deterministic linter today, given any new lints shipped since Q2 2026?" If yes, file a follow-up `ci-lint-*` task and (only after the linter ships) remove the advisory rule from SKILL.md per rule #10's ratchet. Confirm rule count ≤5. Compare against the previous audit at `spec-advisories/2026-05-03-quarterly-audit.md`: if the same rules promoted then are still open AND new ones promote now, fire the pivot (reduce cap to 3). After running the audit, file the next quarterly task (`audit-spec-monitor-coverage-q4-2026`).
  - **Files**: `novel/spec-monitor/SKILL.md`, `spec-advisories/2026-08-03-quarterly-audit.md` (or whatever date the audit runs)
  - **Verification**: SKILL.md has ≤5 rules (mechanically enforced by `scripts/check-skill-rule-cap.mjs`); `spec-advisories/<audit-date>.md` exists with rule count and per-rule decisions; any deterministic-candidate filed as a `ci-lint-*` task with full Hypothesis/Success/Pivot/Measurement/Anchor; the Q4 2026 audit task is filed.
  - **Measurement**: `test -f spec-advisories/2026-08-03-quarterly-audit.md && grep -q 'Rule count' spec-advisories/2026-08-03-quarterly-audit.md && grep -q 'audit-spec-monitor-coverage-q4-2026' TASKS.md`
  - **Pivot**: if this audit AND the Q2 2026 audit both promoted ≥1 rule AND the Q2 candidates are still open, the Skill is leaking scope — reduce cap from 5 to 3 in `novel/spec-monitor/SKILL.md` (and update `scripts/check-skill-rule-cap.mjs` accordingly).
  - **Acceptance**: Audit run; SKILL.md compliant; any conversions filed; Q4 task scheduled.
  - **Anchor**: rule #10 (vision.md § 10); Munafò et al., *Nature Human Behaviour* 1, 0021, 2017 (pre-registration of audit pivot before result is observed).
  - **Risk**: Audit forgotten. Mitigation: the next-task standing-loop convention reminds; the previous audit file at `spec-advisories/2026-05-03-quarterly-audit.md` records the cadence.

- [ ] `ci-lint-watch-surface-cap` — CI lint enforcing the 3-value cap on the Watch surface (story 005)
  - **ID**: ci-lint-watch-surface-cap
  - **Tags**: ci, conformance, rule-10
  - **Estimate**: 1h
  - **Hypothesis**: `vision.md` row 12 says the Watch surface is "three values, no chrome; design discipline forbids a fourth" (story 005, anchored to Card & Mackinlay 1999 + Weiser & Brown 1995). Today the cap is prose-only — a future change to the watch JSON contract or the dashboard renderer can silently grow a fourth metric. A tiny linter that counts the value-fields in the watch contract (or the watch JSON fixture) and fails if `> 3` mechanically preserves the calm-tech invariant. Surfaces during `ci-lint-skill-rule-cap`'s resilience scout (PR #ci-lint-skill-rule-cap).
  - **Details**: Locate the canonical watch contract (likely `user-stories/005-*.md` and/or the dashboard adapter when it ships). Count the declared value-fields. Fail if `> 3`. Mirror the `check-skill-rule-cap.mjs` shape: pure function + thin CLI wrapper + paired tests + CI job.
  - **Files**: `scripts/check-watch-surface-cap.mjs`, `scripts/check-watch-surface-cap.test.mjs`, `.github/workflows/ci.yml`
  - **Verification**: synthetic contract with 4 fields → exit 1; same with 3 → exit 0; missing contract → exit 0 (story not yet implemented).
  - **Measurement**: `pnpm vitest run scripts/check-watch-surface-cap.test.mjs` exits 0 with ≥4 cases.
  - **Pivot**: if story 005's ship-shape changes such that the "three numbers" become a single composite gauge (different cap shape), retire this lint and write the new one against the shipped artefact.
  - **Acceptance**: CI job runs; the 3-value cap is mechanically enforced on every PR.
  - **Anchor**: rule #10; vision.md row 12 (Card & Mackinlay 1999; Weiser & Brown 1995).
  - **Risk**: The watch contract's exact location / shape isn't fixed yet (story 005 is not shipped). Mitigation: defer until the contract lands; the linter ships in the same PR as the contract.

- [ ] `ci-lint-mape-k-token-budget-cap` — CI lint enforcing the ≤5.7% MAPE-K weekly token budget cap (ARCHITECTURE.md)
  - **ID**: ci-lint-mape-k-token-budget-cap
  - **Tags**: ci, conformance, rule-10, observability
  - **Estimate**: 2h
  - **Hypothesis**: `ARCHITECTURE.md` § "MAPE-K cadence" caps the loop's token cost at ≤5.7% of the weekly Max5 budget. Today the cap is prose-only — when `claude-mape-k-loop` v0 ships, drift past 5.7% will be invisible without a linter. A linter that reads `config/mape-k.json` (or the live `mape-k-loop` self-calibration record) and asserts the projected weekly cost / weekly budget ≤ 0.057 mechanically prevents budget creep. Surfaces during `ci-lint-skill-rule-cap`'s resilience scout.
  - **Details**: Add `scripts/check-mape-k-budget-cap.mjs` keyed off the post-`claude-mape-k-loop` artefact (likely `config/mape-k.json` plus the budget snapshot). Pure function `checkMapeKBudgetCap({ config, weeklyBudgetTokens })`; CLI is the I/O boundary. Pivot if the cap moves to an adaptive threshold per-config rather than a fixed 5.7%.
  - **Files**: `scripts/check-mape-k-budget-cap.mjs`, `scripts/check-mape-k-budget-cap.test.mjs`, `.github/workflows/ci.yml`
  - **Verification**: synthetic config at 5.5% → exit 0; 5.8% → exit 1; missing config → exit 0 (loop not yet shipped).
  - **Measurement**: `pnpm vitest run scripts/check-mape-k-budget-cap.test.mjs` exits 0.
  - **Pivot**: if the 5.7% number itself is replaced by a per-tier adaptive cap (per `mape-k-loop`'s monthly self-calibration), retire this lint and replace with a linter against the calibrated value.
  - **Acceptance**: CI job runs once `claude-mape-k-loop` v0 ships.
  - **Anchor**: rule #10; ARCHITECTURE.md § "MAPE-K cadence"; Beyer SRE 2016 (error budget enforcement).
  - **Risk**: Cap is dependent on `claude-mape-k-loop` v0 — implement only after that ships. Mitigation: defer until prerequisite lands.

- [ ] `supervisor-integration-self-hosted-runner` — Pivot escape hatch for supervisor integration tests
  - **ID**: supervisor-integration-self-hosted-runner
  - **Tags**: infra, testing, ci, pivot-followup
  - **Estimate**: 4h
  - **Hypothesis**: If `linux-supervisor-integration` consistently lands as `failure` (not `success` / `skipped`) on GH-hosted Ubuntu runners — i.e. neither `loginctl enable-linger` nor `dbus-run-session` produces a usable user-bus inside the sandbox — moving the Linux job to a self-hosted runner with a real systemd-user session is the documented Pivot in `supervisor-integration-tests`'s EXPERIMENT.yaml.
  - **Details**: Document the self-hosted-runner setup needed (Ubuntu LTS host with `loginctl enable-linger` already on for the runner user; `actions-runner.service` configured to run under that user). Update `.github/workflows/ci.yml` to gate the Linux job on `runs-on: [self-hosted, linux]`. Keep macOS as GH-hosted (launchd works there). File the cost / ownership question (who hosts the runner; is the maintenance overhead worth the empirical signal). This task only fires if the v0 integration jobs prove unworkable on GH-hosted infra.
  - **Files**: `.github/workflows/ci.yml`, `distribution/README.md`, `docs/self-hosted-runner.md` (new)
  - **Verification**: 3 consecutive PRs see `linux-supervisor-integration` land as `success` (not `skipped`) on the self-hosted runner.
  - **Measurement**: `gh run list --workflow ci.yml --branch main --limit 10 --json conclusion,name --jq '[.[] | select(.name == "linux-supervisor-integration") | .conclusion] | map(select(. == "success")) | length' >= 3`.
  - **Pivot**: if self-hosted-runner maintenance burden exceeds the empirical signal value (e.g., the runner needs >1 manual intervention per quarter), retire the Linux integration job entirely and rely on `lint-units.sh` + the macOS integration job alone — document the asymmetry as a declared deviation in `distribution/README.md`.
  - **Acceptance**: This task fires only if `supervisor-integration-tests` v0's Pivot threshold is hit; otherwise it remains a dormant scout entry.
  - **Anchor**: Forsgren et al., *Accelerate*, 2018 (test reliability — a CI gate that doesn't run reliably teaches the team to ignore failure); rule #7 (failure-mode discipline).
  - **Risk**: Self-hosted runners introduce supply-chain risk (a compromised runner can leak secrets). Mitigation: scope the runner to public-repo / non-secret jobs only; standard GH guidance (Forsgren 2018 § DORA prerequisites; rule #7).
