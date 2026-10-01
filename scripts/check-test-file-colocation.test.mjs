// @ts-check
import { describe, expect, it } from "vitest";
import { checkTestFileColocation } from "./check-test-file-colocation.mjs";

/**
 * @param {{ files: Record<string, string>, present: string[] }} input
 */
function fakeFs(input) {
  const presentSet = new Set(input.present.map((p) => `/repo/${p}`));
  return {
    repoRoot: "/repo",
    files: Object.keys(input.files),
    fileExists: (/** @type {string} */ p) => presentSet.has(p),
    readText: (/** @type {string} */ p) => input.files[p.slice(6)] ?? "",
  };
}

describe("checkTestFileColocation", () => {
  it("passes when source has sibling .test.ts", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: { "novel/x/src/foo.ts": "export const x = 1;" },
        present: ["novel/x/src/foo.ts", "novel/x/src/foo.test.ts"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("fails when source lacks sibling test", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: { "novel/x/src/foo.ts": "export const x = 1;" },
        present: ["novel/x/src/foo.ts"],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/missing sibling test/);
  });

  it("exempts index.ts (pure re-exports)", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: { "novel/x/src/index.ts": "export * from './foo';" },
        present: ["novel/x/src/index.ts"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("exempts types.ts", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: { "novel/x/src/types.ts": "export type X = string;" },
        present: ["novel/x/src/types.ts"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("exempts *.d.ts", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: { "novel/x/src/foo.d.ts": "declare const x: string;" },
        present: ["novel/x/src/foo.d.ts"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("exempts *.test.ts (the test file itself)", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: { "novel/x/src/foo.test.ts": "" },
        present: ["novel/x/src/foo.test.ts"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("exempts *.fixture.ts", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: { "novel/x/src/foo.fixture.ts": "" },
        present: ["novel/x/src/foo.fixture.ts"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("respects no-test inline comment in first 10 lines", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: {
          "novel/x/src/foo.ts":
            "// no-test: this is a thin CLI wrapper with no behavior to test\nexport const x = 1;",
        },
        present: ["novel/x/src/foo.ts"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects no-test with empty/short reason", () => {
    const result = checkTestFileColocation(
      fakeFs({
        files: {
          "novel/x/src/foo.ts": "// no-test:\nexport const x = 1;",
        },
        present: ["novel/x/src/foo.ts"],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkTestFileColocation();
    expect(result.ok).toBe(true);
  });
});
