#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements parent task `commit-hook-chain-node-version-and-platform-resilience` § Details (a)+(d) slice 1 — node-version + platform-binary classifier and the loud pre-commit assertion -->
// Slice 1 of `commit-hook-chain-node-version-and-platform-resilience`
// (TASKS.md): the pure toolchain classifier + a thin CLI that asserts the
// hook chain can actually run, hard-failing with ONE operator-actionable
// line instead of the opaque `MODULE_NOT_FOUND` stack trace that silently
// 100%-blocked every commit fleet-wide on 2026-05-17.
//
// Two compounding root causes were observed live that day (TASKS.md §
// Surfaced-by / § Anchor):
//
//   1. Platform incompleteness — the host was `Darwin arm64` but
//      `node_modules/.pnpm/` carried only `@biomejs/cli-darwin-x64@1.9.4`
//      (no `cli-darwin-arm64`). Biome's launcher `require()`s the
//      per-arch CLI package and threw `MODULE_NOT_FOUND` with a stack
//      trace, not a remediation.
//   2. Node-version drift — the interactive commit shell ran node
//      `v24.15.0` while the launchd fleet + `node_modules` were pinned to
//      `v24.14.0`, so lefthook's own
//      `node_modules/.pnpm/lefthook@.../bin/index.js` failed to resolve
//      under the mismatched node.
//
// Net effect: 100% of commits — including the entire autonomous worker
// fleet's — blocked, with `orchestrate.jsonl` showing 0 autonomous merges
// and `openPRs` stuck for a 10h run. Per CLAUDE.md Feedback-Loop
// Guardrails ("every bug becomes a rule — prevent the *class*, not the
// instance") and vision.md rule #6 ("fail loudly at the actionable
// boundary"), the durable fix is a deterministic assertion (rule #10
// ratchet) that converts both divergence shapes into a single one-line
// message naming the exact remediation.
//
// Design (rule #2 — the classifier is the swappable pure seam, the
// filesystem/`createRequire` probing is the boundary):
//
//   - `parseMajorMinor(s)` / `classifyToolchain({ runtimeNode,
//     pinnedNode, binaries })` are pure: facts in, verdict out, zero I/O.
//     The whole verdict table is exercised by `check-toolchain.test.mjs`
//     with hand-built inputs — no real node switch, no missing package on
//     disk, no spawned process.
//   - `probeBinaries()` / `readPinnedNode()` / `main()` are the thin I/O
//     boundary that gathers the facts and prints the report. `main()`
//     exits non-zero on any violation so lefthook aborts the commit with
//     the actionable line surfaced *instead of* (slice ≥2: *before*) the
//     opaque biome/lefthook trace.
//
// Slice boundary (this PR is slice 1): the classifier + CLI + paired
// tests + `.node-version`/`.nvmrc` pin + the lefthook `pre-commit`
// `toolchain` command. Deferred to reviewed follow-up slices, each
// already enumerated in the parent task's § Details: (b) wiring into
// `pnpm pre-pr-lint` / a verify gate (the STACK_MANIFEST parity harness
// makes that a self-contained change), (c) pinning
// `@biomejs/cli-darwin-arm64` into `optionalDependencies` +
// regenerating `pnpm-lock.yaml`, and the lefthook phase-split that runs
// this assertion *before* the heavy biome/typecheck/test steps so a
// doomed commit is rejected without burning their wall-clock
// (skip-earlier-gate optimization — sized as its own slice because doing
// it without serialising the common green path needs a two-phase hook
// group, not a one-line edit).
//
// Source: 2026-05-17 live repro (`MODULE_NOT_FOUND` requireStack on
//   `@biomejs/biome/bin/biome` then `lefthook/bin/index.js`; `Darwin
//   arm64` with only `cli-darwin-x64`; interactive `v24.15.0` vs
//   fleet-pinned `v24.14.0`); operator directive 2026-05-17 ("short-term
//   fix then file long-term fix as P0"); Biome docs (`BIOME_BINARY`
//   override; per-platform optional deps — biomejs.dev/guides/manual-
//   installation); CLAUDE.md Feedback-Loop Guardrails (every bug → a
//   rule/assertion that prevents the *class*); vision.md rule #6 (fail
//   loudly at the actionable boundary — Armstrong 2007 "let it crash"
//   AT the boundary, not silently degrade); rule #9 (pre-registered
//   HDD — § Hypothesis/Success/Pivot/Measurement in the parent task);
//   rule #10 (deterministic ratchet — a class of bug becomes a check,
//   not a second instruction line). Sibling spine:
//   `scripts/check-lockfile-integrity.mjs` and
//   `scripts/scan-secrets.mjs` — same pure-classifier-then-thin-CLI
//   shape, same paired-test discipline.
// Conformance: full — `parseMajorMinor` / `classifyToolchain` are pure;
//   `probeBinaries` / `readPinnedNode` / `main` are the I/O boundary.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Parse a node-version string into its major + minor. Accepts a leading
 * `v` (so `process.version` — `"v24.14.0"` — and a bare `.node-version`
 * body — `"24.14.0"` — both parse). Returns `null` for anything that
 * isn't `<num>.<num>...` — the classifier treats an unparseable pin as
 * "no pin to enforce" (fail-open on the *pin*, never on the runtime: a
 * malformed `.node-version` must not itself block every commit, which is
 * the exact failure mode this script exists to prevent).
 *
 * @param {string} raw
 * @returns {{ major: number, minor: number } | null}
 */
