#!/usr/bin/env node
// @ts-check
// Canonical pre-PR lint stack — replicates the subset of `.github/workflows/ci.yml`'s
// `needs:` aggregator that is reproducible offline (no `gh` API, no PR body, no
// supervisor unit-files plumbing). Both the operator (`pnpm pre-pr-lint`) and the
// daemon's pre-PR gate (TASKS.md `daemon-pre-pr-lint-gate` slice 2/N) call this
// script — single source of truth so local + daemon + CI never drift apart.
//
// Stages:
//   --stage=fast (default): the daemon's gate. Closes ~80% of failure modes (per
//     TASKS.md `daemon-pre-pr-lint-gate` Pivot — biome / typecheck / markdownlint
//     / tasks-lint / rule-2 / rule-3 / rule-6 / rule-12). Target wall-clock ≤2 min
//     so it fits inside the daemon's iteration budget.
//   --stage=full: operator-side gate before pushing. Adds vitest, the diff-relative
//     lints (rule-1, rule-4, pattern-index), the experiment-record lints, and the
//     dormant config-cap lints. Excludes only the env-dependent CI jobs
//     (supervisor-integration, hygiene, maciek-smoke, rule-11, pr-self-grade,
//     cto-audit-pr-conventions) that need GitHub/PR context to evaluate.
//
// JSON output: `--json` emits one line per step plus a final summary. Tests use it.
//
// Pattern: deterministic gate (rule #10); pure manifest + injected runner (rule #2 —
//   the manifest is the seam, the runner is the boundary). Conformance: full —
//   `runStack` is a pure function over (manifest, runStep); the I/O lives in
//   `defaultRunStep` and is replaceable via DI for the paired tests.
// Source: TASKS.md `daemon-pre-pr-lint-gate`; vision.md rule #10 (deterministic
//   enforcement); Beck 1999 (CI as constraint enforcer); Forsgren-Humble-Kim 2018
//   (DORA — same gate humans pass through must gate the bot).

import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {"fast" | "full"} Stage
 */

/**
 * @typedef {object} StackStep
 * @property {string} name
 * @property {Stage[]} stages   stages this step participates in
 * @property {string} cmd
 * @property {string[]} args
 * @property {Record<string, string>} [env]   extra env merged into process.env
 */

/**
 * @typedef {object} StepResult
 * @property {string} name
 * @property {"pass" | "fail"} verdict
 * @property {number} durationMs
 * @property {number} exitCode
 * @property {string} [stderrTail]   last ~80 lines of stderr when failed
 */

/**
 * @typedef {object} StackResult
 * @property {Stage} stage
 * @property {StepResult[]} steps
 * @property {boolean} allPass
 */

/**
 * CI aggregator (`.github/workflows/ci.yml` § `ci:` `needs:`) jobs that the
 * manifest intentionally omits because they require GitHub-runner-only or
 * PR-context plumbing the daemon doesn't have. Each entry needs a one-line
 * reason — silent additions hide drift. Lifted to the canonical module (slice
 * 17/N) so the docs' env-dependent allowlist enumeration in
 * `docs/daemon-pre-pr-gate.md` and the CI-parity test in
 * `scripts/run-pre-pr-lint-stack.test.mjs` both pin against this single
 * source of truth — same shape as the manifest itself (rule #2).
 *
 * @type {ReadonlyMap<string, string>}
 */
export const CI_ENV_DEPENDENT_JOBS = Object.freeze(
  new Map([
    ["hygiene", "pnpm audit — needs network + advisory DB"],
    ["linux-supervisor-integration", "systemd user bus"],
    ["macos-supervisor-integration", "launchd user agent"],
    ["maciek-smoke", "pipx Python install"],
    ["pr-self-grade", "PR body context (`## Hypothesis self-grade`)"],
    ["pr-security-review", "PR body context (`## Security & privacy` or typed opt-out)"],
  ]),
);

