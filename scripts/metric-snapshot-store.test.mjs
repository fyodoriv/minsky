// Tests for metric-snapshot-store.mjs. Pattern: paired positive/negative
// fixtures over pure helpers (Meszaros 2007). The I/O surface
// (`loadSnapshot` / `saveSnapshot`) takes injected `readFile` /
// `writeFile` / `mkdir` seams, so every test runs in-memory — no
// temp dirs, no flake.

import { describe, expect, test } from "vitest";

import {
  loadSnapshot,
  previousDateUtc,
  saveSnapshot,
  snapshotPath,
  validateSnapshot,
} from "./metric-snapshot-store.mjs";

const ROOT = "/tmp/repo";

describe("snapshotPath", () => {
  test("joins rootDir with .minsky/metric-snapshots/<date>.json", () => {
    expect(snapshotPath({ rootDir: ROOT, date: "2026-05-05" })).toBe(
      "/tmp/repo/.minsky/metric-snapshots/2026-05-05.json",
    );
  });

  test("trailing slash on rootDir is normalised", () => {
    expect(snapshotPath({ rootDir: "/tmp/repo/", date: "2026-05-05" })).toBe(
      "/tmp/repo/.minsky/metric-snapshots/2026-05-05.json",
    );
  });

  test("rejects malformed date strings", () => {
    expect(() => snapshotPath({ rootDir: ROOT, date: "5/5/2026" })).toThrow(/YYYY-MM-DD/);
  });

  test("rejects non-existent calendar dates (e.g. 2026-02-30)", () => {
    expect(() => snapshotPath({ rootDir: ROOT, date: "2026-02-30" })).toThrow(/calendar date/);
  });

  test("rejects empty rootDir", () => {
    expect(() => snapshotPath({ rootDir: "", date: "2026-05-05" })).toThrow(/non-empty/);
  });
});

describe("previousDateUtc", () => {
  test("simple intra-month decrement", () => {
    expect(previousDateUtc("2026-05-05")).toBe("2026-05-04");
  });

  test("month boundary decrement", () => {
    expect(previousDateUtc("2026-05-01")).toBe("2026-04-30");
  });

  test("year boundary decrement", () => {
    expect(previousDateUtc("2026-01-01")).toBe("2025-12-31");
  });

  test("leap-year February boundary (2024 is a leap year)", () => {
    expect(previousDateUtc("2024-03-01")).toBe("2024-02-29");
  });

  test("non-leap-year February boundary (2026 is not)", () => {
    expect(previousDateUtc("2026-03-01")).toBe("2026-02-28");
  });

  test("rejects malformed dates", () => {
    expect(() => previousDateUtc("not-a-date")).toThrow(/YYYY-MM-DD/);
  });
});

describe("validateSnapshot", () => {
  test("accepts a well-formed snapshot", () => {
    const snap = {
      uptime_h: { value: 10, higherIsBetter: true },
      findings: { value: 0, higherIsBetter: false },
    };
    expect(validateSnapshot(snap, "<test>")).toBe(snap);
  });

  test("accepts entries without higherIsBetter (default true)", () => {
    expect(validateSnapshot({ x: { value: 1 } }, "<test>")).toEqual({ x: { value: 1 } });
  });

  test("rejects null", () => {
    expect(() => validateSnapshot(null, "/snap.json")).toThrow(/JSON object/);
  });

  test("rejects arrays at the top level", () => {
    expect(() => validateSnapshot([], "/snap.json")).toThrow(/JSON object/);
  });

  test("rejects non-numeric value", () => {
    expect(() => validateSnapshot({ x: { value: "10" } }, "/snap.json")).toThrow(/finite number/);
  });

  test("rejects NaN / Infinity values", () => {
    expect(() => validateSnapshot({ x: { value: Number.NaN } }, "/snap.json")).toThrow(
      /finite number/,
    );
    expect(() =>
      validateSnapshot({ x: { value: Number.POSITIVE_INFINITY } }, "/snap.json"),
    ).toThrow(/finite number/);
  });

  test("rejects non-boolean higherIsBetter", () => {
    expect(() =>
      validateSnapshot({ x: { value: 1, higherIsBetter: "yes" } }, "/snap.json"),
    ).toThrow(/boolean/);
  });

  test("rejects scalar entry (non-object)", () => {
    expect(() => validateSnapshot({ x: 42 }, "/snap.json")).toThrow(/numeric value/);
  });
});

