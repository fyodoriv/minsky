// @ts-check
import { describe, expect, it } from "vitest";
import { checkAdapterConventions } from "./check-adapter-conventions.mjs";

/**
 * @param {Record<string, string>} files
 */
function fakeFs(files) {
  return {
    repoRoot: "/repo",
    files: Object.keys(files),
    readText: (/** @type {string} */ p) => files[p.slice(6)] ?? "",
  };
}

describe("checkAdapterConventions", () => {
  it("passes when adapter has selfTest and JSDoc on exports", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "/**",
          " * Foo class.",
          " */",
          "export class Foo {",
          "  async selfTest() { return { ok: true }; }",
          "}",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("flags missing selfTest", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "/**",
          " * Foo class.",
          " */",
          "export class Foo {}",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/selfTest/);
  });

  it("flags export without JSDoc", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "export class Foo {",
          "  async selfTest() { return { ok: true }; }",
          "}",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/missing JSDoc/);
  });

  it("exempts index.ts (the interface)", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/index.ts": "export interface Foo { x: number }",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("exempts *.test.ts", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.test.ts": "export const x = 1;",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("exempts novel/adapters/types/src/", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/types/src/index.ts": "export type X = number;",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts method-shorthand selfTest", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "/** Foo */",
          "export const foo = {",
          "  selfTest: async () => ({ ok: true }),",
          "};",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts free-function selfTest", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "/** selfTest */",
          "export async function selfTest() { return { ok: true }; }",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rule (1): flags two `implements` classes in one impl file", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "/** Foo */",
          "export class Foo implements Notifier {",
          "  async selfTest() { return { ok: true }; }",
          "  push() {}",
          "}",
          "/** Baz */",
          "export class Baz implements Notifier {",
          "  push() {}",
          "}",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /rule \(1\)/.test(v))).toBe(true);
    expect(result.violations.some((v) => /Foo, Baz/.test(v))).toBe(true);
  });

  it("rule (1): passes one `implements` class with helper class beside it", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "/** Primary impl */",
          "export class Foo implements Notifier {",
          "  async selfTest() { return { ok: true }; }",
          "}",
          "/** Helper — not an adapter */",
          "export class FooHelper {",
          "  format(x: string) { return x; }",
          "}",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rule (1): passes export interface + config types alongside the impl", () => {
    const result = checkAdapterConventions(
      fakeFs({
        "novel/adapters/foo/src/bar.ts": [
          "/** Config */",
          "export interface FooConfig { x: number }",
          "/** Helper */",
          "export type FetchLike = (url: string) => Promise<unknown>;",
          "/** Impl */",
          "export class Foo implements Notifier {",
          "  async selfTest() { return { ok: true }; }",
          "}",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkAdapterConventions();
    expect(result.ok).toBe(true);
  });
});
