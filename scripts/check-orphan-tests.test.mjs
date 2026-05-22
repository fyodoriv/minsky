// Tests for the pure functions in check-orphan-tests.mjs.
// Pattern: deterministic lint test — paired positive/negative fixtures
//   (Meszaros 2007). Injects file bodies through resolver callbacks so
//   the test never touches the real filesystem.

import { describe, expect, test } from "vitest";

import { checkOrphans, extractNamedExports, extractNamedImports } from "./check-orphan-tests.mjs";

describe("extractNamedImports", () => {
  test("(a) two named imports from one specifier", () => {
    const body = `import { foo, bar } from "../src/x.js";\n`;
    expect(extractNamedImports(body)).toEqual([
      { symbol: "foo", fromSpec: "../src/x.js" },
      { symbol: "bar", fromSpec: "../src/x.js" },
    ]);
  });

  test("(b) named import with `as` alias — captures the SOURCE name", () => {
    const body = `import { foo as fooAlias } from "../src/x.js";\n`;
    expect(extractNamedImports(body)).toEqual([{ symbol: "foo", fromSpec: "../src/x.js" }]);
  });

  test("(c) `import type { ... }` is fully skipped (pure type import)", () => {
    const body = `import type { Foo } from "../src/x.js";\n`;
    expect(extractNamedImports(body)).toEqual([]);
  });

  test("(d) per-token `type ` modifier is skipped in mixed imports", () => {
    const body = `import { type Foo, bar } from "../src/x.js";\n`;
    expect(extractNamedImports(body)).toEqual([{ symbol: "bar", fromSpec: "../src/x.js" }]);
  });

  test("(e) default imports are NOT captured (out of scope)", () => {
    const body = `import foo from "../src/x.js";\n`;
    expect(extractNamedImports(body)).toEqual([]);
  });

  test("(f) namespace imports are NOT captured (out of scope)", () => {
    const body = `import * as foo from "../src/x.js";\n`;
    expect(extractNamedImports(body)).toEqual([]);
  });

  test("(g) multi-line named imports across newlines", () => {
    const body = `import {\n  foo,\n  bar,\n  baz,\n} from "../src/x.js";\n`;
    const got = extractNamedImports(body);
    expect(got).toEqual([
      { symbol: "foo", fromSpec: "../src/x.js" },
      { symbol: "bar", fromSpec: "../src/x.js" },
      { symbol: "baz", fromSpec: "../src/x.js" },
    ]);
  });

  test("(h) two import statements in the same file are both captured", () => {
    const body = `import { foo } from "../src/a.js";\n` + `import { bar } from "../src/b.js";\n`;
    expect(extractNamedImports(body)).toEqual([
      { symbol: "foo", fromSpec: "../src/a.js" },
      { symbol: "bar", fromSpec: "../src/b.js" },
    ]);
  });
});

describe("extractNamedExports", () => {
  test("(a) block export captures every name", () => {
    const body = "export { foo, bar, baz };\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names].sort()).toEqual(["bar", "baz", "foo"]);
  });

  test("(b) block re-export captures the renamed names too", () => {
    const body = `export { foo as fooAlias, bar } from "./up.js";\n`;
    const names = extractNamedExports(body, () => undefined);
    expect([...names].sort()).toEqual(["bar", "fooAlias"]);
  });

  test("(c) inline `export const foo = ...`", () => {
    const body = "export const foo = 42;\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names]).toEqual(["foo"]);
  });

  test("(d) inline `export function foo(...)`", () => {
    const body = "export function foo() {}\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names]).toEqual(["foo"]);
  });

  test("(e) inline `export async function foo(...)`", () => {
    const body = "export async function foo() {}\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names]).toEqual(["foo"]);
  });

  test("(f) inline `export class Foo {...}`", () => {
    const body = "export class Foo {}\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names]).toEqual(["Foo"]);
  });

  test("(g) inline `export type Foo = ...`", () => {
    const body = "export type Foo = string;\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names]).toEqual(["Foo"]);
  });

  test("(h) inline `export interface Foo ...`", () => {
    const body = "export interface Foo { x: string }\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names]).toEqual(["Foo"]);
  });

  test('(i) `export * from "./x.js"` recurses through resolveAndRead', () => {
    const body = `export * from "./up.js";\n`;
    const names = extractNamedExports(body, (spec) =>
      spec === "./up.js" ? "export const fromUpstream = 1;\n" : undefined,
    );
    expect([...names]).toEqual(["fromUpstream"]);
  });

  test("(j) cycle in re-exports doesn't crash (visited guard)", () => {
    const aBody = `export * from "./b.js";\nexport const fromA = 1;\n`;
    const bBody = `export * from "./a.js";\nexport const fromB = 2;\n`;
    const names = extractNamedExports(aBody, (spec) => {
      if (spec === "./b.js") return bBody;
      if (spec === "./a.js") return aBody;
      return undefined;
    });
    // We capture fromA directly + fromB via the re-export.
    expect([...names].sort()).toEqual(["fromA", "fromB"]);
  });

  test("(k) `export default ...` is NOT captured (not a named export)", () => {
    const body = "export default function() {}\n";
    const names = extractNamedExports(body, () => undefined);
    expect([...names]).toEqual([]);
  });
});

