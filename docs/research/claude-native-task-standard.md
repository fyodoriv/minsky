---
authored: 2026-05-23
status: decision-ready
decision: reject-adopt + reject-bridge-now + file-monthly-watch
follow-ups:
  - watch-claude-native-task-standard-monthly (file as P3 standing-loop)
  - revisit-after-issue-33764-resolved (file as P2 conditional)
related:
  - native-agent-teams-with-tiered-adapter (this doc decides its bridge-slice fate)
  - investigate-claude-native-task-standard (this doc IS the deliverable)
rules:
  - vision.md rule #1 — replace-or-relocate (the bar this fails)
  - vision.md rule #14 — delegate / adopt-native / shrink (the bar this fails)
  - vision.md rule #9 — pre-registered HDD (the rule blocked by adoption)
  - vision.md rule #6 — let-it-crash (the rule blocked by experimental dependency)
---

# Claude Code Native Task Standard — Adopt, Bridge, or Reject?

**Pre-registered recommendation (locked before sourcing all data — rule #9 discipline):**

> The native standard will NOT survive a rigorous owned-surface-delta analysis
> because (a) Minsky depends on persistence across session restarts and
> Anthropic's native standard explicitly does not provide that for the
> multi-agent variant, and (b) the native task schema covers <40% of Minsky's
> TASKS.md feature set, so adoption forces equivalent validators stuffed into
> opaque `metadata` — same surface area, worse contract.
>
> Predicted outcome: **Reject adoption. Reject bridge-now. File monthly-watch
> task** to re-evaluate when Agent Teams exits experimental status AND the
> session-persistence GitHub issue (#33764) is resolved.

The body of this document tests that prediction against verified evidence.

## 0. Why this investigation exists

Operator directive 2026-05-17: *"claude has a standard for tasks — investigate
it"*. The directive triggers vision.md **rule #14** (delegate / adopt-native /
shrink to fit). If Claude Code now ships a stable native task standard that
overlaps Minsky's hand-rolled TASKS.md tooling, Minsky should delete whatever
overlaps and adopt the native primitive — because rule #14 is iron and "do not
reinvent a primitive the platform now ships" is its first commandment.

This doc is the rigorous answer. It is NOT an adoption PR — it scopes the
adoption / bridge / reject decision with three quantified options. Whichever
the recommendation lands on, the **follow-up tasks** filed in §6 are the
production wiring.

## 1. What Claude Code's native task standard actually is

Claude Code ships **two** task-tracking subsystems. They share a file format
and a directory layout, but they have different stability levels and different
multi-agent semantics:

### 1.1 The Agent-Teams shared task list (EXPERIMENTAL)

| Property | Value | Source |
|---|---|---|
| Status | Experimental, disabled by default | [agent-teams docs][agent-teams] |
| Enable | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env / settings.json | [agent-teams#enable-agent-teams][agent-teams-enable] |
| Min version | Claude Code v2.1.32 | [agent-teams docs][agent-teams] |
| Multi-agent | Yes — file-locked claim semantics | [agent-teams#assign-and-claim-tasks][agent-teams-claim] |
| Persistence | **Wiped on session restart** | [GH issue #33764][gh-33764] |
| Storage | `~/.claude/teams/{team}/config.json` + `~/.claude/tasks/{team}/*.json` | [agent-teams#architecture][agent-teams-arch] |

Each task is a separate JSON file inside the team directory. A `.lock` file
guards the entire directory and a `.highwatermark` counter generates new task
IDs.

```text
~/.claude/tasks/{team-name}/
├── .lock                # flock() target — 0-byte file
├── .highwatermark       # numeric counter
├── 1.json               # one file per task
├── 2.json
└── ...
```

Anthropic warns operators not to edit the team config directly: *"Claude Code
generates both of these automatically when you create a team and updates them
as teammates join, go idle, or leave. The team config holds runtime state
such as session IDs and tmux pane IDs, so don't edit it by hand or
pre-author it: your changes are overwritten on the next state update."*
([source][agent-teams-arch])

### 1.2 The Interactive-mode task list (STABLE, default since v2.1.142)

| Property | Value | Source |
|---|---|---|
| Status | Stable; replaces deprecated `TodoWrite` | [todo-tracking docs][todo-tracking] |
| Multi-agent | **No** — single-session only | (no shared-list documentation) |
| Persistence | Yes, via `CLAUDE_CODE_TASK_LIST_ID` env var | [interactive-mode#task-list][interactive-mode] |
| Storage | `~/.claude/tasks/{task-list-id}/*.json` (same format as 1.1) | [interactive-mode][interactive-mode] |
| Tools | `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList` | [agent-sdk/typescript][agent-sdk-ts] |
| Hooks | `TaskCreated` / `TaskCompleted` (Agent-Teams-shared) | [hooks docs][hooks] |

Same per-task JSON file format as Agent Teams, but **no built-in multi-agent
coordination**. Two `claude` sessions pointed at the same `task-list-id`
would race on the `.lock` file, but Anthropic does not document this as a
supported use case.

### 1.3 The on-disk task schema (verified)

Every task in either subsystem is a JSON object with these fields, per the
[TypeScript SDK definition][task-update-ts] and the [Python SDK definition][task-list-py]:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Numeric, auto-incremented from `.highwatermark` |
| `subject` | string | yes | Imperative title — "Run tests" |
| `description` | string | no | Detailed body, plain text |
| `activeForm` | string | no | Present-continuous — "Running tests" |
| `status` | enum | yes | `pending` / `in_progress` / `completed` / `deleted` |
| `owner` | string \| null | no | Agent name, e.g. `engineer@team-name` |
| `blocks` | string[] | no | Task IDs this task blocks |
| `blockedBy` | string[] | no | Task IDs that block this task |
| `metadata` | `Record<string, unknown>` | no | Opaque key-value passthrough |
| `created_at` | ISO 8601 string | no | Set by `TaskCreate` |
| `updated_at` | ISO 8601 string | no | Set by `TaskUpdate` |

That's the complete contract. Anthropic explicitly types `metadata` as
`Record<string, unknown>` — i.e. **the native standard does not validate it**.

### 1.4 The native hooks (rule #10 surface)

Three hooks fire around task lifecycle. Each can block its trigger by exiting
with code 2 ([hooks docs][hooks]):

| Hook | Trigger | Blocks |
|---|---|---|
| `TaskCreated` | When `TaskCreate` is called | Refuses task creation |
| `TaskCompleted` | When `TaskUpdate` sets `status=completed` | Refuses completion |
| `TeammateIdle` | When a teammate is about to idle | Keeps teammate working |

The blocking semantics are the same as Minsky's existing pre-pr-lint gate
(exit 2 → reject + return stderr as feedback), so adopting these as the
quality-gate surface is mechanically straightforward.

### 1.5 Known limitations (the blockers)

Documented by Anthropic and the community:

1. **State wiped on session restart** — [GitHub issue #33764][gh-33764] —
   Agent Teams directories at `~/.claude/teams/` and `~/.claude/tasks/` are
   emptied on the next session startup. **This is the load-bearing blocker.**
2. **No teammate session resume** — [GitHub issue #26265][gh-26265] — `resume`
   only works for subagents, not Agent Teams teammates.
3. **Cross-session messaging breaks** — [GitHub issue #54463][gh-54463] —
   restarted lead sessions never receive teammate messages.
4. **`--resume` crashes with JSON parse error** — [GitHub issue #38379][gh-38379] —
   sessions with Agent Teams artifacts cannot be resumed at all.
5. **`CLAUDE_CODE_TASK_LIST_ID` unavailable in `-p` mode** — [GitHub issue #20424][gh-20424] —
   non-interactive mode (which is exactly how Minsky spawns Claude) cannot use
   the shared-task-list mechanism.
6. **Task status lags** — Anthropic documents that teammates sometimes fail
   to mark tasks completed, blocking dependents until a human nudge.
7. **One team per lead, no nested teams, lead is fixed** — Architectural
   constraints that mean Minsky's cross-repo runner (which spawns workers per
   host) cannot map cleanly to the team-lead model.

Limitation #1 (session-restart wipe) and #5 (`-p` mode unavailable) are each
independent showstoppers for the Minsky use case.

## 2. Minsky's TASKS.md surface — the alternative being compared

The [tasks.md spec][tasks-md-spec] (incumbent standard Minsky already follows)
defines:

- Priority sections `## P0`, `## P1`, `## P2`, `## P3`
- Checkbox tasks `- [ ] description (@claim-id)`
- Indented bold-labeled metadata: `**ID**:`, `**Tags**:`, `**Details**:`,
  `**Files**:`, `**Acceptance**:`, `**Blocked**:`, `**Blocked by**:`
- Completed tasks are deleted, not checked off (history lives in git log)
- A linter: `npx @tasks-md/lint`

Minsky-on-top adds, per the operator's 2026-04-18 rule-#9 amendment:

- `**Hypothesis**` / `**Success**` / `**Pivot**` / `**Measurement**` / `**Anchor**`
  (pre-registered HDD fields)
- `**Competitive-goal**` (which scorecard metric the task moves)
- `**Milestone**` (M1 / M2 / M3 / M4 / M5)
- `<!-- policy: ... -->` HTML-comment policies (file- and section-scoped)
- `<!-- pattern: ... -->` annotations (rule #8 pattern conformance)

### 2.1 Owned-surface inventory (LOC measured 2026-05-23)

| Subsystem | LOC | Files |
|---|---|---|
| `parseTasksMd()` + `pickHostTask()` (core parser/picker) | 426 + 529 (test) | `novel/cross-repo-runner/src/task-finder.ts` + test |
| `omc-tasksmd` bridge (Minsky → OMC sync) | 763 | `novel/bridges/omc-tasksmd/src/*.ts` |
| Rule-9 / HDD lint scripts | 1526 | `check-rule-9-tasksmd-fields.mjs` + `check-competitive-goal.mjs` + `check-anchor-primary-source.mjs` + `check-measurement-inspects-output.mjs` + `check-cadence-pivot-threshold.mjs` (+ tests) |
| Auto-file scripts (corpus refresh writes new TASKS.md entries) | 387 | `auto-file-corpus-refresh-tasks.mjs` + test |
| `host-loop.ts` TASKS.md awareness | ~150 (estimated subset of 610) | `novel/cross-repo-runner/src/host-loop.ts` |
| Other lint scripts that READ TASKS.md as input | ~600 (estimated subset of ~3000 in 33 files) | `scripts/check-*.mjs` |
| **Total Minsky-owned, TASKS.md-aware code** | **~3,800 LOC** | |

Plus 3,467 lines of actual TASKS.md content (data, not code).

The 33 other `check-*.mjs` scripts touch TASKS.md as a side channel (e.g.
`check-vision-rule-13-task-id-citations.mjs` reads task IDs to validate
vision.md back-references). These would survive any of the three options
because they don't depend on the markdown format — they depend on the
**existence of an ID surface**, which all three options preserve.

## 3. Field-by-field comparison

| Minsky TASKS.md feature | Maps to native? | Detail |
|---|---|---|
| Checkbox-row title | Yes | `subject` field |
| `**Details**` (multi-paragraph body) | Yes | `description` field — but plain text, no markdown rendering by tools |
| Priority sections (`## P0` … `## P3`) | **No** | Native flat list; would have to stuff `metadata.priority: "P0"` and write a Minsky-side picker on top |
| `**ID**` (kebab-case stable) | Partial | Native `id` is auto-incremented numeric. Minsky uses kebab-case strings tied to branch / PR names; metadata sidecar required |
| `(@agent-id)` claim | Yes | `owner` field + native flock — actually BETTER than Minsky's text-only claim |
| `**Tags**` comma-separated | No | Goes into opaque `metadata` |
| `**Blocked by**` task-id | Yes | Native `blockedBy` array, identical semantics |
| `**Blocked**` reason (needs-user-approval, needs-credentials, etc.) | **No** | Native has no concept of soft blocks; would stuff into `metadata`, lose lint validation |
| `**Hypothesis** / **Success** / **Pivot** / **Measurement** / **Anchor**` (rule-#9) | No | Goes into opaque `metadata`. **Native standard does not validate `metadata`.** Five iron-rule fields demote to "convention" |
| `**Competitive-goal**` | No | Same as above — metadata-stuffed |
| `**Milestone**` | No | Same |
| `**Files**` / `**Acceptance**` | No | Same |
| Completed tasks deleted (history in git) | **No** | Native `status: "deleted"` is a soft-delete; the JSON file stays on disk |
| `<!-- policy: ... -->` HTML comments | **No** | No file-level metadata in native standard at all |
| `<!-- pattern: ... -->` annotations | **No** | Same |
| Single-file diff (git-friendly) | **No** | One JSON file per task. 200 tasks = 200 commits' worth of file moves on every status flip |
| `npx @tasks-md/lint` validation | **No** | Native has no schema validator for `metadata` |
| Reviewer-readable in PR | **No** | JSON in `~/.claude/tasks/` is outside the repo entirely |

### 3.1 Summary

Of 16 Minsky TASKS.md features, the native standard covers 4 cleanly (subject,
description, owner+lock, blockedBy), 1 partially (id), and **11 not at all**.

The 11 uncovered features are not optional — they are the load-bearing
features of Minsky's iron rules:

- Rule #9 (HDD pre-registration) — depends on Hypothesis/Success/Pivot/Measurement/Anchor lint
- Rule #10 (deterministic enforcement) — depends on @tasks-md/lint + rule-9 lint
- Rule #12 (scope discipline) — depends on Competitive-goal lint
- Rule #16 (default by default) — depends on Milestone + file-level policy comments

**Adopting the native standard demotes 4 iron rules to "convention".** That's
not a scope shrink — that's a regression in determinism.

## 4. Three options, costed

### Option A — Adopt (native is source of truth)

**Shape:** Minsky deletes `TASKS.md`. Tasks live in `~/.claude/tasks/{repo}/`.
Minsky's parser/picker becomes a thin wrapper around `TaskList` / `TaskGet`.
HDD fields and priority sections live in `metadata`.

**Owned-surface delta calculation:**

| Subsystem | Today LOC | After-adopt LOC | Delta |
|---|---|---|---|
| `parseTasksMd()` + tests | 955 | 0 (deleted — read JSON via SDK) | **−955** |
| `omc-tasksmd` bridge | 763 | 763 (still needed — OMC doesn't change) | 0 |
| Rule-9 lint scripts | 1526 | 1526 (still needed — must now lint `metadata.hypothesis` etc.) | 0 |
| Auto-file scripts | 387 | 387 (re-targeted to JSON) | 0 |
| **New** native-task-SDK adapter | 0 | ~400 (read/write per-task JSON via `TaskCreate`/`TaskUpdate`/`TaskGet`) | **+400** |
| **New** priority-on-metadata picker | 0 | ~200 (Minsky's P0/P1/P2/P3 logic on top of flat native list) | **+200** |
| **New** HDD-on-metadata validator | 0 | ~200 (the lint already exists; the metadata-coercion glue is new) | **+200** |
| **New** sync-back-to-repo (for PR review + git-friendly diff) | 0 | ~300 (export native JSON back to a markdown snapshot per commit) | **+300** |
| **Net delta** | | | **+145 LOC** |

**Persistence blocker:** Limitation #1 (state wiped on session restart) means
Minsky's 24/7 daemon would lose ALL task state every time a Claude session
crashes or restarts. **This is a hard blocker** — Minsky's daemon-mode is the
core product, not a side feature.

**Rule #6 (let-it-crash) violation:** Adopting an experimental, doc-flagged
"do not depend on this" standard for the iron rule-9 lint surface violates
rule #6's "depend only on contracts the upstream commits to support". The
docs explicitly say *"agent teams are experimental and disabled by default…
have known limitations around session resumption, task coordination, and
shutdown behavior."*

**Verdict:** ❌ **Reject.** Net surface delta is +145 LOC (not a scope shrink),
and the experimental-feature dependency violates rule #6 (let-it-crash).
Session-restart persistence wipe (#33764) is independently disqualifying.

### Option B — Bridge (TASKS.md authoritative, sync to native)

**Shape:** Minsky keeps `TASKS.md` as source of truth. A new
`novel/tick-loop/src/tasks-md-team-bridge.ts` module syncs the parsed
TASKS.md to `~/.claude/tasks/{team}/*.json` on every tick. Native hooks
(`TaskCompleted` → run pre-pr-lint, exit 2 if it fails) replace the existing
post-commit hook plumbing on the Claude-Code path. Devin / Aider /
non-Claude-Code workers still use the current `process-fan-out`.

**Owned-surface delta calculation:**

| Subsystem | Today LOC | After-bridge LOC | Delta |
|---|---|---|---|
| `parseTasksMd()` + tests | 955 | 955 (no change — still authoritative) | 0 |
| `omc-tasksmd` bridge | 763 | 763 | 0 |
| Rule-9 lint scripts | 1526 | 1526 | 0 |
| Auto-file scripts | 387 | 387 | 0 |
| **New** `tasks-md-team-bridge.ts` + tests | 0 | ~500 (sync logic + idempotence + conflict resolution) | **+500** |
| **New** capability detection (`detectAgentTeamsSupport`) | 0 | ~150 | **+150** |
| **New** TaskCreated/TaskCompleted hook wiring | 0 | ~100 (already filed in `native-agent-teams-with-tiered-adapter` slice (d)) | **+100** |
| `daemon-duplicate-work-detection` (currently P0 / open) | ~200 | 0 (native file-lock subsumes it on Claude-Code path) | **−200** |
| **Net delta** | | | **+550 LOC** |

**Persistence still a blocker:** Same as Option A — the native task store is
wiped on session restart. The bridge would need to detect the wipe and
re-sync from TASKS.md every Claude-Code session start, defeating the
file-lock-coordination benefit for any session that crosses a restart
boundary (which is every Minsky iteration that takes >Claude-session-length).

**Net win:** −200 LOC from `daemon-duplicate-work-detection` deletion, but
+750 LOC of new bridge code. **Net: +550 LOC.**

**Rule #6 violation softer:** The bridge keeps TASKS.md authoritative, so a
catastrophic Agent-Teams bug only loses the per-session cache, not the source
of truth. Less severe than Option A but still depends on an experimental
contract.

**Verdict:** ❌ **Reject for now.** The +550 LOC net is not a rule-#14
"shrink to fit" — it's an expansion. The only win (`daemon-duplicate-work-detection`
deletion) is conditional on the experimental feature stabilizing.

### Option C — Reject + Watch

**Shape:** No code change. Minsky's TASKS.md remains source of truth and the
only task surface. File a monthly-watch task to re-evaluate when (a) Anthropic
ships persistence across session restart (resolution of #33764), AND (b)
Agent Teams exits experimental status.

**Owned-surface delta:** **0 LOC.** No additions, no deletions.

**What we lose:** Nothing — `daemon-duplicate-work-detection` was already
P0 / open; this option doesn't make it worse. The file-locked claim is a
nice-to-have, not a must.

**What we gain:** Zero migration risk; zero experimental-feature dependency;
preserved iron rules #9 + #10; preserved git-friendly diff for PR review.

**Verdict:** ✅ **Accept.** This is the rule-14 + rule-6 + rule-9 + rule-12-conformant choice.

## 5. Recommendation (single go/no-go)

**Recommendation: Option C — Reject adopt + reject bridge-now + file monthly-watch task.**

Rationale:

1. **Persistence wipe (#33764) is a hard blocker.** Minsky's whole product is
   a 24/7 daemon. The native standard is, by current documentation, not
   suitable for daemon use.
2. **`-p` mode unavailability (#20424) means Minsky's spawn shape can't even
   USE `CLAUDE_CODE_TASK_LIST_ID`.** Minsky spawns Claude with
   `claude --print` (non-interactive). The shared-task-list mechanism explicitly
   doesn't work in that mode.
3. **Coverage is ~30%.** Adopting forces stuffing 11 iron-rule fields into
   opaque `metadata`, demoting rule #9 / #10 / #12 / #16 from "lint-enforced"
   to "convention".
4. **Owned-surface delta is positive** for both Adopt (+145 LOC) and Bridge
   (+550 LOC). Rule #14 demands a net-negative delta to justify adoption.
5. **Rule #6 (let-it-crash) prohibits depending on contracts the upstream
   explicitly does not commit to.** Anthropic's "experimental, may change" flag
   on Agent Teams + the known persistence bug = exactly the kind of
   undocumented contract rule #6 says don't depend on.

**Hypothesis (pre-registered at top of this doc) confirmed.** The
owned-surface analysis matched the prediction: native standard fails the
rule-#14 bar.

## 6. Follow-up tasks (the production wiring of this decision)

The doc is the deliverable, but the decision implies three follow-up tasks
that this PR also files:

### 6.1 Monthly-watch task (file as P3, standing-loop)

**File at:** `TASKS.md` § P3

```markdown
- [ ] `watch-claude-native-task-standard-monthly` — monthly re-evaluation of
      Claude Code's agent-teams + interactive-mode task standard against
      Minsky's TASKS.md owned-surface; re-run `investigate-claude-native-task-standard`
      analysis if any of the four trigger conditions fire
  - **ID**: watch-claude-native-task-standard-monthly
  - **Tags**: p3, watch, standing-loop, rule-14, agent-teams, observed-2026-05-23
  - **Trigger conditions** (any one fires a re-evaluation):
    (1) GitHub issue #33764 marked closed/resolved
    (2) `code.claude.com/docs/en/agent-teams` removes "experimental" flag
    (3) Anthropic announces stable contract for `~/.claude/tasks/`
    (4) `CLAUDE_CODE_TASK_LIST_ID` becomes available in `-p` mode (#20424)
  - **Cadence**: monthly (first iteration of each month)
  - **Output**: append a dated section to `docs/research/claude-native-task-standard.md`
    with current status; if a trigger fires, file the conditional revisit task
```

### 6.2 Conditional revisit task (file as P2, blocked)

**File at:** `TASKS.md` § P2

```markdown
- [ ] `revisit-claude-native-task-standard-when-persistence-fixed` — re-run
      the adopt/bridge/reject analysis if and when (a) GitHub #33764 is
      resolved AND (b) Agent Teams exits experimental status. Output: a
      dated section appended to docs/research/claude-native-task-standard.md
      with a new recommendation, or close as "still reject" with new
      evidence
  - **ID**: revisit-claude-native-task-standard-when-persistence-fixed
  - **Tags**: p2, conditional, agent-teams, rule-14, observed-2026-05-23
  - **Blocked**: needs-external-progress — GitHub issue #33764 is currently
    open (last activity 2026-04-XX per the issue page). This block resolves
    when the issue is marked closed AND Anthropic removes the
    "experimental" warning from `code.claude.com/docs/en/agent-teams`. The
    monthly-watch task above is responsible for detecting the unblock.
```

### 6.3 Update to `native-agent-teams-with-tiered-adapter`

The existing P0 task `native-agent-teams-with-tiered-adapter` (line 1152 of
TASKS.md) refers to bridge slice (c) as TASKS.md ⇄ native task list sync.
This document is its costed answer: that bridge slice is **deferred** until
the conditional task in §6.2 unblocks.

The P0 itself stays open — its slices (a) capability detection, (b) adapter
seam, (d) gate as native hooks, (e) selection policy do not depend on
adopting the native task standard. Only slice (c) is deferred.

The remaining P0 work targets `ClaudeAgentViewBackend` (the `claude --bg`
fan-out, NOT the agent-teams task list) — that's the more-stable native
primitive and the rule-#14 win that's actually shippable today.

**Filing:** This document calls out the slice-(c) deferral in the parent
P0's body as a `**Slice (c) status**:` line; the parent P0 stays unblocked
on its remaining slices.

## 7. Acceptance for this task (`investigate-claude-native-task-standard`)

The task spec requires five deliverables (§5 of the task body):

1. ✅ Exact native format/lifecycle/lock/dep semantics with doc citations — §1.1–1.5 above
2. ✅ Field-by-field comparison matrix vs the tasks.md spec — §3 above
3. ✅ Three options each with a quantified owned-surface delta — §4 (Option A: +145, B: +550, C: 0)
4. ✅ Single explicit go/no-go recommendation — §5 (Option C)
5. ✅ Named follow-up tasks the recommendation spawns — §6.1, §6.2, §6.3

All five present. The task closes when this doc lands on `main` and the
three follow-up task blocks land with it.

## Sources

[agent-teams]: https://code.claude.com/docs/en/agent-teams "Claude Code Agent Teams docs"
[agent-teams-enable]: https://code.claude.com/docs/en/agent-teams#enable-agent-teams "Enable Agent Teams"
[agent-teams-arch]: https://code.claude.com/docs/en/agent-teams#how-agent-teams-work "Agent Teams Architecture"
[agent-teams-claim]: https://code.claude.com/docs/en/agent-teams#assign-and-claim-tasks "Assign and claim tasks"
[hooks]: https://code.claude.com/docs/en/hooks "Claude Code Hooks docs"
[interactive-mode]: https://code.claude.com/docs/en/interactive-mode#task-list "Interactive Mode task list"
[todo-tracking]: https://code.claude.com/docs/en/agent-sdk/todo-tracking "TodoWrite migration docs"
[agent-sdk-ts]: https://code.claude.com/docs/en/agent-sdk/typescript "TypeScript Agent SDK"
[task-update-ts]: https://code.claude.com/docs/en/agent-sdk/typescript#taskupdate "TaskUpdate type def"
[task-list-py]: https://code.claude.com/docs/en/agent-sdk/python#tasklist "TaskList type def"
[tasks-md-spec]: https://github.com/tasksmd/tasks.md/blob/main/spec.md "tasks.md spec"
[gh-33764]: https://github.com/anthropics/claude-code/issues/33764 "Agent Teams state wiped on session restart"
[gh-26265]: https://github.com/anthropics/claude-code/issues/26265 "No resume for Agent Team teammates"
[gh-54463]: https://github.com/anthropics/claude-code/issues/54463 "Team messaging fails on session restart"
[gh-38379]: https://github.com/anthropics/claude-code/issues/38379 "--resume crashes with JSON Parse error"
[gh-20424]: https://github.com/anthropics/claude-code/issues/20424 "CLAUDE_CODE_TASK_LIST_ID not in -p mode"
