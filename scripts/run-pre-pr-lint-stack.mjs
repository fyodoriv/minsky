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
// Body-only checks: `--body=<path>` appends the two PR-body lints
// (`pr-self-grade`, `pr-security-review`) to the run, validating the
// daemon-written draft body file in the same gate as everything else. The
// two checks are env-dependent in CI (they read the GitHub PR body); the
// `--body` flag is the daemon-side equivalent — same scripts, same
// regexes, just sourced from a local file. One command, one retry budget.
//
// Pattern: deterministic gate (rule #10); pure manifest + injected runner (rule #2 —
//   the manifest is the seam, the runner is the boundary). Conformance: full —
//   `runStack` is a pure function over (manifest, runStep); the I/O lives in
//   `defaultRunStep` and is replaceable via DI for the paired tests.
// Source: TASKS.md `daemon-pre-pr-lint-gate`; vision.md rule #10 (deterministic
//   enforcement); Beck 1999 (CI as constraint enforcer); Forsgren-Humble-Kim 2018
//   (DORA — same gate humans pass through must gate the bot).

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Resolve the canonical "main" reference the diff-relative checks (rule-3,
 * rule-6, rule-12, lockfile-integrity, rule-1, rule-4, pattern-index,
 * cloud-audit-gate) compare HEAD against. CI explicitly sets
 * `RULE_*_DIFF_BASE=origin/main` because that's the only main-tracking ref the
 * Github-Actions checkout populates. In a daemon worktree, `origin/main` may be
 * stale (the worktree's `origin` may point at a placeholder remote that's
 * never re-fetched), AND local `main` may also be stale (the worktree pulls
 * from `upstream`, not `main`); CI's `origin/main` then disagrees with the
 * lint stack about which commits constitute "this branch's diff". This is the
 * "passes locally / fails CI" footgun (and its inverse, "fails locally /
 * passes CI") that `daemon-pre-pr-lint-gate` was filed to close. Concrete
 * evidence: PR #329 (slice 30/N) passed `pnpm pre-pr-lint` locally with stale
 * `origin/main` and failed `rule-3-doc-first` on CI; on the rebase, the
 * inverse fired (stale local `main` produced spurious local rule-3 failures
 * for already-merged commits).
 *
 * Resolution: among the resolvable candidates (`main`, `origin/main`,
 * `upstream/main`), pick the one with the latest committer-date. This closes
 * BOTH directions of the footgun — whichever ref is freshest wins, regardless
 * of whether `origin` or `main` is the stale one.
 *
 * Order of preference (only matters when timestamps tie):
 *   1. `PRE_PR_LINT_DIFF_BASE` env override (escape hatch — explicit beats
 *      heuristic).
 *   2. Freshest of `[upstream/main, origin/main, main]` by committer-date.
 *   3. Hard fallback `origin/main` (preserves prior behaviour when no
 *      candidate resolves — e.g. minimal CI checkouts).
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   refExists?: (ref: string) => boolean,
 *   refTimestamp?: (ref: string) => number,
 * }} [opts]
 * @returns {string}
 */
export function resolveDiffBase(opts = {}) {
  const env = opts.env ?? process.env;
  const refExists = opts.refExists ?? defaultRefExists;
  const refTimestamp = opts.refTimestamp ?? defaultRefTimestamp;
  const override = env["PRE_PR_LINT_DIFF_BASE"];
  if (override !== undefined && override.length > 0) return override;
  const resolvable = ["upstream/main", "origin/main", "main"].filter((r) => refExists(r));
  if (resolvable.length === 0) return "origin/main";
  return resolvable.reduce((best, ref) => (refTimestamp(ref) > refTimestamp(best) ? ref : best));
}

/**
 * @param {string} ref
 * @returns {boolean}
 */
function defaultRefExists(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
    // rule-6: handled-locally — `git rev-parse` exits non-zero on missing
    // refs, which Node surfaces as a thrown Error. That's the I/O boundary,
    // not a programming bug — we want a boolean.
  } catch {
    return false;
  }
}

/**
 * @param {string} ref
 * @returns {number} committer-date Unix timestamp, or 0 if the ref is missing.
 */
function defaultRefTimestamp(ref) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct", ref], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const n = Number.parseInt(out.toString().trim(), 10);
    return Number.isFinite(n) ? n : 0;
    // rule-6: handled-locally — missing ref or non-numeric output should not
    // crash the gate; treat as "no timestamp", which puts this ref at the
    // bottom of the freshness ordering.
  } catch {
    return 0;
  }
}

