/**
 * Paired tests for `node-modules-existence-check.ts` — slice 1 of
 * `minsky-fresh-clone-health-checks`. Same shape as
 * `dist-existence-check.test.ts` (slice 8) — `bin/minsky.mjs` runs the
 * dist check, then the node_modules check, then the dynamic import.
 *
 * Covers the chaos-table rows from the module's JSDoc:
 *   1. node_modules present → continue (no message)
 *   2. node_modules absent  → emit clear error + exit 1
 *   3. existsSync throws    → loud-crash up the stack (Armstrong 2007)
 */

import { describe, expect, it } from "vitest";
import {
  type NodeModulesCheckOutcome,
  checkNodeModulesExists,
  formatNodeModulesMissingMessage,
} from "./node-modules-existence-check.js";

describe("checkNodeModulesExists — present", () => {
  it("returns { ok: true } when existsSyncFn returns true", () => {
    const result = checkNodeModulesExists({
      nodeModulesPath: "/repo/node_modules",
      existsSyncFn: () => true,
    });
    expect(result).toEqual<NodeModulesCheckOutcome>({ ok: true });
  });
});

describe("checkNodeModulesExists — absent", () => {
  it("returns { ok: false, nodeModulesPath } when existsSyncFn returns false", () => {
    const result = checkNodeModulesExists({
      nodeModulesPath: "/repo/node_modules",
      existsSyncFn: () => false,
    });
    expect(result).toEqual<NodeModulesCheckOutcome>({
      ok: false,
      nodeModulesPath: "/repo/node_modules",
    });
  });
});

describe("checkNodeModulesExists — chaos: existsSync throws", () => {
  it("bubbles up unexpected errors (loud-crash per Armstrong)", () => {
    expect(() =>
      checkNodeModulesExists({
        nodeModulesPath: "/x",
        existsSyncFn: () => {
          throw new Error("EACCES");
        },
      }),
    ).toThrow("EACCES");
  });
});

describe("formatNodeModulesMissingMessage", () => {
  // The string format is the operator's recovery instruction. Each
  // assertion below is a contract — wording can change but the contract
  // (mentions `pnpm install`, mentions the missing path, fits on a
  // small terminal) must hold.

  it("mentions `pnpm install` (the recovery command)", () => {
    const msg = formatNodeModulesMissingMessage("/repo/node_modules");
    expect(msg).toMatch(/pnpm install/);
  });

  it("mentions the missing path so the operator can verify what's missing", () => {
    const msg = formatNodeModulesMissingMessage("/repo/node_modules");
    expect(msg).toContain("/repo/node_modules");
  });

  it("starts with the `minsky:` prefix that all other CLI errors use", () => {
    const msg = formatNodeModulesMissingMessage("/x");
    expect(msg).toMatch(/^minsky:/);
  });

  it("renders as a single line so it doesn't blow up small terminals", () => {
    const msg = formatNodeModulesMissingMessage("/some/long/path/with/segments/node_modules");
    expect(msg.split("\n").length).toBe(1);
  });
});
