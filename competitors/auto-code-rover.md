# Competitor: AutoCodeRover (NUS spin-off, acquired by Sonar)

> A research-grade autonomous program-improvement agent whose AST-aware code search + spectrum-based fault localization are worth absorbing, but whose OSS line went dormant after the team's February-2025 acquisition by Sonar — a post-mortem, not a live competitor.

- **URL**: <https://github.com/AutoCodeRoverSG/auto-code-rover>
- **Status**: **Stale / dormant** — last meaningful commit 2025-04-24 (403 days as of 2026-06-01, > 180-day post-mortem threshold); repo not formally archived; agent-tier research project, not a daemon
- **Pricing**: Free (the OSS repo carries a custom license — `NOASSERTION` per GitHub; model/API costs only). The successor capability is commercial inside Sonar's product line.
- **Relationship**: **Research benchmark (post-mortem)** — not a product to adopt or a fleet to wrap; a published technique (AST-aware retrieval + fault localization) to extract into Minsky's adapter/context layer

## What it is

AutoCodeRover is an LLM agent for *autonomous program improvement* — fixing GitHub-issue-shaped bugs and adding small features without a human in the loop. Its distinctive idea (ISSTA 2024, Zhang/Ruan/Fan/Roychoudhury) is that a software project is **not** a flat bag of files: the agent operates over the program's **abstract syntax tree**, and its code-search primitives are structure-aware (`search_class`, `search_method`, `search_code_in_file`) rather than raw grep. When a test suite is present, it layers **spectrum-based fault localization** (SBFL) on top to rank suspicious methods before the LLM ever proposes a patch. The pipeline is two-stage — *context retrieval* then *patch generation* — closer to Agentless's fixed-pipeline philosophy than to an open-ended agent loop, but with iterative re-search when the retrieved context is insufficient.

It began as a National University of Singapore (NUS) research spin-off (co-founders Ridwan Shariffdeen — CEO, Martin Mirchev — CTO, Yuntong Zhang & Haifeng Ruan — Co-Chief Scientific Officers, advised by Prof. Abhik Roychoudhury). On 2025-02-19 it was **acquired by Sonar** (SonarSource), after which the public OSS repository effectively stopped receiving development.

## Strengths

- **Program-structure-aware retrieval** — searching over the AST (classes/methods) instead of files measurably sharpens the context handed to the LLM, the paper's central, falsifiable claim
- **Spectrum-based fault localization** — when tests exist, SBFL narrows the suspect set *before* spending tokens, a principled (decades-old) signal most agent loops ignore
- **Cost discipline** — the headline economics are strong: < $0.70 per issue at the reported resolve rates, an order of magnitude cheaper than many agent loops
- **Reproducible, citable numbers** — peer-reviewed (ISSTA 2024) plus repo-published SWE-bench readings; honest, primary, datable
- **Two-stage pipeline** — context-then-patch is easy to reason about and to slot as a stage inside a larger orchestrator

## Weaknesses vs Minsky's vision

