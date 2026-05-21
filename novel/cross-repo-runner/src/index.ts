// `@minsky/cross-repo-runner` — public surface.
//
// Pattern: thin barrel of pure functions. The CLI (bin/minsky-run.mjs) is
//   the I/O boundary and is intentionally not re-exported here.
// Source: user-stories/006-runner-on-any-repo.md.

export { loadRepoConfig, parseFlatYaml } from "./repo-config-loader.js";
export { findTask, isHostTaskEligible, parseTasksMd, pickHostTask } from "./task-finder.js";
export type { ParsedTask, FindTaskResult } from "./task-finder.js";
export { synthesiseExperimentYaml } from "./experiment-synth.js";
export type { SynthResult } from "./experiment-synth.js";
export { parseMinskyProcs, scanMinskyProcesses } from "./scan-processes.js";
export type { MinskyProc, ProcScanProbe } from "./scan-processes.js";
export { buildSpawnPlan } from "./spawn-plan.js";
export type { RunnerPlan, SpawnPlanInputs } from "./spawn-plan.js";
export { renderIterationRecord } from "./iteration-record.js";
export type { IterationRecord, IterationVerdict } from "./iteration-record.js";
export {
  DEFAULT_MINSKY_DISPATCH_REPO,
  DISPATCH_EVENT_TYPE,
  buildDispatchPayload,
} from "./dispatch-emit.js";
export type { DispatchPayload } from "./dispatch-emit.js";
export {
  extractAllowedPathsFromTaskBlock,
  extractPrUrl,
  runLive,
} from "./runner.js";
export type {
  GitLike,
  LiveSpawnOutcome,
  LiveSpawnVerdict,
  RunLiveInputs,
  SpawnLike,
} from "./runner.js";
export { runHostLoop } from "./host-loop.js";
export type {
  LoopIterationResult,
  LoopResult,
  LoopStopReason,
  PickTaskArgs,
  RunHostLoopOpts,
} from "./host-loop.js";
export {
  HOST_CTO_AUDIT_PR_LABEL,
  HOST_CTO_PROMPT_HEADER,
  buildHostCtoBrief,
  runHostCtoAudit,
  shouldRunHostCtoAudit,
} from "./host-cto-audit.js";
export type {
  HostCtoAuditOutcome,
  HostCtoSignals,
  HostCtoTriggerReason,
  RunHostCtoAuditInputs,
} from "./host-cto-audit.js";
export {
  detectAnyCwd,
  detectCwd,
  findBootstrappedSubdirs,
  findGitRootSubdirs,
} from "./cwd-detect.js";
export type { CwdDetectInputs, CwdDetectResult, CwdFsProbe } from "./cwd-detect.js";
export { walkHostsDir } from "./host-walker.js";
export type {
  HostVisitResult,
  WalkerResult,
  WalkerStopReason,
  WalkHostsDirInputs,
} from "./host-walker.js";
export { resolveMinskyRepo } from "./shim-resolve.js";
export type { ResolveResult, ResolveSource, ShimResolveInputs } from "./shim-resolve.js";
export { assertWriteAllowed, classifyRepo, isTaskmdOnlyDiff } from "./repo-policy.js";
export type {
  ClassifyRepoInputs,
  RepoClass,
  WriteAction,
  WriteRefusalCode,
  WriteRequest,
  WriteVerdict,
} from "./repo-policy.js";
export { resolveGhHost } from "./gh-host-resolve.js";
export type { GhHostSource, ResolveGhHostInput, ResolveGhHostResult } from "./gh-host-resolve.js";
