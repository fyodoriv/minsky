// <!-- scope: human-approved minsky-fresh-clone-health-checks slice 1 (operator 2026-05-08 — "Next let's add as much stable self-healing as reasonable to minsky & install commands") -->
/**
 * `@minsky/tick-loop/node-modules-existence-check` — pure pre-flight
 * check that the `node_modules/` directory exists before
 * `bin/minsky.mjs`'s dynamic import fires. Slice 1 of P0 task
 * `minsky-fresh-clone-health-checks` per `TASKS.md`.
 *
 * Slice 8 of `minsky-cli-fresh-clone-bootstrap` already added the
 * dist-existence check. That covers `dist/index.js` itself but not
 * the node_modules transitive deps (`@types/node`, `vitest`, etc.)
 * that `dist/index.js`'s `import` declarations resolve at module load.
 * On a fresh clone where the operator skipped (or fat-fingered) the
 * `pnpm install` step but somehow still has a built `dist/`, the
 * dynamic import succeeds but its transitive imports fail with a
 * cryptic `ERR_MODULE_NOT_FOUND` pointing at node-internal frames.
 *
 * The contract:
 *
 *   1. {@link checkNodeModulesExists} — pure decision function over
 *      an injected `existsSyncFn` seam. Returns a discriminated union
 *      `{ ok: true } | { ok: false, nodeModulesPath }`. Never throws
 *      under normal operation; unexpected probe rejections (e.g.
 *      `EACCES` on a read-only mount) bubble up to the supervisor
 *      per rule #6's loud-crash discipline.
 *
 *   2. {@link formatNodeModulesMissingMessage} — pure formatter that
 *      renders the operator-facing recovery message. Pinned via
 *      paired tests so the wording stays compact + actionable.
 *
 * The wiring lives in `bin/minsky.mjs` directly (no extra wrapper
 * module) — it `existsSync`s the resolved `node_modules` path; on
 * absent, writes the formatted message to stderr and exits 1
 * BEFORE the failing `import` statement is reached.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Pure decision function** — Hughes 1989. Conformance: full.
 *   - **Pre-condition check** — Meyer 1992. The function IS the
 *     `require` clause for `bin/minsky.mjs`'s "node_modules must
 *     exist" precondition; failure fast, with a clear message,
 *     before any I/O that would hide the cause. Conformance: full.
 *   - **Loud-crash boundary** — Armstrong 2007. Replaces node's
 *     stack-trace `ERR_MODULE_NOT_FOUND` with a human-readable line
 *     that names the recovery command. Conformance: full.
 *
 * Failure modes & chaos verification (rule #7 / vision.md § 7).
 *
 * Steady-state hypothesis: every call to {@link checkNodeModulesExists}
 * with a present-or-absent `node_modules/` returns a well-formed
 * outcome record in O(1) — single `existsSync` invocation. Blast
 * radius: a single `bin/minsky.mjs` invocation. Operator escape
 * hatch: the underlying issue is fixed by `pnpm install`.
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | node_modules present | Normal operation | `{ ok: true }` | "checkNodeModulesExists — present" |
 * | 2 | node_modules absent | Fresh clone, no `pnpm install` yet | `{ ok: false, nodeModulesPath }`; caller emits message + exits 1 | "checkNodeModulesExists — absent" |
 * | 3 | existsSync throws | Read-only mount, EACCES | loud-crash per Armstrong — error bubbles up to supervisor | "checkNodeModulesExists — chaos: existsSync throws" |
 *
 * @module tick-loop/node-modules-existence-check
 */

/**
 * Discriminated union returned by {@link checkNodeModulesExists}. The
 * `ok: true` branch carries no data; the `ok: false` branch carries
 * the resolved path so the caller can render it in the error message.
 */
export type NodeModulesCheckOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly nodeModulesPath: string };

/**
 * Run the existence check. Pure-over-injection: the test layer passes
 * a synthetic `existsSyncFn`; production wiring in `bin/minsky.mjs`
 * passes `node:fs.existsSync`.
 *
 * @otel-exempt pure check — sub-millisecond, no spawning, no spans.
 */
export function checkNodeModulesExists(opts: {
  readonly nodeModulesPath: string;
  readonly existsSyncFn: (p: string) => boolean;
}): NodeModulesCheckOutcome {
  if (opts.existsSyncFn(opts.nodeModulesPath)) {
    return { ok: true };
  }
  return { ok: false, nodeModulesPath: opts.nodeModulesPath };
}

/**
 * Render the operator-facing recovery message. Single line, prefixed
 * with `minsky:` to match the rest of the CLI's stderr convention
 * (`minsky: dist not built ...`, `minsky: claude probe → exhausted ...`).
 *
 * The message names the recovery command (`pnpm install`) and the
 * missing path so the operator can sanity-check both without re-
 * running the failing command.
 *
 * @otel-exempt pure formatter — same input → same output.
 */
export function formatNodeModulesMissingMessage(nodeModulesPath: string): string {
  return `minsky: node_modules/ missing (${nodeModulesPath}) — run \`pnpm install\` from the repo root`;
}
