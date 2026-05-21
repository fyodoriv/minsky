// Experiment synthesiser — given a parsed task with rule-#9 fields, render
// the EXPERIMENT.yaml the host's `.minsky/experiments/<id>.yaml` will hold.
//
// Pattern: pure function over typed inputs (Martin 2017). Source: rule #9
//   (vision.md § 9 — pre-registered hypothesis-driven development; iron rule);
//   user-stories/006-runner-on-any-repo.md § "Acceptance criteria" — runner
//   "synthesises an EXPERIMENT.yaml at the host repo root from the task's
//   Hypothesis / Pivot / Measurement / Anchor fields (failing loudly if any
//   are missing — rule #9 is iron)".
// Conformance: full — pure function; CLI is the I/O boundary.

import type { ParsedTask } from "./task-finder.js";

export type SynthResult =
  | { ok: true; yaml: string; experimentId: string }
  | { ok: false; missingFields: string[] };

/**
 * Pure function: render a `ParsedTask` to YAML matching the
 * `@minsky/experiment-record` schema.
 *
 * Fails loudly (returns `{ ok: false, missingFields }`) if any of the 5
 * rule-#9 required fields (hypothesis / success / pivot / measurement /
 * anchor) is null on the task. Rule #9 is iron — no exemption.
 *
 * Optional `hostRepo` is emitted as a YAML field when present (rule #4
 * — everything measurable, everything visible: an operator reading
 * `.minsky/experiments/<id>.yaml` should know which host the experiment
 * targets without having to cross-reference `.minsky/repo.yaml`).
 *
 * @otel cross-repo-runner.synthesise-experiment-yaml
 */
export function synthesiseExperimentYaml(
  task: ParsedTask,
  opts?: { hostRepo?: string },
): SynthResult {
  const missingFields: string[] = [];
  if (task.hypothesis === null) missingFields.push("Hypothesis");
  if (task.success === null) missingFields.push("Success");
  if (task.pivot === null) missingFields.push("Pivot");
  if (task.measurement === null) missingFields.push("Measurement");
  if (task.anchor === null) missingFields.push("Anchor");
  if (missingFields.length > 0) return { ok: false, missingFields };

  const experimentId = task.id;
  const yaml = renderExperimentYaml({
    id: experimentId,
    hostRepo: opts?.hostRepo,
    hypothesis: task.hypothesis as string,
    success: task.success as string,
    pivot: task.pivot as string,
    measurement: task.measurement as string,
    anchor: task.anchor as string,
  });
  return { ok: true, yaml, experimentId };
}

/**
 * Pure render: produce the YAML string. Hand-rendered for the same reason
 * as `@minsky/sidecar-bootstrap` — no yaml dep needed for this shape (rule
 * #1: don't reinvent, but also don't pull a dep for 7 lines of text).
 */
function renderExperimentYaml(record: {
  id: string;
  hostRepo: string | undefined;
  hypothesis: string;
  success: string;
  pivot: string;
  measurement: string;
  anchor: string;
}): string {
  const lines: string[] = [`id: ${record.id}`];
  if (record.hostRepo !== undefined && record.hostRepo.length > 0) {
    lines.push(`host_repo: ${quote(record.hostRepo)}`);
  }
  lines.push(
    "hypothesis: |",
    indent(record.hypothesis, "  "),
    `success: ${quote(record.success)}`,
    `pivot: ${quote(record.pivot)}`,
    `measurement: ${quote(record.measurement)}`,
    "anchor: |",
    indent(record.anchor, "  "),
    "",
  );
  return lines.join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function quote(s: string): string {
  return JSON.stringify(s);
}
