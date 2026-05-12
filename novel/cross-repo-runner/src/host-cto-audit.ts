// Host-mode CTO audit — the cross-repo equivalent of
// `@minsky/tick-loop`'s `post-task-cto-audit.ts`. After a successful
// host iteration (or when the queue is empty), a second `claude --print`
// invocation reviews the host's state and proposes 1–3 rule-#9-compliant
// task blocks for the host's TASKS.md. The audit closes the *generation*
// surface of user-story-006: when the queue drains, the daemon doesn't
// stop — it asks the LLM what to work on next.
//
// Pattern: MAPE-K Plan phase (Kephart & Chess, *IEEE Computer* 2003 —
//   the CTO audit IS the Plan phase of cross-repo work; runLive is
//   Execute; the audit identifies new work items the Execute phase will
//   ship) + Theory of Constraints (Goldratt 1984 — the audit identifies
//   the next constraint to lift). Source: TASKS.md
//   `cross-repo-cto-audit-host-mode`; rule #1 (don't reinvent — same
//   prompt template + gate shape as `@minsky/tick-loop`'s CTO audit,
//   parameterised by host).
// Conformance: full — `buildHostCtoBrief` + `shouldRunHostCtoAudit` are
//   pure functions; the orchestrator wraps the injected `SpawnLike`.

import type { SpawnLike } from "./runner.js";

/**
 * Pre-registered PR label. The host operator queries
 * `gh pr list --label ${HOST_CTO_AUDIT_PR_LABEL}` to count audit-PRs
 * against the rolling 60d ship-rate metric in this task's pivot.
 * Mirrors the minsky-on-itself label convention so the operator's
 * dashboards stay consistent across surfaces.
 */
export const HOST_CTO_AUDIT_PR_LABEL = "minsky:cto-audit";

/**
 * CTO-mode prompt header. Data, not code — tested via paired tests so
 * brief drift is caught by `grep -q` lint, not a future operator-side
 * surprise. Adapted from `@minsky/tick-loop`'s `CTO_PROMPT_HEADER` with
 * host-mode parameterisation (the host's `host_repo` + `tasks_md_path`
 * replace minsky's hard-coded TASKS.md path).
 */
export const HOST_CTO_PROMPT_HEADER = [
  "You are reviewing what just shipped in a HOST REPO from a CTO perspective.",
  "",
  "Goal: find the single highest-leverage next task FOR THE HOST.",
  "",
  "Bias toward:",
  "  (1) automation that removes operator babysitting on the host;",
  "  (2) instrumentation gaps in the host that mask drift;",
  "  (3) duplicated patterns in the host that should become a primitive;",
  "  (4) failure classes in the host likely to recur.",
  "",
  "Output: 1-3 task blocks with full rule-#9 substrate, written directly into",
  "the host's TASKS.md at:",
  "  - P0 if the leverage is mechanical (CI lint, automation);",
  "  - P1 if it's a feature;",
  "  - P2 if it's docs/polish.",
  "",
  "Rule-#9 substrate MUST include for each task:",
  "  - **ID**: kebab-case-task-id",
  "  - **Hypothesis**: what changes if this ships, framed as a falsifiable claim",
  "  - **Success**: numeric or rubric threshold for when the experiment succeeds",
  "  - **Pivot**: numeric threshold below which the approach is abandoned",
  "  - **Measurement**: exact runnable shell command that produces the success/pivot value",
  "  - **Anchor**: literature citation (book / paper / RFC), NOT a blog post or wiki",
  "",
  "Refuse to file vanity-metric tasks (Ries 2011 — counts that always go up:",
  "LOC, commits, hours, tasks-in-flight). The metric must be falsifiable.",
  "",
  "If no high-leverage task is visible for this host, say so explicitly — DO NOT",
  "fabricate work. An empty audit (no PR opened, stdout `no high-leverage task`)",
  "is a valid outcome the operator can act on.",
  "",
  "## Branch + PR conventions (load-bearing for the audit's pre-registered metric)",
  "",
  "Open the PR on a branch named `audit/<UTC-date>-cross-repo-seed` (or",
  "`audit/<UTC-date>-<completed-task-id>` after a post-iteration audit).",
  "",
  `Label the PR \`${HOST_CTO_AUDIT_PR_LABEL}\`. The pre-registered measurement`,
  `command (\`gh pr list --label ${HOST_CTO_AUDIT_PR_LABEL} ...\`) queries this`,
  "exact label; missing label silently zeroes the success metric.",
  "",
  "If the label does not yet exist on the host repository, create it first:",
  "",
  "```",
  `gh label list --search ${HOST_CTO_AUDIT_PR_LABEL} --json name --jq '.[].name' \\`,
  `  | grep -qx ${HOST_CTO_AUDIT_PR_LABEL} \\`,
  `  || gh label create ${HOST_CTO_AUDIT_PR_LABEL} \\`,
  `       --description 'Filed by minsky cross-repo CTO audit' --color 0e8a16`,
  "```",
  "",
  "Then add the label at PR-create time (`gh pr create --label",
  `${HOST_CTO_AUDIT_PR_LABEL} ...\`) so the metric sees it from open, not`,
  "retroactively.",
  "",
].join("\n");

