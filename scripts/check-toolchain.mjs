#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved slice 1 of `commit-hook-chain-node-version-and-platform-resilience` (operator 2026-05-17: P0 fleet-wide commit-path resilience) -->
// Slice 1 of `commit-hook-chain-node-version-and-platform-resilience` (TASKS.md):
// the pure toolchain classifier + a loud CLI guard.
//
// Root cause this closes (2026-05-17 live repro): the git pre-commit hook
// chain (lefthook → biome + scan-secrets) silently 100%-blocks every commit
// fleet-wide with an opaque `MODULE_NOT_FOUND` whenever EITHER (1) the
// running node version diverges from what `node_modules` was installed for
// (lefthook's own launcher fails to resolve) OR (2) the host-arch biome
// platform optional dep is missing (`@biomejs/cli-<platform>-<arch>` absent
// after a reinstall that dropped it). Both surface as a stack trace nobody
// reads until throughput has been zero for hours.
//
// `assessToolchain(input)` is the pure, deterministic decision function: it
// takes the already-gathered facts (running vs pinned node version, host
// platform/arch, whether the biome platform pkg + lefthook resolve) and
// returns the list of operator-actionable problem lines. The CLI `main()`
// gathers those facts from the real environment and exits ≠0 with the
// one-line remediation message — never an opaque trace, never a silent
// degrade to "no commits possible" (vision.md rule #6: fail loudly at the
// actionable boundary). The pure/IO split lets the paired test exercise
// every verdict (node-mismatch, missing-biome, missing-lefthook, all-green)
// with hand-built inputs and no real reinstall.
//
// Source: 2026-05-17 live repro + operator directive ("short-term fix then
//   file long-term fix as P0"); biome docs (per-platform optional deps;
//   `BIOME_BINARY` override); CLAUDE.md Feedback-Loop Guardrails (every bug
//   → a rule/assertion that prevents the *class*); vision.md rule #6
//   (fail-loud at the actionable boundary), rule #9 (pre-registered HDD),
//   rule #10 (deterministic enforcement — same guard gates commit + verify).

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * @typedef {object} ToolchainFacts
 * @property {string} runningNodeVersion  `process.version`, e.g. "v24.15.0".
 * @property {string|null} pinnedNodeVersion  contents of `.node-version`
 *   (leading `v` optional), or null when the pin file is absent.
 * @property {string} platform  `process.platform`, e.g. "darwin".
 * @property {string} arch  `process.arch`, e.g. "arm64".
 * @property {boolean} biomePlatformPkgPresent  whether the host-arch biome
 *   launcher binary (`@biomejs/cli-<platform>-<arch>`) resolves.
 * @property {boolean} lefthookResolvable  whether the `lefthook` package
 *   resolves under the running node (the hook runner itself).
 */

/**
 * Parse a node version string ("v24.14.0", "24.14", "24") into a
 * `{ major, minor }` pair. Returns null when no major can be parsed.
 * @param {string|null|undefined} v
 * @returns {{ major: number, minor: number } | null}
 */
export function parseNodeMajorMinor(v) {
  if (typeof v !== "string") return null;
  const m = v
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) };
}

/**
 * Pure toolchain classifier. Given the gathered facts, return the ordered
 * list of operator-actionable problem strings (empty ⇒ healthy). Never
 * throws — a malformed pin is reported as a problem, not an exception, so
 * the guard can never itself become the opaque failure it exists to prevent.
 *
 * @param {ToolchainFacts} facts
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function assessToolchain(facts) {
  const problems = [];

  // (a) node-version consistency — the hook chain must run under the same
  //     node `node_modules` (and the launchd fleet) was installed for. We
  //     pin on major.minor: a patch drift is tolerated, a minor/major drift
  //     is the one that breaks native-addon / launcher resolution.
  if (facts.pinnedNodeVersion != null) {
    const pin = parseNodeMajorMinor(facts.pinnedNodeVersion);
    const run = parseNodeMajorMinor(facts.runningNodeVersion);
    if (pin == null) {
      problems.push(
        `.node-version contents "${facts.pinnedNodeVersion}" is not a parseable node version — fix the pin file (expected e.g. "24.14.0").`,
      );
    } else if (run == null) {
      problems.push(`could not parse running node version "${facts.runningNodeVersion}".`);
    } else if (pin.major !== run.major || pin.minor !== run.minor) {
      problems.push(
        `node ${facts.runningNodeVersion} ≠ pinned v${facts.pinnedNodeVersion} (.node-version). Run \`fnm use\` (or \`nvm use\`) in this shell, then retry — a node minor/major drift makes lefthook's own launcher fail with an opaque MODULE_NOT_FOUND and silently blocks every commit.`,
      );
    }
  }

  // (b/c) platform completeness — the host-arch biome launcher binary must
  //       be installed, else `pnpm biome` (a pre-commit step) dies with
  //       MODULE_NOT_FOUND, blocking the whole fleet's commits.
  if (!facts.biomePlatformPkgPresent) {
    problems.push(
      `@biomejs/cli-${facts.platform}-${facts.arch} is not installed — biome would fail with MODULE_NOT_FOUND and silently block every commit. Run \`pnpm install\` on this host; if it still fails, set BIOME_BINARY to an arch-correct biome binary and re-run.`,
    );
  }

  // The hook runner itself — if lefthook can't resolve, no hook runs at all
  // (and `git commit` either errors opaquely or, worse, skips the gate).
  if (!facts.lefthookResolvable) {
    problems.push(
      `lefthook is not resolvable under node ${facts.runningNodeVersion} — the pre-commit chain itself cannot load. Run \`pnpm install\` under the pinned node, then \`pnpm dlx lefthook install\`.`,
    );
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Candidate biome launcher package names for a host. biome ships one
 * `@biomejs/cli-<platform>-<arch>` optional dep per target; linux also has a
 * `-musl` variant. We accept any candidate resolving as "present".
 * @param {string} platform
 * @param {string} arch
 * @returns {string[]}
 */
