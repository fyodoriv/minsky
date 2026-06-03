# Competitor: Plandex (plandex-ai)

> Plandex is a terminal coding assistant built to grind on one big, multi-file task. It is the closest open-source tool to Minsky on the "let it run a long time on its own" axis, so it sits on the watch list rather than as a quiet entry in the data set.

- **URL**: <https://github.com/plandex-ai/plandex>
- **Status**: **Alive / actively developed** — ~15.4k★ as of this review; v2 (the "10x larger context, 2M tokens" rewrite) shipped and is the current line; MIT-licensed core
- **Pricing**: Open-source core (MIT) — self-host the server for free and bring your own model API keys; Plandex Cloud offers a hosted integrated-models plan and a self-hosted-with-your-keys tier
- **Relationship**: **Competitor (partial)** — a terminal coding assistant in the same "let it run on a big task" space as Minsky's single-task delivery, but it works one project at a time with one developer driving it, not as a background program that walks several repositories on its own

## What this is

Plandex is an open-source coding assistant you run in your terminal. It is built for large jobs that span many files and many steps — more than a single chat turn can hold. Three ideas set it apart:

- **Persistent plan state.** Work is organized into named *plans*. Each plan keeps a running context and a version history in a local `.plandex` directory plus a server (SQLite or Postgres). A long task survives across sessions, and you can branch it or rewind it with `plandex rewind`.
- **A full-auto mode.** Plandex can keep going across many steps on its own — build, apply the changes, run them, and debug failures — with the level of autonomy you choose. At the top setting it auto-applies changes and auto-runs commands in a sandbox.
- **A diff sandbox.** Changes pile up in a separate sandbox first. You review them as a diff (a TUI view, or `plandex diff`) and approve before they touch your project — or full-auto applies them for you.

Version 2 leans on a large effective context window (marketed as ~2M tokens, through context management plus a tree-sitter project map) so it can reason over big codebases.

You run it as a CLI (`plandex` / `pdx`) that talks to a Plandex server you self-host (Docker or local) or use through Plandex Cloud. It is model-agnostic through provider keys (Anthropic, OpenAI, OpenRouter, and others). The intent is a developer-driven "give it a hard task and let it work" loop.

To keep one term clear up front: an *agent* here means the coding assistant that does the actual work. Minsky is not an agent — Minsky is the background program that drives agents. Plandex is the kind of agent Minsky would drive.

## What this is not

