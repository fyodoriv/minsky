# Minsky documentation

> **Where to start** — a reading order, by audience. Pick the path that matches who you are.

This is the canonical index of every document in the Minsky repo. Each entry lists what the doc is, who it's for, and approximate reading time.

## I'm new here — what is Minsky?

Read these three, in order. Total time: ~12 minutes.

| # | Doc | What you learn | Time |
|---|---|---|---|
| 1 | [README.md](../README.md) | What Minsky does, how it's installed, what works today. The honest one-pager. | ~3 min |
| 2 | [vision.md](../vision.md) § "What Minsky is" | The strategic shape — plug-and-play repo transformer, daemon that self-improves, NOT a framework. | ~2 min |
| 3 | [MILESTONES.md](../MILESTONES.md) | The roadmap. Which milestone Minsky is in (M1 = stable, measurable, one-command), how progress is measured. | ~5 min |

Optionally: [docs/PRACTICES.md](PRACTICES.md) (~3 min) — the literature anchors. Every Minsky decision cites a named, published practice; this is the index.

## I want to install Minsky on my repo

Two paths.

**Through your AI agent** (fastest):

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

**Manual**: read [INSTALL.md](../INSTALL.md) (~8 min). Prerequisites: Node ≥22, pnpm ≥9, git ≥2.40.

After install:

- [docs/configuration.md](configuration.md) — `~/.minsky/config.json`, agent comparison
- [docs/cli-reference.md](cli-reference.md) — every `minsky` subcommand
- [docs/uninstall.md](uninstall.md) — clean removal
- [docs/updating.md](updating.md) — `git pull` workflow + restart

## I'm an AI agent working on this codebase

Read in this order. Total: ~20 minutes.

| # | Doc | Why |
|---|---|---|
| 1 | [AGENTS.md](../AGENTS.md) | The agent runbook. Setup, running, claiming tasks, the 17 constitutional rules. **Load-bearing — CI gates cite section headings here.** |
| 2 | [MILESTONES.md](../MILESTONES.md) | What milestone we're in, what's blocking it. Read before picking a task. |
| 3 | [DEPRECATED.md](../DEPRECATED.md) | What NOT to invest in. Check this before implementing anything. |
| 4 | [TASKS.md](../TASKS.md) | The work queue. Sorted P0 → P3. Pick the top unclaimed task with all rule-9 fields filled in. |

Then read [vision.md](../vision.md) at your own pace — the 17 constitutional rules each get enforced by a deterministic CI lint, so you can also discover the rules by reading the lint output.

## I want to understand the architecture

