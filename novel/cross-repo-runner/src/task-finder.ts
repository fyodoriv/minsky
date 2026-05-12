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
 * Returns `null` when no eligible task exists — the {@link runHostLoop}
 * caller uses this as the `empty-queue` stop signal.
 *
 * @otel cross-repo-runner.pick-host-task
 */
export function pickHostTask(tasksMdContent: string): ParsedTask | null {
  const tasks = parseTasksMd(tasksMdContent);
  const eligible = tasks.filter(isHostTaskEligible);
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
  };
}

interface ParserState {
  tasks: ParsedTask[];
  currentPriority: string;
  currentTask: PartialParsedTask | null;
}

function processTaskLine(line: string, state: ParserState): void {
  const priorityMatch = line.match(/^##\s+(P\d)\b/);
  if (priorityMatch?.[1] !== undefined) {
    flushTask(state.currentTask, state.tasks);
    state.currentPriority = priorityMatch[1];
    state.currentTask = null;
    return;
  }
  const checkboxMatch = line.match(/^-\s+\[\s*[ x]\s*\]\s+(.*)$/);
  if (checkboxMatch?.[1] !== undefined) {
    flushTask(state.currentTask, state.tasks);
    state.currentTask = startTask(checkboxMatch[1].trim(), state.currentPriority);
    return;
  }
  if (state.currentTask !== null) {
    assignMetadata(state.currentTask, line);
  }
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
  const state: ParserState = { tasks: [], currentPriority: "", currentTask: null };
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
  };
}

function assignMetadata(task: PartialParsedTask, line: string): void {
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
  const stripped = line.trim().replace(/^[-*]\s+/, "");
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
      },
    ],
    [
      /^\*\*Hypothesis\*\*:\s*(.+)$/,
      (val) => {
        task.hypothesis = val.trim();
      },
    ],
    [
      /^\*\*Success\*\*:\s*(.+)$/,
      (val) => {
        task.success = val.trim();
      },
    ],
    [
      /^\*\*Pivot\*\*:\s*(.+)$/,
      (val) => {
        task.pivot = val.trim();
      },
    ],
    [
      /^\*\*Measurement\*\*:\s*(.+)$/,
      (val) => {
        task.measurement = val.trim();
      },
    ],
    [
      /^\*\*Anchor\*\*:\s*(.+)$/,
      (val) => {
        task.anchor = val.trim();
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
}
