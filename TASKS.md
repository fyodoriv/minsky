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

- [ ] Implement `claude-mape-k-loop` v0 (the autonomic manager)
  - **ID**: mape-k-loop-v0
  - **Tags**: novel, extraction-target
  - **Estimate**: 3–5d (largest novel layer)
  - **Hypothesis**: A MAPE-K loop that drives DSPy-style prompt A/Bs, gated by a sustained-gain check (≥7 days post-rollout before counting) and an oscillation detector (refuses to revisit a prompt within N iterations), produces ≥4 prompt rollouts/month with ≥10 % sustained gain (p<0.05) — meeting success criterion #4 in `vision.md`. Additionally, the loop's Knowledge phase consumes the experiment-tracker's verdicts (the rule-#9 weekly–monthly layer) and feeds calibration findings back into rule #9 itself — closing the quarterly automation layer (`vision.md` § 9 "Pre-registration without execution is half a rule" — quarterly layer).
  - **Details**: The autonomic manager (Kephart & Chess 2003 MAPE-K reference architecture). Runs spec-monitor periodically; identifies top constraint per Goldratt TOC; proposes prompt variants; runs A/B via DSPy adapter; rolls out winners. Itself a Claude Code subagent for inherited supervision. **Quarterly-layer scope:** the Knowledge phase ingests `experiment-tracker-v0`'s verdict log; the Analyze phase tests rule #9's calibration (predicted Δ vs observed Δ at +7/+30/+90d, by hypothesis category); persistent miscalibration triggers a research task to amend rule #9 (e.g., add a research-task exemption clause).
  - **Files**: `novel/mape-k-loop/`
  - **Verification**:
    - Each MAPE phase emits a named OTEL span (`mape.monitor`, `mape.analyze`, `mape.plan`, `mape.execute`); `mape.knowledge.write` events on each `constraints.md` append
    - Integration test for user-story 003 (`user-stories/003-mape-k-improves-prompts.test.ts`) passes
    - Oscillation guard: synthetic test where the same prompt is proposed twice in 10 iterations — second is refused
  - **Measurement**: `pnpm vitest run user-stories/003-mape-k-improves-prompts.test.ts` exits 0; OTEL counter `sum(mape_rollout_total{result="sustained_gain"}[30d])` ≥ 4 (queried 60 days after `mape-k-loop-v0` ships).
  - **Pivot**: if rollout count is <2/month sustained 3 months OR rollouts confidently regress success-criterion metrics ≥1 time → MAPE-K design or DSPy choice is wrong; pivot per `vision.md` § Success criteria #4. Specifically, fall back to a deterministic prompt-versioning scheme (shadow-traffic + manual diff review) and remove the autonomous rollout step.
  - **Acceptance**: Integration test for user-story 003 passes; oscillation + sustained-gain guards verified; published as `@minsky/mape-k-loop`
  - **Anchor**: Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003; Khattab et al., "DSPy", 2023; Kohavi/Tang/Xu 2020 (statistical rigour of A/B).
  - **Risk**: Oscillation; confidently rolling out regressions; complexity creep into a research project. Set explicit guards: sustained-gain check (≥7 days post-rollout before counting), oscillation detector (refuses to revisit a prompt within N iterations).

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

