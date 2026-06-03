# Competitor: Aider (Aider-AI)

> Aider is a terminal tool that pairs a developer with an AI to edit code. Minsky uses it as one of the coding assistants it drives — specifically for work that runs entirely on your own machine with no cloud cost.

- **URL**: <https://aider.chat> / <https://github.com/Aider-AI/aider>
- **Status**: Active, "the tool to benchmark against" (Hacker News), battle-tested command-line tool
- **Pricing**: Free (open source, Apache 2.0). You pay only for the model you point it at.
- **Relationship**: **Integration** — Minsky uses Aider as its local-model agent

## What this is

Aider is AI pair programming in your terminal. You run it next to your code, tell it what to change, and it edits the files and commits them to git for you.

Its standout feature is breadth of model support: it works with Claude, GPT-4, Gemini, and any model that speaks the OpenAI API, including models running on your own computer through tools like Ollama or LM Studio. It edits code as small reviewable diffs rather than rewriting whole files, it understands your git repository, and it installs with a single `pip install`. It is widely treated as the gold standard for command-line AI coding.

In this document, "agent" means the coding assistant that does the actual editing — Aider here, or Claude Code, Devin, or OpenHands elsewhere. Minsky is not an agent; it is the program that drives agents. Aider is one of the agents Minsky drives.

## What this is not

- **Not an orchestrator.** Aider has no daemon — no background program that keeps running on your machine after you start it. It has no task list to work through and no way to walk several repositories in turn. It is the inner-loop assistant Minsky drives, not a peer to Minsky's outer loop.
- **Not autonomous by design.** Maintainer Paul Gauthier resists fully-autonomous operation. Aider deliberately keeps a human at the keyboard.
- **Not a head-to-head Minsky competitor.** Minsky already uses Aider as its `local_agent`. This file studies what to absorb from Aider, not how to beat it.

## Strengths

- **Best local-model support** — works with 100+ models, including every Ollama model. No other tool matches this breadth.
- **Fast and lightweight** — a `pip install`, with no Docker and no cloud dependency.
- **Git-native** — auto-commits, understands repo structure, respects `.gitignore`.
- **Battle-tested** — years of production use and a large community following.
- **Diff-based editing** — precise, reviewable changes instead of whole-file rewrites.
- **Multi-file editing** — can edit several files in a single turn.
- **Cost-efficient** — smart context management, caching, and minimal wasted tokens.
- **SWE-bench competitive** — publishes its scores, which hold up against cloud-only agents.

## Weaknesses vs Minsky's vision

Minsky is an orchestrator: a background program you point at your code projects, which picks up to-do tasks and works on them on its own. Measured against that role, Aider is missing the entire outer loop.

1. **Interactive-first** — built for pair programming, not for running in the background. There is no daemon (a background program that keeps running).
2. **No task list** — Aider works on what you tell it right now. It does not read a project's to-do list or drain a queue.
3. **No supervision** — no budget limits, no watchdog, no automatic restart after a crash.
4. **No multi-agent work** — one Aider at a time. There is no manager-plus-workers split.
5. **No self-improvement** — Aider has no MAPE-K loop. (MAPE-K is the self-improvement loop — Monitor, Analyze, Plan, Execute over a Knowledge base — that lets Minsky study its own results and adjust.)
6. **No draft delivery** — Aider edits files and commits, but does not open a draft pull request or run CI checks.
7. **No cross-repo work** — one repository at a time.

## What we learn / steal

- **Local-model integration** — Minsky uses Aider as its local agent precisely because Aider's model support is unmatched.
- **Diff-based editing** — Aider's `--edit-format diff` is more efficient than whole-file editing. The instructions Minsky hands an agent should prefer it.
- **`--no-auto-commits`** — Minsky uses this flag to control exactly when commits happen.
- **Message-file input** — Aider reads its instructions from `--message-file`, and Minsky composes its brief through that channel.

## Why choose Minsky over Aider

- Runs 24/7 on its own (daemon plus task list).
- Coordinates multiple agents (a cloud-driven manager plus local workers).
- Works through a project's plain-text to-do list (`TASKS.md`).
- Opens draft pull requests and gates them before merge.
- Manages your paid model budget.
- Studies and improves its own results.

## Why choose Aider over Minsky

- Better for hands-on interactive pair programming.
- Simpler — no daemon, no config, just `aider`.
- Better local-model experience (model picker, context management).
- More battle-tested for day-to-day coding.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source                                                                                                                                                            |
| ----------------------------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.263 | 2024-05-22 | Aider, *How aider scored SOTA 26.3% on SWE Bench Lite*, aider.chat/2024/05/22/swe-bench-lite.html — pass@1 with GPT-4o + Opus on the 300-instance SWE-bench Lite subset. |

