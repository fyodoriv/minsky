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

- [ ] First user-story integration test passes (001)
  - **ID**: first-integration-test
  - **Tags**: testing, validation
  - **Estimate**: 6h
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

- [ ] `docs-drift-research-md-open-questions` — Sweep `research.md` § "Open questions for next research pass" of items resolved by recent PRs
  - **ID**: docs-drift-research-md-open-questions
  - **Tags**: docs, drift, doc-debt
  - **Estimate**: 30m
  - **Hypothesis**: After 46 PRs (PRs #43, #45, #47, #54, #75, #77 in particular), `research.md` § "Open questions for next research pass" still lists at least one resolved question as open ("OMC handoff persistence — do they parseably persist their internal task list to disk?" at line 567). Striking the resolved entry (and confirming sibling entries' state) brings the open-question count to its true post-#77 value and prevents the next research pass from re-investigating closed questions.
  - **Details**: The `OMC handoff persistence` line at `research.md:567` was resolved by PR #75 (read-only research findings) and PR #77 (round-trip parseability check landed in `scripts/omc-roundtrip.mjs`); the dedicated § "OMC handoff persistence" section (lines 339–351) carries the parseable verdict + path layout + write-site citations. Strike the open-question line with `~~…~~` and append "Resolved 2026-05-03; see § \"OMC handoff persistence\". Bridge v0 shipped as `@minsky/omc-tasksmd-bridge` per vision.md row 62." Verify the remaining open question ("Cross-language equivalent of tasks.md") is genuinely still open.
  - **Files**: `research.md`
  - **Verification**: `grep -c "^- ~~" research.md` increases by 1 from current value; `grep "OMC handoff persistence — do they parseably" research.md` returns the strikethrough form.
  - **Measurement**: `[ "$(grep -c '^- ~~Apple Watch\|^- ~~DSPy\|^- ~~Lighter OTEL\|^- ~~OMC handoff' research.md)" -ge 4 ]` — four resolved questions struck (currently 3 of 4 are struck; the OMC handoff line is the missing one).
  - **Pivot**: if a sibling resolved question is found unstruck (e.g., a future PR resolves "Cross-language equivalent of tasks.md" but the strike-through is forgotten), expand this task into a recurring quarterly sweep tied to `review-q3-2026`. If `research.md` is reorganised before this lands, re-locate the entry first; do not silently delete.
  - **Acceptance**: One line struck through; one resolution pointer added; markdownlint clean.
  - **Anchor**: Hunt, Thomas, *The Pragmatic Programmer*, Addison-Wesley, 1999, Ch. 2 (DRY across docs — a resolved question that lives in two places drifts); rule #5 (vision.md § 5 — glossary discipline; "open" is a status field, "resolved" is its complement, the strikethrough is the discipline); rule #8 (vision.md § 8 — pattern conformance; entries belong in their canonical section, not duplicated as open questions).
  - **Risk**: Low — pure docs edit. Could conflict with a concurrent `research.md` edit; rebase if so.

- [ ] `docs-drift-architecture-md-open-questions` — Update `ARCHITECTURE.md` § "Open questions to resolve before implementation" for items resolved by recent PRs
  - **ID**: docs-drift-architecture-md-open-questions
  - **Tags**: docs, drift, doc-debt
  - **Estimate**: 30m
  - **Hypothesis**: `ARCHITECTURE.md` § "Open questions to resolve before implementation" (lines 318–327) lists six items, four of which have been resolved by shipped work: (1) OMC handoff persistence (PR #75 + #77), (2) Apple Watch surface (PR #54 — native WatchOS evaluated, trigger-bound deferral documented), (3) MAPE-K loop cadence (resolved in `ARCHITECTURE.md` § "MAPE-K cadence" prose at line 218 + the four prose-anchored CI lints at vision.md row 59), (4) Multi-machine (PR #45 — research.md § "Multi-machine scope"). Only items #5 (OMC version pinning) and #6 (OTEL backend — already marked resolved inline) remain. Striking the four resolved items + cross-linking to their resolution sections prevents the next implementation read from re-litigating settled questions.
  - **Details**: Strike items 1–4 with `~~…~~` and append a "Resolved YYYY-MM-DD; see <pointer>" to each. Item #6 already carries the resolution pointer; preserve it. Item #5 (OMC version pinning) can stay open (no PR has settled the strict-patch-pin vs minor-floating choice). Add a note at the section head: "Items struck through have been resolved by subsequent PRs — kept here as historical anchors per `AGENTS.md` § 'Documentation rules'."
  - **Files**: `ARCHITECTURE.md`
  - **Verification**: `grep -c '^[0-9]\. \*\*~~' ARCHITECTURE.md` ≥ 4 (four items struck); `pnpm exec markdownlint-cli2 ARCHITECTURE.md` exits 0.
  - **Measurement**: `node -e 'const t=require("fs").readFileSync("ARCHITECTURE.md","utf8");const sec=t.split("Open questions to resolve before implementation")[1].split("## Reading next")[0];const struck=(sec.match(/~~/g)||[]).length;process.exit(struck>=8?0:1)'` — ≥8 `~~` markers (4 items × 2 markers each).
  - **Pivot**: if striking the items reduces clarity for new readers, instead promote each resolved item into a one-line "Resolved questions" sub-section with pointers to the canonical sections. If `ARCHITECTURE.md` is restructured before this lands, re-locate then strike.
  - **Acceptance**: Four items struck; resolution pointers added; markdownlint clean; the section's introductory paragraph notes the strike-through convention.
  - **Anchor**: Hunt, Thomas, *The Pragmatic Programmer*, Addison-Wesley, 1999, Ch. 2 (DRY — a question resolved in `research.md` should not still be "open" in `ARCHITECTURE.md`); Parnas, "On the Criteria To Be Used in Decomposing Systems into Modules", *CACM* 15(12) 1972 (information hiding — `ARCHITECTURE.md` is the wiring view, `research.md` is the dependency-evolution view; cross-link rather than duplicate state); rule #5 (glossary discipline); rule #8 (pattern conformance).
  - **Risk**: Low — pure docs edit. ARCHITECTURE.md sees more frequent edits than `research.md`; rebase carefully.

- [ ] `docs-drift-architecture-md-versioning-pins` — Document the `@tasks-md/lint` and `markdownlint-cli2` version pins in `ARCHITECTURE.md` § "Versioning & dependency evolution"
  - **ID**: docs-drift-architecture-md-versioning-pins
  - **Tags**: docs, drift, doc-debt
  - **Estimate**: 20m
  - **Hypothesis**: PR #44 pinned `@tasks-md/lint@^0.7.0` and `markdownlint-cli2@0.15.0` in `.github/workflows/ci.yml` (and `markdownlint-cli2@0.15.0` in `package.json`'s devDependencies) per rule #7's deterministic-CI discipline. `ARCHITECTURE.md` § "Versioning & dependency evolution" (lines 301–316) currently states "Pin major versions of all dependencies" as a principle but does not enumerate the actual pins. Adding a one-paragraph "Currently pinned" sub-list (with the file:line citation for each pin) makes the principle auditable and lets a future bump intentionally widen / tighten the pin instead of drifting.
  - **Details**: Append a "Currently pinned" bulleted sub-list under § "Versioning & dependency evolution" listing: `@tasks-md/lint@^0.7.0` (`.github/workflows/ci.yml:39`); `markdownlint-cli2@0.15.0` (`.github/workflows/ci.yml:27` + `package.json:29`); `@biomejs/biome@1.9.4` (`package.json:24`); `typescript@5.7.2` (`package.json:30`); `vitest@2.1.9` (`package.json:31`); `lefthook@1.10.10` (`package.json:28`); `@vitest/coverage-v8@2.1.9` (`package.json:27`); `@types/node@25.6.0` (`package.json:26`); `pnpm@9.12.0` (`packageManager` field, `package.json:11`). Note that `lighthouse@12.4.0` is pinned in `.github/workflows/lighthouse.yml` per vision.md row 58.
  - **Files**: `ARCHITECTURE.md`
  - **Verification**: `grep -A 30 "Versioning & dependency evolution" ARCHITECTURE.md | grep -c "@tasks-md/lint\|markdownlint-cli2\|biomejs/biome"` ≥ 3.
  - **Measurement**: `[ "$(grep -A 30 'Currently pinned' ARCHITECTURE.md | grep -c '@')" -ge 6 ]` — at least 6 pins enumerated under the new sub-list.
  - **Pivot**: if the pin list bloats over time (>15 entries), move it to a dedicated `docs/pinned-versions.md` and link from ARCHITECTURE.md. If a future deterministic CI lint is added to enforce pins-vs-prose alignment, retire this manual sub-list (the lint becomes the source of truth).
  - **Acceptance**: Sub-list added with ≥6 pins + their file:line citations; markdownlint clean; `pnpm typecheck && pnpm test && pnpm lint` all green.
  - **Anchor**: Forsgren, Humble, Kim, *Accelerate*, IT Revolution Press, 2018 (DORA — version-pinning as a deployment-stability lever); Hunt, Thomas, *The Pragmatic Programmer*, 1999, Ch. 2 (DRY — pins live in package.json + ci.yml; the ARCHITECTURE.md sub-list is the *index*, not a duplicate state); rule #5 (glossary discipline); rule #7 (chaos engineering — unpinned deps are a silent drift fault).
  - **Risk**: Low — pure docs edit. Drifts when a pin changes without the sub-list being updated; mitigated by the future deterministic CI lint mentioned in the Pivot.

- [ ] `docs-drift-tasksmd-cross-language-followup` — Re-evaluate `research.md` § "Open questions" entry "Cross-language equivalent of tasks.md"
  - **ID**: docs-drift-tasksmd-cross-language-followup
  - **Tags**: docs, drift, doc-debt, research
  - **Estimate**: 1h
  - **Hypothesis**: The remaining open question "Cross-language equivalent of tasks.md — can the spec be ported to Python/Rust ecosystems?" (`research.md:566`) has not been investigated since the file was authored. A 30-minute read of the upstream tasks.md spec + a search for "tasksmd" on PyPI / crates.io will either (a) surface a Python/Rust port, in which case the question is resolved, or (b) confirm no port exists, in which case the question gets a measurement-bound trigger ("file an upstream issue if X downstream tools request a Rust port") and a deferred-resolution date (e.g., "re-evaluate at `review-q3-2026`").
  - **Details**: (1) `gh search repos --owner=tasksmd` and `pip search tasks-md` (or PyPI search via web) to inventory existing ports. (2) `cargo search tasks-md` for Rust. (3) If a port exists, mark the question resolved with a citation. If not, append a measurement-bound trigger + tie the deferral to `review-q3-2026`.
  - **Files**: `research.md`
  - **Verification**: The "Cross-language equivalent of tasks.md" line is either struck-through with a resolution pointer OR carries an inline measurement-bound trigger.
  - **Measurement**: `[ "$(grep -c 'Cross-language equivalent of tasks.md' research.md)" -eq 1 ]` AND that single line either starts with `- ~~` (resolved) or contains "trigger:" / "defer to `review-q3-2026`" (deferred with a trigger).
  - **Pivot**: if the inventory turns up >1 port, the question is overdetermined; mark it resolved and update `competitors/` with the port references. If the inventory turns up zero ports AND no downstream tool has requested one, demote the question to an `infra-watching` task (lower priority than dormant scout) and remove it from the open-questions list.
  - **Acceptance**: One line in `research.md` § "Open questions" updated to either resolved-with-pointer or deferred-with-trigger; markdownlint clean.
  - **Anchor**: Munafò et al., *Nature Human Behaviour* 1, 0021, 2017 (rule-#9 pre-registration — open questions need a pre-registered re-evaluation cadence, otherwise they accumulate); Hunt, Thomas, *The Pragmatic Programmer*, 1999, Ch. 2 (DRY); rule #5 (glossary discipline).
  - **Risk**: Low — read-only research + a one-line edit.
