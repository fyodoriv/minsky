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

<!-- Cross-repo-runner roadmap (vision: "minsky governs any repo, not just itself", user-approved 2026-05-04): steps 0–6 of 7 shipped via #126/#122/#127/#128/#129/#131. Only `cross-repo-ci-action` (decision C2 — minsky-side GitHub Action posts check-runs via the GitHub API) remains in P0; local pre-push (C3) is the v0 fallback already shipped with the runner. See user-stories/006-runner-on-any-repo.md for the umbrella user story. -->

<!-- Plug-and-play / dual-purpose framing roadmap (user brief 2026-05-04): the original vision is that Minsky is a tool you attach to any repository (host or itself) and it runs 24/7 to transform the repo to follow Minsky principles (strict lint/tests, observability, chaos, experiment-driven dev). The four tasks below operationalise that brief: (1) `vision-plug-and-play-framing` — vision.md headline + rule #12 (this PR); (2) `scope-discipline-policy-lint` — mechanical CI gate enforcing rule #12; (3) `user-stories-dual-purpose-refresh` — user-stories/001 + 006 explicitly call out the dual-purpose framing; (4) `host-transformation-checklist` — `docs/host-transformation-checklist.md` documents the canonical "make this repo follow Minsky principles" transformation a fresh `minsky bootstrap <host>` triggers. -->

- [ ] `scope-discipline-policy-lint` — CI lint enforcing rule #12 (no new scope without human approval / market research / pre-registered experiment)
  - **ID**: scope-discipline-policy-lint
  - **Tags**: ci, rule-12, ratchet, rule-10
  - **Estimate**: 1d
  - **Hypothesis**: Rule #12 (vision.md § "Scope discipline") declares that no new scope ships in any Minsky-governed repo without one of (a) a human-approved task block in `TASKS.md` referencing the new scope, (b) a market-research read-only investigation (no code), or (c) a pre-registered `experiments/<id>.yaml` whose hypothesis covers the new public surface. Without a deterministic CI gate, the rule degenerates into operator discipline that drifts. A `scripts/check-rule-12-scope-discipline.mjs` lint reads the PR diff for new public API (new exports under `novel/**/src/*.ts`, new files under `novel/**/`, new top-level scripts), then asserts each one resolves to either a referenced TASKS.md task ID, a human-tagged commit (a `<!-- scope: human-approved <reason> -->` opt-out), or an `experiments/<id>.yaml` whose hypothesis names the new surface. Surface-without-justification → CI fails.
  - **Details**: (a) Pure decision function `classifyNewScope(diff): ScopeClassification[]` over the PR diff (one entry per net-new public artefact). (b) For each: resolve against TASKS.md / experiments/ / opt-out comment in the diff. (c) Emit a CI-failing `unjustified` row when none resolve. (d) Paired tests: synthetic diff with new export + matching experiment → ok; new export without justification → fail; opt-out comment → ok with `human-approved` audit log; refactor (no new public surface) → ok. Mirror `check-rule-3-doc-first.mjs` shape (deterministic gate over PR diff, pure function + thin CLI + paired tests + CI job).
  - **Files**: `scripts/check-rule-12-scope-discipline.mjs` + `.test.mjs`, `.github/workflows/ci.yml` (new job entry + `needs:` entry in the `ci` aggregator), `vision.md` § Pattern conformance index (new row).
  - **Verification**: ≥6 paired tests; CI job runs on every PR; gates merge.
  - **Measurement**: `pnpm vitest run scripts/check-rule-12-scope-discipline.test.mjs --reporter=json | jq -e '.numPassedTests >= 6 and .numFailedTests == 0'` exits 0. AND `node scripts/check-rule-12-scope-discipline.mjs --diff=test/fixtures/rule-12/new-feature-without-experiment.diff` exits 1.
  - **Pivot**: if the static-analysis-of-public-surface proves brittle (TS export detection misses re-exports, missed novel files due to glob escapes), pivot to a *manifest* approach — every package's `package.json` carries a `minsky-public-surface` array enumerating its public exports; the lint reads from the manifest rather than parsing source. The manifest is itself a rule-#12 ratchet (every public addition requires a manifest update).
  - **Acceptance**: lint runs on every PR; rule #12 becomes mechanical, not discipline-only; ≥6 paired tests cover the decision function.
  - **Anchor**: rule #12 (vision.md § "Scope discipline" — iron rule); rule #10 (deterministic enforcement); Ries, *The Lean Startup*, 2011 (validated learning — features without hypotheses are vanity); Beyer, Jones, Petoff, Murphy, *Site Reliability Engineering*, O'Reilly, 2016, Ch. 3 (error-budget discipline — known improvements before invented ones).
  - **Risk**: medium. Static analysis of "new public surface" across a polyglot monorepo (TS + shell + workflow yaml) is non-trivial; mitigation is the Pivot to a manifest approach which is robust by construction.
  - **Surfaced-by**: 2026-05-04 user brief — original Minsky vision is "plug-and-play repo transformer", and the rule that Minsky never widens scope without approval/research/experiment was explicit in the brief but not yet enforced mechanically. The vision-plug-and-play-framing PR (this PR) ships the doc; this follow-up task ships the lint.

