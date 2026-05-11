// <!-- scope: human-approved local-server-concurrency-aware-worker-spawn slice 2.5 (operator 2026-05-10 — real-fire OOM on 3-worker concurrent aider→mlx_lm.server) -->
/**
 * `@minsky/tick-loop/local-llm-concurrency-gate` — a `SpawnStrategy`
 * decorator that serializes local-LLM spawns across workers via an
 * `O_EXCL`-based file lock.
 *
 * Surfaced-by 2026-05-10 real-fire of 3-worker local-only spawn: each
 * individual aider request was bounded (3-12k tokens), but mlx_lm.server
 * GPU-OOM-crashed when three concurrent client requests arrived because
 * the model (Qwen3-Coder-30B-A3B-Instruct-4bit) at 4-bit MoE consumes
 * ~10 GB of Apple Silicon GPU memory per inference and the Metal command
 * buffer cannot hold three at once.
 *
 * Design: when `MINSKY_LOCAL_LLM=1` is set, the supervisor wraps the
 * `local` strategy passed to `LlmProviderSpawnStrategy` in this gate.
 * On every `spawn()`, the gate blocks until the lock is acquired
 * (default capacity 1 — one in-flight aider invocation at a time),
 * delegates to the inner strategy, then releases. Across multiple
 * worker processes that all hit `mlx_lm.server` simultaneously, the
 * effect is serialization: worker A holds the lock and runs aider,
 * workers B+C poll the lock file with backoff until A releases, then
 * acquire in turn.
 *
 * Pattern conformance (rule #8):
 *   - **Decorator** — Gamma 1994. The gate wraps a `SpawnStrategy`
 *     and adds cross-process serialization without changing the
 *     strategy's interface. Conformance: full.
 *   - **File-based mutex via `O_EXCL`** — Kleppmann 2016 ("Designing
 *     Data-Intensive Applications" ch. 8 on single-host coordination).
 *     Same primitive as `worker-claim.ts`'s task claim. Conformance:
 *     full.
 *   - **Bounded retry with backoff** — Beyer SRE 2016 ch. 19
 *     (exponential backoff to avoid thundering herd). Conformance:
 *     full (linear backoff is sufficient for N≤8 workers; exponential
 *     is an over-fit at this scale).
 *
 * Anchor: task `local-server-concurrency-aware-worker-spawn` (P0,
 * TASKS.md). This is slice 2.5 — the *enforcement* mechanism that
 * complements slice 1 (self-diagnose invariant) and slice 2
 * (autoscale-cap). Slice 1 detects the contention; slice 2 prevents
 * the autoscaler from adding workers; THIS slice prevents workers
 * the operator already spawned from killing the GPU.
 *
 * @module tick-loop/local-llm-concurrency-gate
 */

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import type { SpawnInput, SpawnResult, SpawnStrategy } from "./spawn-strategy.js";

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000; // 15 min — bounded by daemon's per-iteration watchdog
const DEFAULT_POLL_INTERVAL_MS = 1000; // 1 s — aider iterations are minutes, not millis; coarse poll is fine
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — three 7-min watchdogs back-to-back fit

/**
 * Shape of the JSON body written into the lock file. Used by the
 * stale-lock recovery path: when a worker crashes mid-iteration without
 * releasing, the `expiresAt` timestamp tells subsequent waiters when
 * the lock is safe to forcibly clear.
 */
