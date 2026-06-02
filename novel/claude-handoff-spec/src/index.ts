// Public surface of `@minsky/claude-handoff-spec`.
//
// <!-- scope: human-approved research-finding-manager-agent-delegation-pattern — barrel re-export for the delegation contract whose interface (delegation.ts) is the task's declared Touches; ships in the same commit as the interface. -->
//
// Pattern: barrel re-export (the package's single entry point). The package is
// types-only today — it carries the `DelegationContract` family that
// `multi-persona-pipeline-handoff-spec` (M2) implements. See
// `research/delegation-patterns-comparison.md` for the design rationale.

export type {
  DelegationBrief,
  DelegationContract,
  DelegationResult,
  DelegationShape,
  DelegationVerdict,
} from "./delegation.js";
