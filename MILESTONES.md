# Milestones

Minsky's roadmap. Each milestone is a ship-gate: done when every exit criterion is met and independently verified. Milestones are sequential — M2 builds on M1, M3 on M2 — but tasks within a milestone can parallelize.

**North star**: a developer attaches Minsky to any git repo with one command, runs it with one command, and it measurably outperforms doing the same work manually or with any competing autonomous coding tool — with proof.

## M1 — Stable, Measurable, One-Command — v0.1.0

Minsky works reliably on any repo, installs trivially, is honestly measured against competitors, and runs a useful 8-hour default session without human intervention.

| # | Criterion | How to verify |
|---|---|---|
| M1.1 | **90% stability over 10h unattended runs** — `successful_iterations / total_iterations` across ≥5 consecutive 10h runs on ≥2 machines | `.minsky/orchestrate.jsonl` → `scripts/stability-report.mjs` computes the ratio |
| M1.2 | **Fleet-wide stability reporting** — every machine running Minsky reports iteration outcomes to a shared ledger; stability is measured across the fleet, not per-machine | `scripts/fleet-stability-report.mjs` aggregates from all reporting machines |
| M1.3 | **One-command install** — `npx minsky init` (or `curl ... \| sh`) on any git repo sets up everything; `minsky uninstall` cleanly removes it | Fresh Ubuntu + macOS VM: run the command, verify `minsky doctor` is GREEN with zero prior setup (Node ≥20 only) |
| M1.4 | **One-command run** — `minsky` with sane defaults runs an 8h session from any bootstrapped repo | `minsky` runs 8h of useful work; `minsky --help` is <20 lines |
| M1.5 | **8h default session converts a repo toward Minsky standards** — creates tasks, does deep research, adds techniques, updates docs, establishes metrics baselines, provides before/after comparison per cycle | A fixture repo goes from 0 tasks → populated `TASKS.md` + metrics baseline + docs improvements after one 8h run; `minsky report` shows before/after delta |
| M1.6 | **Human-blocked task list** — unsafe operations are never executed; they're marked human-blocked with clear unblock instructions | Audit: 0 destructive filesystem ops, 0 force pushes, 0 secret mutations in any 8h run; blocked items in `TASKS.md` carry `**Blocked**: needs-human-action — <reason>` |
| M1.7 | **Project metrics first** — Minsky's first 1-2 iterations on any repo establish a metrics baseline (test count, coverage, lint status, build health, dependency age, doc coverage) so every subsequent cycle shows before/after | `minsky report --baseline` shows the snapshot; `minsky report --delta` shows improvement since baseline |
| M1.8 | **Remote task submission** — findings from any machine can be submitted as tasks to Minsky itself, with user approval + anonymized data preview | `minsky submit-finding --to minsky` shows what will be sent, asks for approval, submits |
| M1.9 | **Works from Claude Code, Devin, and local models** — same Minsky, three launch surfaces with identical core behavior | `MINSKY_CLOUD_AGENT=claude minsky`, `MINSKY_CLOUD_AGENT=devin minsky`, `minsky --local` all complete a fixture task and produce a PR |
| M1.10 | **Competitive benchmark — real, automated, weekly** — Minsky measures itself against ≥4 competitors (Devin, OpenHands, SWE-agent, Aider) on shared metrics; scorecard updates weekly | `minsky benchmark` produces `competitive-scorecard.json` with Minsky + ≥4 competitors × ≥5 DORA/agentic metrics; the scorecard is <7 days old |
| M1.11 | **Honest README in <5 min reading time** | User test: 3 developers who've never seen Minsky can install and run it following only the README, <5 min from clone to first iteration |
| M1.12 | **Clean uninstall** — `minsky uninstall` removes everything Minsky added to a repo, zero residue | After uninstall: `git status` clean, no leftover config, no modified tracked files, daemon stopped |
| M1.13 | **Agents can self-heal Minsky** — when Minsky breaks, the running agent (or observer) diagnoses and fixes common failures without human intervention | Observer skill catalogs ≥10 failure modes with automated fixes; MTTR for catalogued failures < 5 min |

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
