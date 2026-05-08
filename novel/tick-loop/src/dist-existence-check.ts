// <!-- scope: human-approved minsky-cli-fresh-clone-bootstrap slice 8 (operator 2026-05-08 — "I've cloned minsky from scratch, ran pnpm install, then ran minsky and got module not found about tick-loop") -->
/**
 * `@minsky/tick-loop/dist-existence-check` — pure pre-flight check that
 * the `dist/index.js` build artifact exists before `bin/minsky.mjs`
 * imports from it. Slice 8 of P0 task
 * `minsky-cli-fresh-clone-bootstrap` per `TASKS.md`.
 *
 * The contract:
 *
 *   1. {@link checkDistExists} — pure decision function over an
 *      injected `existsSyncFn` seam. Returns a discriminated union
 *      `{ ok: true } | { ok: false, distIndexPath }`. Never throws
 *      under normal operation; unexpected probe rejections (e.g.
 *      `EACCES` on a read-only mount) bubble up to the supervisor
 *      per rule #6's loud-crash discipline.
 *
 *   2. {@link formatDistMissingMessage} — pure formatter that renders
 *      the operator-facing recovery message. Pinned via paired tests
 *      so the wording stays compact + actionable.
 *
 * The wiring lives in `bin/minsky.mjs` directly (no extra wrapper
 * module) — it `existsSync`s the resolved `dist/index.js` path; on
 * absent, writes the formatted message to stderr and exits 1
 * BEFORE the failing `import` statement is reached.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Pure decision function** — Hughes 1989 ("Why Functional
 *     Programming Matters") — referentially transparent over the
 *     injected probe seam. Conformance: full.
 *   - **Pre-condition check** — Meyer 1992 (*Eiffel: The Language*) —
 *     the function IS the `require` clause for `bin/minsky.mjs`'s
 *     "dist must exist" precondition; failure fast, with a clear
 *     message, before any I/O that would hide the cause. Conformance:
 *     full.
 *   - **Loud-crash boundary** — Armstrong 2007 (*Programming Erlang*)
 *     — replaces node's stack-trace `ERR_MODULE_NOT_FOUND` with a
 *     human-readable line that names the recovery command.
 *     Conformance: full.
 *
 * Failure modes & chaos verification (rule #7 / vision.md § 7).
 *
 * Steady-state hypothesis: every call to {@link checkDistExists} with
 * a present-or-absent `dist/index.js` returns a well-formed outcome
 * record in O(1) — single `existsSync` invocation. Blast radius: a
 * single `bin/minsky.mjs` invocation. Operator escape hatch: the
 * underlying issue (no `dist/`) is fixed by `pnpm install` (which
 * runs the prepare hook) or by `pnpm --filter @minsky/tick-loop build`
 * directly — both documented in the message body.
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | dist/index.js present | Normal operation | `{ ok: true }` | "checkDistExists — present" |
 * | 2 | dist/index.js absent | Fresh clone, no `pnpm install` yet OR prepare hook failed | `{ ok: false, distIndexPath }`; caller emits message + exits 1 | "checkDistExists — absent" + the live integration test in CI |
 * | 3 | existsSync throws | Read-only mount, EACCES, etc. | loud-crash per Armstrong — error bubbles up to supervisor (`bin/minsky.mjs` doesn't catch) | "checkDistExists — chaos: existsSync throws" |
 *
 * @module tick-loop/dist-existence-check
 */

/**
 * Discriminated union returned by {@link checkDistExists}. The `ok:
 * true` branch carries no data; the `ok: false` branch carries the
 * resolved path so the caller can render it in the error message.
 */
export type DistCheckOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly distIndexPath: string };

/**
 * Run the existence check. Pure-over-injection: the test layer passes
 * a synthetic `existsSyncFn`; production wiring in `bin/minsky.mjs`
 * passes `node:fs.existsSync`.
 *
 * @otel-exempt pure check — sub-millisecond, no spawning, no spans.
 */
export function checkDistExists(opts: {
  readonly distIndexPath: string;
  readonly existsSyncFn: (p: string) => boolean;
}): DistCheckOutcome {
  if (opts.existsSyncFn(opts.distIndexPath)) {
    return { ok: true };
  }
  return { ok: false, distIndexPath: opts.distIndexPath };
}

/**
 * Render the operator-facing recovery message. Single line, prefixed
 * with `minsky:` to match the rest of the CLI's stderr convention
 * (`minsky: claude probe → exhausted ...`, etc.).
 *
 * The message names the recovery command (`pnpm install`) and the
 * missing path so the operator can sanity-check both without re-
 * running the failing command.
 *
 * @otel-exempt pure formatter — same input → same output.
 */
export function formatDistMissingMessage(distIndexPath: string): string {
  return `minsky: dist not built (${distIndexPath} missing) — run \`pnpm install\` from the repo root, or \`pnpm --filter @minsky/tick-loop build\` directly`;
}
