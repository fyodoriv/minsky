# `claude-handoff-spec` — handoff record format

A small, version-controlled markdown format for one specialist agent ("persona") handing work to the next. Modelled after [tasks.md](https://github.com/tasksmd/tasks.md) (single-file convention; bold metadata fields with continuation lines) and AGENTS.md.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 9 (planned):

- **Pattern**: actor message-passing with continuation — Hewitt, Bishop, Steiger, "A Universal Modular ACTOR Formalism for Artificial Intelligence", *IJCAI* 1973. **Conformance: full.**
- The handoff record is the *message*; `**Suggested next**` is the *continuation* (the next actor that should receive the message).

## File layout

A handoff file is a markdown document with one top-level heading (`# Handoff: <subject>`) and bold-labelled fields. Multiple handoffs per file are permitted, separated by `---`.

```markdown
# Handoff: <one-line subject>

- **From**: <persona-id>
- **To**: <persona-id>           ← exact addressee, OR omitted if Suggested-next is used
- **Status**: ok | blocked | needs-rework
- **Summary**: <one paragraph>
- **Artifacts**:
  - <path-or-url>
  - <path-or-url>
- **Blockers**: <optional; required when Status=blocked>
  - <one bullet per blocker>
- **Suggested next**: <optional; used when To is unset or in addition to To>
  - <persona-id>
  - <persona-id>
- **Pushback**: <optional; agent disagrees with the prior step>
  - <one bullet per disagreement, terse>
- **Created-at**: <ISO-8601 UTC, e.g. 2026-05-03T18:00:00Z>
```

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| `From` | yes | Persona ID (kebab-case). |
| `To` | optional | Exact addressee. Mutually inclusive with `Suggested next`: at least one of the two must be present. |
| `Status` | yes | One of `ok`, `blocked`, `needs-rework`. Lowercase. |
| `Summary` | yes | One paragraph describing what was done and what's needed. |
| `Artifacts` | optional | Bullet list of file paths or URLs the next persona will read. |
| `Blockers` | required iff `Status: blocked` | Bullet list. Each blocker actionable. |
| `Suggested next` | optional | Bullet list of persona IDs. Required if `To` is omitted. |
| `Pushback` | optional | Used when disagreeing with the prior step's framing. Bullets. |
| `Created-at` | yes | ISO-8601 UTC. The parser is permissive about timezone but normalises to UTC on parse. |

### Status semantics

| Status | Meaning | Required next-step from receiver |
| --- | --- | --- |
| `ok` | Work complete; ball is in the receiver's court | Pick up and proceed |
| `blocked` | Work paused; cannot proceed without external action | Resolve a `Blockers` item or escalate |
| `needs-rework` | Receiver should revise prior work | Address `Pushback` items, then re-issue handoff |

## Validation rules

The validator enforces:

1. The document parses as the format above (one top-level heading per handoff; bold-labelled fields).
2. Required fields are present (`From`, `Status`, `Summary`, `Created-at`, plus `To`-or-`Suggested next`).
3. `Status` is one of the three allowed values, lowercase.
4. If `Status: blocked`, `Blockers` is non-empty.
5. Persona IDs (in `From`, `To`, `Suggested next`) are kebab-case.
6. `Created-at` parses as a valid ISO-8601 timestamp.

## Versioning

This spec is **v0**. Breaking changes are allowed pre-1.0. Any change updates the version in `package.json` and adds a row to a `CHANGELOG.md` (forthcoming).