- **Not a background program that runs on its own.** Plandex's full-auto mode runs *a task a developer started*. There is no loop that wakes on a timer, picks the next item from a to-do list, and keeps a repo improving overnight with no human present. (Minsky moat #1, `vision.md § Stay alive`.)
- **Not running as you.** Plandex applies changes through its CLI and server. It does not run *as the operator* — the human who runs it — with your `~/.gitconfig`, `~/.ssh`, and `gh`, so commits do not land under your name by construction. We call that *operator-machine identity*. (Minsky moat #2.)
- **Not self-improving.** Plandex has no loop that grades its own results and tunes its prompts from history. Its autonomy is configured, not learned. (Minsky moat #4.)
- **Not a multi-repo tool.** A plan targets one project directory. There is no walking several code projects in turn — what Minsky calls a *cross-repo fleet*. (Minsky moat #5.)
- **Not a rules-enforcing gate.** Its review gates are a human clicking approve in the TUI, not a deterministic check the operator owns that *refuses* output breaking the project's rules. (Minsky moats #3, #10.)

## Strengths

- **Persistent, versioned plan state** — long tasks survive sessions, context is cumulative, and branches plus `plandex rewind` give a real undo over an autonomous run. This is closer to Minsky's "keep working on it" intent than a stateless chat agent.
- **Full-auto execution loop** — build → apply → run → debug-on-failure can run with few human turns. This is the feature that overlaps Minsky's loop most directly.
- **Diff sandbox + review gates** — changes land in a sandbox first; you review a diff and approve. This is a principled answer to "don't let the agent stomp the working tree".
- **Large-codebase targeting** — tree-sitter project maps plus aggressive context management aim at ~2M effective context, so it degrades less on big repos than agents that dump flat files into context.
- **Open-source, self-hostable, model-agnostic** — MIT core, bring your own keys, no lock-in to one model vendor. This is the same anti-lock-in instinct behind Minsky's rule #1 (don't reinvent) and rule #2 (swap tools behind a fixed interface).

## Weaknesses vs Minsky's vision

1. **Developer-driven, not a background program** — Plandex's full-auto mode runs *a task a developer started*. There is no self-running loop that picks the next task from a to-do list and keeps a repo improving overnight with no human present (Minsky moat #1, `vision.md § Stay alive`).
2. **No operator-machine identity binding** — Plandex applies changes through its CLI and server. It does not run *as the operator* with your `~/.gitconfig`, `~/.ssh`, and `gh`, so commits do not land as you by construction (Minsky moat #2).
3. **No self-improvement loop** — there is no Monitor-Analyze-Plan-Execute-over-Knowledge (MAPE-K) observer that grades outcomes and tunes the agent's own prompts and strategy from history. Autonomy is configured, not learned (Minsky moat #4).
4. **Single-project focus** — a plan targets one project directory. There is no cross-repo fleet that walks N repos in turn (Minsky moat #5).
5. **No rules-as-CI governance** — review gates are human approval in the TUI, not a deterministic, operator-owned check that *refuses* output breaking the project's rules (Minsky moats #3, #10).

## What we learn / steal

- **Persistent, branchable plan state as a first-class artifact** — Plandex makes the *plan* (cumulative context, version history, branches) durable and inspectable. Minsky's per-task state is more ephemeral. The lesson: a long autonomous run benefits from a rewind-able, branchable state surface. This applies to how the background program persists and resumes a long task, behind an interface (rule #2).
- **Diff sandbox before apply** — pile up changes in a sandbox, review the diff, then apply. Minsky already isolates work in git worktrees. Plandex's explicit *review-the-diff-then-apply* gate is a clean pattern for the operator-approval seam.
- **Tree-sitter project mapping for large-context retrieval** — structure-aware project maps (like AutoCodeRover's AST search; see `competitors/auto-code-rover.md`) reinforce that context assembly is a measurable, swappable seam, not a flat file dump. This is a candidate context adapter behind `novel/adapters/` — a small wrapper that lets Minsky swap one outside tool without touching the rest (rule #2; named pattern per rule #5).
- **Autonomy as a configurable dial** — Plandex exposes autonomy levels (suggest → auto-apply → full-auto + auto-execute). The lesson for Minsky: keep autonomy *visible and bounded* (it already is, via budget plus watchdog), not hidden.

## Why choose Minsky over Plandex

- A background program that runs around the clock, picks the next task from a to-do list, and keeps a repo improving with no human present — vs a developer-driven full-auto run on a task you started.
- Operator-machine identity: commits land as you, using your ambient `~/.gitconfig`, `~/.ssh`, and `gh` — vs a CLI and server applying changes without that identity binding.
- A cross-repo fleet across N repos — vs single-project plans.
- A rules-enforcing CI the operator owns, where deterministic gates refuse output breaking the project's rules — vs human-approval review gates in a TUI.
- A MAPE-K self-improvement substrate: the program files tasks against its own weak spots — vs autonomy that is configured but not learned.
- Agent-agnostic orchestration: Plandex could itself be one of the assistants Minsky drives — vs Plandex's own fixed agent loop.

## Why choose Plandex over Minsky

- If you want a polished, terminal-native, developer-in-the-loop assistant for *one hard task on one project*, with strong context management and a reviewable diff sandbox.
- If you want persistent, branchable plan state with rewind over a long autonomous run, out of the box.
- If you want to self-host a single-developer coding assistant with your own model keys and minimal orchestration ceremony.
- If your need is "let an agent grind on a big refactor while I review diffs", not "keep a fleet of repos alive indefinitely".

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

No vendor-primary benchmark reading on the M1.10 catalogue metrics is published for Plandex as of this review. Plandex publishes capability docs, a star count, and product positioning (large context, full-auto), but no Plandex-primary number on the catalogue's DORA-4 / agentic-6 / public-benchmark-2 metrics (for example, no Plandex-authored SWE-bench Verified or HumanEval Pass@1 result). Per the validator's published-primary rule (rule #4 — visible, no fabricated readings), Plandex is therefore **not wired into `competitors.ts` with a metric value**. It stays a qualitative corpus entry until a vendor-primary reading appears.

| Metric | Value | Date | Primary source |
| ------ | ----- | ---- | -------------- |
| *(none — no vendor-primary catalogue reading published)* | — | — | Plandex docs at <https://docs.plandex.ai> and the `plandex-ai/plandex` repository README. A `corpus-refresh-plandex` task should wire a reading if Plandex later publishes a catalogue-aligned benchmark. |

## Should we wrap Plandex instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with one question: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Partial. Plandex is an *agent-tier* CLI plus server, not an orchestrator. It has a real headless-ish CLI (`plandex`), so it could be one of the assistants Minsky drives, the way Minsky drives `claude` / `devin` / `aider`. But it brings its own plan-state server and full-auto loop, so wrapping it means running an agent-with-its-own-loop *inside* Minsky's loop — a layering mismatch. |
| 2. **What we delegate** | At most the *execute-one-task* inner loop (Plandex as a 5th agent backend behind the agent adapter). The cross-repo background program, the task list, the rules CI, the operator-identity binding, and the MAPE-K substrate are not delegable to Plandex. |
| 3. **What we keep** | All 6 moats survive: background-program-not-framework, operator-machine identity, rules plus CI the operator owns, MAPE-K substrate, cross-repo fleet, `TASKS.md` surface (the plain-text to-do list Minsky reads to pick work). |
| 4. **Net moat after wrap** | 6 of 6 (a wrap would add an agent option, not subtract a moat). The relevant action is *competitive positioning plus a possible agent-adapter follow-up*, not delegation of the load-bearing orchestrator layer. |
| 5. **Verdict** | **NO STRUCTURAL WRAP (agent-tier with its own loop plus plan-state server; layering mismatch).** Do not replace any Minsky layer. *Optionally* evaluate Plandex as an additional agent backend behind the existing agent adapter (rule #2) as a separate, low-priority follow-up — not a P0 wrap. No P0 wrap task is filed. |

**Trigger for re-evaluation**: if Plandex ships a stable headless spawn-task → PR interface that runs as the operator (ambient identity) and composes cleanly inside an outer loop without its own competing autonomy controller, re-run this as an agent-tier wrap candidate (same shape as the Devin per-task wrap).

## Five pivot questions

### 1. How is it different from Minsky?

Plandex is a terminal-based, developer-driven coding assistant for large single-project tasks, with persistent branchable plan state, a diff sandbox, and a configurable full-auto loop. Minsky is an operator-owned, rules-governed, self-improving background program that runs around the clock and drives *other* agents across a fleet of repos. They overlap on the *unattended-long-running-on-a-hard-task* axis — Plandex's full-auto loop is the closest open-source analogue to Minsky's loop — but they diverge on three points:

- **Trigger.** Minsky's is the `TASKS.md` to-do list plus a timed loop, with no human present. Plandex's is a developer who starts a plan and lets full-auto run.
- **Ownership.** Minsky runs as the operator with the operator's identity (moat #2). Plandex applies changes through its CLI and server without that binding.
- **Governance.** Minsky gates output through a deterministic, operator-owned rules CI (moats #3, #10). Plandex's gates are human approval in a TUI.

Plandex is the kind of agent Minsky would *wrap* (a 5th backend), not a peer orchestrator.

### 2. What lessons can it give to us?

- **Persistent, branchable, rewind-able plan state** (Plandex's `.plandex` plus server, `plandex rewind`, branches) — a long autonomous run benefits from durable, inspectable state. Applies to how the background program persists and resumes a long task, behind an interface (rule #2).
- **Diff sandbox → review → apply gate** (Plandex sandbox plus `plandex diff`) — a clean pattern for the operator-approval seam, on top of Minsky's existing worktree isolation.
- **Tree-sitter project mapping for large-context retrieval** (Plandex v2 context management) — structure-aware context assembly is a measurable, swappable seam; a candidate context adapter behind `novel/adapters/` (rule #2; named pattern per rule #5), echoing the AST-search lesson in `competitors/auto-code-rover.md`.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding, with one explicit watch item (the task's own pivot).** The three lessons — durable plan state, a diff-review gate, and structure-aware retrieval — are technique and ergonomics level. None forces a rewrite of `vision.md § What Minsky is` or invalidates any of the 17 rules.

The **watch item** is the task's hypothesis and pivot directly: *Plandex's full-auto build → apply → debug loop is the open-source feature that most overlaps Minsky's cross-repo-runner / timed loop.* Current read: it does **not** match the cross-repo-runner. Plandex's loop is single-project and developer-initiated, and it lacks the unattended to-do-list trigger, the operator-identity binding, the rules CI, and the MAPE-K self-improvement that define Minsky's loop. So the pivot threshold ("if Plandex's cross-repo-runner equivalent matches Minsky's, file vision-threat") is **not** crossed today: Plandex has no cross-repo-runner equivalent. It stays on the watch list.

A negative finding is logged for the audit trail per the deep-research convention — this file's verdict and watch item stand in for the central `ask-human.md` note the orchestrator maintains — with the recommendation "absorb plan-state + diff-gate + retrieval ergonomics; no vision change; keep the full-auto-loop-becomes-cross-repo question on the watch list".

### 4. How can we improve our strategy based on this?

- **Make long-task state durable and rewind-able** — Plandex proves operators value being able to branch and rewind an autonomous run. Strategy move: keep the program's per-task state inspectable and resumable behind an interface (rule #2), so a long task is recoverable, not a black box. Traces to lesson §2.1.
- **Lead positioning with the unattended-fleet axis, not the single-task-autonomy axis** — Plandex wins "let it grind on one big task with great context management". Strategy move: position Minsky on what Plandex structurally lacks — *no human present, a to-do list, cross-repo, operator identity, rules CI* — rather than competing on single-project autonomy polish. Traces to lessons §2.1–§2.3 and the §3 watch item.
- **Treat agent backends as swappable, Plandex potentially among them** — rule #1's GET-don't-IMPLEMENT bias says a strong open-source agent is a candidate backend, not a thing to reimplement. Strategy move: keep the agent adapter (rule #2) open enough that Plandex could slot in as a 5th backend if its headless interface matures. Traces to the wrap analysis above.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **timed loop**: KEEP — Plandex's full-auto loop is developer-initiated and single-project; it is not a to-do-list-driven unattended loop, so there is nothing to replace at the orchestrator layer.
- **MAPE-K**: KEEP — no self-improvement or self-grading substrate exists in Plandex's configured-autonomy model.
- **adapters / agent backend**: AUGMENT (optional, low-priority) — Plandex could be evaluated as a 5th agent backend behind the existing agent adapter (rule #2); additive, and the outer loop stays Minsky's. Not a P0.
- **adapters / context assembly**: AUGMENT (optional) — the tree-sitter project-map / structure-aware retrieval technique is worth a context adapter behind `novel/adapters/`; the same lesson as `competitors/auto-code-rover.md`.
- **sandbox**: KEEP — Minsky's worktree isolation plus supervisor sandbox is operator-owned by design; borrow the *review-the-diff-then-apply* shape, keep the substrate.
- **corpus / scorecard**: KEEP — Plandex stays a qualitative corpus entry (no vendor-primary catalogue reading yet); nothing to replace.
- **dashboard / `TASKS.md` surface**: KEEP — Plandex has no operator-owned cross-repo task list or fleet dashboard; this is a Minsky differentiator, not a borrow.

**Total replace % across all surfaces: 0%** (two optional AUGMENTs — an agent-backend evaluation and a context adapter; everything else KEEP). The headline for the operator: *nothing to replace; absorb the plan-state + diff-gate + retrieval ergonomics; keep the full-auto-loop-vs-cross-repo-runner question on the watch list.*

## Last reviewed

2026-06-01 — first entry; `--deep` mode per task `competitor-add-plandex`. Verdict: alive + actively developed (v2, ~15.4k★, MIT core); the closest open-source competitor on the unattended-long-running axis but structurally agent-tier/single-project; STRUCTURAL-MISMATCH/NO wrap (optionally a low-priority agent-backend follow-up); no vision change — the full-auto-loop-vs-cross-repo-runner pivot is NOT crossed (Plandex has no cross-repo-runner equivalent) and stays on the watch list.
