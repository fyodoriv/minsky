// @ts-check
import { describe, expect, it } from "vitest";
import { checkOtelCoverage } from "./check-rule-4-otel-coverage.mjs";

/**
 * @param {string} path
 * @param {string} source
 */
const file = (path, source) => ({ path, source });

describe("checkOtelCoverage (pure function)", () => {
  it("(a) exported function with `@otel <span>` JSDoc — 0 violations", () => {
    const src = `
/**
 * Decide budget allowance.
 * @otel budget-guard.decide
 */
export function decide(input: number): number {
  return input;
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/budget-guard/src/decide.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("(b) exported function with `@otel-exempt pure-function` — 0 violations", () => {
    const src = `
/**
 * Sum two numbers.
 * @otel-exempt pure-function
 */
export function add(a: number, b: number): number {
  return a + b;
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/add.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("(c) exported function with neither — 1 violation, file:line:name reported", () => {
    const src = `
export function untracked(): void {
  return;
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/untracked.ts", src)],
    });
    expect(violations).toHaveLength(1);
    const v = violations[0];
    if (v === undefined) throw new Error("unreachable");
    expect(v.file).toBe("novel/foo/src/untracked.ts");
    expect(v.name).toBe("untracked");
    expect(v.line).toBeGreaterThanOrEqual(1);
  });

  it("(d) non-exported (private) function — 0 violations regardless", () => {
    const src = `
function privateHelper(): void {
  return;
}

/**
 * @otel foo.public
 */
export function publicOne(): void {
  privateHelper();
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("(e) exported class method without annotation — 1 violation", () => {
    const src = `
export class Service {
  doThing(): void {
    return;
  }
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/service.ts", src)],
    });
    expect(violations).toHaveLength(1);
    const v = violations[0];
    if (v === undefined) throw new Error("unreachable");
    expect(v.name).toBe("Service.doThing");
  });

  it("(e.2) exported class method with annotation — 0 violations; constructor exempt", () => {
    const src = `
export class Service {
  constructor(private readonly dep: string) {}

  /**
   * @otel service.do-thing
   */
  doThing(): void {
    return;
  }
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/service.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("(e.3) private class method — 0 violations regardless", () => {
    const src = `
export class Service {
  /**
   * @otel service.do-public
   */
  doPublic(): void {
    this.helper();
  }

  private helper(): void {}

  #alsoPrivate(): void {}
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/service.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("(f) `export default function foo() {}` without annotation — 1 violation", () => {
    const src = `
export default function foo(): void {
  return;
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/index.ts", src)],
    });
    expect(violations).toHaveLength(1);
  });

  it("(f.2) `export default function foo() {}` with annotation — 0 violations", () => {
    const src = `
/**
 * @otel foo.default
 */
export default function foo(): void {
  return;
}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/index.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("(g) `export const f = () => ...` arrow function without annotation — 1 violation", () => {
    const src = `
export const f = (): void => {};
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toHaveLength(1);
    const v = violations[0];
    if (v === undefined) throw new Error("unreachable");
    expect(v.name).toBe("f");
  });

  it("(g.2) `export const f = () => ...` arrow function with annotation — 0 violations", () => {
    const src = `
/**
 * @otel foo.f
 */
export const f = (): void => {};
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("(g.3) `export const f = function () {}` named function expression — handled like arrow", () => {
    const src = `
export const g = function (): void {};
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toHaveLength(1);
  });

  it("(h) test file: pure function still applies the rule (caller filters paths)", () => {
    // The pure function does not look at the path; the CLI's diff-walker
    // is what excludes `.test.ts`. We assert the contract holds: same input,
    // same output, regardless of path.
    const src = `
export function helper(): void {}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.test.ts", src)],
    });
    expect(violations).toHaveLength(1);
  });

  it("(i) `@otel-exempt` with empty body — still a violation (missing reason)", () => {
    const src = `
/**
 * @otel-exempt
 */
export function f(): void {}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toHaveLength(1);
    const v = violations[0];
    if (v === undefined) throw new Error("unreachable");
    expect(v.reason).toMatch(/missing reason/i);
  });

  it("(i.2) `@otel-exempt ab` (2 chars) — still a violation (≥3 required)", () => {
    const src = `
/**
 * @otel-exempt ab
 */
export function f(): void {}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toHaveLength(1);
  });

  it("(i.3) `@otel` with no span name — still a violation (missing span)", () => {
    const src = `
/**
 * @otel
 */
export function f(): void {}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toHaveLength(1);
    const v = violations[0];
    if (v === undefined) throw new Error("unreachable");
    expect(v.reason).toMatch(/missing span name/i);
  });

  it("(j) multiple exports in one file — only unannotated reported", () => {
    const src = `
/**
 * @otel pkg.alpha
 */
export function alpha(): void {}

export function beta(): void {}

/**
 * @otel-exempt no-side-effects
 */
export function gamma(): void {}

export const delta = (): void => {};
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/pkg/src/x.ts", src)],
    });
    expect(violations.map((v) => v.name).sort()).toEqual(["beta", "delta"]);
  });

  it("multiple files — violations aggregated across", () => {
    const ok = `
/**
 * @otel a.go
 */
export function go(): void {}
`;
    const bad = `
export function nope(): void {}
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/a/src/x.ts", ok), file("novel/b/src/y.ts", bad)],
    });
    expect(violations).toHaveLength(1);
    const v = violations[0];
    if (v === undefined) throw new Error("unreachable");
    expect(v.file).toBe("novel/b/src/y.ts");
  });

  it("no exports — 0 violations even without any JSDoc", () => {
    const src = `
const x = 1;
function localOnly(): number { return x; }
type T = { a: 1 };
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/types.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("re-export aggregator with no function bodies — 0 violations", () => {
    const src = `
export { foo } from "./foo.js";
export type { Bar } from "./bar.js";
export * from "./baz.js";
`;
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/index.ts", src)],
    });
    expect(violations).toEqual([]);
  });

  it("violation reports a 1-based line number anchored at the function keyword", () => {
    const src = "\n\nexport function nope(): void {}\n";
    const { violations } = checkOtelCoverage({
      files: [file("novel/foo/src/x.ts", src)],
    });
    expect(violations).toHaveLength(1);
    const v = violations[0];
    if (v === undefined) throw new Error("unreachable");
    // Function declaration starts on line 3 (after two blank lines).
    expect(v.line).toBe(3);
  });
});
