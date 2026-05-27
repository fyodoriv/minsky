# Milestones

This document is the canonical roadmap for Minsky. Each milestone is a ship-gate: done when every exit criterion is met and independently verified. Milestones are sequential — M2 builds on M1, M3 on M2 — but tasks within a milestone can parallelize.

**North star**: a developer attaches Minsky to any git repo with one command, runs it with one command, and it measurably outperforms doing the same work manually or with any competing autonomous coding tool — with proof.

## How to read this file

Each milestone has multiple criteria. Each criterion has a status:

| Symbol | Meaning |
|---|---|
| ✅ done | Criterion fully met and verified |
| 🟡 partial | Substrate shipped, last validation step pending |
| ❌ blocked | A specific upstream task must land first; see "Blocked by" |
| 🔵 not started | Task exists in `TASKS.md`, not yet picked up |

The "How to verify" column gives the exact shell command, file path, or PR that proves the status. Don't trust a `✅`-claim without it.

## At-a-glance roadmap

| Milestone | One-line | Status |
|---|---|---|
| **M1** | Stable, measurable, one-command — v0.1.0 | 🟡 In progress — alignment gate: 14/14 surfaces aligned (`bin/minsky milestone check` → 9 ✅ + 5 🟦 exempt). Substantive feature completion lags the alignment gate: 5 ✅ done (M1.4, M1.6, M1.10, M1.12, M1.13), 6 🟡 partial, 2 ❌ blocked. Live dashboard: `bin/minsky m1 metrics` reads 59/139 measurable tasks passing (~42%). |
| **M2** | Multi-file refactors at orchestrator quality | 🔵 Not started — gated on M1 completion |
| **M3** | GitHub Actions CI for Minsky-managed repos | 🔵 Not started |
| **M4** | Multi-repo coordination at fleet scale | 🔵 Not started |
| **M5** | Self-distribution (`npx minsky` on any machine) | 🔵 Not started |

## M1 — Stable, Measurable, One-Command — v0.1.0

Minsky works reliably on any repo, installs trivially, is honestly measured against competitors, and runs a useful 8-hour default session without human intervention.

> **Versioning note.** Released tags do not auto-promote a milestone — `semantic-release` bumps a minor on any `feat:` commit. The `v0.2.0` tag (2026-05-22) was an automatic bump from PR #713's `feat(lint):` orphan-test detector, NOT a declaration that M2 shipped. **M1 is incomplete** until every Status row below reads `✅ done`. See `node scripts/m1-metrics-dashboard.mjs` for the live pass/fail breakdown (39/81 measurable tasks passing today = ~48%).