/**
 * CI job names that diverge from their manifest step names. The aliases are
 * pinned here so the CI-parity test's set equality passes — any new alias is
 * a deliberate edit, never silent drift. Lifted to the canonical module
 * (slice 17/N) alongside `CI_ENV_DEPENDENT_JOBS` for the same reason.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CI_TO_MANIFEST_ALIAS = Object.freeze({
  test: "vitest", // `pnpm test:coverage` ↔ manifest's `vitest` step
  "glossary-discipline": "rule-5-glossary-discipline", // job named for the rule's effect; manifest names it for the rule number
});

/**
 * The `ci:` aggregator's bash `gate` step partitions `needs:` across three
 * buckets that treat job results differently:
 *
 *   - `mustSucceed` — `[ "$r" = "success" ] || fail=1`. Anything other than
 *     `success` (including `skipped`) fails the aggregator. Lint jobs that
 *     run on every event live here.
 *   - `supervisorSkippable` — `case "$r" in success|skipped) ;; *) fail=1 ;;`.
 *     Supervisor-integration jobs may legitimately exit 77 (skipped) when the
 *     runner's user-bus / launchd plumbing isn't usable; only `failure` /
 *     `cancelled` fails the gate.
 *   - `prOnlySkippable` — same `success|skipped` shape, but for jobs gated by
 *     `if: github.event_name == 'pull_request'` so they're `skipped` on push.
 *
 * Slice 15/N's bash-loop drift test pins set equality between `needs:` and
 * the union of these buckets, but does not pin which bucket each job belongs
 * to. A regression that moved `pr-self-grade` from `prOnlySkippable` to
 * `mustSucceed` would silently break every push to `main` (the job is
 * `skipped` on push); inversely, moving `biome` from `mustSucceed` to
 * `supervisorSkippable` would silently ungate the lint without tripping
 * slice 15's union check. Slice 21/N exposes the per-bucket assignment as a
 * canonical constant so the parity test can pin each bucket separately —
 * same shape as `CI_ENV_DEPENDENT_JOBS` (rule #2 — single seam, single pin).
 *
 * @type {Readonly<{
 *   mustSucceed: ReadonlySet<string>,
 *   supervisorSkippable: ReadonlySet<string>,
 *   prOnlySkippable: ReadonlySet<string>,
 * }>}
 */
export const CI_BASH_GATE_BUCKETS = Object.freeze({
  mustSucceed: Object.freeze(
    new Set([
      "anchor-primary-source",
      "biome",
      "cadence-pivot-threshold",
      "glossary-discipline",
      "hygiene",
      "lockfile-integrity",
      "maciek-smoke",
      "mape-k-budget-cap",
      "mape-k-constraints-md-size",
      "mape-k-tick-iteration-backstop",
      "mape-k-watchdog-cadence",
      "markdownlint",
      "measurement-inspects-output",
      "metric-freshness",
      "no-singleton-experiment",
      "otel-no-pii",
      "pivot-success-margin",
      "rule-1-novel-justification",
      "rule-2-dep-coverage",
      "rule-3-doc-first",
      "rule-4-otel-coverage",
      "rule-6-let-it-crash",
      "rule-7-chaos-coverage",
      "rule-12-scope-discipline",
      "sbom-shape",
      "secret-scan",
      "tasks-lint",
      "test",
      "tick-loop-backoff-schedule",
      "typecheck",
      "user-story-security-section",
    ]),
  ),
  supervisorSkippable: Object.freeze(
    new Set(["linux-supervisor-integration", "macos-supervisor-integration"]),
  ),
  prOnlySkippable: Object.freeze(
    new Set(["pr-self-grade", "pr-security-review", "pattern-index", "skill-rule-cap"]),
  ),
});

/**
 * The manifest. Order is informational — `runStack` may run steps in parallel
 * up to a small fan-out. New CI jobs that should gate locally get a row here;
 * env-dependent jobs (see `CI_ENV_DEPENDENT_JOBS` above) are intentionally
 * absent — they cannot evaluate against a local checkout without GitHub /
 * pipx / dbus plumbing the daemon doesn't have.
 *
 * @type {readonly StackStep[]}
 */
