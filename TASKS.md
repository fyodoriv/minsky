# Tasks

<!-- policy: Every task starts with a failing test (red), then minimal code to pass (green), then refactor. Define metrics and docs BEFORE writing code. See AGENTS.md. -->
<!-- policy: Every external dependency is accessed through an interface in novel/adapters/. No vendor names in business logic. -->
<!-- policy: When closing a task, remove its entire block. History lives in git log per the tasks.md spec. -->
<!-- policy: Investor / product-manager / growth-analyst personas only run when **Tags** contains business, growth, revenue, customer, or pricing. -->
<!-- policy: Every term used here must appear in vision.md § Glossary or be sourced from a cited paper. New jargon → glossary entry in the same commit. -->
<!-- policy: Per constitutional rule #9 (hypothesis-driven development), every new task entry MUST include — in addition to the existing Details / Files / Verification / Acceptance / Risk fields — a runnable measurement command (shell / OTEL query / CI script that produces the metric) and an explicit pivot threshold (the value below which the *approach* is abandoned, not just the change reverted). Vanity metrics (counts that always go up — LOC, commits, hours, tasks-in-flight) are forbidden. Existing tasks predating rule #9 are retrofitted under task `rule-9-backfill-existing-tasks`. -->
<!-- policy: Per constitutional rule #8 (pattern conformance), every new top-level artifact (file under novel/ or distribution/, root-level *.md, novel pnpm workspace package) requires a row in vision.md § Pattern conformance index in the same commit. -->
<!-- policy: Per constitutional rule #7 (chaos engineering), every new novel package's README and every new user-story includes a "Failure modes & chaos verification" section with steady-state hypothesis, blast radius, operator escape hatch, and a failure-mode table (failure mode | trigger / fault axis | expected behavior — loud-crash-supervisor-restart / circuit-break-and-notify / graceful-degrade | chaos test). -->

## P0

(empty — work the highest-priority unblocked item from P1.)

## P1

- [ ] File OMC issue proposing native tasks.md integration
  - **ID**: omc-tasksmd-issue
  - **Tags**: community, integration
  - **Estimate**: 1h
  - **Details**: Open an issue at <https://github.com/Yeachan-Heo/oh-my-claudecode/issues> proposing that `/team` mode optionally reads from a `TASKS.md` at repo root following the [tasks.md spec](https://github.com/tasksmd/tasks.md). High-leverage community contribution — if accepted, lands tasks.md in 31k+ developer workflows.
  - **Verification**: `gh issue view <url> --repo Yeachan-Heo/oh-my-claudecode` returns the filed issue; URL added to `research.md` and `competitors/omc.md`
  - **Acceptance**: Issue filed; URLs linked from `research.md` and `competitors/omc.md`
  - **Risk**: Maintainer may reject if framed as a Minsky-specific need. Frame as "ecosystem alignment with the tasks.md spec" with concrete code-level changes pinned to specific OMC files.

- [ ] `claude-budget-guard` v0 — full package shipped + extracted
  - **ID**: budget-guard-v0
  - **Tags**: novel, extraction-target, parent
  - **Estimate**: tracker — see sub-tasks
  - **Blocked by**: budget-guard-flag-file, budget-guard-http-api, budget-guard-maciek-impl, budget-guard-publish-dry-run
  - **Details**: This PR (the core decision logic + watchdog loop + tests) shipped under the same name; sub-tasks below ship the runtime envelopes (flag file, HTTP API, real Maciek Strategy) plus the npm dry-run. When the last sub-task lands, the full package is shipped and this tracker is removed.
  - **Verification**: all four sub-tasks below complete; integration test for `user-stories/004-budget-auto-pause.md` passes against the assembled package.
  - **Measurement**: `gh pr list --state merged --search 'budget-guard' --json number | jq length` returns ≥5 (this PR + four sub-task PRs).
  - **Pivot**: if any sub-task discovers the original epic-level shape is wrong (e.g., flag-file model is too coarse for the dashboard), revisit the parent acceptance before continuing the chain.
  - **Acceptance**: tracker task removed once all four sub-tasks merge.

