/**
 * Paired tests for `tick-loop-bin-existence-check.ts` — slice 2 of
 * `minsky-runtime-resilience`. Mirrors `dist-existence-check.test.ts`
 * shape exactly (slice 8 — same defensive pattern).
 *
 * Covers:
 *   1. tick-loop.mjs present → continue (no message)
 *   2. tick-loop.mjs absent  → emit clear error + exit 1
 *   3. existsSync throws     → loud-crash up the stack (Armstrong)
 *   4. bin/minsky.mjs seam   → bare existsSync(TICK_LOOP_BIN) replaced (rule #8)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type TickLoopBinCheckOutcome,
  checkTickLoopBinExists,
  formatTickLoopBinMissingMessage,
} from "./tick-loop-bin-existence-check.js";

describe("checkTickLoopBinExists — present", () => {
  it("returns { ok: true } when existsSyncFn returns true", () => {
    const result = checkTickLoopBinExists({
      tickLoopBinPath: "/repo/novel/tick-loop/bin/tick-loop.mjs",
      existsSyncFn: () => true,
    });
    expect(result).toEqual<TickLoopBinCheckOutcome>({ ok: true });
  });
});

describe("checkTickLoopBinExists — absent", () => {
  it("returns { ok: false, tickLoopBinPath } when existsSyncFn returns false", () => {
    const result = checkTickLoopBinExists({
      tickLoopBinPath: "/repo/novel/tick-loop/bin/tick-loop.mjs",
      existsSyncFn: () => false,
    });
    expect(result).toEqual<TickLoopBinCheckOutcome>({
      ok: false,
      tickLoopBinPath: "/repo/novel/tick-loop/bin/tick-loop.mjs",
    });
  });
});

describe("checkTickLoopBinExists — chaos: existsSync throws", () => {
  it("bubbles up unexpected errors (loud-crash per Armstrong)", () => {
    expect(() =>
      checkTickLoopBinExists({
        tickLoopBinPath: "/x",
        existsSyncFn: () => {
          throw new Error("EACCES");
        },
      }),
    ).toThrow("EACCES");
  });
});

describe("formatTickLoopBinMissingMessage", () => {
  it("mentions a recovery command (pnpm install OR git checkout)", () => {
    const msg = formatTickLoopBinMissingMessage("/repo/novel/tick-loop/bin/tick-loop.mjs");
    expect(msg).toMatch(/pnpm install|git checkout/);
  });

  it("mentions the missing path so the operator can verify what's missing", () => {
    const msg = formatTickLoopBinMissingMessage("/repo/novel/tick-loop/bin/tick-loop.mjs");
    expect(msg).toContain("/repo/novel/tick-loop/bin/tick-loop.mjs");
  });

  it("starts with the `minsky:` prefix that all other CLI errors use", () => {
    const msg = formatTickLoopBinMissingMessage("/x");
    expect(msg).toMatch(/^minsky:/);
  });

  it("renders as a single line (no embedded newlines)", () => {
    const msg = formatTickLoopBinMissingMessage("/some/long/path/segments/bin/tick-loop.mjs");
    expect(msg.split("\n").length).toBe(1);
  });
});

describe("bin/minsky.mjs seam-wiring — checkTickLoopBinExists (rule #8)", () => {
  // Regression test: bare existsSync(TICK_LOOP_BIN) was replaced by the
  // injectable seam in PR #558. This test prevents reversion by failing CI
  // if the direct call reappears (vision.md rule #10 — every recurring review
  // comment becomes a lint rule or drift test).
  it("minsky.mjs calls checkTickLoopBinExists, not bare existsSync(TICK_LOOP_BIN)", () => {
    const binPath = join(import.meta.dirname, "../bin/minsky.mjs");
    const binSource = readFileSync(binPath, "utf8");

    expect(binSource).not.toContain("existsSync(TICK_LOOP_BIN)");
    expect(binSource).toContain("checkTickLoopBinExists({");
  });
});