export function biomePlatformPkgCandidates(platform, arch) {
  const base = `@biomejs/cli-${platform}-${arch}`;
  return platform === "linux" ? [base, `${base}-musl`] : [base];
}

/**
 * Gather the real environment facts for the host. Resolution failures are
 * caught and reported as "absent" rather than thrown — this guard must never
 * itself crash opaquely.
 * @param {string} repoRoot
 * @returns {ToolchainFacts}
 */
export function gatherToolchainFacts(repoRoot) {
  const require = createRequire(resolve(repoRoot, "package.json"));

  let pinnedNodeVersion = null;
  const pinPath = resolve(repoRoot, ".node-version");
  if (existsSync(pinPath)) {
    pinnedNodeVersion = readFileSync(pinPath, "utf8").trim() || null;
  }

  const platform = process.platform;
  const arch = process.arch;

  // Mirror biome's own launcher (`@biomejs/biome/bin/biome`): it resolves
  // `@biomejs/cli-<platform>-<arch>` *relative to itself*, NOT from repo
  // root. Under pnpm those platform optional deps are NOT hoisted to the
  // top-level `node_modules/@biomejs/`, so a repo-root `require.resolve`
  // false-negatives (reports "missing" when biome actually works). Anchor
  // the resolver at the biome package and honour the documented
  // `BIOME_BINARY` escape hatch exactly as the launcher does.
  let biomePlatformPkgPresent = false;
  const biomeBinaryEnv = process.env["BIOME_BINARY"] || process.env["ROME_BINARY"];
  if (biomeBinaryEnv && existsSync(biomeBinaryEnv)) {
    biomePlatformPkgPresent = true;
  } else {
    try {
      const biomePkgJson = require.resolve("@biomejs/biome/package.json");
      const biomeRequire = createRequire(biomePkgJson);
      biomePlatformPkgPresent = biomePlatformPkgCandidates(platform, arch).some((pkg) => {
        try {
          biomeRequire.resolve(`${pkg}/package.json`);
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      biomePlatformPkgPresent = false;
    }
  }

  let lefthookResolvable = false;
  try {
    require.resolve("lefthook/package.json");
    lefthookResolvable = true;
  } catch {
    lefthookResolvable = false;
  }

  return {
    runningNodeVersion: process.version,
    pinnedNodeVersion,
    platform,
    arch,
    biomePlatformPkgPresent,
    lefthookResolvable,
  };
}

function main() {
  const repoRoot = resolve(import.meta.dirname, "..");
  const facts = gatherToolchainFacts(repoRoot);
  const { ok, problems } = assessToolchain(facts);
  if (ok) {
    process.stdout.write(
      `check-toolchain: OK (node ${facts.runningNodeVersion}, ${facts.platform}-${facts.arch}, biome+lefthook resolvable).\n`,
    );
    process.exit(0);
  }
  process.stderr.write("check-toolchain: toolchain is not commit-ready:\n");
  for (const p of problems) {
    process.stderr.write(`  - ${p}\n`);
  }
  process.stderr.write(
    "Fix the above, then retry. Do NOT use `git commit --no-verify` — it also bypasses the secret scanner.\n",
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