export const STACK_MANIFEST = Object.freeze([
  // ---- fast stage (≤2 min wall-clock target — the daemon's gate) ------------
  {
    name: "biome",
    stages: ["fast", "full"],
    cmd: "pnpm",
    args: ["biome", "ci", "."],
  },
  {
    name: "typecheck",
    stages: ["fast", "full"],
    cmd: "pnpm",
    args: ["typecheck"],
  },
  {
    name: "markdownlint",
    stages: ["fast", "full"],
    cmd: "pnpm",
    args: ["lint:md"],
  },
  {
    name: "tasks-lint",
    stages: ["fast", "full"],
    cmd: "npx",
    args: ["-y", "@tasks-md/lint@^0.7.0", "TASKS.md"],
  },
  {
    name: "rule-2-dep-coverage",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-rule-2-dep-coverage.mjs"],
  },
  {
    name: "rule-3-doc-first",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-rule-3-doc-first.mjs"],
    env: { RULE_3_DIFF_BASE: "origin/main" },
  },
  {
    name: "rule-6-let-it-crash",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-rule-6-let-it-crash.mjs"],
    env: { RULE_6_DIFF_BASE: "origin/main" },
  },
  {
    name: "rule-7-chaos-coverage",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-rule-7-chaos-coverage.mjs"],
  },
  {
    name: "rule-12-scope-discipline",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-rule-12-scope-discipline.mjs"],
    env: { RULE_12_DIFF_BASE: "origin/main" },
  },
  // ---- full stage ----------------------------------------------------------
  {
    name: "vitest",
    stages: ["full"],
    cmd: "pnpm",
    args: ["test"],
  },
  {
    name: "rule-1-novel-justification",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-rule-1-novel-justification.mjs", "--diff-base=origin/main"],
  },
  {
    name: "rule-4-otel-coverage",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-rule-4-otel-coverage.mjs", "--diff-base=origin/main"],
  },
  {
    name: "rule-5-glossary-discipline",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-rule-5-glossary-discipline.mjs"],
  },
  {
    name: "pattern-index",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-pattern-index.mjs", "--diff-base=origin/main"],
  },
  {
    name: "no-singleton-experiment",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-no-singleton-experiment.mjs"],
  },
  {
    name: "lockfile-integrity",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-lockfile-integrity.mjs"],
    env: { LOCKFILE_INTEGRITY_DIFF_BASE: "origin/main" },
  },
  {
    name: "otel-no-pii",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-otel-no-pii.mjs"],
  },
  {
    name: "secret-scan",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/scan-secrets.mjs"],
  },
  {
    name: "sbom-shape",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-sbom-shape.mjs"],
  },
  {
    name: "metric-freshness",
    stages: ["full"],
    cmd: "node",
    args: [
      "scripts/check-metric-freshness.mjs",
      "--expected",
      "loop-uptime,tokens-per-story,spec-alignment,self-improvement-velocity,mttr,wrist-dwell,extraction-count,dep-interface-coverage,token-budget-honoring,task-throughput",
    ],
  },
  {
    name: "mape-k-budget-cap",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-mape-k-budget-cap.mjs"],
  },
  {
    name: "mape-k-constraints-md-size",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-mape-k-constraints-md-size.mjs"],
  },
  {
    name: "mape-k-tick-iteration-backstop",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-mape-k-tick-iteration-backstop.mjs"],
  },
  {
    name: "mape-k-watchdog-cadence",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-mape-k-watchdog-cadence.mjs"],
  },
  {
    name: "tick-loop-backoff-schedule",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-tick-loop-backoff-schedule.mjs"],
  },
  {
    name: "cadence-pivot-threshold",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-cadence-pivot-threshold.mjs"],
  },
  {
    name: "pivot-success-margin",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-pivot-success-margin.mjs"],
  },
  {
    name: "anchor-primary-source",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-anchor-primary-source.mjs"],
  },
  {
    name: "measurement-inspects-output",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-measurement-inspects-output.mjs"],
  },
  {
    name: "skill-rule-cap",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-skill-rule-cap.mjs"],
  },
  {
    name: "user-story-security-section",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-user-story-security-section.mjs"],
  },
]);

/**
 * Filter the manifest to the steps that participate in `stage`.
 *
 * @param {Stage} stage
 * @param {readonly StackStep[]} [manifest]
 * @returns {readonly StackStep[]}
 */
export function selectSteps(stage, manifest = STACK_MANIFEST) {
  return manifest.filter((s) => s.stages.includes(stage));
}

/**
 * @callback RunStep
 * @param {StackStep} step
 * @returns {Promise<StepResult>}
 */

/**
 * Pure orchestration: run the chosen steps via the injected `runStep`. Steps
 * run sequentially by default — the daemon's spawn budget is finite and
 * parallel pnpm invocations contend on the same node_modules. Returns a
 * structured result. Tests inject a fake runner; production injects the
 * `defaultRunStep` below.
 *
 * @param {Stage} stage
 * @param {RunStep} runStep
 * @param {readonly StackStep[]} [manifest]
 * @returns {Promise<StackResult>}
 */
export async function runStack(stage, runStep, manifest = STACK_MANIFEST) {
  const steps = selectSteps(stage, manifest);
  /** @type {StepResult[]} */
  const results = [];
  for (const step of steps) {
    const r = await runStep(step);
    results.push(r);
  }
  return {
    stage,
    steps: results,
    allPass: results.every((r) => r.verdict === "pass"),
  };
}