- [ ] `host-transformation-checklist` — `docs/host-transformation-checklist.md` — canonical "make this host follow Minsky principles" checklist for a fresh `minsky bootstrap`
  - **ID**: host-transformation-checklist
  - **Tags**: docs, cross-repo, onboarding, vision
  - **Estimate**: 1d
  - **Hypothesis**: When Minsky attaches to a host repo via `minsky bootstrap <host-dir>`, the operator (and future Minsky-driven runs) needs a canonical checklist of what "follows Minsky principles" means in concrete terms: strict linting (e.g., `biome check` clean), strict tests (≥1 paired test per non-trivial function; coverage threshold), observability (OTEL spans on every novel function), chaos engineering (failure-mode table per novel package), experiment-based development (rule #9 — every non-trivial change carries an `experiments/<id>.yaml`), pattern-conformance discipline (rule #8 — every new top-level artefact gets a vision.md row; the host's `.minsky/vision.md` is the canonical reference, symlinked by `minsky bootstrap`). Without a written checklist, the transformation drifts into "whatever the operator remembers"; a written checklist makes the transformation auditable. The checklist also informs the cross-repo runner's task-synthesis layer (sub-task or v1 follow-up of `cross-repo-runner-v0`): when the host's queue is empty, the runner picks the next checklist gap as the next task automatically.
  - **Details**: (a) `docs/host-transformation-checklist.md` lists 6 canonical items: lint discipline, test discipline, OTEL coverage, chaos coverage, experiment discipline, pattern-conformance discipline. (b) Per item: a brief description, a measurable acceptance criterion, the Minsky source-of-truth artefact (e.g., `scripts/check-rule-4-otel-coverage.mjs` is the OTEL discipline's enforcer). (c) Note that the checklist is consumed by the audit-cascade in `/next-task` (Tier 1–3 are all gap-closers against this checklist) and by `cross-repo-runner-v1`'s task-synthesis (when no human task is pending).
  - **Files**: `docs/host-transformation-checklist.md` (new), vision.md § Pattern conformance index (new row).
  - **Verification**: file exists; covers all 6 disciplines; each cites the enforcing script + acceptance criterion.
  - **Measurement**: `wc -l docs/host-transformation-checklist.md` ≥ 60 (the checklist is substantive enough to be useful — anchored to the 6 disciplines + their enforcers). AND `grep -c "^## " docs/host-transformation-checklist.md` ≥ 6 (one heading per discipline).
  - **Pivot**: if the 6 disciplines prove insufficient (host repos surface a 7th discipline like "supply-chain hygiene"), extend rather than retire — a 7th heading is a one-PR addition, not an architectural shift. If the 6 disciplines prove *over-specified* (Minsky's 13 lints are too many for a host that just wants strict tests + observability), add a "minimum viable subset" callout naming the 4 lints that must run on every host (e.g., rule #2 / #4 / #7 / #9) and the others as opt-in.
  - **Acceptance**: doc shipped; cross-referenced from `user-stories/006-runner-on-any-repo.md`; cross-referenced from `novel/sidecar-bootstrap/README.md`.
  - **Anchor**: rule #12 (vision.md § "Scope discipline" — the checklist is the substrate Tier-1–3 audit cascade gates against); the 6 disciplines map to rules #2, #3, #4, #7, #9, #8.
  - **Risk**: low. Pure docs + index row; the enforcement is already shipped (the 13 rule lints).

- [ ] `cross-repo-ci-action` — minsky-side GitHub Action posts constitution-check verdicts via the GitHub API (decision C2)
  - **ID**: cross-repo-ci-action
  - **Tags**: ci, cross-repo, observability
  - **Estimate**: 3d
  - **Hypothesis**: Today the cross-repo lints run only locally (in the host's pre-push hook installed by `minsky bootstrap`). An operator who bypasses pre-push (`git push --no-verify`) or whose hook fails silently can ship a PR that violates the constitution without minsky catching it. A minsky-side GitHub Action — running in `fyodoriv/minsky`, listening for `repository_dispatch` events emitted by the runner when it opens a cross-repo PR, fetching the PR body + diff + EXPERIMENT.yaml from the host repo, running the 12 cross-repo lints, posting a check-run verdict back to the host PR via the GitHub API — closes the hook-bypass path. Zero footprint in the host repo's CI config (decision C2). The check-run shows up next to the host's own checks; reviewers see a single source of truth.
  - **Details**: (a) `.github/workflows/cross-repo-check.yml` in minsky listens for `workflow_dispatch` (manual) + `repository_dispatch` (runner-emitted on PR open). (b) Workflow inputs: `host_repo`, `pr_number`, `experiment_yaml_url` (a GitHub-API URL to the EXPERIMENT.yaml on the host PR's branch). (c) Job fetches the PR body via `gh pr view --repo $host_repo $pr_number --json body`, the EXPERIMENT.yaml via the URL, the diff via `gh pr diff`, then runs the 4 portable + 8 sidecar-portable lints with `MINSKY_HOST_ROOT=<temp-clone-of-host>`. (d) Result posted via `gh api repos/$host_repo/check-runs -f name=minsky-constitution -f head_sha=… -f status=completed -f conclusion=success|failure -f output[summary]=…`. (e) The runner emits the dispatch via `gh api repos/fyodoriv/minsky/dispatches -f event_type=cross-repo-pr -f client_payload[host_repo]=… -f client_payload[pr_number]=…` after PR open.
  - **Files**: `.github/workflows/cross-repo-check.yml`, `scripts/cross-repo-check-runner.mjs` (the workflow's main entry), `scripts/cross-repo-check-runner.test.mjs`, `vision.md` § Pattern conformance index (row), `novel/cross-repo-runner/src/dispatch-emit.ts` (the runner-side hook).
  - **Verification**: (a) Workflow run on a synthetic PR (a fixture in `test/fixtures/cross-repo-pr/`) posts a check-run that's visible at the PR's checks tab. (b) The check is `success` when the synthetic PR carries a valid self-grade block and `failure` when it doesn't. (c) The check links back to the workflow run for triage. (d) The dispatch emission from the runner is observably reliable (≥99 % delivery over 100 dry-run integration tests).
  - **Measurement**: `gh run list --workflow cross-repo-check.yml --limit 10 --json conclusion --jq '[.[] | .conclusion] | map(select(. == "success")) | length' >= 8` (≥80 % success rate over the last 10 runs after the action ships). AND `gh api repos/fyodoriv/minsky/check-runs --jq '[.check_runs[] | select(.name == "minsky-constitution")] | length' >= 1` after the first AIFN-840 cross-repo run.
  - **Pivot**: if the GitHub-API check-run posting proves unreliable (>10 % missing checks over 30 days, e.g., due to repository_dispatch delivery flakes), pivot to **C3** (host-side pre-push hook only) and document the C2 attempt as a declared deviation. Pre-push gives ~95 % coverage for non-bypassing operators; the 5 % bypass case becomes a documented gap. This pivot retires the load-bearing claim of the action without retiring the architecture.
  - **Acceptance**: every cross-repo PR opened by `minsky run` shows a `minsky-constitution` check on its checks tab; reviewers can fail merge on a red check; runner-emitted dispatches are observably ≥99 % reliable.
  - **Anchor**: Beyer, Jones, Petoff, Murphy, *Site Reliability Engineering*, O'Reilly, 2016, Ch. 6 (every internal state operator cares about must surface — the constitutional verdict surfaces on the host PR's checks tab, the place reviewers already look); Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (out-of-band check via API is an asynchronous boundary; the eventual-consistency window is bounded by the dispatch delivery + workflow run time); rule #4 (every novel function emits OTEL — the action's run emits a span per check); rule #10 (deterministic enforcement — same input, same output; no LLM in the chain).
  - **Failure modes**:

    | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
    |---|---|---|---|
    | repository_dispatch lost | network / GH-platform | check absent; reviewer sees "no minsky check"; runner re-emits on operator request via `minsky recheck <host-repo> <pr>` | `scripts/cross-repo-check-runner.test.mjs` covers (mocked dispatch failure) |
    | Host PR's branch is force-pushed mid-run | concurrency | check runs against the wrong SHA; result is `neutral` with note "head SHA mismatch — re-emit dispatch"; never `success` on a stale SHA | covered |
    | `EXPERIMENT.yaml` URL not accessible (host PR is private to a non-minsky-bot user) | auth | check is `neutral` with note "minsky-bot lacks read access to host PR; install `minsky-bot` on the host org"; runbook in `docs/cross-repo-ci-runbook.md` | covered |
    | minsky workflow itself flakes | infra | rerun-failed pattern (already used in 6f48cac) handles it; if flake is sustained ≥3 days → Pivot trigger | manual quarterly review |

  - **Risk**: this task is the most external-system-dependent of the stack (GitHub API rate limits, dispatch delivery, cross-repo auth). Mitigation: the Pivot to C3 is the explicit escape valve; the AIFN-840 integration test (previous task) ships under C3 *first*, and C2 is the upgrade. Operator never blocked on C2 — they always have C3.

- [ ] `self-diagnose-on-start` — supervisor probes invariants at boot, escalates failures via TASKS.md
  - **ID**: self-diagnose-on-start
  - **Tags**: observability, supervisor, self-detection, rule-7, rule-9
  - **Estimate**: 3d
  - **Hypothesis**: every dogfood-surfaced bug to date has been "running state silently violates an invariant the operator-only-noticed-after-the-fact": (a) cache_read sum bug pegged every plan to 100 % used and only the operator noticed the homogeneous `budget-paused` log stream; (b) dashboard's 10 metric values stayed `(stub)` indefinitely because no probe asserted "after T minutes uptime, ≥1 metric should resolve to a real value". Encoding these invariants in `scripts/self-diagnose.mjs` and running them at supervisor start (and on a 5-min tick thereafter) means the next equivalent bug surfaces as a P0 TASKS.md entry within 5 min of regression — escalated automatically through the channel `/next-task` already drains. Pre-registered metric: time-from-regression-to-task-block-existing drops from "human notices, multiple hours" to "≤5 min" for the class of invariant-violation bugs. v0 ships with the seed invariant (`token-monitor-not-all-pegged`), the runner, the writer, and the supervisor wire-in. Subsequent invariants are appended in follow-up PRs (each one a 1-file change).
  - **Details**: (a) `scripts/self-diagnose.mjs` (already shipped in this PR) — pure invariant runner + seed invariant + TASKS.md writer + CLI. (b) `distribution/systemd/run-tick-loop.sh` runs `node scripts/self-diagnose.mjs --write-tasks-md --append-to TASKS.md` once at supervisor start; failures are written into the P0 section but the supervisor continues (advisory, not blocking — rule #7 graceful-degrade). (c) Add a 5-min `setInterval` probe in `tick-loop` to re-run invariants between iterations; on transition from `ok→violation` for any invariant, emit an OTEL span `tick-loop.self-diagnose.violation-detected` and a notifier push (the same surface budget-paused uses). (d) Each new invariant is a 1-export addition to `scripts/self-diagnose.mjs` + paired test; the runner accepts them automatically. (e) Document the invariant-authoring pattern in `docs/self-diagnose-authoring.md` — "what makes an invariant: must hold under every legal supervisor state; must fail loudly under at least one observed bug; must carry suggestedTaskTitle + suggestedFix that themselves comply with rule #9."
  - **Files**: `scripts/self-diagnose.mjs` (this PR), `scripts/self-diagnose.test.mjs` (this PR), `distribution/systemd/run-tick-loop.sh` (this PR — supervisor wire-in), `novel/tick-loop/src/daemon.ts` (follow-up — interval probe), `docs/self-diagnose-authoring.md` (follow-up).
  - **Verification**: (a) `pnpm vitest run scripts/self-diagnose.test.mjs` — 7 paired tests covering runner + seed invariant + writer (already passing). (b) Supervisor log on next start contains `self-diagnose:` line. (c) When the cache_read regression is re-introduced (revert PR #155 in a scratch branch), `node scripts/self-diagnose.mjs` exits 1 and surfaces the invariant.
  - **Measurement**: `node scripts/self-diagnose.mjs --json | jq '. | length'` → integer count of violations; on a clean supervisor it is `0`. Regression test: `git stash; git revert <PR#155-merge-sha> --no-commit; node scripts/self-diagnose.mjs --json | jq -e '[.[] | select(.id == "token-monitor-not-all-pegged")] | length == 1'` exits 0 (the seed invariant catches the seeded bug). Tracking metric: time-to-task-block-existing for invariant-class regressions, measured manually at first (one data point per regression), promoted to OTEL span `self-diagnose.violation-detected.duration` once ≥3 invariants ship.
  - **Pivot**: if invariants false-positive ≥1 task per week (probe drift or transient supervisor states getting flagged), add a `consecutiveFailures: 2` retry gate before surfacing — the runner becomes "fail twice in a row, then escalate" rather than "fail once, escalate". Don't retire the architecture; tune the probe-stability axis. If even with retries the false-positive rate stays high (≥1/week sustained 4 weeks), pivot from "invariant set + boot probe" to "anomaly detection over OpenObserve metrics" — but that requires the span→metric pipeline to be wired (separate P0; out of scope here).
  - **Acceptance**: (1) seed invariant ships and catches the cache_read bug under revert; (2) supervisor logs show self-diagnose ran at boot; (3) writing findings to TASKS.md round-trips through `/next-task` (a self-detected task is pickable like any other); (4) ≥6 paired tests cover the runner + seed invariant + writer.
  - **Anchor**: Liskov 1987 (invariants as the substrate of correctness — invariant violation IS the bug); Brilliant, Knight, Leveson, "Analysis of Faults in an N-Version Software Experiment", *IEEE TSE* 1990 (one version probes the other); Hewitt 1973 (TASKS.md as actor message store — escalation channel reuse); rule #7 (graceful degrade — supervisor never blocks on self-diagnose); rule #9 (every violation carries hypothesis + measurement + pivot + anchor in its synthesised task block).
  - **Risk**: medium. The probe surface is the runtime state of every novel package; an invariant that's wrong is itself a bug source. Mitigation: each invariant ships with paired tests pinning its decision function, and the Pivot threshold (≥1 false-positive/week) is the explicit retire signal.
  - **Surfaced-by**: 2026-05-04 user brief — "i want minsky to be able to detect bugs in its own launched state. so maybe as soon as minsky starts, it also analyzes its own bugs and delegates fixing itself to the parent". Seed invariant (`token-monitor-not-all-pegged`) directly encodes the bug PR #155 fixed: had this invariant been live before that PR, the cache_read regression would have surfaced as a self-detected P0 the moment the supervisor restarted.

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

- [ ] `next-task-scope-to-jira-ticket` — `/next-task` should accept a Jira-key argument to pin one-shot bug fixes
  - **ID**: next-task-scope-to-jira-ticket
  - **Tags**: skill, ergonomics, one-shot, surfaced-by-fresh-install
  - **Estimate**: 1h
  - **Hypothesis**: `/next-task` today picks the highest-priority unblocked task across all `~/apps/*/TASKS.md` (per README "queue mode"). For one-shot operator workflows ("ship the fix for AIFN-840 and stop"), the operator must either temp-edit TASKS.md to bump priority or run the work outside `/next-task`. Letting `/next-task <ticket-or-id>` (e.g. `/next-task AIFN-840` or `/next-task aifn-840-slash-command-labels`) pin the queue to that one task — claim it, ship it, exit instead of looping — closes the "I just want this one bug shipped" path without weakening the default queue-mode loop. The match is a substring search across either the `**ID**:` field or the task title (the title contains the Jira key for tickets).
  - **Details**: Update `.claude/skills/next-task/SKILL.md` (or wherever the skill lives — confirm via `tasks install` if the auto-install flag works in 0.7.x; per setup.sh comment 295-297, 0.7.0 install is broken, so the skill is hand-committed). Add a `<args>` parser: empty → existing queue-mode; non-empty → grep TASKS.md for the literal arg (Jira-key OR kebab-case ID), claim that single task, work it, exit on completion *without* re-entering the loop. Keep the existing audit-cascade behaviour as the default.
  - **Files**: `.claude/skills/next-task/SKILL.md` (or the equivalent path post-`tasks install` shipping), a small unit test that simulates the arg-parsing path.
  - **Verification**: `/next-task AIFN-840` claims `aifn-840-slash-command-labels` from `~/apps/iep-capabilities-3/TASKS.md` (via the title-match path), ships the PR, exits — does NOT proceed to the next P1.
  - **Measurement**: An integration shell-script that seeds `~/apps/test-fixture/TASKS.md` with two tasks, calls the skill driver with the second task's Jira-key as arg, and asserts the first task remains unclaimed at end-of-run (`grep -c '@' TASKS.md` == 1).
  - **Pivot**: if Jira-key matching collides with kebab-id matching often enough that operators get the wrong task (≥1 mis-claim per 10 invocations), restrict matching to `**ID**:` field only and require operators to use kebab-case IDs (AIFN-840 → `aifn-840-slash-command-labels`).
  - **Acceptance**: One-shot mode works from the README's documented path; queue-mode unchanged when arg is empty; collision behaviour documented.
  - **Anchor**: Cooper, *About Face: The Essentials of Interaction Design*, 4th ed., Wiley, 2014 (modal vs modeless interfaces — the same affordance carrying both queue-mode and one-shot mode is modeless, and modeless wins when the user's intent is unambiguous from the arg); rule #1 (don't reinvent — `/next-task` already exists, the change is one optional arg).
  - **Risk**: low. Default behaviour (no arg) is preserved; the new arg path is opt-in.
  - **Surfaced-by**: 2026-05-04 — operator wanted to one-shot AIFN-840 in iep-capabilities-3 and had to reason about how `/next-task` would interact with iep-capabilities-3's pre-existing P0/P1 queue (deep engagement-onboarding work that takes priority by ID order). Workaround: filed the bug as P1 above the larger refactors, but a Jira-key arg would have been cleaner.

- [ ] `cross-repo-runner-v1-live-spawn` — graduate the cross-repo runner from v0 (dry-run plan) to v1 (live `claude --print` spawn against the host)
  - **ID**: cross-repo-runner-v1-live-spawn
  - **Tags**: novel, cross-repo, runner, v1
  - **Estimate**: 2d
  - **Hypothesis**: `cross-repo-runner-v0` (#129) and the AIFN-840 integration test (#131) ship a *plan-only* runner — the spawn boundary is mocked, no Claude Code subprocess actually runs against the host. Two chaos rows in the v0 READMEs are deferred to this v1 task: (a) `novel/cross-repo-runner/README.md` row 7 — sandbox-leak detection requires the live-spawn path to be exercised; (b) `novel/sidecar-bootstrap/README.md` row 5 — read-only-ignore-file fallback exercises a real bootstrap retry. Wiring the v0 plan into a real `ProcessSpawnStrategy` (rule-#1 reuse — same Strategy `@minsky/tick-loop` already uses) closes both deferrals AND validates the umbrella user-story-006 metric (`cross_repo_runs_validated_pct`) against a live PR-shaped artefact, not a synthesised one.
  - **Details**: (a) Replace `cross-repo-runner`'s mocked spawn in `src/runner.ts` with `ProcessSpawnStrategy({ command: "claude" })` from `@minsky/tick-loop`; brief on stdin (synthesised EXPERIMENT.yaml + system-prompt overlay), response on stdout. (b) Add `--live` flag to the CLI (mirrors `MINSKY_TICK_DRY_RUN` shape from tick-loop); default stays dry-run for safety. (c) After spawn, `git diff` against host to detect scope-leak (chaos row 7); record `verdict: scope-leak` to the iteration-store on out-of-scope changes. (d) Sidecar-bootstrap retries the per-clone `.git/info/exclude` write when global ignore is read-only (chaos row 5). (e) Update the AIFN-840 integration test to assert `--live` produces a real PR (or skip when `CLAUDE_API_KEY` is unset; CI keeps the v0 dry-run path).
  - **Files**: `novel/cross-repo-runner/src/runner.ts` + `runner.test.ts`, `novel/cross-repo-runner/README.md` (chaos rows 5, 7 — replace deferred → wired), `novel/sidecar-bootstrap/src/install.ts` + tests + `README.md` (chaos row 5 update), `novel/cross-repo-runner/test/integration/aifn-840-shape.test.ts` (extend with `--live` skip-when-no-key path).
  - **Verification**: `pnpm vitest run novel/cross-repo-runner novel/sidecar-bootstrap` exits 0 with the new `--live` test cases passing locally (dry-run-only mode in CI). Both README chaos rows lose their `(deferred — covered when X ships)` text and instead reference the actual test path.
  - **Measurement**: `node scripts/check-rule-7-chaos-coverage.mjs` exits 0 (today: 2 violations after `cross-repo-runner-aifn-840-integration-test` task block was removed; this task closes both by either wiring the chaos coverage to a real test path or removing the deferral entirely).
  - **Pivot**: if the live-spawn path proves too costly to exercise in CI (Claude API rate limits, key management for self-hosted runners), retire the `--live` integration test and document the chaos rows as `host-substrate-deferred` (the host's own CI exercises the live path; minsky's CI gates only the synthesised plan). The v0 dry-run path remains the default so this pivot is operationally cheap.
  - **Acceptance**: `--live` flag exists; chaos rows 5 and 7 reference real test files instead of deferred tasks; user-story-006's `cross_repo_runs_validated_pct` metric has a real numerator > 0 from the AIFN-840 live-spawn run.
  - **Anchor**: Armstrong, *Programming Erlang*, Pragmatic Bookshelf, 2007 (let-it-crash discipline only works when the failure surfaces — the v0 dry-run path can't surface sandbox leaks because there's no real spawn); Basiri et al., "Principles of Chaos Engineering", *IEEE Software* 2016 (chaos coverage requires the failure axis to be exercised, not just declared); rule #1 (don't reinvent — reuse `ProcessSpawnStrategy`); rule #7 (failure-mode table needs real chaos tests, not deferral chains).
  - **Risk**: live-spawn against a host repo can write tracked files; mitigation is the existing `git diff` post-spawn boundary plus `--live` opt-in (default stays dry-run).
  - **Surfaced-by**: 2026-05-04 sweep PR #132 — `chore: sweep closed task blocks` removed `cross-repo-runner-aifn-840-integration-test` (shipped #131) and the rule-7-chaos-coverage lint surfaced two README rows whose deferral target no longer existed. Filing this v1 follow-up converts the dangling deferrals into a real future-task reference.
