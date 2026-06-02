#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved gate-scratch-resolvable-ratchet: ratchet so the zero-merge scratch-resolution regression cannot recur silently -->
//
// Pattern: deterministic CI ratchet — structural invariant on a load-bearing
//   script (Nygard 2018 *Release It!* Stability-pattern regression guard).
// Source: rule #10 (vision.md § 10 — deterministic enforcement / ratchet:
//   every constitutional guarantee is pinned by a deterministic check, never
//   "the agent will remember"); global rule "every bug becomes a rule —
//   prevent the category, not the instance".
// Conformance: full — pure string analysis of the gate's own source, no LLM
//   in the chain, no network, no scratch clone (sub-second).
//
// Why this gate exists (the `gate-scratch-resolvable-ratchet` incident): the
// Opus orchestrator once merged 0 PRs across every tick. Root cause:
// `scripts/local-gate-merge.mjs` `prepareScratchClone` symlinked only the ROOT
// `node_modules`, but pnpm scatters a per-package `node_modules` symlink-farm
// across the whole workspace. A `git clone` scratch therefore had no nested
// `node_modules`, so `tsc -b` and `vitest` failed `Cannot find module` /
// `Failed to load url` for EVERY PR → the conductor correctly-but-uselessly
// skipped all of them. The bug was silent because an infra-broken vet was
// misattributed as a per-PR gate-red. It was fixed by replacing the root-only
// symlink with an isolated `pnpm install --frozen-lockfile --prefer-offline
// --ignore-scripts` (warm store ⇒ seconds). This ratchet makes the class
// one-way: if a future edit reverts the scratch-prep to a bare root-only
// `node_modules` symlink (or otherwise drops the real install), the gate goes
// red at PR time instead of the recurrence mode being "silent until a human
// notices 0 merges".
//
// Why structural, not a live scratch: standing up a real `git clone --shared`
// + `pnpm install` inside `npm run verify` would cost >30s and need the
// network/warm-store — the task's documented Pivot threshold. The invariant
// the live scratch would prove ("a scratch yields a module-resolvable
// workspace") reduces to two structural facts about the gate's own source:
//   (1) the scratch-prep funnels through a single `installScratchDeps` seam
//       that runs a real `pnpm install --frozen-lockfile` (NOT a bare
//       root-only `node_modules` symlink), and
//   (2) both scratch-prep entry points (`prepareScratchClone` for the PR vet
//       and `prepareScratchCloneForBranch` for the local-branch vet) route
//       through that seam.
// Asserting these is the same guarantee at sub-second cost (rule #10: when a
// rule resists cheap mechanisation, assert the structural substrate).
//
// Exit codes:
//   0 — the gate source satisfies both invariants.
//   1 — an invariant is violated (the regression class has returned); the
//       message names which invariant and how to restore it.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const GATE_SOURCE_PATH = resolve(REPO_ROOT, "scripts/local-gate-merge.mjs");

/**
 * The resolution-correct scratch-install seam must run a real `pnpm install`
 * with `--frozen-lockfile`. A bare root-only `node_modules` symlink (the
 * zero-merge regression) leaves every nested workspace package unresolvable.
 * Matched loosely on the two load-bearing tokens so a benign re-ordering of
 * the other install flags (`--prefer-offline`, `--ignore-scripts`) doesn't
 * flap the gate — only dropping the real install does.
 */