- [ ] `@minsky/budget-guard` — flag-file envelope (`.minsky/budget.flag`)
  - **ID**: budget-guard-flag-file
  - **Tags**: novel, extraction-target
  - **Parent**: budget-guard-v0
  - **Estimate**: 2–3h
  - **Details**: Wire `BudgetGuard`'s decision callback to write `${MINSKY_HOME}/.minsky/budget.flag` whose contents are one of `NORMAL` / `THROTTLE` / `PAUSE` / `WEEKLY_WARN`. Path deviation from task brief's `/var/run/minsky/`: v0 uses `.minsky/` because `/var/run/minsky/` requires root (rule #8 declared deviation in the package README). Write atomically via `fs.rename`.
  - **Files**: `novel/budget-guard/src/flag-file.ts`, `novel/budget-guard/src/flag-file.test.ts`
  - **Verification**: `await guard.tick()` with a circuit-break-fixture writes `PAUSE` to the flag file within 10 s; tasks-md tests pass.
  - **Measurement**: `pnpm vitest run novel/budget-guard/src/flag-file.test.ts`.
  - **Pivot**: if shell consumers ever need atomic *multi-field* state (action + reason + decided-at), pivot to writing a JSON file (`.minsky/budget.json`) and deprecate the single-word flag.
  - **Acceptance**: flag file present + correct contents on every state transition; flag-file tests at 100 % coverage.
  - **Risk**: filesystem races if multiple guards run. Mitigation: atomic rename + flock identical to setup.sh's lock pattern.

- [ ] `@minsky/budget-guard` — HTTP API on `localhost:9876`
  - **ID**: budget-guard-http-api
  - **Tags**: novel, extraction-target
  - **Parent**: budget-guard-v0
  - **Estimate**: 3–4h
  - **Details**: Tiny Hono server on `localhost:9876` exposing `GET /budget` returning the decision JSON shape from `ARCHITECTURE.md` § "Token economy": `{ remaining: { tokens, minutes, cost }, weekly_headroom_pct, recommended_action }`. Add Hono as a dep behind a thin adapter so we can swap (rule #2).
  - **Files**: `novel/budget-guard/src/http-server.ts`, `novel/budget-guard/src/http-server.test.ts`
  - **Verification**: `curl -s localhost:9876/budget | jq` returns the documented shape; vitest spins the server on an ephemeral port and asserts the JSON.
  - **Measurement**: `pnpm vitest run novel/budget-guard/src/http-server.test.ts`.
  - **Pivot**: if multiple consumers need different shapes — pivot to GraphQL or a typed RPC (tRPC) instead of REST.
  - **Acceptance**: GET /budget returns the documented shape; tests cover normal, throttle, pause, weekly-warn states.
  - **Risk**: port collision on 9876. Mitigation: env var `MINSKY_BUDGET_GUARD_PORT` overrides; default documented.

- [ ] `@minsky/token-monitor` — Maciek `claude-monitor` Strategy implementation
  - **ID**: budget-guard-maciek-impl
  - **Tags**: novel, extraction-target
  - **Parent**: budget-guard-v0
  - **Estimate**: 4–6h
  - **Details**: Real `TokenMonitor` Strategy against Maciek's Python `claude-monitor` cache file (path & format documented in their repo). Polls the cache, parses, returns `TokenSnapshot`. Adapter test runs against a real Maciek install (CI installs Maciek's pinned version once).
  - **Files**: `novel/adapters/token-monitor/src/maciek.ts`, `novel/adapters/token-monitor/src/maciek.test.ts`
  - **Verification**: with a real Maciek install, `new MaciekTokenMonitor().snapshot()` returns a `TokenSnapshot` whose `tokensRemainingInWindow` matches `claude-monitor --json`'s reported value.
  - **Measurement**: `pnpm vitest run novel/adapters/token-monitor/src/maciek.test.ts` (gated on Maciek install on the runner).
  - **Pivot**: if Maciek's cache format changes more than once a year — pivot to a custom `TokenMonitor` Strategy that polls Anthropic's API directly (when / if Anthropic exposes a usage endpoint).
  - **Acceptance**: Maciek-backed `TokenMonitor.snapshot()` round-trips real cache values; integration test passes; pattern conformance row updated.
  - **Risk**: Maciek's format changes upstream. Mitigation: pin a specific Maciek version in the adapter test; gate updates with the test (rule #7 chaos discipline).

- [ ] `@minsky/budget-guard` + `@minsky/token-monitor` — npm publish dry-run + extraction
  - **ID**: budget-guard-publish-dry-run
  - **Tags**: extraction, publish
  - **Parent**: budget-guard-v0
  - **Blocked by**: budget-guard-flag-file, budget-guard-http-api, budget-guard-maciek-impl
  - **Estimate**: 1h
  - **Details**: Run `pnpm publish --dry-run --workspace novel/budget-guard` and the same for `@minsky/token-monitor`; ensure the published artifact has the right `files`, `main`, `types`, and a matching `README.md`. Publish under the `@minsky/*` scope when ready (separate manual step — `npm publish` is blocked-by-default per the `/next-task` skill, so this task only does the dry-run).
  - **Files**: `novel/budget-guard/package.json`, `novel/adapters/token-monitor/package.json`
  - **Verification**: dry-run output lists the documented files only (no `dist/*.d.ts.map`, no `tsconfig.json`); `gh pr` description records the dry-run output.
  - **Measurement**: `pnpm publish --dry-run --workspace novel/budget-guard 2>&1 | grep -c '\.tgz'` returns 1.
  - **Pivot**: if dry-run reveals files >100 KB, audit `files` field to exclude.
  - **Acceptance**: Both packages dry-run cleanly; PR description records the published filenames + sizes.
  - **Risk**: TS declaration files reference cross-package types. Mitigation: ensure `composite: true` + `references` is set everywhere (already done for token-monitor / budget-guard).

- [ ] Define `claude-handoff-spec` v0
  - **ID**: handoff-spec-v0
  - **Tags**: novel, extraction-target, spec
  - **Estimate**: 6–8h
  - **Details**: Small spec for structured persona-to-persona handoffs (status, summary, artifacts, blockers, suggested next personas, pushback) — anchored in Hewitt's actor-model message-passing. Reference parser. Validator. Modeled after AGENTS.md and tasks.md.
  - **Files**: `novel/handoff-spec/spec.md`, `novel/handoff-spec/parser.ts`, `novel/handoff-spec/validator.ts`, `novel/handoff-spec/test/fixtures/*.md`
  - **Verification**:
    - 5 reference handoffs in `test/fixtures/` (status=ok, blocked, needs-rework, with pushback, with multiple suggested-next) parse without errors
    - 3 deliberately invalid fixtures fail validation with specific error messages
    - `npm publish --dry-run --workspace novel/handoff-spec` succeeds
  - **Acceptance**: spec.md published; parser passes all 5 reference handoffs; validator rejects all 3 invalid fixtures; published as `@minsky/handoff-spec`; cross-link from `AGENTS.md`
  - **Risk**: Spec evolves rapidly in early use. Pin at v0; allow breaking changes pre-1.0; document migration path in spec.md.

- [ ] Decide MAPE-K loop cadence
  - **ID**: mape-k-cadence
  - **Tags**: research, design
  - **Estimate**: 4h
  - **Details**: Time-based vs scheduler-iteration-based vs event-triggered. Probably all three with priority. Define rules. Document in `research.md` and `ARCHITECTURE.md`. Anchor: control-loop period selection (Liu, *Real-Time Systems*).
  - **Verification**: `research.md` has a "MAPE-K cadence" subsection with the chosen rule and rejected alternatives; `ARCHITECTURE.md` § "Process supervision tree" reflects the cadence
  - **Acceptance**: Decision documented in research.md and ARCHITECTURE.md with rationale; rejected alternatives recorded
  - **Risk**: Wrong cadence wastes tokens (too frequent) or misses signal (too rare). Pick conservative defaults; let the autonomic manager itself adjust them per success-metric #4.

## P2

- [ ] Implement `claude-spec-monitor` Skill (runtime specification monitoring)
  - **ID**: spec-monitor-skill
  - **Tags**: novel, extraction-target, skill
  - **Estimate**: 1d
  - **Blocked by**: handoff-spec-v0
  - **Details**: Claude Skill implementing runtime specification monitoring (Havelund & Goldberg 2008). Reads `vision.md` + last N handoffs (via handoff-spec parser) + recent commits, produces structured drift report. Conforms to agentskills.io spec.
  - **Files**: `novel/spec-monitor/SKILL.md`, related scripts, `novel/spec-monitor/test/synthetic-drift/`
  - **Verification**:
    - Skill loads in a Claude Code session: `claude --skill ./novel/spec-monitor/`
    - Run against synthetic drifted fixtures (deliberately violating each constitutional rule): report contains a row per violation with `rule_id`, `evidence`, `severity`, `suggested_repair`
    - Run against clean fixtures: report has zero violations
  - **Acceptance**: Skill loadable in Claude Code; produces structured drift report on synthetic test cases (one drift per rule); published as `@minsky/spec-monitor`
  - **Risk**: Drift detection is the single most novel layer. False positives erode trust; quiet failures are catastrophic. Pin every rule with both a positive and negative fixture from day one.

- [ ] Implement `claude-mape-k-loop` v0 (the autonomic manager)
  - **ID**: mape-k-loop-v0
  - **Tags**: novel, extraction-target
  - **Estimate**: 3–5d (largest novel layer)
  - **Blocked by**: spec-monitor-skill, mape-k-cadence
  - **Details**: The autonomic manager (Kephart & Chess 2003 MAPE-K reference architecture). Runs spec-monitor periodically; identifies top constraint per Goldratt TOC; proposes prompt variants; runs A/B via DSPy adapter; rolls out winners. Itself a Claude Code subagent for inherited supervision.
  - **Files**: `novel/mape-k-loop/`
  - **Verification**:
    - Each MAPE phase emits a named OTEL span (`mape.monitor`, `mape.analyze`, `mape.plan`, `mape.execute`); `mape.knowledge.write` events on each `constraints.md` append
    - Integration test for user-story 003 (`user-stories/003-mape-k-improves-prompts.test.ts`) passes
    - Oscillation guard: synthetic test where the same prompt is proposed twice in 10 iterations — second is refused
  - **Acceptance**: Integration test for user-story 003 passes; oscillation + sustained-gain guards verified; published as `@minsky/mape-k-loop`
  - **Risk**: Oscillation; confidently rolling out regressions; complexity creep into a research project. Set explicit guards: sustained-gain check (≥7 days post-rollout before counting), oscillation detector (refuses to revisit a prompt within N iterations).

- [ ] Extract `selfTest()` contract to shared adapter-types package
  - **ID**: extract-adapter-types
  - **Tags**: novel, refactor, scout
  - **Estimate**: 2–3h
  - **Details**: Currently `SelfTestStatus`, `SelfTestResult`, and `aggregateStatus()` live at `novel/adapters/observability/src/index.ts`. By the second adapter (per ARCHITECTURE.md § "The dependency table" — supervisor-setup, budget-guard-v0, etc.) every adapter will need this contract, and importing it through `@minsky/observability` is wrong: an `@minsky/budget-guard` package depending on `@minsky/observability` for a base type is an architectural cycle. Extract to a new pnpm workspace package `novel/adapters/types` (`@minsky/adapter-types`) exporting the contract; have `@minsky/observability` re-export from there for back-compat; future adapters depend directly on `@minsky/adapter-types`. Update setup.sh's comment header reference to point to the new location. Surfaced while shipping `setup-sh-rewrite` (PR #5).
  - **Files**: `novel/adapters/types/package.json`, `novel/adapters/types/src/index.ts`, `novel/adapters/types/src/index.test.ts`, `novel/adapters/types/tsconfig.json`, `novel/adapters/observability/src/index.ts`, `novel/adapters/observability/package.json`, `setup.sh` (header reference), `pnpm-workspace.yaml` if needed
  - **Verification**: `pnpm typecheck` passes; existing observability tests pass unchanged; new types-package tests cover `aggregateStatus` 100%; `pnpm publish --dry-run --workspace novel/adapters/types` succeeds.
  - **Acceptance**: New `@minsky/adapter-types` package compiles, tests pass, observability re-exports work, setup.sh comment updated.
  - **Risk**: Workspace dependency loops if observability and types depend on each other. Mitigation: `@minsky/adapter-types` has no internal Minsky deps.

- [ ] Implement `omc-tasksmd-bridge` v0
  - **ID**: omc-tasksmd-bridge-v0
  - **Tags**: novel, extraction-target, bridge
  - **Estimate**: 1–2d (scales with the persistence answer)
  - **Blocked by**: research-omc-handoff-persistence
  - **Details**: Bidirectional sync between tasks.md (canonical) and OMC's internal task list. Goes away when OMC adopts tasks.md upstream — the success metric for this package is "this package becomes unnecessary."
  - **Files**: `novel/bridges/omc-tasksmd/`
  - **Verification**:
    - Round-trip property test: arbitrary `TASKS.md` → push to OMC → pull back → diff against original is empty (modulo whitespace)
    - End-to-end: claim a task in OMC; observe it claimed in `TASKS.md` within 1 scheduler iteration; vice versa
  - **Acceptance**: Round-trip preserves all task fields; integration test for both directions passes; published as `@minsky/omc-tasksmd-bridge`
  - **Risk**: Bridge becomes unnecessary upstream — keep scope minimal; don't over-engineer for features OMC may absorb.

- [ ] First user-story integration test passes (001)
  - **ID**: first-integration-test
  - **Tags**: testing, validation
  - **Estimate**: 6h
  - **Blocked by**: budget-guard-v0
  - **Details**: Implement integration test for `user-stories/001-loop-runs-overnight.md`. Compressed simulation, 60-minute window standing in for an 8h overnight run.
  - **Verification**: `npm test user-stories/001-loop-runs-overnight.test.ts` passes locally and on CI; OTEL collector receives ≥1 span per task type; CI workflow shows green
  - **Acceptance**: Test passes; metrics emit valid OTEL; CI green
  - **Risk**: 60min compressed sim may miss real overnight failure modes (memory leaks, log rotation, OS sleep). Document the gap; plan a quarterly real-overnight test.

- [ ] Lighter OTEL backend evaluation
  - **ID**: otel-lite-backend
  - **Tags**: research
  - **Estimate**: 4–6h
  - **Details**: Loki+Tempo+Prometheus+Grafana is heavy for single-dev install. Evaluate SQLite-backed exporter or similar. Document pros/cons.
  - **Verification**: `research.md` has a "Lighter OTEL backend" comparison table (size, install steps, query language, dashboard support); recommendation stated; if SQLite path chosen, P1 task created
  - **Acceptance**: research.md updated with comparison and recommendation; if SQLite path chosen, follow-up P1 task filed
  - **Risk**: Lighter backend may lack features needed later (distributed traces, long retention). Decide on a defined feature set; revisit when missing features bite.

- [ ] Apple Shortcuts JSON for Watch surface
  - **ID**: watch-shortcuts
  - **Tags**: novel, ux
  - **Estimate**: 4–6h
  - **Blocked by**: budget-guard-v0
  - **Details**: Three Shortcuts: tokens-remaining, last-task-status, constraint-of-the-week. Each polls the local Tailscale-reachable JSON API. Plus a pause/resume Shortcut. Anchor: glanceable display (Card & Mackinlay 1999) — three numbers, no chrome.
  - **Files**: `distribution/shortcuts/`
  - **Verification**:
    - Shortcuts JSON imports cleanly via iCloud/AirDrop on iOS 17+
    - Each Shortcut, run on Watch, completes in <2s end-to-end
    - Pause Shortcut writes a sentinel file the supervisor honors within 1 scheduler iteration
  - **Acceptance**: Shortcuts importable on iPhone; visible on Watch; integration test for user-story 002 (pause from iPhone) passes; integration test for user-story 005 (three-numbers Watch) passes
  - **Risk**: Apple Shortcuts complexity ceiling — track wrist-dwell metric (success #6); if it climbs, escalate to `native-watchos-app`.

- [ ] Web dashboard v0
  - **ID**: dashboard-web-v0
  - **Tags**: novel, ux
  - **Estimate**: 1–2d
  - **Details**: Hono or similar minimal web app, ~300 lines. Reads OTEL backend through Observability adapter. Mobile-friendly. Reachable via Tailscale. Shows the 10 success metrics from `vision.md`.
  - **Verification**:
    - `curl localhost:8080/` returns SSR HTML with all 10 metrics
    - Lighthouse Mobile score ≥90 in CI
    - Tailscale-reachable URL loads in <1s on iPhone (manual)
  - **Acceptance**: All 10 vision.md success metrics visible; loads in <1s on iPhone over Tailscale; passes Lighthouse mobile usability
  - **Risk**: Scope creep into a "real" dashboard. Cap line count; refuse new features without removing one.

## P3

- [ ] Multi-machine scope investigation
  - **ID**: multi-machine
  - **Tags**: future, research
  - **Estimate**: 4h (research only)
  - **Details**: Initial scope is single-dev-machine. Document what changes for multi-machine / team setups. Don't implement.
  - **Verification**: `research.md` "Multi-machine scope" section enumerates the deltas (state synchronization, identity, supervision)
  - **Acceptance**: research.md section added
  - **Risk**: Research drifts into design before single-machine works. Cap scope at "what would have to change," not "how to build it."

- [ ] Quarterly dependency review (Q3 2026)
  - **ID**: review-q3-2026
  - **Tags**: governance
  - **Estimate**: 1d (when due)
  - **Details**: Per vision.md principle 1, scan all 14 deps and 5 novel layers; reconsider choices. Append to `research.md` "Quarterly review log".
  - **Verification**: `research.md` has a 2026-Q3 entry under "Quarterly review log" with one line per dep + one line per novel layer
  - **Acceptance**: research.md updated with findings; any dep changes filed as separate P1/P2 tasks
  - **Risk**: Skipped if no calendar reminder set. Add a calendar event before this task is due.

- [ ] OMC handoff persistence proposal upstream (conditional)
  - **ID**: omc-persistence-proposal
  - **Tags**: community
  - **Estimate**: 1–2h
  - **Blocked by**: research-omc-handoff-persistence
  - **Details**: If P0 research finds OMC handoffs are not parseable, file upstream issue/PR adding parseable artifact.
  - **Verification**: `gh issue view` / `gh pr view` returns the filed item; URL recorded in `research.md`
  - **Acceptance**: Issue/PR filed; linked from research.md
  - **Risk**: Conditional — only fires if P0 research finds non-parseable. If parseable, this task is removed instead of completed.

- [ ] Native WatchOS app evaluation
  - **ID**: native-watchos-app
  - **Tags**: future, research, ux
  - **Estimate**: 4h (research only)
  - **Details**: Apple Shortcuts may eventually hit complexity ceiling. Evaluate building a native WatchOS app. **Don't implement until story 005's wrist-dwell metric trends wrong** (specifically: 7-day rolling average exceeds 90s/day for two consecutive weeks).
  - **Verification**: `research.md` "Native WatchOS app" section documents trigger condition + scope sketch + estimated effort
  - **Acceptance**: research.md section added; trigger condition documented
  - **Risk**: Jumping to native too early eats scope. Pin trigger to a specific metric threshold, not a hunch.

- [ ] Backfill rule-#9 fields (measurement command + pivot threshold) on tasks predating rule-#9 landing
  - **ID**: rule-9-backfill-existing-tasks
  - **Tags**: docs, conformance, scout
  - **Estimate**: 2–3h
  - **Details**: Constitutional rule #9 (`vision.md` § 9) requires every task to declare a runnable measurement command and a pivot threshold. Tasks added before rule #9 landed don't have these fields. Walk every existing task in `TASKS.md` and add **Measurement** (exact shell / OTEL / CI command — `<TBD-AFTER: …>` if the prerequisite system isn't built) and **Pivot** (numeric value at which the approach is abandoned). Drop any task that on review can't formulate a non-vanity metric — that's itself a rule-#9 finding.
  - **Files**: `TASKS.md`
  - **Verification**: every task block in `TASKS.md` has a `**Measurement**:` line and a `**Pivot**:` line; tasks-lint passes.
  - **Acceptance**: All P1 / P2 / P3 tasks retrofitted; PR merges with all 8 CI gates green.
  - **Measurement**: `awk '/^- \[ \]/{block=1} block && /^\s*- \*\*(Measurement|Pivot)\*\*:/{found++} /^$/{if(block && found<2){print "missing in:", task} block=0; found=0; task=""} block && /^- \[ \]/{task=$0}' TASKS.md` returns no missing lines.
  - **Pivot**: if more than 30 % of existing tasks resist a meaningful pivot threshold (resist = "any value triggers the pivot trivially"), revisit rule #9 — the rule may be over-specified for research / spike tasks.
  - **Risk**: Mechanical backfill produces empty / vacuous fields. Mitigation: for each task, draft the metric *as if proposing it fresh* — if it doesn't pass that bar, reword or delete the task.

- [ ] DSPy idiom fit evaluation
  - **ID**: dspy-fit-eval
  - **Tags**: research
  - **Estimate**: 4–6h
  - **Details**: First practical attempt at using DSPy for prompt A/B in `mape-k-loop-v0`. Document where the idiom fits vs where it forces awkward shape.
  - **Verification**: `research.md` "DSPy fit" entry contains 3 wins + 3 frictions with concrete code references; if poor fit, alternative `PromptOptimizer` implementation proposed in the same entry
  - **Acceptance**: research.md updated; if poor fit, alternative `PromptOptimizer` implementation proposed
  - **Risk**: DSPy idiom is a moving target — pin the version evaluated; revisit on new minor releases.

- [ ] Resolve OMC handoff persistence question
  - **ID**: research-omc-handoff-persistence
  - **Tags**: research
  - **Estimate**: 2–3h (read source + experiment)
  - **Blocked**: needs-user-approval — task involves running OMC plugin commands locally (invasive machine state) and, conditionally, filing a GitHub issue at `Yeachan-Heo/oh-my-claudecode` (`gh issue create` is blocked-by-default per `/next-task` skill). User to either confirm in-session approval and unblock, or perform the public-surface action themselves and record the URL in research.md.
  - **Details**: Determine whether OMC's "shared task list" persists to disk in a parseable format, or only in process memory. Read OMC source; experiment by running `/team N:role` and checking the working tree + `~/.claude/` for new artifacts. Determines complexity of `omc-tasksmd-bridge`.
  - **Files**: `research.md`, `competitors/omc.md`
  - **Verification**:
    - `grep -RInE 'writeFileSync|saveTo|persist|JSON\.stringify' <omc-checkout>/` and triage hits
    - Run OMC `/team 2:executor` against a throwaway repo, then `find . ~/.claude -newer /tmp/.start_marker` to spot any artifacts
  - **Acceptance**:
    - `research.md` has a "OMC handoff persistence" subsection: yes/no/partial, file path(s), format, parseability assessment
    - If not parseable: GitHub issue filed at `Yeachan-Heo/oh-my-claudecode` requesting a parseable artifact, URL recorded in research.md
  - **Risk**: OMC may persist in an opaque format (e.g., serialized in-process state) that only resembles parseable on the surface — verify with a round-trip parse, not eyeballing.

- [ ] Pattern-conformance audit — annotate every existing user-story, competitor doc, and adapter README
  - **ID**: pattern-conformance-audit-existing-docs
  - **Tags**: docs, conformance, scout
  - **Estimate**: 3–4h
  - **Details**: Constitutional rule #8 (`vision.md` § 8) commits the repo to explicit pattern conformance for every artifact. PR #6 seeded the index with 22 foundational rows but did not annotate every existing doc. This task adds, in each `user-stories/*.md`, `competitors/*.md`, and (when present) novel-package README, a "Pattern conformance" subsection naming the pattern(s) the artifact instantiates with source citation and conformance level. Cross-link from the row in `vision.md` § "Pattern conformance index". For competitors, the pattern is "what pattern they implement" (e.g., MetaGPT → simulated software company role-play; CrewAI → role-based agent orchestration); the conformance line declares how Minsky's choice (don't adopt) relates.
  - **Files**: `user-stories/*.md` (5), `competitors/*.md` (6), `novel/adapters/observability/README.md` (when added), index row updates in `vision.md`
  - **Verification**: every file in the listed sets has a "Pattern conformance" heading; every heading has a row referenced in `vision.md` § "Pattern conformance index"; tasks-lint and markdownlint pass.
  - **Acceptance**: All listed files annotated; the index in `vision.md` grows by ≥11 rows; PR merges with all 8 CI gates green.
  - **Risk**: Pattern misattribution. Mitigation: every row cites a primary literature source (paper / book chapter), not a blog post or wiki.

- [ ] CI lint that enforces "every new top-level artifact gets a `vision.md` index row"
  - **ID**: ci-lint-pattern-index
  - **Tags**: ci, conformance
  - **Estimate**: 4–6h
  - **Details**: Constitutional rule #8 commits every PR that adds a new file / package / interface to add (or amend) a row in `vision.md` § "Pattern conformance index". Today nothing enforces it. Build a small Node script (under `scripts/`) that runs in CI: diff the PR against `main`; for any added top-level file or new pnpm workspace package, require a corresponding row in the index (heuristic: file path or package name appears in the index's table). Fails the `glossary-discipline` job (rename appropriately, e.g., `pattern-discipline`) when a new artifact lacks a row. Allow opt-out by `<!-- pattern: not-applicable -->` comment in the file with a one-line reason.
  - **Files**: `scripts/check-pattern-index.mjs`, `.github/workflows/ci.yml`
  - **Verification**: a synthetic PR adding a new top-level file without an index row fails the new check; the same PR with a row passes; opt-out comment is honored; CI runs the new check on every PR.
  - **Acceptance**: Script + CI job ship together; new check fails fast on a synthetic test fixture; rule #8 is now mechanically enforced.
  - **Risk**: False positives if path matching is too strict (e.g., new test file). Mitigation: scope to `novel/**`, top-level docs (`*.md` at root), `setup.sh`, `distribution/**`, `.github/workflows/**` — not test files or fixtures.

- [ ] Supervisor integration tests across systemd + launchd
  - **ID**: supervisor-integration-tests
  - **Tags**: infra, testing, scout
  - **Estimate**: 1d
  - **Details**: Validate the supervisor unit-file templates (shipped under `distribution/systemd/`, `distribution/launchd/`) against real OS supervisors. Linux: spin a Linux runner in CI (or matrix-ed GitHub Actions runner) that exercises `systemctl --user enable --now minsky-supervisor.target`, then SIGKILLs `minsky-tick-loop` and asserts respawn within 10 s. macOS: a separate runner that bootstraps the LaunchAgents and asserts the same on launchctl. Both back the failure-mode rows 1–4 in `distribution/README.md`. Deferred from `supervisor-setup` per the "documented why not" clause.
  - **Files**: `.github/workflows/ci.yml` (add a Linux integration job + a macOS one); `distribution/test-supervisor.sh` (a portable test driver invoked by both)
  - **Verification**: CI matrix has linux-supervisor-integration and macos-supervisor-integration jobs that pass against the templates from `distribution/`; the smoke test in `distribution/lint-units.sh` continues to run on every PR.
  - **Measurement**: `gh run list --workflow ci.yml --json conclusion,name --jq '.[] | select(.name | test("supervisor-integration"))'` returns conclusion=success.
  - **Pivot**: if the Linux runner can't run `systemctl --user` (CI sandboxes may lack a user-systemd instance) → drop to a `dbus-run-session` workaround OR move integration tests to a self-hosted runner; if both fail, keep the smoke-only path and rely on the per-platform manual run documented in `distribution/README.md`.
  - **Acceptance**: matrix passes; failure-mode table rows 1–4 in `distribution/README.md` are demonstrably exercised by the test.
  - **Risk**: GitHub Actions Ubuntu runners run as a non-login user; user-systemd may need explicit `loginctl enable-linger`. Mitigation: document the workaround inline in the workflow.
  - **Literature anchor**: Forsgren et al., *Accelerate*, 2018 (test reliability as a DORA prerequisite).

- [ ] Pin tooling versions in CI workflow (`@tasks-md/lint`, `markdownlint-cli2`)
  - **ID**: ci-pin-tooling-versions
  - **Tags**: ci, hygiene, scout
  - **Estimate**: 30m
  - **Details**: `.github/workflows/ci.yml` invokes `npx -y @tasks-md/lint@latest TASKS.md` (tasks-lint job) and `npx -y markdownlint-cli2 ...` (markdownlint job, no version specifier at all). Both will silently pick up new versions on every CI run, contradicting `ARCHITECTURE.md` § "Versioning & dependency evolution" (*"Pin major versions of all dependencies"*) and the chaos-engineering discipline of constitutional rule #7 (a new tasks-md or markdownlint-cli2 release on Friday could break Monday's CI without us controlling when). Pin both: change `@tasks-md/lint@latest` to a specific minor (e.g., `@tasks-md/lint@^0.7.0`), and `markdownlint-cli2` invocation to either the lockfile-pinned 0.15.0 (via `pnpm exec markdownlint-cli2 ...`) or `markdownlint-cli2@0.15.0` via npx.
  - **Files**: `.github/workflows/ci.yml`
  - **Verification**: `grep -E '@(tasks-md/lint|latest)' .github/workflows/ci.yml` returns only pinned forms; CI green after the change.
  - **Acceptance**: Both invocations pinned to a specific minor or via the lockfile; ARCHITECTURE.md § "Versioning & dependency evolution" referenced in the PR description; CI green.
  - **Risk**: Pinning means we miss security patches if we forget to bump. Mitigation: dependabot or a quarterly bump task (covered by `review-q3-2026`).
