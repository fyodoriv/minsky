/**
 * Notifier adapter — interface (Adapter pattern, Gamma 1994) + a
 * `StubNotifier` test fake (Meszaros 2007) + an `NtfyNotifier` HTTP
 * Strategy (sibling file `./ntfy.ts`).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral)
 *                            per Gamma, Helm, Johnson, Vlissides,
 *                            *Design Patterns*, 1994. Conformance: full.
 *   - `StubNotifier`:        Test fake / spy hybrid per Meszaros, *xUnit
 *                            Test Patterns*, 2007 — records calls in-memory
 *                            and returns a fixed `{ ok: true }` so tests
 *                            can assert request shape without a network.
 *                            Conformance: full.
 *   - `Notifier.selfTest`:   Health-probe shape — re-uses
 *                            {@link SelfTestResult} from `@minsky/adapter-types`
 *                            (leaf package per Martin, *Clean Architecture*,
 *                            2017 — acyclic dependency principle).
 *
 * Why a notifier adapter (rule #2): the tick-loop daemon emits (a) a
 * morning summary push at 07:00 local with a roll-up of the prior N ticks
 * (story-001 acceptance #6 — "a morning notification summarizes work
 * done"), and (b) circuit-break-and-notify alerts per the rule-#7 chaos
 * table for budget-guard PAUSE / supervisor-restart events. Today story
 * 001's acceptance #6 has no implementation — there's no push channel at
 * all. This package is the interface; the only Strategy in v0 is
 * `NtfyNotifier` (HTTP POST to ntfy.sh / self-hosted ntfy).
 *
 * Why ntfy.sh as the v0 Strategy (rule #1 — don't reinvent the wheel):
 * ntfy.sh is a thin pub/sub HTTP service with a free public tier and a
 * trivially-self-hostable container; the daemon never owns push-channel
 * infrastructure. The Strategy seam means a future APNs / Pushover /
 * webhook adapter can land without touching the consumer.
 *
 * Anchors:
 *   - Hunt, A., Thomas, D., *The Pragmatic Programmer*, Addison-Wesley,
 *     1999, Tip 32 ("Crash Early — but the crash needs to reach the
 *     operator"); a notifier is the operator-facing channel that turns
 *     a let-it-crash event into actionable feedback.
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Adapter + Strategy).
 *   - Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test fake).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic
 *     dependency principle — `@minsky/adapter-types` is the leaf).
 */

// Re-export the shared health-probe contract from the leaf types package so
// callers can keep doing `import { type SelfTestResult } from "@minsky/notifier"`
// without an extra dep declaration.
export type { SelfTestResult, SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/**
 * Push-notification priority. The mapping to a transport-level header
 * (e.g. ntfy's `Priority` header values 1..5) is the Strategy's
 * responsibility — see `./ntfy.ts` for the v0 mapping.
 */
export type NotificationPriority = "low" | "normal" | "high";

/**
 * One push notification. `tags` are transport-agnostic labels — ntfy
 * surfaces them as emoji glyphs in the client; other Strategies may
 * project them into JSON metadata or ignore them.
 */
export interface Notification {
  readonly title: string;
  readonly body: string;
  readonly priority?: NotificationPriority;
  readonly tags?: readonly string[];
}

/**
 * Result of a `push()` call. `ok: false` carries a `reason` string that
 * the caller logs; the Strategy never throws on transport-level errors
 * (graceful-degrade per rule #7 — a missed push must never crash the
 * daemon). Exhausted retries / 5xx / network errors all map to
 * `{ ok: false, reason: '...' }`.
 */
export interface PushResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Notifier adapter interface — Adapter pattern (Gamma et al., *Design
 * Patterns*, 1994). Strategy implementations live in sibling files
 * (e.g. {@link "./ntfy".NtfyNotifier}).
 *
 * `selfTest()` follows the {@link SelfTestResult} contract; `setup.sh`'s
 * `--doctor` mode aggregates across adapters via
 * `aggregateStatus()` from `@minsky/adapter-types`.
 */
export interface Notifier {
  push(n: Notification): Promise<PushResult>;
  selfTest(): Promise<SelfTestResult>;
}

/**
 * In-memory `Notifier` for tests. Records every call's payload in order
 * (FIFO — first push is `calls[0]`) and returns a fixed `{ ok: true }`.
 * Pattern: test fake per Meszaros, *xUnit Test Patterns*, 2007.
 *
 * `selfTest()` always returns `green` with `latencyMs: 0` — the stub has
 * no I/O so any other status would be a lie.
 *
 * @example
 *   const stub = new StubNotifier();
 *   await daemon.run({ notifier: stub });
 *   expect(stub.calls).toHaveLength(1);
 *   expect(stub.calls[0].title).toBe("morning summary");
 */
export class StubNotifier implements Notifier {
  private readonly recorded: Notification[] = [];

  /**
   * @otel-exempt test fake — production callers never invoke this; recording is the test's seam, not a span source
   */
  get calls(): readonly Notification[] {
    return this.recorded;
  }

  /**
   * @otel-exempt test fake — records in-memory and returns a fixed shape; the caller's span covers it
   */
  async push(n: Notification): Promise<PushResult> {
    this.recorded.push(n);
    return { ok: true };
  }

  /**
   * @otel-exempt test fake — no I/O; the green status is unconditional by design, no value in a span
   */
  async selfTest(): Promise<SelfTestResult> {
    return {
      status: "green",
      message: "StubNotifier — no I/O; recorded calls available via .calls",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Drop all recorded calls. Useful between test cases when the same
   * fixture is reused.
   *
   * @otel-exempt test fake — purely test-side mutation; spans here would be noise
   */
  reset(): void {
    this.recorded.length = 0;
  }
}

// Re-export the Ntfy Strategy from the sibling module so consumers can
// `import { NtfyNotifier } from "@minsky/notifier"` without reaching for
// the `/ntfy` subpath (mirrors `@minsky/token-monitor`'s pattern of
// re-exporting the Strategy from `index.ts`).
export {
  NtfyNotifier,
  type NtfyNotifierOpts,
  type FetchLike,
  PRIORITY_HEADER,
} from "./ntfy.js";