/**
 * Reason the audit was triggered. Two shapes:
 *
 *   - `post-iteration`  — a host iteration just completed with `validated`
 *                         verdict; ask for follow-up tasks that compound
 *                         on what just shipped.
 *   - `queue-empty`     — the host's TASKS.md has no rule-#9-compliant
 *                         P0/P1 tasks; ask for seed tasks so the loop
 *                         can continue.
 */
export type HostCtoTriggerReason = "post-iteration" | "queue-empty";

/**
 * Signals the brief renders. Mirrors `@minsky/tick-loop`'s
 * `CompletedIterationSignals` shape but host-rooted; the `completedTaskId`
 * is null in the `queue-empty` case.
 */
export interface HostCtoSignals {
  /** Host repo identifier (owner/repo). */
  readonly hostRepo: string;
  /** Absolute path to the host repo root. */
  readonly hostRoot: string;
  /** Relative path to the host's TASKS.md (from `repo.yaml.tasks_md_path`). */
  readonly tasksMdPath: string;
  /** Trigger context (post-iteration vs queue-empty). */
  readonly reason: HostCtoTriggerReason;
  /** The just-shipped task ID (null for `queue-empty`). */
  readonly completedTaskId: string | null;
  /** PR URL from the just-shipped iteration (null for `queue-empty` or no-PR). */
  readonly prUrl: string | null;
  /** Files the just-shipped iteration changed (empty for `queue-empty`). */
  readonly filesChanged: readonly string[];
  /** UTC-date prefix for the audit branch name. */
  readonly utcDate: string;
}

/**
 * Build the CTO-audit brief from host signals. Pure function — the
 * orchestrator hands the result to the injected `SpawnLike`.
 *
 * @otel cross-repo-runner.host-cto-audit.build-brief
 */
export function buildHostCtoBrief(signals: HostCtoSignals): string {
  const filesSection =
    signals.filesChanged.length === 0
      ? "Files changed: (none — first audit OR queue-empty seed run)"
      : `Files changed (${signals.filesChanged.length}):\n${signals.filesChanged.map((f) => `  - ${f}`).join("\n")}`;
  const reasonHeader =
    signals.reason === "post-iteration"
      ? `## Just-completed iteration on ${signals.hostRepo}`
      : `## Queue-empty seed audit for ${signals.hostRepo}`;
  return [
    HOST_CTO_PROMPT_HEADER,
    reasonHeader,
    "",
    `Host repo: ${signals.hostRepo}`,
    `Host root: ${signals.hostRoot}`,
    `Host TASKS.md: ${signals.tasksMdPath}`,
    signals.completedTaskId === null
      ? "Completed task: (none — this is a seed audit; the queue had no rule-#9-compliant P0/P1 tasks)"
      : `Completed task: \`${signals.completedTaskId}\``,
    `PR: ${signals.prUrl ?? "(no PR opened)"}`,
    "",
    filesSection,
    "",
    `Audit branch: \`audit/${signals.utcDate}-${signals.reason === "post-iteration" ? (signals.completedTaskId ?? "post-iteration") : "cross-repo-seed"}\``,
    `Audit PR label: \`${HOST_CTO_AUDIT_PR_LABEL}\``,
    "",
    "## Your task now",
    "",
    signals.reason === "post-iteration"
      ? "Identify the single highest-leverage next task for this host that compounds on what just shipped. File it as a TASKS.md block on the host with the right priority and full rule-#9 substrate."
      : "The host's queue has no eligible work. Seed it with 1-3 rule-#9-compliant task blocks that the cross-repo daemon can ship next. Focus on the user-story-006 framing — what would the host operator most want a continuous agent loop to work on?",
    "",
    "If you cannot identify a high-leverage task, output `no high-leverage task` to stdout and exit without opening a PR. An empty audit is a valid outcome.",
  ].join("\n");
}

/**
 * Gate predicate: should the audit fire for this trigger context?
 * Skips no-op verdicts, scope-leak / spawn-failed iterations, and the
 * audit's own audit (recursion guard). Returns `{fire: boolean, reason}`
 * so the caller can record the skip reason in the iteration record.
 *
 * @otel-exempt pure decision function — `runHostCtoAudit` carries the
 *   audit-execution span; this is the gate.
 */