/**
 * @typedef {"stop-gate" | "fast" | "full"} Stage
 *
 * Stages are nested supersets:
 *   stop-gate ⊂ fast ⊂ full
 *
 * - **stop-gate** — the Claude Code Stop-hook subset. Target wall-clock ≤2s
 *   warm cache. Cheap file-format + tasks-md + agents-md-coherence checks
 *   only. NO typecheck, NO vitest, NO diff-context lints (which require
 *   `git diff origin/main...HEAD` and can be slow / unreliable in agent
 *   sessions). Wired into `.claude/hooks/stop-gate.sh`.
 * - **fast** — the daemon pre-PR gate + pre-push lefthook. ~7s. Adds the
 *   diff-relative rule checks (rule-2, rule-3, rule-6, rule-12, rule-17).
 *   Closes ~80% of failure modes (per `daemon-pre-pr-lint-gate` Pivot).
 * - **full** — the operator-side gate before pushing + CI's `--stage=full`
 *   matrix expansion. ~35s+. Adds vitest, knip, supervisor-integration,
 *   and the dormant config-cap lints.
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
    ["pr-vision-trace", "PR body context (`## Vision trace` block)"],
    [
      "fresh-clone-smoke",
      "destroys `novel/tick-loop/dist/` (simulates stale-build path); runs in `.github/workflows/fresh-clone.yml`, not `ci.yml` — can't replicate locally without wiping the build",
    ],
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
      "agents-md-coherence",
      "anchor-primary-source",
      "biome",
      "brief-pr-instructions",
      "cadence-pivot-threshold",
      "check-cross-repo-pr-rate",
      "check-task-block-citations",
      "cloud-audit-gate",
      "competitive-goal",
      "dashboard-localhost-bind",
      "depcruise",
      "glossary-discipline",
      "hygiene",
      "knip",
      "lockfile-integrity",
      "machine-budget",
      "maciek-smoke",
      "mape-k-budget-cap",
      "mape-k-constraints-md-size",
      "mape-k-tick-iteration-backstop",
      "mape-k-watchdog-cadence",
      "markdownlint",
      "measure-agent-install",
      "measurement-inspects-output",
      "metric-freshness",
      "milestone-alignment",
      "no-singleton-experiment",
      "orphan-tests",
      "otel-no-pii",
      "pivot-success-margin",
      "privacy-data-egress",
      "rule-1-novel-justification",
      "rule-2-dep-coverage",
      "rule-3-doc-first",
      "rule-4-otel-coverage",
      "rule-6-let-it-crash",
      "rule-7-chaos-coverage",
      "rule-12-scope-discipline",
      "rule-13-sibling-anchors",
      "rule-17-proactive-heal",
      "rule-19-supervisor-explicit-start",
      "no-hardcoded-user-paths",
      "no-personal-paths-in-docs",
      "rule-9-tasksmd-fields",
      "sbom-shape",
      "secret-scan",
      "security-docs-cohesion",
      "supervisor-sandbox-hardening",
      "tasks-lint",
      "test",
      "threat-model-section",
      "cloud-agent-config-audit-matrix",
      "tick-loop-backoff-schedule",
      "claude-hooks-installed",
      "tool-call-discipline-smoke",
      "rule-10-no-llm-in-load-bearing-gates",
      "filename-casing",
      "doc-why-first-paragraph",
      "ui-tasks-priority",
      "deprecated-md-respect",
      "cli-integration-test-coverage",
      "omc-mode-persona-gating",
      "adapter-conventions",
      "touches-field",
      "pnpm-minsky-aliases",
      "readme-byte-budget",
      "docs-frame-coherence",
      "no-hardcoded-timeouts",
      "no-no-verify-bypass",
      "pre-push-hook-stays-fast",
      "launchd-safe-paths",
      "changelog-md-update",
      "research-md-update",
      "test-file-colocation",
      "typecheck",
      "user-story-security-section",
      "vision-rule-13-non-task-anchors",
      "vision-rule-13-task-id-citations",
    ]),
  ),
  supervisorSkippable: Object.freeze(
    new Set(["linux-supervisor-integration", "macos-supervisor-integration"]),
  ),
  prOnlySkippable: Object.freeze(
    // Note: `pr-vision-trace` is body-aware but lives in its own workflow
    // (.github/workflows/pr-vision-trace.yml), not in ci.yml's `ci:` aggregator
    // `needs:` list. So it appears in `CI_ENV_DEPENDENT_JOBS` (the body-checks
    // allowlist that lifts it into the local stack via appendBodyChecks) but
    // NOT in any bash-gate bucket — bash buckets are scoped to the aggregator.
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
    // Diff-scoped via biome's native `--changed --since=<base>`: lints only
    // the files this branch changed vs the resolved diff base, NOT the whole
    // 400+-file tree. Whole-tree `biome ci .` inherited committed-on-main
    // biome debt (`scripts/collect-metrics.mjs` from the M1-M5 milestones
    // commit, 9 errors) onto every *unrelated* vetted branch's `git push` —
    // the exact inherited-debt failure mode TASKS.md
    // `orchestrator-must-land-local-vetted-branches` exists to fix, and the
    // Pivot's explicit "extend it [diff-scoping] to the whole stack". Same
    // shape as the diff-scoped `markdownlint` step: `origin/main` here is
    // rewritten to the resolved base by `withResolvedDiffBase`, and CI's
    // `biome` job still runs whole-tree (`pnpm biome ci .`) so committed
    // biome debt is still surfaced — just not flapped onto every push.
    name: "biome",
    stages: ["stop-gate", "fast", "full"],
    cmd: "pnpm",
    args: ["biome", "ci", "--changed", "--since=origin/main", "--no-errors-on-unmatched", "."],
  },
  {
    name: "typecheck",
    stages: ["fast", "full"],
    cmd: "pnpm",
    args: ["typecheck"],
  },
  {
    // Diff-scoped: `scripts/lint-md-diff.mjs` lints only the *.md files this
    // branch committed vs the resolved diff base, NOT the live `**/*.md`
    // working tree. The whole-tree `pnpm lint:md` flapped an unrelated
    // vetted branch's `git push` whenever the concurrent swarm re-dirtied
    // TASKS.md/vision.md inside the ~100 s pre-push window, and inherited
    // committed-main markdownlint debt onto every push (TASKS.md
    // `orchestrator-must-land-local-vetted-branches` Pivot b). `origin/main`
    // here is rewritten to the resolved base by `withResolvedDiffBase`, same
    // as the other diff-relative steps. CI's `markdownlint` job still runs
    // whole-tree — paying down that committed debt is the task's separate
    // step (c).
    name: "markdownlint",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/lint-md-diff.mjs"],
    env: { LINT_MD_DIFF_BASE: "origin/main" },
  },
  {
    name: "tasks-lint",
    stages: ["stop-gate", "fast", "full"],
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
    env: { RULE_3_DIFF_BASE: "origin/main", RULE_3_PR_BODY_PATH: "pr-body.md" },
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
  {
    // Catches the API drift class where a test/*.test.ts file imports
    // a symbol that doesn't exist in its sibling src/. Born from the
    // 2026-05-21 drain's PR #639 → #705 chain — the
    // `tui-src-vs-test-api-drift` task.
    name: "orphan-tests",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-orphan-tests.mjs"],
  },
  {
    name: "rule-17-proactive-heal",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-rule-17-proactive-heal.mjs"],
    env: { RULE_17_DIFF_BASE: "origin/main" },
  },
  {
    // vision.md § rule #19 (operator-explicit-start, IRON). Scans the
    // whole repo for `launchctl bootstrap` and `systemctl --user
    // enable --now` outside the allowlisted paths. Born from the
    // 2026-05-29 incident — machine reload silently brought 7
    // com.minsky.* plists back online and held ~42 GB of wired RAM
    // hostage. The lint is the deterministic gate ensuring no future
    // PR re-introduces unconditional supervisor bootstrap.
    name: "rule-19-supervisor-explicit-start",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-supervisor-explicit-start.mjs"],
  },
  {
    name: "no-hardcoded-user-paths",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/check-no-hardcoded-user-paths.mjs"],
  },
  {
    name: "no-personal-paths-in-docs",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-no-personal-paths-in-docs.mjs"],
  },
  {
    name: "agents-md-coherence",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/check-agents-md-coherence.mjs"],
  },
  {
    name: "rule-9-tasksmd-fields",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/check-rule-9-tasksmd-fields.mjs"],
  },
  {
    // Slice (d) of `self-metrics-competitive-benchmark` — every P0/P1
    // task block must carry a `**Competitive-goal**:` field naming
    // which scorecard metric it moves. Ratchet pattern: 81 grandfathered
    // task ids at lint-introduction; new tasks MUST carry the field.
    name: "competitive-goal",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/check-competitive-goal.mjs"],
  },
  {
    // Slice (c) of `milestone-alignment-gate-enforcement`: every PR must
    // keep M1's per-criterion alignment count at ≥10/14. The script
    // reads only static files (MILESTONES.md, docs/METRICS.md, user-
    // stories/*.md, README.md) — no network, no LLM — so it fits the
    // fast-stage budget. Pure rule-#10 ratchet: criterion drift below
    // the threshold (e.g. an `<!-- exempt: ... -->` is removed without
    // landing a real metric for the row) flips this red. Anchor: AGENTS.md
    // § 15 (milestone alignment gate), operator directive 2026-05-18,
    // TASKS.md `milestone-alignment-wire-into-verify`.
    name: "milestone-alignment",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-milestone-alignment.mjs", "--strict", "--min-aligned=10"],
  },
  // ---- full stage ----------------------------------------------------------
  {
    name: "vitest",
    stages: ["full"],
    cmd: "pnpm",
    args: ["test"],
  },
  {
    // Dead-code + unused-exports + unused-dependencies detector. Config at
    // `knip.json` declares the workspace shape (entry points = bin scripts
    // + scripts/*.mjs + workspace package src/index.ts + paired *.test.*
    // vitest entries). All rules currently at WARN — knip surfaces findings
    // but doesn't block CI. Once each rule family's violation count
    // converges to ≤5 with documented exemptions, it graduates to ERROR
    // per the rule-#10 ratchet. This step exits 0 even when findings exist
    // (the warn-level rules don't escalate); operators see the report in
    // the daemon log and CI artifacts. Lockfile-equivalent reasoning
    // applies to the `--no-progress` flag — same shape as `biome ci`.
    name: "knip",
    stages: ["full"],
    cmd: "pnpm",
    args: ["exec", "knip", "--no-progress", "--reporter", "compact"],
  },
  {
    // Cross-repo runner's iteration→PR ship-rate gate. Reads
    // `.minsky/experiment-store/cross-repo/*.jsonl`, computes the
    // rolling-30d rate, exits non-zero when verdict=BELOW (rate <
    // SHIP_RATE_FLOOR=0.10). Threshold constants live in
    // `scripts/lib/iteration-ship-rate.mjs` (one source of truth per
    // rule #9 + Munafò 2017 — Phase 7b decoupled this from the
    // soon-to-be-deleted TS package). FULL stage only — the daemon's
    // fast gate doesn't need a metric over its own history (by design:
    // daemon pushes can still file fix-the-rate PRs even when BELOW;
    // only operator pushes are blocked).
    name: "check-cross-repo-pr-rate",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-cross-repo-pr-rate.mjs", "--window=30d"],
  },
  {
    // Circular-dep + orphan-file detector via dependency-cruiser. Config at
    // `.dependency-cruiser.cjs`. Like knip, the rules are currently at WARN
    // so the step exits 0 when the only violations are cycles or orphans;
    // ERROR-level rules (`no-dep-on-test`, `no-non-package-json`) trip the
    // exit code immediately. The `--output-type err-long` reporter emits
    // one line per violation suitable for CI log parsing.
    name: "depcruise",
    stages: ["full"],
    cmd: "pnpm",
    args: ["exec", "depcruise", "novel", "scripts", "--output-type", "err"],
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
    // rule #10 deterministic enforcement of the devin-spawn-no-pr-opened
    // fix — pre-merge guard that mirrors the runtime invariant
    // `briefIncludesPrInstructions`. Fast (`fast` stage) because the
    // bug class wastes an entire iteration's compute when it regresses.
    name: "brief-pr-instructions",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-brief-pr-instructions.mjs"],
  },
  {
    // task-block-citations: refuses to remove a TASKS.md task block
    // when the ID is still referenced by any test file. Closes the
    // PR #864 failure mode (block was a load-bearing citation site
    // for 5 parity tests; removing it broke them all). Pure regex
    // over a `git diff` text + the test corpus, fast-stage budget
    // unaffected. Anchor: TASKS.md `orphan-cleanup-task-block-
    // citation-lint` (P1, M1); rule #10; rule #17.
    name: "check-task-block-citations",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-task-block-citations.mjs"],
    env: { TASK_CITATION_DIFF_BASE: "origin/main" },
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
    name: "privacy-data-egress",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-privacy-data-egress.mjs"],
  },
  {
    name: "dashboard-localhost-bind",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-dashboard-localhost-bind.mjs"],
  },
  {
    name: "threat-model-section",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-threat-model-section.mjs"],
  },
  {
    // The 4-agent cloud-agent contract lint referenced by
    // `add-openhands-as-pluggable-backend` § Measurement. Standalone
    // node script (not vitest) so the lint can run pre-build against
    // the published AGENT_MATRIX. As of PR #879 (phase-7b step 3) the
    // source-of-truth lives at `scripts/lib/cloud-agent-config.mjs`
    // (ported from the deleted `novel/cross-repo-runner/src/
    // agent-config.ts`); the lint asserts the post-integration steady
    // state — openhands is row 0, all four rows have
    // pendingExternalDep === null, brief-file is the delivery shape
    // for openhands. Date-flip logic was removed when the 2026-06-01
    // gate lifted on 2026-05-24.
    name: "cloud-agent-config-audit-matrix",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/cloud-agent-config-audit-matrix-lint.mjs"],
  },
  {
    name: "security-docs-cohesion",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-security-docs-cohesion.mjs"],
  },
  {
    name: "metric-freshness",
    stages: ["full"],
    cmd: "node",
    // Reads SUCCESS_METRICS directly from the compiled
    // `novel/dashboard-web/dist/metrics.js` — single source of truth.
    // Pre-2026-05-27 the same id list was hardcoded in three places
    // (here + .github/workflows/ci.yml + a JSON shortcut fixture) and
    // drifted independently — PR #900 sat in auto-merge for ~10min
    // with `gate red: metric-freshness` because local was 10 ids
    // behind CI's 20. The `--expected-from-success-metrics` flag
    // removes that footgun.
    args: ["scripts/check-metric-freshness.mjs", "--expected-from-success-metrics"],
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
    // Tier 1 hook substrate must remain installed. Per
    // `det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse` (vision
    // rule #10 ratchet) — once Tier 1 lands, any PR that removes
    // `.claude/settings.json` or any required `.claude/hooks/*.sh` fails this
    // gate. The script is pure-ish; tests use injected FS seams.
    name: "claude-hooks-installed",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-claude-hooks-installed.mjs"],
  },
  {
    // Tool-call discipline — runs on the bundled fixture transcripts in CI
    // (the live-transcript variant is the Stop-hook in `.claude/hooks/
    // stop-gate.sh`). The full stage runs the unit suite via vitest; the
    // CLI smoke-call here just verifies the script exits 0 against the
    // healthy fixture (regression-protection for the script itself, in
    // case a future edit breaks the parser).
    // Anchor: det-tool-call-discipline-prose-without-tool-call (PR #911
    // cohort task); AGENTS.md §"Tool-call discipline"; OpenHands #12462.
    name: "tool-call-discipline-smoke",
    stages: ["full"],
    cmd: "node",
    args: [
      "scripts/check-tool-call-discipline.mjs",
      "--transcript=test/fixtures/tool-call-discipline/healthy-with-tool-use.jsonl",
    ],
  },
  {
    // Self-referential rule-#10 enforcement: no load-bearing gate
    // script (anything in this very STACK_MANIFEST) may import an LLM
    // SDK or fetch an LLM API. Anchor: det-no-llm-sdk-in-ci-gate-scripts-
    // meta-lint (PR #911 cohort); vision rule #10.
    name: "rule-10-no-llm-in-load-bearing-gates",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-rule-10-no-llm-in-load-bearing-gates.mjs"],
  },
  {
    // Cardinal *.md files have specific casing requirements (vision.md
    // lowercase, AGENTS.md uppercase, etc.); other root-level .md files
    // must be kebab-case-lowercase. Per AGENTS.md §"Filename casing";
    // det-filename-casing-cardinal-md-files (PR #911 cohort, merged in #916).
    name: "filename-casing",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/check-filename-casing.mjs"],
  },
  {
    name: "doc-why-first-paragraph",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/check-doc-why-first-paragraph.mjs"],
  },
  {
    name: "ui-tasks-priority",
    stages: ["stop-gate", "fast", "full"],
    cmd: "node",
    args: ["scripts/check-ui-tasks-priority.mjs"],
  },
  {
    name: "no-hardcoded-timeouts",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-no-hardcoded-timeouts.mjs"],
  },
  {
    name: "no-no-verify-bypass",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-no-no-verify-bypass.mjs"],
  },
  {
    // rule #10 deterministic lint: lefthook's pre-push step must keep
    // `--stage=fast` so `git push` stays ≤~10s. The `--stage=full` stack
    // (vitest, ~35s) runs in scripts/local-gate-merge.mjs before merge, so
    // pre-push only needs the fast subset. A future PR that reverts
    // lefthook.yml to `--stage=full` is blocked here. Pure regex/YAML parse
    // over lefthook.yml — fast-stage budget unaffected. Anchor: TASKS.md
    // `pre-push-hook-stays-fast`; vision.md rule #10; Forsgren-Humble-Kim 2018.
    name: "pre-push-hook-stays-fast",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-pre-push-hook-fast.mjs"],
  },
  {
    name: "launchd-safe-paths",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-launchd-safe-paths.mjs"],
  },
  {
    // Diff-relative: NEW references to a docs/DEPRECATED.md-listed
    // identifier fail. Per det-deprecated-md-respect (PR #918).
    name: "deprecated-md-respect",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-deprecated-md-respect.mjs"],
    env: { DEPRECATED_DIFF_BASE: "origin/main" },
  },
  {
    name: "cli-integration-test-coverage",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-cli-integration-test-coverage.mjs"],
  },
  {
    name: "omc-mode-persona-gating",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-omc-mode-persona-gating.mjs"],
  },
  {
    // novel/adapters/**/*.ts: rule (2) every implementation file exports
    // selfTest(); rule (3) public exports carry JSDoc. Per AGENTS.md
    // §"Code conventions"; det-adapter-conventions-bundle.
    name: "adapter-conventions",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-adapter-conventions.mjs"],
  },
  {
    // P0/P1 task blocks in TASKS.md must carry **Touches**: declaring
    // file globs the task is expected to edit (strict by default;
    // **Touches**: <none> as explicit opt-out). Ratchet model — 92
    // existing violations grandfathered. Per AGENTS.md §"**Touches**:
    // field on task blocks"; det-touches-field-strict-mode.
    name: "touches-field",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-touches-field.mjs"],
  },
  {
    // Every `pnpm minsky:X` script must delegate to `bin/minsky X`
    // (no inline shell, no legacy substrate). Per AGENTS.md §"CLI
    // surface consolidation"; cli-consolidation-lint-prevents-regression.
    name: "pnpm-minsky-aliases",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-pnpm-minsky-aliases.mjs"],
  },
  {
    // README.md must stay under the byte budget. Per the
    // `readme-rewrite-5-min-install-guide` parent task: target <3KB,
    // current hard-limit-with-headroom ratchets down toward target as
    // compression slices land. Prevents the regrowth pattern observed
    // 2026-05-23 → 2026-05-28 (2910 → 11058 bytes).
    name: "readme-byte-budget",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-readme-byte-budget.mjs"],
  },
  {
    // docs-frame-coherence: 3-beat frame (tagline / What-this-is /
    // What-this-is-not) on the reader-orientation doc allowlist
    // (currently AGENTS.md, INSTALL.md, docs/PRACTICES.md).
    // Pin per docs/PRACTICES.md § "Unified reader-orientation doc
    // frame". Source: `docs-frame-coherence-lint` (P3, surfaced
    // 2026-05-21).
    name: "docs-frame-coherence",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-docs-frame-coherence.mjs"],
  },
  {
    name: "changelog-md-update",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-changelog-md-update.mjs"],
    env: { CHANGELOG_DIFF_BASE: "origin/main" },
  },
  {
    name: "research-md-update",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-research-md-update.mjs"],
    env: { RESEARCH_DIFF_BASE: "origin/main" },
  },
  {
    name: "test-file-colocation",
    stages: ["fast", "full"],
    cmd: "node",
    args: ["scripts/check-test-file-colocation.mjs"],
  },
  {
    name: "supervisor-sandbox-hardening",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-supervisor-sandbox-hardening.mjs"],
  },
  {
    name: "machine-budget",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-machine-budget.mjs"],
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
  {
    name: "rule-13-sibling-anchors",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-rule-13-sibling-anchors.mjs"],
  },
  // `sandbox-env-declared` lint deleted in PR #888 (phase-11b step 8) —
  // the lint pinned `novel/tick-loop/src/sandbox-mode.ts`'s
  // SANDBOX_MODE_ENV constant against the unit-files. The TS file is
  // gone; bash skeleton doesn't yet wire MINSKY_SANDBOX. Restore as
  // P3 follow-up when bash wiring lands.
  {
    name: "vision-rule-13-task-id-citations",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-vision-rule-13-task-id-citations.mjs"],
  },
  {
    name: "cloud-audit-gate",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-cloud-audit-gate.mjs"],
    env: { CLOUD_AUDIT_GATE_DIFF_BASE: "origin/main" },
  },
  {
    name: "vision-rule-13-non-task-anchors",
    stages: ["full"],
    cmd: "node",
    args: ["scripts/check-vision-rule-13-non-task-anchors.mjs"],
  },
  {
    // Closes parent P0 `agent-mediated-install`'s Success #1 criterion
    // in CI by running the measurement harness against the deterministic
    // mock provider. The harness exits 0 iff every run passes both
    // thresholds (≤90s, ≤1 prompt); mock-mode is the regression gate on
    // the harness machinery without spending API budget. Live mode is
    // gated behind the `--live` flag and explicitly NOT wired into CI
    // per the parent task's Pivot.
    name: "measure-agent-install",
    stages: ["full"],
    cmd: "node",
    args: [
      "scripts/measure-agent-install.mjs",
      "--providers=mock",
      "--runs-per-provider=3",
      "--threshold-seconds=90",
      "--threshold-prompts=1",
      "--quiet",
    ],
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
 * @param {readonly string[]} args
 * @param {string} diffBase
 * @returns {{ args: string[], changed: boolean }}
 */
function rewriteArgsDiffBase(args, diffBase) {
  let changed = false;
  const out = args.map((a) => {
    if (a === "--diff-base=origin/main") {
      changed = true;
      return `--diff-base=${diffBase}`;
    }
    // biome's native diff-scoping uses `--since=<ref>` (the `biome` step);
    // rewrite it to the resolved base the same way as `--diff-base=`.
    if (a === "--since=origin/main") {
      changed = true;
      return `--since=${diffBase}`;
    }
    return a;
  });
  return { args: out, changed };
}

/**
 * @param {Record<string, string> | undefined} env
 * @param {string} diffBase
 * @returns {{ env: Record<string, string> | undefined, changed: boolean }}
 */
function rewriteEnvDiffBase(env, diffBase) {
  if (env === undefined) return { env, changed: false };
  let changed = false;
  /** @type {Record<string, string>} */
  const next = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === "origin/main") {
      next[k] = diffBase;
      changed = true;
    } else {
      next[k] = v;
    }
  }
  return { env: changed ? next : env, changed };
}