describe("checkOrphans", () => {
  function makeResolver(/** @type {Record<string, string>} */ files) {
    return (/** @type {string} */ spec) =>
      files[spec] !== undefined ? { body: files[spec], resolved: spec } : null;
  }

  test("(a) every imported symbol is exported by sibling source → no violations", () => {
    const result = checkOrphans({
      testBody: `import { foo, bar } from "../src/x.js";\n`,
      resolveSource: makeResolver({
        "../src/x.js": "export function foo() {}\nexport const bar = 1;\n",
      }),
    });
    expect(result.violations).toEqual([]);
  });

  test("(b) symbol imported but not exported → violation with resolved path", () => {
    const result = checkOrphans({
      testBody: `import { foo, missing } from "../src/x.js";\n`,
      resolveSource: makeResolver({
        "../src/x.js": "export function foo() {}\n",
      }),
    });
    expect(result.violations).toEqual([
      { symbol: "missing", fromSpec: "../src/x.js", resolved: "../src/x.js" },
    ]);
  });

  test("(c) the regression class from PR #639: tui slice-2/3 imports against slice-1 src", () => {
    // The exact shape the rule was born to catch.
    const testBody =
      `import { formatProcRow } from "../src/index.js";\n` +
      `import { renderDetail } from "../src/render.js";\n`;
    const result = checkOrphans({
      testBody,
      resolveSource: makeResolver({
        "../src/index.js": "export function listProcs() {}\n", // slice-1 only
        "../src/render.js": "export function renderTui() {}\n", // slice-1 only
      }),
    });
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]?.symbol).toBe("formatProcRow");
    expect(result.violations[1]?.symbol).toBe("renderDetail");
  });

  test("(d) unresolved specifier (no such source file) → violation with null resolved", () => {
    const result = checkOrphans({
      testBody: `import { foo } from "../src/missing.js";\n`,
      resolveSource: () => null,
    });
    expect(result.violations).toEqual([
      { symbol: "foo", fromSpec: "../src/missing.js", resolved: null },
    ]);
  });

  test("(e) `crossDirOnly` true (default) skips intra-test imports", () => {
    const result = checkOrphans({
      testBody:
        `import { localHelper } from "./helpers.js";\n` + // local — skipped
        `import { foo } from "../src/x.js";\n`, // cross-dir — checked
      resolveSource: makeResolver({
        "../src/x.js": "export function foo() {}\n",
      }),
    });
    expect(result.violations).toEqual([]); // both fine
  });

  test("(f) `crossDirOnly=false` checks every relative import", () => {
    const result = checkOrphans({
      testBody: `import { localMissing } from "./helpers.js";\n`,
      resolveSource: () => null,
      crossDirOnly: false,
    });
    expect(result.violations).toEqual([
      { symbol: "localMissing", fromSpec: "./helpers.js", resolved: null },
    ]);
  });

  test("(g) re-export chain: src/index.js re-exports from helpers → import resolves", () => {
    const result = checkOrphans({
      testBody: `import { fromHelper } from "../src/index.js";\n`,
      resolveSource: makeResolver({
        "../src/index.js": `export * from "./helpers.js";\n`,
      }),
      resolveReexport: (_sourceSpec, reexportSpec) =>
        reexportSpec === "./helpers.js" ? "export const fromHelper = 1;\n" : undefined,
    });
    expect(result.violations).toEqual([]);
  });

  test("(h) the `import type` shape is fully skipped — no violations for type-only imports", () => {
    const result = checkOrphans({
      testBody: `import type { Foo, Bar } from "../src/types.js";\n`,
      resolveSource: makeResolver({
        "../src/types.js": "", // exports nothing
      }),
    });
    expect(result.violations).toEqual([]);
  });

  test("(i) mixed `import { type Foo, bar }` — only bar is checked", () => {
    const result = checkOrphans({
      testBody: `import { type Foo, bar } from "../src/x.js";\n`,
      resolveSource: makeResolver({
        "../src/x.js": "export const bar = 1;\n", // Foo not exported, but type-only is skipped
      }),
    });
    expect(result.violations).toEqual([]);
  });

  test("(j) ../../src/ (two-up topology) is also checked", () => {
    const result = checkOrphans({
      testBody: `import { foo } from "../../src/x.js";\n`,
      resolveSource: makeResolver({
        "../../src/x.js": "export function nope() {}\n",
      }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.symbol).toBe("foo");
  });
});

describe("regression — fictional but plausible orphan-test cases", () => {
  test("(k) bulk import where 2 of 5 symbols are missing — both reported", () => {
    const result = checkOrphans({
      testBody: `import { a, b, c, d, e } from "../src/m.js";\n`,
      resolveSource: (spec) =>
        spec === "../src/m.js"
          ? {
              body: "export const a = 1;\nexport const c = 3;\nexport const e = 5;\n",
              resolved: spec,
            }
          : null,
    });
    expect(result.violations.map((v) => v.symbol).sort()).toEqual(["b", "d"]);
  });

  test("(l) alias misuse — test says `import { wrongName as right }` but only `right` exists in src", () => {
    // Test imports `wrongName as right` — meaning the source must EXPORT
    // wrongName. If the source only exports `right`, the test is broken.
    const result = checkOrphans({
      testBody: `import { wrongName as right } from "../src/x.js";\n`,
      resolveSource: (spec) =>
        spec === "../src/x.js" ? { body: "export const right = 1;\n", resolved: spec } : null,
    });
    expect(result.violations).toEqual([
      { symbol: "wrongName", fromSpec: "../src/x.js", resolved: "../src/x.js" },
    ]);
  });
});