- [ ] Native WatchOS app evaluation
  - **ID**: native-watchos-app
  - **Tags**: future, research, ux
  - **Estimate**: 4h (research only)
  - **Hypothesis**: A native WatchOS app would lower the wrist-dwell metric (success #6) below 60 s/day average IF Apple Shortcuts have hit their complexity ceiling — but the cost of going native (Swift toolchain, App Store review, signing) is only justified once the dwell metric crosses 90 s/day for two consecutive 7-day windows.
  - **Details**: Apple Shortcuts may eventually hit complexity ceiling. Evaluate building a native WatchOS app. **Don't implement until story 005's wrist-dwell metric trends wrong** (specifically: 7-day rolling average exceeds 90s/day for two consecutive weeks).
  - **Verification**: `research.md` "Native WatchOS app" section documents trigger condition + scope sketch + estimated effort
  - **Measurement**: `grep -c '^## Native WatchOS app' research.md` returns 1; section explicitly cites the 90 s/day-for-2-weeks trigger and an effort estimate ≤2 weeks; the trigger is queryable as `count(http_get_total{path="/watch.json"}[7d]) * 2 > 630` (90 s/day × 7 days).
  - **Pivot**: if research reveals that going native is materially cheaper than estimated (e.g., a community boilerplate ships) AND the wrist-dwell metric is borderline, lower the trigger threshold to 75 s/day. If native is dramatically more expensive than estimated, raise the trigger to 120 s/day.
  - **Acceptance**: research.md section added; trigger condition documented
  - **Anchor**: Card & Mackinlay 1999; rule #1 (don't reinvent — Apple Shortcuts first).
  - **Risk**: Jumping to native too early eats scope. Pin trigger to a specific metric threshold, not a hunch.

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

- [ ] Pattern-conformance audit — annotate every existing user-story, competitor doc, and adapter README
  - **ID**: pattern-conformance-audit-existing-docs
  - **Tags**: docs, conformance, scout
  - **Estimate**: 3–4h
  - **Hypothesis**: Every existing user-story, competitor doc, and adapter README maps cleanly to ≥1 published pattern; the audit reveals zero artifacts that justify a "deviation" without a primary-source citation.
  - **Details**: Constitutional rule #8 (`vision.md` § 8) commits the repo to explicit pattern conformance for every artifact. PR #6 seeded the index with 22 foundational rows but did not annotate every existing doc. This task adds, in each `user-stories/*.md`, `competitors/*.md`, and (when present) novel-package README, a "Pattern conformance" subsection naming the pattern(s) the artifact instantiates with source citation and conformance level. Cross-link from the row in `vision.md` § "Pattern conformance index". For competitors, the pattern is "what pattern they implement" (e.g., MetaGPT → simulated software company role-play; CrewAI → role-based agent orchestration); the conformance line declares how Minsky's choice (don't adopt) relates.
  - **Files**: `user-stories/*.md` (5), `competitors/*.md` (6), `novel/adapters/observability/README.md` (when added), index row updates in `vision.md`
  - **Verification**: every file in the listed sets has a "Pattern conformance" heading; every heading has a row referenced in `vision.md` § "Pattern conformance index"; tasks-lint and markdownlint pass.
  - **Measurement**: `for f in user-stories/*.md competitors/*.md; do grep -q '^## Pattern conformance' "$f" || echo "missing in $f"; done | wc -l` returns 0; `grep -c '^| [0-9]\+ ' vision.md` (rows in the pattern index table) increases by ≥11 over baseline.
  - **Pivot**: if more than 30 % of the artifacts genuinely don't map to a published pattern (e.g., a competitor doc whose category isn't in the literature), the audit reveals that rule #8's "every artifact" scope is over-broad — file a follow-up task to narrow rule #8's scope to top-level architectural artifacts only.
  - **Acceptance**: All listed files annotated; the index in `vision.md` grows by ≥11 rows; PR merges with all 8 CI gates green.
  - **Anchor**: Alexander et al., *A Pattern Language*, 1977 (a pattern catalogue maps every artifact to its pattern); Gabriel, *Patterns of Software*, 1996.
  - **Risk**: Pattern misattribution. Mitigation: every row cites a primary literature source (paper / book chapter), not a blog post or wiki.

