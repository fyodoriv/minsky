# Competitor: Aider

> Best-in-class CLI for AI pair programming with local models — used by Minsky as the `local_agent` for zero-cloud-token mode.

- **URL**: <https://aider.chat> / <https://github.com/Aider-AI/aider>
- **Status**: Active, "the tool to benchmark against" (HN), battle-tested CLI
- **Pricing**: Free (OSS, Apache 2.0). Model costs only.
- **Relationship**: **Integration** — minsky uses aider as its local-model agent

## What it is

AI pair programming in your terminal. Best-in-class local model support. Works with Claude, GPT-4, Gemini, and any OpenAI-compatible local model (ollama, LM Studio, etc). Diff-based editing, git-native, minimal footprint. The gold standard for CLI-first AI coding.

## Strengths

- **Best local model support** — works with 100+ models including all ollama models. No other tool matches this breadth.
- **Fast and lightweight** — pip install, no Docker, no cloud dependency
- **Git-native** — auto-commits, understands repo structure, respects .gitignore
- **Battle-tested** — years of production use, massive HN/community following
- **Diff-based editing** — precise, reviewable changes (not whole-file rewrites)
- **Multi-file editing** — can edit multiple files in a single turn
- **Cost-efficient** — smart context management, caching, minimal token waste
- **SWE-bench competitive** — publishes scores, competitive with cloud-only agents

## Weaknesses vs minsky's vision

1. **Interactive-first** — designed for pair programming, not autonomous background operation. No daemon mode.
2. **No task queue** — works on what you tell it right now. No TASKS.md processing, no queue drain.
3. **No supervision** — no budget management, no watchdog, no automatic restart.
4. **No multi-agent** — one aider instance at a time. No brain+workers.
5. **No self-improvement** — no MAPE-K loop, no prompt optimization.
6. **No PR creation** — edits files and commits, but doesn't create PRs or run CI.
7. **No cross-repo** — one repo at a time.

## What we learn / steal

- **Local model integration** — minsky uses aider as its local agent precisely because aider's model support is unmatched.
- **Diff-based editing** — aider's `--edit-format diff` is more efficient than whole-file. Minsky's brief should prefer this.
- **`--no-auto-commits`** — minsky uses this to control when commits happen.
- **Message-file input** — aider reads briefs from `--message-file`, minsky composes with this.

## Why choose minsky over Aider

- 24/7 autonomous operation (daemon + queue)
- Multi-agent orchestration (cloud brain + local workers)
- TASKS.md queue processing
- PR creation and merge gate
- Budget management
- Self-improving

## Why choose Aider over minsky

- Better for interactive pair programming
- Simpler — no daemon, no config, just `aider`
- Better local model UX (model picker, context management)
- More battle-tested for daily coding

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source                                                                                                                                                            |
| ----------------------------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.263 | 2024-05-22 | Aider, *How aider scored SOTA 26.3% on SWE Bench Lite*, aider.chat/2024/05/22/swe-bench-lite.html — pass@1 with GPT-4o + Opus on the 300-instance SWE-bench Lite subset. |

Note: Aider has not published a SWE-bench Verified-split-specific
number. The Lite subset overlaps Verified for the easier-issue tail, so
the Lite number is used here as the Verified-split proxy. If Aider
publishes a Verified-split run, replace this reading.

## Should we wrap Aider instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here. For Aider the answer is partly already true — Minsky **does** wrap Aider as its `local_agent` (`~/.minsky/config.json` → `aider` + `ollama_chat/qwen3-coder:30b`, `AGENTS.md § Agent support matrix`). The question below is therefore "wrap it *more* — replace the orchestrator layer too?" not "wrap it at all".

