# Competitor: Claude Code (Anthropic)

> Anthropic's first-party coding agent — Minsky drives it as a backend, and it also competes head-on for autonomous-coding work.

- **URL**: <https://www.anthropic.com/claude-code>
- **Status**: Active, GA since Feb 2025
- **Pricing**: Pay-per-token via Anthropic API (Claude Sonnet / Opus pricing)
- **Relationship**: **Integration + Competitor** — Minsky uses Claude Code as a cloud agent (`cloud_agent: "claude"`); Claude Code also competes as a standalone autonomous-coding product.

## What this is

Claude Code is Anthropic's coding assistant. It runs on your own machine, as a command-line tool or a VS Code extension. You give it a task; it reads your codebase, edits files, runs tests, and opens a pull request. It is built directly on the Claude API with first-party tools for file edits, shell commands, and web access. It scores well on agentic coding benchmarks, and it is the lowest-friction choice for a team already using Claude.

In Minsky's terms, Claude Code is an **agent** — the coding assistant that does the actual work. Minsky is not an agent; Minsky is the background program that picks tasks and drives an agent like Claude Code to do them.

## What this is not

- **Not a daemon.** A daemon is a background program that keeps running on your machine, surviving terminal close and restarting on crash. Claude Code is an interactive, per-session agent. Minsky is the unattended daemon that drives it across a `TASKS.md` queue — the plain-text Markdown to-do list at a project's root that Minsky reads to pick work.
- **Not a Minsky-internal competitor only.** Minsky integrates Claude Code as a backend (`cloud_agent: "claude"`) and also competes with it as a standalone product.
- **Not the discipline layer.** Claude Code has no numbered project rules enforced by CI, no cross-repo fleet (one Minsky walking several repositories in turn), and no pre-registered-experiment gate. Those are Minsky's contribution.

## Strengths

- **SWE-bench Verified leader** — 0.49 resolve rate (Anthropic 2025-02-24, Claude 3.7 Sonnet plus the Claude Code agentic harness).
- **Strong on docs and feature tasks** — 92.3% acceptance on documentation tasks, 72.6% on feature tasks, per the AIDev study (Pinna et al., arXiv 2602.08915, 2026-02-09).
- **First-party tooling** — file edits, shell, and web access are all built by Anthropic. No third-party adapter wrappers to maintain.
- **Local execution** — runs on the developer's machine. No cloud VM cost.
- **VS Code plus CLI** — first-class IDE integration and a scriptable command line for automation.
- **Active development** — ships often, on the Claude model release cadence.

## Weaknesses vs Minsky's vision

1. **No 24/7 daemon.** Claude Code is interactive or scripted, not a persistent background program. There is no overnight unattended loop, no budget management, and no automatic restart.
2. **No self-improvement.** Claude Code has no MAPE-K loop — the self-improvement loop that Monitors its own results, Analyzes them, Plans changes, and Executes them over a Knowledge base. It improves when Anthropic ships an update, not when it runs on your repo.
3. **Token cost scales with use.** Heavy daily use can reach $100+/month per developer on the Claude API. There is no fallback to a model running on your own machine.
4. **Single-agent.** One Claude per session. No model routing and no multi-agent orchestration.
5. **No competitive benchmarking.** Anthropic publishes its own SWE-bench number. Claude Code does not measure itself against alternatives in your own context.
6. **No multi-repo support.** It works on one repository at a time.

## What we learn / steal

- **First-party tool integration** — the cleanest tool-use experience in the agent market. Minsky's adapter pattern (a small wrapper that lets Minsky talk to one outside tool through a fixed interface) aims for the same clean split between agent and tools.
- **SWE-bench as the public metric** — Anthropic publishes scores, so Minsky's scorecard uses the same metric for a direct comparison.
- **Pay-per-token transparency** — Claude Code's pricing is transparent and predictable; Minsky's cost-per-merged-PR metric inherits that discipline.
- **Local execution** — Minsky's local-model fallback mode (aider plus ollama) follows the same philosophy.

## Why choose Minsky over Claude Code

- 24/7 daemon mode with budget management and supervision.
- Multi-agent orchestration — Claude Code is one of several agents Minsky can drive.
- Self-improving via the MAPE-K loop, which evolves the prompts over time.
- Local-model fallback, so token cost drops to zero when running on local models.
- Competitive self-benchmarking — Minsky measures itself against Claude Code, not just against Anthropic's own numbers.
- Cross-repo fleet — one Minsky walks several repositories in turn.

## Why choose Claude Code over Minsky

- Best-in-class single-agent coding performance (highest SWE-bench).
- First-party Anthropic support.
- Simpler — no daemon, no orchestration, just `claude` in your terminal.
- VS Code integration out of the box.
- Lower setup friction.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source                                                                                                                                                                                                                                                |
| ----------------------------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.49  | 2025-02-24 | Anthropic, *Claude 3.7 Sonnet and Claude Code*, anthropic.com, 2025-02-24 — SWE-bench Verified, agentic harness.                                                                                                                                              |
| `autonomous-merge-rate`             | 0.726 | 2026-02-09 | Pinna, Gong, Williams, Sarro, *Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance*, arXiv 2602.08915, 2026-02-09 — AIDev dataset, Claude Code features-task acceptance at 72.6% (it also leads documentation tasks at 92.3%). |
| `human-intervention-rate`           | 0.274 | 2026-02-09 | Inverse of autonomous-merge-rate per the same AIDev source.                                                                                                                                                                                                  |

