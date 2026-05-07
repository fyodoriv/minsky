// <!-- scope: human-approved P0 from 9h monitoring window 2026-05-07 (operator directive) -->

/**
 * P0 watchdog: detect when a TASKS.md task's substrate has shipped + the
 * task block should be auto-removed so daemons don't re-pick the task.
 *
 * The 9h dogfood window 2026-05-06/07 caught worker-1 picking
 * `daemon-pre-pr-lint-gate` for ~3 hours after #309 had already merged
 * — the TASKS.md task block stayed around because operators don't
 * remove blocks at merge time. With N=5 workers this scales 5×.
 *
 * `decideTaskCompletion({ taskBlock, mergedPrs })` is the pure decision.
 * Conservative: only returns `'remove'` when ALL acceptance-criteria
 * checkboxes parse as ✅ AND at least one merged PR's title names the
 * task ID. Anything else returns `'keep'` (the task may still need
 * iteration) or `'no-merged-pr'` (substrate not shipped yet).
 *
 * Caller (daemon iteration step) wraps this with `gh pr list --state merged`
 * and emits a TASKS.md edit when verdict is `'remove'`.
 *
 * @otel-exempt pure decision; the I/O wrapper feeds the merged-PR list in.
 */

export type TaskCompletionVerdict =
  | { readonly kind: "remove"; readonly viaPrNumber: number; readonly reason: string }
  | { readonly kind: "keep"; readonly reason: string }
  | { readonly kind: "no-merged-pr"; readonly reason: string };

export type MergedPrSnapshot = {
  readonly number: number;
  readonly title: string;
};

/**
 * Pure decision: should the task block for `taskId` be removed because
 * its substrate has shipped?
 *
 * **Format-agnostic.** Works for both:
 *   - **Single-file `TASKS.md`**: caller extracts the block via
 *     `extractTaskBlock(tasksMd, taskId)` (in daemon.ts).
 *   - **Folder format `tasks/<id>.md`**: caller passes the whole file
 *     contents as `taskBlock`. The decision logic is identical — both
 *     shapes carry the same `**ID**:` / `**Acceptance**:` / `**Status**:`
 *     field grammar, just delimited differently on disk.
 *
 * Inputs:
 *   - `taskBlock`: the raw markdown text of the task block.
 *   - `mergedPrs`: the recent merged PR list (caller's `gh pr list`
 *     query result, filtered to daemon-authored if desired).
 *   - `taskId`: the task's `**ID**:` value.
 *
 * Returns `'remove'` only when both gates fire:
 *   1. ≥1 merged PR's title names the task ID (substrate shipped) OR
 *      the task block carries `**Status**: shipped` (explicit override —
 *      operator-readable single source of truth, mirrors the
 *      acceptance-checkbox heuristic but more reliable).
 *   2. The task block's `**Acceptance**:` field, if present, parses as
 *      "all criteria satisfied" (no `[ ]` unchecked-box pattern between
 *      the field and the next `**Field**:` boundary). Tasks without an
 *      `**Acceptance**:` field are auto-removable on shipped substrate
 *      alone (the conservative reading: if the operator didn't list
 *      acceptance criteria, the merged PR is the verdict).
 *
 * `**Status**: in-progress` (or any value other than `shipped`) keeps
 * the block; explicit `**Status**: shipped` is the operator-controlled
 * fast path that bypasses the heuristics entirely.
 *
 * @otel-exempt pure decision.
 */
