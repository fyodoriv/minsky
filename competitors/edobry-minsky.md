# Architectural sibling: edobry/minsky (Eric Dobry)

> Why this file exists: a second OSS project named "Minsky" — [`edobry/minsky`](https://github.com/edobry/minsky) — shares this project's exact ancestral framing (Stafford Beer's Viable System Model, markdown-driven work surfaces, progressive feedback gates) but targets a *different operator*: human-in-the-loop, principal-substrate coordination rather than autonomous overnight runs. It is the closest *conceptual* sibling in the whole landscape, so it deserves a deep-dive that the per-competitor template doesn't quite fit — it is not a head-to-head product competitor (it isn't in the M1.10 benchmark corpus), it is the project an operator searching "Minsky autonomous coding agent" is most likely to also find. This file documents where the two architectures overlap, where they diverge, and the disposition (cross-citation, not competition).

- **URL**: <https://github.com/edobry/minsky>
- **Status**: Active (~6★, TypeScript, ~12,400 commits on main, recently maintained as of 2026-06)
- **Pricing**: Free (OSS).
- **Relationship**: **Architectural sibling (not a product competitor).** Same cybernetic lineage, same name, adjacent-but-distinct audience. Mutual cross-citation benefits both projects' discoverability; neither cannibalises the other.
- **One-line self-description (verbatim)**: "A coding agent workflow tool inspired by organizational cybernetics".

## What it is

edobry/minsky is an "exocortex substrate" for software organizations: it translates declared intent into coordinated work by giving human developers and AI agents *identical surfaces* (a CLI and MCP tools) and aligning them through *environmental constraints* rather than per-actor instructions. Its theory-of-operation doc maps the system onto Stafford Beer's five-organ Viable System Model — System 1 (operations / the work in git sessions), System 2 (coordination / the mesh), System 3 (operational feedback / the loop of pre-commit → pre-push → CI gates), System 4 (strategic intelligence / context generation), and System 5 (identity & policy / configuration). Work surfaces are markdown rule files with YAML frontmatter, task-queue backends (GitHub Issues or a Minsky DB), and "sessions" — isolated git clones associated with a task, where implementation work happens. A human (or an AI agent acting under the same gates) edits and commits inside a session; PR creation requires rebasing; an explicit `session pr approve` step gates the merge.

The load-bearing principle is **environmental pre-delegation**: "alignment is achieved through environmental design, not individual discipline." The same pre-commit hook that blocks a human from pushing unformatted code blocks an AI agent identically — the environment, not a reminder, enforces the constraint.

## Where the two architectures overlap

Both projects descend from the same lineage and instantiate several of the same patterns:

- **Viable System Model as the spine.** edobry/minsky maps VSM Systems 1–5 *explicitly* onto concrete subsystems (sessions, hooks, CI, context-gen, config). This project applies VSM *recursively* to a multi-repo fleet (one daemon walking N hosts, each iteration a viable sub-loop) — see [`docs/prior-art-and-name-collisions.md` § "Viable System Model"](../docs/prior-art-and-name-collisions.md#3-viable-system-model--the-recursive-structure) and [Beer 1972 in `vision.md`](../vision.md).
- **Markdown-driven work surface.** edobry/minsky uses markdown rule files (YAML frontmatter) compiled into agent instructions; this project uses `TASKS.md` as the operator queue. Both reject a web UI / DSL as the primary surface.
- **Progressive feedback gates as the control mechanism.** edobry/minsky's pre-commit → pre-push → CI staging is the same shape as this project's `pnpm pre-pr-lint --stage=stop-gate|fast|full` ladder and 17 constitutional CI lints. Both treat the gate ladder, not human vigilance, as where correctness is enforced.
- **Git-native session isolation.** edobry/minsky's "session = isolated git clone associated with a task" mirrors this project's worktree-isolated daemon iterations (`.worktrees/<id>`).
- **Let-it-crash / graceful-degradation reflexes.** edobry/minsky's scheduler excludes a failing source at `warn` level and lets the rest run; this project's rule #6 (soft-by-default crash + supervisor restart) and rule #7 (chaos-typed failure modes) are the same Erlang/OTP discipline.

## Where they diverge

The shared spine makes the differences sharper, not fuzzier:

| Axis | edobry/minsky | this Minsky (fyodoriv/minsky) |
|---|---|---|
| **Primary operator** | Human-in-the-loop. A developer drives sessions; AI agents work *under the same gates* as a symmetry property, not as the autonomous driver. | Autonomous. The daemon picks tasks from `TASKS.md` and runs overnight with no per-task human invocation. |
| **Cybernetics framing** | *Explicit* — VSM Systems 1–5 are named subsystems in `docs/theory-of-operation.md`; the architecture IS the cybernetic model. | *Implicit substrate* — VSM is a lineage anchor (rule #5), recursion is applied to the fleet, but the daemon is not organised as five named organs. |
| **Alignment mechanism** | Environmental pre-delegation: humans and agents share *identical* CLI/MCP surfaces; the environment constrains both symmetrically. | Constitutional CI gates: 17 iron rules each enforced by a deterministic lint; the agent runs as the *operator's identity* (no symmetric human-agent surface). |
| **Self-improvement** | Not a closed loop — knowledge-base freshness feedback (fresh/aging/stale) informs retrieval, but the system does not file work against its own weak spots. | MAPE-K substrate ships (experiment-store + observer + spec monitor + self-task-filing); closed-loop prompt A/B is spec-only (user-story-003). |
| **Scope** | One repo, principal-substrate coordination within an organization. | Cross-repo fleet on the operator's machine (round-robin over N hosts). |

The crisp summary: **edobry/minsky makes the human and the agent symmetric under one environment; this Minsky removes the human from the per-task loop entirely and makes the daemon self-healing.** Same ancestor (Beer's VSM), opposite ends of the autonomy axis.

## Disposition: cross-citation, not competition

Because the two projects sit at opposite ends of the autonomy axis with the same name and the same lineage, an operator who finds one is well-served by being pointed at the other:

- Someone wanting **HITL coordination with environmental guardrails** wants edobry/minsky.
- Someone wanting **an autonomous overnight daemon against `TASKS.md`** wants this Minsky.

Mutual citation increases discoverability for both without competitive cannibalisation (the audiences barely overlap), and it pre-empts accidental "territorial" confusion over the shared name. The disambiguation table in [`docs/prior-art-and-name-collisions.md`](../docs/prior-art-and-name-collisions.md#not-to-be-confused-with) carries the deep-links into edobry/minsky's specific architecture sections.

## Why this is NOT in the benchmark corpus

edobry/minsky is absent from `novel/competitive-benchmark/src/competitors.ts` (the M1.10 scorecard) on purpose: the scorecard ranks *product competitors* on shared metrics (HumanEval pass-rate, iteration cost, etc.), and edobry/minsky is not a head-to-head product on those axes — it is an architectural sibling with a different operator and no published benchmark number. Adding it to the corpus would force an apples-to-oranges metric comparison. The honest disposition is a deep-dive (this file) plus a disambiguation-table row, not a scorecard entry.

## The external half (cross-citation outreach) — blocked

The task's full success criterion also includes contacting edobry/minsky via a GitHub issue offering mutual citation, and (if accepted) both READMEs linking each other. That half is **not** shippable from an autonomous worktree:

- Opening a GitHub issue under the operator's identity is a public write governed by the Public Impersonation Ban — it requires explicit per-session operator approval.
- A maintainer acknowledgment is an external human response that cannot be produced in-session.

This file + the disambiguation deep-links deliver the *measurable, in-repo* half (operator discovery for both projects is improved unilaterally). The outreach half is the operator's to send. Per the task's own Pivot guidance, the documentation-only outcome is the correct disposition when the collaboration half can't be completed in-session.

## Last reviewed

2026-06-02 — primary-source deep-dive of edobry/minsky's `docs/architecture.md` (§ "Session Model", § "Knowledge Base") and `docs/theory-of-operation.md` (§ "The Five-Organ Architecture (VSM Mapping)", § "Environmental Pre-delegation"). Repo active (~6★, ~12,400 commits, recently maintained) — Pivot's "dormant >90 days" condition does not fire, so the full deep-dive (not a one-line mention) is justified.
