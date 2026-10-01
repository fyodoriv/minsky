---
name: cli-consolidation
description: Apply rule #16 "default by default" specifically to CLI surface design — fold new functionality into existing commands as flags or defaults rather than creating new subcommands. Use this skill any time the agent considers `minsky <new-subcommand>` or any new CLI verb in any repo Minsky governs.
triggers:
  - user
  - model
---

# CLI consolidation — keep the surface small

When you're about to add a new capability to a CLI, **the default answer is "fold into an existing command,"** not "create a new subcommand." This skill operationalizes constitutional rule #16 (Default by default) for CLI surface design.

## The discipline

Before writing `case "newcommand)" in any CLI entrypoint, answer all three:

1. **Is there an existing command this is a refinement of?** If yes — add a flag.
2. **Should this happen automatically when the user runs the parent command?** If yes — make it the default behavior of that parent.
3. **Does it have semantics fundamentally different from every existing command?** Only then is a new subcommand justified.

If you can't pass the third test, you must fold.

## Examples (good vs. bad)

**Bad (fragmentation)**:
- `minsky iter-once <host>` as a new subcommand. The user has to remember it.
- `minsky bash-doctor` separate from `minsky doctor`. Two doctors.
- `minsky tail-failures` separate from `minsky logs`. Two log-tailers.
- `minsky try` that composes `bash-doctor` + `iter-once`. A third surface.

**Good (consolidation)**:
- `minsky --once <host>` — flag on the default invocation.
- `minsky doctor` auto-detects whether the bash or TS skeleton is in use; one doctor.
- `minsky logs --failures` — same `logs` command, different lens.
- `minsky` with no args = doctor → attach OR run with defaults. No composition command needed.

## Minsky's specific shape

`minsky` invoked with no subcommand MUST:

1. Run `minsky doctor` first (pre-flight health checks).
2. If any critical check fails → print + exit non-zero.
3. If a daemon is already running for $PWD → attach (`watch`).
4. Otherwise → start the daemon with sensible defaults + attach.

This is the operator's "I cd into a folder, type `minsky`, it just works" experience. The smartest defaults go HERE, not behind subcommands.

## The fold heuristic

When tempted to type `case "newverb)" in `bin/minsky`, ask:
- Can this be a `--flag` on `minsky` (no args)?
- Can this be a `--flag` on `status`, `logs`, `doctor`, `watch`, `report`, `daemon`?
- Can this be merged into one of those as new DEFAULT output (without breaking existing behavior)?

If any answer is yes — fold there. Only when all three are no does a new verb earn a slot.

## Backwards compatibility

When folding an EXISTING subcommand into another, keep the old verb as a thin deprecated alias that:

1. Prints a one-line deprecation note to stderr: "minsky `oldverb` is deprecated; use `minsky newverb --oldverb-flag`".
2. Dispatches to the consolidated command.
3. Carries a `<!-- @deprecated 2026-XX-XX -->` comment with the deprecation date.

Aliases are removed in the next major version (`MAJOR.0.0`).

## When this skill triggers

Activate before ANY of the following:

- Writing `case "newverb)" in `bin/minsky` (or any CLI).
- Drafting a `--help` line that adds a new top-level verb.
- Reviewing a PR that ships a new subcommand.
- Authoring a TASKS.md task that proposes a new CLI verb.

The check is binary: did the implementer pass the three-question test in writing somewhere reviewable (PR body, task block, ADR)? If no — block the change and ask them to fold.

## Source

- Operator directive 2026-05-25: "instead of making new commands eg iter-once why not make this as argument to original command? Keep interface simple with no need to remember things for users. Usual minsky must have all bells and whistles of other modes. Update skills/rules first, then update commands."
- vision.md rule #16 (Default by default).
- Global `cli-design` skill (`~/.config/devin/skills/cli-design/SKILL.md`) — "Combine redundant commands", "Run more by default".
- npm / brew / uv convention: small CLI surface; flags + defaults > new verbs.
