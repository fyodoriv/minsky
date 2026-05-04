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

<!-- The six tasks below operationalise the cross-repo-runner roadmap (vision: "minsky governs any repo, not just itself", user-approved 2026-05-04). They are intentionally a stack — each step ships independently and unblocks the next. The pre-flight rule-portability classification (researcher run 2026-05-04) found 4/13 rules cross-repo-portable when host repos lack minsky's artefacts (vision.md, novel/, ARCHITECTURE.md). The roadmap below dissolves that constraint by introducing per-host gitignored sidecar files (.minsky/) that carry minsky's substrate into any host. Sidecar location: global ~/.config/git/ignore (decision A2). Constitution: canonical vision.md inherited + per-host repo.yaml overlay (decision B1). CI substrate: minsky-side GitHub Action posts checks via the GitHub API (decision C2); local pre-push (C3) is the v0 fallback. Each task carries Hypothesis / Pivot / Measurement / Anchor / Failure modes / Risk per rule #9 + rule #7. -->

- [ ] `cross-repo-portability-doc` — classify every rule lint for cross-repo portability + record sidecar architecture decision
  - **ID**: cross-repo-portability-doc
  - **Tags**: docs, cross-repo, prep, rule-9-preparation
  - **Estimate**: 2h (the spike already ran 2026-05-04; this task ships the artefact)
  - **Hypothesis**: A documented, mechanically-complete classification of all 13 `scripts/check-*.mjs` lints (`repo-local` / `sidecar-portable` / `host-substrate-deferred`) plus a recorded rebuttal of the naive "the host doesn't have vision.md so 9/13 rules can't port" framing converts cross-repo work from "argue about scope per task" into "look up the cell in the table". Pre-flight classification (researcher subagent, 2026-05-04) found 4/13 = 30.8 % portable *under the naive framing*; the sidecar architecture (per-host gitignored `.minsky/` files inside the host worktree, listed in global `~/.config/git/ignore`) flips 8 of the 9 repo-local rules to `sidecar-portable` because they read the same shapes at a different filesystem root. The doc records both the naive and sidecar numbers and the operative architecture decision.
  - **Details**: Create `docs/cross-repo-portability.md` with: (1) one row per script naming the substrate it walks and the class (Naive vs Sidecar columns); (2) the aggregate count under each architecture; (3) the operative decision (sidecar architecture, A2/B1/C2 per the 2026-05-04 conversation); (4) the consequence — `host-root-resolver` (next task) is a preparation PR per rule #9, since today every lint hard-codes `repo-root/<path>` and must take `MINSKY_HOST_ROOT` before any host bootstrap is meaningful. Cite the researcher run output (saved at `docs/cross-repo-portability/2026-05-04-classification-run.md`).
  - **Files**: `docs/cross-repo-portability.md`, `docs/cross-repo-portability/2026-05-04-classification-run.md` (the raw researcher output, archived for audit), `vision.md` § Pattern conformance index (new row for the doc).
  - **Verification**: doc has 13 rows under `## Per-rule classification`; aggregate row reports both Naive and Sidecar percentages; section `## Decision` records A2/B1/C2.
  - **Measurement**: `awk '/^## Per-rule classification/{flag=1; next} /^## /{flag=0} flag' docs/cross-repo-portability.md | grep -c '^|.*sidecar-portable\|^|.*repo-local\|^|.*host-substrate-deferred'` returns exactly 13. AND `grep -E '^- (A2|B1|C2)\b' docs/cross-repo-portability.md` returns exactly 3 lines (one per decision).
  - **Pivot**: if a second classifier reading (independent re-run on a different day) disagrees on >2/13 rule classifications, the classification framework is unreliable — pivot to a smaller, hand-curated portable subset (the 4 already proven: anchor-primary-source, measurement-inspects-output, pivot-success-margin, pr-self-grade) and rewrite the sidecar story as "we host these 4 sidecar substrates, not all 13". This pivot retires the architecture's main load-bearing claim if the classification doesn't replicate.
  - **Acceptance**: doc merged on a draft PR until the host-root-resolver prep PR opens; vision.md row added.
  - **Anchor**: Munafò et al., *Nature Human Behaviour* 1, 0021, 2017 (pre-registration — the classification result is recorded *before* the runner is built, so the runner's design can't post-hoc rationalise the threshold); Beyer, Jones, Petoff, Murphy, *Site Reliability Engineering*, O'Reilly, 2016, Ch. 6 (every rule is a check; every check has a substrate; documenting the substrate is the first move); rule #10 (deterministic CI enforcement — the classification table is itself enforced by a tiny linter that fails when a new `check-*.mjs` ships without a row).
  - **Failure modes**:

    | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
    |---|---|---|---|
    | New `check-*.mjs` ships without a doc row | drift | loud-crash via `scripts/check-cross-repo-portability-doc-coverage.mjs` (a P3 follow-up; this task lands the doc, the linter is the ratchet) | (deferred — covered when `ci-lint-cross-repo-portability-doc-coverage` ships) |
    | Classification disagreed across two readings | epistemic / classifier-noise | pivot per the `Pivot` line above | manual two-classifier re-run scheduled at quarterly review (`review-q3-2026`) |
    | Sidecar architecture rejected by a host repo's policy (e.g., the host bans `.git/info/exclude` mutations) | host-policy | graceful-degrade; the host opts into `repo-local-only` mode and the cross-repo-runner skips the 8 sidecar-only rules for that host | document the per-host opt-out in `repo.yaml` schema (next task) |

  - **Risk**: classification drift over time — minsky's rule lints will evolve and the doc will rot. Mitigation: rule-10 lint (`ci-lint-cross-repo-portability-doc-coverage`) shipped as P3 follow-up; quarterly review re-runs the classifier subagent.

