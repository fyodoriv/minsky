# Competitor: Plandex (plandex-ai)

> The closest live open-source competitor on the *unattended, long-running, large-project* axis — Plandex's full-auto mode, persistent on-disk plan state, sandboxed diff review, and 2M-effective-context targeting overlap Minsky's tick-loop more than any other OSS agent, so it earns a watch-item on the vision-threat list rather than a quiet corpus row.

- **URL**: <https://github.com/plandex-ai/plandex>
- **Status**: **Alive / actively developed** — ~15.4k★ as of this review; v2 (the "10x larger context, 2M tokens" rewrite) shipped and is the current line; MIT-licensed core
- **Pricing**: Open-source core (MIT) — self-host the server for free and bring your own model API keys; Plandex Cloud offers a hosted integrated-models plan and a self-hosted-with-your-keys tier
- **Relationship**: **Competitor (partial)** — a terminal-based autonomous coding agent in the same "let it run on a big task" space as Minsky's single-task delivery, but agent-tier (one project, one developer driving) rather than an operator-owned cross-repo daemon

## What it is

Plandex is a **terminal-based, open-source AI coding agent** built for large, multi-file, multi-step tasks that exceed what a single chat turn can hold. Its three distinctive ideas are: (1) **persistent plan state** — work is organized into named *plans* with a cumulative context and a version history kept in a local `.plandex` directory + a server (SQLite/Postgres), so a long task survives across sessions and can be branched/rewound; (2) **a full-auto mode** — Plandex can autonomously continue across many steps (build → apply → debug-execution loop) with configurable autonomy, including auto-applying changes and auto-executing commands in a sandbox; (3) **a diff sandbox** — changes accumulate in a separate sandbox and are reviewed (TUI diff view, `plandex diff`) and applied to the project only on the developer's approval (or automatically in full-auto). v2 emphasizes a large effective context window (marketed as ~2M tokens via context management + tree-sitter project mapping) so it can reason over big codebases.

It runs as a CLI (`plandex` / `pdx`) talking to a Plandex server you self-host (Docker / local) or use via Plandex Cloud; it is model-agnostic through provider keys (Anthropic, OpenAI, OpenRouter, and others). The intent is a developer-driven "give it a hard task and let it work" loop, not a headless fleet supervisor.

## Strengths

- **Persistent, versioned plan state** — long tasks survive sessions; context is cumulative; branches and rewind/`plandex rewind` give a real undo over an autonomous run. This is genuinely closer to Minsky's "keep working on it" intent than a stateless chat agent.
- **Full-auto execution loop** — build → apply → execute → debug-on-failure can run with minimal human turns, the feature that overlaps Minsky's tick-loop most directly.
- **Diff sandbox + review gates** — changes land in a sandbox first; the developer reviews a diff and approves, which is a principled answer to "don't let the agent stomp the working tree".
- **Large-codebase targeting** — tree-sitter project maps + aggressive context management aimed at 2M-effective-context, so it degrades less on big repos than file-blob-context agents.
- **Open-source + self-hostable + model-agnostic** — MIT core, BYO keys, no lock-in to a single model vendor — the same anti-lock-in instinct Minsky's rule #1 + rule #2 encode.

## Weaknesses vs Minsky's vision

