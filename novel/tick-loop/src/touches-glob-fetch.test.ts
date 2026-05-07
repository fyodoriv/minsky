import { describe, expect, it } from "vitest";
import {
  createOpenPrFetcher,
  isDaemonAuthoredBranch,
  parseGhPrListJson,
} from "./touches-glob-fetch.js";

describe("parseGhPrListJson", () => {
  it("parses a typical gh pr list response into TouchesPrSnapshot[]", () => {
    const stdout = JSON.stringify([
      {
        number: 42,
        headRefName: "feat/foo",
        files: [{ path: "novel/x.ts" }, { path: "scripts/y.mjs" }],
      },
      {
        number: 43,
        headRefName: "fix/bar",
        files: [{ path: "TASKS.md" }],
      },
    ]);
    expect(parseGhPrListJson(stdout)).toEqual([
      { number: 42, files: ["novel/x.ts", "scripts/y.mjs"] },
      { number: 43, files: ["TASKS.md"] },
    ]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseGhPrListJson("not-json")).toEqual([]);
  });

  it("returns [] for non-array root", () => {
    expect(parseGhPrListJson('{"foo": "bar"}')).toEqual([]);
  });

  it("drops malformed rows but keeps valid ones (single bad row doesn't take down the iteration)", () => {
    const stdout = JSON.stringify([
      { number: 1, headRefName: "ok", files: [{ path: "a.ts" }] },
      "not-an-object",
      { number: "not-a-number", headRefName: "bad", files: [] },
      { number: 2, headRefName: "ok2", files: [{ path: "b.ts" }] },
    ]);
    expect(parseGhPrListJson(stdout)).toEqual([
      { number: 1, files: ["a.ts"] },
      { number: 2, files: ["b.ts"] },
    ]);
  });

  it("ignores file entries without a `path` field", () => {
    const stdout = JSON.stringify([
      {
        number: 1,
        headRefName: "x",
        files: [{ path: "good.ts" }, {}, { path: 42 }, { path: "also-good.ts" }],
      },
    ]);
    expect(parseGhPrListJson(stdout)).toEqual([{ number: 1, files: ["good.ts", "also-good.ts"] }]);
  });

  it("filters by branchFilter when provided", () => {
    const stdout = JSON.stringify([
      { number: 1, headRefName: "daemon/0/foo", files: [{ path: "a.ts" }] },
      { number: 2, headRefName: "feat/manual", files: [{ path: "b.ts" }] },
      { number: 3, headRefName: "daemon/2/bar", files: [{ path: "c.ts" }] },
    ]);
    const filtered = parseGhPrListJson(stdout, isDaemonAuthoredBranch);
    expect(filtered).toEqual([
      { number: 1, files: ["a.ts"] },
      { number: 3, files: ["c.ts"] },
    ]);
  });

  it("returns [] for empty array", () => {
    expect(parseGhPrListJson("[]")).toEqual([]);
  });
});

describe("isDaemonAuthoredBranch", () => {
  it("matches `daemon/<worker-id>/<task-id>` shape", () => {
    expect(isDaemonAuthoredBranch("daemon/0/some-task")).toBe(true);
    expect(isDaemonAuthoredBranch("daemon/12/another-task-id")).toBe(true);
  });

  it("rejects non-daemon branches", () => {
    expect(isDaemonAuthoredBranch("feat/foo")).toBe(false);
    expect(isDaemonAuthoredBranch("fix/bar")).toBe(false);
    expect(isDaemonAuthoredBranch("main")).toBe(false);
  });

  it("rejects daemon-prefixed branches without the worker-id segment", () => {
    expect(isDaemonAuthoredBranch("daemon/foo")).toBe(false);
    expect(isDaemonAuthoredBranch("daemon-stuff")).toBe(false);
  });
});

describe("createOpenPrFetcher", () => {
  it("calls runGhPrList with the canonical args (author=@me, state=open, json fields)", async () => {
    const seenArgs: string[][] = [];
    const fetcher = createOpenPrFetcher({
      runGhPrList: async (args) => {
        seenArgs.push([...args]);
        return JSON.stringify([{ number: 1, headRefName: "feat/x", files: [{ path: "a.ts" }] }]);
      },
    });
    const snapshot = await fetcher();
    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]).toEqual([
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "open",
      "--json",
      "number,files,headRefName",
      "--limit",
      "100",
    ]);
    expect(snapshot).toEqual([{ number: 1, files: ["a.ts"] }]);
  });

  it("appends --repo when repo is supplied", async () => {
    const seenArgs: string[][] = [];
    const fetcher = createOpenPrFetcher({
      repo: "owner/name",
      runGhPrList: async (args) => {
        seenArgs.push([...args]);
        return "[]";
      },
    });
    await fetcher();
    expect(seenArgs[0]).toContain("--repo");
    expect(seenArgs[0]).toContain("owner/name");
  });

  it("applies branchFilter via the parser", async () => {
    const fetcher = createOpenPrFetcher({
      branchFilter: isDaemonAuthoredBranch,
      runGhPrList: async () =>
        JSON.stringify([
          { number: 1, headRefName: "daemon/0/foo", files: [{ path: "a.ts" }] },
          { number: 2, headRefName: "feat/manual", files: [{ path: "b.ts" }] },
        ]),
    });
    expect(await fetcher()).toEqual([{ number: 1, files: ["a.ts"] }]);
  });

  it("respects custom author", async () => {
    const seenArgs: string[][] = [];
    const fetcher = createOpenPrFetcher({
      author: "fyodoriv",
      runGhPrList: async (args) => {
        seenArgs.push([...args]);
        return "[]";
      },
    });
    await fetcher();
    const authorIdx = seenArgs[0]?.indexOf("--author") ?? -1;
    expect(authorIdx).toBeGreaterThanOrEqual(0);
    expect(seenArgs[0]?.[authorIdx + 1]).toBe("fyodoriv");
  });

  it("propagates I/O errors as rejected promises (rule #6 let-it-crash)", async () => {
    const fetcher = createOpenPrFetcher({
      runGhPrList: async () => {
        throw new Error("gh: not authenticated");
      },
    });
    await expect(fetcher()).rejects.toThrow(/not authenticated/);
  });
});
