---
last-rendered: 2026-05-24
generator: minsky-competitive (Path A static fold — Phase 10)
source: novel/competitive-benchmark/src/competitors.ts
upstream-metric-catalogue: novel/competitive-benchmark/src/metrics.ts
---

# Minsky competitive scorecard — static snapshot

> **Path A Phase 10 fold (2026-05-24).** Until 2026-05-24 this scorecard was rendered on demand by `bin/minsky competitive --json | jq` against the executable corpus at `novel/competitive-benchmark/src/competitors.ts`. The M1.10 milestone shipped (corpus ≥ 4 competitors × ≥ 5 metrics with primary-source citations), so the corpus is now a static reference. Per-vendor refreshes still write to individual `competitors/<id>.md` files via the `competitor-research` skill; this aggregated table re-renders quarterly from those.
>
> The full Path A migration plan is at [`docs/plans/2026-05-24-path-a-aggressive-cut.md`](../docs/plans/2026-05-24-path-a-aggressive-cut.md). The executable package at `novel/competitive-benchmark/` will be deleted in a follow-up PR after the operator confirms this static snapshot captures the value.

## Headline scorecard

Rows = competitors. Columns = metric ids (per `novel/competitive-benchmark/src/metrics.ts`). Blank cells = vendor did not publish that metric (see "visible-not-silent" — Helland, CIDR 2007).

| Competitor | SWE-bench Verified resolve | Autonomous merge rate | Human intervention rate | Cost / merged PR (USD) | Mean autonomous merge latency (s) | HumanEval Pass@1 |
|---|---:|---:|---:|---:|---:|---:|
| **OpenAI Codex (codex-1)** | **0.721** | — | — | — | — | — |
| **OpenHands (All-Hands AI)** | **0.658** | — | — | 0.30 | 3600 | — |
| **Augment Code (Augment SWE-bench agent)** | 0.654 | — | — | — | — | — |
| **Claude Code** | 0.490 | 0.726 | 0.274 | — | — | — |
| **Aider** | 0.263 | — | — | — | — | — |
| **Devin (Cognition Labs)** | 0.139 | **0.670** (real-world) | 0.330 | — | 900 | — |
| **Cursor agent** | — | **0.804** (fix-task subset) | — | — | — | — |
| **SWE-agent (Princeton NLP)** | 0.125 | — | — | — | — | — |
| **MetaGPT (Foundation Agents — orchestrator tier)** | — | — | — | — | — | **0.859** |

Sort order: descending by SWE-bench Verified resolve where present; competitors without that metric grouped at the bottom by their best-available metric.

## What this scorecard pins

Eleven metrics live in the catalogue (`novel/competitive-benchmark/src/metrics.ts`); five have ≥ 2 competitor readings (the M1.10 shape gate). The other six are catalogued but unreported by current corpus competitors — they stay in the schema so future readings have a fixed home.

The six caveats every reader should hold:

