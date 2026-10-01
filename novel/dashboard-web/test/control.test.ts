import { describe, expect, it } from "vitest";

import { createMemoryPauseState, parseControlBody } from "../src/control.js";

describe("parseControlBody — pure validator", () => {
  it("accepts {paused: true}", () => {
    expect(parseControlBody({ paused: true })).toEqual({ ok: true, paused: true });
  });

  it("accepts {paused: false}", () => {
    expect(parseControlBody({ paused: false })).toEqual({ ok: true, paused: false });
  });

  it("rejects null with `missing body`", () => {
    expect(parseControlBody(null)).toEqual({ ok: false, error: "missing body" });
  });

  it("rejects undefined with `missing body`", () => {
    expect(parseControlBody(undefined)).toEqual({ ok: false, error: "missing body" });
  });

  it("rejects non-object with `missing body`", () => {
    expect(parseControlBody("paused")).toEqual({ ok: false, error: "missing body" });
    expect(parseControlBody(42)).toEqual({ ok: false, error: "missing body" });
  });

  it("rejects object missing the `paused` key", () => {
    expect(parseControlBody({})).toEqual({ ok: false, error: "missing paused field" });
    expect(parseControlBody({ other: true })).toEqual({
      ok: false,
      error: "missing paused field",
    });
  });

  it("rejects non-boolean `paused` (string)", () => {
    expect(parseControlBody({ paused: "true" })).toEqual({
      ok: false,
      error: "paused must be boolean",
    });
  });

  it("rejects non-boolean `paused` (number)", () => {
    expect(parseControlBody({ paused: 1 })).toEqual({
      ok: false,
      error: "paused must be boolean",
    });
  });

  it("rejects non-boolean `paused` (null)", () => {
    expect(parseControlBody({ paused: null })).toEqual({
      ok: false,
      error: "paused must be boolean",
    });
  });
});

describe("createMemoryPauseState — getPauseState/setPaused share the cell", () => {
  it("default initial value is false", () => {
    const { getPauseState } = createMemoryPauseState();
    expect(getPauseState()).toBe(false);
  });

  it("respects the initial argument", () => {
    const { getPauseState } = createMemoryPauseState(true);
    expect(getPauseState()).toBe(true);
  });

  it("setPaused mutates the value getPauseState observes (round-trip)", () => {
    const { getPauseState, setPaused } = createMemoryPauseState();
    setPaused(true);
    expect(getPauseState()).toBe(true);
    setPaused(false);
    expect(getPauseState()).toBe(false);
  });
});
