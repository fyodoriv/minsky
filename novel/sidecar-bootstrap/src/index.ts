// `@minsky/sidecar-bootstrap` — public surface.
//
// Pattern: thin barrel of pure functions for the planner/inferer/diagnoser/
//   schema. The CLI (bin/minsky-bootstrap.mjs) is the I/O boundary and is
//   intentionally not re-exported here.
// Source: user-stories/006-runner-on-any-repo.md.

export { parseRepoConfig } from "./schema.js";
export type { RepoConfig, ParseRepoConfigResult, ParseError } from "./schema.js";
export { inferRepoConfig, NO_HOST_SIGNALS } from "./inference.js";
export type { HostSignals } from "./inference.js";
export { planBootstrap, renderRepoYaml } from "./plan.js";
export type { BootstrapPlan, BootstrapAction, PlanInputs } from "./plan.js";
export { diagnose } from "./doctor.js";
export type { DoctorReport, DoctorReportRow, DoctorStatus, DoctorSignals } from "./doctor.js";
