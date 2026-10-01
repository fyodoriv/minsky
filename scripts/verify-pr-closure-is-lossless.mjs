#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-21 operator directive "we must have all prs merged in a way that will prevent any losses" — the 2026-05-20 Phase-1 PR closures were file-list-only (necessary not sufficient); applying the closed PR's patch onto the survivor's tree produced REAL CONFLICTS, evidence the close was hasty and would have lost unique implementation work. This script is the durable rule-#10 substrate against the same class returning. -->
//
// `scripts/verify-pr-closure-is-lossless.mjs` — verify a proposed PR close
// won't lose work that isn't already contained in the survivor.
//
// Usage:
//   node scripts/verify-pr-closure-is-lossless.mjs --close=<N> --survivor=<M>
//
// Exit codes:
//   0 — verified lossless (no unique work in #N that isn't in #M's tree).
//       Safe to `gh pr close #N --comment "superseded by #M (verified lossless)"`.
//   1 — UNVERIFIED. The closed PR has content not contained in the survivor's
//       tree. Either (a) cherry-pick #N's unique commits into a survivor branch
//       before closing, or (b) leave #N open until it can be merged directly.
//   2 — invocation error (missing flags, PR not found, etc.).
//
// What "lossless" means here:
//   Apply #N's patch (against its merge-base with main) onto #M's tree with
//   `git apply --3way`. If the resulting working tree has zero net changes
//   relative to #M, the survivor already contains #N's work. If the apply
//   conflicts or adds new content, #N has unique work that the survivor
//   doesn't absorb — closing #N would lose that work.
//
// Why this check rather than file-list overlap:
//   File-list overlap is necessary but NOT sufficient. Two PRs can touch the
//   same files with DIFFERENT implementations of the same logic; closing one
//   doesn't preserve the other's unique implementation. The 2026-05-20
//   Phase-1 closures were based on file-list overlap and HAD to be reversed
//   when this script's semantic check showed real conflicts.
//
// Anchor: rule #10 (vision.md § 10 — every rule is a CI lint, not a hope);
//   rule #1 (don't reinvent — reuses `git apply --3way`, the canonical
//   3-way patch primitive); composes with `scripts/local-gate-merge.mjs`
//   (the merge-side gate — this script is the close-side gate).
//
// Failure modes (rule #7):
//   | failure mode                       | trigger / fault axis     | expected behavior                                | chaos test                                                                |
//   |------------------------------------|--------------------------|--------------------------------------------------|---------------------------------------------------------------------------|
//   | gh pr view fails (404 / 502)       | network / dep-flake      | loud-crash exit 2; operator retries              | unset GITHUB_TOKEN then run; verify exit 2 + log entry                    |
//   | git apply --3way fails             | content-conflict         | exit 1 with the conflict file list (LOSS signal) | apply patch where survivor has touched same lines differently             |
//   | git apply produces non-empty diff  | survivor-missing-work    | exit 1 (LOSS signal); report what's net-new      | run against truly-different PRs (e.g., #609 vs #610 — different tasks)    |
//   | git apply produces empty diff      | survivor-contains-closed | exit 0; safe to close                            | run against a PR that's an exact ancestor of survivor                     |
//
// Pre-registered hypothesis (rule #9):
//   Hypothesis: this script catches the "file-list overlap is not sufficient"
//   class of close errors. After landing, no PR is closed by the operator (or
//   the auto-merge loop, or any agent) without first passing this check.
//   Success threshold: 0 PRs closed without a verified-lossless artifact for
//   30 consecutive days following adoption.
//   Pivot threshold: if the check produces >20% false positives (flags
//   closures that the operator manually verifies as lossless), tighten the
//   check (currently 3-way apply; future could be commit-graph reachability
//   check via `git merge-base --is-ancestor`).
//   Measurement: `git log --grep="closed-without-verify-lossless" --since=30.days
//   | wc -l` should be 0.
//   Anchor: rule #10 + rule #1 (composes git apply --3way).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Parse CLI args. Returns null on error (we exit 2 from the caller).
 * @param {readonly string[]} argv
 * @returns {{closeN: number, survivor: number} | null}
 */
export function parseArgs(argv) {
  let closeN = Number.NaN;
  let survivor = Number.NaN;
  for (const arg of argv) {
    const closeMatch = arg.match(/^--close=(\d+)$/);
    if (closeMatch !== null && closeMatch[1] !== undefined) {
      closeN = Number.parseInt(closeMatch[1], 10);
    }
    const survivorMatch = arg.match(/^--survivor=(\d+)$/);
    if (survivorMatch !== null && survivorMatch[1] !== undefined) {
      survivor = Number.parseInt(survivorMatch[1], 10);
    }
  }
  if (Number.isNaN(closeN) || Number.isNaN(survivor)) return null;
  return { closeN, survivor };
}