Note: Aider has not published a SWE-bench Verified-split-specific
number. The Lite subset overlaps Verified for the easier-issue tail, so
the Lite number is used here as the Verified-split proxy. If Aider
publishes a Verified-split run, replace this reading.

## Should we wrap Aider instead?

Rule #1 (don't reinvent) requires every direct-competitor study to end with one question: *if this tool is great at everything we do, why not just wrap it and let it run for 24 hours?*

For Aider the honest answer is that the wrap already exists in part. Minsky **does** wrap Aider as its `local_agent` (configured in `~/.minsky/config.json` as `aider` plus `ollama_chat/qwen3-coder:30b`; see `AGENTS.md § Agent support matrix`). So the real question is not "should we wrap it at all?" but "should we wrap it *more* — hand it the orchestrator layer too?"

An adapter, used below, is a small wrapper file that lets Minsky talk to one outside tool through a fixed interface, so the tool can be swapped without touching the rest of the code (`novel/adapters/`).

| Question | Output |
|---|---|
| 1. **Architectural fit** | Good as an **agent backend**, poor as an **orchestrator replacement**. Aider is a pair-programming command-line tool invoked per session; it has no daemon, no task list, and no cross-repo loop. It already slots cleanly behind Minsky's agent seam via `--message-file` (`AGENTS.md § Brief delivery`). It cannot host the loop, the supervisor (the outer watchdog that restarts Minsky if it dies), or the budget guard — those are exactly the layers Aider declines to build (Gauthier's "Aider is for *pairing*, not autonomy"). |
| 2. **What we delegate** | **The single-iteration code edit** — exactly what we already delegate when `local_agent: aider`. Aider owns: repo-map context assembly, diff-format patch generation, git commit. We keep delegating this for the zero-cloud-token path. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution-plus-CI, MAPE-K substrate, cross-repo fleet, `TASKS.md` surface). Aider has none of these — it is the *inner* loop Minsky drives, not a competitor for the *outer* loop. Wrapping it more deeply (making it the default local backend) erodes zero moats and is already the design. |
| 4. **Net moat after wrap** | 6 of 6 (Aider stays the local agent; no orchestrator surface is delegated). The action here is *technique absorption* — repo-map, diff-format, benchmark-driven prompt iteration — not a structural handoff. |
| 5. **Verdict** | **NO orchestrator wrap; YES keep-and-deepen the existing agent wrap.** Aider remains Minsky's `local_agent`. Absorb its repo-map context strategy and diff-format prompting into the brief Minsky hands every agent. No P0 wrap task is filed — the wrap that makes sense already exists. |

**Trigger for re-evaluation**: if Aider ships a persistent or unattended mode — a daemon, a task list, or a `--watch`-driven autonomous loop — that contradicts Gauthier's current pairing stance, re-run this analysis. That would make Aider an orchestrator-tier competitor, not just a local agent.

## Five pivot questions

### 1. How is it different from Minsky?

Aider is an **interactive pair-programming tool** that does the editing. Minsky is a **24/7 daemon** — a background program that keeps running — that drives agents (including Aider) through a to-do list across many repositories.

Aider's intent, stated repeatedly by maintainer Paul Gauthier, is to make a human-plus-LLM pair *fast and precise* at the terminal — not to remove the human. Minsky's intent is to keep a fleet of repositories improving *without* a human in the loop, under a constitution (the numbered, non-negotiable project rules in `vision.md`) enforced by CI.

They are not peers. Aider is the kind of inner-loop agent Minsky *wraps* — and already does, as its `local_agent` — just as it wraps Claude and Devin. The defining difference is the human: Aider keeps the human at the wheel by design, while Minsky exists precisely to run the autonomous outer loop Aider declines to build.

### 2. What lessons can it give to us?

- **Repo-map as the context strategy** (aider.chat docs § "Repository map") — Aider builds a ranked, token-budgeted map of the repo's symbols (via tree-sitter) and feeds *that* to the model instead of raw files. This is the single most portable Aider technique for Minsky: the brief Minsky hands an agent could carry a repo-map rather than flat file blobs, improving context quality per token. A candidate for a context-assembly adapter behind `novel/adapters/` (rule #2, dependency coverage through adapters).
- **Diff/edit-format prompting** (aider.chat docs § "Edit formats"; `--edit-format diff`) — Aider's benchmarks show that asking the model for a unified-diff-shaped patch, rather than a whole-file rewrite, measurably raises both correctness and token efficiency. Minsky already uses `--edit-format diff` for the Aider backend. The lesson generalizes: every agent brief should prefer diff-shaped output where the backend supports it.
- **Benchmark-driven prompt iteration** (aider.chat blog, the recurring "leaderboard" and "code editing benchmark" posts) — Gauthier treats prompt and edit-format changes as falsifiable experiments measured against a fixed SWE-bench-shape harness, keeping only the changes that move the number. This is rule #9 (pre-registered hypothesis-driven development — stating a change's hypothesis, success threshold, pivot threshold, measurement command, and literature anchor before writing code) practiced in the wild by the most-used command-line agent. Independent confirmation that Minsky's measurement discipline is right, not an idiosyncrasy.
- **The "explicitly NOT fully autonomous" stance as a strategic signal** — Gauthier publicly resists over-agentic behaviour, arguing that autonomy without a human reviewer degrades quality on real codebases. This is a *negative* lesson worth recording: the maintainer of the gold-standard CLI agent believes the autonomy framing has a quality ceiling. Minsky's answer is not "ignore him" but "the constitution plus the CI merge gate IS the reviewer" — Minsky substitutes a deterministic gate for the human Aider keeps in the loop.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — but one lesson was examined as a candidate and rejected, which is the point of asking.**

