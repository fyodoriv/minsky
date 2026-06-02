# Competitor: AutoGPT (Significant-Gravitas/AutoGPT)

> The most-starred autonomous-agent OSS by a wide margin (~185k★) and the project that put "autonomous AI agent" into mainstream vocabulary in 2023 — but whose original prompt-to-agent autonomy was widely judged vaporware, and which has since pivoted into a low-code "continuous agents" platform. This file is the strategic write-up: what the star count actually buys, why the 2023 autonomy claims under-delivered, and what the platform pivot means for Minsky's positioning.

- **URL**: <https://github.com/Significant-Gravitas/AutoGPT>
- **Site**: <https://agpt.co/>
- **Status**: **Active** — latest release `autogpt-platform-beta-v0.6.62` (2026-05-28); ~185k★, ~46k forks, 8,100+ commits; hundreds of contributors. Primary language Python (68.5%). Not archived.
- **Pricing**: Free for self-host (OSS). **Dual-licensed**: code under `autogpt_platform/` is **Polyform Shield License** (source-available, anti-compete); the classic AutoGPT agent + Forge + agbenchmark are **MIT**. A hosted cloud offering is in beta.
- **Relationship**: **Competitor (post-mortem-light on the original; live platform peer at the agent-builder tier)** — not a backend Minsky would wrap; the original is a cautionary tale about autonomy-hype vs delivery, the current platform is a different product (a visual continuous-agent builder) that competes for the "agents that run unattended" narrative.

## What it is

AutoGPT today is **two distinct things sharing one repo and one brand**, and conflating them is the single biggest source of confusion about the project:

1. **AutoGPT Classic** (the 2023 original) — a Python CLI "AI agent" that, given a natural-language goal, would attempt to decompose it into sub-tasks, browse the web, read/write files, keep short-term memory, and loop toward the objective "without needing constant human intervention" (Toran Bruce Richards, Significant Gravitas Ltd, released 2023-03-30). This is the artifact that earned the 100k+ stars in weeks. The maintained remnant is **Forge** (a toolkit for building custom agents), **agbenchmark** (a performance harness), and a UI wired through the AI-Engineer-Foundation **Agent Protocol**.

2. **AutoGPT Platform** (the 2024-onward pivot) — a **low-code visual agent builder**. Agents are authored as a directed graph of **"blocks"** (each block = one self-contained action with typed inputs/outputs), not as a free-form prompt. The platform has two core components: the **AutoGPT Server** (execution engine + infrastructure) and the **AutoGPT Frontend** (the graph editor, workflow management, recurring schedules). Its headline pitch is **"continuous agents"** — agents that run on a schedule or trigger and operate unattended behind the scenes — plus a marketplace of pre-built agents and a hosted-cloud option.

The trajectory is the story: a viral *prompt-to-agent autonomy* experiment that under-delivered on autonomy, re-platformed into a *structured, human-authored, low-code automation* product where the human draws the graph and the "autonomy" is bounded to running that graph on a schedule.

## Strengths

- **Distribution / mindshare** — ~185k★ is ~2.5× the next-most-starred agent OSS. AutoGPT *is* the term-of-art entry point for "autonomous agent" for a huge audience; brand and funnel are real assets even if the original tech under-delivered.
- **Honest re-platforming** — rather than keep selling the un-delivered 2023 autonomy story, the team rebuilt around a *composable blocks* model (typed inputs/outputs, DAG execution) that is far more reliable than open-ended prompt looping. That is a genuine engineering correction, not just a rebrand.
- **Continuous / scheduled agents** — first-class "runs unattended on a trigger/schedule" is conceptually adjacent to Minsky's 24/7 daemon framing, and is a market-validated demand signal.
- **Marketplace + low-code surface** — lowers the floor for non-engineers to assemble agents; a distribution mechanism Minsky deliberately does not pursue.
- **Agent Protocol adoption (classic)** — the standardized agent interface (AI Engineer Foundation) is a clean interoperability bet worth noting as prior art.

## Weaknesses vs Minsky's vision

