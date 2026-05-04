/**
 * `@minsky/omc-tasksmd-bridge` — read-only OMC → tasks.md bridge (v0).
 *
 * Public API:
 *   - `OmcReader.list(opts)`      — walk `<repoRoot>/.omc/state/team/`
 *   - `mapOmcToTasksMd(task)`     — pure projection to a tasks.md block
 *   - `syncOmcToTasksMd(input)`   — pure sync into a TASKS.md document
 *   - `OmcTeamTask`, `BridgeOptions`, `SyncInput`, `SyncMode` — types
 *
 * v0 is read-only. Reverse direction (tasks.md → OMC) is deferred to
 * `omc-tasksmd-bridge-v1-watcher` in TASKS.md, pending a CRDT story for
 * OMC's optimistic-concurrency `version` field.
 */

export { OmcReader, list } from "./reader.js";
export { mapOmcToTasksMd } from "./mapper.js";
export {
  OMC_SYNC_HEADING,
  OMC_SYNC_MARKER,
  locateOmcSection,
  renderOmcSection,
  syncOmcToTasksMd,
} from "./sync.js";
export type {
  BridgeOptions,
  OmcTaskClaim,
  OmcTaskStatus,
  OmcTeamTask,
  SyncInput,
  SyncMode,
} from "./types.js";