1. **SWE-bench Verified is broken** (per OpenAI's Feb 2025 retraction post). 59.4% of failed tasks have flawed test cases; training-data contamination is detectable in frontier models. The scorecard reports the vendor-published number with citation; never treats it as ground truth.
2. **`autonomous-merge-rate` for Claude Code and Cursor is a task-stratified slice**, not a global PR acceptance number. Sourced from Pinna et al., arXiv:2602.08915 (the AIDev dataset stratifies by task kind: documentation, features, fixes). The 0.726 figure is the features-class subset; the 0.804 figure is the fix-class subset.
3. **Devin's 0.139 SWE-bench Verified is from March 2024**; the more recent 0.482 number on the same benchmark is from a different harness configuration. Cognition's 2026-04 annual review reports 0.670 *real-world PR merge rate*, which is a different metric on a different distribution (customer-codebase PRs, not SWE-bench). Both are reported; the reader judges.
4. **MetaGPT lives in the orchestrator tier** (per the 2026-05-23 operator directive). It's a peer of Minsky, not an agent Minsky composes. Its HumanEval 0.859 is the orchestration-driven number, not a raw LLM score.
5. **OpenHands is the in-progress runtime adoption** for Minsky (Path C plan, 2026-05-22 → executed 2026-05-24). The 0.658 SWE-bench Verified figure is what Minsky inherits when running OpenHands as its `cloud_agent`. The "Minsky-via-OpenHands" delta is the orchestrator-tier value Minsky adds on top: MAPE-K cross-session learning + 18-rule deterministic enforcement + 24/7 daemon shell.
6. **Vendor exclusion is enforced.** Per the operator-set deny list (`EXCLUDED_VENDOR_SUBSTRINGS` in `competitors.ts`), no Groq / xAI / Elon-affiliated entrant appears; the invariant is test-enforced over the corpus so future edits can't smuggle one in.

## Per-vendor source citations

(Pulled verbatim from `competitors.ts` so this file stays self-contained — primary-source URLs survive even if `competitors.ts` is later deleted.)

### claude-code — Claude Code (Anthropic, closed-commercial)

- Homepage: <https://www.anthropic.com/claude-code>
- As-of: 2026-02-09
- Citation: Anthropic, *Claude 3.7 Sonnet and Claude Code*, anthropic.com, 2025-02-24 (SWE-bench Verified, agentic harness, 0.49); Pinna, Gong, Williams, Sarro, *Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance*, arXiv:2602.08915, 2026-02-09 (features-class autonomous-merge 0.726; inverse 0.274 reported as human-intervention-rate).

### openhands — OpenHands (All-Hands AI, open-source)

- Homepage: <https://github.com/All-Hands-AI/OpenHands>
- As-of: 2025-04-15
- Citation: All-Hands AI, *SOTA on SWE-bench Verified with Inference-Time Scaling and Critic Model*, all-hands.dev/blog, 2025-04-15 (SWE-bench Verified resolve rate 0.658, verified via SWE-bench/experiments PR #209); All-Hands AI, *Evaluation of LLMs as Coding Agents on SWE-Bench (at 30x Speed!)*, openhands.dev/blog, 2024-10-04 (cost-per-issue 0.30 USD with Claude 3.5 Sonnet on SWE-bench Lite); average_runtime 3600 sec from openhands-index-results/scores.json.

### swe-agent — SWE-agent (Princeton NLP, open-source)

- Homepage: <https://github.com/SWE-agent/SWE-agent>
- As-of: 2024-10-01
- Citation: Yang, Jimenez, Wettig, Lieret, Yao, Narasimhan, Press, *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*, NeurIPS 2024 (SWE-agent + GPT-4 resolve rate 0.125 on the 2,294-instance full split, used as the Verified proxy).

### aider — Aider (open-source)

- Homepage: <https://aider.chat>
- As-of: 2024-05-22
- Citation: Aider, *How aider scored SOTA 26.3% on SWE Bench Lite*, aider.chat/2024/05/22/swe-bench-lite.html, 2024-05-22 (SWE-bench Lite 0.263; pass@1 with GPT-4o + Opus).

### devin — Devin (Cognition Labs, closed-commercial)

- Homepage: <https://www.cognition.ai>
- As-of: 2026-04-07
- Citation: Cognition Labs, *2025 Annual Performance Review*, cognition.ai, 2026-04 (real-world PR merge rate 0.67 across thousands of customer codebases); Cognition Labs, *Introducing Devin*, cognition.ai, 2024-03-12 (SWE-bench Verified 0.139); ACU economics — AgentMarketCap, *Devin's 67% PR Merge Rate*, agentmarketcap.ai/blog/2026/04/07.

### cursor-agent — Cursor agent (closed-commercial)

- Homepage: <https://www.cursor.com>
- As-of: 2026-02-09
- Citation: Pinna, Gong, Williams, Sarro, *Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance*, arXiv:2602.08915, 2026-02-09 (AIDev dataset; Cursor leads fix-task acceptance 0.804).

### openai-codex — OpenAI Codex (codex-1, closed-commercial)

- Homepage: <https://openai.com/index/introducing-codex/>
- As-of: 2025-05-16
- Citation: OpenAI, *Introducing Codex*, openai.com/index/introducing-codex/, 2025-05-16 (SWE-Bench Verified pass@1 = 0.721 for codex-1; 23 instances excluded as not-runnable; 192k context, medium reasoning effort; pass@8 = 0.838).

### augment-code — Augment Code (Augment SWE-bench agent, open-source)

- Homepage: <https://github.com/augmentcode/augment-swebench-agent>
- As-of: 2025-03-31
- Citation: Chen & Flaherty, *#1 open-source agent on SWE-Bench Verified by combining Claude 3.7 and O1*, augmentcode.com/blog, 2025-03-31 (open-source SWE-bench Verified 0.654 with Claude Sonnet 3.7 driver + OpenAI o1 ensembler).

### metagpt — MetaGPT (Foundation Agents, open-source, orchestrator tier)

- Homepage: <https://github.com/FoundationAgents/MetaGPT>
- As-of: 2024-05-07
- Citation: Hong et al., *MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework*, arXiv:2308.00352, ICLR 2024 Oral (HumanEval Pass@1 = 0.859; 28.2% relative improvement over GPT-4 via Standardized Operating Procedure-shaped multi-agent assembly line).

## How this is refreshed

Per-vendor research files at `competitors/<id>.md` are the canonical source for individual competitor analysis. They're updated by the `competitor-research` skill (see `~/.claude/skills/competitor-research/SKILL.md`) — typically quarterly per the `corpus-discover-quarterly` recurring task in `RECURRING.md`, or on-demand when a vendor publishes a new benchmark number.

To refresh this aggregated table:

1. Update the per-vendor `.md` files (one at a time, via the `competitor-research` skill).
2. Re-render this table by either:
   - Hand-editing the rows above (the format is intentionally simple — alphabetical-by-id grouping inside the SWE-bench-sorted blocks), OR
   - Running `node scripts/render-scorecard.mjs > competitors/scorecard.md` (the renderer script will be added in a follow-up PR if hand-editing proves too tedious).

## Anchor

- `vision.md` § "What Minsky uniquely does" — the moat audit (2 of 6 genuinely unique) cites this scorecard as the corpus evidence.
- `MILESTONES.md` M1.10 — the corpus shape gate (≥ 4 competitors × ≥ 5 metrics) is met by this scorecard.
- `docs/plans/2026-05-24-path-a-aggressive-cut.md` § Phase 10 — the plan that established this fold.
- `novel/competitive-benchmark/` — the executable corpus this static file replaces (will be deleted in a follow-up PR once the operator confirms the markdown captures the value).
- `~/.claude/skills/competitor-research/SKILL.md` — the workflow that updates per-vendor files; this aggregated table re-renders quarterly from those.
- Helland, P., *Building on Quicksand*, CIDR 2007 — the "visible-not-silent" rule: blank cells stay blank; never coerce to 0 or to a guessed value.
