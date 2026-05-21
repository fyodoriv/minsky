import { describe, expect, it } from "vitest";
import { createDuplicateCheckFetcher } from "./duplicate-pr-detector-fetch.js";

const NOW = Date.parse("2026-05-07T12:00:00Z");
const fixedNow = () => NOW;

describe("createDuplicateCheckFetcher", () => {
  it("calls runGhPrList with the canonical args (search in:title, author=@me, state=all, json fields)", async () => {
    const seenArgs: string[][] = [];
    const fetcher = createDuplicateCheckFetcher({
      now: fixedNow,
      runGhPrList: async (args) => {
        seenArgs.push([...args]);
        return "[]";
      },
    });
    await fetcher("my-task");
    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]).toEqual([
      "pr",
      "list",
      "--search",
      "my-task in:title",
      "--author",
      "@me",
      "--state",
      "all",
      "--json",
      "number,title,state,closedAt",
      "--limit",
      "100",
    ]);
  });

  it("returns kind:'none' when no PR matches the task ID", async () => {
    const fetcher = createDuplicateCheckFetcher({
      now: fixedNow,
      runGhPrList: async () =>
        JSON.stringify([{ number: 1, title: "feat(other-task): foo", state: "OPEN" }]),
    });
    expect(await fetcher("my-task")).toEqual({ kind: "none" });
  });

  it("returns kind:'open' when an open PR for the task is in flight (daemon should fix-iterate)", async () => {
    const fetcher = createDuplicateCheckFetcher({
      now: fixedNow,
      runGhPrList: async () =>
        JSON.stringify([
          {
            number: 343,
            title: "feat(my-task): slice 2",
            state: "OPEN",
            closedAt: "0001-01-01T00:00:00Z",
          },
        ]),
    });
    expect(await fetcher("my-task")).toEqual({ kind: "open", prNumber: 343 });
  });

  it("returns kind:'merged-recent' when a PR merged within the window (the #343-dup-of-#309 case)", async () => {
    const fetcher = createDuplicateCheckFetcher({
      now: fixedNow,
      runGhPrList: async () =>
        JSON.stringify([
          {
            number: 309,
            title: "feat(my-task): slice 1",
            state: "MERGED",
            closedAt: "2026-05-06T12:00:00Z",
          },
        ]),
    });
    const decision = await fetcher("my-task");
    expect(decision.kind).toBe("merged-recent");
    if (decision.kind !== "merged-recent") throw new Error("unreachable");
    expect(decision.prNumber).toBe(309);
    expect(decision.daysAgo).toBeCloseTo(1, 1);
  });

  it("forwards recentMergedWindowDays to the decision", async () => {
    const raw = JSON.stringify([
      {
        number: 5,
        title: "feat(my-task): slice 1",
        state: "MERGED",
        closedAt: "2026-05-04T12:00:00Z",
      },
    ]);
    const tight = createDuplicateCheckFetcher({
      now: fixedNow,
      recentMergedWindowDays: 1,
      runGhPrList: async () => raw,
    });
    expect(await tight("my-task")).toEqual({ kind: "none" });

    const loose = createDuplicateCheckFetcher({
      now: fixedNow,
      recentMergedWindowDays: 7,
      runGhPrList: async () => raw,
    });
    expect((await loose("my-task")).kind).toBe("merged-recent");
  });

  it("appends --repo when repo is supplied", async () => {
    const seenArgs: string[][] = [];
    const fetcher = createDuplicateCheckFetcher({
      now: fixedNow,
      repo: "owner/name",
      runGhPrList: async (args) => {
        seenArgs.push([...args]);
        return "[]";
      },
    });
    await fetcher("my-task");
    expect(seenArgs[0]).toContain("--repo");
    expect(seenArgs[0]).toContain("owner/name");
  });

  it("respects a custom author", async () => {
    const seenArgs: string[][] = [];
    const fetcher = createDuplicateCheckFetcher({
      now: fixedNow,
      author: "minsky-bot",
      runGhPrList: async (args) => {
        seenArgs.push([...args]);
        return "[]";
      },
    });
    await fetcher("my-task");
    const authorIdx = seenArgs[0]?.indexOf("--author") ?? -1;
    expect(authorIdx).toBeGreaterThanOrEqual(0);
    expect(seenArgs[0]?.[authorIdx + 1]).toBe("minsky-bot");
  });

  it("graceful-degrades to kind:'none' on malformed gh JSON (no throw)", async () => {
    const fetcher = createDuplicateCheckFetcher({
      now: fixedNow,
      runGhPrList: async () => "not json {{{",
    });
    expect(await fetcher("my-task")).toEqual({ kind: "none" });
  });

  it("propagates I/O errors as rejected promises (rule #6 let-it-crash)", async () => {
    const fetcher = createDuplicateCheckFetcher({
      runGhPrList: async () => {
        throw new Error("gh: not authenticated");
      },
    });
    await expect(fetcher("my-task")).rejects.toThrow(/not authenticated/);
  });
});
