# Competitor: Cursor Agent (Anysphere)

> An AI code editor whose agent works inside your IDE; Minsky is the background program that works on your code while you are away. They sit on opposite ends of the same workflow.

- **URL**: <https://cursor.com>
- **Status**: Active, massive adoption, VS Code fork with AI-native features
- **Pricing**: Free tier, Pro $20/mo, Business $40/mo
- **Relationship**: **Complementary** — Cursor works the inner loop (you coding, in the editor); Minsky works the outer loop (a background program running on its own, around the clock)

## What this is

Cursor is an AI-native code editor — a fork of VS Code. Its agent lives in the editor and can implement features, fix bugs, and refactor code on its own while you work on something else. Tab completion, chat, and the autonomous agent are built into one tool. In May 2025, Cursor 0.50 added Background Agents: tasks that run on Cursor-hosted remote machines and come back as a branch or pull request for you to review.

## What this is not

- It is not a daemon — a background program that keeps running on your own machine. Cursor's background agents run on Anysphere's machines, and the editor agent stops when you close the IDE.
- It is not driven by a plain-text to-do list. Cursor starts work when a human asks or a chat message arrives, not from a `TASKS.md` file (the Markdown to-do list at a project's root that Minsky reads to pick work).
- It is not self-governing. Cursor proposes a change and a human reviews the pull request; there is no constitution — a set of numbered, non-negotiable project rules enforced in CI — no budget guard, and no self-improvement loop.

## Strengths

- **IDE integration** — the agent lives in your editor, sees your cursor, and understands your context.
- **Background agents** — tasks run in parallel while you keep coding.
- **Massive adoption** — millions of developers, battle-tested on real codebases.
- **Fast iteration** — Anysphere ships features weekly.
- **Multi-model** — Claude, GPT-4, and custom models.
- **Affordable** — $20/mo for Pro with generous usage.

## Weaknesses vs Minsky's vision

1. **IDE-bound** — the editor agent cannot run headless. There is no CLI-only operation.
2. **No 24/7 supervision** — the editor agent stops when you close the IDE.
3. **No task queue** — it works on what you ask in the moment. It does not process a `TASKS.md` list.
4. **No budget management** — no awareness of how much paid quota it is spending, and no automatic pause.
5. **No cross-repo work** — one project at a time. Minsky can walk several repositories in turn.
6. **No self-improvement** — Anysphere improves Cursor; Cursor does not study and improve its own work per repository.
7. **Vendor lock-in** — a proprietary editor. Your workflow depends on Anysphere's decisions.
8. **No competitive benchmarking** — it does not measure itself against alternatives.

## What we learn / steal

- **Background agents** — Cursor's "the agent works while you do other things" is the same shape as Minsky's daemon, but tied to the IDE and hosted by Anysphere. Minsky is the headless, operator-owned version.
- **Context awareness** — Cursor's agent sees your open files, cursor position, and recent edits. The brief Minsky hands its agent should include similar context from the repository structure.
- **UX simplicity** — "it just works in the IDE" is a powerful model. Minsky's install should feel this effortless.

## Why choose Minsky over Cursor Agent

- Headless — runs around the clock with no IDE open.
- Cross-repo — works through a `TASKS.md` task queue across several projects.
- Budget management and supervision — pauses when it spends too much paid quota; restarts if it crashes.
- Self-improving — studies its own results and files notes on how to do better.
- Open source — no vendor lock-in.

## Why choose Cursor Agent over Minsky

- Better for interactive development — you code and the agent assists.
- IDE context awareness — it sees your cursor and open files.
- More polished UX for daily coding.
- Lower barrier — it is already in your editor.

## Background Agents (the "async on a repo" axis)

Cursor 0.50 (May 2025) shipped **Background Agents** out of beta. This is the surface that makes Cursor a direct competitor on Minsky's *outer-loop* axis — running on a repository on its own — not just on the IDE inner loop. The facts below anchor the comparison (Cursor docs at `cursor.com/docs`, the Cursor 0.50 changelog, and the background-agents launch post):

- **Async, remote execution** — each agent spins up a Cursor-managed remote machine, clones the repo, and works the task while you do something else. This is the same shape as Minsky's daemon, but Anysphere-hosted rather than running on your own machine.
- **Parallel fan-out** — several background agents run at once (the launch framing emphasises "kick off several at once"). This is comparable to Minsky's parallel-worktree mode (`--workers-total=M`), but with a managed pool instead of your own CPU.
- **Trigger surfaces** — agents start from the editor or from Slack/web integrations; results land as a branch or pull request to review. Minsky's trigger is `TASKS.md` plus its timed loop; Cursor's is human-initiated or chat-initiated.
- **Pricing** — usage-based on top of the Pro ($20/mo) and Business ($40/mo) tiers. Background-agent compute is metered (the remote machine plus model tokens), so heavy 24/7 use is not the flat $20 the Pro headline implies. This is the load-bearing fact for the M5 (managed product) pivot question below.
- **Review-gated, not unattended** — the model is "agent proposes, human reviews the PR", not "daemon ships and self-grades against a constitution". There is no constitution-enforcement CI, no self-improvement loop, and no budget-guard auto-pause.

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

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Here is the honest answer.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a *wrap target*. Background Agents is a closed, Anysphere-hosted service with no public spawn-an-agent CLI or stable headless API a daemon could shell out to the way Minsky spawns `claude`/`devin`/`aider`. The control plane is Cursor's editor and chat surfaces, not an operator-invocable binary. |
| 2. **What we delegate** | At most *one iteration's execution* (clone → patch → open PR) on a Cursor-hosted machine. We cannot delegate the loop, the task queue, the constitution enforcement, or the budget economy — none are exposed. |
| 3. **What we keep** | All 6 moats survive: daemon-not-framework; operator-machine identity, meaning work runs as you, under your own git and SSH credentials (Cursor runs on Anysphere's machines, not your `~/.gitconfig`/`gh`); the constitution plus CI that you own; the self-improvement loop; the cross-repo fleet; the `TASKS.md` surface. |
| 4. **Net moat after wrap** | 6 of 6 (no viable wrap). The relevant action is *competitive positioning*, not delegation. |
| 5. **Verdict** | **NO (CLOSED SERVICE, NO HEADLESS SPAWN INTERFACE).** Do not wrap. Cursor is a *complementary* surface (inner-loop IDE plus hosted async) we position against, not a backend we compose. No P0 wrap task is filed. |

**Trigger for re-evaluation**: if Anysphere ships a stable, documented headless API or CLI for Background Agents (spawn-task → PR-URL) that you can drive without the Cursor editor, re-run this as an agent-tier wrap candidate (same shape as the Devin per-task wrap analysis).

## Five pivot questions

### 1. How is it different from Minsky?

Cursor Background Agents is a **hosted, human-triggered, review-gated async agent**. Minsky is an **operator-owned, constitution-governed, self-improving 24/7 daemon** — a background program that keeps running on your own machine. (The constitution is the set of numbered, non-negotiable project rules Minsky enforces.) Cursor's intent is to remove friction from a developer's day: kick off async work from the editor or Slack, get a PR back, review it (Cursor 0.50 launch post; `cursor.com/docs`). Minsky's intent is to keep a fleet of repositories improving *indefinitely under that constitution* with no human in the trigger loop. They overlap on the "async on a repo" axis but diverge on three axes Cursor does not address:

- **Trigger** — Minsky's is the `TASKS.md` queue plus its timed loop; Cursor's is a human or a chat message.
- **Ownership** — Minsky runs on your machine, under your own identity (moat #2); Cursor runs on Anysphere-managed remotes.
- **Governance** — Minsky's output is gated by a constitution-enforcement CI it owns (moats #3, #4); Cursor's is gated by a human reviewing the PR.

### 2. What lessons can it give to us?

- **Async-from-anywhere triggers lower the activation energy** (Cursor 0.50 launch post — start an agent from the editor or Slack). Minsky's `TASKS.md`-only trigger is operator-disciplined but high-friction for an ad-hoc "go fix this" request. A *trigger adapter* — a small wrapper file that turns a chat message or issue into a task block — is worth considering behind `novel/adapters/` (rule #2), not a core change.
- **Parallel fan-out as a default UX** (background agents "kick off several at once"). This validates Minsky's parallel-worktree mode (`--workers-total=M`); the lesson is that *parallelism should be one flag, not a setup ritual*.
- **Usage-based pricing exposes the real cost of 24/7** (`cursor.com` pricing — metered background-agent compute on top of the flat tier). This reinforces that Minsky's `cost-per-merged-pr` metric and budget-guard auto-pause are first-class moats, because the flat-$20 framing breaks down precisely at the always-on workload Minsky targets.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding, with one watch item.** The three lessons are trigger-ergonomics, parallelism-as-default, and cost-visibility — all at the *strategy/UX* level. None forces a rewrite of `vision.md § What Minsky is` or invalidates any of the 17 rules. The **watch item** is the task's own hypothesis: *if Cursor's commercial trajectory (managed, metered, enterprise-tier async agents at scale) makes M5 (Minsky-as-managed-product) infeasible for an OSS-led player, that IS a vision-threat.* Current read: it does **not**. Cursor's moat is the hosted IDE plus closed managed compute, while Minsky's M5 thesis is *operator-owned, constitution-governed* autonomy that a hosted-by-default vendor structurally cannot offer — you cannot host "runs on your machine, under your own identity". A negative finding is logged to `ask-human.md` for the audit trail per the deep-research convention, with the recommendation "absorb the trigger-adapter lesson, no vision change; keep the M5-vs-Cursor-enterprise question on the watch list".

### 4. How can we improve our strategy based on this?

- **Add a trigger adapter, keep `TASKS.md` canonical** — the strongest Cursor result is that *async work should be startable from where the human already is*. Strategy move: expose a chat/issue → `TASKS.md`-block trigger as an adapter (rule #2) so activation energy drops without compromising the queue as the single source of truth. Traces to lesson §2.1.
- **Make `cost-per-merged-pr` the headline economic narrative** — Cursor's metered pricing proves the always-on workload is *not* flat-rate cheap; Minsky's budget economy is the differentiator. Strategy move: keep `cost-per-merged-pr` plus budget-guard auto-pause prominent in README and scorecard so the operator sees the 24/7 economics Cursor's tier hides. Traces to lesson §2.3.
- **Position on ownership and governance, not on "we also do async"** — competing on async-execution alone loses to a polished hosted product. Strategy move: lead the M5 narrative with *operator-owned identity plus constitution-enforcement CI* (the two things a hosted vendor cannot replicate), not feature parity. Traces to lesson §2.2 and the §3 watch item.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **The timed loop**: KEEP — Cursor's trigger is human- or chat-initiated, not a self-running loop; nothing to replace.
- **Self-improvement loop**: KEEP — no self-improvement or self-grading substrate exists in Cursor's review-gated model.
- **Adapters / context assembly**: AUGMENT (optional) — a *trigger adapter* (chat/issue → task block) is the one place Cursor's ergonomics pays rent. It is additive, not a replacement, and the execution still runs through Minsky's own agents.
- **Sandbox**: N/A — Cursor's remote sandbox is its own closed concern; Minsky's supervisor sandbox is operator-owned by design.
- **Corpus / scorecard**: KEEP — Cursor stays a live corpus entry (one `autonomous-merge-rate` reading wired in); nothing to replace.
- **Dashboard / `TASKS.md` surface**: KEEP — Cursor has no operator-owned task queue or Watch; this is a Minsky differentiator, not a borrow.

**Total replace across all surfaces: 0%** (one optional AUGMENT on a trigger adapter; everything else KEEP or N/A). The headline for the operator: *nothing to replace; one optional trigger-ergonomics lesson to absorb; the M5-vs-Cursor-enterprise question stays on the watch list.*

## Last reviewed

2026-06-01 — deepened with the Five Pivot Questions framework plus Background Agents (Cursor 0.50) analysis per task `competitor-deepen-cursor-agent`. Verdict: complementary, not a wrap target (closed service, no headless spawn API); absorb the trigger-adapter ergonomics lesson; no vision change — the M5-vs-Cursor-enterprise question stays on the watch list (negative finding logged to `ask-human.md`).
