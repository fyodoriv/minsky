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
