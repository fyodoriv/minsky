---
name: task-spec
description: Generate a structured spec document for a TASKS.md task using spec-kit's Given-When-Then acceptance scenario format. Produces `.minsky/specs/<task-id>.md` enriched with prioritized user stories, acceptance scenarios, FR/SC sections, edge cases, and a NEEDS-CLARIFICATION inventory. Run BEFORE /spec-driven-development when the task description is thin, ambiguous, or lacks acceptance criteria. Bridges spec-kit's /speckit.specify idiom to Minsky's pre-registration discipline.
allowed-tools: Read, Bash, Write
---

# Task-spec

Lift a raw TASKS.md task description into a structured specification using spec-kit's acceptance-scenario grammar (Given/When/Then, prioritized user stories, measurable success criteria). The output is a `.minsky/specs/<task-id>.md` file that feeds directly into `/spec-driven-development`, `/grill-task`, and `/task-slice`.

Adapted from github/spec-kit's `/speckit.specify` command and `spec-template.md`.

## Args

Takes one required argument: the task ID from TASKS.md.

```
/task-spec daemon-pre-pr-lint-gate
```

## When to use

**Use task-spec when:**
- Task block has fewer than 3 concrete acceptance criteria
- Acceptance criteria are vague ("improve X", "fix Y") — not testable
- Task spans a user-facing behaviour change (new observable output, changed CLI flag, new notification)
- `/grill-task` surfaces ≥4 unresolved branch decisions — the task description itself is under-specified

**Skip task-spec for:**
- Tasks that already have a `user-stories/*.md` file with Given/When/Then rows
- XS/S refactors with no observable behaviour change (formatting, rename, dead-code removal)
- Tasks flagged `doc-only` in `**Tags**`

## Phase 1 — Read before writing

1. Read the full task block from `TASKS.md` (ID, Tags, Hypothesis, Measurement, Verification, Files, Touches, Estimate).
2. Read the relevant `user-stories/*.md` file(s) referenced by the task, if any.
3. Read `vision.md` §§ 3, 9 for constitutional acceptance-criteria constraints.
4. Check `experiments/<task-id>.yaml` — if it exists, the spec must honour its hypothesis, success threshold, and measurement command verbatim.
5. Check `ARCHITECTURE.md` for the adapter interface the task touches.

Do not write any code or spec yet. The output of this phase is an internal understanding.

## Phase 2 — User story decomposition

Decompose the task into 1–3 independently testable user stories, ordered by importance (P1 is the MVP).

Each story must pass the **independent testability gate**: if you implement just this one story, does the system deliver observable value? If no, split differently.

For each story, derive:
- **Title** — 2–5 words
- **Narrative** — one sentence in "As a <actor>, I <action> so that <outcome>" form
- **Independent Test** — one concrete action + observable outcome that proves the story works in isolation
- **Priority** — P1 (MVP), P2, P3

## Phase 3 — Acceptance scenarios

For each user story, write 2–4 Given/When/Then scenarios. Rules:
- **Given** describes observable system state — no implementation details, no file paths
- **When** is a single triggering action
- **Then** is a measurable, observable outcome — no "should maybe", no vague adjectives
- Negative path (error/rejection) requires its own scenario
- The Then clause must align with the `**Measurement**` command in the task block or the `experiments/<task-id>.yaml` measurement

Format:
```
1. **Given** [observable initial state], **When** [action], **Then** [observable outcome]
2. **Given** [error condition], **When** [same action], **Then** [error output + state unchanged]
```

## Phase 4 — Requirements and NEEDS-CLARIFICATION inventory

Extract Functional Requirements (FR-NNN) from the task block and scenarios. Mark any item that the task block does not answer with `[NEEDS CLARIFICATION: <exact question>]`. Do not guess — surface the gap so `/grill-task` can resolve it.

For each FR, check:
- Is it testable as-written?
- Does it reference a constitutional rule (e.g., FR-003 aligns with rule #3)?
- Does it conflict with any `vision.md` constraint?

## Phase 5 — Success criteria (SC)

Derive 2–4 measurable success criteria. Each must be:
- Numeric or binary (not "users find it easier")
- Traceable to the task's `**Measurement**` command or a `user-stories/*.md` metric
- Technology-agnostic — describe outcomes, not implementation

Align SC-001 with the pre-registered hypothesis success threshold verbatim.

## Output format

Write `.minsky/specs/<task-id>.md` with this structure:

```markdown
# Spec: <task-id>

**Task**: `<task-id>`
**Created**: <ISO date>
**Status**: Draft
**Input**: <task hypothesis quoted verbatim from TASKS.md>

## User Stories

### Story 1 — <Title> (Priority: P1)

As a <actor>, I <action> so that <outcome>.

**Why P1**: <one sentence — this is the MVP slice>

**Independent Test**: <action + observable outcome>

**Acceptance Scenarios**:

1. **Given** <state>, **When** <action>, **Then** <outcome>
2. **Given** <error state>, **When** <action>, **Then** <error outcome>

---

### Story 2 — <Title> (Priority: P2)

[same structure]

---

## Edge Cases

- What happens when <boundary condition relevant to this task>?
- How does the system handle <task-specific error scenario>?

## Functional Requirements

- **FR-001**: System MUST <capability>
- **FR-002**: System MUST <capability>
- **FR-003**: [NEEDS CLARIFICATION: <question>]

## Success Criteria

- **SC-001**: <numeric outcome aligned with hypothesis success threshold>
- **SC-002**: <measurable outcome>

## Assumptions

- <Assumption 1 — explicit scope boundary>
- <Assumption 2 — dependency or reuse of existing component>

## NEEDS CLARIFICATION (blocking)

Items that block implementation and must be resolved via `/grill-task` before `/task-slice`:

- [ ] <question 1> — blocks FR-NNN
- [ ] <question 2> — blocks Story N acceptance scenario N
```

## After writing

1. Print the spec path.
2. Print the NEEDS CLARIFICATION list so the operator can see unblocked vs blocked items.
3. Recommend the next skill:
   - If NEEDS CLARIFICATION list is non-empty → `/grill-task <task-id>`
   - If list is empty → `/spec-driven-development <task-id>` (architectural spec)
   - Then → `/task-slice <task-id>`

## Relationship to other skills

```
/task-spec        ← this skill: WHAT the system should do (user stories + GWT)
      ↓
/spec-driven-development  ← HOW the system will do it (architecture + interfaces)
      ↓
/grill-task       ← resolve NEEDS CLARIFICATION items
      ↓
/task-slice       ← decompose into vertical slices with [P] markers
```

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Writing Then clauses with file paths | File paths are implementation details; they belong in /spec-driven-development's architecture boundaries section |
| Marking every item NEEDS CLARIFICATION | Read TASKS.md and user-stories/ first; most questions are already answered there |
| Merging two different user stories into one | Each story must be independently testable; if "and" appears in the Independent Test description, split the story |
| SC that duplicates the hypothesis verbatim without a measurement command | A success criterion without a runnable measurement is a wish — rule #9 requires the command |
| Skipping the negative-path scenario | Every Given/When/Then set must include at least one error/rejection scenario |
