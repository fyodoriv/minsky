# Where minsky went

<!-- pattern: not-applicable — archive ledger, no runtime artefact -->

minsky is archived. Its useful parts now live in three repos:

- [agentbrew](https://github.com/fyodoriv/agentbrew): skills, docs, lint tasks.
- [dotfiles](https://github.com/fyodoriv/dotfiles): launchd skill, machine docs, git tasks.
- [tasks.md](https://github.com/fyodoriv/tasks.md): TASKS.md lint rules and fleet tasks.

Everything else was dropped. Most of it is the orchestrator itself (daemon,
tick loop, personas, OpenHands adapters, benchmarks). Nothing in those repos
needs this checkout to run.

Each row below gives one item a destination or a drop reason.
`scripts/check-ledger.py` fails when a tracked item has no row.

PRs: [agentbrew#1120](https://github.com/fyodoriv/agentbrew/pull/1120) · [dotfiles#770](https://github.com/fyodoriv/dotfiles/pull/770) · [tasks.md#51](https://github.com/tasksmd/tasks.md/pull/51).

## Skills (`.claude/skills`)

| Item | Disposition |
|---|---|
| `.claude/skills/karpathy-disciplines` | Ported: agentbrew `skill-plugins/workflow/karpathy-disciplines` |
| `.claude/skills/launchd-safe-paths` | Ported: dotfiles `skills/launchd-safe-paths` |
| `.claude/skills/live-fire-smoke` | Merged: stripped-env smoke step in dotfiles `skills/launchd-safe-paths` |
| `.claude/skills/cli-consolidation` | Merged: agentbrew `workflow/cli-design` |
| `.claude/skills/incremental-implementation` | Merged: agentbrew `workflow/writing-plans` |
| `.claude/skills/poll-merge` | Merged: agentbrew `workflow/grind` |
| `.claude/skills/pr-merge-no-shortcuts` | Merged: agentbrew `workflow/grind` |
| `.claude/skills/reader-priority-docs` | Merged: agentbrew `workflow/readme` |
| `.claude/skills/caveman` | Duplicate: agentbrew `workflow/caveman` |
| `.claude/skills/diagnose` | Duplicate: installed `systematic-debugging` |
| `.claude/skills/doubt-driven-development` | Duplicate: installed `doubt-driven-development` (richer) |
| `.claude/skills/spec-driven-development` | Duplicate: installed `spec-driven-development` (richer) |
| `.claude/skills/improve-codebase-architecture` | Duplicate: installed `improve-codebase-architecture` |
| `.claude/skills/grill-task` | Duplicate: installed `grill-with-docs` |
| `.claude/skills/task-slice` | Duplicate: agentbrew `workflow/to-issues` + `writing-plans` |
| `.claude/skills/task-spec` | Duplicate: Given-When-Then in installed `spec-driven-development` |
| `.claude/skills/triage` | Duplicate: installed `review-tasks` |
| `.claude/skills/worktree-handoff` | Duplicate: agentbrew `workflow/handoff` |
| `.claude/skills/zoom-out` | Duplicate: installed `improve-codebase-architecture` |
| `.claude/skills/competitor-research` | Duplicate: agentbrew `companion-competitor-watch`, `competitor-spot-check` |
| `.claude/skills/brief-engineering` | Dropped: builds orchestrator worker briefs |
| `.claude/skills/ci-gate-check` | Dropped: minsky CI jobs; `verify` covers the need |
| `.claude/skills/experiment-validate` | Dropped: minsky experiment files |
| `.claude/skills/minsky-supervisor` | Dropped: minsky service control |
| `.claude/skills/openhands-shim-knobs` | Dropped: OpenHands wrapper |

## Scripts (`scripts/`)

| Item | Disposition |
|---|---|
| `scripts/auto-merge-clean-prs*` | Duplicate: tasks.md `fleet` auto-merge |
| `scripts/auto-rebase-dirty-prs*` | Task: tasks.md `fleet rebase` |
| `scripts/auto-close-orphan-prs*` | Task: tasks.md safe orphan-PR close |
| `scripts/verify-pr-closure-is-lossless*` | Task: tasks.md safe orphan-PR close |
| `scripts/sweep-stale-*` | Task: tasks.md `tasks sweep-stale` |
| `scripts/tasks-md-*` | Task: tasks.md `tasks sweep-stale` |
| `scripts/check-no-delivered-retained-blocks*` | Ported: tasks.md lint rule for DELIVERED blocks |
| `scripts/check-touches-field*` | Task: tasks.md lint rules |
| `scripts/check-task-block-citations*` | Task: tasks.md lint rules |
| `scripts/check-ui-tasks-priority*` | Task: tasks.md lint rules |
| `scripts/check-rule-9-*` | Duplicate: tasks.md `packages/lint/src/rule9.ts` |
| `scripts/check-no-hardcoded-user-paths*` | Task: agentbrew privacy lints |
| `scripts/check-no-personal-paths-in-docs*` | Task: agentbrew privacy lints |
| `scripts/check-no-corporate-refs*` | Duplicate: agentbrew leak gates (oss-readiness pattern) |
| `scripts/check-privacy-data-egress*` | Task: agentbrew privacy lints |
| `scripts/check-otel-no-pii*` | Task: agentbrew privacy lints |
| `scripts/scan-secrets*` | Duplicate: gitleaks + agentbrew leak gates |
| `scripts/check-filename-casing*` | Task: agentbrew repo-hygiene lint pack |
| `scripts/check-orphan-tests*` | Task: agentbrew repo-hygiene lint pack |
| `scripts/check-test-file-colocation*` | Task: agentbrew repo-hygiene lint pack |
| `scripts/check-no-repo-root-install-in-tests*` | Task: agentbrew repo-hygiene lint pack |
| `scripts/check-no-hardcoded-timeouts*` | Task: agentbrew flake checks |
| `scripts/check-rule-11-*` | Task: agentbrew flake checks; thresholds in agentbrew `docs/ci.md` |
| `scripts/gh-actions-flake-tracker*` | Task: agentbrew flake checks |
| `scripts/check-agents-md-coherence*` | Task: agentbrew doc-quality lints |
| `scripts/check-docs-frame-coherence*` | Task: agentbrew doc-quality lints |
| `scripts/check-doc-why-first-paragraph*` | Task: agentbrew doc-quality lints |
| `scripts/check-readme-byte-budget*` | Task: agentbrew doc-quality lints |
| `scripts/check-deprecated-md-respect*` | Task: agentbrew doc-quality lints |
| `scripts/check-skill-*` | Task: agentbrew doc-quality lints |
| `scripts/check-pre-push-hook-fast*` | Task: agentbrew pre-push under 10 s |
| `scripts/dependabot-triage*` | Task: agentbrew `dependabot-triage-helper` |
| `scripts/check-no-no-verify-bypass*` | Task: dotfiles git shim refuses `--no-verify` |
| `scripts/check-bot-commit-hook-bypass*` | Task: dotfiles git shim refuses `--no-verify` |
| `scripts/check-launchd-safe-paths*` | Task: dotfiles launchagent drift check |
| `scripts/check-gitattributes-mergiraf*` | Task: dotfiles mergiraf merge driver |
| `scripts/setup-mergiraf*` | Task: dotfiles mergiraf merge driver |
| `scripts/measure-ollama-idle-memory*` | Task: dotfiles local AI bench |
| `scripts/check-lockfile-*` | Duplicate: agentbrew lockfile checks |
| `scripts/check-pr-vision-trace*` | Duplicate: agentbrew `scripts/check-pr-vision-trace.mjs` |
| `scripts/check-rule-3-*` | Duplicate: agentbrew `check-rule-3-test-first.mjs` |
| `scripts/check-claude-hooks-installed*` | Duplicate: dotfiles doctor + agentbrew checkup |
| `scripts/check-toolchain*` | Duplicate: dotfiles doctor |
| `scripts/install-lefthook-*` | Duplicate: dotfiles git doctor |
| `scripts/post-merge-*` | Dropped: general repo hygiene, outside tasks.md scope |
| `scripts/worktree-*` | Duplicate: agentbrew `worktree-deps.sh` |
| `scripts/bash-doctor-probes*` | Duplicate: dotfiles doctor |
| `scripts/block-dangerous-bash*` | Duplicate: dotfiles git-safe / shims |
| `scripts/git-*` | Duplicate: dotfiles git-safe / shims |
| `scripts/capture-failure*` | Dropped: orchestrator failure capture |
| `scripts/lint-*` | Duplicate: agentbrew `lint-changed.sh` / `verify-changed.sh` |
| `scripts/local-gate-*` | Duplicate: agentbrew `verify-changed.sh` |
| `scripts/run-pre-pr-*` | Duplicate: agentbrew `verify-changed.sh` |
| `scripts/changelog-*` | Dropped: minsky changelog tooling |
| `scripts/check-changelog-*` | Dropped: minsky changelog gate |
| `scripts/generate-*` | Dropped: minsky metrics and changelog generators |
| `scripts/check-*` | Dropped: remaining checks enforce minsky's own vision rules, orchestrator internals, benchmarks, or minsky layout |
| `scripts/chaos-*` | Dropped: orchestrator chaos tests |
| `scripts/runany-*` | Dropped: orchestrator model routing |
| `scripts/minsky-*` | Dropped: minsky entry points |
| `scripts/measure-*` | Dropped: orchestrator measurements |
| `scripts/stability-*` | Dropped: orchestrator stability metrics |
| `scripts/throughput*` | Dropped: orchestrator throughput |
| `scripts/m1-*` | Dropped: milestone tracking |
| `scripts/cto-*` | Dropped: orchestrator audits |
| `scripts/aggregate-*` | Dropped: orchestrator audits |
| `scripts/audit-*` | Dropped: orchestrator audits |
| `scripts/metric*` | Duplicate: agentbrew `metrics.sh`, dotfiles-metrics |
| `scripts/collect-*` | Duplicate: agentbrew `metrics.sh` |
| `scripts/daily-*` | Dropped: daemon metrics timer |
| `scripts/daemon-*` | Dropped: daemon |
| `scripts/heal-*` | Duplicate: dotfiles heal-stuck-agents |
| `scripts/self-*` | Dropped: orchestrator self-diagnose |
| `scripts/watchdog*` | Duplicate: dotfiles network-watchdog |
| `scripts/kill-*` | Dropped: orchestrator iterations |
| `scripts/restart-*` | Dropped: orchestrator supervisor |
| `scripts/error-*` | Dropped: orchestrator error reporter |
| `scripts/orchestrate*` | Dropped: orchestrator loop |
| `scripts/spawn*` | Dropped: orchestrator loop |
| `scripts/pick*` | Duplicate: tasks.md `next` + `watch-issues` skill |
| `scripts/cost*` | Dropped: orchestrator cost tiers |
| `scripts/dynamic*` | Dropped: orchestrator timeouts |
| `scripts/build*` | Dropped: orchestrator briefs |
| `scripts/extract*` | Dropped: orchestrator helpers |
| `scripts/gh*` | Dropped: orchestrator GitHub task source |
| `scripts/resolve*` | Dropped: orchestrator host resolution |
| `scripts/benchmark*` | Dropped: benchmarks |
| `scripts/competitor*` | Dropped: competitor corpus |
| `scripts/auto-file-*` | Dropped: competitor corpus |
| `scripts/experiment*` | Dropped: experiments |
| `scripts/replay*` | Dropped: benchmarks |
| `scripts/synth*` | Dropped: benchmarks |
| `scripts/transform*` | Dropped: `minsky transform` |
| `scripts/omc*` | Dropped: orchestrator bridge |
| `scripts/proof*` | Dropped: minsky README proof |
| `scripts/path-*` | Dropped: minsky migration phases |
| `scripts/render*` | Dropped: run reports |
| `scripts/run*` | Dropped: run reports |
| `scripts/export*` | Dropped: run reports |
| `scripts/observer*` | Dropped: run observer |
| `scripts/usage*` | Dropped: run telemetry |
| `scripts/telemetry*` | Dropped: run telemetry |
| `scripts/user-*` | Dropped: minsky user tests |
| `scripts/submit*` | Dropped: `minsky submit-finding` |
| `scripts/iteration*` | Dropped: orchestrator iterations |
| `scripts/drain*` | Dropped: orchestrator queue |
| `scripts/compute*` | Dropped: orchestrator metrics |
| `scripts/classify*` | Dropped: orchestrator helpers |
| `scripts/baseline*` | Dropped: orchestrator baseline |
| `scripts/agent-*` | Dropped: minsky agent-guide test |
| `scripts/install-*` | Dropped: minsky install tests |
| `scripts/snapshot*` | Dropped: minsky install snapshot |
| `scripts/llm-*` | Dropped: orchestrator provider throughput |
| `scripts/local-*` | Dropped: orchestrator local fallback |
| `scripts/full-*` | Dropped: orchestrator gate runner |
| `scripts/fleet*` | Duplicate: tasks.md `fleet` |
| `scripts/cross-*` | Dropped: cross-repo runner |
| `scripts/cloud-*` | Dropped: cloud agent matrix |
| `scripts/verify-*` | Dropped: orchestrator verifiers |
| `scripts/setup-*` | Dropped: minsky setup helpers |
| `scripts/scan-*` | Duplicate: agentbrew leak gates |
| `scripts/biome*` | Dropped: minsky lint config test |
| `scripts/glossary*` | Dropped: minsky glossary |
| `scripts/tsconfig*` | Dropped: support file |
| `scripts/lib` | Dropped: support files |
| `scripts/fixtures` | Dropped: support files |
| `scripts/*` | Dropped: any other script is orchestrator support |

## Packages (`novel/`)

| Item | Disposition |
|---|---|
| `novel/tick-loop` | Dropped: orchestrator core loop |
| `novel/mape-k-loop` | Dropped: orchestrator self-adaptation; MAPE-K citation kept in agentbrew docs |
| `novel/observer` | Dropped: run observer |
| `novel/dashboard-*` | Dropped: minsky dashboard |
| `novel/cross-repo-runner` | Dropped: orchestrator runner; tasks.md `fleet` covers multi-repo |
| `novel/human-loop` | Duplicate: agentbrew handoff / wrap-up |
| `novel/personas` | Dropped: orchestrator personas |
| `novel/claude-handoff-spec` | Duplicate: agentbrew `workflow/handoff` |
| `novel/experiment-record` | Dropped: experiments |
| `novel/competitive-benchmark` | Dropped: competitor corpus |
| `novel/adapters/agent-runtime-openhands` | Dropped: OpenHands |
| `novel/adapters/sandbox` | Dropped: orchestrator sandbox |
| `novel/adapters/a2a` | Dropped: orchestrator protocol |
| `novel/adapters/mcp` | Dropped: orchestrator MCP adapter |
| `novel/adapters/ollama` | Duplicate: agentbrew `local-llm-warmup`, dotfiles local-ai |
| `novel/adapters/prompt-optimizer` | Dropped: orchestrator |
| `novel/adapters/observability` | Dropped: orchestrator |
| `novel/adapters/notifier` | Dropped: orchestrator |
| `novel/adapters/token-monitor` | Duplicate: dotfiles agent-usage-guard |
| `novel/adapters/types` | Dropped: shared types |
| `novel/adapters` | See rows above |

## Commands (`bin/`)

| Item | Disposition |
|---|---|
| `bin/minsky-ollama` | Duplicate: agentbrew `local-llm-warmup` |
| `bin/*` | Dropped: minsky CLI, installer, run loop, budget watchdog, persona pipeline |

## Docs (`docs/`)

| Item | Disposition |
|---|---|
| `docs/PRACTICES.md` | Merged: "Evidence base" in agentbrew `docs/editing-rules.md` |
| `docs/metrics-discipline.md` | Merged: agentbrew `docs/metrics.md` invariants + no-vanity guard |
| `docs/rule-11-flake-detection.md` | Merged: agentbrew `docs/ci.md` flake thresholds |
| `docs/machine-budget.md` | Merged: dotfiles `docs/module-reference.md` CPU budget |
| `docs/conflict-auto-resolution.md` | Task: dotfiles mergiraf merge driver |
| `docs/research-hooks-vs-rules-2026-05-27.md` | Duplicate: agentbrew `docs/research/hooks-over-agents-md.md` |
| `docs/dependency-policy.md` | Duplicate: agentbrew Dependabot docs |
| `docs/dependabot.md` | Duplicate: agentbrew Dependabot docs |
| `docs/local-llm-fallback.md` | Duplicate: dotfiles `docs/local-llm.md` |
| `docs/*` | Dropped: orchestrator architecture, runbooks, metrics, research and plans |

## Repo root

| Item | Disposition |
|---|---|
| `absorbed.md` | This file |
| `TASKS.md` | See "Open tasks" below |
| `lefthook.yml` | Merged: piped + toolchain-first into agentbrew `new-project` lefthook template |
| `vision.md` | Duplicate: rules 1, 3, 9, 10 in dotfiles constitution and tasks.md spec |
| `README.md` | Archive notice pointing here |
| `AGENTS.md` | Archive notice pointing here |
| `CLAUDE.md` | Link to AGENTS.md |
| `.claude` | See "Skills" above |
| `skill-plugins` | Dropped: minsky observer plugin; `grind` and `watch-issues` cover it |
| `scripts` | See "Scripts" above |
| `novel` | See "Packages" above |
| `bin` | See "Commands" above |
| `docs` | See "Docs" above |
| `templates` | Duplicate: `detect-task-backend` covers task source choice |
| `Agentfile.yaml` | Dropped: listed only minsky skills |
| `*` | Dropped: minsky build config, data, experiments, research, competitors, tests, fixtures, user stories, release files |

## Open tasks (`TASKS.md`)

Kept as tasks elsewhere (general wins only):

| Task | Disposition |
|---|---|
| `stale-delivered-block-ci-gate` | Ported: tasks.md lint rule for DELIVERED blocks |
| `investigate-claude-native-task-standard` | Task: tasks.md native task list research |
| `revisit-claude-native-task-standard-when-persistence-fixed` | Task: tasks.md native task list research |
| `omc-tasksmd-issue` | Task: tasks.md OMC adoption lead |
| `pre-push-hook-stays-fast` | Task: agentbrew pre-push under 10 s |
| `docs-operator-troubleshooting-prompt-too-long` | Merged: agentbrew `docs/measure-context-budget.md` |
| `fake-data-and-deprecation-marker-discipline` | Task: agentbrew `// FAKE:` marker rule |

Every other open task is dropped. Each one is orchestrator, daemon, worker,
persona, benchmark, competitor corpus, OpenHands, npx install, milestone, or
minsky-repo hygiene work, which ends with the archive.
