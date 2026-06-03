# Competitor: Augment Code (Augment SWE-bench agent)

> Augment's open-source coding agent — the #1 published open-source agent on SWE-bench Verified at the time it was submitted. It is agent-scaffolding research, not a 24/7 system to operate.

- **URL**: <https://github.com/augmentcode/augment-swebench-agent> (open-source agent); <https://www.augmentcode.com> (commercial IDE product)
- **Status**: Active. Open-source agent repo created 2025-03-28; last pushed 2025-06-09; 872 stars / 154 forks at first scan. The commercial IDE product ("Cosmos" / "CLI") is separately active with subscription pricing.
- **Pricing**: Open-source agent — free, MIT-style OSS. Commercial product — subscription tiers on `augmentcode.com/pricing`.
- **Relationship**: **Competitor**. The SWE-bench agent overlaps Minsky's space directly. The commercial IDE is adjacent — it is an editor extension (VS Code / JetBrains / Neovim), not a background program that keeps running on your machine.

## What this is

Augment Code is two separate things under one name.

- **The open-source agent (`augmentcode/augment-swebench-agent`)** — a standalone coding assistant, written in Python (99.4% by language), that runs against the SWE-bench Verified benchmark. (An *agent* here means the coding assistant that does the actual work — like Claude Code, Devin, or Aider.) It scored **65.4% on SWE-bench Verified**, using Claude Sonnet 3.7 as the main driver and OpenAI o1 as an ensembler, published 2025-03-31. It was forked from Anthropic's own SWE-bench blog-post architecture. Its main difference from that post: it used Anthropic's `sequential-thinking` MCP tool to fill the planning gap Anthropic left out, plus o1 ensembling.
- **The commercial IDE product** — a code editor extension with a retrieval-aware context engine, for VS Code, JetBrains, and Neovim. The open-source agent above is the public benchmark artifact. The product line later shipped the **Auggie CLI** agent, whose **SWE-bench Pro** number (51.80%, 2026-02-04) is the vendor's current flagship reading — but on a different benchmark split than the Verified number the corpus tracks.

## What this is not

- **Not a background program (daemon).** The open-source agent is a one-shot benchmark runner: one Docker container per task, against a fresh clone. It does not keep running, restart itself, or pick its own next task. (A daemon is a program that keeps running in the background on your machine.)
- **Not run as you.** It runs in throwaway containers, not against your existing repos with your own git identity.
- **Not a multi-task system.** It is built for SWE-bench's one-issue-at-a-time, resolve-or-fail framing. There is no plain-text to-do list it walks.

## Strengths

- **Open-source agent at the top of the table** — at submission, the highest published open-source agent on SWE-bench Verified (65.4%). The implementation is fully reproducible from the GitHub repo.
- **Hybrid model ensembling** — using Sonnet 3.7 as the driver and o1 as the ensembler is a non-obvious design choice the team documented.
- **Honest about benchmark limits** — the launch post spells out SWE-bench's weaknesses (Python-only, smaller-than-production codebases, descriptive-task framing) and says "scores are largely driven by foundation model quality".
- **Production focus on the commercial side** — the IDE product adds Linear / Jira / Notion / Google Search / Slack integrations plus memory of developer feedback, none of which SWE-bench measures.

## Weaknesses vs Minsky's vision