- [ ] `host-root-resolver-prep` — refactor every rule lint to take `MINSKY_HOST_ROOT` (preparation PR; no behaviour change for minsky-on-itself)
  - **ID**: host-root-resolver-prep
  - **Tags**: refactor, cross-repo, prep, rule-9-preparation
  - **Estimate**: 1d
  - **Blocked by**: cross-repo-portability-doc
  - **Blocker rationale**: the classification doc justifies this refactor; rule #9's preparation-PR pattern requires the metric source (the classification) to land before the artefact (the env-var refactor) that depends on it.
  - **Hypothesis**: Every `scripts/check-*.mjs` script today resolves its substrate against the repo root (e.g., `vision.md`, `novel/**`, `ARCHITECTURE.md`, `EXPERIMENT.yaml`). Replacing the hard-coded resolution with a `MINSKY_HOST_ROOT` env var (defaulting to repo root) is a *behaviour-preserving* refactor for minsky-on-itself and a *substrate-shifting* refactor for cross-repo work. After this PR ships, every lint can read `${MINSKY_HOST_ROOT}/.minsky/vision.md` instead of `repo-root/vision.md`, *but only when MINSKY_HOST_ROOT is set*. CI runs unchanged; cross-repo invocations get a working substrate without code branches everywhere.
  - **Details**: (a) Add a tiny `@minsky/host-root` package (or a single helper file `scripts/lib/host-root.mjs`) exposing `getHostRoot(): string` that reads `process.env.MINSKY_HOST_ROOT ?? repoRoot`. (b) Replace every absolute substrate path in the 12 `repo-local` + `sidecar-portable` lints with `join(getHostRoot(), …)`. (c) Add a unit test per script that asserts: substrate path resolves correctly with MINSKY_HOST_ROOT unset (= repo root) and with MINSKY_HOST_ROOT=/tmp/fixture (= fixture root). (d) No CI workflow changes — minsky's own CI runs without the env var, identical behaviour.
  - **Files**: `scripts/lib/host-root.mjs` + `scripts/lib/host-root.test.mjs` (new); 12 `scripts/check-*.mjs` files modified to import the helper; 12 paired `.test.mjs` files extended with the host-root branch.
  - **Verification**: (a) `pnpm vitest run scripts/` exits 0 with all existing tests green plus 12 new host-root branches green. (b) `pnpm run check` on minsky-on-itself shows zero behaviour change vs origin/main (commit hashes identical for the lint outputs on a no-change PR). (c) Setting `MINSKY_HOST_ROOT=/tmp/empty-fixture` and running each lint exits cleanly (substrate-not-found on a fixture is the host-side concern, not a lint-side bug).
  - **Measurement**: `for f in scripts/check-*.mjs; do MINSKY_HOST_ROOT=/tmp/empty node "$f" 2>&1 | grep -q "host root" && echo "$f: ok"; done | wc -l` returns 12 (each lint logs the resolved host root). AND `pnpm vitest run scripts --reporter=json | jq -e '.numPassedTests >= (16 + 12) and .numFailedTests == 0'` (existing 16 + 12 new host-root cases).
  - **Pivot**: if any `check-*.mjs` lint depends on more than path resolution to localise (e.g., it imports another minsky-internal module that itself reads minsky-internal paths), document the dependency in `cross-repo-portability.md` and *defer that lint to v1* — `host-root-resolver` ships only the lints whose substrate is purely path-based. This pivot keeps the prep PR small and unblocks downstream work without forcing every lint to port at once.
  - **Acceptance**: every lint takes the env var; minsky-on-itself behaviour identical; cross-repo invocations have a working substrate hook to fill from `.minsky/`.
  - **Anchor**: Hewitt, "A Universal Modular ACTOR Formalism", *IJCAI* 1973 (every actor has a *root* — the substrate boundary is the actor's interface; making it parametric is the move that lets the same actor live in many systems); Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (the substrate-locality boundary defines the consistency boundary; making it explicit is the precondition for cross-system semantics); rule #2 (every external dependency through an interface — here the "external dependency" is the *filesystem root*, which we now interface explicitly).
  - **Failure modes**:

    | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
    |---|---|---|---|
    | `MINSKY_HOST_ROOT` set but path doesn't exist | env-misconfig | loud-crash with `host root not found: <path>` from `getHostRoot` | `scripts/lib/host-root.test.mjs` covers it |
    | Lint reads relative path from host root that is missing on cross-repo invocation (e.g., host has no `.minsky/vision.md`) | host-not-bootstrapped | loud-crash from the lint with `bootstrap host: minsky bootstrap <host-dir>` (the bootstrap command ships in `cross-repo-runner-v0`) | `scripts/check-rule-5-glossary-discipline.test.mjs` extended with a missing-host-vision case |
    | Two lints read different host roots in the same invocation | concurrency / leaky env | impossible — `getHostRoot()` is deterministic per process; chaos test runs N=100 concurrent lint invocations against same env and asserts identical resolution | `scripts/lib/host-root.test.mjs` covers (concurrent invocations are deterministic) |

  - **Risk**: lint refactors are usually safe but high-fanout — touching 12 scripts in one PR creates merge-conflict risk against in-flight rule-lint work. Mitigation: ship the `getHostRoot` helper + tests in commit 1; ship each lint's adoption as a separate commit on the same branch (12 small commits) so rebases are atomic; coordinate with any in-flight rule-lint PRs (none open at task-write time, 2026-05-04).

- [ ] `minsky-sidecar-bootstrap` — `.minsky/` schema and `minsky bootstrap <host-dir>` command
  - **ID**: minsky-sidecar-bootstrap
  - **Tags**: novel, cross-repo, bootstrap
  - **Estimate**: 3d
  - **Blocked by**: host-root-resolver-prep
  - **Blocker rationale**: the lints must accept `MINSKY_HOST_ROOT` before bootstrapped sidecar contents have a reader.
  - **Hypothesis**: Every host repo `minsky run` operates against needs a `.minsky/` directory at the host root containing exactly the sidecar substrate the cross-repo lints will read: a `repo.yaml` overlay (host-specific config — package layout, lint command, test command, ticket format), a symlink to minsky's canonical `vision.md`, an empty `EXPERIMENT.yaml.template`, an empty `experiment-store/`, and stub copies of `research.md` + glossary + pattern-conformance-index. A single command (`minsky bootstrap <host-dir>`) materialises this idempotently — first invocation creates everything, second invocation no-ops, third invocation with `--repair` fixes drift. The directory is added to global `~/.config/git/ignore` so it never enters the host's git history.
  - **Details**: (a) Define the `.minsky/repo.yaml` schema (`@minsky/repo-config-schema` or co-located in `novel/cross-repo-runner/`): `host_repo` (e.g. `expertnetwrk-portal/iep-capabilities`), `tasks_md_path` (default `TASKS.md`), `commit_format` (free-form template; defaults match host CLAUDE.md if present), `pre_commit_command` (e.g., `yarn run -T eslint --fix`), `branch_prefix`, `ticket_format` (regex like `AIFN-\d+`), `default_branch` (e.g., `master`), `lint_substrate_overrides` (per-rule mapping for hosts that already have an equivalent — rule-6 → `pre_commit_command`). (b) `minsky bootstrap <host-dir>` reads the host repo's package.json / .editorconfig / CLAUDE.md / AGENTS.md to *infer* defaults; prompts for what it can't infer; writes `.minsky/repo.yaml`; symlinks `.minsky/vision.md` → `~/apps/minsky/vision.md` (canonical, B1); writes the empty templates; appends `.minsky/` to `~/.config/git/ignore` if absent (idempotent, A2). (c) `minsky bootstrap --doctor <host-dir>` self-tests: every required file present? `git check-ignore .minsky/` returns the global ignore? lint-substrate-overrides reference real lints?
  - **Files**: `novel/sidecar-bootstrap/` (new pnpm workspace; or co-located in `novel/cross-repo-runner/src/bootstrap.ts` to keep package count low), `novel/sidecar-bootstrap/{src/{schema,bootstrap,doctor,inference}.ts, README.md, package.json, src/*.test.ts}`, `vision.md` § Pattern conformance index (row).
  - **Verification**: (a) bootstrap on a fresh host writes exactly 6 files under `.minsky/` + 1 entry in `~/.config/git/ignore`; (b) bootstrap on an already-bootstrapped host is a no-op (zero filesystem mutations, exit 0); (c) `--repair` mode fixes a deliberately-corrupted `repo.yaml` (drop a required field, run repair, assert the field is restored from inference).
  - **Measurement**: `pnpm vitest run novel/sidecar-bootstrap --reporter=json | jq -e '.numFailedTests == 0 and .numPassedTests >= 24'`. AND `bash distribution/sidecar-bootstrap-smoke.sh` (a smoke script committed in this PR) creates a tmpdir, inits a fake host with package.json + TASKS.md, runs `minsky bootstrap`, asserts `.minsky/repo.yaml` exists and `git check-ignore .minsky/` returns 0; cleans up.
  - **Pivot**: if the global `~/.config/git/ignore` mutation proves brittle (e.g., the user's git config doesn't honour it, or per-clone mutation of `.git/info/exclude` is needed for some hosts), pivot the ignore mechanism to per-clone (`.git/info/exclude`) — the runner's bootstrap detects the situation and writes whichever ignore the host honours. This pivot doesn't change the architecture (the sidecar is still gitignored), just the ignore-mechanism's location.
  - **Acceptance**: bootstrap is idempotent; doctor mode catches drift; an arbitrary host repo can be onboarded in `<2 min`.
  - **Anchor**: Norman, *The Design of Everyday Things*, Basic Books, 1988 (affordances — the bootstrap command is the affordance that makes the cross-repo capability *visible*; without it, the sidecar architecture is invisible to the operator); Armstrong, *Programming Erlang*, Pragmatic Bookshelf, 2007 (idempotent supervisor restart — `minsky bootstrap` is the supervisor's "start" verb; second invocation must be a no-op, third with `--repair` must restore invariants); rule #6 (let-it-crash — bootstrap failure surfaces, doesn't degrade silently).
  - **Failure modes**:

    | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
    |---|---|---|---|
    | Host has no TASKS.md | host-not-onboardable-yet | bootstrap creates `.minsky/repo.yaml` with `tasks_md_path: TASKS.md` (default) and emits a YELLOW warning; runner deferred until host writes a TASKS.md | `novel/sidecar-bootstrap/src/bootstrap.test.ts` covers |
    | Host's `~/.config/git/ignore` is read-only | filesystem-permission | loud-crash with explicit error and link to runbook | `novel/sidecar-bootstrap/src/bootstrap.test.ts` covers (mock fs.writeFileSync to throw EACCES) |
    | Two `minsky bootstrap` runs race on the same host | concurrency | mkdir-based lock at `.minsky/.bootstrap.lock.d` (mirrors setup.sh's lock); second exits 75 (EX_TEMPFAIL) | `novel/sidecar-bootstrap/src/bootstrap.test.ts` covers (parallel invocations via `pnpm test`'s parallel runner against same fixture) |
    | Symlink to canonical vision.md breaks (user moves `~/apps/minsky/`) | host-config-drift | `--doctor` reports RED with the broken-symlink path; `--repair` re-anchors | covered |

  - **Risk**: divergence between bootstrap inference and host repo's actual conventions (e.g. inferring `lint: yarn lint` when the host actually uses `pnpm biome check`). Mitigation: inference is *advisory*; bootstrap always opens an interactive review of the inferred `repo.yaml` before writing (or a `--non-interactive` mode that exits 1 if any field is unconfident); doctor catches drift on every subsequent invocation.

- [ ] `cross-repo-runner-v0` — `minsky run <task-id>` against any bootstrapped host
  - **ID**: cross-repo-runner-v0
  - **Tags**: novel, runner, cross-repo
  - **Estimate**: 1w
  - **Blocked by**: minsky-sidecar-bootstrap
  - **Blocker rationale**: the runner reads `.minsky/repo.yaml`; without bootstrap, no host can be a target.
  - **Hypothesis**: With host-aware lints (`host-root-resolver-prep`) and a bootstrapped sidecar (`minsky-sidecar-bootstrap`), the runner is *small*: read `.minsky/repo.yaml`, locate the task in `${host}/${tasks_md_path}` by `**ID**:` or by ticket-format match, synthesise an `EXPERIMENT.yaml` at `${host}/.minsky/EXPERIMENT.yaml` from the task's Hypothesis / Pivot / Measurement / Anchor fields (rule-9 iron — fail loudly if any are missing), spawn Claude Code via the existing `ProcessSpawnStrategy` with the host directory as cwd and a system-prompt overlay that injects "you are working under minsky's full constitution at `.minsky/vision.md`; ship a PR whose body carries the Hypothesis self-grade block", wrap the spawn in `BudgetGuard`, and write the iteration result to `${host}/.minsky/experiment-store/`. Pre-push hook (C3 fallback) runs the 4 portable lints + the 8 sidecar-portable lints with `MINSKY_HOST_ROOT=$host` so violations surface before push. The runner never modifies the host repo's tracked files except for the actual code change the task is shipping.
  - **Details**: pnpm workspace `novel/cross-repo-runner/` exposing `bin/minsky-run.ts`. Pure functions: `loadRepoConfig`, `findTask`, `synthesiseExperimentYaml`, `buildSpawnPlan` (returns env, prompts, working dir), `wrapWithBudgetGuard`, `recordIteration`. The CLI is the I/O boundary. Spawn uses the existing `ProcessSpawnStrategy` (no new spawn surface; rule #1 — don't reinvent). Pre-push hook gets installed by `minsky bootstrap` into the host's `.git/hooks/pre-push` (chained behind any existing hook via lefthook-detection or a small wrapper). The hook calls `MINSKY_HOST_ROOT=$host node ~/apps/minsky/scripts/check-pr-self-grade.mjs $(git format-patch ...)` and the rest.
  - **Files**: `novel/cross-repo-runner/{src/{runner,repo-config,task-finder,experiment-synth,spawn-plan,iteration-record}.ts, bin/minsky-run.ts, README.md, package.json, src/*.test.ts}`, `vision.md` § Pattern conformance index (row), `vision.md` § "What Minsky is" (paragraph addition: "minsky also runs the constitution against any host repo with a bootstrapped `.minsky/` sidecar — see cross-repo-runner-v0").
  - **Verification**: (a) `pnpm vitest run novel/cross-repo-runner --reporter=json | jq -e '.numFailedTests == 0 and .numPassedTests >= 28'` (~28 unit tests across the 6 pure functions). (b) End-to-end fixture test: a fixture host repo at `novel/cross-repo-runner/test-fixtures/host-fixture/` with a TASKS.md row containing all rule-9 fields; running `bin/minsky-run.ts` against it (in dry-run mode that doesn't actually spawn Claude) writes `${fixture}/.minsky/EXPERIMENT.yaml` with the right shape and emits a `RunnerPlan` JSON to stdout. (c) Real-spawn integration test under `novel/cross-repo-runner/test/integration/`: bootstrap a real tmpdir host, invoke the runner with `MINSKY_TICK_DRY_RUN=1`, assert the experiment-store record is written.
  - **Measurement**: `pnpm vitest run novel/cross-repo-runner` exits 0 with ≥28 tests passing AND `bash novel/cross-repo-runner/test/e2e-dry-run.sh` exits 0 (dry-run end-to-end smoke).
  - **Pivot**: if the spawn-plan synthesis fails to inject a working system-prompt overlay (Claude Code's spawn surface doesn't let us prepend constitution prose deterministically — observed via 3 consecutive E2E runs where the spawned Claude ignores the constitution prompt and ships PRs without the self-grade block), pivot to a *task-block injection* approach: instead of the system-prompt overlay, the runner *edits* the host TASKS.md row pre-spawn to inline the constitution one-liner ("read `.minsky/vision.md` before opening the PR") so the spawned Claude reads it via `/next-task`'s normal task-claim path. This pivot accepts a slightly more invasive interaction with the host repo's TASKS.md but preserves the constitutional gate.
  - **Acceptance**: `minsky run <task-id> --host /path/to/iep-capabilities-3` against a bootstrapped host produces a `RunnerPlan`, an `EXPERIMENT.yaml`, a budget-gated spawn, and an experiment-store record. v0 ships dry-run-only by default; live-spawn requires explicit `--live` flag (rule #6 — let dry-run be the safe default).
  - **Anchor**: Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003 (MAPE-K — the runner is the *Plan + Execute* phase of cross-repo work; *Knowledge* lives in the experiment-store regardless of which repo the work happened in); Hewitt 1973 (each spawn is an actor; the host repo is the actor's universe; the constitution is the actor's contract); Armstrong 2007 (supervisor wrapping the spawn — budget cap is the SLA, let-it-crash on rule violations); rule #1 (we wrap Claude Code, don't replace it); rule #6 (dry-run default — failure surfaces in the plan, not the side-effect).
  - **Failure modes**:

    | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
    |---|---|---|---|
    | Host has no `.minsky/repo.yaml` | not-bootstrapped | loud-crash with `bootstrap host first: minsky bootstrap <host-dir>` | `novel/cross-repo-runner/src/repo-config.test.ts` covers |
    | Task-id not found in host's TASKS.md | bad-input | loud-crash with `task <id> not found in <tasks-md-path>; available ids: …` | `novel/cross-repo-runner/src/task-finder.test.ts` covers |
    | Task-row missing required rule-9 field (e.g., no Pivot) | rule-9-violation | loud-crash with `rule-9: task <id> missing <field> at <line>; rule-9 is iron, no exemption — see vision.md § 9` | `novel/cross-repo-runner/src/experiment-synth.test.ts` covers |
    | BudgetGuard returns PAUSE during runner invocation | budget-circuit-break | runner exits with `budget paused — see /watch.json or .minsky/budget.flag`; experiment-store records the pause as a `paused-out` record | `novel/cross-repo-runner/src/runner.test.ts` covers (mocked BudgetGuard returning PAUSE) |
    | Host's pre-push hook conflicts with existing hook | hook-collision | runner detects existing hook (`test -x .git/hooks/pre-push`) and chains via lefthook-config OR wraps via `pre-push.minsky` + `pre-push.original`; never silently overwrites | `novel/sidecar-bootstrap` covers (bootstrap is responsible for the install) |
    | Host's tracked files modified by spawn (e.g., Claude edited `package.json` for a rule-9 metric instrumentation) | scope-leak | the runner doesn't gate this — that's the spawned Claude's contract via the constitution; rule #9's preparation-PR pattern is how the spawned agent handles instrumentation needs | covered by the constitution itself, not the runner |

  - **Risk**: silently regressing the supervisor + budget-guard semantics from minsky-on-itself. Mitigation: the runner reuses the existing `ProcessSpawnStrategy` and `BudgetGuard` adapters unchanged; cross-repo work is a *new caller* of the same primitives. The runner's own tests assert that the wrap is observably identical to minsky-on-itself's tick-loop's wrap.

- [ ] `cross-repo-runner-aifn-840-integration-test` — first real host integration: ship AIFN-840 via `minsky run`
  - **ID**: cross-repo-runner-aifn-840-integration-test
  - **Tags**: integration, cross-repo, first-real-host
  - **Estimate**: 2d (most of the time is host-side: bootstrap + iep-capabilities-3 PR cycle)
  - **Blocked by**: cross-repo-runner-v0
  - **Blocker rationale**: the runner must exist before it can run.
  - **Hypothesis**: Bootstrapping `~/apps/iep-capabilities-3/.minsky/` and invoking `minsky run aifn-840-slash-command-labels --live` ships a working PR on `expertnetwrk-portal/iep-capabilities` whose body carries the Hypothesis self-grade block, whose code change matches the AIFN-840 spec (titles `"hold"` → `"Put on hold"`, `"lead"` → `"Lead support"` in `commandCenterConfig.ts`), and whose CI is green. This proves the cross-repo architecture end-to-end on a real host with real branch-protection, real CI, and real reviewer expectations. Failure modes surfaced by this run get filed back as P1 follow-ups.
  - **Details**: (a) `cd ~/apps/iep-capabilities-3 && minsky bootstrap .` — write the host overlay; review the inferred `repo.yaml`. (b) `minsky run aifn-840-slash-command-labels --live --host .` — runner cuts a branch (`aifn-840-slash-command-labels` per `branch_prefix` from repo.yaml), spawns Claude Code with the constitution overlay, BudgetGuard cap (Max5 default), pre-push hook installed. (c) Spawned Claude ships the 2-line title fix in `plugins/iep-ai-native/src/store/selectors/commandCenterConfig.ts:86,96`, updates the matching spec, runs `yarn vitest run` + `yarn tsc --build` + `yarn run -T eslint --fix`, opens a PR with the self-grade block in its body. (d) Runner records the iteration in `~/apps/iep-capabilities-3/.minsky/experiment-store/`; minsky's MAPE-K loop ingests it on the next tick. (e) Reviewer review + merge handled by the host repo's standard process (this is *out* of the runner's scope — the runner gets the PR up to "review-ready"; merging is a human gate).
  - **Files**: `~/apps/iep-capabilities-3/.minsky/repo.yaml` (created by bootstrap; never committed to iep-capabilities); `~/apps/iep-capabilities-3/.minsky/EXPERIMENT.yaml` (synthesised per-run); `~/apps/iep-capabilities-3/.minsky/experiment-store/<iteration>.yaml`; the AIFN-840 PR on `expertnetwrk-portal/iep-capabilities`; an entry in `~/apps/minsky/experiment-store/cross-repo/2026-MM-DD-aifn-840.yaml`.
  - **Verification**: (a) `gh pr list --repo expertnetwrk-portal/iep-capabilities --search "AIFN-840 in:title is:open" --json number --jq 'length' >= 1` after the runner exits. (b) The PR body matches the `Hypothesis self-grade` regex from `scripts/check-pr-self-grade.mjs`. (c) Host CI is green. (d) `cat ~/apps/minsky/experiment-store/cross-repo/2026-MM-DD-aifn-840.yaml | grep -E "verdict: validated|inconclusive|regressed"` — verdict recorded.
  - **Measurement**: `bash novel/cross-repo-runner/test/aifn-840-integration.sh` (committed in this PR) walks the four asserts above and exits 0 only on full success.
  - **Pivot**: if the PR cycle fails for non-runner reasons (host CI flake, reviewer requested rework, branch-protection rule the runner didn't anticipate) ≥3 consecutive runs against AIFN-840-equivalent fixture tasks, the integration test is *too noisy* to be the v0 acceptance — fall back to a pure-fixture host (a shadow repo we control) for v0 acceptance, and use AIFN-840 as the v1 acceptance once the noise sources are characterised. This pivot doesn't kill the architecture; it just defers the "real host" claim by one version.
  - **Acceptance**: AIFN-840 ships on iep-capabilities via `minsky run`; experiment-store records it; minsky's MAPE-K loop ingests it; the framing change in vision.md is *demonstrated*, not just claimed.
  - **Anchor**: rule #9 (this is the experiment that closes the cross-repo hypothesis); Munafò 2017 (the prediction was made before AIFN-840 was attempted; the observation will be Match: yes / no / partial); rule #3 (test-first, metric-first — AIFN-840 is the *test*, not just an example).
  - **Failure modes**:

    | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
    |---|---|---|---|
    | iep-capabilities-3 has uncommitted work when runner starts | dirty-worktree | runner refuses to start; emits `host has uncommitted changes; commit or stash before running` | covered by the runner's pre-flight |
    | Spawned Claude writes a PR that violates iep-capabilities-3's *own* CLAUDE.md (e.g., header >72 chars, missing JIRA ticket) | host-contract-violation | host's pre-commit / commitlint rejects; runner observes the rejection and records `verdict: regressed` with the rejection message | covered by the iteration-record contract |
    | The 2-line fix exposes other consumers of `slashCommand.title` that *expected* lowercase | latent-coupling | spawned Claude's `grep` covers it (the AIFN-840 task block has an Acceptance line for this); test surface catches it | covered by the existing iep-capabilities-3 test suite |
    | Runner's pre-push hook lets a violating PR through | hook-bypass / runner-bug | minsky-side GitHub Action (next task, `cross-repo-ci-action`) catches the missing self-grade block out-of-band; PR check fails; reviewer informed | covered when `cross-repo-ci-action` ships |

  - **Risk**: this task is the moment the architecture meets a real-world host. Surprises are likely. Mitigation: the Pivot threshold (≥3 consecutive non-runner failures → fall back to fixture) is the explicit escape valve; any single failure surfaces a P1 follow-up; this task is *not blocked* on shipping zero-defect code on the first run — it's blocked on demonstrating the architecture works end-to-end *or* identifying the specific gap that needs closing.

- [ ] `cross-repo-ci-action` — minsky-side GitHub Action posts constitution-check verdicts via the GitHub API (decision C2)
  - **ID**: cross-repo-ci-action
  - **Tags**: ci, cross-repo, observability
  - **Estimate**: 3d
  - **Blocked by**: cross-repo-runner-aifn-840-integration-test
  - **Blocker rationale**: the integration test surfaces the gaps that decide what the action enforces; ship the action against a *known* signal, not speculatively.
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

- [ ] `setup-doctor-ntfy-check` — `setup.sh --doctor` should report `ntfy` CLI status (currently silent on it despite topic seeded in state.json)
  - **ID**: setup-doctor-ntfy-check
  - **Tags**: setup, observability, surfaced-by-fresh-install
  - **Estimate**: 30m
  - **Hypothesis**: `setup.sh` seeds an `ntfy.topic` field in `.minsky/state.json` on first run, and the `@minsky/notifier` Strategy `NtfyNotifier` shells out to either `curl` (HTTP POST to `https://ntfy.sh/<topic>`) or the `ntfy` CLI. Today `--doctor` checks `git`, `node`, `npx`, `claude`, `jq` — but not `ntfy` and not `curl`. A first-time operator with no `ntfy` CLI and no curl will silently fail their first push when the daemon transitions to budget-paused (cf. `daemon-budget-pause-observability` P1). Adding one line per dependency to `--doctor` (`ok "ntfy/curl"` or `warn "ntfy CLI missing — pushes fall back to curl"` / `warn "curl missing — push notifications disabled"`) closes the silent-failure path with zero behaviour change for happy-path users.
  - **Details**: Extend the `--doctor` block at `setup.sh:225-254`: add `command -v curl` (already-installed on macOS / most Linux but worth verifying) and `command -v ntfy` (graceful-degrade — yellow if missing, since curl-based fallback exists per `NtfyNotifier`). Match the existing `claude` / `jq` pattern (warn → STATUS yellow). No state mutation. Update the prereqs section similarly so install-mode also surfaces it.
  - **Files**: `setup.sh`, possibly `distribution/README.md` if it documents the doctor surface.
  - **Verification**: `./setup.sh --doctor` on a host with `ntfy` and `curl` both present prints `✓ curl` and `✓ ntfy` and exits 0 GREEN; on a host without `ntfy` prints `⚠ ntfy missing — pushes fall back to curl` and exits 0 YELLOW; on a host without `curl` prints `⚠ curl missing — push notifications disabled` and exits 0 YELLOW.
  - **Measurement**: `bash -c './setup.sh --doctor 2>&1 | grep -E "(curl|ntfy)"' | wc -l` ≥ 2 on any host; CI matrix can add a row that purposefully removes `ntfy` from PATH and asserts the YELLOW exit.
  - **Pivot**: if curl is universally present on every supported host (macOS, Linux distros we support) AND the `ntfy` CLI is never the fallback we actually invoke (curl is always sufficient), drop the `ntfy` CLI check and only verify curl. The `ntfy` check is a YAGNI-candidate per Beck *Extreme Programming Explained* 1999 if curl is a complete substitute.
  - **Acceptance**: `--doctor` no longer silently passes on a host where the configured push channel will fail at runtime.
  - **Anchor**: Beyer, Jones, Petoff, Murphy, *Site Reliability Engineering*, O'Reilly, 2016, Ch. 6 ("Monitoring Distributed Systems" — health checks must cover the actual fault axes, not just the convenient ones); Armstrong, *Programming Erlang*, Pragmatic Bookshelf, 2007 (let-it-crash discipline only works when the failure surfaces; silent push-failure is the opposite of let-it-crash).
  - **Risk**: low. The check is additive; failure mode is YELLOW (graceful degrade), not RED.
  - **Surfaced-by**: 2026-05-04 fresh install — operator ran `./setup.sh --doctor` GREEN, then noticed `ntfy` not on PATH and `state.json` ntfy.topic was seeded but unverified end-to-end.

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
