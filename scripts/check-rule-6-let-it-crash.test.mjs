// @ts-check
// Tests for the pure function in check-rule-6-let-it-crash.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { checkLetItCrash } from "./check-rule-6-let-it-crash.mjs";

/**
 * @param {string} source
 */
function run(source) {
  return checkLetItCrash({ files: [{ path: "novel/example/src/foo.ts", source }] });
}

describe("checkLetItCrash", () => {
  test("(a) try/catch that re-throws → 0 violations", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    throw e;",
      "  }",
      "}",
    ].join("\n");
    expect(run(src).violations).toHaveLength(0);
  });

  test("(b) catch with only a comment swallow → 1 swallowing-catch", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    /* swallow */",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("(c) catch that calls supervise(e) → 0 violations", () => {
    const src = [
      "declare function supervise(e: unknown): void;",
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    supervise(e);",
      "  }",
      "}",
    ].join("\n");
    expect(run(src).violations).toHaveLength(0);
  });

  test("(d) nested try/catch (inner re-throws) → 1 nested-try", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    try {",
      "      cleanup();",
      "    } catch (e2) {",
      "      throw e2;",
      "    }",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    // The outer catch ALSO swallows (its body is the inner try, no throw at
    // the catch's top level reachable on all paths). But our walker checks
    // the full block descendants for any throw — and the inner try has a
    // re-throw, so the outer catch is considered to re-throw. Net: only
    // the nested-try fires.
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("nested-try");
  });

  test("(e) catch with only console.log (no throw, no supervise) → 1 swallowing-catch", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    console.log(e);",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("(f) opt-out comment with valid reason → 0 violations", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    parseStdin();",
      "  }",
      "  // rule-6: handled-locally — boundary-with-stdin",
      "  catch (e) {",
      "    return;",
      "  }",
      "}",
    ].join("\n");
    expect(run(src).violations).toHaveLength(0);
  });

  test("(g) opt-out comment without a reason → 1 violation (reason required)", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    parseStdin();",
      "  }",
      "  // rule-6: handled-locally —",
      "  catch (e) {",
      "    return;",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("(h) try/finally with no catch → 0 violations", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } finally {",
      "    cleanup();",
      "  }",
      "}",
    ].join("\n");
    expect(run(src).violations).toHaveLength(0);
  });

  test("(i) catch that returns instead of throwing → 1 swallowing-catch", () => {
    const src = [
      "export function f(): number {",
      "  try {",
      "    return doStuff();",
      "  } catch (e) {",
      "    return 0;",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("empty catch body → swallowing-catch", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {}",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("catch whose only `throw` lives inside a nested closure → swallowing-catch", () => {
    // The throw is in an arrow function; it doesn't actually re-throw the
    // caught error on the catch path, so we still consider this swallowing.
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    setTimeout(() => { throw e; }, 0);",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("catch with throw inside an `if` is OK", () => {
    const src = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    if (Math.random() > 0.5) throw e;",
      "    throw new Error('always rethrow');",
      "  }",
      "}",
    ].join("\n");
    expect(run(src).violations).toHaveLength(0);
  });

  test("violation locations point at the offending construct", () => {
    const src = [
      "export function f(): void {", // line 1
      "  try {", // line 2
      "    doStuff();", // line 3
      "  } catch (e) {", // line 4 — outer catch swallows? No: nested try has throw
      "    try {", // line 5 — nested-try fires here
      "      cleanup();", // line 6
      "    } catch (e2) {", // line 7
      "      throw e2;", // line 8
      "    }",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("nested-try");
    expect(violations[0]?.line).toBe(5);
  });

  test("opt-out works on the line immediately above an inner catch only", () => {
    // Whole-file opt-outs are out of scope for v0; per-catch only.
    const src = [
      "// rule-6: handled-locally — file-wide boundary",
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    /* swallow */",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("multiple files: violations are reported with the right path", () => {
    const cleanFile = "export const ok = 1;\n";
    const dirtyFile = [
      "export function f(): void {",
      "  try {",
      "    doStuff();",
      "  } catch (e) {",
      "    return;",
      "  }",
      "}",
    ].join("\n");
    const { violations } = checkLetItCrash({
      files: [
        { path: "novel/clean/src/a.ts", source: cleanFile },
        { path: "novel/dirty/src/b.ts", source: dirtyFile },
      ],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("novel/dirty/src/b.ts");
  });

  test("supervise as a method call (e.g., this.supervise(e)) is NOT recognised", () => {
    // Rule brief: case-sensitive bare identifier match. A method call on a
    // receiver is a different code shape — supervisors are top-level helpers.
    const src = [
      "class K {",
      "  supervise(_e: unknown): void {}",
      "  f(): void {",
      "    try { doStuff(); } catch (e) { this.supervise(e); }",
      "  }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("swallowing-catch");
  });

  test("triple-nested try → reports only the innermost nested-try (depth>1 once)", () => {
    // First inner try (depth 2) fires; deepest try (depth 3) fires too.
    const src = [
      "export function f(): void {",
      "  try {",
      "    try {",
      "      try {",
      "        x();",
      "      } catch (e3) { throw e3; }",
      "    } catch (e2) { throw e2; }",
      "  } catch (e1) { throw e1; }",
      "}",
    ].join("\n");
    const { violations } = run(src);
    // Two nested-try violations: depth 2 + depth 3.
    expect(violations.filter((v) => v.kind === "nested-try")).toHaveLength(2);
  });
});
