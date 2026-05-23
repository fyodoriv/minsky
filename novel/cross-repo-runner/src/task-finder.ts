// Task-finder — given a host's TASKS.md content + a task identifier (kebab-id
// or ticket-key), return the matching task block parsed into the rule-#9
// fields the runner needs.
//
// Pattern: pure function over text + identifier; tasks.md spec parsing
//   (https://github.com/tasksmd/tasks.md). Source: rule #2 (vision.md § 2 —
//   the host's TASKS.md is an external dep made explicit via this parser);
//   user-stories/006-runner-on-any-repo.md § "Acceptance criteria" — runner
//   "locates the task in the host's TASKS.md by ID or by ticket-format match".
// Conformance: full — pure function over typed inputs.

/**
 * One parsed task row from a host's TASKS.md, narrowed to the fields the
 * runner needs to synthesise an EXPERIMENT.yaml. Optional fields stay null
 * when absent — the synthesiser fails loudly if a required rule-#9 field
 * is missing (rule #9 is iron).
 */
export interface ParsedTask {
  /** Kebab-case task identifier from the `**ID**:` field. */
  id: string;
  /** First line of the task block (after the `[ ]` checkbox). */
  title: string;
  /** Priority section (`P0` | `P1` | `P2` | `P3`). */
  priority: string;
  /** Comma-separated `**Tags**:` field, parsed to an array. */
  tags: string[];
  /** Free-form `**Details**:` paragraph, or null when absent. */
  details: string | null;
  /** Free-form `**Hypothesis**:` (rule #9), or null when absent. */
  hypothesis: string | null;
  /** Free-form `**Success**:` threshold (rule #9), or null. */
  success: string | null;
  /** Free-form `**Pivot**:` threshold (rule #9), or null. */
  pivot: string | null;
  /** Free-form `**Measurement**:` runnable command (rule #9), or null. */
  measurement: string | null;
  /** Free-form `**Anchor**:` literature citation (rule #9), or null. */
  anchor: string | null;
  /**
   * Free-form `**Blocked**:` reason (external-dep / needs-approval /
   * policy-refused), or null when the task is not blocked. Tasks with a
   * non-empty `blocked` field are filtered out by {@link pickHostTask} —
   * picking a blocked task burns an iteration before the worker
   * discovers the block. The `**Blocked by**:` *task-dependency* form
   * is a separate field handled by the runner's dependency-graph layer,
   * not this regex.
   */
  blocked: string | null;
}

export type FindTaskResult =
  | { ok: true; task: ParsedTask }
  | { ok: false; reason: string; availableIds: string[] };

/**
 * Pure function: select the first rule-#9-compliant `P0` or `P1` task
 * from a parsed task list. A task is "rule-#9-compliant" when ALL five
 * fields are present: `**Hypothesis**:`, `**Success**:`, `**Pivot**:`,
 * `**Measurement**:`, `**Anchor**:`. P0 is selected before P1; within a
 * priority section, document order wins (top-down — same convention as
 * `@minsky/tick-loop`'s `pickTask`).
 *
 * Skip layers (composable — a task is excluded if ANY layer matches):
 *
 *   - `openPrBranches` — skip tasks whose canonical branch
 *     (`<branch_prefix><task.id>`) already has an open PR. Self-heals
 *     across the merge-vs-cleanup-task race: after task T's PR opens,
 *     minsky's NEXT iteration picks T+1 instead of re-doing T while
 *     waiting for the operator to delete T from TASKS.md. (Discovered
 *     2026-05-16 on example-service-plugin run.)
 *
 *   - `skipTaskIds` — skip tasks by ID. The host-loop fills this with
 *     the set of task IDs that have already completed `verdict: validated`
 *     earlier in the SAME `runHostLoop` invocation. Without this layer,
 *     a worker that validates but never opens a PR (or never edits
 *     TASKS.md) keeps getting the same task re-picked, draining the
 *     loop's per-host iteration cap on a single non-progressing task
 *     and starving every other host the walker should reach next.
 *     (Discovered 2026-05-18 on the live multi-host dogfood run —
 *     `walker-drains-one-host-forever`.)
 *
 * Returns `null` when no eligible task exists — the {@link runHostLoop}
 * caller uses this as the `empty-queue` stop signal.
 *
 * @otel cross-repo-runner.pick-host-task
 */