| Question | Output |
|---|---|
| 1. **Architectural fit** | Good as an **agent-tier backend**, poor as an **orchestrator replacement**. Aider is a single-turn-to-multi-turn pair-programming CLI invoked per session; it has no daemon, no queue, no cross-repo loop. It already slots cleanly behind Minsky's agent seam via `--message-file` (`AGENTS.md § Brief delivery`). It cannot host the tick-loop / supervisor / budget-guard layers — those are the layers Aider explicitly declines to build (Gauthier's "Aider is for *pairing*, not autonomy"). |
| 2. **What we delegate** | **The single-iteration code edit** — exactly what we already delegate when `local_agent: aider`. Aider owns: repo-map context assembly, diff-format patch generation, git commit. We keep delegating this for the zero-cloud-token path. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface). Aider has none of these — it is the *inner* loop Minsky drives, not a competitor for the *outer* loop. Wrapping it more deeply (e.g. making it the default local backend) erodes zero moats and is already the design. |
| 4. **Net moat after wrap** | 6 of 6 (Aider stays the local agent; no orchestrator surface is delegated). The relevant action is *technique absorption* (repo-map, diff-format, benchmark-driven prompt iteration), not a structural delegation. |
| 5. **Verdict** | **NO orchestrator wrap; YES keep-and-deepen the existing agent-tier wrap.** Aider remains Minsky's `local_agent`; absorb its repo-map context-window strategy and diff-format prompting into the brief Minsky hands every agent. No P0 wrap task is filed — the wrap that makes sense already exists. |

**Trigger for re-evaluation**: if Aider ships a persistent / unattended mode (a daemon, a queue, a `--watch`-driven autonomous loop) that contradicts Gauthier's current pairing stance, re-run this analysis — that would make Aider an orchestrator-tier competitor, not just a local agent.

## Five pivot questions

### 1. How is it different from Minsky?

Aider is an **agent-tier, interactive pair-programming CLI**; Minsky is an **orchestrator-tier 24/7 daemon** that drives agents (including Aider) on a queue across repos. Aider's intent, stated repeatedly by maintainer Paul Gauthier, is to make a human + LLM pair *fast and precise* at the terminal — not to remove the human. Minsky's intent is to keep a fleet of repos improving *without* a human in the loop, under a constitution enforced by CI. They are not peers: Aider is the kind of inner-loop agent Minsky *wraps* (and already does, as its `local_agent`), the way it wraps Claude and Devin. The defining structural difference is the human: Aider keeps the human at the wheel by design; Minsky's whole reason to exist is the autonomous, unattended outer loop Aider declines to build.

### 2. What lessons can it give to us?

