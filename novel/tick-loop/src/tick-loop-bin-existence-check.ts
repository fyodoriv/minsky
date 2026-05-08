// <!-- scope: human-approved minsky-runtime-resilience slice 2 (operator 2026-05-08 — "Next let's add as much stable self-healing as reasonable to minsky & install commands") -->
/**
 * `@minsky/tick-loop/tick-loop-bin-existence-check` — pure pre-flight
 * check that `bin/tick-loop.mjs` exists before
 * `bin/minsky.mjs::runStartOrAttach` calls `spawn(node, [TICK_LOOP_BIN, ...])`.
 * Slice 2 of P0 task `minsky-runtime-resilience` per `TASKS.md`.
 *
 * Why: `spawn(node, [...])` with a missing target file emits
 * `ENOENT` from the child-process layer with a stack that doesn't
 * point at the bin path. The right boundary (rule #6) is a one-line
 * operator-actionable message naming the missing path + the recovery
 * command (`pnpm install` re-runs the prepare hook; `git checkout
 * HEAD -- novel/tick-loop/bin` restores a deleted file).
 *
 * Mirrors {@link checkDistExists} from `dist-existence-check.ts`
 * exactly — same discriminated-union return shape, same paired-test
 * wording contract. Slice 2 of `minsky-runtime-resilience`.
 *
 * Pattern conformance: Pure decision function (Hughes 1989);
 * Pre-condition check (Meyer 1992); Loud-crash boundary (Armstrong
 * 2007).
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | tick-loop.mjs present | Normal operation | `{ ok: true }` | "present" |
 * | 2 | tick-loop.mjs absent | Deleted, never built, wrong PKG_ROOT | `{ ok: false, tickLoopBinPath }`; caller emits + exits 1 | "absent" |
 * | 3 | existsSync throws | Read-only mount, EACCES | loud-crash up the stack | "chaos: existsSync throws" |
 *
 * @module tick-loop/tick-loop-bin-existence-check
 */

/**
 * Discriminated union returned by {@link checkTickLoopBinExists}.
 */
export type TickLoopBinCheckOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly tickLoopBinPath: string };

/**
 * Run the existence check. Pure-over-injection.
 *
 * @otel-exempt pure check — sub-millisecond, no spawning, no spans.
 */
export function checkTickLoopBinExists(opts: {
  readonly tickLoopBinPath: string;
  readonly existsSyncFn: (p: string) => boolean;
}): TickLoopBinCheckOutcome {
  if (opts.existsSyncFn(opts.tickLoopBinPath)) {
    return { ok: true };
  }
  return { ok: false, tickLoopBinPath: opts.tickLoopBinPath };
}

/**
 * Render the operator-facing recovery message. Single line, prefixed
 * `minsky:`. The message names two recovery commands (the most
 * common cause `pnpm install` for a fresh-clone build issue, and
 * the rarer `git checkout` for an accidental delete).
 *
 * @otel-exempt pure formatter.
 */
export function formatTickLoopBinMissingMessage(tickLoopBinPath: string): string {
  return `minsky: tick-loop bin missing (${tickLoopBinPath}) — run \`pnpm install\` from the repo root, or \`git checkout HEAD -- novel/tick-loop/bin\` to restore`;
}
