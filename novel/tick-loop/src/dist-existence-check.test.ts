/**
 * Paired tests for `dist-existence-check.ts` — fresh-clone-bootstrap
 * loud-fail backstop. Slice 8 of P0 task `minsky-cli-fresh-clone-bootstrap`.
 *
 * Covers the chaos-table rows from the module's JSDoc:
 *   1. dist/index.js present → continue (no message)
 *   2. dist/index.js absent  → emit clear error + exit 1
 *   3. existsSync throws     → loud-crash up the stack (Armstrong 2007)
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type DistCheckOutcome,
  checkDistExists,
  formatDistMissingMessage,
} from "./dist-existence-check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MINSKY_BIN_PATH = resolve(HERE, "..", "bin", "minsky.mjs");

describe("checkDistExists — present", () => {
  it("returns { ok: true } when existsSyncFn returns true", () => {
    const result = checkDistExists({
      distIndexPath: "/repo/novel/tick-loop/dist/index.js",
      existsSyncFn: () => true,
    });
    expect(result).toEqual<DistCheckOutcome>({ ok: true });
  });
});

describe("checkDistExists — absent", () => {
  it("returns { ok: false, distIndexPath } when existsSyncFn returns false", () => {
    const result = checkDistExists({
      distIndexPath: "/repo/novel/tick-loop/dist/index.js",
      existsSyncFn: () => false,
    });
    expect(result).toEqual<DistCheckOutcome>({
      ok: false,
      distIndexPath: "/repo/novel/tick-loop/dist/index.js",
    });
  });
});

describe("checkDistExists — chaos: existsSync throws", () => {
  it("bubbles up unexpected errors (loud-crash per Armstrong)", () => {
    expect(() =>
      checkDistExists({
        distIndexPath: "/x",
        existsSyncFn: () => {
          throw new Error("EACCES");
        },
      }),
    ).toThrow("EACCES");
  });
});

describe("formatDistMissingMessage", () => {
  // The string format is the operator's recovery instruction. Each
  // assertion below is a contract, not a wording quibble — wording can
  // change but the contract (mentions `pnpm install`, mentions the
  // missing path, fits on a small terminal) must hold.

  it("mentions `pnpm install` (the recovery command)", () => {
    const msg = formatDistMissingMessage("/repo/novel/tick-loop/dist/index.js");
    expect(msg).toMatch(/pnpm install/);
  });

  it("mentions the missing path so the operator can verify what's missing", () => {
    const msg = formatDistMissingMessage("/repo/novel/tick-loop/dist/index.js");
    expect(msg).toContain("/repo/novel/tick-loop/dist/index.js");
  });

  it("starts with the `minsky:` prefix that all other CLI errors use", () => {
    const msg = formatDistMissingMessage("/x");
    expect(msg).toMatch(/^minsky:/);
  });

  it("renders as a single line so it doesn't blow up small terminals", () => {
    // Multi-line tracebacks are what we're replacing. Keep the message
    // visually compact — operator should read it without scrolling.
    const msg = formatDistMissingMessage("/some/long/path/with/many/segments/dist/index.js");
    expect(msg.split("\n").length).toBe(1);
  });
});

describe("bin/minsky.mjs drift — dist-missing message", () => {
  // `bin/minsky.mjs` inlines the error message (can't import from
  // `dist/` — that's what it's checking). This test pins the inline
  // copy against `formatDistMissingMessage` so any wording change in
  // one must be reflected in the other or CI fails.
  //
  // Technique: split the canonical output around a sentinel path
  // placeholder, normalize escaped backticks in the on-disk source
  // (`\\\`` → `` ` ``), then assert both structural halves appear.
  it("inline stderr literal matches formatDistMissingMessage's structural slices", () => {
    const rawSrc = readFileSync(MINSKY_BIN_PATH, "utf8");
    const normalizedSrc = rawSrc.replaceAll("\\`", "`");
    const canonical = formatDistMissingMessage("__P__");
    const parts = canonical.split("__P__");
    expect(parts.length).toBe(2);
    const [prefix, suffix] = parts as [string, string];
    expect(prefix.length).toBeGreaterThan(0);
    expect(suffix.length).toBeGreaterThan(0);
    expect(normalizedSrc).toContain(prefix);
    expect(normalizedSrc).toContain(suffix);
  });
});