export function shouldRunHostCtoAudit(args: {
  readonly reason: HostCtoTriggerReason;
  readonly completedVerdict: "validated" | "scope-leak" | "spawn-failed" | null;
  readonly completedTaskId: string | null;
  readonly env: Readonly<Record<string, string | undefined>>;
}): { readonly fire: boolean; readonly reason: string } {
  const envReject = checkEnvOverride(args.env);
  if (envReject !== null) return envReject;
  const recurseReject = checkRecursionGuard(args.completedTaskId);
  if (recurseReject !== null) return recurseReject;
  if (args.reason === "post-iteration") {
    const postReject = checkPostIterationFilters(args.completedVerdict, args.completedTaskId);
    if (postReject !== null) return postReject;
  }
  return { fire: true, reason: args.reason };
}

function checkEnvOverride(
  env: Readonly<Record<string, string | undefined>>,
): { fire: false; reason: string } | null {
  if (env["MINSKY_HOST_CTO_AUDIT"] === "off") {
    return { fire: false, reason: "env-override:MINSKY_HOST_CTO_AUDIT=off" };
  }
  return null;
}

/**
 * Recursion guard: the audit's own iteration MUST NOT trigger another
 * audit. Convention is that audit task IDs start with `cross-repo-cto-`
 * or `cto-audit-`; we treat both as the recursion barrier.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function checkRecursionGuard(
  completedTaskId: string | null,
): { fire: false; reason: string } | null {
  if (completedTaskId === null) return null;
  if (completedTaskId.startsWith("cross-repo-cto-") || completedTaskId.startsWith("cto-audit-")) {
    return { fire: false, reason: "no-recurse:audit-task-completed" };
  }
  return null;
}

/**
 * Post-iteration-specific filters: skip on failure verdicts + skip when
 * the iteration didn't actually complete a task.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function checkPostIterationFilters(
  verdict: "validated" | "scope-leak" | "spawn-failed" | null,
  completedTaskId: string | null,
): { fire: false; reason: string } | null {
  if (verdict === "scope-leak") return { fire: false, reason: "skip-on-failure:scope-leak" };
  if (verdict === "spawn-failed") return { fire: false, reason: "skip-on-failure:spawn-failed" };
  if (verdict !== "validated") return { fire: false, reason: "skip-no-iteration-completed" };
  if (completedTaskId === null) return { fire: false, reason: "skip-no-task-id" };
  return null;
}

/**
 * Audit outcome shape recorded in the iteration store.
 *
 *   - `ran`     — spawn fired; `exitCode` + `durationMs` populated.
 *   - `skipped` — gate rejected; `reason` carries the gate's decision.
 */
export type HostCtoAuditOutcome =
  | {
      readonly outcome: "ran";
      readonly exitCode: number;
      readonly durationMs: number;
      readonly stdoutTail: string;
      readonly stderrTail: string;
    }
  | {
      readonly outcome: "skipped";
      readonly reason: string;
    };

/**
 * Inputs to {@link runHostCtoAudit}.
 */
export interface RunHostCtoAuditInputs {
  /** Pre-built signals describing the trigger context. */
  readonly signals: HostCtoSignals;
  /** Spawn seam — production wires `ProcessSpawnStrategy({command:"claude"})`. */
  readonly spawn: SpawnLike;
  /** Env for the gate predicate. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The just-shipped iteration's verdict (null for queue-empty triggers). */
  readonly completedVerdict: "validated" | "scope-leak" | "spawn-failed" | null;
}

/**
 * Run the host-mode CTO audit. Pure orchestration:
 *   1. Gate via `shouldRunHostCtoAudit` — skip-reason recorded if no.
 *   2. Build the brief via `buildHostCtoBrief`.
 *   3. Spawn the injected `SpawnLike` (production: `ProcessSpawnStrategy`).
 *   4. Return the structured outcome the loop records.
 *
 * Never catches mid-spawn; throws propagate per rule #6 let-it-crash.
 *
 * @otel cross-repo-runner.host-cto-audit.run
 */
export async function runHostCtoAudit(inputs: RunHostCtoAuditInputs): Promise<HostCtoAuditOutcome> {
  const gate = shouldRunHostCtoAudit({
    reason: inputs.signals.reason,
    completedVerdict: inputs.completedVerdict,
    completedTaskId: inputs.signals.completedTaskId,
    env: inputs.env,
  });
  if (!gate.fire) return { outcome: "skipped", reason: gate.reason };
  const brief = buildHostCtoBrief(inputs.signals);
  const result = await inputs.spawn.spawn({
    taskId: `host-cto-audit-${inputs.signals.utcDate}`,
    brief,
    env: process.env,
  });
  return {
    outcome: "ran",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
  };
}
