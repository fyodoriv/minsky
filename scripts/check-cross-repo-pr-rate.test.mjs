// @ts-check
// Paired tests for `check-cross-repo-pr-rate.mjs`. Pure-function tests
// over the parsed-argv shape + the I/O-injected `main` entry. The deeper
// verdict logic is tested in `iteration-ship-rate.test.ts` (19 cases).
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017) — the I/O
// (`readRecords`, `writeLine`) is injected so the test never touches
// the filesystem.

import { describe, expect, it, vi } from "vitest";

import { main, parseArgs } from "./check-cross-repo-pr-rate.mjs";

/** @typedef {{ ts: string; pr_url: string | null }} Record */

// 2026-05-24T17:00:00Z anchor — derived from Date.parse so the constant
// can't drift from the ISO string it represents (the `parseArgs --now=`
// roundtrip relies on these being equal).
const NOW_MS = Date.parse("2026-05-24T17:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {number} days */
function tsDaysAgo(days) {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

describe("parseArgs", () => {
  it("defaults to 30d window, cwd host-dir, non-JSON, no clock override", () => {
    const args = parseArgs([]);
    expect(args.windowDays).toBe(30);
    expect(args.hostDir).toBe(process.cwd());
    expect(args.json).toBe(false);
    expect(args.nowMs).toBeUndefined();
  });

  it("accepts --window=Nd", () => {
    expect(parseArgs(["--window=7d"]).windowDays).toBe(7);
    expect(parseArgs(["--window=90d"]).windowDays).toBe(90);
  });

  it("rejects a malformed window", () => {
    expect(() => parseArgs(["--window=7"])).toThrow(/--window/);
    expect(() => parseArgs(["--window=foo"])).toThrow(/--window/);
  });

  it("accepts --host-dir=PATH", () => {
    expect(parseArgs(["--host-dir=/tmp/x"]).hostDir).toBe("/tmp/x");
  });

  it("accepts --json", () => {
    expect(parseArgs(["--json"]).json).toBe(true);
  });

  it("accepts --now=ISO and --now=EPOCH for deterministic windowing", () => {
    const iso = parseArgs(["--now=2026-05-24T17:00:00Z"]);
    expect(iso.nowMs).toBe(NOW_MS);
    const epoch = parseArgs([`--now=${NOW_MS}`]);
    expect(epoch.nowMs).toBe(NOW_MS);
  });

  it("rejects an unparseable --now", () => {
    expect(() => parseArgs(["--now=not-a-date"])).toThrow(/--now/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--mystery"])).toThrow(/unknown flag/);
  });
});

describe("main (CLI entry, with injected I/O)", () => {
  /**
   * @param {Array<Record>} rows
   * @returns {Array<Record>}
   */
  function recordsWith(...rows) {
    return rows;
  }

  /**
   * Parse the first written line as JSON. The vi-mock typing is loose,
   * so this helper narrows it for the assertions.
   * @param {ReturnType<typeof vi.fn>} writeLine
   * @returns {{ rate: number; n: number; withPr: number; verdict: string }}
   */
  function parseFirstWrite(writeLine) {
    const first = writeLine.mock.calls[0];
    if (!first || typeof first[0] !== "string") {
      throw new Error("writeLine was never called or first arg was not a string");
    }
    return JSON.parse(first[0]);
  }

  it("exits 1 when verdict is BELOW", () => {
    // 1/18 PRs is 0.056 — matches the live baseline 2026-05-19 (see
    // iteration-ship-rate.test.ts § 'BELOW verdict' for the citation).
    const records = recordsWith(
      { ts: tsDaysAgo(1), pr_url: "https://example.com/pr/1" },
      ...Array.from({ length: 17 }, (_, i) => ({
        ts: tsDaysAgo(i + 2),
        pr_url: null,
      })),
    );
    const writeLine = vi.fn();
    const code = main([`--now=${NOW_MS}`], {
      readRecords: () => records,
      writeLine,
    });
    expect(code).toBe(1);
    const output = parseFirstWrite(writeLine);
    expect(output.verdict).toBe("BELOW");
    expect(output.n).toBe(18);
  });

  it("exits 0 when verdict is ABOVE", () => {
    const records = recordsWith(
      ...Array.from({ length: 5 }, (_, i) => ({
        ts: tsDaysAgo(i + 1),
        pr_url: `https://example.com/pr/${i}`,
      })),
    );
    const writeLine = vi.fn();
    const code = main([`--now=${NOW_MS}`], {
      readRecords: () => records,
      writeLine,
    });
    expect(code).toBe(0);
    expect(parseFirstWrite(writeLine).verdict).toBe("ABOVE");
  });

  it("exits 0 when verdict is WARN (between FLOOR and TARGET)", () => {
    const records = recordsWith(
      { ts: tsDaysAgo(1), pr_url: "https://example.com/pr/1" },
      ...Array.from({ length: 7 }, (_, i) => ({
        ts: tsDaysAgo(i + 2),
        pr_url: null,
      })),
    );
    const writeLine = vi.fn();
    const code = main([`--now=${NOW_MS}`], {
      readRecords: () => records,
      writeLine,
    });
    expect(code).toBe(0);
    expect(parseFirstWrite(writeLine).verdict).toBe("WARN");
  });

  it("exits 0 when verdict is INSUFFICIENT-DATA (n < 5)", () => {
    const records = recordsWith({
      ts: tsDaysAgo(1),
      pr_url: "https://example.com/pr/1",
    });
    const writeLine = vi.fn();
    const code = main([`--now=${NOW_MS}`], {
      readRecords: () => records,
      writeLine,
    });
    expect(code).toBe(0);
    expect(parseFirstWrite(writeLine).verdict).toBe("INSUFFICIENT-DATA");
  });

  it("--json forces exit 0 even on BELOW (collector mode — verdict in stdout, no gate)", () => {
    const records = recordsWith(
      { ts: tsDaysAgo(1), pr_url: "https://example.com/pr/1" },
      ...Array.from({ length: 17 }, (_, i) => ({
        ts: tsDaysAgo(i + 2),
        pr_url: null,
      })),
    );
    const writeLine = vi.fn();
    const code = main([`--now=${NOW_MS}`, "--json"], {
      readRecords: () => records,
      writeLine,
    });
    expect(code).toBe(0);
    // The verdict in stdout is still BELOW — the collector inspects the
    // JSON, the exit code is just the gate signal.
    expect(parseFirstWrite(writeLine).verdict).toBe("BELOW");
  });

  it("returns INSUFFICIENT-DATA + exit 0 when the experiment-store is absent", () => {
    const writeLine = vi.fn();
    const code = main([`--now=${NOW_MS}`], {
      readRecords: () => [],
      writeLine,
    });
    expect(code).toBe(0);
    expect(parseFirstWrite(writeLine)).toEqual({
      rate: 0,
      n: 0,
      withPr: 0,
      verdict: "INSUFFICIENT-DATA",
    });
  });

  it("--window=7d narrows the count", () => {
    const records = recordsWith(
      { ts: tsDaysAgo(1), pr_url: "https://example.com/pr/1" },
      { ts: tsDaysAgo(8), pr_url: "https://example.com/pr/2" }, // outside 7d
    );
    const writeLine = vi.fn();
    main([`--now=${NOW_MS}`, "--window=7d"], {
      readRecords: () => records,
      writeLine,
    });
    expect(parseFirstWrite(writeLine).n).toBe(1);
  });
});
