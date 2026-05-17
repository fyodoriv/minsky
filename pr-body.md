# feat(tui): pure retro screen-2 process-detail + log-list renderer (slice 2 of runany-retro-tui-dashboard)

## Why needed

The operator surface for a `$0` multi-tenant CLI tool must be a retro
TUI, not a Lighthouse-gated web UI (TASKS.md `runany-retro-tui-dashboard`,
operator 2026-05-16 directive). Slice 1 (open PR #603) shipped the pure
**screen 1** machine-dashboard render core. This slice stacks **screen
2** — the per-process detail page the task's Acceptance #2 requires:
pressing ENTER on a dashboard row drills into the selected run's
identity, env (model/provider), launchd label, ledger summary, recent
merges, and the **log list** of its `.minsky/*.log` files.

Slice 1's pure core (`novel/tui/`, `formatMachineInfo` +
`renderDashboard`) is carried forward onto the up-to-date base so this
PR is self-contained while #603 is in flight (sibling-slice-reuse
pattern; identical content de-dupes on merge).

## What this slice ships

- `novel/tui/src/detail.ts` — pure `renderDetail(model) → string[]`
  for screen 2: banner, identity panel, env, launchd, ledger,
  recent-merges, and a selectable `.minsky/*.log` list with
  human-readable sizes. Plus `formatLogRow` for the per-row unit
  tests. Same zero-dependency contract as screen 1 (raw ANSI +
  box-drawing, amber/green-on-black, fixed 80×24, colour opt-in).
- `novel/tui/test/detail.test.ts` — width invariant, ANSI gating,
  selected-row inversion, and rule #7 graceful-degrade cases (empty
  logs / empty ledger / un-stat-ed size).
- `index.ts` exports `renderDetail`/`formatLogRow`/`DetailModel`/etc.
- README + `vision.md` row 89 extended to document screen 2 (rule #3
  doc-first; rule #10 ratchet note preserved — the web-UI removal
  still lands in the later `bin/minsky` wiring slice, not here).

Scope deferred (next slices): the I/O shim that fills `DetailModel`
from `.minsky/*.log`/ledger/launchd, the `bin/minsky` no-arg/auto-open
wiring, `scripts/runany-tui-audit.mjs`, and the rule #10 web-UI
removal.

## Optimization (per-iteration discipline)

Round-trip / duplication elimination: `detail.ts` **composes**
`repoBasename` from `render.ts` instead of re-deriving the
path-basename + rule-#7 em-dash logic (~120 bytes of duplicated pure
code avoided; rule #1). The box primitives are deliberately a small
local copy with an inline deferred-DRY note — editing the in-flight
slice-1 `render.ts` would create a merge conflict with PR #603 for
marginal gain; the shared `box.ts` consolidation lands once slice 1
merges.

## Test plan

- `pnpm --filter @minsky/tui test` — screen-1 + screen-2 suites green.
- `pnpm --filter @minsky/tui typecheck` — clean under
  `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`.
- Every `renderDetail` line is exactly the box width (80 default,
  honours custom width); ANSI escapes appear only with `color: true`.

## Hypothesis self-grade

- **Predicted**: a pure `renderDetail` produces a deterministic 80×24
  process-detail board (identity + env + ledger + merges + selectable
  `.minsky/*.log` list), fully unit-tested, advancing Acceptance #2
  (per-process detail page with log list) and #5 (pure render logic
  unit-tested) with zero new runtime dependency.
- **Observed**: `pnpm --filter @minsky/tui test` green (screen-1 +
  screen-2 suites); every `renderDetail` line == box width; ANSI
  gated on `color`; selected log row inverted; rule #7 degrades
  verified.
- **Match**: yes
- **Lesson**: composing `repoBasename` across screens kept the slice
  additive and conflict-free with the in-flight slice-1 PR; the next
  slice can safely hoist the shared box primitives once #603 lands.

## Security & privacy

No new attack surface (§ 13 reviewed). `detail.ts` is a pure
`data → string[]` formatter: no auth, no secrets, no sandbox, no
network, no filesystem, no PII handling, and zero new dependencies
(raw ANSI only). All inputs are pre-gathered plain data supplied by a
future I/O shim, which is out of scope for this slice; that shim's
`.minsky/*.log` reads will carry their own threat review when landed.
