#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-16 operator "build the best solution for autonomous opus, find a different solution instead of github actions" -->
//
// Trusted local merge-gate. GitHub Actions is disabled on this repo, so the
// branch-protection `ci` check never runs and NO PR ever reaches
// mergeStateStatus=CLEAN — `auto-merge-clean-prs.mjs` (which requires CLEAN)
// drains nothing. This gate substitutes a DETERMINISTIC LOCAL verdict for the
// dead CI: for each open, non-draft, non-CONFLICTING PR it merges the PR head
// onto `origin/main` in an isolated `git clone --shared` scratch dir and runs
// the canonical `run-pre-pr-lint-stack --stage=full --json`. Two-layer
// merge authority (autonomous-opus): the deterministic gate is the cheap
// pre-filter; an **Opus review** (`claude --print --model claude-opus-4-7`,
// invoked ONLY on gate-green PRs for cost discipline) is the brain that
// judges intent / hidden risk / scope creep. A PR merges (`gh pr merge
// --squash --admin`) only when it is BOTH gate-green AND Opus-approved.
// `--no-review` runs deterministic-only. Cost: $0 infra (Opus on the
// Claude subscription) — fits the project's $10/mo cap; no Actions/runner.
//
// Pattern: pure decision functions (`pickGateCandidates`, `parseGateVerdict`,
// `decideMerge`) over snapshots + a thin I/O seam (`snapshotFn` / `vetFn` /
// `mergeFn`) injected for tests (rule #2) — mirrors `auto-merge-clean-prs.mjs`
// and the rule-lint shape (rule #10: same input ⇒ same output, no model in the
// merge decision). Composes `run-pre-pr-lint-stack` + `gh` rather than
// reinventing a gate (rule #1).
//
// Worktree-pinned head branches (proactive arm — TASKS.md `gate-merge-
// delete-branch-vs-worktree-pin`): the parallel-worker swarm checks branches
// out in `.claude/worktrees/`, which PINS the head ref. `gh pr merge
// --delete-branch` would server-merge fine but then throw on the local
// `git branch -d`, making the gate mis-record an already-merged PR as
// `merge-failed` (the #580 false-negative). `defaultMerge` now detects the
// pin via `git worktree list --porcelain` (pure `headBranchPinnedByWorktree`
// + pure `mergeArgs`) and DROPS `--delete-branch` for a pinned head, leaving
// the incidental branch cleanup to the worktree teardown — cleanup never
// gates the merge result (rule #6). This is the proactive complement to the
// post-hoc state-oracle recovery in `processOnePr` (`prStateFn` re-queries
// `gh pr view --json state`; MERGED ⇒ success): prevention first, recovery
// as the backstop.
//
// rule #9 (pre-registered): a gate-green admin-merged PR must not regress
// `origin/main` — post-merge, a fresh `--stage=full` run on main stays green.
// Success: 0 post-merge main regressions over ≥10 gate-merged PRs. Pivot: if
// ≥1 regression, add an auto-revert-on-red post-merge re-vet OR fall back to
// label-gated (`minsky-auto-merge` required). Measurement:
// `node scripts/local-gate-merge.mjs --self-metric` prints
// `{sweeps, merged, skipped, mergedPrs}` from the run ledger at
// `.minsky/local-gate-merge.jsonl` — `merged` is the throughput numerator
// for the ≥10-merge window; the regression count is derived externally by
// re-running `--stage=full` on main after each `mergedPrs` entry.
// Anchor: Beyer SRE 2016 (the gate IS the release gate); rule #10 / #1.
//
// Sweep-start scratch GC (TASKS.md `gate-scratch-dir-gc`, companion to the
// best-effort per-vet teardown): a SIGKILL'd / crashed / operator-killed vet
// skips its `finally`, leaking a `minsky-gate-*` / `minsky-land-*` dir under
// tmpdir(). Those accumulate and can make a future sibling `rmSync` throw
// `ENOTEMPTY` against a half-gone dir. `gcStaleScratchDirs` (called at sweep
// start, non-dry-run) reclaims a leak only when it is BOTH older than
// `VET_TIMEOUT_MS` AND not owned by a live pid (sentinel `.minsky-gate-owner-
// pid` written at creation; `process.kill(pid, 0)` liveness probe).
//   Failure modes (rule #7): (1) a dir raced away mid-scan → skipped, no
//   crash; (2) sentinel absent/garbled (pre-sentinel leak / truncated by a
//   crash) → `ownerPid: null`, age guard alone decides; (3) the GC delete
//   races a just-finished vet → `bestEffortRmScratch` swallows (OS reaps the
//   tmpdir). Expected behavior: graceful-degrade — GC NEVER throws into the
//   sweep (rule #6). Blast radius: at most the leaked scratch dirs under
//   tmpdir(); a live vet's dir is always kept (young OR live-pid-owned).
//   Escape hatch: `--dry-run` skips GC entirely (read-only probe); set
//   `MINSKY_GATE_VET_TIMEOUT_MS` higher to be more conservative about
//   reclamation. Pivot (if `pidIsAlive` proves unreliable cross-platform):
//   drop to age-only at 2× the timeout — `decideStaleScratch` already takes
//   the threshold as a parameter, so the change is one call-site constant.
//
// Usage:
//   node scripts/local-gate-merge.mjs [--dry-run] [--no-review] [--limit=N] [--pr=N]
//   node scripts/local-gate-merge.mjs --self-metric
//   --dry-run     : vet + print verdicts, do NOT call `gh pr merge`
//   --no-review   : deterministic-only (skip the Opus brain layer)
//   --pr=N        : gate only PR N
//   --limit=N     : cap how many candidates to process this sweep (default 5)
//   --self-metric : print the rule-#9 ledger snapshot {sweeps, merged, skipped,
//                   mergedPrs} from `.minsky/local-gate-merge.jsonl` and exit
//                   (no sweep) — the pre-registered throughput measurement

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Derive the repo root from this script's own location — the hardcoded
// `/Users/cbrwizard/apps/tooling/minsky` fallback only worked for one
// operator and broke the gate for everyone else (rule #17 fix,
// 2026-05-19; see TASKS.md `local-gate-merge-minsky-home-hardcoded-
// path`). The `MINSKY_HOME` env override remains as the operator
// escape hatch.
const REPO = process.env["MINSKY_HOME"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(REPO, ".minsky", "local-gate-merge.jsonl");
// Per-vet hard timeout — a cold `--stage=full` (tsc -b --force across all
// workspace projects + full vitest) is ~20 min; this bounds a hung/
// pathological vet so one PR can never wedge the autonomous conductor
// (the keystone "run reliably for 10h" guarantee). Generous default
// (25 min) tolerates a slow-but-finishing vet; env-tunable.
const VET_TIMEOUT_MS = Number(process.env["MINSKY_GATE_VET_TIMEOUT_MS"] ?? 1500000);
// Load-shed niceness applied to the scratch `--stage=full` vet (the
// `vitest`-heavy step). The host runs the orchestrator + worker daemon +
// other tenants concurrently at load ~14-26 on 10 cores (2026-05-17); a
// timing-sensitive test flaked under that contention and produced a spurious
// `gate red: vitest` SKIP of a clean MERGEABLE PR. `retry: 2` masks the
// symptom; running the vet at a lower scheduler priority (and pausing the
// worker daemon for the vet's duration — see `orchestrate.mjs`) removes the
// cause (Nygard 2018 *Release It!* — resource contention / bulkhead).
// Default 10 (de-prioritise vs. interactive); env-tunable. 0 disables the
// nice wrapper (the documented opt-out for debugging, rule #16).
const VET_NICENESS = Number(process.env["MINSKY_GATE_VET_NICENESS"] ?? 10);

/**
 * @typedef {object} PrSnapshot
 * @property {number} number
 * @property {boolean} isDraft
 * @property {string} mergeable      MERGEABLE | CONFLICTING | UNKNOWN
 * @property {string} baseRefName
 * @property {string} headRefName
 * @property {string} title
 */

/**
 * Pure: which open PRs are even eligible for local vetting. Excludes drafts,
 * known textual conflicts, and non-default base branches (stacked PRs are not
 * gated here — they merge via their base).
 * @param {PrSnapshot[]} prs
 * @param {string} defaultBranch
 * @returns {PrSnapshot[]}
 */
export function pickGateCandidates(prs, defaultBranch = "main") {
  return prs.filter(
    (pr) => !pr.isDraft && pr.mergeable !== "CONFLICTING" && pr.baseRefName === defaultBranch,
  );
}

/**
 * Parse one NDJSON line, or null if it isn't a JSON object line. Extracted
 * so `parseGateVerdict` stays under biome's cognitive-complexity cap.
 * @param {string} line
 * @returns {Record<string, unknown> | null}
 */
function parseJsonLine(line) {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/**
 * Pure: turn `run-pre-pr-lint-stack --json` stdout into a verdict. The stack
 * (`renderJson`) emits one `JSON.stringify(step)` line per step —
 * `{name, verdict:"pass"|"fail", …}` — then a final
 * `{summary:true, stage, allPass:boolean, stepCount}` line. Green iff the
 * summary exists with `allPass===true` AND no step `verdict==="fail"`.
 * @param {string} stdout
 * @returns {{green: boolean, failedSteps: string[], sawSummary: boolean}}
 */
export function parseGateVerdict(stdout) {
  const failedSteps = [];
  let sawSummary = false;
  let summaryOk = false;
  for (const line of stdout.split("\n")) {
    const obj = parseJsonLine(line);
    if (!obj) continue;
    if (obj["summary"] === true) {
      sawSummary = true;
      summaryOk = obj["allPass"] === true;
    } else if (obj["verdict"] === "fail" && typeof obj["name"] === "string") {
      failedSteps.push(obj["name"]);
    }
  }
  return { green: sawSummary && summaryOk && failedSteps.length === 0, failedSteps, sawSummary };
}

/**
 * Pure: final merge decision for one vetted PR. Two-layer authority
 * (autonomous-opus): the deterministic `--stage=full` gate is the cheap
 * pre-filter; an optional **Opus review** is the brain — a PR only merges
 * when it is BOTH gate-green AND (when a review is supplied) Opus-approved.
 * `review` is omitted in deterministic-only mode (`--no-review`).
 * @param {{
 *   pr: PrSnapshot,
 *   verdict: {green: boolean, failedSteps: string[], sawSummary: boolean},
 *   vetError?: string,
 *   review?: {approve: boolean, reason: string},
 * }} input
 * @returns {{action: "merge" | "skip", reason: string}}
 */
export function decideMerge(input) {
  if (input.vetError) return { action: "skip", reason: `vet-error: ${input.vetError}` };
  if (!input.verdict.sawSummary) {
    return { action: "skip", reason: "no gate summary (vet did not complete)" };
  }
  if (!input.verdict.green) {
    return {
      action: "skip",
      reason: `gate red: ${input.verdict.failedSteps.join(",") || "summary not ok"}`,
    };
  }
  if (input.review && !input.review.approve) {
    return { action: "skip", reason: `opus-review rejected: ${input.review.reason}` };
  }
  const brain = input.review ? ` + opus-approved (${input.review.reason})` : "";
  return { action: "merge", reason: `gate green on PR-merged-onto-main${brain}` };
}

/**
 * Pure: decide how to shed competing host load for one scratch vet. The vet's
 * `vitest` step is timing-sensitive; under 2-3x host oversubscription it flakes
 * and produces a spurious `gate red: vitest` SKIP of a clean PR (2026-05-17).
 * Two cooperative levers, both default-on (rule #16), both disable-able for
 * debugging:
 *   - `niceness`  — run the vet at a lower scheduler priority so the
 *                   orchestrator/other tenants don't starve it of CPU
 *                   (`MINSKY_GATE_VET_NICENESS`, 0 ⇒ no nice wrapper).
 *   - `pauseWorker` — ask the caller's `pauseWorkerFn`/`resumeWorkerFn` seam to
 *                   SIGSTOP the worker daemon's active iteration for the vet's
 *                   duration so gate-vet and worker-tick never run vitest
 *                   simultaneously (`MINSKY_GATE_NO_WORKER_PAUSE=1` ⇒ off).
 * Same input ⇒ same output (rule #10); no I/O here — the levers are applied by
 * the injectable seam in `defaultVet`.
 * @param {{ niceness?: number, noWorkerPause?: string | undefined }} [env]
 * @returns {{ niceness: number, pauseWorker: boolean, reason: string }}
 */
export function decideLoadShed(env = {}) {
  const niceness =
    Number.isFinite(env.niceness) && /** @type {number} */ (env.niceness) > 0
      ? Math.min(20, Math.trunc(/** @type {number} */ (env.niceness)))
      : 0;
  const pauseWorker = env.noWorkerPause !== "1";
  const parts = [];
  if (niceness > 0) parts.push(`nice +${niceness}`);
  if (pauseWorker) parts.push("pause-worker");
  return {
    niceness,
    pauseWorker,
    reason: parts.length > 0 ? `load-shed: ${parts.join(" + ")}` : "load-shed: off",
  };
}

// ---- land-local: the gate-merge mechanism applied to a LOCAL branch ------
//
// The swarm's workers land only because they push from `.claude/worktrees/`
// checkouts the orchestrator provisions; a fully-vetted local branch from a
// non-worktree contributor (an Opus-director keystone fix) is un-landable
// while the swarm runs — the live-tree pre-push gate flaps on concurrent
// churn and isolated worktrees lack node_modules. `landLocalBranch`
// generalises the proven PR scratch-vet (rule #1: the orchestrator already
// has the primitive — apply it to a local ref instead of a `pull/N/head`).
// TASKS.md `orchestrator-must-land-local-vetted-branches` Detail (a).

/**
 * Pure: skip-earlier gate. A branch with nothing ahead of `origin/main`
 * (empty / already-merged) can never land — eliding the ~20-min scratch
 * clone + `pnpm install` + `--stage=full` vet on a cheap `rev-list --count`
 * is the iteration's measurable optimization (round-trip elimination).
 * @param {number} commitsAhead
 * @returns {{proceed: boolean, reason: string}}
 */
export function decidePreflight(commitsAhead) {
  if (!Number.isFinite(commitsAhead) || commitsAhead <= 0) {
    return { proceed: false, reason: "nothing-to-land: 0 commits ahead of origin/main" };
  }
  return { proceed: true, reason: `${commitsAhead} commit(s) ahead of origin/main` };
}

/**
 * Pure: land decision for a vetted local branch. Mirrors `decideMerge`
 * (same two-layer authority — deterministic `--stage=full` gate, optional
 * Opus brain) minus the `PrSnapshot` (a local branch has no PR yet).
 * @param {{
 *   verdict: {green: boolean, failedSteps: string[], sawSummary: boolean},
 *   vetError?: string,
 *   review?: {approve: boolean, reason: string},
 * }} input
 * @returns {{action: "land" | "abort", reason: string}}
 */
export function decideLand(input) {
  if (input.vetError) return { action: "abort", reason: `vet-error: ${input.vetError}` };
  if (!input.verdict.sawSummary) {
    return { action: "abort", reason: "no gate summary (vet did not complete)" };
  }
  if (!input.verdict.green) {
    return {
      action: "abort",
      reason: `gate red: ${input.verdict.failedSteps.join(",") || "summary not ok"}`,
    };
  }
  if (input.review && !input.review.approve) {
    return { action: "abort", reason: `opus-review rejected: ${input.review.reason}` };
  }
  const brain = input.review ? ` + opus-approved (${input.review.reason})` : "";
  return { action: "land", reason: `gate green on branch-merged-onto-main${brain}` };
}

// ---- I/O seam (production defaults; tests inject fakes) -------------------

/**
 * `gh pr list` reports `mergeable` lazily — almost always `UNKNOWN` — so the
 * `pickGateCandidates` CONFLICTING filter was a no-op in practice and
 * textually-conflicted PRs slipped through to the 25-min scratch vet, each
 * burning a whole bounded sweep slot on `merge-onto-main-conflict`. With
 * `limit=2` the conductor then perpetually re-vetted the same 1-2 conflicted
 * PRs and never reached a mergeable one (the candidate-starvation that kept
 * the merge-rate at 0). `gh pr view` on a single PR forces GitHub to COMPUTE
 * real mergeability — one cheap (~0.5s) call vs a wasted 25-min vet.
 * Fail-open: a `gh` hiccup leaves the listed value so the deterministic vet
 * stays the authority (never over-skip on infra noise — rule #6).
 * @param {number} prNumber
 * @param {string} listed  the (usually UNKNOWN) value from `gh pr list`
 * @returns {string} MERGEABLE | CONFLICTING | UNKNOWN
 */
function resolveMergeable(prNumber, listed) {
  try {
    const out = execFileSync("gh", ["pr", "view", String(prNumber), "--json", "mergeable"], {
      cwd: REPO,
      encoding: "utf8",
    });
    return JSON.parse(out).mergeable ?? listed;
    // rule-6: handled-locally — a `gh pr view` failure (rate-limit/transient 5xx) keeps the listed value; the full vet stays the authority, we never over-skip on infra noise.
  } catch {
    return listed;
  }
}

/** @returns {PrSnapshot[]} */
function defaultSnapshot() {
  const out = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,isDraft,mergeable,baseRefName,headRefName,title",
    ],
    { cwd: REPO, encoding: "utf8" },
  );
  /** @type {PrSnapshot[]} */
  const prs = JSON.parse(out);
  // Resolve TRUE mergeability so `pickGateCandidates` can actually drop
  // conflicts before they starve the bounded sweep. Only probe non-draft
  // main-targeted PRs (the only ones pickGateCandidates would keep anyway)
  // to bound the extra `gh` calls.
  return prs.map((pr) =>
    pr.isDraft || pr.baseRefName !== "main"
      ? pr
      : { ...pr, mergeable: resolveMergeable(pr.number, pr.mergeable) },
  );
}

