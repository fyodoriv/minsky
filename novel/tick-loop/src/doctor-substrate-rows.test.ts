/**
 * Paired tests for `doctor-substrate-rows.ts` — slice 1 of
 * `minsky-fresh-clone-health-checks`. Pure renderer for the 4 new
 * doctor rows that report on the install-time substrate (the things
 * that `pnpm install` puts in place — node_modules, lockfile, dist,
 * pnpm-on-PATH).
 *
 * The renderer is pure-over-state so we can pin the exact wording in
 * tests; the wiring in `bin/minsky.mjs` reads `existsSync` + `whichFn`
 * to build the state record.
 */

import { describe, expect, it } from "vitest";
import {
  type DoctorSubstrateRowState,
  renderDoctorSubstrateRows,
} from "./doctor-substrate-rows.js";

const ALL_GREEN: DoctorSubstrateRowState = {
  nodeModulesPresent: true,
  pnpmLockPresent: true,
  distPresent: true,
  pnpmOnPath: true,
};

describe("renderDoctorSubstrateRows — all-green steady state", () => {
  it("emits four ✓-prefixed rows when every substrate piece is present", () => {
    const lines = renderDoctorSubstrateRows(ALL_GREEN);
    expect(lines.length).toBe(4);
    for (const l of lines) {
      expect(l).toMatch(/^ {2}✓ /);
    }
  });

  it("includes labels covering the four substrate pieces", () => {
    const out = renderDoctorSubstrateRows(ALL_GREEN).join("\n");
    expect(out).toMatch(/node_modules/);
    expect(out).toMatch(/pnpm-lock\.yaml/);
    expect(out).toMatch(/dist\/index\.js/);
    expect(out).toMatch(/pnpm on PATH/);
  });
});

describe("renderDoctorSubstrateRows — node_modules absent", () => {
  it("emits ✗ for node_modules with the recovery hint", () => {
    const lines = renderDoctorSubstrateRows({ ...ALL_GREEN, nodeModulesPresent: false });
    const row = lines.find((l) => l.includes("node_modules"));
    expect(row).toBeDefined();
    // ✗ row, mentions recovery
    expect(row).toMatch(/^ {2}✗ /);
    expect(row).toMatch(/pnpm install/);
  });
});

describe("renderDoctorSubstrateRows — pnpm-lock.yaml absent", () => {
  it("emits ✗ for the lockfile", () => {
    const lines = renderDoctorSubstrateRows({ ...ALL_GREEN, pnpmLockPresent: false });
    const row = lines.find((l) => l.includes("pnpm-lock.yaml"));
    expect(row).toBeDefined();
    expect(row).toMatch(/^ {2}✗ /);
  });
});

describe("renderDoctorSubstrateRows — dist absent", () => {
  it("emits ✗ for dist with the rebuild hint", () => {
    const lines = renderDoctorSubstrateRows({ ...ALL_GREEN, distPresent: false });
    const row = lines.find((l) => l.includes("dist/index.js"));
    expect(row).toBeDefined();
    expect(row).toMatch(/^ {2}✗ /);
    // recovery: pnpm install runs prepare which builds dist
    expect(row).toMatch(/pnpm install/);
  });
});

describe("renderDoctorSubstrateRows — pnpm not on PATH", () => {
  it("emits ✗ for pnpm-on-PATH with an install hint", () => {
    const lines = renderDoctorSubstrateRows({ ...ALL_GREEN, pnpmOnPath: false });
    const row = lines.find((l) => l.includes("pnpm on PATH"));
    expect(row).toBeDefined();
    expect(row).toMatch(/^ {2}✗ /);
    // recovery: install pnpm; corepack or brew/npm
    expect(row).toMatch(/corepack enable|brew install pnpm|npm i -g pnpm/);
  });
});

describe("renderDoctorSubstrateRows — any-substrate-red predicate", () => {
  // Caller in bin/minsky.mjs uses this to decide GREEN vs RED banner —
  // any substrate row red means the daemon literally cannot run, so
  // doctor must escalate beyond the local-LLM-stack YELLOW state.

  it("returns false when every substrate is present", () => {
    const lines = renderDoctorSubstrateRows(ALL_GREEN);
    const anyRed = lines.some((l) => l.startsWith("  ✗"));
    expect(anyRed).toBe(false);
  });

  it("returns true when at least one substrate is missing", () => {
    const lines = renderDoctorSubstrateRows({ ...ALL_GREEN, distPresent: false });
    const anyRed = lines.some((l) => l.startsWith("  ✗"));
    expect(anyRed).toBe(true);
  });
});
