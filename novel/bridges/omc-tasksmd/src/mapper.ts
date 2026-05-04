/**
 * Pure mapping from one `OmcTeamTask` to a tasks.md task block string.
 *
 * Pattern conformance:
 *   - Helland 2007 — read direction of an eventual-consistency bridge;
 *     the lossy projection (we surface a documented subset of OMC
 *     fields, not the entire JSON) is intentional and called out in
 *     `README.md` § "Lossy projection".
 *   - Hewitt-Bishop-Steiger 1973 — TASKS.md is the message store;
 *     each emitted block is one message (the task) addressed to
 *     whoever picks it next.
 *
 * Schema lifted from the brief and from research.md § "OMC handoff
 * persistence".  This function is total (every input produces a string)
 * and pure (no I/O, no shared state, no clock dependency).
 */

import type { OmcTeamTask } from "./types.js";

/**
 * Map one OMC task → markdown block.
 *
 * The bracket state mirrors `status === "completed"` → `[x]`, anything
 * else → `[ ]`.  `OMC-Owner` falls through `owner ?? claim?.owner ?? ''`.
 * `Blocked by` joins `blocked_by` with `, ` (consistent with the
 * tasks.md convention; `[]` → empty string, never the literal `[]`).
 *
 * @otel bridges.omc-tasksmd.map-omc-to-tasks-md
 */
export function mapOmcToTasksMd(task: OmcTeamTask): string {
  const checkbox = task.status === "completed" ? "[x]" : "[ ]";
  const owner = task.owner ?? task.claim?.owner ?? "";
  const blockedBy = (task.blocked_by ?? []).join(", ");
  const description = task.description ?? "";
  const version = formatVersion(task.version);
  const lines = [
    `- ${checkbox} ${task.subject}`,
    `  - **ID**: ${task.id}`,
    `  - **OMC-Owner**: ${owner}`,
    `  - **Status**: ${task.status}`,
    `  - **Created-at**: ${task.created_at}`,
    `  - **Description**: ${description}`,
    `  - **Blocked by**: ${blockedBy}`,
    `  - **OMC-Version**: ${version}`,
  ];
  return lines.join("\n");
}

/**
 * `version` is optional in the OMC schema; render as the empty string
 * when absent so the tasks.md block stays well-formed (a `**Bold**:`
 * line with an empty value is preferred over an omitted field — keeps
 * the output's *shape* idempotent when OMC starts emitting a previously
 * omitted version).
 *
 * @otel-exempt formatting helper; trivial pure function
 */
function formatVersion(v: number | undefined): string {
  if (v === undefined) return "";
  return String(v);
}