/**
 * Clone the live repo (shared object store), check out `origin/main`, fetch
 * the PR head and merge it onto main — all inside `scratch`. Extracted so
 * `defaultVet` stays under biome's cognitive-complexity cap.
 * @param {string} scratch
 * @param {PrSnapshot} pr
 * @returns {{vetError: string} | null}  null ⇒ scratch is ready to gate
 */
function prepareScratchClone(scratch, pr) {
  execFileSync("git", ["clone", "--shared", "--quiet", REPO, scratch], { encoding: "utf8" });
  // The --shared clone's `origin` is the local filesystem path, which has
  // no `pull/*/head` refs. Repoint `origin` at the live repo's real
  // (GitHub) remote so we can fetch the PR head + authoritative main;
  // --shared alternates still reuse local objects so only the PR delta
  // is fetched over the network.
  const ghRemote = execFileSync("git", ["-C", REPO, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", scratch, "remote", "set-url", "origin", ghRemote], {
    encoding: "utf8",
  });
  execFileSync("git", ["-C", scratch, "fetch", "--quiet", "origin", "main"], { encoding: "utf8" });
  execFileSync("git", ["-C", scratch, "checkout", "--quiet", "-B", "gate", "origin/main"], {
    encoding: "utf8",
  });
  execFileSync(
    "git",
    ["-C", scratch, "fetch", "--quiet", "origin", `pull/${pr.number}/head:pr${pr.number}`],
    { encoding: "utf8" },
  );
  try {
    execFileSync("git", ["-C", scratch, "merge", "--no-edit", `pr${pr.number}`], {
      encoding: "utf8",
    });
  } catch {
    return { vetError: "merge-onto-main-conflict" };
  }
  return installScratchDeps(scratch);
}

