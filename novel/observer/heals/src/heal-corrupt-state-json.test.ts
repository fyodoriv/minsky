// Tests for heal-corrupt-state-json
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import type { CorruptStateJsonSeams } from "./heal-corrupt-state-json.js";
import * as heal from "./heal-corrupt-state-json.js";

/**
 * Build an in-memory filesystem fixture. `files` maps path → content.
 * Operations mutate the same map so detect-after-apply observes the
 * change.
 */
function makeSeams(
  files: Record<string, string>,
  options: { now?: number; stateFilePath?: string } = {},
): { seams: CorruptStateJsonSeams; fs: Map<string, string> } {
  const fs = new Map(Object.entries(files));
  const seams: CorruptStateJsonSeams = {
    stateFilePath: options.stateFilePath ?? "/host/.minsky/state.json",
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

const TRUNCATED_JSON = '{"last_iter": 42, "incomplete';
const SYNTAX_ERROR = '{"missing": "comma" "after": "this"}';
const HEALTHY_JSON = '{"last_iter": 42, "last_task": "foo"}';

describe("heal-corrupt-state-json", () => {
  // scenario: "heal-corrupt-state-json detects an unparseable state file"
  test("detects a truncated state.json", () => {
    const { seams } = makeSeams({ "/host/.minsky/state.json": TRUNCATED_JSON });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.signal).toBe("corrupt-state-json");
      expect(result.evidence["contentLength"]).toBe(TRUNCATED_JSON.length);
    }
  });

  test("detects a JSON-syntax-error state.json", () => {
    const { seams } = makeSeams({ "/host/.minsky/state.json": SYNTAX_ERROR });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
  });

  test("detects an empty state.json", () => {
    const { seams } = makeSeams({ "/host/.minsky/state.json": "" });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
  });

  test("does NOT detect a healthy state.json", () => {
    const { seams } = makeSeams({ "/host/.minsky/state.json": HEALTHY_JSON });
    const result = heal.detect(seams);
    expect(result.present).toBe(false);
  });

  test("does NOT detect a missing state.json (scope: present-but-unparseable only)", () => {
    const { seams } = makeSeams({});
    const result = heal.detect(seams);
    expect(result.present).toBe(false);
  });

  // scenario: "heal-corrupt-state-json backs up the bad file and reseeds empty {}"
  test("apply backs up the corrupt file with a timestamped suffix and reseeds {}", () => {
    const { seams, fs } = makeSeams(
      { "/host/.minsky/state.json": TRUNCATED_JSON },
      { now: 1_700_000_000_000 },
    );
    const result = heal.apply(seams);
    expect(result.applied).toBe(true);
    expect(result.changedFiles).toContain("/host/.minsky/state.json");
    expect(result.changedFiles).toContain("/host/.minsky/state.json.corrupt.1700000000000");
    // Reseeded file is parseable empty object.
    expect(fs.get("/host/.minsky/state.json")).toBe("{}\n");
    // Backup retains the original corrupt content.
    expect(fs.get("/host/.minsky/state.json.corrupt.1700000000000")).toBe(TRUNCATED_JSON);
  });

  // scenario: "heal-corrupt-state-json is a no-op when state.json parses cleanly"
  test("apply is a no-op on a healthy state.json", () => {
    const { seams, fs } = makeSeams({
      "/host/.minsky/state.json": HEALTHY_JSON,
    });
    const before = fs.get("/host/.minsky/state.json");
    const result = heal.apply(seams);
    expect(result.applied).toBe(false);
    expect(result.changedFiles).toEqual([]);
    // File unchanged.
    expect(fs.get("/host/.minsky/state.json")).toBe(before);
  });

  // scenario: "heal-corrupt-state-json is idempotent under replay"
  test("apply twice produces the same end state (idempotent)", () => {
    const { seams, fs } = makeSeams(
      { "/host/.minsky/state.json": TRUNCATED_JSON },
      { now: 1_700_000_000_000 },
    );
    heal.apply(seams);
    const snapshotAfterFirstApply = fs.get("/host/.minsky/state.json");
    heal.apply(seams); // second apply: state.json is healthy now → no-op
    expect(fs.get("/host/.minsky/state.json")).toBe(snapshotAfterFirstApply);
  });

  test("verify returns healed after apply succeeds", () => {
    const { seams } = makeSeams(
      { "/host/.minsky/state.json": TRUNCATED_JSON },
      { now: 1_700_000_000_000 },
    );
    heal.apply(seams);
    const result = heal.verify(seams);
    expect(result.healed).toBe(true);
  });

  test("verify returns not-healed when apply has not run yet", () => {
    const { seams } = makeSeams({ "/host/.minsky/state.json": TRUNCATED_JSON });
    const result = heal.verify(seams);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.residualSignal).toBe("corrupt-state-json");
    }
  });
});