export function decideTaskCompletion(input: {
  readonly taskId: string;
  readonly taskBlock: string;
  readonly mergedPrs: readonly MergedPrSnapshot[];
}): TaskCompletionVerdict {
  // Explicit `**Status**: shipped` is the operator-controlled fast path —
  // bypasses heuristics. Inverse: `**Status**: <anything-else>` keeps the
  // block regardless of merged PRs (operator can mark `in-progress` to
  // veto auto-removal).
  const status = parseStatusField(input.taskBlock);
  if (status === "in-progress" || status === "blocked") {
    return { kind: "keep", reason: `**Status**: ${status} — explicit operator veto` };
  }
  const matchingPrs = input.mergedPrs.filter((p) => titleNamesTask(p.title, input.taskId));
  if (status === "shipped" && matchingPrs.length > 0) {
    const viaPr = matchingPrs[matchingPrs.length - 1];
    if (viaPr !== undefined) {
      return {
        kind: "remove",
        viaPrNumber: viaPr.number,
        reason: `**Status**: shipped + ${matchingPrs.length} merged PR(s) named ${input.taskId} (latest #${viaPr.number})`,
      };
    }
  }
  if (matchingPrs.length === 0) {
    return { kind: "no-merged-pr", reason: `no merged PR title names ${input.taskId}` };
  }
  const acceptanceVerdict = inspectAcceptance(input.taskBlock);
  if (acceptanceVerdict.kind === "incomplete") {
    return { kind: "keep", reason: acceptanceVerdict.reason };
  }
  const viaPr = matchingPrs[matchingPrs.length - 1];
  if (viaPr === undefined) {
    return { kind: "no-merged-pr", reason: `no merged PR title names ${input.taskId}` };
  }
  return {
    kind: "remove",
    viaPrNumber: viaPr.number,
    reason: `${matchingPrs.length} merged PR(s) named ${input.taskId}; latest #${viaPr.number}; ${acceptanceVerdict.reason}`,
  };
}

/**
 * Parse the `**Status**:` field if present. Returns `'shipped'`,
 * `'in-progress'`, `'blocked'`, or `undefined` when the field is absent.
 * Unknown values fall back to `undefined` (treated as "no opinion") so a
 * typo doesn't accidentally veto auto-removal.
 *
 * @otel-exempt pure helper.
 */
function parseStatusField(taskBlock: string): "shipped" | "in-progress" | "blocked" | undefined {
  const m = taskBlock.match(/\*\*Status\*\*:\s*([a-z][a-z-]*)/i);
  if (m === null || m[1] === undefined) return undefined;
  const v = m[1].toLowerCase();
  if (v === "shipped" || v === "in-progress" || v === "blocked") return v;
  return undefined;
}

/**
 * Match a PR title against a task ID with word-boundary semantics +
 * regex-metacharacter escaping. Mirrors `prTitleNamesTask` in
 * `duplicate-pr-detector.ts` but kept independent so the modules don't
 * cross-import.
 *
 * @otel-exempt pure helper.
 */
export function titleNamesTask(title: string, taskId: string): boolean {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`);
  return re.test(title);
}

type AcceptanceVerdict =
  | { readonly kind: "all-✅"; readonly reason: string }
  | { readonly kind: "no-field"; readonly reason: string }
  | { readonly kind: "incomplete"; readonly reason: string };

/**
 * Inspect the task block for an `**Acceptance**:` field and decide
 * whether all criteria are satisfied.
 *
 * Heuristics (deliberately conservative):
 *   - If the block has no `**Acceptance**:` field → `no-field` (the
 *     caller treats this as ✅ — no explicit criteria → merged PR is
 *     the verdict).
 *   - If the field exists but contains `[ ]` (unchecked-box pattern,
 *     space-inside-brackets) → `incomplete` (criteria still pending).
 *   - Otherwise → `all-✅`.
 *
 * @otel-exempt pure helper.
 */
function inspectAcceptance(taskBlock: string): AcceptanceVerdict {
  const fieldMatch = taskBlock.match(/\*\*Acceptance\*\*:\s*([\s\S]*?)(?=\n\s*-\s*\*\*[A-Z]|$)/);
  if (fieldMatch === null || fieldMatch[1] === undefined) {
    return {
      kind: "no-field",
      reason: "no **Acceptance** field present; merged PR is the verdict",
    };
  }
  const acceptanceText = fieldMatch[1];
  if (/\[\s\]/.test(acceptanceText)) {
    return {
      kind: "incomplete",
      reason: "**Acceptance** field has unchecked `[ ]` boxes; task not yet complete",
    };
  }
  return { kind: "all-✅", reason: "**Acceptance** field has no unchecked boxes" };
}