1. **Not a daemon** — AutoCodeRover is a per-issue agent invocation, not a persistent 24/7 supervisor. No overnight unattended loop, no budget management, no restart-on-crash (Minsky moats #1, #6 via `vision.md § Stay alive`).
2. **No operator-machine identity** — it is a research harness you run; commits/identity binding to the operator's `~/.gitconfig`/`gh` is not its concern (Minsky moat #2).
3. **No self-improvement loop** — the pipeline is fixed; there is no MAPE-K observer that tunes its own prompts from outcome history (Minsky moat #4).
4. **Single-repo, single-issue** — no cross-repo fleet, no round-robin across N hosts (Minsky moat #5).
5. **Dormant OSS line** — after the Sonar acquisition the public repo went quiet; the live capability now lives inside a closed commercial product, so the OSS artifact is a *technique source*, not a maintained dependency (Minsky rule #1 — adopt the pattern, not the abandoned code).

## What we learn / steal

- **AST-aware code search as an adapter, not a feature** — Minsky's context-assembly seam (the brief/spec the daemon hands an agent) could expose structure-aware retrieval primitives (`search_method`/`search_class`) as an *adapter* behind `novel/adapters/`, per rule #2, rather than passing flat file blobs. This is a portable pattern, not a product.
- **Spectrum-based fault localization as a pre-filter** — where a host repo has a test suite, an SBFL pass can rank suspect methods before the agent spawns, cutting tokens and tightening the brief. Decades-tested literature (Jones & Harrold, Abreu et al.) — exactly the "named pattern, not invented terminology" rule #5 wants.
- **Cost-per-issue as a first-class metric** — the <$0.70/issue framing maps directly onto Minsky's `cost-per-merged-pr` scorecard metric; AutoCodeRover's economics are a useful reference point for the corpus.
- **Two-stage context-then-patch** — a deterministic retrieval stage feeding a stochastic patch stage echoes Agentless's thesis (see `competitors/agentless.md`): orchestration should pay rent on hard tasks, not on retrieval that a fixed pipeline does cheaply.

## Post-mortem: why it died

- **Last meaningful commit**: 2025-04-24 ("Hotpatch (#92)" — a post-acquisition style-check touch-up; ~403 days dormant as of 2026-06-01). **Archived flag**: no (repo is read-mostly, not formally archived). **Vendor pivoted to**: **Sonar (SonarSource)** — <https://www.sonarsource.com/company/press-releases/sonar-acquires-autocoderover-to-supercharge-developers-with-ai-agents/>.
- **Root cause** (vendor-acquisition): the NUS spin-off team was acquired by Sonar on 2025-02-19; development effort moved into Sonar's commercial code-quality product and a new Singapore R&D team. The OSS repository is the typical post-acquisition outcome — left in place for citation and reproduction, but no longer the locus of work. This is *not* an architectural dead-end or a community collapse; the technique succeeded so thoroughly it was bought.
- **Evidence** (≥ 3 sources):
  1. Sonar press release, *Sonar Acquires AutoCodeRover to Supercharge Developers with AI Agents*, 2025-02-19 — <https://www.sonarsource.com/company/press-releases/sonar-acquires-autocoderover-to-supercharge-developers-with-ai-agents/> (the acquisition announcement; names Roychoudhury as Senior Advisor, 15 R&D jobs 2025–2026).
  2. NUS Computing news, *NUS-spinoff technology AutoCodeRover acquired by Sonar*, 2025-02 — <https://news.nus.edu.sg/nus-spinoff-tech-autocoderover-acquired-by-sonar/> (institutional confirmation + co-founder roster).
  3. The repo's own commit history — `gh api repos/AutoCodeRoverSG/auto-code-rover/commits` shows the final commit "Hotpatch (#92)" dated 2025-04-24, the last activity after the February acquisition; `pushed_at` has not advanced since.
- **Lesson for Minsky** (mandatory): Minsky's survival guardrail against *this* death mode is **rule #1 + the OSS-extractable-from-day-one discipline** combined with **operator ownership**. AutoCodeRover "died" as OSS because a single vendor owned the maintained line and an acquirer absorbed it — its users' workflow depended on a vendor's continued investment. Minsky inverts this: the daemon runs on the *operator's* machine with the *operator's* identity (moat #2), every dependency is wrapped behind an interface (rule #2), and the constitution is enforced by CI the operator owns (moat #3). An acquisition of any single agent Minsky wraps (Claude, Devin, Aider) cannot kill the operator's workflow — they swap the `cloud_agent` config key. The guardrail already exists; this post-mortem confirms it is load-bearing.

## Why choose Minsky over AutoCodeRover

- 24/7 daemon with budget management and restart-on-crash vs a per-issue research invocation
- Operator-machine identity (commits land as the operator) vs a research harness with no identity binding
- Cross-repo fleet across N hosts vs single-repo/single-issue
- Maintained + constitution-enforced vs a dormant OSS line whose live capability is now closed-commercial
- Agent-agnostic (swap backends) vs locked to its own pipeline

## Why choose AutoCodeRover over Minsky

- If your only need is *one-shot SWE-bench-shape bug fixing* with strong cost economics and you want a self-contained, citable research baseline
- If you want a reproducible academic harness to benchmark retrieval + SBFL techniques in isolation
- (Increasingly) if you are already a Sonar customer and want the commercialized successor inside that ecosystem — at which point it is no longer the OSS project compared here

## Scorecard readings (technique reference — not wired into `novel/competitive-benchmark/src/competitors.ts`)

AutoCodeRover is documented as a **post-mortem research benchmark**, so it is intentionally NOT added to the live M1.10 corpus (`competitors.ts`) — a dormant OSS line whose maintained capability is now closed-commercial would skew the live scorecard's freshness signal. The published numbers below are recorded here for reference, every reading primary-cited and dated, per the no-fabrication rule (Helland 2007 — visible, not silent).

| Metric                              | Value   | Date       | Primary source                                                                                                                                                                                 |
| ----------------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `swe-bench-verified-resolve-rate`   | 0.462   | 2024-2025  | AutoCodeRoverSG/auto-code-rover README, github.com/AutoCodeRoverSG/auto-code-rover ("Resolved 46.2% tasks (pass@1) in SWE-bench verified … each task costs less than $0.7").                    |
| `swe-bench-lite-resolve-rate`       | 0.373   | 2024-2025  | Same README ("Resolved 37.3% tasks (pass@1) in SWE-bench lite"). Note: not an M1.10 metric id — recorded for context only.                                                                       |
| `swe-bench-lite-resolve-rate`       | 0.19    | 2024-09    | Zhang, Ruan, Fan, Roychoudhury, *AutoCodeRover: Autonomous Program Improvement*, ACM ISSTA 2024 (arXiv:2404.05427) — the original paper's SWE-bench-lite resolve rate before later improvements. |
| `cost-per-merged-pr`                | < $0.70 | 2024-2025  | Same README — per-task cost; an approximate upper bound, not a per-PR measurement.                                                                                                              |

The two `swe-bench-lite-resolve-rate` rows show the trajectory from the ISSTA-2024 paper (≈19%) to the repo's later head-of-line README (37.3% pass@1) — the same project, two dated readings, kept honest rather than collapsed into one number.

## Should we wrap AutoCodeRover instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a *wrap target*. AutoCodeRover is a per-issue agent harness, not an orchestrator or a maintained agent CLI. The maintained line is now inside Sonar's closed product; the OSS repo is dormant. There is no live drop-in CLI to spawn the way Minsky spawns `claude`/`devin`/`aider`. |
| 2. **What we delegate** | Nothing structural. At most we'd delegate *context retrieval* (AST search + SBFL) — a sub-stage of one iteration, not a Minsky layer. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface) — because no wrap actually happens; we extract a technique. |
| 4. **Net moat after wrap** | 6 of 6 (no wrap). The relevant action is *pattern extraction*, not delegation. |
| 5. **Verdict** | **NO (STRUCTURAL MISMATCH + dormant OSS line).** Do not wrap. Do extract the AST-aware-retrieval + SBFL-prefilter patterns as a context adapter behind `novel/adapters/` (a research-finding follow-up, not a wrap). No P0 wrap task is filed. |

**Trigger for re-evaluation**: if Sonar open-sources the commercialized successor as a self-hostable agent CLI with a stable spawn interface, re-run this analysis as an agent-tier wrap candidate (same shape as the Devin per-task wrap). Until then the artifact is a technique source, not a backend.

## Five pivot questions

### 1. How is it different from Minsky?

AutoCodeRover is an **agent-tier, per-issue research harness**; Minsky is an **orchestrator-tier 24/7 daemon** that sits above agents. AutoCodeRover's intent is to maximize one-shot resolve rate on SWE-bench-shape issues at minimal cost via a fixed *retrieve-then-patch* pipeline (ISSTA 2024, arXiv:2404.05427); Minsky's intent is to keep a fleet of repos improving indefinitely under a constitution, composing whichever agent is best. They are not peers — AutoCodeRover is the kind of thing Minsky would *wrap* if it had a live CLI, the way it wraps Claude/Devin/Aider.

### 2. What lessons can it give to us?

- **AST/program-structure-aware code search** (ISSTA 2024 paper § "Context Retrieval"; repo `search_*` APIs) — retrieval over classes/methods, not files. Candidate for a context-assembly adapter behind `novel/adapters/` (rule #2).
- **Spectrum-based fault localization as a token pre-filter** (paper § "Spectrum-based Fault Localization") — rank suspect methods from existing tests before spawning the agent. Decades-tested pattern (Jones & Harrold 2005; Abreu et al. 2009) — rule #5-clean.
- **Cost-per-issue economics as a design constraint** (repo README, <$0.70/issue) — reinforces tracking `cost-per-merged-pr` as a first-class Minsky scorecard metric, not an afterthought.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons are *technique/strategy* level (a context adapter, a pre-filter, a metric emphasis) — none would force a rewrite of `vision.md § What Minsky is` or invalidate any of the 17 rules. AutoCodeRover is a dormant, agent-tier, single-issue research harness; it neither subsumes Minsky's orchestrator layer nor challenges any moat. A negative finding is recorded in `ask-human.md` (Q-block) for the audit trail per the deep-research convention, with the recommendation "absorb patterns, no vision change".

### 4. How can we improve our strategy based on this?

- **Treat context retrieval as an explicit, swappable seam** — the strongest, most-cited AutoCodeRover result is that *structure-aware retrieval beats flat-file context*. Strategy move: make Minsky's brief/context-assembly an adapter boundary (rule #2) so retrieval quality is measurable and improvable independently of the agent — traces to lesson §2.1.
- **Lean into cost-per-issue as a comparative moat narrative** — AutoCodeRover proved a research pipeline can hit competitive resolve rates at < $0.70/issue. Strategy move: keep `cost-per-merged-pr` prominent in the scorecard/README so Minsky's economics are visible, not buried — traces to lesson §2.3.
- **Use SBFL where tests exist, accept its absence where they don't** — strategy move: a pre-filter is a *conditional* optimization (needs a test suite), so it belongs as an optional adapter, not a default — traces to lesson §2.2.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — AutoCodeRover has no daemon/loop; nothing to replace.
- **MAPE-K**: KEEP — no self-improvement substrate exists in AutoCodeRover.
- **adapters / context assembly**: AUGMENT — the AST-search + SBFL retrieval technique is worth implementing as a *new* context adapter behind `novel/adapters/`; this is the one place AutoCodeRover's research pays rent. Seam: the brief/context-assembly step before agent spawn.
- **sandbox**: N/A — out of AutoCodeRover's scope.
- **corpus / scorecard**: KEEP — intentionally not wired in (dormant OSS, closed-commercial successor); recorded as a technique reference only.
- **dashboard / TASKS.md surface**: KEEP — AutoCodeRover has neither.

**Total replace % across all surfaces: 0%** (one AUGMENT on the context adapter; everything else KEEP/N/A). The headline for the operator: *nothing to replace; one technique to absorb.*

## Last reviewed

2026-06-01 — first entry; `--deep --post-mortem` mode per task `competitor-add-auto-code-rover`. Verdict: dormant after Sonar acquisition (2025-02-19); STRUCTURAL-MISMATCH/NO wrap; absorb AST-aware retrieval + SBFL pre-filter as a context adapter; no vision change (negative finding logged to `ask-human.md`).
