import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { OmcReader, list } from "./reader.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, "..", "test", "fixtures");
const FIXTURES_EMPTY = resolve(HERE, "..", "test", "fixtures-empty");

describe("OmcReader.list", () => {
  it("returns [] when `.omc/state/team/` is missing (cold-start path)", async () => {
    const tasks = await OmcReader.list({ repoRoot: FIXTURES_EMPTY });
    expect(tasks).toEqual([]);
  });

  it("returns one parsed task when only one is present (per-team filter)", async () => {
    const tasks = await list({ repoRoot: FIXTURES_ROOT, teamName: "other-team" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task-otr-001");
    expect(tasks[0]?.status).toBe("pending");
  });

  it("walks every team when teamName is omitted, sorted by team then by file name", async () => {
    const tasks = await list({ repoRoot: FIXTURES_ROOT });
    const ids = tasks.map((t) => t.id);
    // fixture-team has task-001 + task-002 (malformed.json is skipped),
    // other-team has task-otr-001.  Team order = alphabetical.
    expect(ids).toEqual(["task-001", "task-002", "task-otr-001"]);
  });

  it("skips malformed JSON files with a stderr advisory (rule #7 graceful-degrade)", async () => {
    const original = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
      // rule-6: handled-locally — test-only stderr capture restored in finally; not a production catch
    }) as typeof process.stderr.write;
    try {
      const tasks = await list({ repoRoot: FIXTURES_ROOT, teamName: "fixture-team" });
      expect(tasks.map((t) => t.id)).toEqual(["task-001", "task-002"]);
      expect(captured.join("")).toMatch(/skip malformed JSON/);
    } finally {
      process.stderr.write = original;
    }
  });

  it("returns [] for an unknown teamName even when other teams exist", async () => {
    const tasks = await list({ repoRoot: FIXTURES_ROOT, teamName: "no-such-team" });
    expect(tasks).toEqual([]);
  });
});