/**
 * Re-create the workspace `node_modules` symlink-farm inside a fresh scratch
 * clone. pnpm scatters a per-package farm across the whole workspace; `git
 * clone` only carries the tracked tree, so a bare clone has NO node_modules
 * anywhere. Symlinking just the root one left every `novel/*` package
 * unresolvable (tsc + vitest `Cannot find module` for EVERY candidate — the
 * zero-merge bottleneck). A real install is the only correct fix: with the
 * global pnpm store already warm from the live repo, `--prefer-offline
 * --frozen-lockfile` only re-links (seconds, no network) and is fully
 * isolated to the scratch (multi-tenant safe — never writes the live
 * node_modules). Shared by the PR vet (`prepareScratchClone`) and the
 * local-branch vet (`prepareScratchCloneForBranch`) — rule #1, one seam.
 * @param {string} scratch
 * @returns {{vetError: string} | null}  null ⇒ deps ready
 */
function installScratchDeps(scratch) {
  try {
    execFileSync(
      "pnpm",
      ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts", "--reporter=silent"],
      { cwd: scratch, encoding: "utf8", timeout: VET_TIMEOUT_MS },
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    // An install failure is gate INFRA broken, not the candidate being red —
    // make that explicit so it is never misattributed as a gate-failure
    // (rule #6: surface the boundary error, don't swallow it as a skip).
    return { vetError: `scratch-install-failed: ${m.slice(0, 160)}` };
  }
  return null;
}

/**
 * `run-pre-pr-lint-stack` exits non-zero on red but still printed its JSON to
 * stdout — recover that; otherwise surface the infra error.
 * @param {unknown} err
 * @returns {{stdout: string} | {vetError: string}}
 */
function vetErrorToResult(err) {
  const e =
    /** @type {{killed?: boolean, signal?: string, code?: string, stdout?: Buffer | string}} */ (
      err
    );
  // Timed-out / killed vet: do NOT parse its partial stdout as a verdict —
  // a half-finished gate has no summary anyway, but be explicit so the
  // ledger shows the bound fired (the keystone 10h-reliability guarantee).
  if (e?.killed === true || e?.signal === "SIGKILL" || e?.code === "ETIMEDOUT") {
    return {
      vetError: `vet-timeout (>${VET_TIMEOUT_MS}ms — bounded so it can't wedge the conductor)`,
    };
  }
  const captured = e?.stdout;
  if (captured) return { stdout: captured.toString() };
  const msg = err instanceof Error ? err.message : String(err);
  return { vetError: msg.slice(0, 200) };
}

/**
 * Run the scratch `--stage=full` gate, de-prioritised by `nice` when
 * `niceness > 0` (load-shed lever #1). `nice` exists on macOS + Linux + every
 * POSIX host; if it is somehow missing the call throws ENOENT and the caller's
 * `vetErrorToResult` records a typed vetError (never a silent gate-red — rule
 * #6). `niceness === 0` runs `node` directly (the debugging opt-out). Shared
 * by the PR vet and the local-branch vet (rule #1 — one seam).
 * @param {string} scratch
 * @param {number} niceness
 * @returns {string} the gate's --json stdout
 */
function runVetNiced(scratch, niceness) {
  const gateArgs = ["scripts/run-pre-pr-lint-stack.mjs", "--stage=full", "--json"];
  const exec = (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
    execFileSync(cmd, args, {
      cwd: scratch,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: VET_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
  return niceness > 0
    ? exec("nice", ["-n", String(niceness), "node", ...gateArgs])
    : exec("node", gateArgs);
}

// Worker-pause seam (load-shed lever #2). Production wires these from
// `orchestrate.mjs` (SIGSTOP/SIGCONT the worker daemon's active iteration)
// via `setWorkerPauseSeam`; tests inject fakes. Default no-ops so the gate
// runs standalone (`node scripts/local-gate-merge.mjs`) without a conductor.
/** @type {() => void} */
let workerPauseFn = () => undefined;
/** @type {() => void} */
let workerResumeFn = () => undefined;

/**
 * Install the production worker-pause/resume seam. Called by the conductor
 * (`orchestrate.mjs`) so a gate vet launched from a tick pauses the worker
 * daemon for the vet's duration; left as no-ops for standalone CLI runs.
 * @param {{ pause: () => void, resume: () => void }} seam
 */
export function setWorkerPauseSeam(seam) {
  workerPauseFn = seam.pause;
  workerResumeFn = seam.resume;
}

/**
 * Run `fn` with the worker daemon paused, guaranteeing resume in a `finally`
 * even if `fn` throws or the process is interrupted mid-vet (rule #6 — a
 * load-shed pause must NEVER leave the worker SIGSTOP'd; that would convert a
 * flake-fix into a worker outage). A pause-call failure is swallowed (the vet
 * still runs, just unshed — degrade gracefully, never gate the merge on a
 * best-effort optimisation).
 * @template T
 * @param {boolean} pauseWorker
 * @param {() => T} fn
 * @returns {T}
 */
export function withWorkerPaused(pauseWorker, fn) {
  if (!pauseWorker) return fn();
  let paused = false;
  try {
    workerPauseFn();
    paused = true;
    // rule-6: handled-locally — pausing is best-effort load-shed; a failed SIGSTOP must not block the vet.
  } catch {
    paused = false;
  }
  try {
    return fn();
  } finally {
    if (paused) {
      try {
        workerResumeFn();
        // rule-6: handled-locally — resume must always be attempted; a failed SIGCONT is logged by the seam, never thrown, so the finally cannot mask the vet result.
      } catch {
        /* the seam logs; never leave the worker stopped silently */
      }
    }
  }
}

/**
 * Default vet: isolated `git clone --shared` scratch dir (NEVER an in-repo
 * worktree — that flips core.bare on the live repo), PR merged onto
 * origin/main, full gate with --json. The gate runs load-shed (rule #6,
 * Nygard 2018 bulkhead): the worker daemon is paused for the vet's duration
 * and the vet itself is `nice`-de-prioritised so a timing-sensitive `vitest`
 * cannot flake under host oversubscription (`decideLoadShed`).
 * @param {PrSnapshot} pr
 * @returns {{stdout: string} | {vetError: string}}
 */
function defaultVet(pr) {
  const scratch = mkdtempSync(join(tmpdir(), "minsky-gate-"));
  writeOwnerPid(scratch);
  const shed = decideLoadShed({
    niceness: VET_NICENESS,
    noWorkerPause: process.env["MINSKY_GATE_NO_WORKER_PAUSE"],
  });
  try {
    const prep = prepareScratchClone(scratch, pr);
    if (prep) return prep;
    const stdout = withWorkerPaused(shed.pauseWorker, () => runVetNiced(scratch, shed.niceness));
    return { stdout };
  } catch (err) {
    return vetErrorToResult(err);
  } finally {
    bestEffortRmScratch(scratch);
  }
}

/**
 * Best-effort scratch teardown. A SIGKILL'd vet (timeout) can leave child
 * procs still flushing into `scratch` for a few ms, so a recursive `rmSync`
 * races them and throws `ENOTEMPTY`. Previously that throw escaped the
 * `finally` and aborted the ENTIRE sweep (`sweepError: ENOTEMPTY`, 0
 * merges) — a cleanup failure must never gate merging (rule #6). The dir
 * lives under `tmpdir()` (OS-reaped), so a missed delete is harmless: one
 * retry after a short pause, then give up quietly.
 * @param {string} scratch
 */
function bestEffortRmScratch(scratch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      rmSync(scratch, { recursive: true, force: true });
      return;
      // rule-6: handled-locally — scratch is ephemeral tmpdir; a cleanup race (ENOTEMPTY from a SIGKILL'd vet's draining children) must never abort the sweep, so swallow and let the OS reap the dir.
    } catch {
      if (attempt === 0) execFileSync("sleep", ["1"]);
    }
  }
}

// Sentinel file written into every scratch dir at creation, recording the
// owning vet's pid. The sweep-start GC pass reads it to tell a live vet's
// in-flight scratch (leave it) from a leaked one (reclaim it). Hidden +
// in-dir so `git clone --shared` never sees it (written after the clone is
// the alternative, but the clone targets the dir itself, so a dotfile beside
// the `.git` is harmless and the gate vet only reads tracked files).
const OWNER_PID_FILE = ".minsky-gate-owner-pid";
// Scratch dirs the GC pass owns. `mkdtempSync` suffixes a random tail, so a
// prefix match (not exact) identifies a dir created by this script.
const SCRATCH_PREFIXES = ["minsky-gate-", "minsky-land-"];

/**
 * Record the current pid in the scratch so the GC pass can tell a live
 * vet's in-flight dir from a leaked one. Best-effort: a write failure only
 * costs the GC pass its pid signal (it falls back to the age check), so it
 * must never crash the vet (rule #6).
 * @param {string} scratch
 */
function writeOwnerPid(scratch) {
  try {
    writeFileSync(join(scratch, OWNER_PID_FILE), String(process.pid), "utf8");
    // rule-6: handled-locally — the owner-pid sentinel is a GC hint, not a correctness input; a write failure degrades GC to age-only (the documented Pivot) and must never abort the vet.
  } catch {
    // best-effort hint only
  }
}

/**
 * Probe whether `pid` is a live process. `process.kill(pid, 0)` sends no
 * signal but throws `ESRCH` when the pid is dead and `EPERM` when it exists
 * but is owned by another user (still alive). Fail-safe: any non-`ESRCH`
 * error is read as "alive" so the GC pass never reclaims a dir that might
 * still have a running owner (rule #6 — a cleanup race must never delete
 * live state).
 * @param {number} pid
 * @returns {boolean}
 */
function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code !== "ESRCH";
  }
}