| Doc | What it covers |
|---|---|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Layered model, adapter pattern, the dependency table. Where each tool plugs in. |
| [vision.md § "Pattern conformance index"](../vision.md#pattern-conformance-index) | Every artifact in the repo + the named published pattern it implements. |
| [vision.md § "What Minsky is"](../vision.md#what-minsky-is) | The plug-and-play repo transformer thesis. |
| [docs/PRACTICES.md](PRACTICES.md) | Every published software-engineering practice Minsky applies + its enforcement point. |

## I want to contribute

Read [CONTRIBUTING.md](../CONTRIBUTING.md) first (~2 min) — code in this repo is AI-authored; no attestation needed but the bar is real.

Then [AGENTS.md](../AGENTS.md) covers the rest: claiming tasks, branch hygiene, the pre-PR lint stack, the seven-surface milestone alignment gate.

## I want to understand how Minsky compares to other tools

Three reads, in order:

1. [competitors/README.md](../competitors/README.md) — **the strategic landscape synthesis**. 6 moats + 5 honest gaps + adopt/reject pattern table. Read this FIRST.
2. [novel/competitive-benchmark/README.md](../novel/competitive-benchmark/README.md) — the M1.10 scorecard. Orchestrator tier (MetaGPT) + agent tier (Claude Code, Devin, OpenHands, …). Why both: Minsky is at the orchestrator tier; it composes agents.
3. [competitors/](../competitors/) — per-vendor research files. One markdown per competitor with positioning + scorecard readings.

For the **moats as user stories** with chaos coverage + pre-registered umbrella experiments:

- [user-stories/012-operator-machine-identity-moat.md](../user-stories/012-operator-machine-identity-moat.md) — moat #2 (`~/.gitconfig`, `~/.config/gh/`, `~/.ssh`)
- [user-stories/013-daemon-not-framework-moat.md](../user-stories/013-daemon-not-framework-moat.md) — moat #1 (zero `@minsky/*` imports in host repo)
- [ARCHITECTURE.md § "Competitive layer-by-layer"](../ARCHITECTURE.md#competitive-layer-by-layer) — 14-row table mapping Minsky vs 5 orchestrator competitors

## I'm operating Minsky in production

| Doc | What it covers |
|---|---|
| [docs/edge-cases.md](edge-cases.md) | What happens when the queue is empty, runtime limits hit, agents crash, etc. |
| [docs/auto-merge.md](auto-merge.md) | Periodic gate-and-merge for daemon PRs (ON for Minsky itself, OFF for other repos). |
| [docs/dependabot.md](dependabot.md) | Dependency-update policy + local merge gate. |
| [docs/local-llm-fallback.md](local-llm-fallback.md) | What happens when the cloud quota runs out. |
| [docs/daemon-pre-pr-gate.md](daemon-pre-pr-gate.md) | The 53-step pre-PR lint stack the daemon runs before pushing. |
| [docs/cross-repo-portability.md](cross-repo-portability.md) | Running Minsky across multiple repos. |
| [docs/metrics-discipline.md](metrics-discipline.md) | How metrics are measured and surfaced. |
| [docs/strategic-model-router.md](strategic-model-router.md) | Which model gets used for which task. |
| [docs/self-diagnose-throughput-invariants.md](self-diagnose-throughput-invariants.md) | `minsky doctor` — what it checks. |

## I want a deeper dive on a specific topic

| Doc | Topic |
|---|---|
| [docs/CHANGELOG-narrative-history.md](CHANGELOG-narrative-history.md) | The why behind major release changes (narrative form). |
| [docs/commit-hook-toolchain.md](commit-hook-toolchain.md) | The pre-commit / pre-push gates. |
| [docs/conflict-auto-resolution.md](conflict-auto-resolution.md) | Mergiraf integration for auto-resolving merge conflicts. |
| [docs/cross-repo-runner-aifn-840-runbook.md](cross-repo-runner-aifn-840-runbook.md) | The cross-repo runner deep-dive. |
| [docs/experiment-runner.md](experiment-runner.md) | How `experiments/<id>.yaml` flows through the runner. |
| [docs/experiment-tracker.md](experiment-tracker.md) | The experiment record-keeping substrate. |
| [docs/host-transformation-checklist.md](host-transformation-checklist.md) | What "transformed" looks like for a host repo. |
| [docs/post-task-cto-audit.md](post-task-cto-audit.md) | The CTO-style after-task audit that surfaces new tasks. |
| [docs/run-anywhere.md](run-anywhere.md) | Portability story across machines / OSes. |
| [docs/rule-11-flake-detection.md](rule-11-flake-detection.md) | Rule #11 — no flaky gates. |
| [docs/README-v1-detailed.md](README-v1-detailed.md) | The earlier, more verbose README — kept for reference. |

## I want to understand the rules

[vision.md](../vision.md) is the constitution. 17 non-negotiable rules. Each rule is enforced by a deterministic CI lint that runs on every iteration. The constitution is the project specification; the linters monitor execution against it at runtime (Havelund & Goldberg, 2008).

A cheat-sheet of the 17 rules, with links:

1. **Don't reinvent the wheel** — find an existing tool first ([§ 1](../vision.md#1-dont-reinvent-the-wheel))
2. **Every dependency behind an interface** — adapter pattern, swappable in one file ([§ 2](../vision.md#2-every-dependency-behind-an-interface))
3. **Test-first, metric-first, doc-first** — red, then metric, then docs, then green ([§ 3](../vision.md#3-test-first-metric-first-doc-first))
4. **Everything measurable, everything visible** — OTEL + dashboard for every new component ([§ 4](../vision.md#4-everything-measurable-everything-visible))
5. **Theoretical grounding** — every choice cites a named pattern ([§ 5](../vision.md#5-theoretical-grounding))
6. **Stay alive** — let-it-crash + supervisor restart over try-catch chains ([§ 6](../vision.md#6-stay-alive))
7. **Chaos engineering** — every novel package has a deterministic chaos test ([§ 7](../vision.md#7-chaos-engineering))
8. **Pattern conformance** — every artifact traces to a named published pattern ([§ 8](../vision.md#8-pattern-conformance))
9. **Pre-registered hypothesis-driven development** — iron rule, no exemption ([§ 9](../vision.md#9-pre-registered-hypothesis-driven-development))
10. **Deterministic enforcement** — every rule is a CI lint, not an LLM advisory ([§ 10](../vision.md#10-deterministic-enforcement))
11. **No flaky gates** — flaky gate = wrong gate; fix it or remove it ([§ 11](../vision.md#11-no-flaky-gates))
12. **Scope discipline** — touch only what the task said you'd touch ([§ 12](../vision.md#12-scope-discipline))
13. **Security & privacy** — minimum bar covers every novel package ([§ 13](../vision.md#13-security--privacy))
14. **Dynamic settings** — no hardcoded timeouts ([§ 14](../vision.md#14-dynamic-settings))
15. **Milestone alignment** — seven-surface gate supersedes task picking ([§ 15](../vision.md#15-milestone-alignment))
16. **Default by default** — when you implement a fix, make it the default ([§ 16](../vision.md#16-default-by-default))
17. **Proactive healing** — observation IS the fix; same session, same PR ([§ 17](../vision.md#17-proactive-healing))

## Found a typo or unclear doc?

Open a PR. Treat docs the same as code: a failing test (the unclear sentence), then a fix, then the explanation in the commit message.

If you're an AI agent working on this repo, just file it as a P3 task in [TASKS.md](../TASKS.md) and another iteration will pick it up.
