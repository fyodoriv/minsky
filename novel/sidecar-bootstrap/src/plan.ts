// Bootstrap plan — pure decision over what filesystem actions the bootstrap
// command should take, given a host directory and an inferred or operator-
// supplied repo config. The plan is the contract between the planner and
// the executor (`bootstrap.ts`); tests assert against the plan shape, the
// executor blindly applies it.
//
// Pattern: command pattern (Gamma 1994 — encapsulate the actions as data
//   so they're inspectable, testable, and reversible) + pure-function +
//   I/O-at-the-edge (Martin 2017 — the planner is referentially
//   transparent over its inputs; the executor owns the I/O). The shape
//   mirrors the existing `setup.sh` ledger pattern (steps recorded as data).
// Source: rule #2 (vision.md § 2 — every external dep through an interface;
//   the host filesystem IS the dep, made explicit via this plan); rule #6
//   (vision.md § 6 — let-it-crash AT the boundary; the planner returns the
//   action list, the executor decides per-action error handling); rule #10
//   (vision.md § 10 — deterministic enforcement; same input → same plan).
// Conformance: full — the planner is a pure function over typed inputs.

import type { RepoConfig } from "./schema.js";

/**
 * One concrete action the executor performs. Each variant carries the
 * minimum data the executor needs.
 */
export type BootstrapAction =
  | {
      kind: "ensure-directory";
      path: string;
      reason: string;
    }
  | {
      kind: "write-file";
      path: string;
      content: string;
      reason: string;
    }
  | {
      kind: "create-symlink";
      target: string;
      linkPath: string;
      reason: string;
    }
  | {
      kind: "append-to-ignore";
      ignoreFile: string;
      entry: string;
      reason: string;
    }
  | {
      kind: "log-info";
      message: string;
    };

export interface BootstrapPlan {
  /** The host directory this plan targets (absolute path). */
  hostRoot: string;
  /** The actions, in order. Idempotent: running twice produces zero ops. */
  actions: BootstrapAction[];
}

/**
 * Inputs the planner needs to decide what to do. Read-only signals about
 * the host's current state.
 */
export interface PlanInputs {
  /** Absolute path to the host repo root. */
  hostRoot: string;
  /** The (inferred or operator-supplied) RepoConfig to write. */
  config: RepoConfig;
  /** Absolute path to the canonical minsky vision.md (symlink target). */
  visionMdPath: string;
  /** Absolute path to the operator's global git ignore file. */
  globalGitIgnorePath: string;
  /**
   * Already-present sidecar artefacts. The planner skips actions when the
   * artefact is already present (idempotency).
   */
  existing: {
    minskyDir: boolean;
    repoYaml: boolean;
    visionMdSymlink: boolean;
    experimentsDir: boolean;
    experimentsGitkeep: boolean;
    /** True if `.minsky/` is already listed in the global ignore file. */
    globalIgnoreEntry: boolean;
  };
}

/**
 * Pure function: build the action list for a bootstrap invocation. Skips
 * actions for already-present artefacts (idempotent re-runs are no-ops).
 *
 * @otel sidecar-bootstrap.plan-bootstrap
 */
export function planBootstrap(inputs: PlanInputs): BootstrapPlan {
  const { hostRoot, config, visionMdPath, globalGitIgnorePath, existing } = inputs;
  const actions: BootstrapAction[] = [];

  // Step 1: ensure `.minsky/` exists.
  if (!existing.minskyDir) {
    actions.push({
      kind: "ensure-directory",
      path: `${hostRoot}/.minsky`,
      reason: "sidecar root for cross-repo-runner; gitignored per rule #2",
    });
  }

  // Step 2: write `.minsky/repo.yaml`.
  if (!existing.repoYaml) {
    actions.push({
      kind: "write-file",
      path: `${hostRoot}/.minsky/repo.yaml`,
      content: renderRepoYaml(config),
      reason: "per-host overlay configuring runner conventions",
    });
  }

  // Step 3: ensure `.minsky/experiments/` exists.
  if (!existing.experimentsDir) {
    actions.push({
      kind: "ensure-directory",
      path: `${hostRoot}/.minsky/experiments`,
      reason: "rule-#9 substrate root for cross-repo invocations",
    });
  }
  if (!existing.experimentsGitkeep) {
    actions.push({
      kind: "write-file",
      path: `${hostRoot}/.minsky/experiments/.gitkeep`,
      content: "",
      reason: "preserve empty directory so git tools see it",
    });
  }

  // Step 4: symlink the canonical vision.md so cross-repo lints can read it.
  if (!existing.visionMdSymlink) {
    actions.push({
      kind: "create-symlink",
      target: visionMdPath,
      linkPath: `${hostRoot}/.minsky/vision.md`,
      reason: "rule-#5 / rule-#8 substrate; canonical constitution shared",
    });
  }

  // Step 5: register `.minsky/` in the global git ignore (decision A2).
  if (!existing.globalIgnoreEntry && config.ignore_mechanism === "global-ignore") {
    actions.push({
      kind: "append-to-ignore",
      ignoreFile: globalGitIgnorePath,
      entry: ".minsky/",
      reason: "decision A2 — sidecar invisible to host's git history",
    });
  }

  // Step 6: log the chosen ignore mechanism for operator audit.
  actions.push({
    kind: "log-info",
    message: `ignore_mechanism: ${config.ignore_mechanism}`,
  });

  return { hostRoot, actions };
}

/**
 * Render a RepoConfig to YAML. We hand-write the YAML rather than pull a
 * yaml dep (rule #1 — don't reinvent: this is the simplest viable shape,
 * and adding a yaml dep just for output is over-scope). The format is
 * conventional and round-trips through any standard YAML parser.
 *
 * @otel sidecar-bootstrap.render-repo-yaml
 */
export function renderRepoYaml(config: RepoConfig): string {
  const lines = [
    "# .minsky/repo.yaml — per-host overlay for the cross-repo-runner.",
    "# This file is gitignored from the host's git history (decision A2).",
    "# Edit values here to match your host repo's actual conventions.",
    "",
    `host_repo: ${quote(config.host_repo)}`,
    `tasks_md_path: ${quote(config.tasks_md_path)}`,
    `commit_format: ${quote(config.commit_format)}`,
    `pre_commit_command: ${quote(config.pre_commit_command)}`,
    `branch_prefix: ${quote(config.branch_prefix)}`,
    `default_branch: ${quote(config.default_branch)}`,
    `ticket_format: ${config.ticket_format === null ? "null" : quote(config.ticket_format)}`,
    `host_packages_path: ${quote(config.host_packages_path)}`,
    `ignore_mechanism: ${quote(config.ignore_mechanism)}`,
    "lint_substrate_overrides:",
  ];
  const overrides = Object.entries(config.lint_substrate_overrides);
  if (overrides.length === 0) {
    lines.push("  {}");
  } else {
    for (const [key, value] of overrides) {
      lines.push(`  ${key}: ${quote(value)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Quote a string for YAML output. Uses double quotes; escapes the bare
 * minimum (backslash, double-quote, and control characters via
 * `JSON.stringify`'s output). Empty strings are quoted as `""`.
 */
function quote(s: string): string {
  // JSON.stringify produces double-quoted output with proper escaping; YAML
  // accepts the same shape for plain scalars.
  return JSON.stringify(s);
}
