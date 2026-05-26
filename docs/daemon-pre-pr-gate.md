<!-- pattern: see vision.md § "Pattern conformance index" rows tagged `rule #10` (deterministic enforcement) — this doc is the operator-facing explanation of the canonical pre-PR lint gate that TASKS.md `daemon-pre-pr-lint-gate` ships. -->

# Daemon pre-PR lint gate

> The contract that makes the supervisor pass through the same gate humans pass through. One canonical script (`scripts/run-pre-pr-lint-stack.mjs`) is the single source of truth; CI's `ci:` aggregator, `lefthook` `pre-push`, and the daemon brief all import it. If this doc and the script disagree, the script is right.

The gate exists because the daemon's first-pass output reliably failed CI lints I had already shipped (markdownlint MD001, rule-12 scope opt-out, rule-3 doc-first, rule-6 catch annotations, rule-7 chaos parsing). Every failure cost an operator-side babysitting commit. Pre-registered metric (TASKS.md `daemon-pre-pr-lint-gate`): post-fix, ≥80% of daemon-authored PRs open with zero red CI checks (vs the ~0% before any slice landed).

## The five components

```text
.github/workflows/ci.yml `needs:` aggregator
        │  (drift-tested against the manifest — slice 5/N)
        ▼
STACK_MANIFEST              scripts/run-pre-pr-lint-stack.mjs   (slice 1/N)
   ├── --stage=fast (≤2 min target — daemon's gate; closes ~80% of failure modes)
   └── --stage=full (operator's gate — adds vitest + diff-relative + dormant-config lints)
        │
        ├──► daemon brief mandate                  novel/tick-loop/src/daemon.ts § "Pre-PR lint-stack gate"   (slice 2/N)
        │       (every iteration prompt tells the inner Claude to run `pnpm pre-pr-lint` before `gh pr create`)
        │
        ├──► lefthook pre-push                     lefthook.yml § pre-push.commands.pre-pr-lint   (slice 4/N)
        │       (humans + the daemon's own `git push` go through `pnpm pre-pr-lint --stage=full`)
        │
        └──► self-diagnose invariant               scripts/self-diagnose.mjs § daemonPrLintPassRateInvariant   (slice 3/N)
                (rolling 30d daemon-PR clean-CI fraction; fires below 0.8 with two named root causes
                 and a TASKS.md task-block draft)
```

