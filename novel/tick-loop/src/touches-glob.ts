// <!-- scope: human-approved slice 3 of daemon-parallel-worktree-launch (operator 2026-05-06) -->

/**
 * Slice 3 substrate of `daemon-parallel-worktree-launch`.
 *
 * Pure helpers for the `**Touches**: <glob>[, <glob>…]` task-block field
 * and the pre-spawn glob-overlap check that prevents two parallel workers
 * from picking tasks whose changed-file sets overlap an open PR's.
 *
 * Three pure pieces:
 *   - `parseTouchesField(blockText)` extracts the comma-separated glob
 *     list from a single task block.
 *   - `globMatchesPath(glob, path)` is a minimal glob matcher supporting
 *     `*` (any chars including `/`) and `?` (single char) plus exact text.
 *     Sufficient for the daemon-side surface (`novel/tick-loop/**`,
 *     `scripts/*.mjs`, etc.); deliberately not full-featured to avoid a
 *     `micromatch`/`minimatch` dependency.
 *   - `decideTouchesCollision({ taskGlobs, openPrs })` is the pre-spawn
 *     decision: `proceed` if no open PR's files overlap any of the
 *     candidate task's globs; `collision-prevented` with the offending PR
 *     number + overlapping paths otherwise.
 *
 * @otel-exempt pure substrate; the spawn-strategy slice (next) wires
 * `decideTouchesCollision` into the supervisor's pre-spawn check fed by
 * `gh pr list --json number,files`.
 */

const TOUCHES_RE = /^\s*-\s+\*\*Touches\*\*:\s*(.+?)\s*$/im;
const FILES_RE = /^\s*-\s+\*\*Files\*\*:\s*(.+)$/im;
// Backtick-wrapped path-shaped tokens: anything inside backticks that
// contains a `/` or has a recognizable file extension. Captures the path
// only (without backticks). Multiline flag because **Files**: blocks can
// wrap across lines via parenthetical descriptions.
const BACKTICK_PATH_RE = /`([^`\s]*[/.][^`\s]*)`/g;

/**
 * Parse the `**Touches**: <glob>[, <glob>…]` field from a single task
 * block's text. Returns the trimmed, deduped glob list (or `[]` when the
 * field is absent — no field is treated as "no globs declared", which the
 * caller's policy decides how to handle: error, warn, or accept).
 *
 * @otel-exempt pure parser.
 */
export function parseTouchesField(blockText: string): readonly string[] {
  const match = blockText.match(TOUCHES_RE);
  if (match === null || match[1] === undefined) return [];
  const raw = match[1];
  const split = raw
    .split(",")
    .map((g) => stripTicks(g.trim()))
    .filter((g) => g.length > 0);
  return [...new Set(split)];
}

/**
 * Slice 4 substrate of `daemon-parallel-worktree-launch`.
 *
 * Extract backtick-wrapped path-shaped tokens from a task block's
 * `**Files**:` field. The field's prose form ("`a/b.ts` (purpose),
 * `c/d.ts` (purpose), …") is human-readable; this parser pulls just the
 * path tokens so the file-collision check can run against tasks that
 * predate the `**Touches**:` field. A token counts as a path when it
 * contains `/` or `.` (a file extension).
 *
 * Returns deduped, order-preserving paths. Empty array when the field is
 * absent.
 *
 * @otel-exempt pure parser.
 */
export function extractFilePathsFromFilesField(blockText: string): readonly string[] {
  const match = blockText.match(FILES_RE);
  if (match === null || match[1] === undefined) return [];
  const fieldValue = match[1];
  const seen = new Set<string>();
  const out: string[] = [];
  // Use matchAll on the captured field-value so we don't pick up backticks
  // from neighbouring fields (e.g. **Hypothesis** further down in the block).
  for (const m of fieldValue.matchAll(BACKTICK_PATH_RE)) {
    const path = m[1];
    if (path !== undefined && !seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

/**
 * Slice 4 substrate of `daemon-parallel-worktree-launch`.
 *
 * Combined glob list: prefer `**Touches**:` (the design intent), fall back
 * to `**Files**:` paths when Touches is absent (every task already has a
 * Files field, so this gives the daemon collision data without a TASKS.md
 * migration). Returns the deduped union.
 *
 * @otel-exempt pure parser.
 */
export function parseTouchesOrFiles(blockText: string): readonly string[] {
  const touches = parseTouchesField(blockText);
  if (touches.length > 0) return touches;
  return extractFilePathsFromFilesField(blockText);
}

function stripTicks(s: string): string {
  return s.replace(/^`/, "").replace(/`$/, "");
}

/**
 * Minimal glob matcher: supports `*` (matches any chars including `/` —
 * a deliberate departure from POSIX glob, since the daemon-side patterns
 * like `novel/tick-loop/**` are descended-path globs not single-segment),
 * `?` (single char), and exact text. No brace expansion, no character
 * classes — keeps the regex predictable and the dep tree empty.
 *
 * @otel-exempt pure matcher.
 */
export function globMatchesPath(glob: string, path: string): boolean {
  const re = globToRegex(glob);
  return re.test(path);
}

function globToRegex(glob: string): RegExp {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else if (/[.+^${}()|[\]\\]/.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`);
}

export type TouchesPrSnapshot = {
  readonly number: number;
  readonly files: readonly string[];
};

export type CollisionDecision =
  | { readonly verdict: "proceed" }
  | {
      readonly verdict: "collision-prevented";
      readonly prNumber: number;
      readonly overlapping: readonly string[];
    };

/**
 * Pre-spawn decision: should the worker proceed with this task, or refuse
 * because an open PR already touches an overlapping file? Walks each open
 * PR's changed-file list against every glob in the candidate task's
 * `**Touches**` field; the first PR with an overlap wins (returns
 * `collision-prevented` with the offending PR number + overlapping
 * paths).
 *
 * Empty `taskGlobs` (no `**Touches**` field declared) returns `proceed`
 * by design — the caller's policy decides whether to refuse the task
 * entirely (strict mode) or proceed (lenient default during rollout).
 *
 * @otel-exempt pure decision; the I/O wrapper feeds `gh pr list --json
 * number,files` results into `openPrs`.
 */
export function decideTouchesCollision(input: {
  readonly taskGlobs: readonly string[];
  readonly openPrs: readonly TouchesPrSnapshot[];
}): CollisionDecision {
  if (input.taskGlobs.length === 0) return { verdict: "proceed" };
  for (const pr of input.openPrs) {
    const overlapping = pr.files.filter((f) => input.taskGlobs.some((g) => globMatchesPath(g, f)));
    if (overlapping.length > 0) {
      return { verdict: "collision-prevented", prNumber: pr.number, overlapping };
    }
  }
  return { verdict: "proceed" };
}