const REAL_INSTALL_RE = /["']install["'][\s\S]{0,120}?["']--frozen-lockfile["']/;

/**
 * A symlink-only shortcut for the workspace `node_modules` is the exact shape
 * of the regression. `symlinkSync(...node_modules...)` (or `ln -s` shelled out
 * via `execFileSync`) inside the scratch-prep means the install was replaced
 * by a symlink farm again.
 */
const SYMLINK_NODE_MODULES_RE =
  /symlink[a-zA-Z]*\([^)]*node_modules|["']ln["']\s*,\s*\[[^\]]*-s[^\]]*node_modules/;

/**
 * The two scratch-prep entry points that MUST route through the install seam.
 * `prepareScratchClone` = the open-PR vet; `prepareScratchCloneForBranch` =
 * the local-branch land vet. If either stops calling `installScratchDeps`,
 * that path can produce an unresolvable scratch.
 */
const SCRATCH_PREP_ENTRY_POINTS = Object.freeze([
  "prepareScratchClone",
  "prepareScratchCloneForBranch",
]);

const INSTALL_SEAM = "installScratchDeps";

/**
 * Pure check: does the gate source preserve a module-resolvable scratch?
 *
 * @param {string} gateSource  the contents of `scripts/local-gate-merge.mjs`
 * @returns {{ ok: true } | { ok: false, violations: string[] }}
 */
export function checkGateScratchResolvable(gateSource) {
  /** @type {string[]} */
  const violations = [];

  // Invariant 1a: a real install seam exists.
  if (!REAL_INSTALL_RE.test(gateSource)) {
    violations.push(
      "scratch-prep no longer runs a real `pnpm install --frozen-lockfile` — a `git clone` scratch has NO nested workspace node_modules, so tsc/vitest fail `Cannot find module` for EVERY candidate (the zero-merge regression). Restore the install in `installScratchDeps`.",
    );
  }

  // Invariant 1b: the install was NOT replaced by a root-only symlink.
  if (SYMLINK_NODE_MODULES_RE.test(gateSource)) {
    violations.push(
      "scratch-prep symlinks `node_modules` instead of installing — pnpm scatters a per-package symlink-farm across the workspace, so a root-only `node_modules` symlink leaves every `novel/*` package unresolvable. Replace the symlink with `pnpm install --frozen-lockfile` in `installScratchDeps`.",
    );
  }

  // Invariant 2: every scratch-prep entry point routes through the seam.
  violations.push(...entryPointViolations(gateSource));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true };
}

/**
 * Invariant 2: the shared install seam exists AND every scratch-prep entry
 * point routes through it. Extracted from `checkGateScratchResolvable` to keep
 * that function within biome's cognitive-complexity budget (rule #2 — one
 * concern per function).
 *
 * @param {string} gateSource
 * @returns {string[]}  zero-length when the invariant holds
 */
function entryPointViolations(gateSource) {
  if (!gateSource.includes(`function ${INSTALL_SEAM}`)) {
    return [
      `the shared install seam \`${INSTALL_SEAM}\` is gone — both scratch-prep paths depend on it to produce a resolvable workspace. Re-introduce \`function ${INSTALL_SEAM}\` (rule #1: one seam).`,
    ];
  }
  /** @type {string[]} */
  const out = [];
  for (const entry of SCRATCH_PREP_ENTRY_POINTS) {
    const body = scratchPrepBody(gateSource, entry);
    if (body === null) {
      out.push(
        `scratch-prep entry point \`${entry}\` is missing — the vet path it backs (PR vet / local-branch vet) cannot produce a resolvable scratch.`,
      );
    } else if (!body.includes(INSTALL_SEAM)) {
      out.push(
        `\`${entry}\` no longer calls \`${INSTALL_SEAM}\` — its scratch is built without installing deps and is unresolvable. End the function with \`return ${INSTALL_SEAM}(scratch);\`.`,
      );
    }
  }
  return out;
}

/**
 * Slice out a named function's body from the gate source so the entry-point
 * check inspects only that function (not an unrelated mention elsewhere).
 * Brace-balanced from the function's opening `{`. Returns null if the function
 * isn't declared.
 *
 * @param {string} source
 * @param {string} fnName
 * @returns {string | null}
 */
function scratchPrepBody(source, fnName) {
  const decl = source.indexOf(`function ${fnName}`);
  if (decl < 0) return null;
  const open = source.indexOf("{", decl);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-gate-scratch-resolvable.mjs");
if (invokedDirectly) {
  const gateSource = readFileSync(GATE_SOURCE_PATH, "utf8");
  const result = checkGateScratchResolvable(gateSource);
  if (result.ok) {
    process.stdout.write(
      "gate-scratch-resolvable ok: local-gate-merge.mjs builds a module-resolvable scratch (real `pnpm install`, no root-only symlink, both prep paths route through installScratchDeps).\n",
    );
    process.exit(0);
  }
  process.stderr.write(
    `gate-scratch-resolvable violation(s) — the zero-merge scratch-resolution regression class has returned:\n${result.violations
      .map((v) => `  - ${v}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}
