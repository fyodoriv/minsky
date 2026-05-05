import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ExecFileLike,
  createFileBackedCtoAuditLock,
  createGitGhSignalsBuilder,
  extractPrUrl,
  parseFilesChangedFromGit,
  parseRecentMainCommitsFromGit,
} from "./cto-audit-cli-wiring.js";

describe("createFileBackedCtoAuditLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "cto-audit-lock-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports lockExists=false before any acquireLock", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    expect(lock.lockExists("some-task")).toBe(false);
  });

  it("reports lockExists=true after acquireLock for the same id", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    lock.acquireLock("some-task");
    expect(lock.lockExists("some-task")).toBe(true);
  });

  it("isolates locks per taskId", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    lock.acquireLock("task-a");
    expect(lock.lockExists("task-a")).toBe(true);
    expect(lock.lockExists("task-b")).toBe(false);
  });

  it("persists lock state across instances (crash-safe)", () => {
    const first = createFileBackedCtoAuditLock(dir);
    first.acquireLock("persisted");
    // Simulate daemon restart — fresh factory pointing at the same dir.
    const second = createFileBackedCtoAuditLock(dir);
    expect(second.lockExists("persisted")).toBe(true);
  });

  it("creates the lock directory lazily on first acquire", () => {
    const nested = resolve(dir, "nested", "deep");
    const lock = createFileBackedCtoAuditLock(nested);
    expect(() => lock.acquireLock("first-ever")).not.toThrow();
    expect(lock.lockExists("first-ever")).toBe(true);
  });

  it("sanitises non-conforming taskId characters to defend against path traversal", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    // Path-traversal would otherwise touch the parent dir; sanitisation
    // keeps the lock file inside `dir`.
    lock.acquireLock("../../escape");
    const sanitisedSentinel = resolve(dir, "______escape");
    expect(() => readFileSync(sanitisedSentinel, "utf-8")).not.toThrow();
  });
});

describe("extractPrUrl", () => {
  it("returns the first GitHub PR URL when present", () => {
    const tail = "PR #176 opened: https://github.com/fyodoriv/minsky/pull/176\nDone";
    expect(extractPrUrl(tail)).toBe("https://github.com/fyodoriv/minsky/pull/176");
  });

  it("returns null when no PR URL is present", () => {
    expect(extractPrUrl("noop, exiting")).toBeNull();
  });

  it("returns the first match when multiple URLs are present", () => {
    const tail = ["https://github.com/x/y/pull/1", "https://github.com/x/y/pull/2"].join("\n");
    expect(extractPrUrl(tail)).toBe("https://github.com/x/y/pull/1");
  });

  it("ignores non-PR github URLs (issues, commits)", () => {
    const tail = ["https://github.com/x/y/issues/3", "https://github.com/x/y/commit/abcdef"].join(
      "\n",
    );
    expect(extractPrUrl(tail)).toBeNull();
  });
});

describe("parseFilesChangedFromGit", () => {
  it("returns one entry per non-empty line", () => {
    const out = "src/foo.ts\nsrc/bar.ts\nREADME.md";
    expect(parseFilesChangedFromGit(out)).toEqual(["src/foo.ts", "src/bar.ts", "README.md"]);
  });

  it("returns empty array for empty input (no commit landed)", () => {
    expect(parseFilesChangedFromGit("")).toEqual([]);
    expect(parseFilesChangedFromGit("\n\n  \n")).toEqual([]);
  });
});

describe("parseRecentMainCommitsFromGit", () => {
  it("reverses git's newest-first order to oldest-first", () => {
    const out = "newest\nmiddle\noldest";
    expect(parseRecentMainCommitsFromGit(out)).toEqual(["oldest", "middle", "newest"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseRecentMainCommitsFromGit("")).toEqual([]);
  });
});

/** Per-call response keyed by the routing predicate; first-match wins. */
type Route = { match: (file: string, args: readonly string[]) => boolean; out: string };

function fakeExec(routes: readonly Route[]): ExecFileLike {
  return vi.fn(async (file, args) => {
    const hit = routes.find((r) => r.match(file, args));
    return hit ? hit.out : "";
  });
}

const isGitNameOnly: Route["match"] = (file, args) =>
  file === "git" && args.includes("--name-only");
const isGitLog: Route["match"] = (file) => file === "git";
const isGhKind =
  (kind: "issue" | "pr"): Route["match"] =>
  (file, args) =>
    file === "gh" && args[0] === kind;
const isGh: Route["match"] = (file) => file === "gh";

describe("createGitGhSignalsBuilder", () => {
  it("threads taskId + extracts prUrl from spawnStdoutTail", async () => {
    const execFile = fakeExec([
      { match: isGitNameOnly, out: "a.ts\nb.ts" },
      { match: isGitLog, out: "feat: c\nfeat: b\nfeat: a" },
      { match: isGh, out: "[]" },
    ]);
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({
      taskId: "my-task",
      spawnStdoutTail: "PR opened https://github.com/x/y/pull/42",
    });
    expect(signals.completedTaskId).toBe("my-task");
    expect(signals.prUrl).toBe("https://github.com/x/y/pull/42");
    expect(signals.filesChanged).toEqual(["a.ts", "b.ts"]);
    expect(signals.recentMainCommits).toEqual(["feat: a", "feat: b", "feat: c"]);
    expect(signals.lintScores).toEqual({});
  });

  it("sums open-issue and open-pr counts via gh ... --json=number", async () => {
    const execFile = fakeExec([
      { match: isGhKind("issue"), out: '[{"number":1},{"number":2}]' },
      { match: isGhKind("pr"), out: '[{"number":3},{"number":4},{"number":5}]' },
    ]);
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({ taskId: "x", spawnStdoutTail: "" });
    expect(signals.openWorkItems).toBe(5);
  });

  it("graceful-degrades to zero/empty when execFile rejects (rule #7)", async () => {
    const execFile: ExecFileLike = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({ taskId: "x", spawnStdoutTail: "" });
    expect(signals.filesChanged).toEqual([]);
    expect(signals.recentMainCommits).toEqual([]);
    expect(signals.openWorkItems).toBe(0);
    expect(signals.prUrl).toBeNull();
  });

  it("graceful-degrades when gh returns non-array JSON", async () => {
    const execFile = fakeExec([{ match: isGh, out: '{"unexpected":"shape"}' }]);
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({ taskId: "x", spawnStdoutTail: "" });
    expect(signals.openWorkItems).toBe(0);
  });
});