/**
 * @typedef {object} ScratchEntry
 * @property {string} name      basename under tmpdir() (e.g. `minsky-gate-aB3`)
 * @property {string} path      absolute path
 * @property {number} mtimeMs   directory mtime (ms epoch)
 * @property {number | null} ownerPid  pid from the sentinel, or null if absent/unreadable
 */

/**
 * Pure: decide which leaked scratch dirs to garbage-collect at sweep start.
 * A dir is reclaimed only when it is BOTH (a) older than the vet timeout —
 * a live vet always finishes within `VET_TIMEOUT_MS`, so an older dir is a
 * leak — AND (b) not owned by a live pid. Either guard alone keeps a dir:
 * a young dir (in-flight vet) and a live-owned dir (running vet whose clock
 * the operator nudged) are both left untouched. This is the deterministic
 * rule-#10 substrate for the sweep-start GC — same inputs ⇒ same set, no I/O.
 *
 * The age threshold (`vetTimeoutMs`, not 2×) tracks the Pivot's coarser
 * fallback: when the pid signal is reliable both guards apply; the test that
 * pins the cross-platform `pidIsAlive` behaviour is the canary for dropping
 * to age-only.
 * @param {ScratchEntry[]} entries
 * @param {object} cfg
 * @param {number} cfg.now            ms epoch (injectable for tests)
 * @param {number} cfg.vetTimeoutMs   age threshold
 * @param {(pid: number) => boolean} cfg.isPidAlive  liveness probe (injectable)
 * @returns {string[]}  absolute paths to reclaim
 */
export function decideStaleScratch(entries, cfg) {
  const { now, vetTimeoutMs, isPidAlive } = cfg;
  return entries
    .filter((e) => {
      const olderThanTimeout = now - e.mtimeMs > vetTimeoutMs;
      const liveOwner = e.ownerPid !== null && isPidAlive(e.ownerPid);
      return olderThanTimeout && !liveOwner;
    })
    .map((e) => e.path);
}

/**
 * Read the tmpdir(), build a {@link ScratchEntry} per `minsky-gate-*` /
 * `minsky-land-*` dir. Pure-ish: only filesystem reads, no deletes. A dir
 * that vanishes between readdir and stat (a sibling sweep / OS reaper) is
 * skipped (rule #6 — a benign race must never crash the scan).
 * @param {string} dir  tmpdir()
 * @returns {ScratchEntry[]}
 */