- [ ] Supervisor integration tests across systemd + launchd
  - **ID**: supervisor-integration-tests
  - **Tags**: infra, testing, scout
  - **Estimate**: 1d
  - **Hypothesis**: A CI matrix of `linux-supervisor-integration` + `macos-supervisor-integration` jobs exercising `systemctl --user` and `launchctl` against the shipped unit templates demonstrably restarts a SIGKILL'd `minsky-tick-loop` within 10 s — proving rows 1–4 of the failure-mode table in `distribution/README.md` empirically rather than by inspection.
  - **Details**: Validate the supervisor unit-file templates (shipped under `distribution/systemd/`, `distribution/launchd/`) against real OS supervisors. Linux: spin a Linux runner in CI (or matrix-ed GitHub Actions runner) that exercises `systemctl --user enable --now minsky-supervisor.target`, then SIGKILLs `minsky-tick-loop` and asserts respawn within 10 s. macOS: a separate runner that bootstraps the LaunchAgents and asserts the same on launchctl. Both back the failure-mode rows 1–4 in `distribution/README.md`. Deferred from `supervisor-setup` per the "documented why not" clause.
  - **Files**: `.github/workflows/ci.yml` (add a Linux integration job + a macOS one); `distribution/test-supervisor.sh` (a portable test driver invoked by both)
  - **Verification**: CI matrix has linux-supervisor-integration and macos-supervisor-integration jobs that pass against the templates from `distribution/`; the smoke test in `distribution/lint-units.sh` continues to run on every PR.
  - **Measurement**: `gh run list --workflow ci.yml --json conclusion,name --jq '.[] | select(.name | test("supervisor-integration"))'` returns conclusion=success.
  - **Pivot**: if the Linux runner can't run `systemctl --user` (CI sandboxes may lack a user-systemd instance) → drop to a `dbus-run-session` workaround OR move integration tests to a self-hosted runner; if both fail, keep the smoke-only path and rely on the per-platform manual run documented in `distribution/README.md`.
  - **Acceptance**: matrix passes; failure-mode table rows 1–4 in `distribution/README.md` are demonstrably exercised by the test.
  - **Risk**: GitHub Actions Ubuntu runners run as a non-login user; user-systemd may need explicit `loginctl enable-linger`. Mitigation: document the workaround inline in the workflow.
  - **Literature anchor**: Forsgren et al., *Accelerate*, 2018 (test reliability as a DORA prerequisite).

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

