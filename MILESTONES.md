# Milestones

> Minsky's product roadmap. Each milestone is a ship-gate: the milestone is done when every exit criterion is met and independently verified. Milestones are sequential — M2 builds on M1, M3 on M2, etc. — but tasks within a milestone may parallelize.

**North star**: a developer installs minsky on any repo with one command, runs it with one command, and it measurably outperforms doing the same work manually or with any competing autonomous coding tool — with proof.

---

## Current state (2026-05-18 baseline)

| Signal | Value | Assessment |
|---|---|---|
| Version | `0.0.0` (pre-alpha) | No release yet |
| Open tasks | 129 across P0–P3 | Overwhelming; no milestone alignment |
| Tests | 3,135 passing / 180 files | Strong foundation |
| METRICS.md | 10/10 entries are stubs | Nothing actually measured |
| Stability (10h daemon run) | Commit hooks break fleet-wide; merge gate false negatives; token limit crashes daemon; GH auth divergence silently kills merging | Fragile for unattended use |
| Install experience | `git clone` + `pnpm install` + `./setup.sh` + manual env vars + OMC plugin install + per-machine config | Too many steps |
| Run experience | `pnpm minsky` works from repo root; `minsky` PATH shim exists but requires prior setup | Close but not one-command |
| Documentation | Thorough but dense (23KB README, 26KB ARCHITECTURE, 1.2MB vision.md) | Impressive for insiders; impenetrable for newcomers |
| Competitive benchmarks | 0 — no measured comparison vs any competitor | Flying blind |
| Competitor coverage | OMC, CrewAI, MetaGPT, MS Agent Framework, Composio AO | Missing the real competitors: **Devin, OpenHands, SWE-agent, Aider, Cursor Agent** |
| Agent support | Claude Code, Devin (experimental), aider/local | Good breadth, inconsistent depth |
| CI | GitHub Actions disabled ($10/mo cap); local merge gate replaces it | Works but unconventional |

---

## M1 — Stable, Measurable, One-Command (target: v0.1.0)

> **Theme**: Minsky works reliably on any repo, is trivially installable, honestly measured against competitors, and runs a useful 8-hour default session without human intervention.

### Exit criteria