/**
 * Names `git push` exports to its hooks (GIT_DIR points at the bare repo,
 * GIT_INDEX_FILE at a transient index, etc.). They poison children that
 * spawn their own `git` against a tmpdir fixture (e.g., the cross-repo-runner
 * integration tests bootstrap a host repo) — the inner `git` reuses the
 * outer GIT_DIR instead of inferring from cwd, and the test fails with
 * "host is not bootstrapped" / "not a git repository". The standalone
 * `pnpm pre-pr-lint` invocation has none of these set, so the gate passed
 * locally but failed under lefthook pre-push — exactly the "local lint stack
 * drift vs CI" risk the brief flags. Reference: git-scm.com/docs/githooks
 * § "pre-push" — the env-export contract.
 */
const GIT_HOOK_LEAKED_ENV_NAMES = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_REFLOG_ACTION",
  "GIT_INTERNAL_GETTEXT_SH_SCHEME",
]);

/**
 * Strip the names `git` exports to its hooks from a copy of the parent env.
 * Pure function so the test can exercise the filter without spawning git.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function stripGitHookEnv(env) {
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (GIT_HOOK_LEAKED_ENV_NAMES.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Default I/O boundary: shell out to the step. Captures stderr for the failure
 * tail. The cwd is fixed to REPO_ROOT so paths in the manifest are stable
 * regardless of where the script is invoked from. Strips the env names
 * `git push` exports to its hooks — without this, lefthook pre-push runs
 * the stack with GIT_DIR/GIT_WORK_TREE set, and tests that bootstrap their
 * own git repo in a tmpdir misroute to the parent repo's index and fail.
 *
 * @type {RunStep}
 */
export async function defaultRunStep(step) {
  const start = Date.now();
  return await new Promise((resolveP) => {
    execFile(
      step.cmd,
      step.args,
      {
        cwd: REPO_ROOT,
        env: { ...stripGitHookEnv(process.env), ...(step.env ?? {}) },
        // Big buffer — vitest output can be megabytes.
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, _stdout, stderr) => {
        resolveP(buildStepResult(step.name, err, stderr, Date.now() - start));
      },
    );
  });
}

/**
 * Pure transform: child-process callback args → StepResult. Extracted so the
 * defaultRunStep callback stays under the cognitive-complexity ceiling and so
 * the unit tests can exercise this branch logic without spawning processes.
 *
 * @param {string} name
 * @param {{ code?: number | string | null } | null} err
 * @param {string | Buffer | undefined} stderr
 * @param {number} durationMs
 * @returns {StepResult}
 */
export function buildStepResult(name, err, stderr, durationMs) {
  const rawCode = err === null ? 0 : err.code;
  const exitCode = typeof rawCode === "number" ? rawCode : err === null ? 0 : 1;
  if (exitCode === 0) {
    return { name, verdict: "pass", durationMs, exitCode };
  }
  return {
    name,
    verdict: "fail",
    durationMs,
    exitCode,
    stderrTail: tailLines(String(stderr ?? ""), 80),
  };
}

/**
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
function tailLines(s, n) {
  const lines = s.split("\n");
  return lines.slice(-n).join("\n");
}

// --------------------------------------------------------------- CLI -------

/**
 * @param {string[]} argv
 * @returns {{ stage: Stage, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {Stage} */
  let stage = "fast";
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    const m = /^--stage=(fast|full)$/.exec(arg);
    if (m !== null && m[1] !== undefined) {
      stage = /** @type {Stage} */ (m[1]);
    }
  }
  return { stage, json };
}

/**
 * @param {StackResult} result
 * @returns {string}
 */
function renderHuman(result) {
  const lines = [];
  lines.push(`pre-pr-lint-stack stage=${result.stage}`);
  for (const s of result.steps) {
    const mark = s.verdict === "pass" ? "ok" : "FAIL";
    lines.push(`  [${mark}] ${s.name}  (${s.durationMs} ms, exit=${s.exitCode})`);
    if (s.verdict === "fail" && s.stderrTail !== undefined) {
      lines.push("  --- stderr tail ---");
      for (const line of s.stderrTail.split("\n")) lines.push(`  ${line}`);
      lines.push("  -------------------");
    }
  }
  lines.push(result.allPass ? "all green" : "one or more steps failed");
  return lines.join("\n");
}

/**
 * @param {StackResult} result
 * @returns {string}
 */
function renderJson(result) {
  return JSON.stringify(result);
}

async function main() {
  const { stage, json } = parseArgs(process.argv.slice(2));
  const result = await runStack(stage, defaultRunStep);
  process.stdout.write(`${json ? renderJson(result) : renderHuman(result)}\n`);
  process.exit(result.allPass ? 0 : 1);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  await main();
}