- [ ] `ci-lint-pivot-success-margin` — CI lint flagging EXPERIMENT.yaml when pivot threshold has zero margin vs success threshold (spec-monitor A2 promotion)
  - **ID**: ci-lint-pivot-success-margin
  - **Tags**: ci, conformance, rule-10, spec-monitor-promotion
  - **Estimate**: 2h
  - **Hypothesis**: `novel/spec-monitor/SKILL.md` rule A2 ("pivot reuses success threshold or zero margin") flags 100 % of EXPERIMENT.yaml fixtures where the pivot's leading numeric token equals the success's leading numeric token, OR is within <1 % absolute distance, when fed those records. Today the rule is advisory; promoting it to a deterministic linter (per rule #10's ratchet, scoped by the 2026-05-03 quarterly audit) makes the check unmissable on every PR and lets A2 be removed from SKILL.md in the same shipping PR. Per Ries 2011 (build-measure-learn / pivot-or-persevere), a zero-margin pivot threshold is theatre — it carries no information and should fail CI mechanically, not advisorially.
  - **Details**: Add `scripts/check-pivot-success-margin.mjs` (pure function `checkPivotSuccessMargin({ success, pivot }) => { ok: boolean, reason?: string }`, plus a thin CLI that reads EXPERIMENT.yaml records via `@minsky/experiment-record`'s parser at `novel/experiment-record/src/parse.ts`). Regex-extract the leading signed numeric token (with optional `%`/units) from each string. Flag (a) exact-equal numeric tokens, (b) absolute distance <1 % of the success value, (c) success/pivot pair where one side is "X" and the other is "not X" with no numeric (e.g., "tests pass" / "tests fail"). Allow an opt-out via an explicit `# rule: ci-lint-pivot-success-margin: skip <reason>` comment for legitimately-binary metrics, audited at quarterly review. Pair with `scripts/check-pivot-success-margin.test.mjs` covering: zero-margin (fail), 10-point margin (pass), exact equality (fail), binary-with-skip (pass), binary-without-skip (fail), no numeric token at all (advisory-only, exit 0 with warning).
  - **Files**: `scripts/check-pivot-success-margin.mjs`, `scripts/check-pivot-success-margin.test.mjs`, `.github/workflows/ci.yml` (add a job step), `novel/spec-monitor/SKILL.md` (remove A2 in the SAME PR per ratchet — renumber A3–A5 or leave the gap, per existing convention)
  - **Verification**: `pnpm vitest run scripts/check-pivot-success-margin.test.mjs` exits 0 with ≥6 cases; CI lint catches a synthetic `EXPERIMENT.yaml` with `success: ">= 95 %"` / `pivot: "< 95 %"` (zero-margin) and exits 1; lint passes on the repo's existing EXPERIMENT.yaml.
  - **Measurement**: `pnpm vitest run scripts/check-pivot-success-margin.test.mjs && node scripts/check-pivot-success-margin.mjs EXPERIMENT.yaml`
  - **Pivot**: if numeric-token extraction proves too brittle (>10 % false-positive rate against historical EXPERIMENT.yaml records in `experiments/`), the deterministic-candidate is wrong — keep A2 advisory in SKILL.md and close this task. The advisory layer continues to handle the residual judgement.
  - **Acceptance**: lint shipped, CI job green on existing records, A2 removed from SKILL.md in the same PR per rule #10's ratchet.
  - **Anchor**: rule #10 (vision.md § 10); Ries, *The Lean Startup*, 2011 (pivot-or-persevere; meaningful pivot threshold ≠ vanity threshold); spec-advisories/2026-05-03-quarterly-audit.md (audit decision).
  - **Risk**: Numeric extraction false-positives on prose-heavy success/pivot strings. Mitigation: emit advisory exit 0 (warning only) when no numeric token is found on either side; only fail (exit 1) when both sides have numerics AND margin is sub-threshold.

- [ ] `ci-lint-measurement-inspects-output` — CI lint flagging EXPERIMENT.yaml measurement commands that don't actually inspect output (spec-monitor A4 promotion)
  - **ID**: ci-lint-measurement-inspects-output
  - **Tags**: ci, conformance, rule-10, spec-monitor-promotion
  - **Estimate**: 2h
  - **Hypothesis**: `novel/spec-monitor/SKILL.md` rule A4 ("measurement runs but doesn't inspect output") flags 100 % of EXPERIMENT.yaml records whose `measurement` field matches a deterministic blacklist (`>/dev/null` redirects without a subsequent test, bare `curl`/`echo`/`true`/`node script.mjs` patterns) AND fails to match a recognised-inspector allowlist (`test`, `[`, `[[`, `jq -e`, `grep -q`, `grep -c`, `assert`, `vitest`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `npx @tasks-md/lint`, `markdownlint-cli2`, `gh run list ... --jq`, etc.), when fed those records. Today the rule is advisory; promoting it (per the 2026-05-03 audit + rule #10 ratchet) makes the false-confidence trap (a measurement command that always exits 0 because it never inspects its output) unmissable.
  - **Details**: Add `scripts/check-measurement-inspects-output.mjs` (pure function `checkMeasurementInspectsOutput(measurementCmd) => { ok: boolean, reason?: string }` plus thin CLI). Allowlist of inspector tokens (above) — if any token appears in the command, pass. Blacklist of degenerate forms (`echo done`, `true`, bare `curl URL` with no piped consumer, bare `node script.mjs` without a wrapping `test`/`[`). When neither list matches, emit advisory warning (exit 0) — pure advisory layer for the long tail. Pair with `scripts/check-measurement-inspects-output.test.mjs`: ≥8 cases covering allowlist hits, blacklist hits, ambiguous (warning), and the existing repo's EXPERIMENT.yaml.
  - **Files**: `scripts/check-measurement-inspects-output.mjs`, `scripts/check-measurement-inspects-output.test.mjs`, `.github/workflows/ci.yml`, `novel/spec-monitor/SKILL.md` (remove A4 in the SAME PR per ratchet)
  - **Verification**: `pnpm vitest run scripts/check-measurement-inspects-output.test.mjs` exits 0; lint exits 1 on `measurement: "echo done"` and exits 0 on `measurement: "test $(curl -s ... | jq -r ...) -lt 100"`; lint passes on repo's existing EXPERIMENT.yaml records.
  - **Measurement**: `pnpm vitest run scripts/check-measurement-inspects-output.test.mjs && node scripts/check-measurement-inspects-output.mjs EXPERIMENT.yaml`
  - **Pivot**: if the inspector allowlist proves too narrow (legitimate measurement commands consistently fall through to "advisory warning" and never to "pass"), the rule is judgement-bound and this task should be closed — A4 stays advisory in SKILL.md.
  - **Acceptance**: lint shipped, CI job green on existing records, A4 removed from SKILL.md in the same PR per rule #10's ratchet.
  - **Anchor**: rule #10 (vision.md § 10); Havelund & Goldberg, "Verify Your Runs", *VSTTE* 2008 (runtime verification — the inspect-output check is the deterministic-monitor layer); spec-advisories/2026-05-03-quarterly-audit.md (audit decision).
  - **Risk**: Inspector allowlist drifts as new test runners are adopted. Mitigation: fall back to "advisory warning + exit 0" when neither list matches; reviewer escalates if the warning channel grows noisy.

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