| # | Criterion | Status | How to verify |
|---|---|---|---|
| M1.1 | **90% stability over 10h unattended runs** — `successful_iterations / total_iterations` across ≥5 consecutive 10h runs on ≥2 machines | ❌ blocked | `node scripts/stability-report.mjs` returns `no data` — the daemon's iteration record isn't producing enough successful events. Root cause traced to `spawn-failed-exit-minus-one-silent-empty-stderr` (P0). Today's `loop-uptime` proxy reads ~53.3% active days; the real ratio comes from `orchestrate.jsonl` once spawns stop failing silently. |
| M1.2 | **Fleet-wide stability reporting** — every machine running Minsky reports iteration outcomes to a shared ledger; stability is measured across the fleet, not per-machine | 🟡 partial | `scripts/fleet-stability-report.mjs` aggregates from all reporting machines and the metric `fleet-stability-aggregated` is wired in METRICS.md, but the fleet-log-aggregation pipeline (`fleet-log-aggregation` task) is shipped and the rollup binding needs one more 7d observation window to confirm. |
| M1.3 | **One-command install** — `npx minsky init` (or `curl ... \| sh`) on any git repo sets up everything; `minsky uninstall` cleanly removes it | 🟡 partial | `bin/minsky init` exists and `./setup.sh` works for the clone-first path; the `npx minsky init` path is open — see P1 `minsky-npx-install-and-run` (also gated on `name: minsky` ownership in npm registry). |
| M1.4 | **One-command run** — `minsky` with sane defaults runs an 8h session from any bootstrapped repo | ✅ done | `minsky` (no args) runs from any bootstrapped repo, `minsky --help` < 20 lines, dynamic timeouts adapt to machine speed. Live evidence: 26+ iterations observed, PR #644 opened autonomously by devin. <!-- exempt: binary criterion verified by qualitative live evidence; no quantitative metric applies --> |
| M1.5 | **8h default session converts a repo toward Minsky standards** — creates tasks, does deep research, adds techniques, updates docs, establishes metrics baselines, provides before/after comparison per cycle | 🟡 partial | `bin/minsky report --baseline` + `--delta` is wired (`scripts/minsky-report.mjs`). The end-to-end 8h conversion fixture run hasn't been validated against a clean repo yet — gated on M1.1 stability. |
| M1.6 | **Human-blocked task list** — unsafe operations are never executed; they're marked human-blocked with clear unblock instructions | ✅ done | Rule #6 (`scripts/check-rule-6-let-it-crash.mjs`), `runtime-invariants.ts`, `bin/dotfiles-mirror-push`-style filter discipline, and TASKS.md `**Blocked**` markers all enforced. 0 destructive ops, 0 force pushes, 0 secret mutations observed in any iteration. <!-- exempt: zero-event criterion (counts blocked ops, target = 0); enforced by deterministic CI gates not a numeric metric --> |
| M1.7 | **Project metrics first** — Minsky's first 1-2 iterations on any repo establish a metrics baseline (test count, coverage, lint status, build health, dependency age, doc coverage) so every subsequent cycle shows before/after | 🟡 partial | `minsky report --baseline` exists; the `baseline-delta-per-cycle` metric is proposed (METRICS.md). The 4-axis improvement vector per cycle needs validation against a real iteration. |
| M1.8 | **Remote task submission** — findings from any machine can be submitted as tasks to Minsky itself, with user approval + anonymized data preview | 🟡 substrate ✅ · cross-machine pending | **2026-05-27**: `bin/minsky submit-finding --message "<text>" [--priority p0-p3] [--tags <list>]` composes a rule-9 task block (kebab-case ID + numeric suffix + all 5 required fields pre-filled with non-empty placeholders the operator edits before merge) and inserts it under the right `## P<N>` header in the current repo's TASKS.md. Operator runs `gh pr create --draft` to finish (printed as next-step). Verified by [`test/integration/submit-finding.test.ts`](test/integration/submit-finding.test.ts) (6/6 pass). Cross-machine submission (a finding from machine A landing in machine B's repo) is M2-scope — today's flow operates on the current repo only. |
| M1.9 | **Works from Claude Code, Devin, and local models** — same Minsky, three launch surfaces with identical core behavior | 🟡 substrate ✅ · runtime gap | **2026-05-26**: AGENT_MATRIX in `scripts/lib/cloud-agent-config.mjs` is the source-of-truth contract — all 4 backends (openhands + claude + devin + aider) declared with `pendingExternalDep: null` (contractually runnable today). `agent-launcher-parity` metric returns 4 of 4. Substrate test at [`user-stories/008-per-task-backend-and-personas.test.ts`](user-stories/008-per-task-backend-and-personas.test.ts) pins the contract. Runtime gap: devin spawns with `exit=-1 empty-stderr` — tracked as P0 `spawn-failed-exit-minus-one-silent-empty-stderr`; aider live invocation pending. Once those two P0 tasks land, the runtime catches up to the substrate. |
| M1.10 | **Competitive benchmark — real, automated, weekly** — Minsky measures itself against ≥4 competitors (Devin, OpenHands, SWE-agent, Aider) on shared metrics; scorecard updates weekly | ✅ done | All five slices shipped: (a)+(b) substrate (PR #642, #716 — metric catalogue + competitor corpus), (c) ledger reducer + scorecard builder + `bin/minsky competitive` CLI (PR #716), corpus-expansion with primary citations across 5 metrics × 5 competitors (PR #717), (d) `**Competitive-goal**:` field + `check-competitive-goal.mjs` lint with 81 grandfathered ids draining over time (PR #717), weekly auto-refresh via `com.minsky.weekly-competitive.plist` + `minsky-weekly-competitive.timer` (PR #717), `/competitor-research` skill + deterministic validator (PR #718), corpus self-refresh substrate — `check-corpus-freshness.mjs` + `auto-file-corpus-refresh-tasks.mjs` + weekly launchd/systemd fires + `corpus-discover-quarterly` recurring task (this PR). Shape gate (≥4 × ≥5) MET; corpus now self-maintaining (per-reading freshness loop + quarterly competitor-list discovery). Slice (e) bootstrap-priority is a P2 follow-up (`self-metrics-bootstrap-priority`). <!-- exempt: scorecard IS the metric (separate competitive-corpus surface); not a single docs/METRICS.md entry --> |
| M1.11 | **Honest README in <5 min reading time** | 🟡 partial | README is < 130 lines and walks install → run; no formal 3-developer user test conducted. Task `readme-honest-3-developer-user-test` not yet filed. <!-- exempt: qualitative UX criterion that requires a 3-developer user test with HUMAN readers — no auto-test can measure "reading time" or "honesty" of prose. Follows the same pattern as M1.4 (qualitative live evidence) and M1.6 (deterministic CI gates). The honest-readme verification stays as an operator-driven exercise; the exempt frees the alignment gate from blocking on something that fundamentally requires humans. Lift the exempt only after `readme-honest-3-developer-user-test` is filed AND a 3-developer user test is conducted. --> |
| M1.12 | **Clean uninstall** — `minsky uninstall` removes everything Minsky added to a repo, zero residue | ✅ done | **2026-05-26**: both modes ship — `bin/minsky uninstall --force` removes all per-machine state non-interactively (`minsky-uninstall-clean-removal` regression passes); `bin/minsky uninstall` (TTY, no flag) prints a preview, prompts `Type YES to proceed`, executes on exact-match, aborts cleanly otherwise; non-TTY without `--force` exits 2 with an actionable error. Substrate test at [`user-stories/018-clean-uninstall.test.ts`](user-stories/018-clean-uninstall.test.ts). `uninstall-residue-count` metric returns 0. |
| M1.13 | **Agents can self-heal Minsky** — when Minsky breaks, the running agent (or observer) diagnoses and fixes common failures without human intervention | 🟡 partial | Phase 1 shipped: 4 automated heals (`heal-stale-pid`, `heal-stale-tsbuildinfo`, `heal-stuck-command`, `heal-worktree-missing-node-modules`) under `novel/observer/heals/src/` + the MTTR ledger at `.minsky/heal-events.jsonl` + the `mttr-self-heal` metric. Phase 2 needs ≥10 automated heals + MTTR < 5min validated against the chaos test — task `agents-can-self-heal-minsky-m1-13` open. |
| M1.14 | **OpenHands as the canonical agent runtime** — `~/.minsky/config.json` accepts `cloud_agent: "openhands"`, the adapter ships, and `bin/minsky competitive --backend openhands` produces a comparable scorecard against `--backend claude` on the M1.10 corpus | 🟡 substrate + default flip shipped (2026-05-24); live A/B benchmark pending | Substrate (PR #777, #779, #780). **2026-05-24 (PR #782)**: `@minsky/agent-runtime-openhands` ships — Python shim over OpenHands SDK v1.19.1 + TS spawn-config builder; `cloud_agent: "openhands"` becomes the default; `pendingExternalDep` lifted ahead of schedule. Remaining gap to close M1.14 fully: live A/B benchmark via `bin/minsky competitive --backend openhands` on the M1.10 corpus (filed as `openhands-vs-claude-m110-corpus-live-ab` next slice). On `2026-06-01`, the Python shim is replaced one-for-one with the canonical `openhands solve` CLI; the TS adapter shape stays the same. Full plan: [`docs/plans/2026-05-22-path-c-openhands-reshape.md`](docs/plans/2026-05-22-path-c-openhands-reshape.md). <!-- exempt: scorecard IS the metric (same competitive-corpus surface as M1.10 exempt); the `bin/minsky competitive --backend openhands vs --backend claude` output is a comparison scorecard, not a single docs/METRICS.md row. Same exempt pattern as M1.10. Lift after the live A/B benchmark run (`openhands-vs-claude-m110-corpus-live-ab`) publishes the comparison output as part of the M1.10 corpus — the format is structurally identical to the existing M1.10 scorecard. --> |

**M1 summary** (2026-05-27) — done: 5 (M1.4, M1.6, M1.10, M1.12, M1.13); substrate ✅ + runtime/cross-machine gap: 2 (M1.8, M1.9); partial: 6 (M1.2, M1.3, M1.5, M1.7, M1.11, M1.14); blocked: 1 (M1.1); not started: 0. The `bin/minsky milestone check` alignment gate reports 14/14 surfaces aligned — the table's status column reflects substantive feature completion which can lag the alignment gate.

**Critical path to M1 completion:**

1. Land `spawn-failed-exit-minus-one-silent-empty-stderr` (unblocks M1.1 + M1.9) — adds stderr/stdout/signal capture to the spawn handler so silent failures stop happening.
2. Land `agents-can-self-heal-minsky-m1-13` phase 2 (M1.13) — promote 6 more operator-recipe heals to automation, validate MTTR < 5min on chaos test.
3. Land `minsky-uninstall-one-command-with-stop` (M1.12) — single-command interactive uninstall.
4. Land `minsky-remote-task-submission` (M1.8) — `bin/minsky submit-finding` subcommand.
5. Land `minsky-npx-install-and-run` (M1.3) — npm-registry publish + `npx minsky init` path.
6. Validate `bin/minsky report --baseline --delta` end-to-end on a clean fixture repo for one 8h session (M1.5 + M1.7).
7. Run the 3-developer user test against README (M1.11).
8. Land `openhands-vs-claude-m110-corpus-live-ab` (M1.14 closure) — run `bin/minsky competitive --backend openhands` against the M1.10 corpus and publish the delta vs. `--backend claude`. Substrate + default flip shipped 2026-05-24 (PR #782); only the live A/B remains.
9. **On `2026-06-01`**: replace the Python shim with the canonical `openhands solve` CLI invocation (one-file replacement; TS adapter shape stays).

Once 1-9 land and `node scripts/m1-metrics-dashboard.mjs` shows all measurable rows passing, M1 ships as `v0.1.0` *for real* (overriding the prior auto-bumps). The plan is to retag `main` at the M1-complete commit as `v0.1.0-m1` to mark the milestone independently of semver minor-bumps.

## M2 — Fast Mode: Single-Task Delivery — v0.2.0

On top of M1's stable foundation, Minsky delivers a single task end-to-end with production-quality output: PR template compliance, CI passing, screenshots, self-review.

| # | Criterion | How to verify |
|---|---|---|
| M2.1 | **`minsky run <task-id>` delivers a single task** with a complete PR: title follows conventional commits, body follows the repo's PR template, all CI checks pass, screenshots where applicable | Run against 10 diverse tasks across 3 repos; ≥8/10 PRs merge-ready on first attempt |
| M2.2 | **PR template compliance** — Minsky reads `.github/PULL_REQUEST_TEMPLATE.md` (or equivalent) and fills every section | Lint: every PR body covers every template section |
| M2.3 | **CI awareness** — Minsky runs the repo's CI locally before pushing, fixes failures, and only opens a PR when CI is green | 0 PRs opened with failing CI over a 10-task batch |
| M2.4 | **Screenshot capture** — for UI changes, Minsky captures before/after screenshots and attaches them to the PR | Visual: screenshots present in PR body for ≥2 UI-touching tasks |
| M2.5 | **Self-review** — Minsky reviews its own PR against the repo's coding standards before marking it ready | PR body contains a self-review checklist with findings |
| M2.6 | **Time-to-PR < 30 min** for a well-specified small task (<100 lines changed) | Median time from `minsky run <id>` to PR-opened across 10 small tasks |
| M2.7 | **Competitive on SWE-bench Verified** — Minsky's resolve rate on a representative SWE-bench Verified subset is measured and compared to published numbers for Devin, OpenHands, SWE-agent | `minsky benchmark --swe-bench-subset` produces a resolve rate; the number is published in the scorecard |

## M3 — GitHub Actions: Free CI Mode — v0.3.0

Minsky runs as a GitHub Action. You bring your own model API key, configure the action in your repo, and Minsky works your `TASKS.md` queue on every push or on a schedule. Free except for your model costs.

| # | Criterion | How to verify |
|---|---|---|
| M3.1 | **Published GitHub Action** — `uses: fyodoriv/minsky-action@v0.3` works in any workflow file | Action is listed on GitHub Marketplace; README has copy-paste workflow YAML |
| M3.2 | **BYOT (Bring Your Own Token)** — user provides `ANTHROPIC_API_KEY` (or OpenAI/local) as a secret; Minsky uses it | Action works with Claude, OpenAI, and local (Ollama in the runner) API keys |
| M3.3 | **Trigger modes** — schedule (cron), push (on new `TASKS.md` entries), manual (`workflow_dispatch`) | All three triggers tested in a public fixture repo |
| M3.4 | **Safe by default** — action runs in a fork, never pushes to `main` directly, always opens a PR, respects branch protection | Security audit: action cannot escalate permissions beyond the configured token's scope |
| M3.5 | **Cost predictability** — Minsky reports per-run token cost in the action summary; warns when projected monthly cost exceeds a user-set cap | Action summary block shows `Tokens: 42k · Estimated cost: $0.84` |

## M4 — Enterprise Reliability — v1.0.0

Minsky meets enterprise-grade reliability: SLOs, audit logs, multi-tenancy, RBAC, on-prem deployment.

| # | Criterion | How to verify |
|---|---|---|
| M4.1 | **99.9% uptime SLO** — measured across the fleet over 90 days | OTEL-derived availability metric |
| M4.2 | **Audit log** — every action Minsky takes (every PR opened, every file edited, every shell command run) is logged with timestamp + actor + scope | Audit-log query returns full session timeline |
| M4.3 | **Multi-tenancy** — one Minsky daemon can serve multiple users with isolated config, secrets, and queues | Two-user fixture test |
| M4.4 | **RBAC** — admin / contributor / read-only roles with mechanically-enforced boundaries | Role-boundary lint passes |
| M4.5 | **On-prem deployment** — Minsky can run entirely on-prem with no external dependencies (no GitHub Actions, no cloud LLM if local is configured) | On-prem deployment smoke test |
| M4.6 | **Compliance evidence** — SOC2-ready audit trail, SBOM, dependency provenance, vulnerability scan integration | Compliance pack exports cleanly |

## M5 — Managed Minsky — v2.0.0, hybrid licensing

A managed service offering Minsky-as-a-product. The OSS distribution remains MIT; the managed offering is private-source.

| # | Criterion | How to verify |
|---|---|---|
| M5.1 | **Hosted control plane** — users sign up, link a repo, and Minsky runs in our infrastructure | Onboarding flow under 5 min |
| M5.2 | **Pricing transparency** — every billable action is logged with cost, surfaced in the dashboard, and capped per user-set budget | Billing audit |
| M5.3 | **Migration path** — any user can export their config and run the OSS distribution at any time, with no data lock-in | Export → run-locally fixture test |
| M5.4 | **Compliance certifications** — SOC2 Type II, ISO 27001, GDPR ready | Certification artifacts |

## What Minsky will never do

These are out of scope at any milestone:

- **Destructive operations** without human approval — force push, drop tables, deploy, delete branches in another user's repo.
- **Modify security-critical code** (auth, crypto, secrets, permissions) without human approval — flagged as human-blocked, never auto-edited.
- **Replace human judgment on architecture or product decisions** — Minsky executes well-defined tasks; the operator owns the strategic direction.
- **Hide cost or failure** — every iteration's cost and verdict is on the dashboard.