export function pickHostTask(
  tasksMdContent: string,
  options?: {
    openPrBranches?: ReadonlySet<string>;
    branchPrefix?: string;
    skipTaskIds?: ReadonlySet<string>;
  },
): ParsedTask | null {
  const tasks = parseTasksMd(tasksMdContent);
  const openPrBranches = options?.openPrBranches ?? new Set<string>();
  const branchPrefix = options?.branchPrefix ?? "feat/";
  const skipTaskIds = options?.skipTaskIds ?? new Set<string>();
  const eligible = tasks
    .filter(isHostTaskEligible)
    .filter(isNotBlocked)
    .filter((t) => !openPrBranches.has(`${branchPrefix}${t.id}`))
    .filter((t) => !skipTaskIds.has(t.id));
  for (const priority of ["P0", "P1"] as const) {
    const match = eligible.find((t) => t.priority === priority);
    if (match !== undefined) return match;
  }
  return null;
}

/**
 * Predicate: does this task carry all 5 rule-#9 fields? Used by
 * {@link pickHostTask} to filter the queue.
 *
 * @otel-exempt pure predicate.
 */
export function isHostTaskEligible(task: ParsedTask): boolean {
  return (
    task.hypothesis !== null &&
    task.success !== null &&
    task.pivot !== null &&
    task.measurement !== null &&
    task.anchor !== null
  );
}

/**
 * Predicate: is this task unblocked (no non-empty `**Blocked**:` reason)?
 * Used by {@link pickHostTask} to skip tasks whose external-dep / approval
 * gate has not yet been resolved. A task with `blocked` set is still
 * surfaced by {@link findTask} (targeted lookups should report the block
 * to the caller), but never returned from the autonomous-loop picker.
 *
 * The companion `**Blocked by**: <id>` task-dependency form is NOT covered
 * here — that lives in the runner's dependency-graph layer because it
 * needs the full task set to resolve transitive deps.
 *
 * @otel-exempt pure predicate.
 */
export function isNotBlocked(task: ParsedTask): boolean {
  return task.blocked === null || task.blocked.trim().length === 0;
}

/**
 * Pure function: walk the tasks.md content and return the task whose
 * `**ID**:` matches `query`, OR whose title contains `query` as a
 * substring (case-insensitive — for ticket-key matching like `PROJ-840`).
 *
 * Returns `{ ok: false, ... }` with the available IDs if no match — the
 * CLI prints the list so the operator can correct the typo.
 *
 * @otel cross-repo-runner.find-task
 */
export function findTask(tasksMdContent: string, query: string): FindTaskResult {
  const tasks = parseTasksMd(tasksMdContent);
  const queryLower = query.toLowerCase();

  // First pass: exact ID match.
  for (const task of tasks) {
    if (task.id === query) return { ok: true, task };
  }

  // Second pass: case-insensitive substring match against title.
  for (const task of tasks) {
    if (task.title.toLowerCase().includes(queryLower)) return { ok: true, task };
  }

  return {
    ok: false,
    reason: `task "${query}" not found in TASKS.md (matched neither **ID**: nor title)`,
    availableIds: tasks.map((t) => t.id),
  };
}

function flushTask(currentTask: PartialParsedTask | null, tasks: ParsedTask[]): void {
  if (currentTask === null) return;
  const finalised = finaliseTask(currentTask);
  if (finalised !== null) tasks.push(finalised);
}

function startTask(title: string, priority: string): PartialParsedTask {
  return {
    id: null,
    title,
    priority,
    tags: [],
    details: null,
    hypothesis: null,
    success: null,
    pivot: null,
    measurement: null,
    anchor: null,
    blocked: null,
  };
}

interface ParserState {
  tasks: ParsedTask[];
  currentPriority: string;
  currentTask: PartialParsedTask | null;
  // Continuation tracking — when a `**Field**:` matches we remember the
  // indent level of the field's bullet AND a setter that appends to the
  // captured field. Subsequent lines whose indent is STRICTLY greater
  // than the field's indent (i.e. they're nested under the bullet) get
  // appended to the same field. The continuation closes when any of:
  //   (a) the line matches a new `**Field**:` pattern
  //   (b) the line indent ≤ the field indent (a sibling bullet)
  //   (c) the line is a checkbox or `## P\d+` section heading
  // Without this state the parser captures only the FIRST line of any
  // bullet — see example-service-plugin task `fix-minsky-parser-multiline-details`
  // for the field report (bulletproof-ux-dashboard brief truncated to
  // "Walk the page state-by-state:" so claude --print had no actionable
  // steps and shipped nothing).
  currentFieldIndent: number | null;
  currentFieldAppend: ((extra: string) => void) | null;
}