| # | Criterion | How to verify | Current gap |
|---|---|---|---|
| 1 | **90% stability over 10h unattended runs** — measured as `successful_iterations / total_iterations` across ≥5 consecutive 10h runs on ≥2 machines | Automated: `.minsky/orchestrate.jsonl` ledger → `scripts/stability-report.mjs` computes the ratio | Commit hooks break fleet (P0), merge false negatives (P1), token crash (P1), GH auth divergence (P1) — stability is ~40-60% today |
| 2 | **Centralized stability reporting** — every machine running minsky reports iteration outcomes to a shared ledger so stability is measured across the fleet, not per-machine | `scripts/fleet-stability-report.mjs` aggregates from all reporting machines | No centralized reporting exists |
| 3 | **One-command install** — `npx minsky init` (or `curl ... \| sh`) on any git repo sets up everything; `minsky uninstall` cleanly removes it | Fresh Ubuntu + macOS VM: run the command, verify `minsky doctor` is GREEN with zero prior setup (except Node ≥20) | Today requires clone + pnpm install + setup.sh + manual config + plugin install |
| 4 | **One-command run** — `minsky` with sane defaults runs an 8h session | `minsky` from any bootstrapped repo runs 8h of useful work; `minsky --help` shows <20 lines | Works from repo root; doesn't work from arbitrary repos without prior setup |
| 5 | **8h default session behavior** — converts any repo toward minsky standards: creates tasks, does deep research, adds techniques, updates docs, adds project metrics, provides before/after comparison per cycle | A fixture repo goes from 0 tasks → populated TASKS.md + metrics baseline + docs improvements after one 8h run; `minsky report` shows before/after delta | Cross-repo runner exists but the "convert to minsky standards" default workflow doesn't |
| 6 | **Human-blocked task list** — unsafe/dangerous operations are never executed; instead they're marked as human-blocked with clear unblock instructions | Audit: no filesystem destructive ops, no force pushes, no secret mutations in any 8h run; blocked items appear in TASKS.md with `**Blocked**: needs-human-action — <reason>` | Partially implemented (some tasks have Blocked field) but no systematic enforcement |
| 7 | **Project metrics first** — minsky's first 1-2 iterations on any repo establish a metrics baseline (test count, coverage, lint status, build health, dependency age, doc coverage) so every subsequent cycle shows before/after | `minsky report --baseline` shows the snapshot; `minsky report --delta` shows improvement since baseline | METRICS.md is all stubs; no per-repo baseline mechanism |
| 8 | **Remote task submission** — findings from any machine can be submitted as tasks to minsky itself (with user approval + anonymized data preview) | `minsky submit-finding --to minsky` shows what will be sent, asks for approval, submits | No remote submission exists |
| 9 | **Works from Claude Code, Windsurf (Devin), and local models** — same minsky, three launch surfaces with identical core behavior | `MINSKY_CLOUD_AGENT=claude minsky`, `MINSKY_CLOUD_AGENT=devin minsky`, `minsky --local` all complete a fixture task and produce a PR | Claude + Devin partially working; local mode bootstraps but iteration quality untested |
| 10 | **Competitive benchmark — real, automated, weekly** — minsky measures itself against ≥4 competitors (Devin, OpenHands, SWE-agent, Aider) on shared metrics; scorecard updates weekly | `minsky benchmark` produces `competitive-scorecard.json` with minsky + ≥4 competitors × ≥5 DORA/agentic metrics; the scorecard is <7 days old | Zero competitive measurement exists |
| 11 | **Honest README in <5 min reading time** — a new developer reads the README, understands what minsky does, how to install it, what it costs, and how it compares to alternatives — in under 5 minutes | User test: 3 developers who've never seen minsky can install and run it following only the README; <5 min from clone to first iteration | README is 23KB (~15 min read); installation requires reading multiple files |
| 12 | **Clean uninstall** — `minsky uninstall` removes everything minsky added to a repo with zero residue | After uninstall: `git status` clean, no leftover config, no modified tracked files, daemon stopped | No uninstall command exists |
| 13 | **Agents can self-heal minsky** — when minsky breaks, the running agent (or observer) can diagnose and fix common failures without human intervention | Observer skill catalogs ≥10 failure modes with automated fixes; MTTR for catalogued failures < 5 min | Observer exists but limited failure catalog |

### Key tasks (map from existing TASKS.md)

**Stability (must-fix before anything else):**

- `commit-hook-chain-node-version-and-platform-resilience` (P0) → M1.1
- `orchestrator-must-land-local-vetted-branches` (P0) → M1.1
- `runtime-token-limit-auto-pivot-local-and-back` (P0) → M1.1
- `local-gate-merge-false-negative-on-worktree-bound-branch-delete` (P1) → M1.1
- `tick-loop-transient-gh-401-must-not-crash-daemon` (P1) → M1.1
- `budget-guard-correctness` (P1) → M1.1
- `orchestrator-gh-graphql-401-token-source-divergence` (P1) → M1.1

**Measurement & benchmarks:**

- `self-metrics-competitive-benchmark` (P0) → M1.10
- All METRICS.md stubs → real observations → M1.7

**One-command install/run (new tasks needed):**

- `minsky-init-one-command-bootstrap` → M1.3
- `minsky-uninstall-clean-removal` → M1.12
- `minsky-default-8h-repo-transformation` → M1.5

**Documentation (new tasks needed):**

- `readme-rewrite-5-min-install-guide` → M1.11

**Remote submission (new tasks needed):**

- `minsky-remote-task-submission` → M1.8

### What you can trust minsky to do at M1