function scanScratchDirs(dir) {
  /** @type {ScratchEntry[]} */
  const out = [];
  let names;
  try {
    names = readdirSync(dir);
    // rule-6: handled-locally — an unreadable tmpdir() yields no GC work; the sweep proceeds (cleanup never gates merging, rule #6).
  } catch {
    return out;
  }
  for (const name of names) {
    if (!SCRATCH_PREFIXES.some((p) => name.startsWith(p))) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isDirectory()) continue;
      out.push({ name, path, mtimeMs: st.mtimeMs, ownerPid: readOwnerPid(path) });
      // rule-6: handled-locally — a dir that vanished mid-scan (sibling sweep / OS reaper) is simply absent from the GC set; skip it.
    } catch {
      // raced away between readdir and stat — nothing to GC
    }
  }
  return out;
}

/**
 * Read the owner-pid sentinel from a scratch dir. Returns null when the
 * file is absent or unparseable (older leaked dirs predate the sentinel, or
 * a crash truncated it) — null ⇒ "unknown owner", which the age guard alone
 * then decides (rule #6 — a missing hint degrades to age-only, never crashes).
 * @param {string} scratch
 * @returns {number | null}
 */
function readOwnerPid(scratch) {
  try {
    const raw = readFileSync(join(scratch, OWNER_PID_FILE), "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
    // rule-6: handled-locally — absent/garbled sentinel ⇒ unknown owner (null); the age guard alone decides. Cleanup metadata read must never crash the sweep.
  } catch {
    return null;
  }
}

/**
 * Sweep-start garbage collect of leaked `minsky-gate-*` / `minsky-land-*`
 * scratch dirs under tmpdir(). Companion to `bestEffortRmScratch`'s per-vet
 * teardown: a SIGKILL'd / crashed / operator-process-killed vet skips its
 * `finally`, leaking a scratch dir that then (a) accumulates and (b) can
 * make a future sibling `rmSync` throw `ENOTEMPTY` against a half-gone dir.
 * Reclaiming the leaks at sweep START closes that durable-hygiene gap.
 *
 * Reuses `bestEffortRmScratch` for the actual delete so the same
 * race-tolerant teardown (one retry, then swallow) applies — a GC delete
 * that races a just-finished vet must never gate merging (rule #6, the dir
 * is OS-reaped tmpdir anyway). Returns the reclaimed paths for the log line
 * (rule #4 — the operator sees the housekeeping in `orchestrate.jsonl`).
 * @param {object} [io]
 * @param {string} [io.dir]                  tmpdir() (injectable for tests)
 * @param {number} [io.now]                  ms epoch (injectable for tests)
 * @param {number} [io.vetTimeoutMs]         age threshold
 * @param {(pid: number) => boolean} [io.isPidAlive]  liveness probe (injectable)
 * @param {(scratch: string) => void} [io.rm]  teardown (injectable for tests)
 * @returns {string[]}  reclaimed absolute paths
 */
export function gcStaleScratchDirs(io = {}) {
  const dir = io.dir ?? tmpdir();
  const stale = decideStaleScratch(scanScratchDirs(dir), {
    now: io.now ?? Date.now(),
    vetTimeoutMs: io.vetTimeoutMs ?? VET_TIMEOUT_MS,
    isPidAlive: io.isPidAlive ?? pidIsAlive,
  });
  const rm = io.rm ?? bestEffortRmScratch;
  for (const path of stale) rm(path);
  return stale;
}

/**
 * `git worktree list --porcelain` stdout, or `""` on probe error. Fail-open
 * to `""` so a probe failure is read as "no pin" — `defaultMerge` then keeps
 * `--delete-branch` and the post-hoc state oracle in `processOnePr` is still
 * the backstop if a pin existed after all (rule #6: an infra hiccup must
 * never make the merge over-cautious AND it must never silently swallow a
 * real failure).
 * @returns {string}
 */
function defaultWorktrees() {
  try {
    return execFileSync("git", ["-C", REPO, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
    });
    // rule-6: handled-locally — a worktree-list probe failure (git error/none) is read as "no pin"; `--delete-branch` stays and the state oracle backstops.
  } catch {
    return "";
  }
}

/**
 * Pure: the `gh pr merge` argv for one PR. `--delete-branch` is appended
 * only when the head branch is NOT worktree-pinned — a pinned branch's
 * local `git branch -d` would throw on already-merged-but-pinned refs, so
 * we leave its cleanup to the worktree teardown (rule #6). Extracted from
 * `defaultMerge` so the pin → argv decision is exercisable without spawning
 * `gh` (rule #2 / rule #10 — same input ⇒ same argv).
 * @param {PrSnapshot} pr
 * @param {boolean} pinned
 * @returns {string[]}
 */
export function mergeArgs(pr, pinned) {
  const args = ["pr", "merge", String(pr.number), "--squash", "--admin"];
  if (!pinned) args.push("--delete-branch");
  return args;
}

/**
 * Squash-admin-merge one PR. When the PR head branch is checked out in a
 * `git worktree` (the parallel-worker swarm provisions `.claude/worktrees/`
 * checkouts), the head ref is PINNED — `gh pr merge --delete-branch` would
 * server-merge fine but then throw on the local `git branch -d`. So we
 * detect the pin first and drop `--delete-branch` in that case, leaving the
 * incidental branch cleanup to be reaped when the worktree is torn down
 * (rule #6: cleanup never gates the merge result). Non-pinned branches keep
 * `--delete-branch` (the common path). `worktreesFn` is injected for tests.
 * @param {PrSnapshot} pr
 * @param {() => string} [worktreesFn]
 */
function defaultMerge(pr, worktreesFn = defaultWorktrees) {
  const pinned = headBranchPinnedByWorktree(worktreesFn(), pr.headRefName);
  execFileSync("gh", mergeArgs(pr, pinned), { cwd: REPO, encoding: "utf8" });
}

/**
 * Read a PR's GitHub state (MERGED / OPEN / CLOSED). Used as the
 * authoritative oracle for merge success when `defaultMerge` throws
 * because of a non-fatal local-side error (e.g. the post-merge
 * `git branch -d` rejects a branch bound to a `.claude/worktrees/`
 * worktree — the remote squash-merge already succeeded). Fix shape
 * for TASKS.md `local-gate-merge-false-negative-on-worktree-bound-
 * branch-delete`: never infer merge outcome from `gh pr merge`'s exit
 * code alone; verify against the remote state.
 *
 * @param {number} number
 * @returns {string | null}  the state string, or `null` on probe error
 */
function defaultPrState(number) {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", String(number), "--json", "state", "-q", ".state"],
      { cwd: REPO, encoding: "utf8" },
    );
    return out.trim();
  } catch {
    // Probe failed (network / auth / unknown PR). Caller treats `null`
    // the same as "not MERGED" so a genuine merge failure isn't masked.
    return null;
  }
}

/**
 * How many commits the local branch is ahead of `origin/main`. Fail-open:
 * if the ref or `origin/main` can't be counted, return 1 so the gate still
 * runs — a probe error must never be misread as "nothing to land" and
 * silently skip a real vet (rule #6).
 * @param {string} branchName
 * @returns {number}
 */
function defaultCommitsAhead(branchName) {
  try {
    const out = execFileSync(
      "git",
      ["-C", REPO, "rev-list", "--count", `origin/main..${branchName}`],
      { encoding: "utf8" },
    );
    return Number(out.trim());
    // rule-6: handled-locally — a missing origin/main or unknown ref must not be mistaken for an empty branch; fail-open to 1 so the deterministic vet stays the authority.
  } catch {
    return 1;
  }
}

/**
 * Clone the live repo (shared object store) and stage the LOCAL branch
 * merged onto `origin/main` inside `scratch`. A `git clone --shared` of the
 * local repo exposes every local ref as `origin/<branch>` BEFORE `origin`
 * is repointed at GitHub — so a never-pushed branch is reachable; pin it to
 * `land-src` first, then repoint + fetch authoritative main + merge.
 * @param {string} scratch
 * @param {string} branchName
 * @returns {{vetError: string} | null}  null ⇒ scratch is ready to gate
 */