/**
 * Pure transform: rewrite manifest entries that reference `origin/main` (env
 * values OR `--diff-base=origin/main` argv) to use the resolved diff base.
 * The static manifest keeps `origin/main` as its default — only the runtime
 * invocation in `main()` swaps in the resolved value, so the existing
 * STACK_MANIFEST shape (and the slice-15 CI-parity tests that pin it) don't
 * shift. Fast-path no-op when `diffBase === "origin/main"`. Returns a frozen
 * array (preserves the manifest's freeze contract).
 *
 * @param {readonly StackStep[]} manifest
 * @param {string} diffBase
 * @returns {readonly StackStep[]}
 */
export function withResolvedDiffBase(manifest, diffBase) {
  if (diffBase === "origin/main") return manifest;
  return Object.freeze(
    manifest.map((step) => {
      const argRewrite = rewriteArgsDiffBase(step.args, diffBase);
      const envRewrite = rewriteEnvDiffBase(step.env, diffBase);
      if (!argRewrite.changed && !envRewrite.changed) return step;
      return Object.freeze({
        ...step,
        args: argRewrite.args,
        ...(envRewrite.env !== undefined ? { env: envRewrite.env } : {}),
      });
    }),
  );
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
 * spawn their own `git` against a tmpdir fixture (e.g., the bash-runner
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
 * @returns {{ stage: Stage, json: boolean, body?: string }}
 */
export function parseArgs(argv) {
  /** @type {Stage} */
  let stage = "fast";
  let json = false;
  /** @type {string | undefined} */
  let body;
  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    const stageMatch = /^--stage=(stop-gate|fast|full)$/.exec(arg);
    if (stageMatch !== null && stageMatch[1] !== undefined) {
      stage = /** @type {Stage} */ (stageMatch[1]);
      continue;
    }
    const bodyMatch = /^--body=(.+)$/.exec(arg);
    if (bodyMatch !== null && bodyMatch[1] !== undefined) {
      body = bodyMatch[1];
    }
  }
  return body === undefined ? { stage, json } : { stage, json, body };
}

/**
 * Resolve which draft PR-body file (if any) the run should validate.
 *
 * When `--body=<path>` is explicit, honour it. When no flag is set, look for
 * an adjacent `pr-body.md` in `repoRoot` and pick it up automatically — the
 * same auto-discovery the daemon's outer gate (`createBodyAwarePrePrLintRun`)
 * already performs in TS-land. Lifting it into the script means
 * `pnpm pre-pr-lint` (operator) and `node scripts/run-pre-pr-lint-stack.mjs`
 * (daemon) share one discovery path — single source of truth (rule #2). The
 * operator stops needing to remember the flag; the daemon's existing
 * `--body=<path>` invocation is unaffected (explicit beats discovery).
 *
 * Pure helper — file existence is the only I/O, behind the `fileExists` seam.
 *
 * @param {string | undefined} explicit  parseArgs's `body` field; `undefined`
 *   when the operator did not pass `--body=<path>`.
 * @param {(p: string) => boolean} fileExists
 * @param {string} repoRoot
 * @returns {string | undefined}
 */
export function resolveBodyPath(explicit, fileExists, repoRoot) {
  if (explicit !== undefined) return explicit;
  const candidate = resolve(repoRoot, "pr-body.md");
  return fileExists(candidate) ? candidate : undefined;
}

/**
 * Append the three body-only checks (`pr-self-grade`, `pr-security-review`,
 * `pr-vision-trace`) to the manifest when the operator passes `--body=<path>`
 * (or the auto-discovery in `resolveBodyPath` finds an adjacent `pr-body.md`).
 *
 * All three checks live in `CI_ENV_DEPENDENT_JOBS` because in CI they read
 * from the GitHub PR body — the daemon's gate has no PR body until `gh pr
 * create` has run, but the draft-body file the daemon writes BEFORE `gh pr
 * create -F <file>` is exactly the input these scripts already accept (each
 * `main()` reads `process.argv[2]` as a path). Surfacing them as manifest
 * steps consolidates four commands (`pnpm pre-pr-lint`, `node scripts/check-
 * pr-self-grade.mjs`, `node scripts/check-pr-security-review.mjs`, `node
 * scripts/check-pr-vision-trace.mjs`) into one — one round-trip in the
 * daemon's iteration vs four, and a single retry budget instead of four
 * independent decisions about how to react to red.
 *
 * `pr-vision-trace` was added 2026-05-25 per task `pre-pr-lint-mirror-ci-
 * body-checks` (P1, M1) — same trip-and-fall pattern that caught PRs #863,
 * #869, #870 (body-only edits that needed an empty `chore(ci): retrigger`
 * commit before CI re-ran). Lifting all three body lints to the local
 * stack closes the operator's feedback loop: see the failure in 1s, not
 * after a 2-3 min CI round-trip.
 *
 * All steps participate in `fast` and `full` so the daemon's fast-stage
 * gate exercises them too — they're cheap (regex-over-body) so the ≤2 min
 * fast-stage budget is unaffected.
 *
 * @param {readonly StackStep[]} manifest
 * @param {string} bodyPath
 * @returns {readonly StackStep[]}
 */
export function appendBodyChecks(manifest, bodyPath) {
  return Object.freeze([
    ...manifest,
    {
      name: "pr-self-grade",
      stages: ["fast", "full"],
      cmd: "node",
      args: ["scripts/check-pr-self-grade.mjs", bodyPath],
    },
    {
      name: "pr-security-review",
      stages: ["fast", "full"],
      cmd: "node",
      args: ["scripts/check-pr-security-review.mjs", bodyPath],
    },
    {
      name: "pr-vision-trace",
      stages: ["fast", "full"],
      cmd: "node",
      args: ["scripts/check-pr-vision-trace.mjs", bodyPath],
    },
  ]);
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
 * NDJSON: one JSON line per step, then one summary line. Operator can pipe
 * to `jq -c` and grep individual step results without parsing a 30+-step
 * blob. The summary's discriminator field (`summary: true`) lets a consumer
 * separate the per-step lines from the final aggregate without counting.
 * Anchor: `docs/daemon-pre-pr-gate.md` § Operator commands ("one JSON line
 * per step + a final summary"); the doc claim and this renderer are pinned
 * by `--json output shape` in `run-pre-pr-lint-stack.test.mjs`.
 *
 * @param {StackResult} result
 * @returns {string}
 */
export function renderJson(result) {
  const lines = result.steps.map((s) => JSON.stringify(s));
  lines.push(
    JSON.stringify({
      summary: true,
      stage: result.stage,
      allPass: result.allPass,
      stepCount: result.steps.length,
    }),
  );
  return lines.join("\n");
}

/**
 * Build the human-readable warning that prints to stderr when the operator
 * runs `pnpm pre-pr-lint` without a body file present. Tells them which
 * checks are skipped + how to enable. Pure helper so the test can pin the
 * exact wording.
 *
 * Source: task `pre-pr-lint-mirror-ci-body-checks` (P1, M1) — observed
 * 2026-05-25 across PRs #863, #869, #870. Without this warning the
 * operator has no visibility that 3 CI gates won't run locally, and
 * silently ships PRs with body-shape failures that only surface in CI.
 *
 * @returns {string}
 */
export function buildSkippedBodyChecksWarning() {
  return [
    "[pre-pr-lint] note — no pr-body.md found, skipping these CI gates locally:",
    "             - pr-self-grade   (Predicted/Observed/Match/Lesson)",
    "             - pr-security-review (## Security & privacy section / typed opt-out)",
    "             - pr-vision-trace (## Vision trace block)",
    "             Run `pnpm pre-pr-lint --body=<path/to/body.md>` (or drop the file at",
    "             ./pr-body.md) for full local coverage. CI will still run them.",
  ].join("\n");
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const diffBase = resolveDiffBase();
  const resolved = withResolvedDiffBase(STACK_MANIFEST, diffBase);
  const body = resolveBodyPath(parsed.body, existsSync, REPO_ROOT);
  const manifest = body === undefined ? resolved : appendBodyChecks(resolved, body);
  if (body === undefined && !parsed.json) {
    // One-line warning so the operator sees the gap. Stays on stderr so
    // it doesn't pollute the renderHuman output the CI parses.
    // Suppressed in JSON mode because the daemon pipes the JSON to
    // structured downstream code (rule #2 — one canonical render
    // surface per consumer). Operator pre-PR runs are human-mode by
    // default and benefit from the visibility.
    process.stderr.write(`${buildSkippedBodyChecksWarning()}\n`);
  }
  const result = await runStack(parsed.stage, defaultRunStep, manifest);
  process.stdout.write(`${parsed.json ? renderJson(result) : renderHuman(result)}\n`);
  process.exit(result.allPass ? 0 : 1);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  await main();
}