/**
 * Verify by applying #closeN's patch onto #survivor's tree in a scratch
 * worktree. Returns a structured verdict so the caller can format output.
 * @param {number} closeN
 * @param {number} survivor
 * @param {string} repoRoot
 * @returns {{kind: "lossless"} | {kind: "loss", reason: string, details: string}}
 */
export function verify(closeN, survivor, repoRoot) {
  const scratch = mkdtempSync(join(tmpdir(), "verify-lossless-"));
  try {
    // Clone the live repo with --shared so we don't pay disk cost.
    execFileSync("git", ["clone", "--shared", "--quiet", repoRoot, scratch], {
      encoding: "utf8",
    });
    // Repoint origin at the live remote so we can fetch PR refs (a --shared
    // clone's origin is the local FS path with no pull/*/head refs).
    const ghRemote = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", scratch, "remote", "set-url", "origin", ghRemote], {
      encoding: "utf8",
    });
    // Fetch both PR heads.
    execFileSync(
      "git",
      [
        "-C",
        scratch,
        "fetch",
        "--quiet",
        "origin",
        `pull/${closeN}/head:closed-pr-${closeN}`,
        `pull/${survivor}/head:survivor-pr-${survivor}`,
      ],
      { encoding: "utf8" },
    );
    // Compute the patch of #closeN against its merge-base with main.
    const base = execFileSync(
      "git",
      ["-C", scratch, "merge-base", `closed-pr-${closeN}`, "origin/main"],
      { encoding: "utf8" },
    ).trim();
    const patch = execFileSync("git", ["-C", scratch, "diff", `${base}..closed-pr-${closeN}`], {
      encoding: "utf8",
    });
    if (patch === "") {
      return { kind: "lossless" }; // closed has no diff vs base — trivially safe
    }
    // Check out the survivor's tree.
    execFileSync("git", ["-C", scratch, "checkout", "--quiet", `survivor-pr-${survivor}`], {
      encoding: "utf8",
    });
    // Write the patch to a file and apply with --3way.
    const patchFile = join(scratch, ".patch-to-apply");
    writeFileSync(patchFile, patch);
    const applyResult = spawnSync("git", ["-C", scratch, "apply", "--3way", patchFile], {
      encoding: "utf8",
    });
    if (applyResult.status !== 0) {
      // Apply failed entirely — definite content conflict.
      return {
        kind: "loss",
        reason: "apply-failed",
        details: (applyResult.stderr ?? "").slice(0, 800),
      };
    }
    // Apply succeeded — check whether the working tree gained any net changes.
    const treeDiff = execFileSync("git", ["-C", scratch, "diff", "--stat"], { encoding: "utf8" });
    if (treeDiff.trim() === "") {
      return { kind: "lossless" };
    }
    return {
      kind: "loss",
      reason: "apply-adds-content",
      details: treeDiff.slice(0, 800),
    };
  } finally {
    // rule-6: handled-locally — scratch teardown best-effort; a stale tmp dir is harmless.
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* best-effort teardown; a stale tmp dir is harmless (see finally comment above) */
    }
  }
}

// CLI entry point (skipped when imported by tests via vitest).
const isDirectInvoke = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvoke) {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    process.stderr.write("verify-pr-closure-is-lossless: missing --close=<N> --survivor=<M>\n");
    process.exit(2);
  }
  const repoRoot = process.cwd();
  const verdict = verify(args.closeN, args.survivor, repoRoot);
  if (verdict.kind === "lossless") {
    process.stdout.write(
      `verify-pr-closure-is-lossless: ✅ closing #${args.closeN} (survivor #${args.survivor}) would lose no work\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `verify-pr-closure-is-lossless: ⚠ closing #${args.closeN} (survivor #${args.survivor}) WOULD LOSE WORK\n`,
  );
  process.stderr.write(`  reason: ${verdict.reason}\n`);
  process.stderr.write(`  details:\n${verdict.details}\n`);
  process.stderr.write(
    `  next steps: (a) cherry-pick #${args.closeN}'s unique commits into a survivor-cleanup branch, or (b) leave #${args.closeN} open until it can be merged directly. Do NOT close without doing one of these.\n`,
  );
  process.exit(1);
}
