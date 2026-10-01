// @ts-check
// <!-- scope: human-approved gate-scratch-resolvable-ratchet: paired test proving the ratchet goes red when the install step is stubbed out -->
// Tests for the pure function in check-gate-scratch-resolvable.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures (Meszaros 2007).
// Source: rule #10 (vision.md § 10); global "every bug becomes a rule".

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { checkGateScratchResolvable } from "./check-gate-scratch-resolvable.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_GATE_SOURCE = readFileSync(resolve(HERE, "local-gate-merge.mjs"), "utf8");

describe("checkGateScratchResolvable", () => {
  test("the live local-gate-merge.mjs source is resolvable (unmodified path exits 0)", () => {
    const result = checkGateScratchResolvable(REAL_GATE_SOURCE);
    expect(result.ok).toBe(true);
  });

  test("goes red when the real `pnpm install --frozen-lockfile` is stubbed out", () => {
    // Excise the install invocation — the exact zero-merge regression
    // shape (scratch built, deps never installed).
    const stubbed = REAL_GATE_SOURCE.replace(/--frozen-lockfile/g, "--no-such-flag");
    const result = checkGateScratchResolvable(stubbed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.join("\n")).toContain("pnpm install --frozen-lockfile");
  });

  test("goes red when the install is replaced by a root-only node_modules symlink", () => {
    const symlinked = REAL_GATE_SOURCE.replace(
      /return installScratchDeps\(scratch\);/,
      'symlinkSync(join(REPO, "node_modules"), join(scratch, "node_modules"), "dir");\n  return null;',
    );
    const result = checkGateScratchResolvable(symlinked);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.join("\n")).toContain("symlinks `node_modules`");
  });

  test("goes red when a scratch-prep entry point stops calling installScratchDeps", () => {
    // Surgically drop the trailing install call from `prepareScratchClone`
    // only (the PR-vet path). Both prep functions end with the identical
    // `return installScratchDeps(scratch);` line, so anchor on the PR-vet
    // function's unique preceding `merge --no-edit pr${pr.number}` catch block.
    const prVet =
      /(catch \{\s*return \{ vetError: "merge-onto-main-conflict" \};\s*\}\s*)return installScratchDeps\(scratch\);/;
    expect(prVet.test(REAL_GATE_SOURCE)).toBe(true); // guard: the anchor still matches
    const broken = REAL_GATE_SOURCE.replace(prVet, "$1return null; // resolution skipped");
    const result = checkGateScratchResolvable(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.join("\n")).toContain(
      "`prepareScratchClone` no longer calls `installScratchDeps`",
    );
  });

  test("goes red when the shared installScratchDeps seam is removed entirely", () => {
    const noSeam = REAL_GATE_SOURCE.replace(/function installScratchDeps/g, "function _gone");
    const result = checkGateScratchResolvable(noSeam);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.join("\n")).toContain("the shared install seam `installScratchDeps`");
  });

  test("checker is pure — same source in, same verdict out, no I/O", () => {
    const a = checkGateScratchResolvable(REAL_GATE_SOURCE);
    const b = checkGateScratchResolvable(REAL_GATE_SOURCE);
    expect(a).toEqual(b);
  });
});