1. **Developer-driven, not an unattended daemon** — Plandex's full-auto mode runs *a task a developer started*; there is no self-running tick-loop that picks the next task from a queue and keeps a repo improving overnight with no human present (Minsky moat #1, `vision.md § Stay alive`).
2. **No operator-machine identity binding** — Plandex applies changes through its CLI/server; it does not run *as the operator* with the operator's `~/.gitconfig` / `~/.ssh` / `gh` so commits land as the operator by construction (Minsky moat #2).
3. **No self-improvement loop** — there is no MAPE-K observer that grades outcomes and tunes the agent's own prompts/strategy from history; autonomy is configured, not learned (Minsky moat #4).
4. **Single-project focus** — a plan targets one project directory; there is no cross-repo fleet round-robin across N hosts (Minsky moat #5).
5. **No constitution-as-CI governance** — review gates are human-approval in the TUI, not a deterministic constitution-enforcement CI the operator owns that *refuses* violating output (Minsky moats #3, #10).

## What we learn / steal

- **Persistent, branchable plan state as a first-class artifact** — Plandex makes the *plan* (cumulative context + version history + branches) durable and inspectable. Minsky's per-task state is more ephemeral; the lesson is that a long autonomous run benefits from a rewind-able, branchable state surface — applicable to how the daemon persists and resumes a long task, behind an interface (rule #2).
- **Diff sandbox before apply** — accumulate changes in a sandbox, review the diff, then apply. Minsky already isolates work in worktrees; Plandex's explicit *review-the-diff-then-apply* gate is a clean ergonomics pattern for the operator-approval seam.
- **Tree-sitter project mapping for large-context retrieval** — structure-aware project maps (like AutoCodeRover's AST search, see `competitors/auto-code-rover.md`) reinforce that context assembly is a measurable, swappable seam, not a flat file dump — a candidate context adapter behind `novel/adapters/` (rule #2, rule #5-clean — named pattern).
- **Autonomy as a configurable dial** — Plandex exposes autonomy levels (suggest → auto-apply → full-auto + auto-execute). The lesson for Minsky is to keep autonomy *visible and bounded* (it already is, via budget + watchdog), not hidden.

## Why choose Minsky over Plandex

- 24/7 daemon that picks the next task from a queue and keeps a repo improving unattended vs a developer-driven full-auto run on a task you started
- Operator-machine identity (commits land as the operator, ambient `~/.gitconfig` / `~/.ssh` / `gh`) vs a CLI/server applying changes without that identity binding
- Cross-repo fleet across N hosts vs single-project plans
- Constitution-enforcement CI the operator owns (deterministic gates refuse violating output) vs human-approval review gates in a TUI
- MAPE-K self-improvement substrate (the daemon files tasks against its own weak spots) vs configured-but-not-learned autonomy
- Agent-agnostic orchestration (Plandex could itself be a wrapped backend) vs Plandex's own fixed agent loop

## Why choose Plandex over Minsky

- If you want a polished, terminal-native, developer-in-the-loop agent for *one hard task on one project* with strong context management and a reviewable diff sandbox
- If you want persistent, branchable plan state with rewind over a long autonomous run, out of the box
- If you want to self-host a single-developer coding agent with BYO model keys and minimal orchestration ceremony
- If your need is "let an agent grind on a big refactor while I review diffs", not "keep a fleet of repos alive indefinitely"

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

No vendor-primary benchmark reading on the M1.10 catalogue metrics is published for Plandex as of this review. Plandex publishes capability docs, a star count, and product positioning (large context, full-auto), but no Plandex-primary number on the catalogue's DORA-4 / agentic-6 / public-benchmark-2 metrics (e.g. no Plandex-authored SWE-bench Verified or HumanEval Pass@1 result). Per the validator's published-primary rule (rule #4 — visible, no fabricated readings), Plandex is therefore **not wired into `competitors.ts` with a metric value**; it stays a qualitative corpus entry until a vendor-primary reading appears.

| Metric | Value | Date | Primary source |
| ------ | ----- | ---- | -------------- |
| *(none — no vendor-primary catalogue reading published)* | — | — | Plandex docs at <https://docs.plandex.ai> and the `plandex-ai/plandex` repository README. A `corpus-refresh-plandex` task should wire a reading if Plandex later publishes a catalogue-aligned benchmark. |

## Should we wrap Plandex instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Partial. Plandex is an *agent-tier* CLI + server, not an orchestrator. It has a real headless-ish CLI (`plandex`), so it is conceivable as a wrapped backend the way Minsky wraps `claude`/`devin`/`aider` — but it brings its own plan-state server and full-auto loop, so wrapping it means running an agent-with-its-own-loop *inside* Minsky's loop, a layering mismatch. |
| 2. **What we delegate** | At most the *execute-one-task* inner loop (Plandex as a 5th agent backend behind the agent adapter). The cross-repo daemon, the task queue, the constitution CI, the operator-identity binding, and the MAPE-K substrate are not delegable to Plandex. |
| 3. **What we keep** | All 6 moats survive: daemon-not-framework, operator-machine identity, constitution + CI the operator owns, MAPE-K substrate, cross-repo fleet, `TASKS.md` surface. |
| 4. **Net moat after wrap** | 6 of 6 (a wrap would add an agent option, not subtract a moat). The relevant action is *competitive positioning + a possible agent-adapter follow-up*, not delegation of the load-bearing orchestrator layer. |
| 5. **Verdict** | **NO STRUCTURAL WRAP (agent-tier with its own loop + plan-state server; layering mismatch).** Do not replace any Minsky layer. *Optionally* evaluate Plandex as an additional agent backend behind the existing agent adapter (rule #2) as a separate, low-priority follow-up — not a P0 wrap. No P0 wrap task is filed. |

**Trigger for re-evaluation**: if Plandex ships a stable headless spawn-task → PR interface that runs as the operator (ambient identity) and composes cleanly inside an outer loop without its own competing autonomy controller, re-run this as an agent-tier wrap candidate (same shape as the Devin per-task wrap).

## Five pivot questions

### 1. How is it different from Minsky?

Plandex is a **terminal-based, developer-driven autonomous coding agent** for large single-project tasks, with persistent branchable plan state, a diff sandbox, and a configurable full-auto loop. Minsky is an **operator-owned, constitution-governed, self-improving 24/7 daemon** that orchestrates *other* agents across a fleet of repos. They overlap on the *unattended-long-running-on-a-hard-task* axis — Plandex's full-auto loop is the closest OSS analogue to Minsky's tick-loop — but diverge on three: (a) **trigger** — Minsky's is the `TASKS.md` queue + tick-loop with no human present; Plandex's is a developer who starts a plan and lets full-auto run; (b) **ownership** — Minsky runs as the operator with the operator's identity (moat #2); Plandex applies changes through its CLI/server without that binding; (c) **governance** — Minsky gates output through a deterministic constitution-enforcement CI it owns (moats #3, #10); Plandex's gates are human approval in a TUI. Plandex is the kind of agent Minsky would *wrap* (a 5th backend), not a peer orchestrator.

### 2. What lessons can it give to us?

- **Persistent, branchable, rewind-able plan state** (Plandex's `.plandex` + server, `plandex rewind` / branches) — a long autonomous run benefits from durable, inspectable state; applicable to how the daemon persists and resumes a long task, behind an interface (rule #2).
- **Diff sandbox → review → apply gate** (Plandex sandbox + `plandex diff`) — a clean ergonomics pattern for the operator-approval seam on top of Minsky's existing worktree isolation.
- **Tree-sitter project mapping for large-context retrieval** (Plandex v2 context management) — structure-aware context assembly is a measurable, swappable seam; a candidate context adapter behind `novel/adapters/` (rule #2; named pattern per rule #5), echoing `competitors/auto-code-rover.md`'s AST-search lesson.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding, with one explicit watch item (the task's own pivot).** The three lessons — durable plan state, a diff-review gate, and structure-aware retrieval — are *technique/ergonomics* level; none forces a rewrite of `vision.md § What Minsky is` or invalidates any of the 17 rules. The **watch item** is the task's hypothesis and pivot directly: *Plandex's full-auto build → apply → debug loop is the OSS feature that most overlaps Minsky's cross-repo-runner / tick-loop.* Current read: it does **not** match the cross-repo-runner — Plandex's loop is single-project, developer-initiated, and lacks the unattended queue-driven trigger, the operator-identity binding, the constitution CI, and the MAPE-K self-improvement that define Minsky's loop. So the pivot threshold ("if Plandex's cross-repo-runner equivalent matches Minsky's, file vision-threat") is **not** crossed today: Plandex has no cross-repo-runner equivalent. It stays on the watch list. A negative finding is logged for the audit trail per the deep-research convention — this file's verdict + watch item stand in for the central `ask-human.md` note the orchestrator maintains — with the recommendation "absorb plan-state + diff-gate + retrieval ergonomics; no vision change; keep the full-auto-loop-becomes-cross-repo question on the watch list".

### 4. How can we improve our strategy based on this?

- **Make long-task state durable and rewind-able** — Plandex proves operators value being able to branch and rewind an autonomous run. Strategy move: keep the daemon's per-task state inspectable and resumable behind an interface (rule #2), so a long task is recoverable, not a black box — traces to lesson §2.1.
- **Lead positioning with the unattended-fleet axis, not the single-task-autonomy axis** — Plandex wins "let it grind on one big task with great context management". Strategy move: position Minsky on what Plandex structurally lacks — *no human present, a queue, cross-repo, operator identity, constitution CI* — rather than competing on single-project autonomy polish — traces to lessons §2.1–§2.3 and the §3 watch item.
- **Treat agent backends as swappable, Plandex potentially among them** — rule #1's GET-don't-IMPLEMENT bias says a strong OSS agent is a candidate backend, not a thing to reimplement. Strategy move: keep the agent adapter (rule #2) open enough that Plandex could slot in as a 5th backend if the headless interface matures — traces to the wrap analysis above.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Plandex's full-auto loop is developer-initiated and single-project; it is not a queue-driven unattended daemon loop, so there is nothing to replace at the orchestrator layer.
- **MAPE-K**: KEEP — no self-improvement / self-grading substrate exists in Plandex's configured-autonomy model.
- **adapters / agent backend**: AUGMENT (optional, low-priority) — Plandex could be evaluated as a 5th agent backend behind the existing agent adapter (rule #2); additive, and the outer loop stays Minsky's. Not a P0.
- **adapters / context assembly**: AUGMENT (optional) — the tree-sitter project-map / structure-aware retrieval technique is worth a context adapter behind `novel/adapters/`; the same lesson as `competitors/auto-code-rover.md`.
- **sandbox**: KEEP — Minsky's worktree isolation + supervisor sandbox is operator-owned by design; borrow the *review-the-diff-then-apply* shape, keep the substrate.
- **corpus / scorecard**: KEEP — Plandex stays a qualitative corpus entry (no vendor-primary catalogue reading yet); nothing to replace.
- **dashboard / `TASKS.md` surface**: KEEP — Plandex has no operator-owned cross-repo task queue or fleet dashboard; this is a Minsky differentiator, not a borrow.

**Total replace % across all surfaces: 0%** (two optional AUGMENTs — an agent-backend evaluation and a context adapter; everything else KEEP). The headline for the operator: *nothing to replace; absorb the plan-state + diff-gate + retrieval ergonomics; keep the full-auto-loop-vs-cross-repo-runner question on the watch list.*

## Last reviewed

2026-06-01 — first entry; `--deep` mode per task `competitor-add-plandex`. Verdict: alive + actively developed (v2, ~15.4k★, MIT core); the closest OSS competitor on the unattended-long-running axis but structurally agent-tier/single-project; STRUCTURAL-MISMATCH/NO wrap (optionally a low-priority agent-backend follow-up); no vision change — the full-auto-loop-vs-cross-repo-runner pivot is NOT crossed (Plandex has no cross-repo-runner equivalent) and stays on the watch list.