| Task type | Confidence | Notes |
|---|---|---|
| **File tasks from a repo audit** (missing tests, stale docs, lint issues, dep updates) | 🟢 High | This is the core 8h-session workflow. Minsky reads the repo, creates well-structured TASKS.md entries. |
| **Update documentation** (README, inline comments, changelogs) | 🟢 High | Low-risk, easily reviewable, always opens a PR. |
| **Add missing tests** for existing code | 🟢 High | Test-first is constitutional (rule #3). Tests are verifiable. |
| **Fix lint / type errors** | 🟢 High | Deterministic success criteria — the lint passes or it doesn't. |
| **Single-file bug fixes** with clear reproduction steps | 🟡 Medium | Works when the fix is localized. May struggle with multi-file root causes. |
| **Dependency version bumps** (non-breaking) | 🟡 Medium | Can bump and run tests, but may not catch subtle runtime regressions. |
| **Run overnight unattended on a single repo** | 🟡 Medium | Target 90% stability. Expect ~1 in 10 iterations to fail and require daemon restart. |
| **Run across multiple repos** (`--hosts-dir`) | 🟡 Medium | Works but less battle-tested than single-repo mode. |
| **Multi-file refactors** | 🔴 Low | Cross-file coordination is weak. Likely to produce partial changes that break the build. |
| **UI/frontend changes** | 🔴 Low | No screenshot capture, no visual verification, no browser testing. |
| **Architecture decisions** | 🔴 Low | Minsky can research and file tasks, but cannot make sound architectural choices autonomously. |
| **Security-sensitive changes** (auth, crypto, permissions) | ⛔ Won't do | Marked as human-blocked. Minsky never modifies security-critical code without human approval. |
| **Destructive operations** (force push, delete branches, drop tables) | ⛔ Won't do | Hard-blocked. Filed as human-action-required tasks. |
| **Deploy / release** | ⛔ Won't do | Out of scope for M1. No production access. |

### What M1 is NOT

- Not a product. No pricing, no hosted service, no GitHub Actions integration.
- Not 99.9% stability. 90% over 10h is the gate.
- Not feature-complete. Many TASKS.md items defer to M2+.

---

## M2 — Fast Mode: Single-Task Delivery (target: v0.2.0)

> **Theme**: On top of M1's stable foundation, minsky can deliver a single task end-to-end with production-quality output — PR template compliance, CI passing, screenshots, code review.

### Exit criteria

| # | Criterion | How to verify |
|---|---|---|
| 1 | **`minsky run <task-id>` delivers a single task** with a complete PR: title follows conventional commits, body follows repo's PR template, all CI checks pass, screenshots attached where applicable | Run against 10 diverse tasks across 3 repos; ≥8/10 PRs are merge-ready on first attempt |
| 2 | **PR template compliance** — minsky reads `.github/PULL_REQUEST_TEMPLATE.md` (or equivalent) and fills every section | Lint: every PR body covers every template section |
| 3 | **CI awareness** — minsky runs the repo's CI locally before pushing, fixes failures, and only opens a PR when CI is green | 0 PRs opened with failing CI over a 10-task batch |
| 4 | **Screenshot capture** — for UI changes, minsky captures before/after screenshots and attaches them to the PR | Visual: screenshots present in PR body for ≥2 UI-touching tasks |
| 5 | **Self-review** — minsky reviews its own PR against the repo's coding standards before marking it ready | PR body contains a self-review checklist with findings |
| 6 | **Time-to-PR < 30 min** for a well-specified small task (< 100 lines changed) | Median time from `minsky run <id>` to PR-opened across 10 small tasks |
| 7 | **Competitive on SWE-bench Verified** — minsky's resolve rate on a representative SWE-bench Verified subset is measured and compared to published numbers for Devin, OpenHands, SWE-agent | `minsky benchmark --swe-bench-subset` produces a resolve rate; the number is published in the scorecard |

### Key tasks

- `cross-repo-runner-v0` refinement → production-quality single-task delivery
- `native-agent-teams-with-tiered-adapter` (P0) → parallel worker coordination for faster delivery
- PR template reader + filler (new)
- Screenshot capture adapter (new — Playwright / Puppeteer behind interface)
- Self-review step in the iteration pipeline (new)
- SWE-bench harness (new — compose with `self-metrics-competitive-benchmark`)

### What you can trust minsky to do at M2 (on top of M1)

| Task type | Confidence | Notes |
|---|---|---|
| **Well-specified single tasks** (bug fix, feature, refactor with clear acceptance criteria) | 🟢 High | This is M2's core: one task → one merge-ready PR. 80% first-attempt merge rate target. |
| **Multi-file changes** within a single feature | 🟢 High | M2 adds CI-awareness — minsky runs tests locally, fixes failures, only opens when green. |
| **UI changes with visual verification** | 🟡 Medium | Screenshot capture is new in M2. Works for obvious before/after, may miss subtle layout issues. |
| **SWE-bench-style bug reproduction + fix** | 🟡 Medium | Measured against published benchmarks. Expect competitive but not best-in-class resolve rates initially. |
| **PR that follows the repo's exact conventions** (template, commit format, CI) | 🟢 High | PR template compliance is an exit criterion. |
| **Large refactors** (>500 lines, many files) | 🟡 Medium | Better than M1 (parallel workers, CI gate), but still risky for sweeping changes. |
| **Performance optimization** | 🔴 Low | Can profile and file tasks, but autonomous perf work needs human judgment on tradeoffs. |
| **Database migrations** | ⛔ Won't do | Destructive + irreversible. Filed as human-blocked. |
| **Security-sensitive changes** | ⛔ Won't do | Same as M1. Human gate required. |

---

## M3 — GitHub Actions: Free CI Mode (target: v0.3.0)

> **Theme**: Minsky runs as a GitHub Action. You bring your own model API key, configure the action in your repo, and minsky works your TASKS.md queue on every push or on a schedule. Free except for your model costs.

### Exit criteria

| # | Criterion | How to verify |
|---|---|---|
| 1 | **Published GitHub Action** — `uses: fyodoriv/minsky-action@v0.3` in any workflow file | Action is listed on GitHub Marketplace; README has copy-paste workflow YAML |
| 2 | **BYOT (Bring Your Own Token)** — user provides `ANTHROPIC_API_KEY` (or OpenAI/local) as a secret; minsky uses it | Action works with Claude, OpenAI, and local (ollama in the runner) API keys |
| 3 | **Trigger modes** — schedule (cron), push (on new TASKS.md entries), manual (workflow_dispatch) | All three triggers tested in a public fixture repo |
| 4 | **Safe by default** — action runs in a fork, never pushes to main directly, always opens a PR, respects branch protection | Security audit: action cannot escalate permissions beyond the configured token's scope |
| 5 | **Cost transparency** — every run logs estimated token cost; weekly summary comment on a tracking issue | User can see exactly what each run cost |
| 6 | **Zero minsky infrastructure** — the action is self-contained; no external minsky server, no phone-home, no telemetry without opt-in | Network audit: action makes zero outbound calls except to the configured model API and GitHub API |
| 7 | **Works on public and private repos** — tested on both | Fixture: 1 public + 1 private repo with the action installed |
| 8 | **Stability ≥95%** for action runs (iteration success rate) | 20 consecutive scheduled runs on the fixture repo |

### Key tasks

- GitHub Action packaging (new)
- Runner environment setup (Node, pnpm, minsky install — all in the action)
- Token cost estimator (new — compose with budget-guard)
- Fork-based PR workflow (new)
- Documentation: "Add minsky to your repo in 2 minutes"

### What you can trust minsky to do at M3 (on top of M2)

| Task type | Confidence | Notes |
|---|---|---|
| **Continuous background improvement on any GitHub repo** | 🟢 High | The core M3 promise: install the Action, it works your TASKS.md queue on schedule. |
| **Automated dependency maintenance** (Dependabot-style but smarter) | 🟢 High | Bumps, runs tests, opens PRs. The CI environment ensures reproducibility. |
| **Codebase health maintenance** (lint fixes, test gaps, doc drift) | 🟢 High | Same as M1 core but hands-free — runs on cron, no operator needed. |
| **Respond to new TASKS.md entries** on push | 🟡 Medium | Push trigger works, but task quality depends on how well the human wrote the task spec. |
| **Work on private repos** with proprietary code | 🟡 Medium | Action is sandboxed (fork-based PRs), but the LLM sees the code. Users must trust their model provider's data policy. |
| **Complex multi-step features** | 🟡 Medium | CI mode has no persistent daemon state between runs. Each run is stateless — long features need task decomposition. |
| **Repos with complex CI** (Docker, GPU, external services) | 🔴 Low | GitHub Actions runners have limited capabilities. Repos needing Docker-in-Docker or special hardware won't work out of the box. |
| **Monorepos with custom build systems** (Bazel, Nx, Turborepo) | 🔴 Low | minsky understands package.json/pnpm. Custom build systems need explicit configuration. |
| **Anything requiring secrets** (deploy keys, cloud credentials) | ⛔ Won't do | Action never reads secrets beyond the model API key. Filed as human-blocked. |

---

## M4 — Enterprise Reliability (target: v1.0.0)

> **Theme**: 99.9% stability. Minsky is at least as good as every competitor on every measured metric. Production-ready for teams.

### Exit criteria

| # | Criterion | How to verify |
|---|---|---|
| 1 | **99.9% stability over 30-day rolling window** — across all reporting machines | Fleet stability report sustained over 3 consecutive 30-day windows |
| 2 | **Competitive parity or better on every DORA + agentic metric** vs ≥4 competitors | Weekly scorecard shows minsky ≥ median on all metrics; ≥ best-in-class on ≥2 metrics |
| 3 | **Security audit passed** — third-party audit of the codebase, action, and data handling | Audit report with 0 critical, 0 high findings |
| 4 | **Multi-machine fleet management** — operator manages 5+ machines from a single dashboard | Dashboard shows all machines, their status, and aggregate metrics |
| 5 | **Graceful degradation under all failure modes** — every failure mode in the chaos catalog is tested monthly and recovers within SLA | Monthly chaos test report: 100% of catalogued failures recover within documented SLA |
| 6 | **Documentation: operations runbook** — covers troubleshooting, recovery, upgrade, rollback | Runbook tested by an operator who didn't write it |
| 7 | **Semantic versioning with stability guarantees** — breaking changes follow semver; upgrade path documented | CHANGELOG covers every release; upgrade guide exists for every major |
| 8 | **Team mode** — multiple developers on the same repo, minsky coordinates without conflicts | 3 developers + minsky on the same repo for 1 week; 0 merge conflicts caused by minsky |

### Key tasks

- Chaos engineering automation (monthly scheduled)
- Fleet dashboard (aggregate view)
- Security audit engagement
- Team coordination protocol
- Semver + release automation
- Operations runbook

### What you can trust minsky to do at M4 (on top of M3)

| Task type | Confidence | Notes |
|---|---|---|
| **24/7 unattended operation** across a fleet of machines | 🟢 High | 99.9% stability = ~8.7h downtime/year. Chaos-tested monthly. |
| **Team coordination** (multiple devs + minsky on the same repo) | 🟢 High | Conflict avoidance, claim protocol, merge coordination all proven over 30+ days. |
| **Multi-file refactors** | 🟡→🟢 Medium-High | Parallel workers + proven gate + chaos-tested recovery make large changes safer. |
| **Complex bug fixes** requiring cross-file reasoning | 🟡 Medium | Better tooling (observability, self-review) helps, but fundamentally limited by the underlying LLM's reasoning depth. |
| **Performance optimization** with profiling | 🟡 Medium | Can measure before/after, but selecting the right optimization strategy still needs human judgment for non-obvious cases. |
| **Repos in any language** (Python, Go, Rust, Java, etc.) | 🟡 Medium | The supervisor is language-agnostic, but the default build/test detection is Node-first. Other languages need `repo.yaml` configuration. |
| **Architecture-level changes** | 🔴 Low | Even at M4, minsky should not make autonomous architecture decisions. It can research, propose, and file tasks — but the human decides. |
| **Security-critical code** | 🔴→🟡 Low-Medium | With a passed security audit (M4 criterion), minsky can handle *some* security tasks (dependency audit, known-CVE patches) but not auth/crypto design. |

---

## M5 — Product: Managed Minsky (target: v2.0.0, private source)

> **Theme**: For a monthly subscription + usage-based cost, minsky runs on GitHub Actions for any project 24/7. Managed infrastructure, managed updates, managed monitoring.

### Exit criteria

| # | Criterion | How to verify |
|---|---|---|
| 1 | **Subscription model** — monthly base + per-iteration usage pricing | Pricing page live; Stripe integration working |
| 2 | **Managed GitHub App** — install from GitHub Marketplace; auto-configures the repo | 1-click install on a new repo; minsky starts working within 5 minutes |
| 3 | **Usage dashboard** — real-time view of iterations, costs, PRs opened/merged, stability | Customer-facing dashboard shows all metrics |
| 4 | **SLA: 99.9% uptime** for the managed service | Uptime monitoring over 90 days |
| 5 | **Multi-repo support** — one subscription covers multiple repos | Customer with 3 repos sees unified billing and per-repo metrics |
| 6 | **Model-agnostic** — works with customer's own API key (Claude, OpenAI, etc.) or minsky-provided quota | Test with ≥3 different model providers |
| 7 | **Private source** — the managed layer is proprietary; the core engine remains MIT | License audit: MIT for `@minsky/*` packages; proprietary for the managed layer |
| 8 | **24/7 operation** — continuous queue processing with automatic scaling | 7-day unattended run on a real customer repo with real tasks |
| 9 | **SOC 2 Type II readiness** — data handling, access controls, audit logging meet enterprise requirements | Compliance checklist completed; remediation plan for gaps |

### Key tasks

- Managed infrastructure (GitHub App, webhook handler, job scheduler)
- Billing integration (Stripe)
- Customer dashboard
- Proprietary management layer (separate repo)
- SOC 2 compliance work
- Marketing site + pricing page
- Beta program with ≥5 design partners

### What you can trust minsky to do at M5 (on top of M4)

| Task type | Confidence | Notes |
|---|---|---|
| **Zero-touch continuous improvement** for any GitHub repo | 🟢 High | Install from Marketplace, configure once, minsky works 24/7. Monthly subscription covers infrastructure. |
| **Cost-predictable autonomous coding** | 🟢 High | Usage dashboard shows exactly what each run costs. No surprise bills. Budget controls built in. |
| **Multi-repo management** for a team or org | 🟢 High | One subscription, unified billing, per-repo metrics and controls. |
| **Enterprise compliance** (audit logging, access controls) | 🟡 Medium | SOC 2 *readiness*, not full SOC 2. Enterprise customers with strict compliance may need additional controls. |
| **Custom model providers** (on-prem LLMs, Azure OpenAI, etc.) | 🟡 Medium | Model-agnostic by design, but on-prem providers may need custom adapter work. |
| **Replacing a junior developer's output** | 🟡 Medium | For well-defined tasks with clear specs — competitive with a junior. For ambiguous requirements — still needs a human to specify. |
| **Replacing a senior developer's judgment** | 🔴 Low | Minsky is a force multiplier for seniors, not a replacement. Architecture, tradeoffs, and "what should we build" remain human. |
| **Greenfield projects** from scratch | 🔴 Low | Minsky improves existing repos. Starting from zero requires human decisions about stack, architecture, and structure. |

### What minsky will NEVER do (any milestone)

These are permanent design boundaries, not "not yet" items:

- **Make irreversible changes without human approval** — force push, drop database, delete production resources, rotate secrets
- **Bypass branch protection or code review** — always opens PRs, never pushes to main/master
- **Send code to third parties** without explicit opt-in — model API calls are the only external data flow
- **Make architectural decisions** — can research, propose, and file tasks, but never commits architecture choices autonomously
- **Replace human judgment on tradeoffs** — "should we optimize for speed or readability?" is always a human question

---

## Milestone dependency graph

```text
M1 (Stable + Measurable)
 └── M2 (Fast Mode)
      └── M3 (GitHub Actions)
           └── M4 (Enterprise Reliability)
                └── M5 (Managed Product)
```

M1 is the foundation everything else builds on. No milestone can ship before its predecessor's exit criteria are met.

---

## Competitive landscape (the real competitors)

The existing `competitors/` directory covers multi-agent frameworks. The actual competitive set for autonomous coding — what a developer choosing minsky would compare against — is:

| Competitor | Category | Strengths | Weaknesses vs minsky's vision |
|---|---|---|---|
| **Devin** (Cognition) | Managed autonomous agent | Polished UX, cloud-hosted, full IDE, handles complex tasks | Proprietary, expensive (~$500/mo), black box, no self-hosting, no local models |
| **OpenHands** (All-Hands-AI) | OSS autonomous agent | Open source, SWE-bench leader (~50% resolve), Docker sandboxed | Single-task focused, no 24/7 daemon, no budget management, no self-improvement loop |
| **SWE-agent** (Princeton) | Research agent | Academic rigor, good SWE-bench scores, ACI interface | Research-oriented, not production-ready, no supervision, no multi-repo |
| **Aider** (Paul Gauthier) | CLI coding assistant | Excellent local model support, fast, lightweight, battle-tested | Interactive-first (not autonomous), no supervision, no task queue, no multi-agent |
| **Cursor Agent** (Anysphere) | IDE-integrated agent | Deep IDE integration, good UX, fast iteration | IDE-bound, no daemon mode, no 24/7, no CLI, vendor lock-in |
| **Claude Code + Agent Teams** (Anthropic) | Native multi-agent | First-party support, file-locked coordination, deep Claude integration | Experimental, Claude-only, no budget management, no cross-repo, no self-improvement |
| **Codex CLI** (OpenAI) | CLI agent | OpenAI ecosystem, sandboxed execution | OpenAI-only, no supervision, no daemon, early stage |

**Minsky's unique positioning**: the only system that targets the **outer loop** — 24/7 supervision, budget management, self-improvement, multi-agent orchestration across providers, and measurable competitive benchmarks. Every competitor optimizes the inner loop (do one task better). Minsky makes the system that does tasks reliably, indefinitely, on budget.

---

## Task-milestone mapping

Every existing TASKS.md task should carry a `**Milestone**:` field (M1/M2/M3/M4/M5) indicating which milestone it serves. Tasks without a milestone field are M1 by default (stability and measurement are the foundation).

### Immediate priority order (M1)

1. **Fix what's broken** — stability blockers (commit hooks, merge gate, token crashes, GH auth)
2. **Measure everything** — competitive benchmark, real METRICS.md observations, fleet reporting
3. **Simplify install/run** — one-command bootstrap, sane defaults, clean uninstall
4. **Rewrite docs** — 5-minute README, honest competitive comparison
5. **Default 8h session** — the "minsky converts any repo" workflow
6. **Remote task submission** — cross-machine findings aggregation

### What to deprioritize

- MAPE-K loop refinement → M4 (premature optimization before stability)
- Apple Watch / mobile dashboard → M2+ (nice-to-have, not core)
- DSPy prompt optimization → M4 (premature before competitive benchmarks)
- OMC native tasks.md upstream issue → M2 (blocked on upstream)
- Vision.md governance overhead → lighten for M1 (the 12-rule constitution is impressive but the overhead per PR is currently higher than the value for a pre-alpha project; rule #9's iron requirement is correct in spirit but should be enforced proportionally to the project's maturity)

---

## How to use this document

1. **Before picking ANY task**: run the milestone alignment gate (AGENTS.md § 15). Verify the 7 surfaces (README, quickstart, vision, user-stories, integration tests, logs/observability, METRICS.md) are aligned with the current milestone. If any surface is stale, fixing it IS your first task.
2. **Before picking an implementation task**: check which milestone it serves. If it's not M1, ask: "is M1 done?" If not, pick an M1 task instead.
3. **When filing new tasks**: add `**Milestone**: M<N>` to the task block.
4. **Weekly**: update the "Current state" table with fresh numbers.
5. **Per milestone completion**: write a release note, tag the version, update this document's exit criteria with ✅/❌.

### The 7-surface alignment gate (operator directive 2026-05-18)

This is the **#1 priority** in all minsky work. No implementation task may be claimed until these 7 surfaces are verified aligned with the current milestone:

1. **README.md** — reflects current milestone's install/run/benefits
2. **Quickstart** — whatever README says, it actually works right now
3. **vision.md** — milestone goals reflected in success criteria
4. **user-stories/** — each milestone exit criterion has a user story with metric + test
5. **Integration tests** — user-story tests exist and pass for shipped criteria
6. **Logs + observability** — system emits data needed to verify milestone criteria
7. **METRICS.md** — every milestone-dependent metric has a real observation (not a stub)

Run `node scripts/check-milestone-alignment.mjs` (when it exists) or manually audit. Gaps found → fix them before any other work.
