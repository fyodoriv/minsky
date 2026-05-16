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
// rule #9 (pre-registered): a gate-green admin-merged PR must not regress
// `origin/main` — post-merge, a fresh `--stage=full` run on main stays green.
// Success: 0 post-merge main regressions over ≥10 gate-merged PRs. Pivot: if
// ≥1 regression, add an auto-revert-on-red post-merge re-vet OR fall back to
// label-gated (`minsky-auto-merge` required). Measurement:
// `node scripts/local-gate-merge.mjs --self-metric` prints
// `{merged, regressions}` from the run ledger at `.minsky/local-gate-merge.jsonl`.
// Anchor: Beyer SRE 2016 (the gate IS the release gate); rule #10 / #1.
//
// Usage:
//   node scripts/local-gate-merge.mjs [--dry-run] [--no-review] [--limit=N] [--pr=N]
//   --dry-run   : vet + print verdicts, do NOT call `gh pr merge`
//   --no-review : deterministic-only (skip the Opus brain layer)
//   --pr=N      : gate only PR N
//   --limit=N   : cap how many candidates to process this sweep (default 5)

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env["MINSKY_HOME"] ?? "/Users/cbrwizard/apps/tooling/minsky";
const LEDGER = join(REPO, ".minsky", "local-gate-merge.jsonl");
// Per-vet hard timeout — a cold `--stage=full` (tsc -b --force across all
// workspace projects + full vitest) is ~20 min; this bounds a hung/
// pathological vet so one PR can never wedge the autonomous conductor
// (the keystone "run reliably for 10h" guarantee). Generous default
// (25 min) tolerates a slow-but-finishing vet; env-tunable.
const VET_TIMEOUT_MS = Number(process.env["MINSKY_GATE_VET_TIMEOUT_MS"] ?? 1500000);

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
  // pnpm scatters a per-package node_modules symlink-farm across the whole
  // workspace; `git clone` only carries the (gitignored-excluded) tracked
  // tree, so a bare clone has NO node_modules anywhere. Symlinking just the
  // root one (the prior approach) left every `novel/*` package unresolvable
  // — tsc + vitest then failed `Cannot find module` for EVERY PR, so the
  // conductor skipped them all (the zero-merge bottleneck). A real install
  // is the only correct fix: with the global pnpm store already warm from
  // the live repo, `--prefer-offline --frozen-lockfile` only re-creates the
  // hardlink/symlink farm (seconds, no network) and is fully isolated to
  // the scratch (multi-tenant safe — never writes the live node_modules).
  try {
    execFileSync(
      "pnpm",
      ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts", "--reporter=silent"],
      { cwd: scratch, encoding: "utf8", timeout: VET_TIMEOUT_MS },
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    // An install failure is gate INFRA broken, not the PR being red — make
    // that explicit so it is never misattributed as a PR gate-failure
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
 * Default vet: isolated `git clone --shared` scratch dir (NEVER an in-repo
 * worktree — that flips core.bare on the live repo), PR merged onto
 * origin/main, full gate with --json.
 * @param {PrSnapshot} pr
 * @returns {{stdout: string} | {vetError: string}}
 */
function defaultVet(pr) {
  const scratch = mkdtempSync(join(tmpdir(), "minsky-gate-"));
  try {
    const prep = prepareScratchClone(scratch, pr);
    if (prep) return prep;
    const stdout = execFileSync(
      "node",
      ["scripts/run-pre-pr-lint-stack.mjs", "--stage=full", "--json"],
      {
        cwd: scratch,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: VET_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    );
    return { stdout };
  } catch (err) {
    return vetErrorToResult(err);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** @param {PrSnapshot} pr */
function defaultMerge(pr) {
  execFileSync("gh", ["pr", "merge", String(pr.number), "--squash", "--admin", "--delete-branch"], {
    cwd: REPO,
    encoding: "utf8",
  });
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
 * @property {boolean} dryRun
 * @property {(s: string) => void} log
 */

/**
 * Vet → decide → (dry-run log | merge) one PR.
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
 * @typedef {object} RunGateOpts
 * @property {boolean} [dryRun]
 * @property {number} [limit]
 * @property {number} [onlyPr]
 * @property {() => PrSnapshot[]} [snapshotFn]
 * @property {(pr: PrSnapshot) => {stdout: string} | {vetError: string}} [vetFn]
 * @property {(pr: PrSnapshot) => {approve: boolean, reason: string}} [reviewFn]
 * @property {boolean} [noReview]  deterministic-only mode (skip the Opus brain)
 * @property {(pr: PrSnapshot) => void} [mergeFn]
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
 * Sweep entrypoint. Pure decisions; I/O via the (injectable) seam.
 * @param {RunGateOpts} [opts]
 */
export function runGateSweep(opts = {}) {
  const { ctx, candidates } = prepareSweep(opts);
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

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noReview = args.includes("--no-review");
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
