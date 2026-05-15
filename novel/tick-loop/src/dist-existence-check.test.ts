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
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DistCheckOutcome,
  checkDistExists,
  formatDistMissingMessage,
} from "./dist-existence-check.js";

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

describe("tick-loop package.json drift — no package-level prepare", () => {
  // Adding `prepare: pnpm build` to this package.json breaks `pnpm install`
  // on a true fresh clone. pnpm runs each workspace package's `prepare` hook
  // BEFORE the root package's `prepare: tsc -b --force` runs. When ALL dists
  // are absent, tick-loop's `pnpm build` can't resolve @minsky/budget-guard
  // or @minsky/token-monitor because their dist/ hasn't been generated yet.
  // The root `tsc -b --force` handles dep-order correctly; package-level
  // prepare is redundant here and actively harmful. (PR #525 tried + reverted.)
  it("does NOT have a prepare script (would break fresh-clone-smoke)", () => {
    const pkgPath = join(import.meta.dirname, "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["prepare"]).toBeUndefined();
  });
});

describe("bin/minsky.mjs drift — dist-missing message", () => {
  // bin/minsky.mjs intentionally inlines the dist-missing error rather than
  // importing formatDistMissingMessage — the whole point is that dist/ may be
  // missing when the check runs. This drift test pins both copies so wording
  // divergence fails CI instead of silently accumulating (vision.md rule #10).
  it("inline error in bin/minsky.mjs matches formatDistMissingMessage structurally", () => {
    const binPath = join(import.meta.dirname, "../bin/minsky.mjs");
    // Normalize escaped template backticks so the source reads as the runtime string would
    const binSource = readFileSync(binPath, "utf8").replace(/\\`/g, "`");

    // Split canonical formatter output around a sentinel placeholder
    const sentinel = "__P__";
    const canonical = formatDistMissingMessage(sentinel);
    const [before, after] = canonical.split(sentinel);

    // Both structural halves must appear verbatim in the normalized bin source
    expect(binSource).toContain(before);
    expect(binSource).toContain(after);
  });
});
