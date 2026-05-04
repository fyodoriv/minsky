// `@minsky/cross-repo-runner` — public surface.
//
// Pattern: thin barrel of pure functions. The CLI (bin/minsky-run.mjs) is
//   the I/O boundary and is intentionally not re-exported here.
// Source: user-stories/006-runner-on-any-repo.md.

export { loadRepoConfig, parseFlatYaml } from "./repo-config-loader.js";
export { findTask, parseTasksMd } from "./task-finder.js";
export type { ParsedTask, FindTaskResult } from "./task-finder.js";
export { synthesiseExperimentYaml } from "./experiment-synth.js";
export type { SynthResult } from "./experiment-synth.js";
export { buildSpawnPlan } from "./spawn-plan.js";
export type { RunnerPlan, SpawnPlanInputs } from "./spawn-plan.js";
export { renderIterationRecord } from "./iteration-record.js";
export type { IterationRecord, IterationVerdict } from "./iteration-record.js";