export function parseMajorMinor(raw) {
  if (typeof raw !== "string") return null;
  const m = /^v?(\d+)\.(\d+)(?:\.\d+)?/.exec(raw.trim());
  if (m === null) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  return { major, minor };
}

/**
 * @typedef {object} BinaryProbe
 * @property {string} name      human label, e.g. `biome` / `lefthook` /
 *                              `scan-secrets`.
 * @property {boolean} resolved whether the hook-critical binary/module
 *                              resolved for THIS `process.platform` /
 *                              `process.arch`.
 * @property {string} hint      one-line operator remediation, surfaced
 *                              verbatim when `resolved === false`.
 */

/**
 * @typedef {object} ToolchainViolation
 * @property {string} code         stable token (`node-version-mismatch`,
 *                                  `biome-unresolved`, …) — tests + future
 *                                  CI annotations pin to this.
 * @property {string} remediation  the single operator-actionable line.
 */

/**
 * @typedef {object} ToolchainVerdict
 * @property {boolean} ok
 * @property {ToolchainViolation[]} violations  ordered: node-version
 *                                              first (it's the upstream
 *                                              cause of the binary
 *                                              failures), then binaries
 *                                              in probe order.
 */

/**
 * Pure classifier. Given the runtime node version, the repo-pinned node
 * version (or `null`/empty when there's no pin file), and the set of
 * already-probed hook-critical binaries, decide whether the commit hook
 * chain can run — and if not, what the operator should do about it.
 *
 * Node-version policy: a mismatch on **major OR minor** is a violation.
 * Patch drift is tolerated (node patch releases are ABI-compatible and
 * `node_modules` resolves identically); a minor bump is NOT (the
 * 2026-05-17 incident was `v24.14.0` → `v24.15.0`, a minor change that
 * broke lefthook resolution). This matches the parent task's § Details
 * (a): "assert `process.version` matches the pinned major.minor".
 *
 * @param {{
 *   runtimeNode: string,
 *   pinnedNode: string | null | undefined,
 *   binaries: readonly BinaryProbe[],
 * }} input
 * @returns {ToolchainVerdict}
 */
