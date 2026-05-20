// Tests for heal-stale-tsbuildinfo
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import * as healStale from "./heal-stale-tsbuildinfo.js";
import type { StaleTsbuildinfoSeams } from "./heal-stale-tsbuildinfo.js";

function makeSeams(
  files: Record<string, string>,
  currentNodeMajor = "20",
): { seams: StaleTsbuildinfoSeams; remaining: Map<string, string> } {
  const remaining = new Map(Object.entries(files));
  const seams: StaleTsbuildinfoSeams = {
    hostDir: "/host",
    currentNodeMajor,
    listTsbuildinfoFn: () => [...remaining.keys()],
    readFileSyncFn: (path) => {
      const value = remaining.get(path);
      if (value === undefined) {
        const err = new Error(`ENOENT: no such file ${path}`) as Error & {
          code: string;
        };
        err.code = "ENOENT";
        throw err;
      }
      return value;
    },
    existsSyncFn: (path) => remaining.has(path),
    unlinkSyncFn: (path) => {
      remaining.delete(path);
    },
  };
  return { seams, remaining };
}

const staleContent = JSON.stringify({ version: "5.0.0-node-18-abcdef" });
const freshContent = JSON.stringify({ version: "5.0.0-node-20-fedcba" });

describe("heal-stale-tsbuildinfo", () => {
  // scenario: "heal-stale-tsbuildinfo detects and unlinks build cache from old node version"
  test("detects, applies, verifies for a single stale file", () => {
    const { seams, remaining } = makeSeams({
      "/host/.tsbuildinfo": staleContent,
    });

    const detected = healStale.detect(seams);
    expect(detected.present).toBe(true);
    if (detected.present) {
      expect(detected.signal).toBe("stale-tsbuildinfo");
    }

    const applied = healStale.apply(seams);
    expect(applied.applied).toBe(true);
    expect(applied.changedFiles).toEqual(["/host/.tsbuildinfo"]);
    expect(remaining.has("/host/.tsbuildinfo")).toBe(false);

    expect(healStale.verify(seams)).toEqual({ healed: true });
  });

  // scenario: "heal-stale-tsbuildinfo recurses into subpaths"
  test("removes stale .tsbuildinfo files in subdirectories", () => {
    const { seams, remaining } = makeSeams({
      "/host/.tsbuildinfo": staleContent,
      "/host/novel/cross-repo-runner/.tsbuildinfo": staleContent,
    });

    const applied = healStale.apply(seams);
    expect(applied.applied).toBe(true);
    expect(applied.changedFiles).toHaveLength(2);
    expect(remaining.size).toBe(0);
  });

  // scenario: "heal-stale-tsbuildinfo is idempotent"
  test("apply is idempotent under replay", () => {
    const { seams, remaining } = makeSeams({
      "/host/.tsbuildinfo": staleContent,
    });

    const first = healStale.apply(seams);
    expect(first.applied).toBe(true);

    // Second apply: file is already gone.
    const second = healStale.apply(seams);
    expect(second.applied).toBe(false);
    expect(second.notes).toBe("no stale files found");
    expect(remaining.size).toBe(0);
  });

  test("does not touch fresh .tsbuildinfo files", () => {
    const { seams, remaining } = makeSeams({
      "/host/.tsbuildinfo": freshContent,
    });
    expect(healStale.detect(seams).present).toBe(false);
    const applied = healStale.apply(seams);
    expect(applied.applied).toBe(false);
    expect(remaining.has("/host/.tsbuildinfo")).toBe(true);
  });

  test("mixed fresh + stale: removes only stale", () => {
    const { seams, remaining } = makeSeams({
      "/host/.tsbuildinfo": staleContent,
      "/host/novel/.tsbuildinfo": freshContent,
    });
    const applied = healStale.apply(seams);
    expect(applied.applied).toBe(true);
    expect(applied.changedFiles).toEqual(["/host/.tsbuildinfo"]);
    expect(remaining.has("/host/novel/.tsbuildinfo")).toBe(true);
    expect(remaining.has("/host/.tsbuildinfo")).toBe(false);
  });

  test("garbage JSON in .tsbuildinfo is treated as stale (safe to remove)", () => {
    const { seams } = makeSeams({
      "/host/.tsbuildinfo": "not-valid-json{{{",
    });
    expect(healStale.detect(seams).present).toBe(true);
  });

  test("detect returns present:false when no .tsbuildinfo files exist", () => {
    const { seams } = makeSeams({});
    expect(healStale.detect(seams).present).toBe(false);
  });
});