export interface GateLockBody {
  readonly workerId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

/**
 * Options for {@link LocalLlmConcurrencyGate}. All time fields are
 * milliseconds; all are overridable for tests. The lock path is the
 * one operator-visible configuration knob — defaults to
 * `/tmp/minsky-local-llm-server.lock` (overridden by tests).
 */
export interface LocalLlmConcurrencyGateOptions {
  /** The strategy this gate wraps. Local-provider spawn target. */
  readonly inner: SpawnStrategy;
  /**
   * Stable worker identity written into the lock body. Used for
   * stale-lock recovery diagnostics. Production: the worker-id
   * passed in by `tick-loop.mjs`'s `--worker-id` flag.
   */
  readonly workerId: string;
  /**
   * Absolute path to the lock file. Default
   * `/tmp/minsky-local-llm-server.lock`. Tests inject a temp path.
   */
  readonly lockPath?: string;
  /**
   * TTL on the lock body. After `expiresAt`, the lock is considered
   * stale and any subsequent waiter forcibly clears it. Default
   * {@link DEFAULT_LOCK_TTL_MS}.
   */
  readonly lockTtlMs?: number;
  /**
   * How long to wait between acquire retries when the lock is held.
   * Default {@link DEFAULT_POLL_INTERVAL_MS}.
   */
  readonly pollIntervalMs?: number;
  /**
   * Maximum wait before giving up and throwing. Default
   * {@link DEFAULT_ACQUIRE_TIMEOUT_MS}. When this fires, the gate
   * rejects with `local-llm-concurrency-gate-timeout`, which the
   * daemon's outer loop surfaces as a failed iteration (rule #6 —
   * let-it-crash; the supervisor respawns).
   */
  readonly acquireTimeoutMs?: number;
  /**
   * Injected clock for tests. Defaults to `Date.now`.
   */
  readonly now?: () => number;
  /**
   * Injected sleep for tests. Defaults to `node:timers/promises`'s
   * `setTimeout`. Tests use a fake timer.
   */
  readonly sleepMs?: (ms: number) => Promise<void>;
}

/**
 * The Decorator. Implements `SpawnStrategy` by acquiring the gate
 * lock before delegating to `inner.spawn(...)` and releasing after.
 *
 * @otel tick-loop.local-llm-concurrency-gate.spawn
 */
export class LocalLlmConcurrencyGate implements SpawnStrategy {
  private readonly opts: LocalLlmConcurrencyGateOptions;
  private readonly lockPath: string;
  private readonly lockTtlMs: number;
  private readonly pollIntervalMs: number;
  private readonly acquireTimeoutMs: number;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(opts: LocalLlmConcurrencyGateOptions) {
    this.opts = opts;
    this.lockPath = opts.lockPath ?? "/tmp/minsky-local-llm-server.lock";
    this.lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.acquireTimeoutMs = opts.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    this.nowFn = opts.now ?? Date.now;
    this.sleepFn = opts.sleepMs ?? ((ms) => sleep(ms));
  }

  /**
   * Acquire the gate lock, delegate, release. Blocks until the lock
   * is acquired or `acquireTimeoutMs` elapses.
   *
   * @otel tick-loop.local-llm-concurrency-gate.spawn
   */
  async spawn(input: SpawnInput): Promise<SpawnResult> {
    const release = await this.acquire();
    try {
      return await this.opts.inner.spawn(input);
    } finally {
      release();
    }
  }

  /**
   * Try to acquire the lock; loops with backoff until success or
   * timeout. On collision, parses the existing body and decides
   * whether it's stale (forcibly clear) or live (wait).
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private async acquire(): Promise<() => void> {
    const startMs = this.nowFn();
    mkdirSync(dirname(this.lockPath), { recursive: true });
    while (true) {
      const result = this.tryClaim();
      if (result.acquired) return result.release;
      // Collision. Is the held lock stale?
      const elapsed = this.nowFn() - startMs;
      if (elapsed > this.acquireTimeoutMs) {
        throw new Error(
          `local-llm-concurrency-gate-timeout: waited ${elapsed}ms for ${result.heldBy} to release ${this.lockPath}`,
        );
      }
      if (this.nowFn() > result.expiresAt) {
        // Stale; force-clear and retry. Best-effort unlink — if
        // another waiter beats us to it, the next tryClaim retries.
        try {
          unlinkSync(this.lockPath);
        } catch {
          // rule-6: handled-locally — best-effort clear; concurrent unlinker is fine
        }
        continue;
      }
      await this.sleepFn(this.pollIntervalMs);
    }
  }

  /**
   * Single attempt to create the lock via `O_EXCL`. Returns an
   * acquired-or-collision verdict mirroring `worker-claim.ts`'s
   * `AcquireResult`.
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private tryClaim():
    | { acquired: true; release: () => void }
    | { acquired: false; heldBy: string; expiresAt: number } {
    const acquiredAt = this.nowFn();
    const body: GateLockBody = {
      workerId: this.opts.workerId,
      acquiredAt,
      expiresAt: acquiredAt + this.lockTtlMs,
    };
    try {
      const fd = openSync(this.lockPath, "wx");
      writeFileSync(fd, JSON.stringify(body));
      closeSync(fd);
      return {
        acquired: true,
        release: () => {
          try {
            unlinkSync(this.lockPath);
          } catch {
            // rule-6: handled-locally — release is best-effort
          }
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      return this.parseCollision();
    }
  }

  /**
   * Parse the existing lock body. If unparseable, treat as stale
   * (immediately expired) so the caller force-clears on the next
   * loop turn.
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private parseCollision(): { acquired: false; heldBy: string; expiresAt: number } {
    let body: GateLockBody | undefined;
    try {
      const text = readFileSync(this.lockPath, "utf8");
      body = JSON.parse(text) as GateLockBody;
    } catch {
      // Unparseable; treat as expired so next loop turn force-clears.
      return { acquired: false, heldBy: "unknown", expiresAt: 0 };
    }
    return { acquired: false, heldBy: body.workerId, expiresAt: body.expiresAt };
  }
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}