function prepareScratchCloneForBranch(scratch, branchName) {
  execFileSync("git", ["clone", "--shared", "--quiet", REPO, scratch], { encoding: "utf8" });
  try {
    execFileSync("git", ["-C", scratch, "rev-parse", "--verify", `origin/${branchName}`], {
      encoding: "utf8",
    });
    // rule-6: handled-locally — a non-existent local branch is a caller error, not gate infra; surface it as a typed vetError so it never looks like a red gate.
  } catch {
    return { vetError: `local-branch-not-found: ${branchName}` };
  }
  execFileSync("git", ["-C", scratch, "branch", "land-src", `origin/${branchName}`], {
    encoding: "utf8",
  });
  const ghRemote = execFileSync("git", ["-C", REPO, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", scratch, "remote", "set-url", "origin", ghRemote], {
    encoding: "utf8",
  });
  execFileSync("git", ["-C", scratch, "fetch", "--quiet", "origin", "main"], { encoding: "utf8" });
  execFileSync("git", ["-C", scratch, "checkout", "--quiet", "-B", "gate", "origin/main"], {
    encoding: "utf8",
  });
  try {
    execFileSync("git", ["-C", scratch, "merge", "--no-edit", "land-src"], { encoding: "utf8" });
  } catch {
    return { vetError: "merge-onto-main-conflict" };
  }
  return installScratchDeps(scratch);
}

/**
 * Default local-branch vet: isolated `git clone --shared` scratch (NEVER an
 * in-repo worktree — that flips core.bare on the live repo), the branch
 * merged onto origin/main, full gate with --json. Mirrors `defaultVet`.
 * @param {string} branchName
 * @returns {{stdout: string} | {vetError: string}}
 */
function defaultVetLocalBranch(branchName) {
  const scratch = mkdtempSync(join(tmpdir(), "minsky-land-"));
  writeOwnerPid(scratch);
  const shed = decideLoadShed({
    niceness: VET_NICENESS,
    noWorkerPause: process.env["MINSKY_GATE_NO_WORKER_PAUSE"],
  });
  try {
    const prep = prepareScratchCloneForBranch(scratch, branchName);
    if (prep) return prep;
    const stdout = withWorkerPaused(shed.pauseWorker, () => runVetNiced(scratch, shed.niceness));
    return { stdout };
  } catch (err) {
    return vetErrorToResult(err);
  } finally {
    bestEffortRmScratch(scratch);
  }
}

/**
 * Default land: push the locally-vetted branch to origin, open its PR, and
 * admin-merge it — the exact `gh` primitive the orchestrator already uses
 * for worker branches (PRs #596–#602), now reachable for a non-worktree
 * contributor. `--fill` derives the PR title/body from the branch commits;
 * CI is disabled on this repo and the merge is `--admin`, so the scratch
 * `--stage=full` verdict (already green here) is the gate, not GitHub.
 * @param {string} branchName
 */
function defaultLandBranch(branchName) {
  execFileSync("git", ["-C", REPO, "push", "origin", `${branchName}:${branchName}`], {
    encoding: "utf8",
  });
  execFileSync("gh", ["pr", "create", "--head", branchName, "--base", "main", "--fill"], {
    cwd: REPO,
    encoding: "utf8",
  });
  execFileSync("gh", ["pr", "merge", branchName, "--squash", "--admin", "--delete-branch"], {
    cwd: REPO,
    encoding: "utf8",
  });
}

/**
 * Pure: is `headRefName` checked out in some `git worktree`? Parses the
 * stanza-per-worktree `git worktree list --porcelain` output — each stanza
 * is blank-line separated and carries a `branch refs/heads/<name>` line
 * when (and only when) that worktree holds a branch (a detached/bare
 * worktree carries `detached`/`bare` instead). A branch held by a worktree
 * pins its ref, so a post-merge `git branch -d <name>` (which `gh pr merge
 * --delete-branch` runs locally) FAILS with
 * `cannot delete branch '…' used by worktree at '…'` — the canonical
 * #580 false-negative (TASKS.md `gate-merge-delete-branch-vs-worktree-
 * pin`). Detecting the pin BEFORE the merge lets `defaultMerge` drop
 * `--delete-branch`, so the merge never throws on incidental cleanup
 * (rule #6: cleanup is best-effort, never gates the result) and the
 * conductor records `merged` directly — the proactive complement to the
 * post-hoc state-oracle recovery in `processOnePr`.
 * @param {string} porcelain  `git worktree list --porcelain` stdout
 * @param {string} headRefName  the PR head branch name (no `refs/heads/`)
 * @returns {boolean}
 */
export function headBranchPinnedByWorktree(porcelain, headRefName) {
  if (!headRefName) return false;
  const target = `refs/heads/${headRefName}`;
  for (const line of porcelain.split("\n")) {
    if (line.trim() === `branch ${target}`) return true;
  }
  return false;
}

/**
 * Pure: parse the Opus reviewer's reply. Fail-safe — anything that is not
 * an explicit `APPROVE` is a rejection (never merge on ambiguity).
 * @param {string} text
 * @returns {{approve: boolean, reason: string}}
 */
export function parseReview(text) {
  const first = (text.trim().split("\n")[0] ?? "").trim();
  const approve = /^APPROVE\b/i.test(first);
  const reason =
    first.replace(/^(APPROVE|REJECT)\b[:\-\s]*/i, "").slice(0, 160) ||
    (approve ? "approved" : "no reason given");
  return { approve, reason };
}

/**
 * The Opus brain (autonomous-opus "gated" call). Reviews a PR that has
 * ALREADY passed the deterministic `--stage=full` gate — judges intent,
 * hidden risk, and scope creep. Only invoked on gate-green PRs (cost
 * discipline). Fail-safe: any error ⇒ not approved ⇒ PR is not merged.
 * @param {PrSnapshot} pr
 * @returns {{approve: boolean, reason: string}}
 */