Note: The autonomous-merge-rate of 0.726 is Claude Code's features-task
acceptance rate per the AIDev study, not an aggregate. The 0.923 docs
number is higher but features are the more demanding category, so 0.726
is used as the conservative proxy. If Anthropic publishes an aggregate
PR acceptance number across task types, replace this reading.

## Should we wrap Claude Code instead?

> Per rule #1 (don't reinvent), every direct-competitor research must end with the question: *if this competitor is great at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: ALREADY WRAPPED at the right layer.** Claude Code is the agent; Minsky is the daemon around it. Don't file a P0.

**Current state**: Claude Code is already a Minsky backend — `cloud_agent: "claude"` in the per-machine config. Each iteration (one round of work: pick a task, ask an agent to do it, capture the result, open a draft), Minsky's daemon drives Claude Code to do the task, and the pull request comes back to your machine under your own `gh` credentials. This is the right shape: Minsky owns the loop, Claude Code owns the single-task coding.

**The further-wrap question**: should Minsky hand the outer loop to Claude Code too — let Claude Code manage the overnight schedule and the cross-repo walk, and shrink Minsky to a thin layer?

**Answer: NO.** Claude Code has no daemon, no budget management, no automatic restart, no cross-repo fleet, and no self-improvement loop. There is nothing at the outer-loop layer to wrap — the very things Minsky provides are the things Claude Code does not have. Wrapping Claude Code at the agent layer (where it is strong) is exactly what Minsky already does; there is no outer layer to delegate.

**What changes the answer**: if Anthropic shipped a persistent, unattended, multi-repo runner with its own budget and restart logic, Minsky would re-evaluate which layer to own. As of this review, Claude Code remains a per-session agent.

## Five pivot questions

> Applied per the Five Pivot Questions framework (`.claude/skills/competitor-research` § Phase 7, `--deep` mode).

### 1. How is it different from Minsky?

Claude Code is a **first-party, single-agent, interactive coding assistant** that runs per session on your machine. Minsky is an **operator-machine daemon** that wraps swappable agent backends (Claude Code among them), runs an unattended cross-repo fleet, and commits under your own `gh` identity. Claude Code sells the best single-task coding experience; Minsky sells the unattended loop that drives such an agent across many tasks and repos while you are away.

### 2. What lessons can it give to us?

- **2.1 First-party tooling sets the UX bar.** Claude Code's file, shell, and web tools are the cleanest tool-use experience in the market. Lesson: Minsky's adapter pattern should keep the agent/tool split just as clean, so swapping a backend never leaks into the rest of the code. Traces to the adapter discipline.
- **2.2 Publish on a shared public metric.** Anthropic reports SWE-bench Verified (0.49, 2025-02-24). Lesson: keep the same metric in Minsky's scorecard so the comparison is apples-to-apples, and never strip a number of its methodology qualifier (Claude Code's 0.726 is the AIDev features-task rate, not an aggregate). Traces to rule #9 (pre-registered hypothesis-driven development) and the honest-readings discipline.
- **2.3 Transparent per-token pricing is a measurable axis.** Claude Code's cost is predictable. Lesson: keep cost-per-merged-PR a first-class scorecard dimension so the local-model economic advantage shows up as a number, not a claim.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons sit on top of Minsky's existing architecture and reinforce existing rules. The tooling lesson (§2.1) reinforces the adapter discipline; the public-metric lesson (§2.2) reinforces rule #9; the cost lesson (§2.3) reinforces keeping cost a measured axis. None forces a rewrite of `vision.md` and none invalidates a rule. This negative finding is recorded here for audit.

### 4. How can we improve our strategy based on this?

- **Keep wrapping Claude Code at the agent layer.** It is the strongest single-agent backend; Minsky's value is the loop around it, not a replacement for it. Traces to §2.1.
- **Publish methodology-qualified numbers.** State Claude Code's 0.49 SWE-bench and 0.726 features-task rate with their exact scope, so the scorecard reads as a trustworthy comparison, not a marketing table. Traces to §2.2.
- **Keep cost a measured axis.** Maintain cost-per-merged-PR so the zero-token local-model path is a readable advantage. Traces to §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

- **agent backend**: ALREADY-WRAPPED — Claude Code is a per-task `cloud_agent: "claude"` backend today. Correct shape; no further cut available.
- **tick-loop / fleet / queue**: KEEP — Claude Code has no outer loop to delegate to. Do NOT replace.
- **MAPE-K / self-improvement**: KEEP — Claude Code has no across-session experiment store; nothing to absorb.
- **constitution-as-CI**: KEEP — Claude Code has no numbered operator-side rule gate.
- **corpus / scorecard**: KEEP + REFRESH — Claude Code stays a cited corpus entry; keep the methodology qualifier on every reading.
- **identity / TASKS.md surface**: KEEP — operator-machine identity is a core Minsky property; Claude Code already runs locally under your identity when Minsky drives it.

**Total replace % across all surfaces: 0% replacement; 1 ALREADY-WRAPPED (the agent backend, at the correct per-task layer).** Headline for the operator: *nothing further to cut — Claude Code is already wrapped at the right (per-task) layer; Minsky's value is the unattended loop, the cross-repo fleet, and the self-improvement that Claude Code does not provide.*

## Last reviewed

2026-05-22