Each component has one job. The manifest is the seam (rule #2 — single source of truth for the lint set). `runStack` is a pure function over `(stage, runStep, manifest)`; the I/O lives in `defaultRunStep` and is replaceable via DI for the paired tests. The daemon brief, the pre-push hook, and the operator's `pnpm pre-pr-lint` all converge on the same script — that is the load-bearing claim, and slice 5/N pins it with a structural drift test.

## What the gate enforces

The fast stage (default) runs the nine lints that close the five empirically-named daemon-PR failure modes (markdownlint MD001, rule-12 scope opt-out, rule-3 doc-first, rule-6 catch annotations, rule-7 chaos parsing — the brief's pre-fix observation set), plus the four cheap structural checks that keep the whole tree compiling:

- `biome` — formatting + lint over `.{ts,js,json,jsonc,md}`. **Diff-scoped** via biome's native `--changed --since=<base>`: lints only the files the branch changed vs the resolved diff base, not the whole 400+-file tree, so inherited committed-main biome debt (e.g. `scripts/collect-metrics.mjs`) cannot flap an unrelated vetted branch's `git push` (TASKS.md `orchestrator-must-land-local-vetted-branches`, the Pivot's "extend it to the whole stack"). CI's `biome` job still runs whole-tree.
- `typecheck` — `tsc --noEmit` across the workspace.
- `markdownlint` — MD001 (heading-increment), MD040 (fenced-language), MD034 (no bare URLs), and the rest of `.markdownlint.json`. **Diff-scoped** (`scripts/lint-md-diff.mjs`): lints only the `*.md` files the branch committed vs the resolved diff base, not the live `**/*.md` tree, so concurrent swarm churn on TASKS.md/vision.md and inherited committed-main debt cannot flap an unrelated vetted branch's `git push` (TASKS.md `orchestrator-must-land-local-vetted-branches`). CI's `markdownlint` job still runs whole-tree.
- `tasks-lint` — `@tasks-md/lint` against `TASKS.md`.
- `rule-2-dep-coverage` — every cross-package import has a Strategy seam.
- `rule-3-doc-first` — every `novel/**/*.ts` change touches a doc (or carries a deferral marker).
- `rule-6-let-it-crash` — every `try/catch` carries an `// rule-6:` annotation explaining the swallow.
- `rule-7-chaos-coverage` — every `novel/**/README.md` lists a chaos test for each public artefact (promoted from full-only to fast on 2026-05-06 in slice 8/N — the 5th and final empirical failure mode now gated pre-PR rather than only at lefthook).
- `rule-12-scope-discipline` — every newly-added public artefact resolves to a TASKS.md block, an `experiments/` pre-registration, or an in-PR opt-out.
- `orphan-tests` — every `novel/**/test/**/*.test.{ts,mjs,js}` file's named imports from `../src/...` or `../../src/...` resolve to actual exports in the sibling source. Catches the API drift class observed 2026-05-21 in PR #639 → #705: a test file imports symbols that don't exist in main's source after a conflict resolution that took main's source but the PR's tests. The lint runs ~60ms and uses regex-only ESM parsing per Aho-Sethi-Ullman 1986 Ch. 3.
- `rule-17-proactive-heal` — every PR description that surfaces observed-error tokens (`spawn-failed`, `scope-leak`, `ETIMEDOUT`, `GraphQL 401`, stack traces) must also carry healing evidence — a `fix(...)` / `patch:` commit subject, a `**Blocked**: <code>` task block, or a non-empty diff. Promoted to fast 2026-05-19 — same shape as rule-12, catches the "watcher who narrates" anti-pattern at the PR boundary so the rule is never just aspirational.
- `no-hardcoded-user-paths` — every executable line under `novel/**`, `scripts/**`, `bin/**`, `distribution/**` MUST NOT match `/Users/<other-user>/…` or `/home/<other-user>/…`. The rule-#17 fix for the recurring `MINSKY_HOME ?? "<user-home>/…"` class (PRs #651 + #654). Comments are exempt (audit trail); current-user, `ubuntu`, and `runner` are exempt (CI + local-machine self-references). Belt-and-suspenders for rule #1 — derive paths from `import.meta.url` / `$HOME` / env, never hardcode somebody else's `$HOME`.
- `no-personal-paths-in-docs` — markdown sibling of `no-hardcoded-user-paths`. Every tracked `*.md` and `*.markdown` file MUST NOT leak personal paths (`/Users/<other-user>`, `~/apps/<repo-on-someone-else's-mac>`, `MINSKY_HOME=~/apps/tooling/minsky` defaults) into READMEs, docs, user-stories, changelogs, or TASKS.md. Same exemptions as the code-path version (comments allowed, current-user allowed). Added 2026-05-20 after the 2-day backlog audit found 13 doc files with operator-machine-specific paths that broke INSTALL.md for anyone running `git clone && pnpm install` on a fresh host. <!-- not-personal: this is the doc that explains what patterns the lint catches; the literal substrings above are examples-of-the-bug, not real personal paths -->
- `agents-md-coherence` — every claim in `AGENTS.md` that points outward must resolve. Three drift classes: required-section invariant (`## Constitutional rules`, `## Orchestrator discipline`, `### 15. Milestone alignment gate` must all exist verbatim — they're cited by `check-pr-self-grade.mjs`, `check-rule-6-let-it-crash.mjs`, and CHANGELOG.md); relative-link resolution (every `[text](path)` whose path is relative must point to a real file); `vision.md § N` citation resolution (every `vision.md § N` reference must point to a real `### N.` heading in vision.md). Added 2026-05-21 per operator directive "Let's ensure agents.md is always updated too" — closes the same drift class for AGENTS.md that PR #686 closed for CHANGELOG.md via semantic-release.
- `rule-9-tasksmd-fields` — every task block in `TASKS.md` carries the five rule-#9 fields: `Hypothesis`, `Success` (or `Acceptance`), `Pivot`, `Measurement`, `Anchor`. Without all five the iron rule degrades to wish-list. The 2026-05-19 audit found 32 of 152 task blocks violating; the lint's `RULE_9_GRANDFATHERED` allowlist captures them so the gate blocks NEW violations while the existing ones drain via the `rule-9-tasksmd-fields-backfill` task.
- `competitive-goal` — every P0 / P1 task block in `TASKS.md` carries a `**Competitive-goal**:` field naming which scorecard metric the task moves and the predicted delta. Slice (d) of `self-metrics-competitive-benchmark`. Same rule-#10 ratchet shape as `rule-9-tasksmd-fields`: 81 grandfathered task ids at lint-introduction (2026-05-22), captured in `COMPETITIVE_GOAL_ALLOWLIST` in the lint; NEW tasks added after lint-introduction must carry the field or fail the gate.
- `threat-model-section` — every constitutional `novel/**/README.md` carries a STRIDE-shaped `## Threat model` section with ≥5 non-empty content lines (promoted from full-only to fast in #331's slice — the 6th rule-#13 substrate gate now also runs pre-PR rather than only at lefthook); rule #13.8 — security & privacy minimum-bar item #8 (threat-model documented per novel package).
- `cloud-agent-config-audit-matrix` — the 4-agent cloud-agent contract lint. Asserts `AGENT_MATRIX` (in `novel/cross-repo-runner/src/agent-config.ts`) has exactly 4 rows (claude / devin / aider / openhands) in canonical order, every row carries a valid `briefDeliveryShape` + `modelFlag`, shipped agents carry no `pendingExternalDep`, and the openhands row's `pendingExternalDep` matches the today-vs-2026-06-01 contract. Self-flips on 2026-06-01 — refuses to be green during the operator's required `pendingExternalDep → null` flip. Named in `add-openhands-as-pluggable-backend` § Measurement (P0).
- `brief-pr-instructions` — `novel/cross-repo-runner/src/spawn-plan.ts` keeps the three literal substrings (`FINAL STEP`, `git push`, `gh pr create`) that convert the agent's analysis-mode tail into action-mode. Pre-merge counterpart to the `briefIncludesPrInstructions` runtime invariant; closes the `devin-spawn-no-pr-opened` regression class (2026-05-18 fix in commit 085fdd7); rule #10 (deterministic enforcement).
- `check-task-block-citations` — refuses to remove a TASKS.md task block when the ID is still referenced by any `*.test.{mjs,ts}` or `*.bats` file. Closes the PR #864 failure mode where removing `daemon-pre-pr-lint-gate` from TASKS.md broke 5 parity tests that grep'd the block for its threshold + selector prose. Escape hatch: `<!-- DO NOT DELETE — citation site for tests/X.test.mjs:Y -->` inside the block being removed silences the lint. Pure regex over `git diff` text + the test corpus; fast-stage budget unaffected. Anchor: TASKS.md `orphan-cleanup-task-block-citation-lint` (P1, M1); rule #10 (deterministic enforcement); rule #17 (proactive heal — every bug becomes a rule); Hyrum's Law (the TEXT of a task block can become load-bearing for tests that pin its claims).
- `milestone-alignment` — every PR re-runs the rule-#15 alignment gate. `node scripts/check-milestone-alignment.mjs --strict --min-aligned=10` reads MILESTONES.md + docs/METRICS.md + user-stories/*.md + README.md and asserts ≥10 of M1's 14 exit criteria have all five surfaces aligned (user-story · sections · test-file · metric · README mention) or carry an explicit `<!-- exempt: ... -->` reason in MILESTONES.md. Slice (c) of `milestone-alignment-gate-enforcement`; promoted from informational `bin/minsky milestone check` to deterministic gate 2026-05-24 once the parent task's ≥10/14 threshold was met. Pure file reads — no install, no network — so the fast-stage budget is unaffected.

The full stage adds the slow lints — vitest, the remaining diff-relative checks, and the dormant config caps. CI runs all of them; the operator's `pnpm pre-pr-lint --stage=full` (the gate `lefthook` `pre-push` invokes) mirrors the same set so a local push catches whatever a `gh pr create` would catch:

- `vitest` — `pnpm test:coverage` across all packages.
- `knip` — dead-code + unused-exports + unused-dependencies detector ([knip](https://knip.dev)). Configured in `knip.json`; declares the workspace shape (entry points = `bin/*` CLI scripts + `scripts/*.mjs` + workspace package `src/index.ts` + paired `*.test.*` vitest entries). All rules currently at WARN so the lint surfaces findings without blocking CI; rules graduate to ERROR per the rule-#10 ratchet once their violation count converges to ≤5 with documented exemptions.
- `depcruise` — circular-dep + orphan-file detector via [dependency-cruiser](https://github.com/sverweij/dependency-cruiser). Configured in `.dependency-cruiser.cjs`. WARN-level rules (`no-circular`, `no-orphans`, `not-to-deprecated`) surface findings; ERROR-level rules (`no-dep-on-test`, `no-non-package-json`) trip the exit code immediately. Targets `novel/` and `scripts/` only — the rest of the tree is excluded via the config's `options.exclude` list.
- `check-cross-repo-pr-rate` — cross-repo runner iteration→PR ship-rate gate (M1 P0 `cross-repo-iteration-ship-rate-ci-gate` closed 2026-05-24). Reads `.minsky/experiment-store/cross-repo/*.jsonl` and exits 1 when the rolling-30d ratio is below the pre-registered FLOOR (0.10). Pre-registered threshold constants `SHIP_RATE_TARGET=0.15`, `SHIP_RATE_FLOOR=0.10`, `MIN_SAMPLE_SIZE=5`, `DEFAULT_WINDOW_DAYS=30` pinned in `novel/cross-repo-runner/src/iteration-ship-rate.ts` (rule #9 + Munafò 2017). FULL stage only by design — the daemon's fast gate doesn't need a metric over its own history; only operator pushes are blocked when BELOW. The daemon can still file fix-the-rate PRs when the rate is bad.
- `rule-1-novel-justification` — every novel artefact carries a justification block.
- `rule-4-otel-coverage` — every public function in `novel/**` emits an OTEL span (rule #4 — everything measurable, everything visible).
- `rule-5-glossary-discipline` — every glossary term in vision.md has exactly one definition.
- `pattern-index` — every artefact maps to a row in vision.md's "Pattern conformance index" (rule #8).
- `no-singleton-experiment` — every `experiments/*.yaml` resolves to ≥2 deployed instances (no singletons).
- `lockfile-integrity` — diffs `pnpm-lock.yaml` against `origin/main` and rejects same-`name@version` entries whose integrity hash changed (rule #13.5 — security & privacy minimum-bar item #5; the empirical fingerprint of the 2025 chalk/debug supply-chain incident).
- `otel-no-pii` — full-scan of `novel/**/*.ts` rejects PII-shaped span attributes (rule #13.2 — security & privacy minimum-bar item #2).
- `secret-scan` — full-scan of every tracked file rejects credential shapes (`ghp_…`, `sk-…`, `xoxb-…`, `AKIA…`, `AIza…`, PEM headers); rule #13.1 — security & privacy minimum-bar item #1.
- `sbom-shape` — validates the on-disk CycloneDX SBOM against the 1.5/1.6 subset (`bomFormat`, `specVersion`, `version`, `components[].type/name/version/purl`, unique `bom-ref`); fail-safe-defaults exit-0 when no SBOM is present so the gate is wire-able before the generation step lands; rule #13.5 — security & privacy minimum-bar item #5 (supply-chain hardening — SBOM shape is the consumer's only structural guarantee against generator-side regressions).
- `privacy-data-egress` — pins `docs/security/privacy-data-egress.md` against drift: six required H2 sections in canonical order, five enumerated egress destinations (Anthropic API, OpenObserve, GitHub, npm registry, ntfy.sh), STRIDE methodology engagement, and the GDPR Article 25 anchor; rule #13.7 — security & privacy minimum-bar item #7 (privacy by default — operator can answer "where does my data go" from one page).
- `dashboard-localhost-bind` — pins `novel/dashboard-web/src/{bind,start}.ts` substrate-cohesion: `BIND_DEFAULT = "127.0.0.1"`, `resolveBindHostname` + `bindHostnameWarning` exported from `bind.ts`, imported and called in `start.ts`, and `serve({ ... hostname ... })` carries the resolved value. Without this gate a future edit could silently re-expose the dashboard to LAN by removing the resolver call or omitting the `hostname` field (whereupon `@hono/node-server` falls back to `0.0.0.0`); rule #13.4 — security & privacy minimum-bar item #4 (dashboard binds to loopback by default).
- `security-docs-cohesion` — every `docs/security/*.md` operator-readable doc cites `rule #13` and carries a STRIDE-shaped `Threat model` heading. Companion to `threat-model-section` (covers `novel/<pkg>/README.md`), `rule-13-sibling-anchors` (covers TASKS.md sibling P0s), and `vision-rule-13-task-id-citations` (covers vision.md § 13). Where those three pin the task / spec / package surfaces, this gate pins the operator-doc surface — the fourth and last surface where rule #13's substrate cohesion can drift silently. Rule #13 / `security-privacy-priority-substrate` substrate-cohesion gate.
- `metric-freshness` — every dashboard metric in the expected list emitted within its freshness window.
- `mape-k-budget-cap` — the autonomic-manager weekly budget cap matches the documented value.
- `mape-k-constraints-md-size` — `novel/mape-k-loop/constraints.md` archive stays under its 200-entry cap.
- `mape-k-tick-iteration-backstop` — the tick-iteration backstop integer matches ARCHITECTURE.md.
- `mape-k-watchdog-cadence` — the watchdog cadence (hours) matches ARCHITECTURE.md.
- `tick-loop-backoff-schedule` — the restart-backoff schedule matches ARCHITECTURE.md (5s → 30s → 5min).
- `machine-budget` — the operator machine-utilisation budget contract holds: the budget controller exports + policy constants stay pinned (`defaultBudgetPct=70`, `swarmMaxBudgetPct=80`), no minsky worker/tick-loop launchd template sets `ProcessType=Background` while the budget is non-trivial (the QoS class throttles the very CPU/IO the budget allocates), and the controller test file keeps the three rule-#9 pre-registered behaviour suites (ramp-up, knee, gridlock backoff). Dormant until the controller artefact lands; vision.md rule #15 / operator directive 2026-05-17.
- `supervisor-sandbox-hardening` — every Minsky supervisor systemd unit (`minsky-tick-loop.service`, `minsky-budget-guard.service`, `minsky-watchdog.service`) carries the safe set of stage-0 hardening directives (`NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectKernel{Tunables,Modules,Logs}=yes`, `ProtectControlGroups=yes`, `RestrictSUIDSGID=yes`, `LockPersonality=yes`, `RestrictRealtime=yes`); rule #13.3 — security & privacy minimum-bar item #3 (supervisor sandbox), stage 0 of `supervisor-sandbox-syscall-restriction`. Filesystem/network restrictions ship in stage 1+ behind the dry-run + warn-only ramp.
- `cadence-pivot-threshold` — the cadence-pivot threshold fraction matches research.md.
- `pivot-success-margin` — every rule-#9 record's pivot threshold is below its success threshold by ≥ the documented margin.
- `anchor-primary-source` — every rule-#9 record's anchor cites a primary source, not a tutorial.
- `measurement-inspects-output` — every rule-#9 record's measurement command inspects runtime output, not just exit code.
- `skill-rule-cap` — every advisory Claude Code skill resolves to ≤ the documented number of vision.md rules.
- `user-story-security-section` — every user story (001–006) carries a `## Security & privacy` section that cites `rule #13` and has ≥5 non-empty content lines (rule #13 / `security-privacy-priority-substrate` acceptance criterion #2).
- `rule-13-sibling-anchors` — each of the 6 sibling security P0s (`secret-scanning-precommit-and-ci`, `supervisor-sandbox-syscall-restriction`, `dashboard-localhost-only-by-default`, `otel-no-pii-in-spans-lint`, `supply-chain-hardening-lockfile-sbom-slsa`, `cloud-tier-external-security-audit-gate`) cites `rule #13` in its TASKS.md Anchor line; rule #13 / `security-privacy-priority-substrate` acceptance criterion #3 (substrate-cohesion gate, TASKS.md → vision.md direction).
- `vision-rule-13-task-id-citations` — vision.md § 13's minimum-bar items 1–6 each cite the canonical sibling P0 ID verbatim as backticked text; rule #13 / `security-privacy-priority-substrate` acceptance criterion #3 (inverse direction, vision.md → TASKS.md).
- `cloud-audit-gate` — blocks any PR diff touching `novel/cloud-supervisor/`, `novel/cross-repo-benchmark/`, or `novel/shared-invariant-catalog/` while the `cloud-tier-external-security-audit-gate` task block's `**Blocked**:` line still contains `needs-user-approval`; dormant today (no cloud-tier packages exist in `main`) so the gate ratchets pre-emptively, ensuring cloud-tier code cannot accrue ahead of the third-party audit. Rule #13.6 — security & privacy minimum-bar item #6 (external security audit gate before cloud tier); operator-facing prose at `docs/security/audit-gate.md` § Layer 1.
- `vision-rule-13-non-task-anchors` — vision.md § 13's minimum-bar items 7 (Privacy by default) and 8 (Threat model per novel/* package) each carry their named industry-standard anchor (`GDPR Article 25`, `OWASP Privacy Top 10`, `STRIDE`); companion to `vision-rule-13-task-id-citations` for the two items that have no sibling P0 task ID, so every numbered item has a load-bearing citation pinned by CI.
- `measure-agent-install` — `scripts/measure-agent-install.mjs` in mock mode exits 0 with `aggregate_verdict == "pass"`, proving the harness machinery for parent P0 `agent-mediated-install` Success #1 (the 9-run cross-provider install-latency contract). Mock mode is the CI regression gate; live mode is the P2 follow-up `measure-agent-install-live-mode`. Wired into both the manifest's full stage and CI's `ci:` aggregator.

The env-dependent CI jobs (`hygiene` / `linux-supervisor-integration` / `macos-supervisor-integration` / `maciek-smoke` / `pr-self-grade` / `pr-security-review` / `pr-vision-trace` / `fresh-clone-smoke`) are intentionally absent from the manifest — they cannot evaluate against a local checkout without GitHub / pipx / dbus plumbing the daemon does not have. CI runs them; this gate does not pretend to. (`fresh-clone-smoke` lives in `.github/workflows/fresh-clone.yml` and destroys `novel/tick-loop/dist/` to simulate the stale-build path — running it locally would wipe the dev build.) (Two further CI jobs, `rule-11-flake-detection` and `cto-audit-pr-conventions`, run on every PR for diagnostic value but are not in the `ci:` aggregator's `needs:` — they don't gate the meta-check, so they are not in the manifest either.)

## Drift hazards and their mitigations

The gate's value depends on seven parity claims, each with its own pin:

1. **Manifest ↔ CI parity.** A future PR adding a CI lint job and forgetting the manifest entry would leave the gate silently undergated. Slice 5/N's `ci.yml drift` test parses the `ci:` aggregator's `needs:` list, filters out the env-dependent allowlist, normalises the two known name aliases (`test`↔`vitest`, `glossary-discipline`↔`rule-5-glossary-discipline`), and asserts bidirectional set equality with the manifest's `full` stage. Adding a CI job without manifest entry now fails this test loudly.

2. **Standalone ↔ hook parity.** `git push` exports `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` / … to its hooks (per `git-scm.com/docs/githooks` § `pre-push`). Vitest steps that bootstrap a fresh git repo in a tmpdir inherited those names and misrouted to the parent's index, failing under lefthook pre-push while passing standalone — exactly the canonical drift the gate is meant to prevent. Slice 5/N's `stripGitHookEnv` filter at `defaultRunStep`'s I/O boundary removes the eight names git hooks documents; three paired tests pin the round-trip.

3. **Brief ↔ manifest parity.** The daemon brief enumerates fast-stage step names so the inner Claude knows which step to retry on. If a new fast-stage check is added to the manifest but the brief isn't updated, the "fix the named step" retry instruction is silently incomplete — the daemon would not know to iterate on the new lint. Slice 7/N's parity test in `novel/tick-loop/src/daemon.test.ts` parses fast-stage names from `scripts/run-pre-pr-lint-stack.mjs` and asserts the brief enumerates each one; mutation-tested (drop one name from the brief → test fails).

4. **Docs ↔ manifest parity.** Slice 8/N promoted `rule-7-chaos-coverage` into the fast stage; the operator-facing doc (this file) was authored against the pre-promotion manifest and silently kept listing `rule-7` only in the full-stage section for the rest of the day. Slice 13/N's `docs/daemon-pre-pr-gate.md drift-protection` block parses the bullet list under "What the gate enforces" and asserts bidirectional set equality with `selectSteps("fast")`. The next stage promotion that forgets the doc fails loudly instead of silently shipping.

5. **Aggregator `needs:` ↔ aggregator bash gate-check parity.** The `ci:` aggregator's `gate` step hand-enumerates `${{ needs.X.result }}` across three bash buckets (must-succeed; supervisor-integration success-or-skipped; pr-self-grade / pattern-index / skill-rule-cap success-or-skipped). A future PR adding a job to `needs:` and forgetting the bash bucket would let the aggregator report green when that job failed — silently undergating the meta-check operators key off. Slice 15/N's `ci.yml aggregator bash-loop drift-protection` block parses every `${{ needs.X.result }}` reference in the `ci:` block and asserts bidirectional set equality with the parsed `needs:` list. The reverse direction (a `needs.X.result` reference for a job not in `needs:`) errors at workflow load in production; the test pins it locally for fast feedback before push.

6. **Docs ↔ manifest full-stage parity.** Slice 13/N closed this surface for the fast stage but left the full stage in prose, where two manifest entries (`rule-5-glossary-discipline`, `no-singleton-experiment`) had silently never been listed at all. Slice 16/N refactors the full-stage description to a bullet list in the same shape as the fast-stage list, and the `docs/daemon-pre-pr-gate.md full-stage drift-protection` block in `scripts/run-pre-pr-lint-stack.test.mjs` parses it and asserts bidirectional set equality with `selectSteps("full")`. Every full-stage step in the manifest must now appear in the operator-facing doc; every step in the doc must correspond to a manifest entry — the same invariant slice 13 enforces for the fast stage, now extended to the operator-side gate's full set.

7. **Docs ↔ env-dependent allowlist parity.** The doc's "What the gate enforces" section enumerates the env-dependent CI jobs intentionally absent from the manifest (`hygiene` / `linux-supervisor-integration` / `macos-supervisor-integration` / `maciek-smoke` / `pr-self-grade` / `pr-security-review` / `pr-vision-trace`). That enumeration mirrored a `CI_ENV_DEPENDENT` set previously hardcoded in `scripts/run-pre-pr-lint-stack.test.mjs` — two sources of truth, drift waiting to happen the next time a CI job's env-dependence changes (e.g., promoting a job from PR-only to push-and-PR, or retiring an env-dependent job). Slice 17/N lifts the allowlist into the canonical manifest module (`CI_ENV_DEPENDENT_JOBS` in `scripts/run-pre-pr-lint-stack.mjs`, paired with `CI_TO_MANIFEST_ALIAS`) and the `docs/daemon-pre-pr-gate.md env-dependent allowlist drift-protection` block parses the doc's enumeration and asserts bidirectional set equality with `CI_ENV_DEPENDENT_JOBS.keys()`. Every allowlist entry must appear in the doc; every doc enumeration must correspond to an allowlist entry.

8. **Bash bucket per-job assignment parity.** Slice 15/N (drift hazard #5 above) pins the *union* of the `ci:` aggregator's three bash buckets equal to `needs:`, but does not pin which bucket each job belongs to. The buckets have different semantics — `mustSucceed` rejects `skipped` results, the two `success|skipped` buckets accept them — so a regression that moves `pr-self-grade` from `prOnlySkippable` (where `skipped` on push is legitimate) to `mustSucceed` would fail every push to `main` without tripping slice 15's union check. Symmetrically, moving `biome` from `mustSucceed` to either `success|skipped` bucket would silently ungate the lint (a `skipped` biome would now pass the gate). Slice 21/N exposes the per-bucket assignment as `CI_BASH_GATE_BUCKETS` in `scripts/run-pre-pr-lint-stack.mjs` (same shape as `CI_ENV_DEPENDENT_JOBS`) and the `each bash bucket's membership matches CI_BASH_GATE_BUCKETS` test parses each `for r in ... ; do <body>; done` block separately, classifies it by body shape (`[ "$r" = "success" ]` vs `case "$r" in success|skipped`), and asserts each parsed bucket equals the constant's bucket. A companion test pins the constant itself: the three buckets are disjoint and their union equals `needs:`.

The gate is now invariant to which transport invokes it (operator terminal, lefthook pre-push, daemon iteration), to which name a fast-stage step takes (brief and manifest stay in lockstep), to where the aggregator gate is sourced (the `needs:` declaration, its bash gate-check, and its per-bucket assignment all stay set-equal), to which stage a doc bullet documents (the `pnpm pre-pr-lint --stage=full` set is equally pinned), and to which CI jobs the manifest intentionally omits (the env-dependent allowlist's enumeration in code and in the doc stay set-equal).

## Operator commands

```bash
# Default (fast stage — the daemon's gate; ~2 min target):
pnpm pre-pr-lint

# Full stage (run before pushing — what lefthook pre-push runs):
pnpm pre-pr-lint --stage=full

# Machine-readable output (one JSON line per step + a final summary):
pnpm pre-pr-lint --stage=full --json

# Self-diagnose the gate's drift signal (fires only with ≥10 daemon PRs in the rolling window):
node scripts/self-diagnose.mjs --json | jq '.[] | select(.id == "daemon-pr-lint-pass-rate")'
```

`pnpm pre-pr-lint` exits 0 iff every step passes. On failure, the script prints the failing step name + its stderr tail and exits non-zero — the daemon brief's three-attempt retry budget keys off this.

If a `pr-body.md` file is sitting at the repo root, the script auto-appends the three body-only checks (`pr-self-grade`, `pr-security-review`, `pr-vision-trace`) — same retry budget as the rest of the gate, no flag required. `--body=<other-path>` overrides the discovery. When no body file is found AND the operator did not pass `--json`, a one-line note prints to stderr listing the skipped gates and the `--body=<path>` invocation that enables them — closing the operator's local-vs-CI feedback gap that surfaced repeatedly across PRs #863, #869, #870 (body-only edits needing empty `chore(ci): retrigger` commits).

## Landing a local vetted branch (`land-local`)

The swarm's workers land only because they push from the `.claude/worktrees/<branch>` checkouts the orchestrator provisions. A fully-committed branch produced by a non-worktree contributor (an Opus-director keystone fix) is otherwise un-landable while the swarm runs: the live-tree pre-push gate flaps on concurrent churn, and an isolated `git worktree` has no `node_modules`. `--no-verify` is forbidden.

`land-local` generalises the orchestrator's proven PR scratch-vet (`local-gate-merge.mjs`) to a local ref — same isolated `git clone --shared` scratch with a real `pnpm install`, the same `--stage=full --json` deterministic gate, then push + open PR + admin-merge:

```bash
# Take a fully-committed local branch green through the scratch gate and land it:
node scripts/orchestrate.mjs land-local fix/picktask-priority-agent-teams-slice1

# Vet only (verdict printed; no push / PR / merge):
node scripts/orchestrate.mjs land-local <branch> --dry-run
```

A cheap `git rev-list --count origin/main..<branch>` preflight elides the ~20-min scratch vet for a branch with nothing ahead of `origin/main`. The deterministic gate is always the authority; an Opus brain review is wired in a follow-up (deterministic-only by default — `--no-review` parity with the sweep). Because GitHub Actions is disabled on this repo and the merge is `--admin`, the scratch `--stage=full` verdict is the gate, not GitHub.

## When the invariant fires

`scripts/self-diagnose.mjs` runs the `daemon-pr-lint-pass-rate` invariant on every supervisor tick. Below 0.8 (default; threshold pinned in slice 3/N), it returns an `Unmet` verdict with two named root causes and a TASKS.md task-block draft:

1. **Manifest drift** — the canonical script is missing a check that CI's `needs:` aggregator runs. Diff `STACK_MANIFEST` against `.github/workflows/ci.yml`'s `ci:` `needs:` list; the slice-5 drift test names the missing step. Add the entry.
2. **Brief skip** — the daemon brief's `pnpm pre-pr-lint` mandate is being elided. Inspect `novel/tick-loop/src/daemon.ts`'s `buildDaemonBrief` to confirm the directive is still emitted, and grep `.minsky/tick-loop.out.log` for the `pre-pr-lint-failures: <step>` noop-exit string.

If neither is the cause, the threshold may be too aggressive — pivot to a staged gate (fast lints pre-PR, slow lints CI-only) per the task block's documented Pivot, rather than retiring the invariant.

## Pivot threshold

If the full-stage stack ever exceeds 5 min wall-clock on a daemon iteration (the iteration's `claude --print` spawn budget is finite), pivot the daemon's gate to fast-only — the dormant `--stage=fast` flag is already there for this. The slow lints (`vitest`, the dormant caps) keep gating via CI as today. Pre-PR slow-lints are nice to have but not load-bearing; the fast ones close 80% of the failure modes, which is the pre-registered success threshold.
