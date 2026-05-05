// Dispatch-emit — pure function returning the `gh api …/dispatches` argv
// array the runner would invoke after opening a cross-repo PR. The argv is
// the contract; the live `gh` invocation is the operator-driven harness's
// job (out of scope for v0 — see TASKS.md `cross-repo-ci-action` brief).
//
// Pattern: command pattern (Gamma 1994 — actions inspectable as data) +
//   pure-function-with-I/O-at-edge (Martin 2017 — the planner returns the
//   plan, the live harness executes it).
// Source: TASKS.md `cross-repo-ci-action` decision C2 (minsky-side Action
//   posts check-runs via the GitHub API; the runner emits a
//   `repository_dispatch` to wake that workflow); rule #2 (vision.md § 2 —
//   every external dep behind an interface; here the "external dep" is the
//   `gh` CLI, made explicit by returning the argv rather than calling it).
// Conformance: full — pure function over typed inputs.

export interface DispatchPayload {
  /** `owner/name` of the host repo whose PR triggers the check. */
  hostRepo: string;
  /** PR number on the host repo. */
  prNumber: number;
  /**
   * GitHub-API URL pointing at the EXPERIMENT.yaml on the host PR's branch.
   * Example: https://api.github.com/repos/owner/name/contents/.minsky/experiments/foo.yaml?ref=<sha>
   */
  experimentYamlUrl: string;
  /**
   * Owner/name of the minsky repo that hosts the workflow. Defaults to
   * `fyodoriv/minsky` per the C2 decision; left injectable so a fork can
   * point dispatches at its own workflow without editing this code.
   */
  minskyRepo?: string;
}

const DEFAULT_MINSKY_REPO = "fyodoriv/minsky";
const EVENT_TYPE = "cross-repo-pr";

/**
 * Build the argv array for `gh api …/dispatches` that wakes the minsky-side
 * `cross-repo-check.yml` workflow with the host PR's coordinates.
 *
 * Throws on invalid inputs (empty host repo, non-positive PR number, etc.) —
 * the harness is supposed to validate before calling, but defence-in-depth
 * keeps a malformed dispatch from being emitted at the system boundary.
 *
 * @otel cross-repo-runner.build-dispatch-payload
 */
export function buildDispatchPayload(input: DispatchPayload): string[] {
  const minskyRepo = input.minskyRepo ?? DEFAULT_MINSKY_REPO;
  validate(input, minskyRepo);
  return [
    "api",
    `repos/${minskyRepo}/dispatches`,
    "-f",
    `event_type=${EVENT_TYPE}`,
    "-f",
    `client_payload[host_repo]=${input.hostRepo}`,
    "-f",
    `client_payload[pr_number]=${input.prNumber}`,
    "-f",
    `client_payload[experiment_yaml_url]=${input.experimentYamlUrl}`,
  ];
}

function validate(input: DispatchPayload, minskyRepo: string): void {
  if (!/^[^/\s]+\/[^/\s]+$/.test(input.hostRepo)) {
    throw new Error(`hostRepo must be owner/name; got ${JSON.stringify(input.hostRepo)}`);
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(minskyRepo)) {
    throw new Error(`minskyRepo must be owner/name; got ${JSON.stringify(minskyRepo)}`);
  }
  if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) {
    throw new Error(`prNumber must be a positive integer; got ${input.prNumber}`);
  }
  if (typeof input.experimentYamlUrl !== "string" || input.experimentYamlUrl.trim() === "") {
    throw new Error("experimentYamlUrl must be a non-empty string");
  }
  if (!/^https?:\/\//.test(input.experimentYamlUrl)) {
    throw new Error(
      `experimentYamlUrl must be an http(s) URL; got ${JSON.stringify(input.experimentYamlUrl)}`,
    );
  }
}

export const DISPATCH_EVENT_TYPE = EVENT_TYPE;
export const DEFAULT_MINSKY_DISPATCH_REPO = DEFAULT_MINSKY_REPO;
