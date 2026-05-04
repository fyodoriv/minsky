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

<!-- These P0 tasks operationalise the "24/7 autonomy" gap analysis: the parts that turn Minsky's pure functions + adapters + lints into a running system that Claude Code on its own cannot do. Each task is a precondition for the system to actually run unattended overnight. `observability-backend-deploy` shipped as `feat: observability backend deploy (OpenObserve install + dashboard Strategy)` — see vision.md § "Pattern conformance index" row 66. -->

- [ ] `tick-loop-daemon-real-spawn-flip` — drop --dry-run, gate via env var; integration test against real claude (sub-task 3/3 of real-spawn)
  - **ID**: tick-loop-daemon-real-spawn-flip
  - **Parent**: tick-loop-daemon-real-spawn
  - **Tags**: novel, runtime, supervision, blocker
  - **Estimate**: 4h
  - **Hypothesis**: Once the SpawnStrategy interface (sub-task 1) and the real BudgetGuard (sub-task 2) have landed, flipping the default Strategy from `DryRunSpawnStrategy` to `ProcessSpawnStrategy` is a one-line constructor swap. The flip lands together with: dropping the hard-coded `--dry-run` arg from `bin/tick-loop.mjs` + `distribution/systemd/run-tick-loop.sh`; gating dry-run via `MINSKY_TICK_DRY_RUN=1` env var instead; one integration test that spawns a real `claude --resume` against a synthetic task (gated on `claude` presence; skipped in CI). Closes user-story-001-integration-test-real's blocker.
  - **Details**: 1) `bin/tick-loop.mjs` — read `MINSKY_TICK_DRY_RUN` env; default `false`; pick `DryRunSpawnStrategy` vs `ProcessSpawnStrategy` accordingly. 2) `distribution/systemd/run-tick-loop.sh` — drop `--dry-run` flag; the env-var path is the new control surface. 3) `novel/tick-loop/src/daemon.test.ts` — one integration test gated on `which claude` (skip in CI). 4) Vision row 254 collapses to `partial-real-spawn` (the dry-run guard is now an opt-in, not the default).
  - **Files**: `novel/tick-loop/bin/tick-loop.mjs`, `distribution/systemd/run-tick-loop.sh`, `novel/tick-loop/src/daemon.test.ts`, `vision.md`, `EXPERIMENT.yaml`
  - **Verification**: `bash distribution/systemd/run-tick-loop.sh --max-iterations=1` (with `MINSKY_TICK_DRY_RUN=1` for CI safety) exits 0; integration test green on self-hosted runner; existing tests still pass.
  - **Measurement**: `pnpm vitest run novel/tick-loop --reporter=json | jq -e '.numPassedTests >= 19 and .numFailedTests == 0'` exits 0; `gh run list --workflow ci.yml --limit 30 --json conclusion --jq '[.[] | select(.conclusion=="success")] | length' >= 28` (≥93 % green over 30 runs after merge).
  - **Pivot**: if `claude --resume` deadlocks on stdin without a TTY, pivot to a temp-file-based brief handoff (pre-registered in parent task's Pivot field).
  - **Acceptance**: daemon runs against real `claude` end-to-end on self-hosted runner; story-001's MTTR <5 min claim becomes measurable; vision row 254 raises to `partial-real-spawn`.
  - **Anchor**: rule #2; Armstrong 2007 (let-it-crash — supervisor `Restart=on-failure` is the respawn policy); Kephart & Chess 2003 (MAPE-K — partial-real-spawn after this flip); Beyer SRE 2016 Ch. 3.
  - **Risk**: highest of the three; mitigated by the prior two sub-tasks shipping the interface + real budget independently. The integration test is gated on `claude` presence so CI is unaffected.

- [ ] `user-story-001-integration-test-real` — actual integration test against the real daemon (not mock)
  - **ID**: user-story-001-integration-test-real
  - **Tags**: testing, validation, runtime
  - **Estimate**: 1d
  - **Blocked by**: tick-loop-daemon-real-spawn-flip
  - **Hypothesis**: A `user-stories/001-loop-runs-overnight.test.ts` that drives the real daemon (via `bash distribution/systemd/run-tick-loop.sh --max-iterations=12 --tick-interval-s=5` — 1-min compressed sim of 12 ticks) closes ≥4 P2 tasks from a synthetic TASKS.md fixture, emits ≥1 OTEL span per phase, and triggers exactly 1 morning push, satisfying story 001's acceptance criteria within CI runtime <10 min.
  - **Details**: Replaces the coverage-manifest test (PR #82) with a real driver. Fixture: synthetic TASKS.md with 4 P2 tasks designed to complete deterministically. Mock Anthropic client (reuse `@minsky/tick-loop`'s `MockAnthropicClient`). Real OpenObserve (started + torn down in test setup). StubNotifier asserts 1 push call.
  - **Files**: `user-stories/001-loop-runs-overnight.test.ts`, `user-stories/001-loop-runs-overnight.md` (mark Phase: Implemented)
  - **Verification**: `pnpm vitest run user-stories/001-loop-runs-overnight.test.ts` exits 0 within 5 min; chaos-coverage manifest re-checks (rows now `covered` instead of `self-hosted`).
  - **Measurement**: `pnpm vitest run user-stories/001-loop-runs-overnight.test.ts --reporter=json | jq -e '.numPassedTests >= 4 and .numFailedTests == 0'`.
  - **Pivot**: if compressed-sim coverage stays below the chaos table's 80% threshold even with the real daemon, the user-story 001 spec needs splitting (per its own documented Pivot). File a follow-up to the spec.
  - **Acceptance**: integration test green on every CI run; chaos coverage re-classified as `covered` for ≥10/12 rows in the manifest.
  - **Anchor**: Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016; Beck, *Extreme Programming Explained*, 1999 (CI keeps the build fast).
  - **Risk**: real daemon spawning real subprocesses inflates CI cost. Mitigation: max-iterations cap + tight tick-interval ensure <5min wall-clock; the nightly self-hosted run (sub-task 3 of original first-integration-test) extends to full 60 min.

(empty in P0 below — work the highest-priority unblocked item from the list above, then move to P1.)

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
  - **Research**: 2026-05-04 — exact issue text drafted (ready to paste). Read-only research only; no `gh issue create` was run. Source code citations re-use the read-only findings PR #75 landed (now lifted into `research.md` § "OMC handoff persistence" and gated by `scripts/omc-roundtrip.mjs`) (path layout in `src/team/state-paths.ts`, task shape in `src/team/types.ts:38-58, 195-213`, write site `src/team/state/tasks.ts:90`, read/write call sites `src/team/task-file-ops.ts:157,210-243,321-376`). Maintainer tone sampled from recent OMC issues (`gh issue list --repo Yeachan-Heo/oh-my-claudecode --limit 5 --state all`): they use `## Summary` / `## Environment` / `## Reproduction` / code-fenced file paths and line numbers; technical, structured, deferential to `claude-code` upstream conventions. No prior declined proposal for tasks.md found in the issue tracker. Recipient surface: <https://github.com/Yeachan-Heo/oh-my-claudecode/issues/new>. Ping: maintainer `@Yeachan-Heo` (no other co-maintainers visible). Draft below — paste title in title field, paste body (between the fences, not including them) in the body field.

    ````markdown
    Title: Proposal: optional TASKS.md adapter for /team mode (ecosystem alignment with tasks.md spec)

    ## Summary

    Hi @Yeachan-Heo — proposing an optional adapter so `/team` mode can read its task list from a `TASKS.md` at repo root following the [tasks.md spec](https://github.com/tasksmd/tasks.md), with full backward compatibility (current behaviour is the default).

    The tasks.md spec is a minimal, plain-Markdown task-board format maintained by [tasksmd/tasks.md](https://github.com/tasksmd/tasks.md) (kanban-style board renderer + linter). Multiple tools are converging on it as a portable task substrate: the upstream `tasksmd` toolchain itself, the Minsky project (constitutional rule: TASKS.md is the actor message store — Hewitt 1973), and any tool that wants its task list to be human-editable and version-controlled in the same file plain-text editors and `gh` already understand.

    OMC's `/team` mode already has a well-shaped persisted task store — this proposal is just to let users point that store at a Markdown file when they want a portable substrate.

    ## Where the integration would land (code-level)

    From a read of `Yeachan-Heo/oh-my-claudecode@main`:

    - `src/team/state-paths.ts` — `TeamPaths` declares the canonical layout (`.omc/state/team/<teamName>/tasks/task-<id>.json`, `config.json`, `events.jsonl`, etc.). An adapter would add an alternate source resolver: when `config.json` carries `tasks_source: "tasks.md"`, the adapter reads `<repoRoot>/TASKS.md` instead of the per-task JSON files. Default unchanged.
    - `src/team/types.ts` (lines ~38-58, ~195-213) — `TaskFile` / `TeamTask` shape: `id`, `subject`, `description`, `status`, `owner?`, `blocks[]`, `blocked_by?`, `created_at`, `version?`, `claim?`, etc. Maps cleanly to tasks.md fields:
      - `id` ↔ tasks.md `**ID**`
      - `subject` ↔ task title (the `- [ ]` / `- [x]` line)
      - `description` ↔ tasks.md `**Details**`
      - `status` (`pending | in_progress | completed | blocked`) ↔ `[ ]` / `[x]` checkbox + an extension `**Status**` field for the non-binary states
      - `owner` / `claim.owner` ↔ tasks.md `**Owner**`
      - `blocked_by` / `depends_on` ↔ tasks.md `**Blocked by**`
      - `created_at` ↔ provenance comment
      - `version` (optimistic concurrency) ↔ idempotency key in a hidden HTML comment, preserved on round-trip
    - `src/team/state/tasks.ts:90` — `writeAtomic(taskFilePath, JSON.stringify(updated, null, 2))` is the single canonical write site for `claimTask`. An adapter parallel to this would re-render the relevant tasks.md block (write-back is the harder direction; could ship in a v2).
    - `src/team/task-file-ops.ts:157, 210-243, 321-376` — read/write call sites; the read side is where the adapter reads tasks.md when `tasks_source: "tasks.md"` is set.

    The richer OMC v2 fields (`TeamTaskV2`'s `delegation_compliance`, `claim.token`, `claim.leased_until`) don't have natural tasks.md equivalents; the adapter would lossy-project them on read and preserve them in a hidden comment block on write so round-trips are non-destructive.

    ## Why this is ecosystem alignment, not a single-project request

    Three independent adopters of the tasks.md spec today:

    1. The spec maintainers themselves at [tasksmd/tasks.md](https://github.com/tasksmd/tasks.md) (board renderer + linter — `npx @tasks-md/lint`).
    2. Minsky (long-running orchestration substrate; uses TASKS.md as its actor message store).
    3. Any tool that wants tasks to be `git`-diffable, plain-Markdown, editable in a plain-text editor without a runtime — a non-trivial superset given how many devs already keep a `TASKS.md` or `TODO.md` by convention.

    For OMC users specifically, this would mean: a team member without OMC installed can still read and edit the task list as plain Markdown; `gh` PR diffs show task changes in a human-readable format; the task list survives independently of `.omc/state/`.

    ## Concrete proposal

    Add an optional `tasks_source` field to `config.json`:

    ```json
    {
      "name": "my-team",
      "tasks_source": "tasks.md"
    }
    ```

    - When unset (default): current behaviour — read/write `.omc/state/team/<teamName>/tasks/task-<id>.json`.
    - When `"tasks.md"`: read `<repoRoot>/TASKS.md` per the [tasks.md spec](https://github.com/tasksmd/tasks.md); fall back to current behaviour if absent or malformed (with a warning).
    - v0 scope: read-only OMC ← TASKS.md (so OMC's optimistic-concurrency `version` field stays authoritative). Write-back can land in a v1 once the round-trip semantics are settled.

    No breaking changes to existing teams; no new required dependencies (a small Markdown parser would suffice, or `@tasks-md/lint`'s parser if you want to share the spec's reference implementation).

    ## Open question

    Does this fit `/team` mode's design intent — i.e., is the canonical task store something `/team` would want to be pluggable — or would you prefer this live as a separate plugin / adapter package (e.g., `@oh-my-claudecode/tasks-md-adapter`) so the core stays minimal? Happy to draft the PR either way; just want to follow your design preference before writing code.

    Thanks for OMC — `/team` mode's blackboard model is exactly the substrate this is trying to align with.
    ````

  - **Last-enriched**: 2026-05-04

## P2

<!-- spec-monitor-skill and its successor `spec-monitor-deterministic-rewrite` both shipped: the deterministic linters under `scripts/check-rule-{1..7}-*.mjs` + `scripts/check-pattern-index.mjs` + `scripts/check-pr-self-grade.mjs` carry the load-bearing share of runtime verification (rule #10's enforcement model), and the residual judgement-heavy scope ships as the advisory-only Claude Skill at `novel/spec-monitor/SKILL.md` — capped at ≤5 advisory rules per the rule-#10 ratchet. See `vision.md` § "Pattern conformance index" rows 11 and 35. -->

<!-- omc-tasksmd-bridge-v0 shipped read-only OMC → tasks.md (`@minsky/omc-tasksmd-bridge` at `novel/bridges/omc-tasksmd/`); see vision.md § "Pattern conformance index" row 62. The bidirectional / claim-propagation half is deferred to v1+ as `omc-tasksmd-bridge-v1-watcher` (P3 below) pending a CRDT story for OMC's optimistic-concurrency `version` field. -->

- [ ] First user-story integration test passes (001) — tracker
  - **ID**: first-integration-test
  - **Tags**: testing, validation, tracker
  - **Estimate**: 6h (decomposed across 3 sub-tasks)
  - **Blocked by**: first-integration-test-nightly-self-hosted
  - **Hypothesis**: A 60-minute compressed simulation reproduces the failure modes that matter for an 8h overnight run with ≥80 % coverage of the failure-mode rows declared in the user-story file, while keeping CI runtime under 10 minutes. Per the documented Pivot below (reframe as 10-min smoke + nightly self-hosted), the work is decomposed into three sub-tasks; this entry is the tracker that closes when all three ship.
  - **Details**: Decomposed on 2026-05-04 per the parent task's documented Pivot. Sub-task 1 (`first-integration-test-coverage-manifest`) ships the coverage manifest test. Sub-task 2 (`first-integration-test-mock-tick-loop`) builds a mock daemon for the in-process 10-min smoke. Sub-task 3 (`first-integration-test-nightly-self-hosted`) wires the nightly self-hosted-runner workflow for the 7 OS-level chaos rows. This block remains as the coordination contract — Hypothesis / Success / Pivot / Measurement / Anchor are the parent-level invariants; the sub-tasks each carry their own rule-#9 fields scoped to their slice.
  - **Verification**: `npm test user-stories/001-loop-runs-overnight.test.ts` passes locally and on CI; OTEL collector receives ≥1 span per task type; CI workflow shows green. (Each sub-task's own Verification cell is the load-bearing one; this tracker closes when all three pass.)
  - **Measurement**: `pnpm vitest run user-stories/001-coverage-manifest.test.ts` exits 0 (sub-task 1) AND `pnpm vitest run novel/tick-loop` exits 0 (sub-task 2) AND `gh run list --workflow nightly-overnight-sim.yml --status success --limit 1 --json conclusion --jq '.[0].conclusion'` returns `success` (sub-task 3).
  - **Pivot**: if the 60-min sim's CI runtime exceeds 10 min OR misses >2 of the user-story's failure modes → reframe as a pair (10-min smoke in CI + nightly self-hosted run that does the full 60-min). **Pivot fired 2026-05-04** — decomposition into 3 sub-tasks landed; this tracker now coordinates the sub-tasks. If even the sub-task path fails (sub-task 2's smoke can't fit in 10 min OR sub-task 3's self-hosted runner is unreachable), the story's overnight assumption is wrong and the story needs splitting.
  - **Acceptance**: All three sub-tasks closed; coverage manifest's ≥80 % ratio holds; nightly self-hosted run lands at least once `success`.
  - **Anchor**: Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016 (steady-state hypothesis); Beck, *Extreme Programming Explained*, 1999 (CI keeps the build fast).
  - **Risk**: 60min compressed sim may miss real overnight failure modes (memory leaks, log rotation, OS sleep). Documented gap; sub-task 3's nightly self-hosted run is the mitigation.

- [ ] Nightly overnight-sim workflow on a self-hosted runner
  - **ID**: first-integration-test-nightly-self-hosted
  - **Parent**: first-integration-test
  - **Tags**: testing, infra, ci, dormant-until-self-hosted-runner
  - **Estimate**: 4h (when self-hosted runner is available)
  - **Hypothesis**: A nightly workflow (`.github/workflows/nightly-overnight-sim.yml`) running the full 60-min sim on a self-hosted runner — using the mock daemon from sub-task 2 — covers the 7 OS-level chaos rows (2, 5, 6, 7, 8, 11, 12) of user-story 001's failure-mode table that GH-hosted runners cannot exercise (libfaketime, iptables, tc qdisc, dd, pmset), without burning CI minutes on the hot per-PR path.
  - **Details**: Triggers when sub-task 2's mock-tick-loop ships AND a self-hosted runner is available (mirrors the precedent of `supervisor-integration-self-hosted-runner` and `lighthouse-self-hosted-runner-pivot`). Workflow uses `runs-on: [self-hosted, linux]`, runs nightly at low-stakes UTC hours, and exercises one randomly-chosen OS-level chaos row per night per `user-stories/001-loop-runs-overnight.md`'s weekly-fault-injection prose. Failures escalate to a Watch-level notification per the user-story's chaos-verification section.
  - **Files**: `.github/workflows/nightly-overnight-sim.yml`, `docs/self-hosted-runner.md` (shared with `supervisor-integration-self-hosted-runner` if it has fired)
  - **Verification**: at least one nightly run lands `success`; the run touches at least one of rows 2, 5, 6, 7, 8, 11, 12 (the OS-fault rows in the manifest).
  - **Measurement**: `gh run list --workflow nightly-overnight-sim.yml --branch main --status success --limit 5 --json conclusion --jq '[.[] | select(.conclusion=="success")] | length >= 1'` exits 0 with `true`.
  - **Pivot**: if self-hosted-runner maintenance burden exceeds the empirical signal value (e.g., the runner needs >1 manual intervention per quarter) OR if no self-hosted runner becomes available within 90 days of sub-task 2 shipping, retire this dormant task and document the OS-level chaos rows as a permanent declared deviation in `user-stories/001-loop-runs-overnight.md`.
  - **Acceptance**: this task fires only after sub-task 2 ships AND a self-hosted runner is available; otherwise it remains a dormant scout entry per the parent `first-integration-test` task's documented Pivot.
  - **Anchor**: Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016 (the documented Pivot from `first-integration-test`'s rule-#9 block — coverage of OS-level rows belongs in a self-hosted runner with real OS primitives); Forsgren, Humble, Kim, *Accelerate*, IT Revolution Press, 2018 (DORA test reliability — a CI gate that doesn't run reliably teaches the team to ignore failure; the nightly cadence is the reliability bound).
  - **Risk**: self-hosted runners introduce supply-chain risk (a compromised runner can leak secrets). Mitigation: scope the runner to public-repo / non-secret jobs only; share infrastructure with `supervisor-integration-self-hosted-runner` if both fire (cost amortisation); standard GH guidance.

## P3

- [ ] `omc-tasksmd-bridge-v1-watcher` — reverse-sync + filesystem watcher for the OMC ↔ tasks.md bridge
  - **ID**: omc-tasksmd-bridge-v1-watcher
  - **Tags**: novel, bridge, follow-up, dormant-until-crdt-story
  - **Estimate**: 1–2w (CRDT story + watcher + reverse-sync)
  - **Hypothesis**: Once a CRDT story is sketched for OMC's optimistic-concurrency `version` field (`src/team/state/tasks.ts:90`), a chokidar / `fs.watch`-driven reverse path (tasks.md edits → OMC `claim` / `complete` calls) can propagate a claim in either direction within 1 scheduler iteration without lost-update collisions across 100 random concurrent-edit trials. v0 (read-only) shipped as `@minsky/omc-tasksmd-bridge`; this task closes the deferred half of the original `omc-tasksmd-bridge-v0` Acceptance ("claim propagation in either direction").
  - **Details**: Add `OmcWriter.{claim,complete,update}` mirroring OMC's persisted shape; integrate `chokidar` (or `fs.watch` if portable enough) on both `<repoRoot>/.omc/state/team/**/tasks/*.json` and `<repoRoot>/TASKS.md`; resolve conflicts via OMC's `version` field (compare-and-set). Lossy fields documented in `novel/bridges/omc-tasksmd/README.md` § "Lossy projection" must be addressed before reverse-sync is safe — either widen the tasks.md spec or extend the bridge to a sidecar JSON.
  - **Files**: `novel/bridges/omc-tasksmd/src/{watcher,writer,conflict-resolution}.{ts,test.ts}`, `novel/bridges/omc-tasksmd/README.md` (chaos-table additions for the new failure modes)
  - **Verification**: Round-trip property test (random TASKS.md ↔ OMC trials, ≥95 % pass at 100 trials); claim-propagation E2E (claim in either side observed in the other within 1 scheduler iteration).
  - **Measurement**: `pnpm vitest run novel/bridges/omc-tasksmd/src/round-trip.property.test.ts` exits 0 with ≥95 passed property cases; `pnpm vitest run novel/bridges/omc-tasksmd/src/claim-propagation.e2e.test.ts` exits 0.
  - **Pivot**: if the CRDT story for `version` cannot reach lost-update-free convergence at 100 random concurrent-edit trials (≥1 lost update detected), the reverse path isn't viable; pivot to a *write-throttled* reverse direction (single-writer assumption, scheduler-iteration-rate-limited) and document the asymmetry, OR escalate `omc-tasksmd-issue` to push tasks.md adoption upstream so the bridge can retire entirely.
  - **Acceptance**: Round-trip property test passes ≥95 / 100 trials; claim propagates in either direction within 1 scheduler iteration; bridge published as v1.
  - **Anchor**: Shapiro et al., "Conflict-free Replicated Data Types", *SSS* 2011 (the CRDT story this task waits on); Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (the bridge's eventual-consistency frame); Hewitt 1973 (TASKS.md as the message store).
  - **Risk**: OMC adopts tasks.md upstream before this task lands → the bridge retires entirely (the Goldratt TOC win); track via `omc-tasksmd-issue` in TASKS.md.

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

- [ ] `lighthouse-self-hosted-runner-pivot` — Next-tier pivot if Lighthouse Mobile 0.85 also proves flaky on GH-hosted runners
  - **ID**: lighthouse-self-hosted-runner-pivot
  - **Tags**: infra, testing, ci, pivot-followup, dashboard-web
  - **Estimate**: 4h
  - **Hypothesis**: Following the 2026-05-04 threshold-pivot from 0.9 → 0.85 (`.github/workflows/lighthouse.yml`, vision.md row 58), the new `≥0.85` Lighthouse Mobile gate is *expected* to be stable on GH-hosted runners — the original observations (0.83 / 0.89) sat 1–2 percentage points below 0.9, so a 5-point drop to 0.85 should swallow the noise. If 0.85 also proves flaky (≥2 false-positive failures per 10 runs at the new threshold over 30 days), the residual variance is structural to the GH-hosted runner (CPU steal, neighbour-VM contention) rather than a tunable threshold property — the only remaining lever is to move Lighthouse to a self-hosted runner with predictable CPU. Same precedent as `supervisor-integration-self-hosted-runner`.
  - **Details**: If the trigger fires, gate the `lighthouse-mobile` job on `runs-on: [self-hosted, linux]`. Document the runner provisioning needs (predictable CPU, no nested virtualization, Chromium-installable). Coordinate with `supervisor-integration-self-hosted-runner` to share infrastructure if both fire — one self-hosted runner can host both jobs. If self-hosted is rejected on cost / ownership grounds, retire the Lighthouse gate entirely and rely on the dashboard-web LoC-cap + chaos-table audits as the residual `dashboard-web-v0` performance proxy — document the asymmetry as a declared deviation in vision.md row 58 and `novel/dashboard-web/README.md`.
  - **Files**: `.github/workflows/lighthouse.yml`, `novel/dashboard-web/README.md`, `vision.md` (row 58 update), `docs/self-hosted-runner.md` (shared with `supervisor-integration-self-hosted-runner` if it has also fired)
  - **Verification**: 3 consecutive PRs see `lighthouse-mobile` land as `success` on the self-hosted runner with a Lighthouse score reproducibly above 0.85 (variance band ≤ 0.03 across the 3 runs).
  - **Measurement**: `gh run list --workflow lighthouse.yml --branch main --limit 10 --json conclusion --jq '[.[] | .conclusion] | map(select(. == "success")) | length' >= 8` (≥80 % success rate over the last 10 runs after the move) AND a paired `gh run download` + `jq '.categories.performance.score' lighthouse.json` over the same 10 reports shows max−min ≤ 0.03.
  - **Pivot**: if self-hosted-runner maintenance burden exceeds the empirical signal value (e.g., the runner needs >1 manual intervention per quarter), or if 0.85 proves stable for 30 consecutive days *without* the move (the trigger never fires), retire this dormant task — it is a scout entry, not a commitment. If self-hosted is moved to but the variance remains >0.03 across runs, the gate is non-deterministic at root and should be retired entirely (dashboard-web's LoC-cap + chaos-table audits become the residual proxy).
  - **Acceptance**: This task fires *only* if the new 0.85 threshold sees ≥2 false-positive failures per 10 runs sustained over 30 days. Otherwise it remains a dormant scout entry.
  - **Anchor**: rule #9 (vision.md § 9 — pre-registered pivot threshold; this is the next-tier pivot pre-registered in the original `dashboard-web-lighthouse-ci` task); Forsgren, Humble, Kim, *Accelerate*, IT Revolution Press, 2018 (DORA test-reliability — a CI gate that doesn't run reliably teaches the team to ignore failure); Wilkie, "RED Method", *USENIX SREcon EMEA* 2018 (the duration component is the user-perceived metric — moving runners preserves the metric's semantic); Munafò et al., *Nature Human Behaviour* 1, 0021, 2017 (pre-registration — the next-tier pivot was committed *before* the 0.85 threshold's behaviour was observed, in the same PR that lowered the threshold).
  - **Risk**: Self-hosted runners introduce supply-chain risk (a compromised runner can leak secrets). Mitigation: scope the runner to public-repo / non-secret jobs only; share infrastructure with `supervisor-integration-self-hosted-runner` if both fire (cost amortisation); standard GH guidance (Forsgren 2018 § DORA prerequisites; rule #7).

- [ ] `watch-shortcuts-tailscale-host-substitution` — replace manual host substitution in the Shortcut runbook with a Shortcuts text-input action
  - **ID**: watch-shortcuts-tailscale-host-substitution
  - **Tags**: novel, follow-up, ux, watch-shortcuts
  - **Estimate**: 1–2h
  - **Hypothesis**: The Shortcut runbook in `distribution/shortcuts/README.md` currently asks the operator to substitute `<tailscale-host>` into each Shortcut's URL field by hand (5 substitutions × 5 Shortcuts = 25 manual edits). Apple Shortcuts' "Ask Each Time" / "Get Variable" actions can parameterise the host once at first run and remember it, dropping operator overhead from 25 substitutions to 1 input + 0-touch reuse. The runbook would need a one-time first-run action ("Ask for host" → "Set Variable") plus a shared `host` variable across the 5 Shortcuts, OR a single shared "host" Shortcut that the 5 polling Shortcuts call as a sub-Shortcut.
  - **Details**: Update `distribution/shortcuts/*.shortcut.json` to reference a logical `host_var` placeholder; update the runbook step A.2 to include the "Ask for host on first run, store as `host` variable, use `Combine Text` to assemble the URL"; add a smoke-test assertion that no `*.shortcut.json` has a literal Tailscale host in its `endpoint.url` (must be `<tailscale-host>` placeholder). Optional: ship a 6th `setup.shortcut.json` whose only purpose is to capture the host once.
  - **Files**: `distribution/shortcuts/README.md`, `distribution/shortcuts/*.shortcut.json` (URL placeholder swap), `distribution/shortcuts/test/shortcuts-json.test.mjs` (new assertion), optionally `distribution/shortcuts/setup.shortcut.json`
  - **Verification**: Smoke test asserts no literal Tailscale host in any URL; runbook section A.2 documents the "Ask Each Time" + Variable action; first-run host capture step is reproducible (operator runs the setup Shortcut once, then the 4 polling Shortcuts all use the captured host).
  - **Measurement**: `pnpm vitest run distribution/shortcuts/test/shortcuts-json.test.mjs --reporter=json | jq -e '.numPassedTests >= 17 and .numFailedTests == 0'` exits 0 (today: 16; +1 host-placeholder assertion).
  - **Pivot**: if the "Ask Each Time" / Variable actions don't compose across separate Shortcuts (each Shortcut has its own scope), retire this task — the operator pays the 1-time substitution cost once and the runbook stays as-is. The cap is bounded (5 substitutions, 5 minutes), so the cost-of-status-quo is not high.
  - **Acceptance**: 0 literal Tailscale hosts in JSON; runbook step A.2 documents the host-input flow.
  - **Anchor**: Norman, *The Design of Everyday Things*, 1988 (affordance — make the parameterisation visible); Card & Mackinlay 1999 (calm tech — bounded operator cognitive load).
  - **Risk**: Apple Shortcuts variables don't survive Shortcut deletion / reinstall; the "Ask Each Time" UX may prompt every run if the variable doesn't persist. Mitigation: test on a real device first; if persistence is lost, fall back to the 25-substitution status quo and retire the task.