The hypothesis behind this study was that Aider's "explicitly NOT autonomous" stance (above) might force a rewrite of Minsky's autonomy claims in `vision.md § What Minsky is`. On inspection it does not. Gauthier's objection is to *autonomy without review*, and Minsky does not propose autonomy without review — it replaces the *human* reviewer with a *deterministic* one: the 17-rule constitution enforced by `pnpm pre-pr-lint --stage=full` plus the pull-request merge gate.

Aider keeps a human reviewer because it has no such gate. Minsky's moat #3 (constitution-as-CI) is the answer to exactly the quality-ceiling concern Gauthier raises. So the stance *sharpens* Minsky's vision rather than contradicting it: the load-bearing claim is not "no reviewer" but "a machine reviewer that never sleeps".

The repo-map, diff-format, and benchmark-iteration lessons are all technique- or strategy-level — a context adapter, a prompting default, a confirmation of existing discipline. None touches the 17 rules. Recommendation: **absorb the repo-map and diff-format techniques; no vision change.**

### 4. How can we improve our strategy based on this?

- **Make context assembly an explicit, measurable seam** — Aider's strongest, most-cited result is that repo-map context beats flat-file context. Strategy move: expose Minsky's brief/context-assembly as an adapter boundary (rule #2) so retrieval quality can be measured and improved independently of the agent. Traces to lesson §2.1.
- **Default every brief to diff-shaped output where supported** — Aider proved diff-format raises correctness and cuts tokens. Strategy move: keep `--edit-format diff` for the Aider backend and generalize the "prefer a reviewable patch, not a whole-file rewrite" instruction across all agent briefs. Traces to lesson §2.2.
- **Frame the constitution-as-reviewer narrative explicitly** — Gauthier's autonomy skepticism is the most common objection to the *whole category* Minsky is in. Strategy move: lead the README and positioning with "the merge gate is the reviewer", so the autonomy claim always travels with its quality control and pre-empts the exact critique the gold-standard agent's maintainer raises. Traces to lesson §2.4.
- **Treat Aider's leaderboard as a free external benchmark** — Aider continuously benchmarks edit-formats and models. Strategy move: cite Aider's published numbers in the M1.10 corpus scorecard rather than re-running an equivalent harness (rule #1 — don't reinvent the benchmark). Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **The loop**: KEEP — Aider has no daemon, task list, or loop; nothing to replace. This is the surface Aider's maintainer explicitly declines to build.
- **MAPE-K**: KEEP — Aider has no self-improvement substrate.
- **Adapters / agent backend**: ALREADY-WRAPPED + AUGMENT — Aider IS Minsky's `local_agent` (the wrap already exists). Additionally absorb the repo-map and diff-format techniques as a context adapter behind `novel/adapters/`. The seam is the brief/context-assembly step before the agent starts, plus the existing `--message-file` delivery.
- **Sandbox**: N/A — out of Aider's scope.
- **Corpus / scorecard**: KEEP + CITE — Aider stays in the M1.10 corpus (`novel/competitive-benchmark/src/competitors.ts`); cite its published leaderboard numbers rather than re-running the harness.
- **Dashboard / `TASKS.md` surface**: KEEP — Aider has neither a fleet dashboard nor a task list.

**Total replace across all surfaces: 0% orchestrator replacement.** Aider already fills the local-agent slot, with one AUGMENT on the context adapter; everything else is KEEP or N/A. The headline for the operator (the human who runs Minsky): *nothing in the orchestrator to replace; Aider already is the local agent; one technique — repo-map context — to absorb.*

## Last reviewed

2026-06-01 — deepened with `## Should we wrap Aider instead?` and `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-aider`. Verdict: KEEP Aider as Minsky's `local_agent`; absorb the repo-map context strategy and diff-format prompting; no vision change — Gauthier's "not fully autonomous" stance sharpens rather than contradicts Minsky's constitution-as-reviewer claim.

Earlier reviews: 2026-05-22 (initial entry plus scorecard reading).
