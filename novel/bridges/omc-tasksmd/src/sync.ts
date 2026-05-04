/**
 * Pure sync: take parsed OMC tasks + existing TASKS.md content + a mode,
 * return a new TASKS.md content with OMC tasks placed under the
 * `## OMC Sync` heading.
 *
 * v0 default mode is `replace-section`: re-running with the same input
 * yields byte-equal output (idempotent — the load-bearing property for
 * a read-only bridge that may run on a watch loop in v1+). The
 * `merge-by-id` mode is reserved for v1+ and currently throws.
 *
 * Pattern conformance:
 *   - Helland 2007 — eventual-consistency read direction; the section
 *     is the convergence point, not a per-task merge.
 *   - rule #6 (let-it-crash): the unsupported-mode path raises a typed
 *     error; the caller decides whether to crash or fall back.
 */

import { mapOmcToTasksMd } from "./mapper.js";
import type { OmcTeamTask, SyncInput } from "./types.js";

/**
 * Heading marker for the OMC-managed section. The exact match (case +
 * whitespace) is the section identifier — anything between this heading
 * and the next `## ` heading (or EOF) is owned by the bridge.
 */
export const OMC_SYNC_HEADING = "## OMC Sync";

/**
 * Sentinel comment emitted directly under the heading, so an external
 * reader (humans, lints) can identify the section as machine-managed.
 */
export const OMC_SYNC_MARKER =
  "<!-- managed by @minsky/omc-tasksmd-bridge — do not edit by hand; re-run the bridge to refresh -->";

/**
 * Replace-or-append the `## OMC Sync` section. Idempotent: re-running
 * with the same `omcTasks` + same `existingTasksMd` yields byte-equal
 * output.
 *
 * @otel bridges.omc-tasksmd.sync-omc-to-tasks-md
 */
export function syncOmcToTasksMd(input: SyncInput): string {
  if (input.mode === "merge-by-id") {
    throw new Error(
      "merge-by-id mode is deferred to v1+ (see TASKS.md `omc-tasksmd-bridge-v1-watcher`)",
    );
  }
  const section = renderOmcSection(input.omcTasks);
  return replaceOrAppendSection(input.existingTasksMd, section);
}

/**
 * Render the full `## OMC Sync` section text — heading, marker, body.
 * An empty `omcTasks` list produces a section with the heading + marker
 * but no task blocks (still idempotent — the heading is preserved as
 * an explicit "managed but empty" signal).
 *
 * @otel bridges.omc-tasksmd.render-omc-section
 */
export function renderOmcSection(omcTasks: readonly OmcTeamTask[]): string {
  const blocks = omcTasks.map(mapOmcToTasksMd);
  const body = blocks.length === 0 ? "" : `\n\n${blocks.join("\n\n")}`;
  return `${OMC_SYNC_HEADING}\n\n${OMC_SYNC_MARKER}${body}\n`;
}

/**
 * If `existingTasksMd` already contains `## OMC Sync`, replace its
 * section in place; otherwise append the new section to the end.
 *
 * @otel bridges.omc-tasksmd.replace-or-append-section
 */
function replaceOrAppendSection(existingTasksMd: string, section: string): string {
  const span = locateOmcSection(existingTasksMd);
  if (span === null) return appendSection(existingTasksMd, section);
  const before = existingTasksMd.slice(0, span.start);
  const after = existingTasksMd.slice(span.end);
  return `${before}${section}${after}`;
}

/**
 * Append the section with a single blank-line separator, ensuring the
 * file ends with exactly one trailing newline.
 *
 * @otel-exempt string-builder helper; trivial pure function
 */
function appendSection(existing: string, section: string): string {
  if (existing.length === 0) return section;
  const trimmed = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${trimmed}\n${section}`;
}

/**
 * Locate the byte span (`[start, end)`) covered by the existing
 * `## OMC Sync` section, or `null` if the heading isn't present.
 *
 * The section runs from its heading line up to (but not including) the
 * next `## ` heading or EOF.
 *
 * @otel bridges.omc-tasksmd.locate-omc-section
 */
export function locateOmcSection(md: string): { start: number; end: number } | null {
  const lines = md.split("\n");
  const startLineIdx = findHeadingLine(lines, OMC_SYNC_HEADING);
  if (startLineIdx === -1) return null;
  const endLineIdx = findNextH2(lines, startLineIdx + 1);
  const start = byteOffsetOfLine(lines, startLineIdx);
  const end = endLineIdx === -1 ? md.length : byteOffsetOfLine(lines, endLineIdx);
  return { start, end };
}

/**
 * @otel-exempt array-scan helper; trivial pure function
 */
function findHeadingLine(lines: readonly string[], heading: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === heading) return i;
  }
  return -1;
}

/**
 * @otel-exempt array-scan helper; trivial pure function
 */
function findNextH2(lines: readonly string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) return i;
  }
  return -1;
}

/**
 * Compute the byte offset of `lines[idx]` in the joined `\n`-separated
 * source. Each preceding line contributes its length plus one `\n`.
 *
 * @otel-exempt arithmetic helper; trivial pure function
 */
function byteOffsetOfLine(lines: readonly string[], idx: number): number {
  let offset = 0;
  for (let i = 0; i < idx; i++) {
    offset += (lines[i] ?? "").length + 1;
  }
  return offset;
}
