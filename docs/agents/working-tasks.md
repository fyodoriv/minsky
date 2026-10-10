# Working a task — hygiene, tool calls, modes, personas, and UI priority

This file exists to hold the full task-working rules that `AGENTS.md` summarizes: task hygiene, tool-call discipline for non-Claude models, OMC mode choice, persona gating, and why all user interface work is P0-P1.

## Task hygiene

Do not set `**Blocked**: … DELIVERED; block retained` on a task that is already delivered; delete the block entirely. The `no-delivered-retained-blocks` CI gate (`scripts/check-no-delivered-retained-blocks.mjs`) rejects any `**Blocked**:` field containing that pattern — stale retained blocks permanently skip the task picker and must be swept by `sweep-stale-delivered-task-blocks` or removed manually.

## Tool-call discipline (load-bearing for non-Claude models)

**EVERY reply you emit must include a tool call** — `terminal`, `file_editor`, `task_tracker`, or `finish`. The OpenHands SDK (and similar agent frameworks) treat a reply containing only prose with no tool call as the conversation-end signal and TERMINATE the conversation immediately, regardless of whether the work has shipped.

Observed failure mode (2026-05-27, `ollama_chat/qwen3-coder:30b`): 13/13 consecutive iterations emitted a final message like `Let me examine the main supervisor script` AS PROSE WITH NO ATTACHED TOOL CALL. Each conversation ended right there, producing zero commits / zero PRs / zero pushes. Detection now lives in `daemon-no-progress-rate` invariant (`scripts/self-diagnose.mjs`) which fires within 3 such iterations.

**Forbidden patterns**: emitting `Let me examine X` / `Now I'll do Y` / `Let me check Z` as prose without the attached tool call. Use the `think` tool if you need to deliberate without doing.

**Correct pattern**: every planning sentence is followed (in the SAME reply) by the tool call that executes the plan. Call `finish` ONLY when (a) the PR is open and the URL is printed, OR (b) you've hit an irrecoverable blocker that you've reported verbatim.

This rule is baked into the brief that `scripts/build_brief.py` ships to every agent spawn — `tests/test_build_brief.py::test_overlay_includes_tool_call_discipline_block` pins it so a future refactor can't quietly drop it.

## Choosing an OMC mode for a task

When you invoke OMC commands inside a task, choose the mode based on the task's `**Tags**`:

| Mode | When to use | Trigger |
|------|-------------|---------|
| `/autopilot` | Default. Single coherent feature, sequential pipeline | Tag: any |
| `/team N:role` | Coordinated specialists with shared task list | Tag: `multi-domain`, `coordination` |
| `/ultrawork` (or `ulw`) | Maximum parallelism. Fullstack features, large refactors | Tag: `parallel`, `refactor` |
| `/ralph` | Hairy bugs, high-stakes; won't quit until architect-verified | Tag: `relentless`, `verify-required` |

When in doubt, just describe the work — OMC auto-selects.

## Investor / growth-hacker personas

These OMC personas (`product-manager`, `product-analyst`, `analyst`) only run when the task's `**Tags**` includes one of: `business`, `growth`, `revenue`, `customer`, `pricing`. Otherwise skip them — saves tokens and prevents drift into unrelated commentary.

## All user interface is P0-P1 (by definition)

Operator directive 2026-05-27: every user-facing CLI surface — `bin/minsky` subcommands, `pnpm minsky:*` scripts, `bin/minsky <verb> --help` text, error messages the operator sees, dashboard widgets, the `init` flow, the `doctor` output — **defaults to P0 or P1 priority, never P2-P3**. UX friction compounds: a flag the operator has to remember on every debugging session is a 5-second tax × N sessions × M operators = real wasted hours.

When filing a UI task in `TASKS.md`:

- **P0** — user-facing default is wrong / surprising / forces a workaround (e.g. `pnpm minsky:logs` defaulting to tick-loop-only when the operator wants every source — see PR #907)
- **P1** — user-facing surface works correctly but is inconsistent across entry points (e.g. `pnpm minsky:status` ≠ `bin/minsky status`) or lacks `--help`
- **P2** — only acceptable for explicitly-deferred UX work with a written reason (e.g. a redesign blocked on upstream dependency)
- **P3** — never. If something is "minor UX polish", it's still P1.

Two concrete sub-rules implied by this:

1. **One canonical command per operation.** Two CLI surfaces with the same name (`pnpm minsky:X` + `bin/minsky X`) MUST behave identically — one delegates to the other. Drift is a P0 bug. The 2026-05-27 lint (`scripts/check-pnpm-minsky-aliases.mjs`, when it lands) makes this deterministic.
2. **Sane defaults.** No-args invocation should do the right thing for the 90% case. Flags are for the 10% drill-down. If the operator has to remember a flag for the common case, the default is wrong.

This rule applies retroactively: when scanning `TASKS.md`, if you find a UI task at P2 or P3, surface the misclassification and propose promotion to P1.
