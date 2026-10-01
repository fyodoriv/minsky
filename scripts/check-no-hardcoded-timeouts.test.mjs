// @ts-check
import { describe, expect, it } from "vitest";
import { checkNoHardcodedTimeouts } from "./check-no-hardcoded-timeouts.mjs";

/**
 * @param {Record<string, string>} fileContents
 */
function fakeFs(fileContents) {
  return {
    repoRoot: "/repo",
    files: Object.keys(fileContents),
    readText: (/** @type {string} */ p) => fileContents[p.slice(6)] ?? "",
  };
}

describe("checkNoHardcodedTimeouts", () => {
  it("flags setTimeout with 5000ms", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({ "novel/x/src/foo.ts": "setTimeout(() => {}, 5000);" }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/setTimeout/);
    expect(result.violations[0]).toMatch(/"5000"/);
  });

  it("flags setInterval with hardcoded ms", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({ "novel/y/src/foo.ts": "setInterval(tick, 30000);" }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags await sleep(5000)", () => {
    const result = checkNoHardcodedTimeouts(fakeFs({ "novel/x/src/foo.ts": "await sleep(5000);" }));
    expect(result.ok).toBe(false);
  });

  it("flags const sleepMs = 5000", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({ "novel/x/src/foo.ts": "const sleepMs = 5000;" }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags bash `sleep 60`", () => {
    const result = checkNoHardcodedTimeouts(fakeFs({ "bin/foo.sh": "sleep 60" }));
    expect(result.ok).toBe(false);
  });

  it("passes setTimeout with TIMEOUT_MS constant", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({
        "novel/x/src/foo.ts":
          "import { TIMEOUT_MS } from './policy';\nsetTimeout(() => {}, TIMEOUT_MS);",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes small timeouts (<1000ms)", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({ "novel/x/src/foo.ts": "setTimeout(() => {}, 100);" }),
    );
    expect(result.ok).toBe(true);
  });

  it("respects timeout-ok inline allow comment", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({
        "novel/x/src/foo.ts":
          "setTimeout(() => {}, 5000); // timeout-ok: integration test polls a remote API every 5s, can't use a constant",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("skips .test.ts files (test fixtures are exempt)", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({ "novel/x/src/foo.test.ts": "setTimeout(() => {}, 5000);" }),
    );
    expect(result.ok).toBe(true);
  });

  it("flags multiple violations across files", () => {
    const result = checkNoHardcodedTimeouts(
      fakeFs({
        "novel/a/src/foo.ts": "setTimeout(() => {}, 5000);",
        "bin/b.sh": "sleep 60",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(2);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkNoHardcodedTimeouts();
    expect(result.ok).toBe(true);
  });
});