function processTaskLine(line: string, state: ParserState): void {
  const priorityMatch = line.match(/^##\s+(P\d)\b/);
  if (priorityMatch?.[1] !== undefined) {
    flushTask(state.currentTask, state.tasks);
    state.currentPriority = priorityMatch[1];
    state.currentTask = null;
    state.currentFieldIndent = null;
    state.currentFieldAppend = null;
    return;
  }
  const checkboxMatch = line.match(/^-\s+\[\s*[ x]\s*\]\s+(.*)$/);
  if (checkboxMatch?.[1] !== undefined) {
    flushTask(state.currentTask, state.tasks);
    state.currentTask = startTask(checkboxMatch[1].trim(), state.currentPriority);
    state.currentFieldIndent = null;
    state.currentFieldAppend = null;
    return;
  }
  if (state.currentTask !== null) {
    assignMetadata(state.currentTask, line, state);
  }
}

// Count leading-whitespace characters (tabs + spaces) before the first
// non-whitespace char. Used to detect continuation lines (indent strictly
// greater than the parent bullet's indent → continuation).
function leadingIndentWidth(line: string): number {
  const match = line.match(/^[ \t]*/);
  return match !== null ? match[0].length : 0;
}

/**
 * Pure function: parse a tasks.md document into the structured task list.
 * Implements only the subset the runner needs (priority sections, checkbox
 * lines, **ID** / **Tags** / **Hypothesis** / **Success** / **Pivot** /
 * **Measurement** / **Anchor** / **Details** metadata).
 *
 * @otel cross-repo-runner.parse-tasks-md
 */
export function parseTasksMd(content: string): ParsedTask[] {
  const state: ParserState = {
    tasks: [],
    currentPriority: "",
    currentTask: null,
    currentFieldIndent: null,
    currentFieldAppend: null,
  };
  for (const line of content.split("\n")) {
    processTaskLine(line, state);
  }
  flushTask(state.currentTask, state.tasks);
  return state.tasks;
}

interface PartialParsedTask {
  id: string | null;
  title: string;
  priority: string;
  tags: string[];
  details: string | null;
  hypothesis: string | null;
  success: string | null;
  pivot: string | null;
  measurement: string | null;
  anchor: string | null;
  blocked: string | null;
}

function finaliseTask(p: PartialParsedTask): ParsedTask | null {
  if (p.id === null) return null;
  return {
    id: p.id,
    title: p.title,
    priority: p.priority,
    tags: p.tags,
    details: p.details,
    hypothesis: p.hypothesis,
    success: p.success,
    pivot: p.pivot,
    measurement: p.measurement,
    anchor: p.anchor,
    blocked: p.blocked,
  };
}

function assignMetadata(task: PartialParsedTask, line: string, state: ParserState): void {
  // Strip a leading bullet marker (`- ` or `* `) so both tasks.md-spec
  // formats parse identically:
  //   (a) nested-bullet style (what this repo's own TASKS.md uses, and
  //       what the upstream tasks.md spec describes):
  //         - [ ] task
  //           - **ID**: foo
  //           - **Hypothesis**: …
  //   (b) indented-only style (what the integration-test fixture uses):
  //         - [ ] task
  //           **ID**: foo
  //           **Hypothesis**: …
  // Discovered via observer dogfood 2026-05-12 — `pickHostTask` returned
  // `empty-queue` against minsky's own TASKS.md because the trimmed line
  // `- **ID**: foo` did not match the regex `^\*\*ID\*\*:\s*(.+)$`.
  // Fix: after `trim()`, strip an optional leading `-·` / `*·` so the
  // same regex set matches both formats.
  const indent = leadingIndentWidth(line);
  const stripped = line.trim().replace(/^[-*]\s+/, "");
  // For each field setter we also register a continuation-append on
  // `state` so subsequent indented lines flow into the same field. The
  // append function is reset when a new field matches OR the indent
  // drops back to ≤ the field's bullet indent.
  const registerContinuation = (
    write: (combined: string) => void,
    read: () => string | null,
  ): void => {
    state.currentFieldIndent = indent;
    state.currentFieldAppend = (extra) => {
      const existing = read();
      const next = existing === null || existing.length === 0 ? extra : `${existing}\n${extra}`;
      write(next);
    };
  };
  const mappings: [RegExp, (val: string) => void][] = [
    [
      /^\*\*ID\*\*:\s*(.+)$/,
      (val) => {
        task.id = val.trim();
      },
    ],
    [
      /^\*\*Tags\*\*:\s*(.+)$/,
      (val) => {
        task.tags = val.split(",").map((t) => t.trim());
      },
    ],
    [
      /^\*\*Details\*\*:\s*(.+)$/,
      (val) => {
        task.details = val.trim();
        registerContinuation(
          (combined) => {
            task.details = combined;
          },
          () => task.details,
        );
      },
    ],
    [
      /^\*\*Hypothesis\*\*:\s*(.+)$/,
      (val) => {
        task.hypothesis = val.trim();
        registerContinuation(
          (combined) => {
            task.hypothesis = combined;
          },
          () => task.hypothesis,
        );
      },
    ],
    [
      /^\*\*Success\*\*:\s*(.+)$/,
      (val) => {
        task.success = val.trim();
        registerContinuation(
          (combined) => {
            task.success = combined;
          },
          () => task.success,
        );
      },
    ],
    [
      /^\*\*Pivot\*\*:\s*(.+)$/,
      (val) => {
        task.pivot = val.trim();
        registerContinuation(
          (combined) => {
            task.pivot = combined;
          },
          () => task.pivot,
        );
      },
    ],
    [
      /^\*\*Measurement\*\*:\s*(.+)$/,
      (val) => {
        task.measurement = val.trim();
        registerContinuation(
          (combined) => {
            task.measurement = combined;
          },
          () => task.measurement,
        );
      },
    ],
    [
      /^\*\*Anchor\*\*:\s*(.+)$/,
      (val) => {
        task.anchor = val.trim();
        registerContinuation(
          (combined) => {
            task.anchor = combined;
          },
          () => task.anchor,
        );
      },
    ],
    [
      // `**Blocked**:` — external-dep / approval / policy-refused gate.
      // The `**Blocked by**: <task-id>` task-dependency form is a
      // DIFFERENT token (`Blocked by**` vs `Blocked**`) and is handled
      // by the runner's dependency-graph layer, not this regex.
      /^\*\*Blocked\*\*:\s*(.+)$/,
      (val) => {
        task.blocked = val.trim();
        registerContinuation(
          (combined) => {
            task.blocked = combined;
          },
          () => task.blocked,
        );
      },
    ],
  ];
  for (const [re, assign] of mappings) {
    const m = stripped.match(re);
    if (m?.[1] !== undefined) {
      assign(m[1]);
      return;
    }
  }
  // Continuation handling: the line didn't open a new field. If we're
  // currently inside a field's bullet (currentFieldAppend set) AND the
  // line is more indented than the field's bullet (i.e. nested under
  // it), this is a continuation — append it to the field's value. Stop
  // on a sibling/parent bullet (indent ≤ field indent) by clearing the
  // continuation state. Empty lines preserve continuation (markdown
  // paragraph breaks are inside the bullet).
  if (
    state.currentFieldAppend !== null &&
    state.currentFieldIndent !== null &&
    line.trim().length > 0
  ) {
    if (indent > state.currentFieldIndent) {
      // Preserve content but strip leading indent so the captured field
      // reads as natural prose. Use field-bullet's indent + 2 as the
      // "content-indent" floor; anything more indented is preserved
      // verbatim (so nested numbered lists keep their offset).
      const contentIndent = state.currentFieldIndent + 2;
      const trimmedLeft = line.replace(new RegExp(`^[ \\t]{0,${contentIndent}}`), "");
      state.currentFieldAppend(trimmedLeft);
    } else {
      // Indent dropped to ≤ the field's indent → this is a sibling
      // bullet or end of nested block. Close the continuation.
      state.currentFieldIndent = null;
      state.currentFieldAppend = null;
    }
  }
}