function defaultReview(pr) {
  let diff;
  try {
    diff = execFileSync("gh", ["pr", "diff", String(pr.number)], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).slice(0, 60000);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { approve: false, reason: `diff-fetch-failed: ${m.slice(0, 80)}` };
  }
  const rubric =
    'You are the Opus orchestrator reviewing a Sonnet-worker PR that ALREADY passed the full deterministic gate (typecheck, tests, every lint) merged onto main. Judge ONLY: correctness of intent, hidden risk, scope creep, and whether it does what its title claims. Reply with ONE line: "APPROVE: <=12-word reason" or "REJECT: <=12-word reason".';
  const prompt = `${rubric}\n\nTitle: ${pr.title}\n\nDiff (truncated):\n${diff}`;
  try {
    const out = execFileSync("claude", ["--print", "--model", "claude-opus-4-7", prompt], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseReview(out);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { approve: false, reason: `opus-review-error: ${m.slice(0, 80)}` };
  }
}

/**
 * Vet one PR (I/O via vetFn) and produce its merge decision. Extracted to
 * keep `runGateSweep` under biome's cognitive-complexity cap.
 * Opus review (`reviewFn`) is the brain and runs ONLY when the deterministic
 * gate is green (cost discipline); when omitted the gate is deterministic-only.
 * @param {PrSnapshot} pr
 * @param {(pr: PrSnapshot) => {stdout: string} | {vetError: string}} vetFn
 * @param {((pr: PrSnapshot) => {approve: boolean, reason: string}) | undefined} reviewFn
 * @returns {{action: "merge" | "skip", reason: string}}
 */
function vetAndDecide(pr, vetFn, reviewFn) {
  const vetRes = vetFn(pr);
  if ("vetError" in vetRes) {
    return decideMerge({
      pr,
      verdict: { green: false, failedSteps: [], sawSummary: false },
      vetError: vetRes.vetError,
    });
  }
  const verdict = parseGateVerdict(vetRes.stdout);
  if (verdict.green && reviewFn) {
    return decideMerge({ pr, verdict, review: reviewFn(pr) });
  }
  return decideMerge({ pr, verdict });
}

/**
 * @typedef {object} SweepCtx
 * @property {(pr: PrSnapshot) => {stdout: string} | {vetError: string}} vetFn
 * @property {((pr: PrSnapshot) => {approve: boolean, reason: string}) | undefined} reviewFn
 * @property {(pr: PrSnapshot) => void} mergeFn
 * @property {(number: number) => string | null} prStateFn
 * @property {boolean} dryRun
 * @property {(s: string) => void} log
 */

/**
 * Vet → decide → (dry-run log | merge) one PR.
 *
 * When `mergeFn` throws, the merge outcome is NOT inferred from the
 * exit code — instead the state oracle (`prStateFn`) is consulted.
 * The remote squash-merge can succeed even while the post-merge local
 * `git branch -d` rejects a branch checked out in a `.claude/worktrees/`
 * worktree (TASKS.md `local-gate-merge-false-negative-on-worktree-
 * bound-branch-delete`, observed 2026-05-17). If GitHub says state
 * == "MERGED", the merge succeeded — the local-delete failure is a
 * non-fatal cleanup issue. Otherwise the merge truly failed and the
 * caller records it as skipped.
 *
 * @param {PrSnapshot} pr
 * @param {SweepCtx} ctx
 * @returns {{outcome: "merged" | "skipped", number: number, reason: string}}
 */
function processOnePr(pr, ctx) {
  ctx.log(`  vetting #${pr.number} (${pr.title.slice(0, 60)})…\n`);
  const decision = vetAndDecide(pr, ctx.vetFn, ctx.reviewFn);
  if (decision.action !== "merge") {
    ctx.log(`  #${pr.number}: SKIP — ${decision.reason}\n`);
    return { outcome: "skipped", number: pr.number, reason: decision.reason };
  }
  if (ctx.dryRun) {
    ctx.log(`  #${pr.number}: WOULD MERGE — ${decision.reason}\n`);
    return { outcome: "merged", number: pr.number, reason: decision.reason };
  }
  try {
    ctx.mergeFn(pr);
    ctx.log(`  #${pr.number}: MERGED — ${decision.reason}\n`);
    return { outcome: "merged", number: pr.number, reason: decision.reason };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    // State oracle: was the remote merge actually successful despite
    // the non-zero exit? The worktree-bound-delete case is the
    // canonical mismatch (see TASKS.md task body for the 2026-05-17
    // reproduction). If state == "MERGED", report as merged; the
    // local-delete failure is recorded in `reason` so an operator
    // can still see + clean stale worktrees.
    const state = ctx.prStateFn(pr.number);
    if (state === "MERGED") {
      ctx.log(
        `  #${pr.number}: MERGED (remote ok; local-delete soft-fail: ${m.slice(0, 80)}) — ${decision.reason}\n`,
      );
      return {
        outcome: "merged",
        number: pr.number,
        reason: `${decision.reason} (local-delete soft-fail)`,
      };
    }
    ctx.log(`  #${pr.number}: merge call failed: ${m.slice(0, 160)}\n`);
    return { outcome: "skipped", number: pr.number, reason: `merge-failed: ${m.slice(0, 120)}` };
  }
}

/**
 * rule #9 ledger — best-effort one line per non-dry sweep for `--self-metric`.
 * @param {number[]} mergedNumbers
 * @param {number} skippedCount
 */
function appendLedger(mergedNumbers, skippedCount) {
  if (!existsSync(join(REPO, ".minsky"))) return;
  try {
    appendFileSync(
      LEDGER,
      `${JSON.stringify({ ts: new Date().toISOString(), merged: mergedNumbers, skipped: skippedCount })}\n`,
    );
  } catch {
    /* rule #6: ledger is best-effort, never gates the sweep */
  }
}

/**
 * Pure: fold the run ledger's NDJSON lines into the rule-#9 self-metric
 * snapshot. Each non-dry sweep appends one `{ts, merged:[…prNumbers], skipped}`
 * line (see `appendLedger`); this reads them back. Counterpart to the header's
 * documented `--self-metric` contract — the deterministic measurement the
 * task's pre-registration cites (Beyer SRE 2016 Ch. 6: the gate's effect must
 * be observable from a durable ledger, not inferred). Garbage / non-object /
 * unparseable lines are skipped (rule #6: a corrupt ledger line must never
 * crash the metric reader — the ledger is best-effort by construction).
 * @param {string[]} lines
 * @returns {{sweeps: number, merged: number, skipped: number, mergedPrs: number[]}}
 */
export function summarizeLedger(lines) {
  let sweeps = 0;
  let skipped = 0;
  /** @type {number[]} */
  const mergedPrs = [];
  for (const line of lines) {
    const obj = parseJsonLine(line);
    if (!obj) continue;
    sweeps += 1;
    mergedPrs.push(...mergedPrNumbers(obj["merged"]));
    skipped += typeof obj["skipped"] === "number" ? obj["skipped"] : 0;
  }
  return { sweeps, merged: mergedPrs.length, skipped, mergedPrs };
}

/**
 * Pure: the numeric PR numbers from one ledger line's `merged` field. A
 * malformed value (non-array, or array with non-number entries) yields only
 * the numbers — extracted so `summarizeLedger` stays under biome's cognitive-
 * complexity cap (the same extraction discipline `parseGateVerdict` uses).
 * @param {unknown} merged
 * @returns {number[]}
 */
function mergedPrNumbers(merged) {
  if (!Array.isArray(merged)) return [];
  return merged.filter((n) => typeof n === "number");
}

/**
 * `--self-metric` reader: load the ledger from disk (NDJSON), summarise, and
 * return the snapshot. Fail-soft — a missing ledger (gate never ran) yields
 * the zero snapshot rather than throwing, so the operator metric command
 * always prints a verdict (rule #6: the reader never crashes the operator).
 * @param {string} [ledgerPath]
 * @returns {{sweeps: number, merged: number, skipped: number, mergedPrs: number[]}}
 */
export function readSelfMetric(ledgerPath = LEDGER) {
  if (!existsSync(ledgerPath)) return { sweeps: 0, merged: 0, skipped: 0, mergedPrs: [] };
  let raw = "";
  try {
    raw = readFileSync(ledgerPath, "utf8");
    // rule-6: handled-locally — an unreadable ledger (perms/race) must not crash the metric reader; fall back to the zero snapshot so `--self-metric` always prints.
  } catch {
    return { sweeps: 0, merged: 0, skipped: 0, mergedPrs: [] };
  }
  return summarizeLedger(raw.split("\n"));
}

/**
 * @typedef {object} RunGateOpts
 * @property {boolean} [dryRun]
 * @property {number} [limit]
 * @property {number} [onlyPr]
 * @property {() => PrSnapshot[]} [snapshotFn]
 * @property {(pr: PrSnapshot) => {stdout: string} | {vetError: string}} [vetFn]
 * @property {(pr: PrSnapshot) => {approve: boolean, reason: string}} [reviewFn]
 * @property {boolean} [noReview]  deterministic-only mode (skip the Opus brain)
 * @property {(pr: PrSnapshot) => void} [mergeFn]
 * @property {(number: number) => string | null} [prStateFn]  state oracle when mergeFn throws (default: `gh pr view --json state`)
 * @property {() => string[]} [gcFn]  sweep-start scratch-dir GC (default: `gcStaleScratchDirs`)
 * @property {(s: string) => void} [log]
 */

/**
 * Resolve I/O defaults + select the candidate PRs. Extracted so
 * `runGateSweep` stays under biome's cognitive-complexity cap.
 * @param {RunGateOpts} opts
 * @returns {{ctx: SweepCtx, candidates: PrSnapshot[]}}
 */
function prepareSweep(opts) {
  /** @type {SweepCtx} */
  const ctx = {
    vetFn: opts.vetFn ?? defaultVet,
    reviewFn: opts.noReview ? undefined : (opts.reviewFn ?? defaultReview),
    mergeFn: opts.mergeFn ?? defaultMerge,
    prStateFn: opts.prStateFn ?? defaultPrState,
    dryRun: opts.dryRun === true,
    log: opts.log ?? ((s) => process.stdout.write(s)),
  };
  let candidates = pickGateCandidates((opts.snapshotFn ?? defaultSnapshot)());
  if (opts.onlyPr !== undefined) {
    candidates = candidates.filter((p) => p.number === opts.onlyPr);
  }
  return { ctx, candidates: candidates.slice(0, opts.limit ?? 5) };
}

/**
 * Sweep-start hygiene: reclaim leaked scratch dirs from crashed/SIGKILL'd
 * vets before this sweep allocates its own (rule #6 — housekeeping, never
 * gates the loop). Skipped in dry-run so a `--dry-run` probe is read-only.
 * Extracted from `runGateSweep` to keep it under biome's cognitive-complexity
 * cap.
 * @param {SweepCtx} ctx
 * @param {RunGateOpts} opts
 */
function runSweepStartGc(ctx, opts) {
  if (ctx.dryRun) return;
  const reclaimed = (opts.gcFn ?? gcStaleScratchDirs)();
  if (reclaimed.length > 0) {
    ctx.log(`local-gate-merge: gc reclaimed ${reclaimed.length} stale scratch dir(s)\n`);
  }
}

/**
 * Sweep entrypoint. Pure decisions; I/O via the (injectable) seam.
 * @param {RunGateOpts} [opts]
 */
export function runGateSweep(opts = {}) {
  const { ctx, candidates } = prepareSweep(opts);
  runSweepStartGc(ctx, opts);
  if (candidates.length === 0) {
    ctx.log("local-gate-merge: 0 candidate PRs\n");
    return { merged: [], skipped: [] };
  }
  ctx.log(
    `local-gate-merge: ${candidates.length} candidate PR(s)${ctx.dryRun ? " (dry-run)" : ""}\n`,
  );

  const merged = [];
  const skipped = [];
  for (const pr of candidates) {
    const r = processOnePr(pr, ctx);
    if (r.outcome === "merged") merged.push({ number: r.number, reason: r.reason });
    else skipped.push({ number: r.number, reason: r.reason });
  }
  if (!ctx.dryRun) {
    appendLedger(
      merged.map((m) => m.number),
      skipped.length,
    );
  }
  return { merged, skipped };
}

/**
 * @typedef {object} LandLocalOpts
 * @property {string | undefined} [branchName]
 * @property {boolean} [dryRun]
 * @property {boolean} [noReview]
 * @property {(branchName: string) => number} [commitsAheadFn]
 * @property {(branchName: string) => {stdout: string} | {vetError: string}} [vetFn]
 * @property {(branchName: string) => {approve: boolean, reason: string}} [reviewFn]
 * @property {(branchName: string) => void} [landFn]
 * @property {(s: string) => void} [log]
 */

/**
 * Pure: collapse a vet result (gate stdout or vetError) plus the optional
 * Opus review into the land decision. Extracted from `landLocalBranch` so
 * that function stays within the cognitive-complexity budget and this
 * branch-resolution logic is independently exercisable (rule #2 — the
 * seam stays pure and testable; same input ⇒ same verdict, rule #10).
 * @param {{stdout: string} | {vetError: string}} vetRes
 * @param {{
 *   branchName: string,
 *   noReview?: boolean | undefined,
 *   reviewFn?: ((branchName: string) => {approve: boolean, reason: string}) | undefined,
 * }} cfg
 * @returns {{action: "land" | "abort", reason: string}}
 */
export function decideLandFromVet(vetRes, cfg) {
  if ("vetError" in vetRes) {
    return decideLand({
      verdict: { green: false, failedSteps: [], sawSummary: false },
      vetError: vetRes.vetError,
    });
  }
  const verdict = parseGateVerdict(vetRes.stdout);
  const reviewFn = cfg.noReview ? undefined : cfg.reviewFn;
  if (verdict.green && reviewFn) {
    return decideLand({ verdict, review: reviewFn(cfg.branchName) });
  }
  return decideLand({ verdict });
}

/**
 * Side-effecting land step isolated from `landLocalBranch` so that
 * function's cognitive complexity stays within the linter budget. Push +
 * open PR + admin-merge via the injected (or default) land fn; a thrown
 * land call is reported, never crashes the conductor (rule #6 — handled
 * locally, the deterministic gate already authorised the land).
 * @param {string} branchName
 * @param {((branchName: string) => void) | undefined} landFn
 * @param {(s: string) => void} log
 * @param {string} reason
 * @returns {{outcome: "landed" | "aborted", reason: string}}
 */
function executeLand(branchName, landFn, log, reason) {
  try {
    (landFn ?? defaultLandBranch)(branchName);
    log(`land-local ${branchName}: LANDED — ${reason}\n`);
    return { outcome: "landed", reason };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    log(`land-local ${branchName}: land call failed: ${m.slice(0, 160)}\n`);
    return { outcome: "aborted", reason: `land-failed: ${m.slice(0, 120)}` };
  }
}

/**
 * Take a fully-committed LOCAL branch green through the same scratch
 * `--stage=full` gate the worker PR path runs, then push + open PR +
 * admin-merge it. Pure decisions (`decidePreflight`, `parseGateVerdict`,
 * `decideLand`) over an injectable I/O seam (rule #2 / rule #10 — same
 * input ⇒ same verdict, no model in the land decision). The deterministic
 * gate is always the authority; an Opus brain runs only when a `reviewFn`
 * is supplied (deterministic-only by default — `local-gate-merge` already
 * supports `--no-review`; the local-branch Opus review wires in a follow-up).
 * @param {LandLocalOpts} opts
 * @returns {{outcome: "landed" | "aborted", reason: string}}
 */
export function landLocalBranch(opts) {
  const log = opts.log ?? ((s) => process.stdout.write(s));
  const branchName = opts.branchName;
  if (!branchName) {
    log("land-local: no branch name given\n");
    return { outcome: "aborted", reason: "no-branch-name" };
  }
  // skip-earlier gate: a branch with nothing ahead of origin/main can never
  // land — elide the ~20-min scratch clone + pnpm install + --stage=full vet.
  const pre = decidePreflight((opts.commitsAheadFn ?? defaultCommitsAhead)(branchName));
  if (!pre.proceed) {
    log(`land-local ${branchName}: ABORT — ${pre.reason}\n`);
    return { outcome: "aborted", reason: pre.reason };
  }
  log(`land-local ${branchName}: ${pre.reason}; vetting via scratch --stage=full…\n`);
  const vetRes = (opts.vetFn ?? defaultVetLocalBranch)(branchName);
  const decision = decideLandFromVet(vetRes, {
    branchName,
    noReview: opts.noReview,
    reviewFn: opts.reviewFn,
  });
  if (decision.action !== "land") {
    log(`land-local ${branchName}: ABORT — ${decision.reason}\n`);
    return { outcome: "aborted", reason: decision.reason };
  }
  if (opts.dryRun) {
    log(`land-local ${branchName}: WOULD LAND — ${decision.reason}\n`);
    return { outcome: "landed", reason: decision.reason };
  }
  return executeLand(branchName, opts.landFn, log, decision.reason);
}

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noReview = args.includes("--no-review");
  if (args.includes("--self-metric")) {
    process.stdout.write(`${JSON.stringify(readSelfMetric())}\n`);
  } else if (args[0] === "land-local") {
    const branchName = args[1];
    const res = landLocalBranch({ branchName, dryRun, noReview });
    process.stdout.write(
      `local-gate-merge: land-local ${branchName ?? "(none)"} — ${res.outcome} (${res.reason})\n`,
    );
  } else {
    const limArg = args.find((a) => a.startsWith("--limit="));
    const prArg = args.find((a) => a.startsWith("--pr="));
    /** @type {{dryRun: boolean, noReview: boolean, limit?: number, onlyPr?: number}} */
    const opts = { dryRun, noReview };
    if (limArg) opts.limit = Number(limArg.split("=")[1]);
    if (prArg) opts.onlyPr = Number(prArg.split("=")[1]);
    const res = runGateSweep(opts);
    process.stdout.write(
      `local-gate-merge: done — merged=${res.merged.length} skipped=${res.skipped.length}\n`,
    );
  }
}
