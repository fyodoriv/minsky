# Competitor: Cursor Agent (Anysphere)

> IDE-bound agent (inner loop) complementary to Minsky's outer loop (24/7 background daemon).

- **URL**: <https://cursor.com>
- **Status**: Active, massive adoption, VS Code fork with AI-native features
- **Pricing**: Free tier, Pro $20/mo, Business $40/mo
- **Relationship**: **Complementary** — minsky targets the outer loop; Cursor targets the inner loop (IDE)

## What it is

AI-native code editor (VS Code fork) with deep agent integration. Agent mode can autonomously implement features, fix bugs, refactor code — all within the IDE. Background agents run tasks while you work on other things. Tab completion, chat, and autonomous agent are seamlessly integrated.

## Strengths

- **IDE integration** — the agent lives in your editor, sees your cursor, understands your context
- **Background agents** — run tasks in parallel while you code (Cursor's agent-mode)
- **Massive adoption** — millions of developers, battle-tested on real codebases
- **Fast iteration** — Anysphere ships features weekly
- **Multi-model** — Claude, GPT-4, and custom models
- **Affordable** — $20/mo for Pro with generous usage

## Weaknesses vs minsky's vision

1. **IDE-bound** — can't run headless, no daemon mode, no CLI-only operation.
2. **No 24/7 supervision** — agents stop when you close the IDE.
3. **No task queue** — works on what you ask in the moment. No TASKS.md processing.
4. **No budget management** — no token economy awareness, no automatic pause.
5. **No cross-repo** — one project at a time.
6. **No self-improvement** — Anysphere improves Cursor; Cursor doesn't improve itself per-repo.
7. **Vendor lock-in** — proprietary editor. Your workflow depends on Anysphere's decisions.
8. **No competitive benchmarking** — doesn't measure itself against alternatives.

## What we learn / steal

- **Background agents** — Cursor's approach to "agent works while you do other things" is exactly minsky's daemon model, but IDE-bound. Minsky is the headless version.
- **Context awareness** — Cursor's agent sees your open files, cursor position, recent edits. Minsky's brief should include similar context from the repo structure.
- **UX simplicity** — "just works in the IDE" is a powerful model. Minsky's install should feel this effortless.

## Why choose minsky over Cursor Agent

- Headless — runs 24/7 without an IDE open
- Cross-repo task queue processing
- Budget management and supervision
- Self-improving
- Open source, no vendor lock-in

## Why choose Cursor Agent over minsky

- Better for interactive development (you're coding and the agent assists)
- IDE context awareness (sees your cursor, open files)
- More polished UX for daily coding
- Lower barrier — already in your editor

## Background Agents (the "async on a repo" axis)

Cursor 0.50 (May 2025) shipped **Background Agents** out of beta — the surface that makes Cursor a direct competitor on Minsky's *outer-loop* axis, not just the IDE inner loop. Facts that anchor the comparison (Cursor docs at `cursor.com/docs`, the Cursor 0.50 changelog, and the background-agents launch post):

- **Async, remote execution** — each agent spins up a Cursor-managed remote machine, clones the repo, and works the task while the operator does something else. This is the same shape as Minsky's daemon, but Anysphere-hosted rather than operator-machine-hosted.
- **Parallel fan-out** — multiple background agents run concurrently (the launch framing emphasises "kick off several at once"). Comparable to Minsky's parallel-worktree mode (`--workers-total=M`), but with a managed pool instead of the operator's CPU.
- **Trigger surfaces** — agents can be started from the editor, and via Slack/web integrations; results land as a branch / PR for review. Minsky's trigger is `TASKS.md` + the tick-loop; Cursor's is human-initiated or chat-initiated.
- **Pricing** — usage-based on top of the Pro ($20/mo) / Business ($40/mo) tiers; background-agent compute is metered (the remote machine + model tokens), so heavy 24/7 use is not the flat-rate $20 the Pro headline implies. This is the load-bearing fact for the M5 (managed product) pivot question below.
- **Review-gated, not unattended** — the model is "agent proposes, human reviews the PR", not "daemon ships and self-grades against a constitution". There is no constitution-enforcement CI, no MAPE-K self-improvement loop, no budget-guard auto-pause.

The net: Cursor Background Agents is the **highest-volume mainstream competitor on the async-on-a-repo axis**, but it is a *hosted, human-triggered, review-gated* async agent — not an operator-owned, constitution-governed, self-improving 24/7 daemon.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                  | Value | Date       | Primary source                                                                                                                                                                                                                                       |
| ----------------------- | ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous-merge-rate` | 0.804 | 2026-02-09 | Pinna, Gong, Williams, Sarro, *Comparing AI Coding Agents: A Task-Stratified Analysis of Pull Request Acceptance*, arXiv 2602.08915, 2026-02-09 — AIDev dataset, Cursor leads fix-task acceptance at 80.4%.                                            |

Note: The 80.4% is Cursor's fix-task acceptance rate per the AIDev
study, not an aggregate across all task types. The AIDev study reports
that no single agent leads every task category (Cursor excels at fixes,
Claude Code at docs and features, Codex broadly). Used here as the
autonomous-merge-rate proxy with the caveat documented in the citation.

## Should we wrap Cursor Background Agents instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a *wrap target*. Background Agents is a closed, Anysphere-hosted service with no public spawn-an-agent CLI or stable headless API a daemon could shell out to the way Minsky spawns `claude`/`devin`/`aider`. The control plane is Cursor's editor + chat surfaces, not an operator-invocable binary. |
| 2. **What we delegate** | At most *one iteration's execution* (clone → patch → open PR) on a Cursor-hosted machine. We cannot delegate the loop, the task queue, the constitution-enforcement, or the budget economy — none are exposed. |
| 3. **What we keep** | All 6 moats survive: daemon-not-framework, operator-machine identity (Cursor runs on Anysphere's machines, not the operator's `~/.gitconfig`/`gh`), constitution + CI the operator owns, MAPE-K self-improvement, cross-repo fleet, `TASKS.md` surface. |
| 4. **Net moat after wrap** | 6 of 6 (no viable wrap). The relevant action is *competitive positioning*, not delegation. |
| 5. **Verdict** | **NO (CLOSED SERVICE, NO HEADLESS SPAWN INTERFACE).** Do not wrap. Cursor is a *complementary* surface (inner-loop IDE + hosted async) we position against, not a backend we compose. No P0 wrap task is filed. |

**Trigger for re-evaluation**: if Anysphere ships a stable, documented headless API or CLI for Background Agents (spawn-task → PR-URL) that the operator can drive without the Cursor editor, re-run this as an agent-tier wrap candidate (same shape as the Devin per-task wrap analysis).

## Five pivot questions

### 1. How is it different from Minsky?

Cursor Background Agents is a **hosted, human-triggered, review-gated async agent**; Minsky is an **operator-owned, constitution-governed, self-improving 24/7 daemon**. Cursor's intent is to remove friction from a developer's day — kick off async work from the editor/Slack, get a PR back, review it (Cursor 0.50 launch post; `cursor.com/docs`). Minsky's intent is to keep a fleet of repos improving *indefinitely under a constitution* with no human in the trigger loop. They overlap on the "async on a repo" axis but diverge on three axes Cursor does not address: (a) **trigger** — Minsky's is the `TASKS.md` queue + tick-loop, Cursor's is a human or a chat message; (b) **ownership** — Minsky runs on the operator's machine with the operator's identity (moat #2), Cursor runs on Anysphere-managed remotes; (c) **governance** — Minsky's output is gated by a constitution-enforcement CI it owns (moats #3, #4), Cursor's is gated by a human reviewing the PR.

### 2. What lessons can it give to us?

- **Async-from-anywhere triggers lower activation energy** (Cursor 0.50 launch post — start an agent from the editor or Slack) — Minsky's `TASKS.md`-only trigger is operator-disciplined but high-friction for an ad-hoc "go fix this" request. A *trigger adapter* (chat/issue → task block) is worth considering behind `novel/adapters/` (rule #2), not a core change.
- **Parallel fan-out as a default UX** (background-agents "kick off several at once") — validates Minsky's parallel-worktree mode (`--workers-total=M`); the lesson is that *parallelism should be one flag, not a setup ritual*.
- **Usage-based pricing exposes the real cost of 24/7** (`cursor.com` pricing — metered background-agent compute on top of the flat tier) — reinforces that Minsky's `cost-per-merged-pr` and budget-guard auto-pause are first-class moats, because the flat-$20 framing breaks down precisely at the always-on workload Minsky targets.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding, with one watch item.** The three lessons are trigger-ergonomics, parallelism-as-default, and cost-visibility — all *strategy/UX* level; none forces a rewrite of `vision.md § What Minsky is` or invalidates any of the 17 rules. The **watch item** is the task's own hypothesis: *if Cursor's commercial trajectory (managed, metered, enterprise-tier async agents at scale) makes M5 (Minsky-as-managed-product) infeasible for an OSS-led player, that IS a vision-threat.* Current read: it does **not** — Cursor's moat is the hosted IDE + closed managed compute, while Minsky's M5 thesis is *operator-owned, constitution-governed* autonomy that a hosted-by-default vendor structurally cannot offer (you cannot host "runs on the operator's machine with the operator's identity"). A negative finding is logged to `ask-human.md` for the audit trail per the deep-research convention, with the recommendation "absorb trigger-adapter lesson, no vision change; keep the M5-vs-Cursor-enterprise question on the watch list".

### 4. How can we improve our strategy based on this?

- **Add a trigger adapter, keep `TASKS.md` canonical** — the strongest Cursor ergonomics result is that *async work should be startable from where the human already is*. Strategy move: expose a chat/issue → `TASKS.md`-block trigger as an adapter (rule #2) so activation energy drops without compromising the queue as the single source of truth — traces to lesson §2.1.
- **Make `cost-per-merged-pr` the headline economic narrative** — Cursor's metered pricing proves the always-on workload is *not* flat-rate cheap; Minsky's budget economy is the differentiator. Strategy move: keep `cost-per-merged-pr` + budget-guard auto-pause prominent in README/scorecard so the operator sees the 24/7 economics Cursor's tier hides — traces to lesson §2.3.
- **Position on ownership + governance, not on "we also do async"** — competing on async-execution alone loses to a polished hosted product. Strategy move: lead the M5 narrative with *operator-owned identity + constitution-enforcement CI* (the two things a hosted vendor cannot replicate), not feature parity — traces to lesson §2.2 and the §3 watch item.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Cursor's trigger is human/chat-initiated, not a self-running loop; nothing to replace.
- **MAPE-K**: KEEP — no self-improvement / self-grading substrate exists in Cursor's review-gated model.
- **adapters / context assembly**: AUGMENT (optional) — a *trigger adapter* (chat/issue → task block) is the one place Cursor's ergonomics pays rent; it's additive, not a replacement, and the execution still runs through Minsky's own agents.
- **sandbox**: N/A — Cursor's remote sandbox is its own closed concern; Minsky's supervisor sandbox is operator-owned by design.
- **corpus / scorecard**: KEEP — Cursor stays a live corpus entry (one `autonomous-merge-rate` reading wired in); nothing to replace.
- **dashboard / TASKS.md surface**: KEEP — Cursor has no operator-owned task queue or Watch; this is a Minsky differentiator, not a borrow.

**Total replace % across all surfaces: 0%** (one optional AUGMENT on a trigger adapter; everything else KEEP/N/A). The headline for the operator: *nothing to replace; one optional trigger-ergonomics lesson to absorb; the M5-vs-Cursor-enterprise question stays on the watch list.*

## Last reviewed

2026-06-01 — deepened with the Five Pivot Questions framework + Background Agents (Cursor 0.50) analysis per task `competitor-deepen-cursor-agent`. Verdict: complementary, not a wrap target (closed service, no headless spawn API); absorb the trigger-adapter ergonomics lesson; no vision change — the M5-vs-Cursor-enterprise question stays on the watch list (negative finding logged to `ask-human.md`).