1. **Autonomy was the headline and the weakest part.** The 2023 original's defining claim — pursue objectives long-term without human intervention — is exactly what reviewers found it could not do (see Post-mortem-light below). Minsky's wager is the inverse: don't promise open-ended autonomy; promise a *bounded, supervised, constitution-enforced* loop that survives crashes (Minsky moats #3, #6). AutoGPT's history is the empirical warning label on the autonomy-hype failure mode.
2. **Human draws the graph; it is not a daemon that picks its own work.** The Platform's "continuous agent" runs a *human-authored* DAG on a schedule. Minsky's tick-loop *selects* the next task from `TASKS.md` and composes whichever agent is best — there is no fixed graph the operator must pre-draw (Minsky moats #1, #6).
3. **No operator-machine identity.** The platform model is server + frontend + hosted cloud — a separate identity boundary. Minsky runs as the operator's user with the operator's `~/.gitconfig`/`gh`/`~/.ssh`; commits land as the operator (Minsky moat #2). AutoGPT's cloud/self-host server is the deliberate inverse.
4. **No constitution + deterministic enforcement.** AutoGPT has no equivalent of Minsky's 17-rule constitution each gated by a CI lint (Minsky moat #3). Block correctness is the user's problem.
5. **No MAPE-K self-improvement substrate.** Blocks are static; there is no observer/experiment-store loop that tunes the system from its own outcome history (Minsky moat #4).
6. **Python low-code builder, not a TypeScript orchestrator** — different tier and different audience. AutoGPT optimizes for non-engineers assembling automations; Minsky optimizes for an operator who walks away from a fleet of repos.

## What we learn / steal

- **The autonomy-hype lesson is the most valuable extract** — AutoGPT proves that "fully autonomous, set-a-goal-and-leave" sells stars but loses trust when it loops, forgets, and fails simple tasks. Minsky's `vision.md` discipline (bounded loop, rule #6 stay-alive, rule #9 pre-registered hypothesis with a pivot threshold) is the antidote; this competitor is the citation that the antidote is load-bearing, not academic.
- **Blocks-as-typed-units** — the move from free-form prompt looping to *typed, composable blocks with explicit inputs/outputs* is the same reliability instinct behind Minsky's adapter boundary (rule #2): constrain the seam, make it inspectable, make failure local. Worth noting as convergent design, not a thing to adopt wholesale.
- **"Continuous agents" as a demand signal** — that the most-starred agent project re-platformed *toward* scheduled/unattended execution validates Minsky's daemon thesis from the outside. Minsky should keep "runs unattended, indefinitely" prominent in its narrative — AutoGPT's pivot is third-party evidence the market wants it.
- **Marketplace as a path Minsky rejects (by design)** — useful as an explicit contrast in the README: Minsky's surface is `TASKS.md`, not a marketplace of pre-built agents. The contrast sharpens the positioning.

## Post-mortem-light: original AutoGPT vs the current platform

> Not a death — AutoGPT is alive and shipping. But the *original autonomy thesis* died and was replaced. This section records what died, why, and what survived.

- **What died**: AutoGPT Classic's central promise — *give it a goal in natural language and it will autonomously pursue it to completion*. Released 2023-03-30; went viral within weeks (100k★ in ~the first month). The maintained pieces (Forge, agbenchmark) survive as a toolkit, but the *prompt-to-autonomous-completion* product was effectively abandoned in favor of the Platform.
- **Root cause (capability-vs-hype, not business-model-failure)**: the autonomy was real as a demo and unreliable as a product. Documented contemporaneously:
  1. **"Too autonomous to be useful"** — Avram Piltch, *Tom's Hardware*, April 2023: AutoGPT lacked the user-clarification / correction mechanisms that make autonomy safe, so it would charge off in wrong directions with no way to steer.
  2. **Infinite loops + no memory** — widely reported tendency to get stuck in loops, attributed to "AutoGPT's inability to remember" prior actions (Wikipedia § Reception, citing contemporaneous coverage).
  3. **Failed simple real tasks** — Will Knight, *Wired*, 2023: testing a basic email-finding task, AutoGPT "was not able to accurately find the email address."
  4. **Cost + hallucination** — high API cost per run and a tendency to "present false or misleading information as fact."
  The consensus, in one line: *impressive concept, struggling execution.* This is an **architectural/product dead-end of the open-ended-autonomy approach**, not a funding or team collapse.
- **What survived / the pivot**: the team re-platformed (major rewrite landing through mid-2024) into the **AutoGPT Platform** — a low-code, human-authored **DAG of typed blocks** with **scheduled "continuous" execution**, a marketplace, and a hosted cloud beta (latest release `autogpt-platform-beta-v0.6.62`, 2026-05-28). The autonomy was *narrowed*: from "agent figures out the plan" to "human draws the graph; platform runs it unattended." That narrowing is precisely the reliability gain that the 2023 critiques demanded.
- **Lesson for Minsky (mandatory)**: Minsky's guardrail against *this* death mode is **rule #9 (pre-registered hypothesis with an explicit pivot threshold)** plus **rule #6 (stay alive — bounded loop, let-it-crash, supervisor restart)**. AutoGPT shipped unbounded autonomy with no measurable success/pivot criterion and let the loop run free; it took the market and the team a year to course-correct. Minsky pre-registers the hypothesis, sets the pivot number *before* shipping, and never promises open-ended autonomy — it promises a *supervised, falsifiable* loop. AutoGPT's arc is the empirical case study that this discipline is the difference between "viral and abandoned" and "boring and alive."

## Why choose Minsky over AutoGPT

- A **daemon that selects its own work** from `TASKS.md` vs a platform where the human pre-draws every agent graph.
- **Operator-machine identity** — commits land as the operator with the operator's credentials vs a server/cloud model with a separate identity boundary.
- **Constitution + deterministic CI enforcement** (17 rules, `pnpm pre-pr-lint --stage=full`) vs block correctness being the user's problem.
- **MAPE-K substrate** that files tasks against its own weak spots vs static blocks with no self-improvement loop.
- **Bounded, falsifiable autonomy** (rule #9 pivot thresholds, rule #6 stay-alive) vs the open-ended-autonomy thesis that AutoGPT itself had to walk back.

## Why choose AutoGPT over Minsky

- If you are a **non-engineer** who wants to assemble an automation by dragging typed blocks in a visual editor — Minsky has no low-code surface and is not trying to.
- If you want a **marketplace of pre-built agents** and a hosted cloud you don't operate yourself.
- If your need is **scheduled SaaS-style workflow automation** ("every morning, scrape X and email me a summary") rather than 24/7 code-improvement across a fleet of repos.
- If brand familiarity / community size is itself the deciding factor — AutoGPT's ~185k★ funnel and ecosystem are unmatched at the agent-builder tier.

## Scorecard readings (mindshare reference — not wired into `novel/competitive-benchmark/src/competitors.ts`)

AutoGPT is documented here as a **mindshare-and-pivot reference**, intentionally NOT added to the live M1.10 corpus (`competitors.ts`). The M1.10 scorecard compares Minsky against agent/orchestrator peers on shared *capability* metrics (SWE-bench Verified, HumanEval Pass@1, DORA, agentic). AutoGPT publishes **no vendor-primary reading on the M1.10 catalogue** — its famous number is a *star count*, not a benchmark — so wiring it in would violate the validator's published-primary rule (rule #4 — visible, no fabricated readings). The readings below are recorded for context only, every value primary-cited and dated.

| Metric (context only — not an M1.10 metric id) | Value | Date | Primary source |
| --- | --- | --- | --- |
| GitHub stars | ~185,000 | 2026-05 | github.com/Significant-Gravitas/AutoGPT (repo header). |
| GitHub forks | ~46,200 | 2026-03 | Same repo. |
| Latest release | `autogpt-platform-beta-v0.6.62` | 2026-05-28 | github.com/Significant-Gravitas/AutoGPT/releases. |
| Original release date | 2023-03-30 | 2023-03-30 | Wikipedia § AutoGPT (Toran Bruce Richards, Significant Gravitas Ltd). |

No capability number (SWE-bench / HumanEval / agentic) is published by the vendor for AutoGPT, which is itself the point: the most-starred agent OSS competes on mindshare, not on a measurable resolve rate.

## Should we wrap AutoGPT instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a wrap target. The Platform is a *human-authored low-code DAG runner*, not an agent CLI Minsky can spawn the way it spawns `claude`/`devin`/`aider`. The classic agent is a dormant prompt-loop whose autonomy is the documented weak point. Neither is a drop-in backend. |
| 2. **What we delegate** | Nothing structural. At most, AutoGPT's *blocks marketplace* could be a source of integration ideas, not a runtime to delegate to. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface) — no wrap happens. |
| 4. **Net moat after wrap** | 6 of 6 (no wrap). The relevant action is *positioning + lesson extraction*, not delegation. |
| 5. **Verdict** | **NO (STRUCTURAL MISMATCH + different product tier).** Do not wrap. Do absorb the autonomy-hype lesson into the rule-#9/#6 narrative and keep "supervised, bounded, alive" as the contrast to AutoGPT's walked-back open-ended autonomy. No P0 wrap task is filed. |

**Trigger for re-evaluation**: if AutoGPT ships a stable, spawnable *code-agent CLI* with a published SWE-bench-shape resolve rate (i.e., re-enters the agent tier as a measurable backend), re-run this analysis as an agent-tier wrap candidate. Until then it is a mindshare/positioning reference, not a backend.

## Five pivot questions

### 1. How is it different from Minsky?

AutoGPT is, today, a **low-code visual platform for human-authored continuous agents** (and historically a viral prompt-to-agent autonomy experiment). Minsky is an **orchestrator-tier 24/7 daemon** that *selects* its own work from `TASKS.md` and composes existing agents under a constitution. AutoGPT's "autonomy" is bounded to *running a graph the human drew, on a schedule*; Minsky's is *picking and sequencing the work itself*. They are not peers: AutoGPT competes for the non-engineer agent-builder audience and the "agents that run unattended" narrative; Minsky competes for the operator who wants a supervised fleet improving code indefinitely.

### 2. What lessons can it give to us?

- **Autonomy-hype is a trust liability** (Piltch/Tom's Hardware 2023; Knight/Wired 2023; the loops-and-no-memory critique) — promising open-ended autonomy you can't reliably deliver wins stars and loses users. Reinforces Minsky's rule #9 (declare success/pivot numbers up front) and rule #6 (bounded loop).
- **Typed composable blocks beat free-form prompt loops for reliability** (AutoGPT Platform architecture — DAG of typed-IO blocks) — convergent evidence for Minsky's adapter-boundary instinct (rule #2): constrain and inspect the seam.
- **"Continuous / scheduled agents" is a validated market demand** (the platform's headline pitch) — external validation of Minsky's 24/7-daemon thesis.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons *confirm* existing `vision.md` bets rather than challenge them — the autonomy-hype lesson strengthens rules #6/#9, the blocks lesson echoes rule #2, the continuous-agents signal validates the daemon thesis. None would force a rewrite of `vision.md § What Minsky is` or invalidate any of the 17 rules. A negative finding (no vision change; absorb-the-lesson) is recorded for the audit trail per the deep-research convention, with the recommendation "absorb the autonomy-hype lesson; no vision change."

### 4. How can we improve our strategy based on this?

- **Lead with "supervised + bounded + alive," explicitly contra open-ended autonomy** — AutoGPT is the household name for "autonomous agent," and it's also the household example of autonomy that under-delivered. Strategy move: position Minsky's bounded, falsifiable loop *against* that exact failure, citing AutoGPT's own walk-back — traces to lesson §2.1.
- **Keep "runs unattended, indefinitely" prominent** — the most-starred agent project re-platformed toward scheduled/continuous execution; that's free third-party validation. Strategy move: foreground the daemon's unattended-uptime story in README/competitors corpus — traces to lesson §2.3.
- **Treat seams as typed, inspectable boundaries** — AutoGPT's reliability gain came from replacing prompt looping with typed blocks. Strategy move: keep the adapter boundary (rule #2) strict and the brief/context-assembly seam inspectable rather than free-form — traces to lesson §2.2.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — AutoGPT has no work-selecting daemon; its "continuous agent" runs a human-drawn graph, not a self-picked task queue.
- **MAPE-K**: KEEP — no self-improvement substrate exists in AutoGPT.
- **adapters / context assembly**: KEEP — AutoGPT's blocks are convergent prior art, but Minsky's adapter layer already embodies the typed-seam idea; nothing to swap in.
- **sandbox**: N/A — out of scope for AutoGPT's platform model.
- **corpus / scorecard**: KEEP — intentionally not wired in (no vendor-primary capability reading on the M1.10 catalogue); recorded as a mindshare/positioning reference only.
- **dashboard / TASKS.md surface**: KEEP — AutoGPT's marketplace + visual builder is a deliberately *different* surface Minsky rejects (rule: `TASKS.md` is the operator surface).

**Total replace % across all surfaces: 0%** (no AUGMENT, no REPLACE — everything KEEP/N/A). The headline for the operator: *nothing to replace; one strong positioning lesson (autonomy-hype) to absorb, and external validation of the daemon thesis.*

## Last reviewed

2026-06-02 — first entry; `--deep --post-mortem-light` mode per task `competitor-add-autogpt`. Verdict: alive but re-platformed (classic autonomy thesis is a capability-vs-hype dead-end; current product is a low-code continuous-agent builder); STRUCTURAL-MISMATCH/NO wrap; absorb the autonomy-hype lesson (reinforces rules #6/#9), keep "supervised + bounded + alive" positioning; no vision change (negative finding logged for the audit trail).
