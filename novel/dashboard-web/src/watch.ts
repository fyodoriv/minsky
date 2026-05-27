// no-test: novel/dashboard-web is deprecated (docs/DEPRECATED.md §4) — "keep for now, do NOT add features"; existing files lack tests by policy
/**
 * `@minsky/dashboard-web` — pure JSON envelope for the Watch surface.
 *
 * The envelope is the load-bearing contract between this server and the
 * Apple-Shortcuts manifests in `distribution/shortcuts/`. It exposes
 * exactly three readings (the 3-value cap from user-story 005 and
 * vision.md success #6 — wrist dwell, glanceable display, Card &
 * Mackinlay 1999) plus a single boolean `paused` for the pause/resume
 * pair Shortcut. Field names are kebab-case to match the
 * `SuccessMetric.id` shape and the contract advertised in the
 * Shortcuts README.
 *
 * Pure data; the route handler in `server.ts` is the I/O boundary.
 *
 * Anchor: rule #2 (adapter seam — the JSON envelope is the adapter
 * between Minsky internals and Apple's UI runtime); Card & Mackinlay
 * 1999 (3-number glanceable display); Weiser & Brown 1995 (calm tech).
 */

import type { SuccessMetric } from "./metrics.js";
import type { GetValue } from "./render.js";

/** Strategy: read pause state. `null` → unknown, defaults to `false`. */
export type PauseState = () => boolean | null;

/**
 * Why the daemon is paused, when it is. Surfaced alongside the boolean
 * `paused` so the operator can distinguish "I tapped pause from my watch"
 * (`operator`) from "the daemon paused itself because the 5h Anthropic
 * budget hit the circuit-break threshold" (`budget`). The boolean stays
 * for backwards compat with the v0 Apple Shortcuts; the reason field is
 * additive (rule-#8 conformance: stable WatchEnvelope shape, field-add
 * only). `null` → either not paused, or pause reason unknown — a future
 * Strategy should narrow this; today's stub returns `null` explicitly.
 *
 * Surfaced by `daemon-budget-pause-observability` (P1, 2026-05-04).
 */
export type PauseReason = "operator" | "budget" | null;

/** Strategy: read pause reason. `null` → unknown / not paused. */
export type PauseReasonState = () => PauseReason;

/**
 * Default: pause reason unknown. The supervisor's nominal state is
 * `paused: false` AND `pauseReason: null` — only one of those needs to
 * be present for an Apple Shortcut to render the green tile, but having
 * both keeps the JSON envelope stable across consumers.
 *
 * @otel-exempt pure constant function — no I/O, no state, the pause
 *   reason Strategy seam is itself instrumented at the route boundary
 *   in `server.ts` (the `app.get("/watch.json", ...)` handler).
 */
export const STUB_PAUSE_STATE: PauseState = () => null;

/** @otel-exempt pure constant — see `STUB_PAUSE_STATE`. */
export const STUB_PAUSE_REASON: PauseReasonState = () => null;

/**
 * The three metric ids fed to the Watch surface. Order is the
 * glance-priority order (cheapest constraint surfacing first).
 *
 * - `tokens-remaining` — derived from `token-budget-honoring` (success
 *   #9). The remaining-headroom value is the calm-tech inverse of the
 *   raw 429 counter. The Strategy returns whatever string the runner
 *   has prepared (stub or live).
 * - `last-task-status` — derived from `task-throughput` (success #10).
 *   The Watch shows the most-recent close-task signal.
 * - `constraint-of-the-week` — derived from `self-improvement-velocity`
 *   (success #4 — MAPE-K's current bottleneck under TOC).
 *
 * The mapping is data, not behaviour, so a future renaming of a
 * `SuccessMetric.id` is loud (a paired test asserts the mapping is
 * intact). The Watch surface only ever reads these three keys plus
 * `paused`; everything else stays on the HTML route at `/`.
 */
export const WATCH_METRIC_IDS = {
  "tokens-remaining": "token-budget-honoring",
  "last-task-status": "task-throughput",
  "constraint-of-the-week": "self-improvement-velocity",
} as const;

export type WatchKey = keyof typeof WATCH_METRIC_IDS;

/** The JSON envelope shape. Stable across versions; field-add only. */
export interface WatchEnvelope {
  readonly "tokens-remaining": string;
  readonly "last-task-status": string;
  readonly "constraint-of-the-week": string;
  readonly paused: boolean;
  /**
   * Why the daemon is paused, when it is. `null` when not paused OR when
   * the reason is unknown (stub). Added by P1 `daemon-budget-pause-observability`
   * to surface daemon-internal pauses (budget circuit-break) on the
   * watch surface. Apple Shortcuts that don't care about the reason
   * keep using `paused`; richer renderers (a future tile, the dashboard
   * HTML route) read this.
   */
  readonly pauseReason: PauseReason;
}

/** Stub sentinel when the Strategy returns `null`. Operator-visible. */
const STUB = "(stub)";

/**
 * @otel-exempt pure data transformation; no I/O, no state.
 *
 * Build the JSON envelope from the live `getValue` Strategy and a pause
 * state. The function is total — every key is always present so the
 * Apple-Shortcuts "Get Dictionary Value" action never sees a missing
 * key (which would render the empty string and look indistinguishable
 * from a healthy zero). `null` from either Strategy degrades to the
 * `(stub)` / `false` sentinel respectively (rule #7 — graceful degrade,
 * explicit not silent).
 */
export function watchEnvelope(args: {
  readonly metrics: readonly SuccessMetric[];
  readonly getValue: GetValue;
  readonly getPauseState: PauseState;
  readonly getPauseReason?: PauseReasonState;
}): WatchEnvelope {
  const byId = new Map(args.metrics.map((m) => [m.id, m]));
  const lookup = (key: WatchKey): string => {
    const sourceId = WATCH_METRIC_IDS[key];
    const metric = byId.get(sourceId);
    if (metric === undefined) return STUB;
    const v = args.getValue(metric);
    return v === null ? STUB : v;
  };
  const paused = args.getPauseState();
  const pauseReason = (args.getPauseReason ?? STUB_PAUSE_REASON)();
  return {
    "tokens-remaining": lookup("tokens-remaining"),
    "last-task-status": lookup("last-task-status"),
    "constraint-of-the-week": lookup("constraint-of-the-week"),
    paused: paused === null ? false : paused,
    pauseReason,
  };
}
