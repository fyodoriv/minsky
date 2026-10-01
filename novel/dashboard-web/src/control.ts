// no-test: the web-dashboard is deprecated (docs/DEPRECATED.md §4) — "keep for now, do NOT add features"; existing files lack tests by policy
/**
 * `@minsky/dashboard-web` — pure validator + setter Strategy seam for
 * `POST /control`. Closes the round-trip on the Apple-Shortcuts
 * pause/resume pair (`distribution/shortcuts/{pause,resume}.shortcut.json`):
 * the Shortcut POSTs `{"paused": true|false}` to `:8080/control` and the
 * server applies the value through the injected `setPaused` Strategy.
 *
 * Pure data; the route handler in `server.ts` is the I/O boundary. The
 * `setPaused` seam mirrors the existing `getPauseState` shape so a single
 * memory cell (`createMemoryPauseState`) backs both Strategies in v0.
 *
 * Anchor: rule #2 (adapter seam — `setPaused` Strategy is the seam);
 * rule #7 (graceful-degrade — malformed payload yields a 400, never a
 * crash); Beyer SRE 2016 Ch. 17 (operator escape hatch / kill switch).
 */

import type { PauseState } from "./watch.js";

/**
 * Strategy: write pause state. Synchronous; no return value (the
 * acknowledgement payload is the route handler's concern). Throwing is
 * forbidden — the route handler does not retry.
 */
export type SetPaused = (paused: boolean) => void;

/** Result of {@link parseControlBody}: success carries the parsed value. */
export type ParseControlResult =
  | { readonly ok: true; readonly paused: boolean }
  | { readonly ok: false; readonly error: string };

/**
 * Pure validator for the `POST /control` JSON body. Accepts any
 * `unknown` (the route handler's `await c.req.json()` produces that
 * shape) and returns a discriminated result. The route handler maps
 * `ok: false` to a 400 with `{error}`; `ok: true` to a 200 + Strategy
 * call. No I/O; no clock; no exceptions thrown.
 *
 * @otel-exempt pure parser — no I/O, no state.
 */
export function parseControlBody(body: unknown): ParseControlResult {
  if (body === null || typeof body !== "object") {
    return { ok: false, error: "missing body" };
  }
  const record = body as Record<string, unknown>;
  if (!("paused" in record)) {
    return { ok: false, error: "missing paused field" };
  }
  const paused = record["paused"];
  if (typeof paused !== "boolean") {
    return { ok: false, error: "paused must be boolean" };
  }
  return { ok: true, paused };
}

/**
 * In-memory pause cell. Both `getPauseState` and `setPaused` close over
 * the same boolean so a `POST /control {paused:true}` round-trips into
 * the next `GET /watch.json`. v0 default for tests + dev; production
 * supervisors that own the canonical sentinel inject their own pair.
 *
 * @otel-exempt pure factory — returns two closures over a local cell, no I/O.
 */
export function createMemoryPauseState(initial = false): {
  readonly getPauseState: PauseState;
  readonly setPaused: SetPaused;
} {
  let paused = initial;
  return {
    getPauseState: () => paused,
    setPaused: (v: boolean) => {
      paused = v;
    },
  };
}

/** Default no-op `setPaused` Strategy — drops the value on the floor.
 *
 * @otel-exempt pure constant function — no I/O, the seam is itself
 *   instrumented at the route boundary in `server.ts` (the
 *   `app.post("/control", ...)` handler).
 */
export const STUB_SET_PAUSED: SetPaused = () => {
  /* no-op stub for tests */
};