export function classifyToolchain({ runtimeNode, pinnedNode, binaries }) {
  /** @type {ToolchainViolation[]} */
  const violations = [];

  const want = typeof pinnedNode === "string" ? parseMajorMinor(pinnedNode) : null;
  const have = parseMajorMinor(runtimeNode);
  if (want !== null && have !== null && (want.major !== have.major || want.minor !== have.minor)) {
    violations.push({
      code: "node-version-mismatch",
      remediation: `wrong node v${runtimeNode}, expected v${pinnedNode} (pinned in .node-version). Run \`fnm use\` (or \`nvm use\` / \`nodenv local\`) in this repo, then retry the commit. The launchd fleet + node_modules are installed for the pinned major.minor; a mismatched node makes lefthook and biome fail with an opaque MODULE_NOT_FOUND that silently blocks every commit fleet-wide.`,
    });
  }

  for (const b of binaries ?? []) {
    if (b.resolved !== true) {
      violations.push({ code: `${b.name}-unresolved`, remediation: b.hint });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Format a verdict for the CLI / hook output. Stable across versions:
 * downstream greps pin to the leading `[check-toolchain] ok` / `[check-
 * toolchain] FAIL` tokens, and every failure line is self-contained and
 * actionable (vision.md rule #6 — never an opaque trace).
 *
 * @param {ToolchainVerdict} verdict
 * @returns {string}
 */
export function formatReport(verdict) {
  if (verdict.ok === true) {
    return "[check-toolchain] ok: pinned node + hook-critical binaries resolve for this platform.";
  }
  const lines = [
    `[check-toolchain] FAIL: the git pre-commit hook chain cannot run (${verdict.violations.length} issue${
      verdict.violations.length === 1 ? "" : "s"
    }). Fix and retry — do NOT use \`git commit --no-verify\` (it also bypasses scan-secrets):`,
  ];
  for (const v of verdict.violations) {
    lines.push(`  - [${v.code}] ${v.remediation}`);
  }
  return lines.join("\n");
}

// ---- I/O boundary -----------------------------------------------------------

/**
 * Read the repo-pinned node version. `.node-version` is the primary
 * source (fnm / nodenv / asdf read it); `.nvmrc` is the nvm fallback.
 * Returns the trimmed first non-empty line, or `null` when neither file
 * exists — in which case the classifier simply skips the node-version
 * check (no pin to enforce; the binary checks still run).
 *
 * @param {string} [repoRoot]
 * @returns {string | null}
 */
export function readPinnedNode(repoRoot = REPO_ROOT) {
  for (const file of [".node-version", ".nvmrc"]) {
    const p = resolve(repoRoot, file);
    if (!existsSync(p)) continue;
    try {
      const first = readFileSync(p, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith("#"));
      if (typeof first === "string" && first.length > 0) return first;
    } catch {
      // Unreadable pin file → treat as "no pin"; never let the guard
      // itself become the thing that blocks every commit (rule #6).
      return null;
    }
  }
  return null;
}

/**
 * Probe the hook-critical binaries for THIS host's
 * `process.platform`/`process.arch`. Resolution is upward from the repo
 * root so a git worktree (no local `node_modules`) still finds the
 * parent checkout's install — the exact topology the fleet runs in.
 *
 * Biome: honoured in priority order — (1) an explicit `BIOME_BINARY`
 * env override pointing at an existing file (the documented escape
 * hatch, also the committed `.minsky/bin/biome-<platform>-<arch>`
 * recovery binary); (2) the per-arch CLI package
 * `@biomejs/cli-<platform>-<arch>` that biome's launcher itself
 * `require()`s — resolving *that* package is what actually threw
 * `MODULE_NOT_FOUND` on 2026-05-17, so it's the precise thing to assert.
 *
 * @param {string} [repoRoot]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 * @param {Record<string, string | undefined>} [env]
 * @returns {BinaryProbe[]}
 */
export function probeBinaries(
  repoRoot = REPO_ROOT,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
) {
  const req = createRequire(resolve(repoRoot, "package.json"));
  /** @type {BinaryProbe[]} */
  const probes = [];

  const biomeBinary = env["BIOME_BINARY"];
  const biomePkg = `@biomejs/cli-${platform}-${arch}`;
  let biomeResolved = false;
  if (typeof biomeBinary === "string" && biomeBinary.length > 0 && existsSync(biomeBinary)) {
    biomeResolved = true;
  } else {
    try {
      req.resolve(`${biomePkg}/biome`);
      biomeResolved = true;
    } catch {
      biomeResolved = false;
    }
  }
  probes.push({
    name: "biome",
    resolved: biomeResolved,
    hint: `the platform biome CLI \`${biomePkg}\` does not resolve for ${platform}/${arch}. Either run \`pnpm install\` so the per-arch optional dep is fetched, or set \`BIOME_BINARY=$REPO/.minsky/bin/biome-${platform}-${arch}\` to the committed arch-correct recovery binary. (A \`node_modules\` installed for a different arch silently drops this package and blocks every commit.)`,
  });

  let lefthookResolved = false;
  try {
    req.resolve("lefthook/package.json");
    lefthookResolved = true;
  } catch {
    lefthookResolved = false;
  }
  probes.push({
    name: "lefthook",
    resolved: lefthookResolved,
    hint:
      "the `lefthook` package does not resolve from this checkout. Usually a node-version " +
      "mismatch (node_modules installed for the pinned major.minor) or a fresh worktree " +
      "with no install — run `fnm use` then `pnpm install`.",
  });

  const scanSecrets = resolve(repoRoot, "scripts", "scan-secrets.mjs");
  probes.push({
    name: "scan-secrets",
    resolved: existsSync(scanSecrets),
    hint:
      "scripts/scan-secrets.mjs is missing — the pre-commit credential gate cannot run. " +
      "Restore it from origin/main (vision.md § 13.1); never bypass with --no-verify.",
  });

  return probes;
}

/**
 * Thin CLI driver. Pure-ish: takes the gathered facts so the test suite
 * can exercise the exit-path table without a real node switch or a real
 * missing package. `main()` is the only thing that touches `process`.
 *
 * @param {{ runtimeNode: string, pinnedNode: string | null, binaries: readonly BinaryProbe[] }} facts
 * @returns {{ exitCode: 0 | 1, report: string }}
 */
export function runCheckToolchain(facts) {
  const verdict = classifyToolchain(facts);
  return { exitCode: verdict.ok ? 0 : 1, report: formatReport(verdict) };
}

function main() {
  const { exitCode, report } = runCheckToolchain({
    runtimeNode: process.versions.node,
    pinnedNode: readPinnedNode(),
    binaries: probeBinaries(),
  });
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${report}\n`);
  process.exit(exitCode);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-toolchain.mjs") === true;
if (invokedDirectly) main();
