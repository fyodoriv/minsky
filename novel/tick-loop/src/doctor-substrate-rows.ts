// <!-- scope: human-approved minsky-fresh-clone-health-checks slice 1 (operator 2026-05-08 — "Next let's add as much stable self-healing as reasonable to minsky & install commands") -->
// <!-- scope: human-approved minsky-runtime-resilience slice 2 (operator 2026-05-08 — 13th doctor row: workers dir writable) -->
/**
 * `@minsky/tick-loop/doctor-substrate-rows` — pure renderer for the
 * substrate rows added to `minsky doctor` in slice 1 of
 * `minsky-fresh-clone-health-checks` (rows 1–4) and slice 2 of
 * `minsky-runtime-resilience` (row 5 — workers dir writable) per
 * `TASKS.md`.
 *
 * The existing 8 doctor rows (claude / pipx / mlx_lm.server / aider /
 * model weights / mlx-lm reachable / python / arch) report on the
 * **local-LLM stack**. The 5 new rows added here report on the
 * **install-time + runtime substrate** — the things that `pnpm install`
 * puts in place plus the writability of `.minsky/workers/` — so the
 * operator can see *both* layers at once and doesn't have to guess
 * which layer is broken.
 *
 *   1. node_modules            (target: `<repo>/node_modules`)
 *   2. pnpm-lock.yaml          (target: `<repo>/pnpm-lock.yaml`)
 *   3. dist/index.js           (target: `<repo>/novel/tick-loop/dist/index.js`)
 *   4. pnpm on PATH            (`whichFn("pnpm")`)
 *   5. workers dir writable    (target: `<MINSKY_HOME>/.minsky/workers/`)
 *
 * Each row is GREEN/✓ if present, RED/✗ if absent — when ANY row is
 * RED, doctor's banner becomes RED instead of YELLOW (operator can't
 * run the daemon at all without these). The renderer is
 * pure-over-state so we can pin the exact wording in tests; the
 * wiring in `bin/minsky.mjs` reads `existsSync` + `whichFn` to build
 * the state record.
 *
 * Pattern conformance (rule #8): Pure renderer — Hughes 1989.
 * Health-check distinction — Beyer et al., *Site Reliability
 * Engineering*, 2016, Ch. 6 (health checks must distinguish failure
 * modes the operator can act on from internal bugs; cryptic stack
 * traces conflate these).
 *
 * @module tick-loop/doctor-substrate-rows
 */

/**
 * Live state of the four install-time substrate pieces, as reported
 * by `bin/minsky.mjs`'s wiring (`existsSync` + `whichFn`).
 */
export type DoctorSubstrateRowState = {
  readonly nodeModulesPresent: boolean;
  readonly pnpmLockPresent: boolean;
  readonly distPresent: boolean;
  readonly pnpmOnPath: boolean;
  readonly workersDirWritable: boolean;
  readonly workersDirPath: string;
};

/**
 * Render the four substrate rows as a `string[]`. Caller (`bin/
 * minsky.mjs::runDoctor`) joins with `\n` and writes to stdout; the
 * tests pin each row's exact prefix (`  ✓ ` / `  ✗ `) and label so
 * the operator can spot at a glance which substrate piece is
 * missing.
 *
 * The recovery hint on each red row points at the canonical fix:
 *   - node_modules / lockfile / dist all → `pnpm install`
 *   - pnpm-on-PATH → one of {corepack enable, brew install pnpm,
 *     npm i -g pnpm} (operator picks the one that matches their
 *     system).
 *
 * @otel-exempt pure renderer — same input → same output.
 */
export function renderDoctorSubstrateRows(state: DoctorSubstrateRowState): readonly string[] {
  return [
    formatRow("node_modules", state.nodeModulesPresent, "run `pnpm install` from the repo root"),
    formatRow("pnpm-lock.yaml", state.pnpmLockPresent, "run `pnpm install` from the repo root"),
    formatRow(
      "dist/index.js",
      state.distPresent,
      "run `pnpm install` (the prepare hook builds dist) or `pnpm --filter @minsky/tick-loop build`",
    ),
    formatRow(
      "pnpm on PATH",
      state.pnpmOnPath,
      "install pnpm: `corepack enable` (Node ≥16.13) OR `brew install pnpm` OR `npm i -g pnpm`",
    ),
    formatRow(
      "workers dir writable",
      state.workersDirWritable,
      `${state.workersDirPath} is not writable by the current user. Try \`chmod u+w ${state.workersDirPath}\` OR set MINSKY_HOME to a writable path (e.g., MINSKY_HOME=$HOME/minsky)`,
    ),
  ];
}

function formatRow(label: string, present: boolean, recoveryHint: string): string {
  if (present) {
    return `  ✓ ${label}`;
  }
  return `  ✗ ${label}  — ${recoveryHint}`;
}
