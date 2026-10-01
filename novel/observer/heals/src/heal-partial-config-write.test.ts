// Tests for heal-partial-config-write
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import type { PartialConfigWriteSeams } from "./heal-partial-config-write.js";
import * as heal from "./heal-partial-config-write.js";

function makeSeams(
  files: Record<string, string>,
  options: { now?: number; configFilePath?: string } = {},
): { seams: PartialConfigWriteSeams; fs: Map<string, string> } {
  const fs = new Map(Object.entries(files));
  const seams: PartialConfigWriteSeams = {
    configFilePath: options.configFilePath ?? "/home/user/.minsky/config.json",
    nowFn: () => options.now ?? 1_700_000_000_000,
    existsSyncFn: (path) => fs.has(path),
    readFileSyncFn: (path) => {
      const value = fs.get(path);
      if (value === undefined) {
        const err = new Error(`ENOENT: no such file ${path}`) as Error & {
          code: string;
        };
        err.code = "ENOENT";
        throw err;
      }
      return value;
    },
    writeFileSyncFn: (path, content) => {
      fs.set(path, content);
    },
    renameSyncFn: (oldPath, newPath) => {
      const value = fs.get(oldPath);
      if (value === undefined) {
        throw new Error(`ENOENT: rename source missing ${oldPath}`);
      }
      fs.set(newPath, value);
      fs.delete(oldPath);
    },
  };
  return { seams, fs };
}

const TRUNCATED = '{"cost_tier": "opus-sonnet", "host_pat';
const SYNTAX_ERROR = '{"cost_tier": "opus-sonnet" "host_paths": ["/x"]}';
const HEALTHY = '{"cost_tier": "opus-sonnet", "host_paths": ["/foo"]}';

describe("heal-partial-config-write", () => {
  test("detects a truncated config.json", () => {
    const { seams } = makeSeams({ "/home/user/.minsky/config.json": TRUNCATED });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.signal).toBe("partial-config-write");
      expect(result.evidence["contentLength"]).toBe(TRUNCATED.length);
    }
  });

  test("detects a JSON-syntax-error config.json", () => {
    const { seams } = makeSeams({
      "/home/user/.minsky/config.json": SYNTAX_ERROR,
    });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
  });

  test("detects an empty config.json", () => {
    const { seams } = makeSeams({ "/home/user/.minsky/config.json": "" });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
  });

  test("does NOT detect a healthy config.json", () => {
    const { seams } = makeSeams({ "/home/user/.minsky/config.json": HEALTHY });
    const result = heal.detect(seams);
    expect(result.present).toBe(false);
  });

  test("does NOT detect a missing config.json (scope: present-but-unparseable only)", () => {
    const { seams } = makeSeams({});
    const result = heal.detect(seams);
    expect(result.present).toBe(false);
  });

  test("apply backs up the corrupt file with a timestamped suffix and reseeds {}", () => {
    const { seams, fs } = makeSeams(
      { "/home/user/.minsky/config.json": TRUNCATED },
      { now: 1_700_000_000_000 },
    );
    const result = heal.apply(seams);
    expect(result.applied).toBe(true);
    expect(result.changedFiles).toContain("/home/user/.minsky/config.json");
    expect(result.changedFiles).toContain("/home/user/.minsky/config.json.corrupt.1700000000000");
    expect(fs.get("/home/user/.minsky/config.json")).toBe("{}\n");
    expect(fs.get("/home/user/.minsky/config.json.corrupt.1700000000000")).toBe(TRUNCATED);
  });

  test("apply is a no-op on a healthy config.json", () => {
    const { seams, fs } = makeSeams({
      "/home/user/.minsky/config.json": HEALTHY,
    });
    const before = fs.get("/home/user/.minsky/config.json");
    const result = heal.apply(seams);
    expect(result.applied).toBe(false);
    expect(result.changedFiles).toEqual([]);
    expect(fs.get("/home/user/.minsky/config.json")).toBe(before);
  });

  test("apply twice produces the same end state (idempotent)", () => {
    const { seams, fs } = makeSeams(
      { "/home/user/.minsky/config.json": TRUNCATED },
      { now: 1_700_000_000_000 },
    );
    heal.apply(seams);
    const snapshot = fs.get("/home/user/.minsky/config.json");
    heal.apply(seams);
    expect(fs.get("/home/user/.minsky/config.json")).toBe(snapshot);
  });

  test("verify returns healed after apply succeeds", () => {
    const { seams } = makeSeams(
      { "/home/user/.minsky/config.json": TRUNCATED },
      { now: 1_700_000_000_000 },
    );
    heal.apply(seams);
    const result = heal.verify(seams);
    expect(result.healed).toBe(true);
  });

  test("verify returns not-healed when apply has not run yet", () => {
    const { seams } = makeSeams({
      "/home/user/.minsky/config.json": TRUNCATED,
    });
    const result = heal.verify(seams);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.residualSignal).toBe("partial-config-write");
    }
  });
});