describe("loadSnapshot", () => {
  test("reads + parses a valid snapshot file", async () => {
    const snap = { uptime_h: { value: 10, higherIsBetter: true } };
    const readFile = async (/** @type {string} */ path) => {
      expect(path).toBe("/tmp/repo/.minsky/metric-snapshots/2026-05-05.json");
      return JSON.stringify(snap);
    };
    const out = await loadSnapshot({ rootDir: ROOT, date: "2026-05-05", readFile });
    expect(out).toEqual(snap);
  });

  test("ENOENT graceful-degrades to undefined (rule #7)", async () => {
    const readFile = async () => {
      const err = /** @type {NodeJS.ErrnoException} */ (new Error("no such file"));
      err.code = "ENOENT";
      throw err;
    };
    const out = await loadSnapshot({ rootDir: ROOT, date: "2026-05-05", readFile });
    expect(out).toBeUndefined();
  });

  test("non-ENOENT errors propagate (let-it-crash, rule #6)", async () => {
    const readFile = async () => {
      const err = /** @type {NodeJS.ErrnoException} */ (new Error("permission denied"));
      err.code = "EACCES";
      throw err;
    };
    await expect(loadSnapshot({ rootDir: ROOT, date: "2026-05-05", readFile })).rejects.toThrow(
      /permission denied/,
    );
  });

  test("malformed JSON surfaces with the source path", async () => {
    const readFile = async () => "{not json";
    await expect(loadSnapshot({ rootDir: ROOT, date: "2026-05-05", readFile })).rejects.toThrow(
      /2026-05-05\.json: malformed JSON/,
    );
  });

  test("invalid snapshot shape surfaces with the source path", async () => {
    const readFile = async () => JSON.stringify({ x: { value: "ten" } });
    await expect(loadSnapshot({ rootDir: ROOT, date: "2026-05-05", readFile })).rejects.toThrow(
      /2026-05-05\.json: metric "x" value must be a finite number/,
    );
  });
});

describe("saveSnapshot", () => {
  test("writes JSON with a trailing newline + creates the parent dir", async () => {
    /** @type {Array<{ path: string, contents: string }>} */
    const writes = [];
    /** @type {Array<{ dir: string, recursive: boolean }>} */
    const mkdirs = [];
    /** @type {import("./metric-snapshot-store.mjs").WriteFileSeam} */
    const writeFile = async (path, contents) => {
      writes.push({ path, contents });
    };
    /** @type {import("./metric-snapshot-store.mjs").MkdirSeam} */
    const mkdir = async (dir, opts) => {
      mkdirs.push({ dir, recursive: opts.recursive });
      return undefined;
    };
    const snap = { tokens_remaining: { value: 1.99e9, higherIsBetter: true } };

    const path = await saveSnapshot({
      rootDir: ROOT,
      date: "2026-05-05",
      snapshot: snap,
      writeFile,
      mkdir,
    });

    expect(path).toBe("/tmp/repo/.minsky/metric-snapshots/2026-05-05.json");
    expect(mkdirs).toEqual([{ dir: "/tmp/repo/.minsky/metric-snapshots", recursive: true }]);
    expect(writes).toHaveLength(1);
    const written = writes[0];
    if (written === undefined) throw new Error("expected a write");
    expect(written.path).toBe(path);
    // Two-space JSON + trailing newline (diffable, rule #2).
    expect(written.contents).toBe(`${JSON.stringify(snap, null, 2)}\n`);
  });

  test("rejects an invalid snapshot before touching disk", async () => {
    /** @type {Array<unknown>} */ const writes = [];
    /** @type {Array<unknown>} */ const mkdirs = [];
    /** @type {import("./metric-snapshot-store.mjs").WriteFileSeam} */
    const writeFile = async () => {
      writes.push("called");
    };
    /** @type {import("./metric-snapshot-store.mjs").MkdirSeam} */
    const mkdir = async () => {
      mkdirs.push("called");
      return undefined;
    };
    await expect(
      saveSnapshot({
        rootDir: ROOT,
        date: "2026-05-05",
        // @ts-expect-error testing bad input
        snapshot: { x: { value: "bad" } },
        writeFile,
        mkdir,
      }),
    ).rejects.toThrow(/finite number/);
    expect(writes).toEqual([]);
    expect(mkdirs).toEqual([]);
  });

  test("save → load round-trip preserves the snapshot", async () => {
    /** @type {Map<string, string>} */
    const fs = new Map();
    /** @type {import("./metric-snapshot-store.mjs").WriteFileSeam} */
    const writeFile = async (path, contents) => {
      fs.set(path, contents);
    };
    /** @type {import("./metric-snapshot-store.mjs").MkdirSeam} */
    const mkdir = async () => undefined;
    /** @type {import("./metric-snapshot-store.mjs").ReadFileSeam} */
    const readFile = async (path) => {
      const v = fs.get(path);
      if (v === undefined) {
        const err = /** @type {NodeJS.ErrnoException} */ (new Error("no such file"));
        err.code = "ENOENT";
        throw err;
      }
      return v;
    };

    const original = {
      uptime_h: { value: 10.4, higherIsBetter: true },
      findings: { value: 0, higherIsBetter: false },
      tokens_remaining: { value: 1.99e9 },
    };
    await saveSnapshot({
      rootDir: ROOT,
      date: "2026-05-05",
      snapshot: original,
      writeFile,
      mkdir,
    });
    const loaded = await loadSnapshot({ rootDir: ROOT, date: "2026-05-05", readFile });
    expect(loaded).toEqual(original);
  });
});
