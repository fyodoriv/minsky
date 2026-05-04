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

- [ ] `ci-experiment-runner-v0` — daily/per-PR experiment execution (rule #9 daily layer)
  - **ID**: ci-experiment-runner-v0
  - **Tags**: novel, ci, conformance
  - **Estimate**: 1–2d
  - **Hypothesis**: A CI step that (a) requires every non-trivial PR to ship a parseable `EXPERIMENT.yaml`, (b) executes its `measurement` command against the merge-base ref, and (c) re-executes against the post-merge `main` ref, records both numbers tagged with the experiment-id into a local `experiment-store` — closing the daily layer of rule #9 — produces a tracked record on ≥95 % of merged PRs within 30 days of landing.
  - **Details**: Two CI jobs. **Job A (gate)**: runs on every PR; fails if `EXPERIMENT.yaml` is missing OR fails `experiment-record validate` OR if `measurement` is not a runnable command. **Job B (record)**: runs after merge to `main` (post-push event); checks out merge-base, runs measurement → `baseline`; checks out current `main`, runs measurement → `treatment`; records `{experiment_id, baseline, treatment, ts, ref}` into `experiment-store/<id>.jsonl` (committed back to a `experiments/` branch OR pushed to OTEL once `otel-lite-backend` lands). The structural test the runner enforces is "the command is runnable and produces a number"; verdict-against-thresholds is the weekly layer's job. Trivial-change exemption: PRs labelled `trivial` skip Job A but must include `<!-- experiment: trivial — see exemption.md -->` whose presence is checked by the gate.
  - **Files**: `.github/workflows/experiment.yml`, `scripts/run-experiment.mjs` (entry point invoked by both jobs), `scripts/run-experiment.test.mjs`, `experiments/.gitkeep`, `docs/experiment-runner.md`.
  - **Verification**:
    - Synthetic PR with valid `EXPERIMENT.yaml` and runnable measurement → Job A green; after merge, Job B records two numbers in `experiment-store/`.
    - Synthetic PR with missing/malformed YAML → Job A red, merge blocked.
    - Synthetic PR with non-runnable measurement → Job A red.
    - Synthetic `trivial`-labelled PR with the exemption comment → Job A green; Job B no-op.
  - **Measurement**: `gh run list --workflow experiment.yml --status success --limit 100 --json conclusion --jq length` ≥ 95 % of `gh run list --workflow experiment.yml --limit 100 --json conclusion --jq length` (within 30 days of landing); `find experiments/ -name '*.jsonl' | wc -l` ≥ count of merged non-trivial PRs in same window.
  - **Pivot**: if the gate produces ≥3 false positives in its first month (e.g., misclassifying a trivial change as non-trivial, or a measurement command that's runnable locally but not in CI), tighten the trivial-detection heuristic OR drop the executability gate and treat the YAML as informational-only — landing the daily layer as soft-fail until the friction subsides.
  - **Acceptance**: Both CI jobs run on every PR; experiment store accumulates records on every non-trivial merge; rule-#9 daily layer is now mechanically enforced.
  - **Anchor**: Fagerholm et al., "Building Blocks for Continuous Experimentation", *RCoSE* 2014 (the per-change experiment runner is the first building block); Kohavi/Tang/Xu, *Trustworthy Online Controlled Experiments*, 2020, ch. 4 (running every change as an experiment); rule #7 (chaos: gate failures must be loud).
  - **Risk**: CI runtime balloons if measurements are slow. Mitigation: enforce a per-experiment timeout (default 60s) with the option to mark slow-but-essential experiments `nightly` — those run on schedule, not on every PR.

- [ ] `experiment-tracker-v0` — weekly / monthly sustained-gain verdicts (rule #9 weekly–monthly layer)
  - **ID**: experiment-tracker-v0
  - **Tags**: novel, conformance, scheduled
  - **Estimate**: 1–2d
  - **Blocked by**: ci-experiment-runner-v0
  - **Hypothesis**: A scheduled job that re-runs each merged experiment's `measurement` at the configured `replay_windows_days` (default `[7, 30]`), compares against `success` / `pivot` thresholds, and emits a `validated`/`regressed`/`inconclusive` verdict per experiment closes the weekly–monthly layer of rule #9. Within 90 days of landing, ≥5 experiments carry a non-`inconclusive` verdict — proving the substrate works on real data, not just fixtures.
  - **Details**: GitHub Actions `schedule` cron (daily 09:00 UTC) iterates `experiments/*.jsonl`; for each entry whose `ts` is older than the next replay-window boundary, checks out the recorded ref (or the latest `main` if `replay_against=current`), runs `measurement`, appends `{ts, ref, value, window_days}` to the experiment's record. Verdict logic: `validated` if value is at or beyond `success` threshold for ≥1 replay window post-merge AND has not regressed below `pivot` since; `regressed` if value crosses `pivot` (in the wrong direction); `inconclusive` otherwise. `regressed` opens an automated TASKS.md entry (`pivot-experiment-<id>`) at P1; `validated` writes a single line to `validated-learnings.md`.
  - **Files**: `.github/workflows/experiment-tracker.yml`, `scripts/replay-experiment.mjs`, `scripts/replay-experiment.test.mjs`, `validated-learnings.md` (seeded with the rule-#9 PR's own experiment as the first entry), `docs/experiment-tracker.md`.
  - **Verification**:
    - Synthetic experiment record with `success: ≥10`, `pivot: <0`, observed values `[12, 11]` at +7d/+30d → emits `validated` and appends one line to `validated-learnings.md`.
    - Synthetic record with same thresholds, observed values `[12, -1]` → emits `regressed` and creates `pivot-experiment-<id>` task in `TASKS.md`.
    - Synthetic record with values `[5, 6]` (below success, above pivot) → emits `inconclusive` with reasoning.
    - Re-running the tracker on already-resolved experiments is a no-op (idempotent).
  - **Measurement**: `pnpm vitest run scripts/replay-experiment.test.mjs` exits 0 with ≥3 cases; 90 days post-landing, `grep -c '^- ' validated-learnings.md` ≥ 5; `grep -cE '^- \[ \] (Pivot|pivot)-experiment-' TASKS.md` ≥ 0 (no false-positive rollback tasks against synthetic-validated experiments).
  - **Pivot**: if after 90 days every replay verdict is `inconclusive` (i.e., signal-to-noise is too low at the 7d/30d windows), shorten the windows AND require larger pre-declared `success` margins — OR raise the bar on which changes are eligible (gate by tag). If still inconclusive at 180 days, the daily-layer measurements are too noisy to support the weekly layer; pivot to declaration-only with quarterly batch review.
  - **Acceptance**: Scheduled workflow runs daily; verdicts accumulate; pivot tasks auto-file; validated learnings accrue.
  - **Anchor**: Ries, *The Lean Startup*, 2011 (build-measure-learn; sustained-gain discipline); Kohavi/Tang/Xu 2020 (statistical rigour and "novelty effect" — value at +1d is misleading; +7d is the floor); Kephart & Chess 2003 (this layer is MAPE-K's Analyze phase, scoped to rule #9).
  - **Risk**: A `regressed` verdict mid-replay opens a TASKS.md entry — risk of churn if the regression is itself noise. Mitigation: require regression to persist across 2 consecutive replay windows before opening the pivot task.

- [ ] `scripts-ts-check-migration` — add `// @ts-check` to existing scripts/*.mjs incrementally
  - **ID**: scripts-ts-check-migration
  - **Tags**: ci, hygiene, scout, rule-10
  - **Estimate**: 2–3h (per script ~20–30 min × 5 scripts)
  - **Hypothesis**: Adding `// @ts-check` + JSDoc types to each existing scripts/*.mjs (rule-1, rule-2, rule-5, rule-7, pr-self-grade) brings them under strict tsc enforcement. Total errors fixed: ~131 (counted at scripts/tsconfig.json setup time). Once all six scripts (rule-3 already migrated) opt in, flip `checkJs: true` in scripts/tsconfig.json and drop the per-file directive — single switch, no two-modes drift.
  - **Details**: For each script + its test file: add `// @ts-check` at top, add JSDoc `@param` / `@returns` / `@typedef` annotations everywhere needed, fix the strict-null and noUncheckedIndexedAccess errors that surface, ensure tsc passes. Suggest one PR per script to keep diffs reviewable. Ratchet: when all 6 are checked, flip `checkJs: true` and remove all six `// @ts-check` directives (they become redundant).
  - **Files**: `scripts/check-rule-1-novel-justification.mjs` (+ test), `scripts/check-rule-2-dep-coverage.mjs` (+ test), `scripts/check-rule-5-glossary-discipline.mjs` (+ test), `scripts/check-rule-7-chaos-coverage.mjs` (+ test), `scripts/check-pr-self-grade.mjs` (+ test), `scripts/tsconfig.json` (final flip)
  - **Verification**: `pnpm typecheck` clean across `scripts/`; existing tests still pass; CI green.
  - **Measurement**: post-migration, `grep -c '// @ts-check' scripts/*.mjs` returns 0 (the per-file directives have been retired); `cat scripts/tsconfig.json | grep -c '"checkJs": true'` returns 1.
  - **Pivot**: if a script genuinely doesn't admit clean strict typing (e.g., heavy reliance on dynamic `process.env` shapes that fight `noUncheckedIndexedAccess`), keep the `// @ts-check` directive on it indefinitely AND add a one-line comment block above explaining why the global flip is deferred. Don't lower the strictness floor.
  - **Acceptance**: All 6 scripts pass strict tsc; final PR flips `checkJs: true` and removes the per-file directives; CI green throughout.
  - **Anchor**: rule #10 (deterministic enforcement — the linters that enforce constitutional rules must themselves be type-checked, otherwise the rules they enforce are only as stable as the linter's runtime behaviour); Microsoft TypeScript handbook on `// @ts-check` (the canonical incremental-strictness pattern).
  - **Risk**: One script's strict-typing might surface a real bug. Mitigation: that's the point — if a bug is found, fix it in the same migration PR and note it in the commit. Don't paper over with `@ts-ignore`.

- [ ] `ci-rule-4-otel-coverage` — CI lint: every exported public function in `novel/**` carries an `@otel` JSDoc tag
  - **ID**: ci-rule-4-otel-coverage
  - **Tags**: ci, conformance, rule-10
  - **Estimate**: 4–6h
  - **Hypothesis**: A TypeScript-AST-walking lint that requires every `export`-ed function/method in `novel/**/*.ts` (non-test) to carry a JSDoc `@otel <span-name>` annotation OR an `@otel-exempt <reason>` annotation enforces rule #4 ("everything measurable, everything visible") at PR time, without waiting for runtime traces to reveal gaps.
  - **Details**: Build `scripts/check-rule-4-otel-coverage.mjs` using the TypeScript compiler API. Walks every `novel/**/*.ts` (non-test); for each exported function/method, requires the JSDoc to contain `@otel <span-name>` (matching the OTEL naming convention `<package>.<verb>`) OR `@otel-exempt <one-line-reason>`. Reports missing annotations with file:line. The implementation may not actually emit the span (that's a runtime concern), but the *contract* is checked.
  - **Files**: `scripts/check-rule-4-otel-coverage.mjs`, `scripts/check-rule-4-otel-coverage.test.mjs`, `.github/workflows/ci.yml`
  - **Verification**: synthetic file with an exported function lacking both annotations → fails with file:line; same file with `@otel <span>` → passes; same file with `@otel-exempt pure-function` → passes.
  - **Measurement**: `node scripts/check-rule-4-otel-coverage.mjs` exits 1 against the synthetic-missing fixture and 0 against the annotated fixture; `pnpm vitest run scripts/check-rule-4-otel-coverage.test.mjs` exits 0.
  - **Pivot**: if more than 30 % of currently-exported functions need `@otel-exempt` (i.e., the rule is over-broad for low-level helpers), narrow the scope to public-API surface only — functions exported from a package's top-level `index.ts`, not from internal modules.
  - **Acceptance**: CI job runs on every PR; rule #4's contract is mechanically enforced; the spec-monitor doesn't need to "look for missing OTEL".
  - **Anchor**: rule #10; OpenTelemetry specification (CNCF 2020+); Gregg, *Systems Performance*, 2014 (USE method — instrumentation as a structural property).
  - **Risk**: TS-AST traversal is heavier than grep. Mitigation: cache by content-hash; run on diff-base only when feasible.

- [ ] `spec-monitor-deterministic-rewrite` — split `spec-monitor-skill` into deterministic linters + a thin LLM advisory layer
  - **ID**: spec-monitor-deterministic-rewrite
  - **Tags**: novel, conformance, rule-10
  - **Estimate**: 1d (assumes ci-rule-1..7 land first)
  - **Blocked by**: ci-rule-4-otel-coverage
  - **Hypothesis**: Once rules #1–7 + #9 each have a deterministic CI lint, the residual scope of `claude-spec-monitor` is purely advisory (prose-quality of hypotheses, smell-test of pivot thresholds, narrative drift) — and it can be rewritten as a thin Claude Skill that *augments* the deterministic linters with judgement-heavy questions, never substitutes for them. The deterministic linters catch ≥90 % of what today's spec-monitor-skill is meant to catch; the Skill handles the remaining ≤10 %.
  - **Details**: Reframes the prior `spec-monitor-skill` task. Steps: (1) audit the deterministic linters that ship in the seven `ci-rule-*` tasks; (2) enumerate the rule-violation classes they cannot catch (the residual judgement scope); (3) ship `@minsky/spec-monitor` as a Claude Skill whose remit is *only* that residual scope, declared in its own `SKILL.md`; (4) the Skill never fails CI — its output is a structured advisory report committed to `spec-advisories/<date>.md`; (5) the ratchet-rule applies — any rule the Skill currently checks that has a deterministic linter is *removed* from the Skill's scope in the same PR.
  - **Files**: supersedes `novel/spec-monitor/` from the prior task; `novel/spec-monitor/SKILL.md`, `novel/spec-monitor/test/synthetic-drift/`, `spec-advisories/.gitkeep`
  - **Verification**:
    - The Skill loads in a Claude Code session: `claude --skill ./novel/spec-monitor/`
    - Run against synthetic *judgement-only* fixtures (a hypothesis that's syntactically valid but semantically vacuous): produces an advisory entry with `rule_id`, `evidence`, `severity`, `suggested_repair`.
    - Run against deterministic-rule-violating fixtures (a hypothesis that should be caught by `ci-experiment-runner-v0`): the Skill is silent — *not* its job. The `ci-rule-*` linters catch it.
    - The CI never gates merges on the Skill's verdict.
  - **Measurement**: `pnpm vitest run novel/spec-monitor/test/judgement-only/` exits 0 with ≥3 fixtures; `grep -RE 'spec-monitor.*required' .github/workflows/` returns no matches (the Skill is never a required check).
  - **Pivot**: if the residual judgement scope turns out to be empty (i.e., every plausible rule-violation can be deterministically caught), drop the Skill entirely — rule #10 says "whatever cannot be deterministically checked is not a constitutional rule", which means the Skill has no remit.
  - **Acceptance**: Skill ships, advisory-only; the prior `spec-monitor-skill` task is closed by this one (this task is its replacement); `vision.md` § 10 is referenced in the Skill's SKILL.md as the framing rule.
  - **Anchor**: rule #10 (vision.md § 10); Havelund & Goldberg 2008 (runtime verification — but split into deterministic-monitor + advisory-judgement); Hunt & Thomas 1999 Tip 32 ("crash early") — applied here as "fail deterministically".
  - **Risk**: The Skill's residual scope drifts upward over time as contributors add "informal" rules that don't fit any linter. Mitigation: the Skill's SKILL.md has a hard cap on scope (≤5 advisory rules at any time); adding a sixth requires either retiring one or shipping a deterministic linter for it.

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

<!-- spec-monitor-skill (the prior P2 task) is superseded by `spec-monitor-deterministic-rewrite` in P1. Per rule #10 (deterministic enforcement), the previous shape — a Claude Skill as the *primary* enforcement of every constitutional rule — is incompatible with the iron-rule "enforcement is deterministic, not LLM-driven" clause. The replacement task splits the Skill's remit: deterministic linters (`ci-rule-1` … `ci-rule-7`) take the load-bearing share; the residual judgement scope ships as an advisory-only Claude Skill (`spec-monitor-deterministic-rewrite`). Removing this block is the ratchet-rule from rule #10 in action: the prior approach is *removed* in the same PR that introduces the deterministic replacement. -->

- [ ] Implement `claude-mape-k-loop` v0 (the autonomic manager)
  - **ID**: mape-k-loop-v0
  - **Tags**: novel, extraction-target
  - **Estimate**: 3–5d (largest novel layer)
  - **Blocked by**: spec-monitor-deterministic-rewrite
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

- [ ] Lighter OTEL backend evaluation
  - **ID**: otel-lite-backend
  - **Tags**: research
  - **Estimate**: 4–6h
  - **Hypothesis**: A SQLite-backed (or comparably lightweight) OTEL store covers the three signals (traces / metrics / logs) needed by Minsky's success metrics with on-disk footprint <1 GB / month and install steps ≤3 commands — making it preferable to Loki+Tempo+Prometheus+Grafana for the solo-dev tier.
  - **Details**: Loki+Tempo+Prometheus+Grafana is heavy for single-dev install. Evaluate SQLite-backed exporter or similar. Document pros/cons.
  - **Verification**: `research.md` has a "Lighter OTEL backend" comparison table (size, install steps, query language, dashboard support); recommendation stated; if SQLite path chosen, P1 task created
  - **Measurement**: `grep -c '^## Lighter OTEL backend' research.md` returns 1 and the section contains a 4-column table (Backend | Disk/month | Install steps | Query) with ≥3 candidates evaluated and one recommended.
  - **Pivot**: if no candidate satisfies <1 GB/month AND ≤3 install commands AND can answer the success-criteria queries from `vision.md`, keep Loki+Tempo+Prometheus+Grafana and file a follow-up to lower the OTEL signal volume instead.
  - **Acceptance**: research.md updated with comparison and recommendation; if SQLite path chosen, follow-up P1 task filed
  - **Anchor**: OpenTelemetry specification (CNCF 2020+); Gregg, *Systems Performance*, 2014 (USE method as the lens for "what does this backend need to support").
  - **Risk**: Lighter backend may lack features needed later (distributed traces, long retention). Decide on a defined feature set; revisit when missing features bite.

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

- [ ] `handoff-spec-size-cap` — enforce a per-document size cap in the handoff parser
  - **ID**: handoff-spec-size-cap
  - **Tags**: novel, hardening
  - **Estimate**: 1–2h
  - **Hypothesis**: A 1 MB hard cap enforced at the entry of `parseHandoffs()` (rejecting larger inputs with a structured `ParseError` of `kind: input-too-large`) covers the row-6 failure mode in `novel/handoff-spec/README.md`'s chaos-verification table without changing the parser's algorithmic shape — converting "let it OOM" into "let it crash with a precise error".
  - **Details**: Add a length check at the top of `parseHandoffs(source)`. If `Buffer.byteLength(source, "utf-8") > 1_048_576`, return `{ handoffs: [], errors: [{ kind: "input-too-large", line: 0, message: "document exceeds 1 MB cap" }] }`. Add a test fixture (synthetic 2 MB string built by repetition; do not commit the literal bytes — the test generates them) that asserts the structured error path. The cap is configurable via a second `parseHandoffs(source, { maxBytes })` overload defaulting to `1_048_576`. Surfaced by the rule-#7 chaos-coverage CI lint when row 6 of the failure-mode table needed a real follow-up task.
  - **Files**: `novel/handoff-spec/src/index.ts`, `novel/handoff-spec/src/index.test.ts`
  - **Verification**: synthetic 2 MB input → returns one `ParseError` with `kind: "input-too-large"`; 1 MB - 1 byte input parses normally; cap override (`{ maxBytes: 1024 }`) rejects a 2 KB input.
  - **Measurement**: `pnpm vitest run novel/handoff-spec/src/index.test.ts` exits 0 with the three new assertions; `wc -l novel/handoff-spec/src/index.ts` increases by ≤15 lines (i.e., the cap doesn't bloat the parser).
  - **Pivot**: if 1 MB proves too tight in real handoffs (any legitimate handoff record exceeds 1 MB in the first 90 days), bump the cap to 4 MB and revisit; if even 4 MB is hit, the parser is the wrong shape for the workload — pivot to a streaming parser per `parsimmon` / `chevrotain`.
  - **Acceptance**: Row 6 of `novel/handoff-spec/README.md`'s failure-mode table is no longer deferred — the chaos test exists; the rule-#7 chaos-coverage lint passes against a live test reference.
  - **Anchor**: Armstrong, *Programming Erlang*, 2007 (let it crash, but with a precise error); rule #7 (chaos engineering); rule #6 (let-it-crash discipline).
  - **Risk**: Real-world handoff documents could legitimately exceed 1 MB (e.g., embedded base64 attachments). Mitigation: the override option lets callers raise the cap at the call site; the default is conservative.

## P3

- [ ] Multi-machine scope investigation
  - **ID**: multi-machine
  - **Tags**: future, research
  - **Estimate**: 4h (research only)
  - **Hypothesis**: A research-only document enumerating the multi-machine deltas (state sync, identity, supervision, blast-radius scaling) is sufficient for the next 12 months — actual implementation is premature until single-machine MAPE-K is stable.
  - **Details**: Initial scope is single-dev-machine. Document what changes for multi-machine / team setups. Don't implement.
  - **Verification**: `research.md` "Multi-machine scope" section enumerates the deltas (state synchronization, identity, supervision)
  - **Measurement**: `grep -c '^## Multi-machine scope' research.md` returns 1; the section enumerates ≥4 deltas (state sync, identity, supervision, blast radius), each with a literature anchor.
  - **Pivot**: if writing the doc reveals that the single-machine architecture has assumptions that prevent multi-machine evolution (e.g., process-local in-memory state that can't be split), file a follow-up architecture task and stop the research — implementation premature.
  - **Acceptance**: research.md section added
  - **Anchor**: Lamport, "Time, Clocks, and the Ordering of Events", *CACM* 1978 (distributed-systems baseline); Helland 2007 (eventual consistency).
  - **Risk**: Research drifts into design before single-machine works. Cap scope at "what would have to change," not "how to build it."

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

- [ ] DSPy idiom fit evaluation
  - **ID**: dspy-fit-eval
  - **Tags**: research
  - **Estimate**: 4–6h
  - **Hypothesis**: DSPy's compiler / optimizer idiom maps cleanly onto Minsky's `PromptOptimizer` adapter shape — at least 3 of the 5 typical Minsky use cases (persona prompt tuning, MAPE-K rollout, post-hoc fault explanation, drift-report rephrasing, persona handoff) fit the DSPy `dspy.Module` + `dspy.Optimize` signature without contortion.
  - **Details**: First practical attempt at using DSPy for prompt A/B in `mape-k-loop-v0`. Document where the idiom fits vs where it forces awkward shape.
  - **Verification**: `research.md` "DSPy fit" entry contains 3 wins + 3 frictions with concrete code references; if poor fit, alternative `PromptOptimizer` implementation proposed in the same entry
  - **Measurement**: `grep -c '^## DSPy fit' research.md` returns 1; the section enumerates ≥3 wins + ≥3 frictions with code-block citations; if friction count > 3, the section names a fallback (e.g., direct API + manual A/B harness).
  - **Pivot**: if frictions outnumber wins ≥2:1 OR the friction is "DSPy assumes a Python runtime we won't ship", drop DSPy and design a minimal `PromptOptimizer` interface that calls the Anthropic API directly with structured logging.
  - **Acceptance**: research.md updated; if poor fit, alternative `PromptOptimizer` implementation proposed
  - **Anchor**: Khattab et al., "DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines", 2023; rule #1 (use the existing tool when possible).
  - **Risk**: DSPy idiom is a moving target — pin the version evaluated; revisit on new minor releases.

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

- [ ] CI lint that enforces "every new top-level artifact gets a `vision.md` index row"
  - **ID**: ci-lint-pattern-index
  - **Tags**: ci, conformance
  - **Estimate**: 4–6h
  - **Hypothesis**: A diff-based CI check that fails when a PR adds a top-level artifact without a corresponding pattern-index row mechanically enforces rule #8 with ≤2 % false-positive rate (against test files, fixtures, generated files) and prevents 100 % of "row-less" merges going forward.
  - **Details**: Constitutional rule #8 commits every PR that adds a new file / package / interface to add (or amend) a row in `vision.md` § "Pattern conformance index". Today nothing enforces it. Build a small Node script (under `scripts/`) that runs in CI: diff the PR against `main`; for any added top-level file or new pnpm workspace package, require a corresponding row in the index (heuristic: file path or package name appears in the index's table). Fails the `glossary-discipline` job (rename appropriately, e.g., `pattern-discipline`) when a new artifact lacks a row. Allow opt-out by `<!-- pattern: not-applicable -->` comment in the file with a one-line reason.
  - **Files**: `scripts/check-pattern-index.mjs`, `.github/workflows/ci.yml`
  - **Verification**: a synthetic PR adding a new top-level file without an index row fails the new check; the same PR with a row passes; opt-out comment is honored; CI runs the new check on every PR.
  - **Measurement**: `node scripts/check-pattern-index.mjs --diff-base=main` exits 1 against the synthetic-missing-row fixture and exits 0 against the synthetic-with-row fixture; `gh run list --workflow ci.yml --json conclusion --jq '[.[] | select(.conclusion == "failure")] | length'` for the next 30 PRs after this lands counts how many row-less PRs were caught.
  - **Pivot**: if the check produces ≥3 false positives in its first month, scope is too broad; tighten to `novel/**` + root `*.md` only and revisit. If the check fires on ≥30 % of PRs, the index format is too coarse; consider machine-readable annotations in source files instead.
  - **Acceptance**: Script + CI job ship together; new check fails fast on a synthetic test fixture; rule #8 is now mechanically enforced.
  - **Anchor**: Beck, *Extreme Programming Explained*, 1999 (continuous integration as the constraint enforcer); Hunt & Thomas, *The Pragmatic Programmer*, 1999, Tip 32 ("crash early").
  - **Risk**: False positives if path matching is too strict (e.g., new test file). Mitigation: scope to `novel/**`, top-level docs (`*.md` at root), `setup.sh`, `distribution/**`, `.github/workflows/**` — not test files or fixtures.

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

- [ ] Pin tooling versions in CI workflow (`@tasks-md/lint`, `markdownlint-cli2`)
  - **ID**: ci-pin-tooling-versions
  - **Tags**: ci, hygiene, scout
  - **Estimate**: 30m
  - **Hypothesis**: Pinning both `@tasks-md/lint` and `markdownlint-cli2` to specific minor versions eliminates "Friday-release breaks Monday-CI" failures (chaos rule #7) without losing security-patch agility, given the quarterly review covered by `review-q3-2026`.
  - **Details**: `.github/workflows/ci.yml` invokes `npx -y @tasks-md/lint@latest TASKS.md` (tasks-lint job) and `npx -y markdownlint-cli2 ...` (markdownlint job, no version specifier at all). Both will silently pick up new versions on every CI run, contradicting `ARCHITECTURE.md` § "Versioning & dependency evolution" (*"Pin major versions of all dependencies"*) and the chaos-engineering discipline of constitutional rule #7 (a new tasks-md or markdownlint-cli2 release on Friday could break Monday's CI without us controlling when). Pin both: change `@tasks-md/lint@latest` to a specific minor (e.g., `@tasks-md/lint@^0.7.0`), and `markdownlint-cli2` invocation to either the lockfile-pinned 0.15.0 (via `pnpm exec markdownlint-cli2 ...`) or `markdownlint-cli2@0.15.0` via npx.
  - **Files**: `.github/workflows/ci.yml`
  - **Verification**: `grep -E '@(tasks-md/lint|latest)' .github/workflows/ci.yml` returns only pinned forms; CI green after the change.
  - **Measurement**: `grep -cE '@latest|markdownlint-cli2[^@]' .github/workflows/ci.yml` returns 0; `gh run list --workflow ci.yml --status failure --search 'event:schedule' --created '>=2026-05-04' --json conclusion --jq length` (count of unexpected scheduled-CI failures attributable to dep drift) ≤ 0 over the next 30 days.
  - **Pivot**: if a pinned version blocks a real bug fix (e.g., a CVE in markdownlint-cli2 < pinned-minor), bump immediately and revisit the pin policy — possibly switching to dependabot-driven auto-bumps for tools (vs majors).
  - **Acceptance**: Both invocations pinned to a specific minor or via the lockfile; ARCHITECTURE.md § "Versioning & dependency evolution" referenced in the PR description; CI green.
  - **Anchor**: rule #7 (chaos engineering — trust no unverified dependency); ARCHITECTURE.md § "Versioning & dependency evolution".
  - **Risk**: Pinning means we miss security patches if we forget to bump. Mitigation: dependabot or a quarterly bump task (covered by `review-q3-2026`).