1. **Not a daemon.** The open-source agent is a benchmark runner (Docker per task, fresh clone). It does not keep running or watch over itself.
2. **No operator-machine identity.** It runs in Docker against fresh clones, not against your existing repos under your own git credentials. (The *operator* is the human who runs Minsky — you. Work runs as you, under your name.)
3. **OpenAI dependency.** The published 65.4% uses o1 as the ensembler, so it is not a Claude-only path; swap o1 out and the published number changes.
4. **One task at a time.** It is built for SWE-bench's per-issue resolve-or-fail evaluation. There is no `TASKS.md`-style to-do list (the plain-text Markdown to-do list Minsky reads to pick work), and no work-stealing across tasks.
5. **No self-improvement.** The architecture is fixed (forked from Anthropic's blog post). There is no MAPE-K loop — the Monitor / Analyze / Plan / Execute self-improvement loop over a stored Knowledge base — and no prompt-evolution loop or specification monitor.
6. **No safety substrate.** There is no scope-leak detector (a check that flags when the agent changes files outside the ones the task declared), no budget management, and no watchdog kill-switch beyond the Docker timeout.

## What we learn / steal

- **Sequential-thinking MCP for planning** — Augment found Anthropic's `sequential-thinking` MCP filled the same role as Anthropic's unpublished planning tool. Minsky's Researcher and Manager personas already use a similar shape. (A *persona* is a role the agent takes on — researcher, planner, implementer, QA.) The reusable lesson: validate that the agent's output is structured, not free-text "thinking".
- **Honest benchmark-limitation framing** — the launch post's "this benchmark leans toward small-bug fixes; task descriptions are unrealistically LLM-friendly" is a model for how Minsky's own competitive-benchmark README should caveat published numbers.
- **Open-source reproducibility as a credibility move** — Augment shipped the agent source the same day it announced the score. Minsky's `bin/minsky competitive` JSON plus the `competitors.ts` citations are the same shape, applied to the corpus instead of to an agent.

## Why choose Minsky over Augment Code

- **It keeps running.** Minsky is a daemon that outlives any one task; Augment's open-source agent runs once per task and stops.
- **It walks a to-do list.** `TASKS.md` is the surface you point Minsky at, not a single SWE-bench issue per spawn.
- **It improves itself.** Minsky runs a MAPE-K self-improvement loop plus prompt evolution; Augment's 65.4% is a fixed architecture.
- **It is not locked to one vendor.** Minsky's adapter substrate works with Claude, Devin, and aider + a local model; Augment's published number depends on the Sonnet + o1 pairing.
- **It runs as you.** Augment runs in Docker against fresh clones; Minsky commits as you, into your existing repos.

## Why choose Augment Code over Minsky

- **For isolated, SWE-bench-style task running** — the published 65.4% Verified resolve rate is a reproducible baseline.
- **For an honest, well-documented agent to study** — open-source, clear architecture, no marketing fog around the benchmark approach.
- **For a mature editor experience** — the commercial product ships VS Code / JetBrains / Neovim extensions, Linear/Jira/Notion integrations, and memory of developer feedback over time.
- **If you want a benchmarkable scaffolding to study rather than a system to operate around the clock.**

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `swe-bench-verified-resolve-rate`   | 0.654 | 2025-03-31 | Chen & Flaherty, "#1 open-source agent on SWE-Bench Verified by combining Claude 3.7 and O1", augmentcode.com/blog, 2025-03-31 (Claude Sonnet 3.7 driver + o1 ensembler; methodology forked from Anthropic SWE-bench post + sequential-thinking MCP; reproducible at github.com/augmentcode/augment-swebench-agent) — **stale-by-vendor**: still Augment's last SWE-bench *Verified* submission |

**Why the Verified reading is not re-dated** (`corpus-refresh-augment-code` Pivot path): Augment has not published a new SWE-bench *Verified* number since 2025-03-31, so the scorecard's Verified cell stays pinned to that publication rather than masking the staleness with a re-stamped date. The vendor's benchmarking attention has since moved to a **different split**: Auggie CLI scored **51.80% on Scale AI's SWE-bench Pro** (379 of 731 problems, Claude Opus 4.5 driver), per the primary vendor post ["Auggie tops SWE-Bench Pro"](https://www.augmentcode.com/blog/auggie-tops-swe-bench-pro) (augmentcode.com/blog, 2026-02-04). SWE-bench Pro is not yet a registered metric in `novel/competitive-benchmark/src/metrics.ts`, so it is captured here and in the `competitors.ts` citation as evidence-of-pivot rather than added as a new `values` reading — adding the metric would be a separate scope. The 51.80% beat Cursor (50.21%), Claude Code (49.75%), and OpenAI Codex (46.47%), all running the same Claude Opus 4.5 model; the gap is attributed to Augment's semantic Context Engine.

## Should we wrap Augment Code instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with one question: *if this is great at everything we do, why not just wrap it and run it for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as an orchestrator replacement, marginal as an agent backend. The open-source agent is a single-task benchmark runner with no daemon, no queue, and no cross-repo loop. It cannot host Minsky's loop, supervisor, or budget-guard layers. |
| 2. **What we delegate** | Only the single-task code edit — the same slot Minsky already fills with Claude, Devin, or aider. Augment's agent adds an o1 ensembler and a fixed forked architecture, which conflicts with Minsky's multi-vendor adapter substrate. |
| 3. **What we keep** | All six moats survive: daemon-not-framework, operator-machine identity, constitution + CI, the MAPE-K substrate, the cross-repo fleet, and the `TASKS.md` surface. Augment's open-source agent has none of these. |
| 4. **Net moat after wrap** | 6 of 6 (no orchestrator surface is delegated). The only thing worth absorbing is technique — structured planning output and honest benchmark caveats — not a structural delegation. |
| 5. **Verdict** | **NO wrap.** The open-source agent is a benchmark artifact, not a system to operate. Absorb its sequential-thinking-for-planning lesson and its honest benchmark framing; do not delegate the orchestrator layer. No wrap task is filed. |

## Five pivot questions

### 1. How is it different from Minsky?

Augment's open-source agent is an agent-tier benchmark runner: one task, one Docker container, one fresh clone, then it stops. Minsky is an orchestrator-tier daemon that keeps running on your machine, walks a `TASKS.md` to-do list across one or more repos, drives an agent to do each item, and prepares a draft for you to review. The defining difference is persistence and identity: Augment runs once in a throwaway container; Minsky runs continuously, as you, against your real repos.

### 2. What lessons can it give to us?

- **Structured planning output beats free-text thinking** — Augment used the `sequential-thinking` MCP to fill Anthropic's planning gap. The portable lesson is to validate that an agent emits *structured* plan output, not loose prose. Minsky's Researcher and Manager personas already aim at this shape.
- **Honest benchmark caveats build trust** — the launch post's plain statement that SWE-bench leans toward small bug fixes and LLM-friendly task descriptions is a model for how Minsky's competitive-benchmark README should qualify every published number.
- **Reproducibility is a credibility move** — shipping the agent source the same day as the score is what made the 65.4% believable. Minsky's `bin/minsky competitive` JSON and `competitors.ts` citations are the same move, applied to the corpus.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons are technique- or strategy-level: a structured-output validator, a benchmark-caveat convention, and a reproducibility practice Minsky already follows. None touches the 17 constitutional rules. The strongest candidate — that a fixed, well-tuned single-architecture agent can top a benchmark — actually reinforces Minsky's multi-vendor stance rather than contradicting it: Augment's number is pinned to the Sonnet + o1 pairing and goes stale the moment either model is swapped, which is exactly the lock-in Minsky's adapter substrate avoids.

### 4. How can we improve our strategy based on this?

- **Require structured plan output at the brief boundary** — generalize the sequential-thinking lesson so every agent brief asks for a structured plan, not free-text reasoning. Traces to lesson §2.1.
- **Caveat every corpus number with its methodology** — match Augment's honesty by never quoting a competitor's best number without its split and qualifier. Traces to lesson §2.2.
- **Keep reproducibility as a first-class output** — keep `bin/minsky competitive` JSON plus citations as the credibility artifact for the corpus. Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **loop / scheduler**: KEEP — Augment has no daemon or queue; nothing to replace.
- **MAPE-K**: KEEP — no self-improvement substrate exists in Augment's agent.
- **adapters / agent backend**: KEEP — Augment's agent is locked to a Sonnet + o1 pairing, which conflicts with Minsky's multi-vendor substrate; absorb the structured-planning technique instead.
- **sandbox**: N/A — out of Augment's open-source scope beyond the Docker timeout.
- **corpus / scorecard**: KEEP + CITE — Augment stays in the corpus (`novel/competitive-benchmark/src/competitors.ts`); cite its published numbers rather than re-running the harness.
- **TASKS.md surface**: KEEP — Augment has no queue or to-do-list surface.

**Total replace % across all surfaces: 0%.** The headline for the operator: *nothing to replace; absorb the structured-planning and benchmark-honesty techniques, and cite the number in the corpus.*

## Last reviewed

2026-06-02 (refreshed via `corpus-refresh-augment-code`: Verified reading held stale-by-vendor; SWE-bench Pro 51.80% recorded as evidence-of-pivot)
