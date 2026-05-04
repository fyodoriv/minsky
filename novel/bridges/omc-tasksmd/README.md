# `@minsky/omc-tasksmd-bridge`

<!-- rule-1: OMC's TaskFile / TeamTask format rejected because: OMC has no tasks.md adapter and ships its own JSON store; until the upstream adoption issue (`omc-tasksmd-issue` in TASKS.md) lands, a thin reader is the cheapest interoperability point — Helland 2007 (read-side bridge of an eventual-consistency pair). -->

Read-only bridge: OMC team-task JSON → tasks.md. v0.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../../vision.md#pattern-conformance-index) row 62:

- **Read-only adapter bridge** — Helland 2007 ("Life beyond Distributed Transactions", *CIDR* 2007 — eventual consistency, only the read direction in v0). The reverse direction is deferred to v1+ pending a CRDT story for OMC's optimistic-concurrency `version` field. **Conformance: full** (read direction).
- **Mapper / projection** — pure function from `OmcTeamTask` to a tasks.md task block. The projection is *lossy*: see § "Lossy projection" below. **Conformance: partial** (lossy by design, documented).
- **Sync** — section-replace idempotency: re-running with the same input yields byte-equal output. The OMC-managed section is identified by its heading (`## OMC Sync`) and a sentinel HTML comment. **Conformance: full**.
- **Actor model** — Hewitt-Bishop-Steiger 1973 — TASKS.md is the message store; each emitted block is one message addressed to whoever picks it next. **Conformance: full**.

## Lossy projection

v0 surfaces a documented subset of the OMC schema in tasks.md:

| OMC field | tasks.md field | Notes |
|---|---|---|
| `id` | `**ID**:` | exact |
| `subject` | block heading | exact |
| `description` | `**Description**:` | exact (single-line; multi-line OMC descriptions collapse on the line break in v0) |
| `status` | `**Status**:` + bracket `[x]`/`[ ]` | `[x]` iff `status === "completed"` |
| `owner` ?? `claim.owner` | `**OMC-Owner**:` | falls through `owner` first, then claim |
| `blocked_by` | `**Blocked by**:` | comma-space-joined |
| `created_at` | `**Created-at**:` | exact |
| `version` | `**OMC-Version**:` | exact (omitted → empty string) |
| `claim.token`, `claim.leased_until` | (dropped) | v0 lossy — claim ownership is the only claim signal we surface |
| `blocks`, `depends_on`, `result`, `error`, `requires_code_change`, `metadata` | (dropped) | v0 lossy — out of scope until v1+ |

**Round-trip caveat**: re-emitting the projected block back to OMC would *not* preserve the dropped fields. v0 is read-only precisely so this never happens; the v1+ watcher (`omc-tasksmd-bridge-v1-watcher` in TASKS.md) must address the lossy fields before reverse-sync is safe.

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every well-formed OMC task JSON parses, maps, and syncs to a tasks.md block deterministically; every malformed input is gracefully skipped with a stderr advisory and never aborts the whole snapshot.
- **Blast radius**: a single TASKS.md document. The mapper + sync are pure (no I/O, no shared state). The reader is the only I/O boundary; it never writes.
- **Operator escape hatch**: stderr advisories on every skipped input; the caller can grep for `[omc-tasksmd-bridge]` to surface skipped paths.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | `<repoRoot>/.omc/state/team/` directory missing | cold-start | return `[]` (no error, no advisory) | covered by `novel/bridges/omc-tasksmd/src/reader.test.ts` empty-fixture test |
| 2 | One task JSON file is malformed (`SyntaxError`) | upstream-malformed | skip the file with a `[omc-tasksmd-bridge] skip malformed JSON` stderr advisory; other files still parse | covered by `novel/bridges/omc-tasksmd/src/reader.test.ts` malformed-fixture test (asserts on captured stderr) |
| 3 | Unknown `teamName` filter | caller error | return `[]` (graceful — same shape as cold-start) | covered by `novel/bridges/omc-tasksmd/src/reader.test.ts` unknown-team test |
| 4 | A task carries fields v0 doesn't surface (e.g., `metadata`) | forward-compatibility | parse, drop the unknown fields, emit the documented projection (lossy by design) | covered by `novel/bridges/omc-tasksmd/src/mapper.test.ts` full-task fixture (asserts the documented fields are present; fixture file `task-001.json` carries `metadata` to confirm round-trip drop) |
| 5 | Existing TASKS.md has a stale `## OMC Sync` section | re-run after upstream change | replace the section in place; do not duplicate | covered by `novel/bridges/omc-tasksmd/src/sync.test.ts` replace-existing test |
| 6 | Caller requests `mode: "merge-by-id"` (v1+ feature) | premature use | throw with a `v1+` reference (rule #6 let-it-crash — caller decides next step) | covered by `novel/bridges/omc-tasksmd/src/sync.test.ts` merge-by-id assertion |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a thin read-only OMC → tasks.md bridge against synthetic fixtures parses + maps + syncs deterministically, validating PR #77's parseable verdict.
- **Success threshold**: ≥11 tests pass (`pnpm vitest run novel/bridges/omc-tasksmd/`); the reader handles all four chaos rows above (cold-start / malformed / unknown-team / forward-compat); the sync is idempotent (re-running yields byte-equal output).
- **Pivot threshold**: if any field in the OMC schema cannot be losslessly mapped to the documented tasks.md projection (e.g., `metadata` arbitrary JSON), document the lossy projection here (§ "Lossy projection") and ship anyway with a "lossy v0" note. (Already declared above — the pivot fired before code, per rule #9 pre-registration.)
- **Measurement**: `pnpm typecheck && pnpm vitest run novel/bridges/omc-tasksmd/`
- **Literature anchor**: research.md § "OMC handoff persistence" (the parseable verdict); Helland, "Life beyond Distributed Transactions", *CIDR* 2007 (eventual consistency, read direction in v0); Hewitt, Bishop, Steiger, *IJCAI* 1973 (actor model — TASKS.md as the message store); Aho-Sethi-Ullman *Compilers* 1986 (parser-shape — JSON.parse is the sole parser).

## Usage

```ts
import { readFile, writeFile } from "node:fs/promises";
import { OmcReader, syncOmcToTasksMd } from "@minsky/omc-tasksmd-bridge";

const tasks = await OmcReader.list({ repoRoot: process.cwd() });
const existing = await readFile("TASKS.md", "utf8");
const next = syncOmcToTasksMd({
  omcTasks: tasks,
  existingTasksMd: existing,
  mode: "replace-section",
});
await writeFile("TASKS.md", next);
```

The bridge is read-only on the OMC side; no `.omc/state/` write paths exist in this package. v1+ reverse direction is filed as `omc-tasksmd-bridge-v1-watcher` in TASKS.md.