- **Repo-map as the context-window strategy** (aider.chat docs § "Repository map") — Aider builds a ranked, token-budgeted map of the repo's symbols (via tree-sitter) and feeds *that* to the model instead of raw files. This is the single most-portable Aider technique for Minsky: the brief Minsky hands an agent could carry a repo-map rather than flat file blobs, improving context quality per token. Candidate for a context-assembly adapter behind `novel/adapters/` (rule #2).
- **Diff/edit-format prompting** (aider.chat docs § "Edit formats"; `--edit-format diff`) — Aider's benchmarks show that *asking the model for a unified-diff-shaped patch* (vs whole-file rewrite) measurably raises both correctness and token efficiency. Minsky already uses `--edit-format diff` for the aider backend; the lesson generalizes — every agent brief should prefer diff-shaped output where the backend supports it.
- **Benchmark-driven prompt iteration** (aider.chat blog, the recurring "leaderboard" + "code editing benchmark" posts) — Gauthier treats prompt/edit-format changes as falsifiable experiments measured against a fixed SWE-bench-shape harness, keeping only the changes that move the number. This is rule #9 (pre-registered HDD) practiced in the wild by the most-used CLI agent — independent confirmation that Minsky's measurement discipline is the right one, not an idiosyncrasy.
- **The "explicitly NOT fully autonomous" stance as a strategic signal** — Gauthier publicly resists over-agentic behaviour, arguing autonomy without a human reviewer degrades quality on real codebases. This is a *negative* lesson worth recording: the maintainer of the gold-standard CLI agent believes the autonomy framing has a quality ceiling. Minsky's answer is not "ignore him" but "the constitution + CI merge-gate IS the reviewer" — Minsky substitutes a deterministic gate for the human Aider keeps in the loop.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — but one lesson was examined as a candidate and rejected, which is the point of asking.** The Hypothesis behind this task was that Aider's "explicitly NOT autonomous" stance (Q3) might force a rewrite of Minsky's autonomy claims in `vision.md § What Minsky is`. On inspection it does not: Gauthier's objection is to *autonomy without review*, and Minsky does not propose autonomy without review — it replaces the *human* reviewer with a *deterministic* one (the 17-rule constitution enforced by `pnpm pre-pr-lint --stage=full` + the PR merge gate). Aider keeps a human reviewer because it has no such gate; Minsky's entire moat #3 (constitution-as-CI) is the answer to exactly the quality-ceiling concern Gauthier raises. So the stance *sharpens* Minsky's vision rather than contradicting it: the load-bearing claim is not "no reviewer" but "a machine reviewer that never sleeps". The repo-map, diff-format, and benchmark-iteration lessons are all technique/strategy-level (a context adapter, a prompting default, a confirmation of existing discipline) — none touches the 17 rules. A negative finding is recorded here in the doc per the deep-research convention (this task's brief explicitly routes operator questions centrally rather than into this file); recommendation: **absorb the repo-map + diff-format techniques, no vision change**.

### 4. How can we improve our strategy based on this?

- **Make context assembly an explicit, measurable seam** — Aider's strongest, most-cited result is that *repo-map context beats flat-file context*. Strategy move: expose Minsky's brief/context-assembly as an adapter boundary (rule #2) so retrieval quality is measurable and improvable independently of the agent. Traces to lesson §2.1.
- **Default every brief to diff-shaped output where supported** — Aider proved diff-format raises correctness + cuts tokens. Strategy move: keep `--edit-format diff` for the aider backend and generalize the "prefer a reviewable patch, not a whole-file rewrite" instruction across all agent briefs. Traces to lesson §2.2.
- **Frame the constitution-as-reviewer narrative explicitly** — Gauthier's autonomy skepticism is the most common objection to the *whole category* Minsky is in. Strategy move: lead the README/positioning with "the merge gate is the reviewer" so the autonomy claim is paired with its quality control, pre-empting the exact critique the gold-standard agent's maintainer raises. Traces to lesson §2.4.
- **Treat Aider's leaderboard as a free external benchmark** — Aider continuously benchmarks edit-formats and models. Strategy move: cite Aider's published numbers in the M1.10 corpus scorecard rather than re-running an equivalent harness (rule #1 — don't reinvent the benchmark). Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Aider has no daemon/queue/loop; nothing to replace. This is the surface Aider's maintainer explicitly declines to build.
- **MAPE-K**: KEEP — no self-improvement substrate exists in Aider.
- **adapters / agent backend**: ALREADY-WRAPPED + AUGMENT — Aider IS Minsky's `local_agent` (the wrap already exists); additionally absorb the repo-map + diff-format techniques as a context adapter behind `novel/adapters/`. Seam: the brief/context-assembly step before agent spawn, and the existing `--message-file` delivery.
- **sandbox**: N/A — out of Aider's scope.
- **corpus / scorecard**: KEEP + CITE — Aider stays in the M1.10 corpus (`novel/competitive-benchmark/src/competitors.ts`); cite its published leaderboard numbers rather than re-running the harness.
- **dashboard / TASKS.md surface**: KEEP — Aider has neither a fleet dashboard nor a queue surface.

**Total replace % across all surfaces: 0% orchestrator replacement** (Aider already fills the local-agent slot, and one AUGMENT on the context adapter; everything else KEEP/N/A). The headline for the operator: *nothing in the orchestrator to replace; Aider already is the local agent; one technique (repo-map context) to absorb.*

## Last reviewed

2026-06-01 — deepened with `## Should we wrap Aider instead?` + `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-aider`. Verdict: KEEP Aider as Minsky's `local_agent`; absorb repo-map context-window strategy + diff-format prompting; no vision change — Gauthier's "not fully autonomous" stance sharpens rather than contradicts Minsky's constitution-as-reviewer claim (negative finding logged inline per this task's central-questions routing).

Earlier reviews: 2026-05-22 (initial entry + scorecard reading).
