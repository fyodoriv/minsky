# Competitor: edobry/minsky (Eric Dobry)

> A second open-source project also named "Minsky." It shares this project's family tree but serves a different person: a developer who stays in the loop, not an unattended overnight worker. It is a sibling to cite, not a rival to beat.

- **URL**: <https://github.com/edobry/minsky>
- **Status**: Active (~6 stars, TypeScript, ~12,400 commits on main, recently maintained as of 2026-06)
- **Pricing**: Free (open source).
- **Relationship**: **Architectural sibling (not a product competitor).** Same intellectual lineage, same name, an adjacent but distinct audience. Linking to each other helps people find both; neither takes users from the other.
- **One-line self-description (verbatim)**: "A coding agent workflow tool inspired by organizational cybernetics".

## What this is

edobry/minsky is a coordination tool for software teams. Its core idea: give human developers and AI coding assistants the *exact same surfaces* to work through — one command-line tool and one set of MCP tools — and then keep both in line by shaping their shared environment, not by giving each one separate instructions.

In this document, "agent" means the coding assistant that does the actual editing — Claude Code, Devin, Aider, or OpenHands. Neither Minsky is an agent; both drive agents.

Concretely, edobry/minsky works like this:

- Work surfaces are Markdown rule files with YAML frontmatter, compiled into instructions the agent reads.
- Tasks live in a backend (GitHub Issues, or edobry/minsky's own database).
- A "session" is an isolated git clone tied to one task. All implementation work happens inside it.
- A human — or an AI agent working under the same gates — edits and commits inside the session.
- Opening a pull request requires rebasing first. An explicit `session pr approve` step gates the merge.

The load-bearing principle is **environmental pre-delegation**: in the project's own words, "alignment is achieved through environmental design, not individual discipline." The same pre-commit hook that stops a human from pushing unformatted code stops an AI agent the same way. The environment enforces the rule, not a reminder.

The project's theory-of-operation doc maps the whole system onto Stafford Beer's five-organ Viable System Model: System 1 (operations — the work in git sessions), System 2 (coordination — the mesh), System 3 (operational feedback — the pre-commit then pre-push then CI gate ladder), System 4 (strategic intelligence — context generation), and System 5 (identity and policy — configuration).

## What this is not

- **Not in the benchmark corpus.** It does not appear in `novel/competitive-benchmark/src/competitors.ts` (the M1.10 scorecard). The scorecard ranks product competitors on shared numbers (HumanEval pass-rate, cost per iteration, and the like). edobry/minsky is not a head-to-head product on those axes and has no published benchmark number, so a scorecard row would force an apples-to-oranges comparison. See "Why this is not in the benchmark corpus" below.
- **Not an autonomous overnight worker.** A developer drives the sessions. AI agents work under the same gates as a symmetry property, not as the thing that picks up tasks and runs on its own.
- **Not a self-improvement loop.** It tracks knowledge-base freshness (fresh, aging, stale) to inform retrieval, but it does not file work against its own weak spots.

## Strengths

- **One environment for humans and agents.** Identical command-line and MCP surfaces mean a rule that constrains a human constrains an agent identically. No separate "agent mode."
- **Explicit cybernetic architecture.** The five organs of Beer's Viable System Model are named subsystems in the code, not a buried metaphor. The architecture *is* the model.
- **Git-native isolation.** Each task gets its own isolated git clone, so concurrent work does not collide.
- **Graceful degradation.** When a source fails, the scheduler logs a `warn` and lets the rest of the work continue rather than halting everything.

## Weaknesses vs Minsky's vision

The shared family tree makes the gaps sharp rather than fuzzy. Both projects come from the same lineage — Stafford Beer's Viable System Model — but sit at opposite ends of one axis: how much the human stays in the per-task loop.

| Axis | edobry/minsky | this Minsky |
|---|---|---|
| **Primary operator** | Human stays in the loop. A developer drives sessions; AI agents work under the same gates as a symmetry property, not as the autonomous driver. | Autonomous. The daemon — a background program that keeps running on your machine — picks tasks from `TASKS.md` and works overnight with no per-task human command. |
| **Cybernetics framing** | Explicit. The five Viable System Model organs are named subsystems in `docs/theory-of-operation.md`. | A lineage anchor (rule #5, theoretical foundations). Recursion is applied across the fleet, but the daemon is not built as five named organs. |
| **Alignment mechanism** | Environmental pre-delegation: humans and agents share identical surfaces, and the environment constrains both the same way. | Constitutional CI gates: 17 numbered rules, each enforced by a deterministic lint. The agent runs as *your own identity* — there is no symmetric human-agent surface. |
| **Self-improvement** | Not a closed loop. Knowledge-base freshness feeds retrieval, but the system does not file work against its own weak spots. | A MAPE-K loop ships — the self-improvement loop that Monitors, Analyzes, Plans, and Executes over a Knowledge base (experiment store, observer, specification monitor, self-task-filing). Closed-loop prompt A/B testing is still spec-only (user-story-003). |
| **Scope** | One repository. Coordination among people and agents inside an organization. | A cross-repo fleet on your own machine, taking each host (one git repository) in turn. |

The crisp summary: **edobry/minsky makes the human and the agent equal under one shared environment; this Minsky removes the human from the per-task loop entirely and makes the background worker heal itself.** Same ancestor (Beer's Viable System Model), opposite ends of the autonomy axis.

## What we learn / steal

Both projects already share several patterns, which confirms the lineage rather than borrowing anything new:

- **Viable System Model as the spine.** edobry/minsky maps the five systems onto concrete subsystems. This project applies the same model recursively across a multi-repo fleet — one daemon walking several hosts, each round of work a smaller viable loop. See [`docs/prior-art-and-name-collisions.md` § "Viable System Model"](../docs/prior-art-and-name-collisions.md#3-viable-system-model--the-recursive-structure) and [Beer 1972 in `vision.md`](../vision.md).
- **A Markdown work surface, not a web UI.** edobry/minsky uses Markdown rule files; this project uses `TASKS.md` as the to-do list it reads. Both reject a web UI or custom language as the main surface.
- **Progressive feedback gates as the control.** edobry/minsky's pre-commit then pre-push then CI staging is the same shape as this project's `pnpm pre-pr-lint --stage=stop-gate|fast|full` ladder and its 17 constitutional CI lints. Both put correctness in the gate ladder, not in human vigilance.
- **Git-native session isolation.** edobry/minsky's "session = isolated git clone tied to a task" mirrors this project's worktree-isolated daemon iterations (`.worktrees/<id>`).
- **Let-it-crash reflexes.** edobry/minsky drops a failing source at `warn` level and lets the rest run. This project's rule #6 (crash softly, let the supervisor restart) and rule #7 (chaos-typed failure modes) are the same Erlang/OTP discipline — the let-it-crash stance: crash loudly and let the watchdog restart, rather than retry silently.

## Why choose Minsky over edobry/minsky

Choose this Minsky when you want a background worker that picks tasks from `TASKS.md` and runs through the night on its own, across several repositories, healing itself when it crashes — with no human command per task.

## Why choose edobry/minsky over Minsky

Choose edobry/minsky when you want a human in the loop with environmental guardrails: developers and AI agents working through one shared environment, inside a single organization, where the gates constrain both equally.

## Scorecard readings

edobry/minsky has no scorecard readings. It is not in the benchmark corpus (`novel/competitive-benchmark/src/competitors.ts`) and has no published benchmark number. See the next two sections for why.

### Why this is not in the benchmark corpus

The scorecard ranks product competitors on shared numbers (HumanEval pass-rate, cost per iteration, and the like). edobry/minsky is not a head-to-head product on those axes — it is an architectural sibling with a different operator and no published benchmark. Adding it would force an apples-to-oranges comparison. The honest disposition is this deep-dive file plus a disambiguation-table row, not a scorecard entry.

## Should we wrap edobry/minsky instead?

No. The disposition is cross-citation, not wrapping or competition. Because the two projects sit at opposite ends of the autonomy axis under the same name and lineage, anyone who finds one is well served by a pointer to the other:

- Want human-in-the-loop coordination with environmental guardrails? You want edobry/minsky.
- Want an autonomous overnight daemon working against `TASKS.md`? You want this Minsky.

The two audiences barely overlap, so mutual links raise discoverability for both with no risk of taking each other's users — and they head off accidental confusion over the shared name. The disambiguation table in [`docs/prior-art-and-name-collisions.md`](../docs/prior-art-and-name-collisions.md#not-to-be-confused-with) carries the deep-links into edobry/minsky's specific architecture sections.

### The outreach half is blocked

The full goal also includes contacting edobry/minsky through a GitHub issue offering mutual citation, and — if accepted — both READMEs linking each other. That half cannot ship from an unattended worktree:

- Opening a GitHub issue under your identity is a public write. The Public Impersonation Ban requires your explicit per-session approval.
- A maintainer's acknowledgment is an external human response that cannot be produced in-session.

This file plus the disambiguation deep-links deliver the measurable, in-repo half: discovery improves for both projects unilaterally. The outreach is yours to send. Per the task's own pivot guidance, a documentation-only outcome is the correct disposition when the collaboration half cannot be completed in-session.

## Five pivot questions

1. Does edobry/minsky add an autonomous overnight loop that picks its own tasks? If so, the autonomy-axis distinction narrows.
2. Does it publish a benchmark number on shared metrics? If so, it may earn a scorecard row.
3. Does it go dormant for more than 90 days? If so, downgrade this deep-dive to a one-line mention.
4. Does it adopt a closed self-improvement loop (filing work against its own weak spots)? If so, re-compare the self-improvement row.
5. Does a maintainer accept the mutual-citation offer? If so, both READMEs link each other and this file records the acknowledgment.

## Last reviewed

2026-06-02 — primary-source deep-dive of edobry/minsky's `docs/architecture.md` (§ "Session Model", § "Knowledge Base") and `docs/theory-of-operation.md` (§ "The Five-Organ Architecture (VSM Mapping)", § "Environmental Pre-delegation"). Repo active (~6 stars, ~12,400 commits, recently maintained) — the "dormant >90 days" pivot condition does not fire, so the full deep-dive (not a one-line mention) is justified.
