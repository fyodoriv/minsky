<!-- scope: human-approved slice 1 of the approved P0 operator-directive task `runany-retro-tui-dashboard`; all new files are under the `novel/tui/` package the task block explicitly mandates ("new `novel/tui/src/*` (+ tests)") -->

## Why needed

Today the operator surface is a browser-based dashboard (`@minsky/dashboard-web`)
gated by a Lighthouse Mobile≥0.85 CI workflow — it needs a browser, a port, and
a runtime web service. That is the wrong surface for a `$0`, multi-tenant CLI
tool invoked from any folder (operator directive 2026-05-16; the $10/mo cap
forbids a runtime web service). The task replaces it with a zero-dependency
retro-1995 TUI and, per the rule #10 ratchet, removes the web UI in the same
task — never two competing operator surfaces.

This PR is **slice 1 of N**: the pure seam only. It establishes the substrate
the rest of the task composes:

- `novel/tui/src/scan.ts` — `parseMinskyProcs(raw)`: `pgrep -fal` text →
  typed running-minsky-process rows (role classification, run-id/repo/model
  extraction, scan-tool noise rejection, stable pid sort).
- `novel/tui/src/machine.ts` — `formatMachineInfo(raw)`: raw host readings →
  fixed-width vitals strings (load / cpu / mem / disk / UTC clock / proc
  count), with graceful degradation for skewed/non-finite readings.
- `novel/tui/src/render.ts` — `renderDashboard(model)`: model → the retro
  80×24 ANSI / box-drawing screen-(1) string; explicit empty state;
  selection highlight; ANSI-off mode for snapshot tests.
- `novel/tui/src/format.ts` — shared `humanBytes` / `formatDuration` / `cell`.

Everything is I/O-free with **no model calls**. The raw-mode TTY driver, the
`pgrep`/`os`/`df` collectors, the per-process detail screen + log list, the
`bin/minsky` wiring, and the rule-#10 **removal** of the web UI + lighthouse
gate land in later slices on this seam. The web UI does not return (task block
Pivot clause). `vision.md` § Pattern conformance index row 89 records the
package and the deferred ratchet.

This iteration ships code (a new tested package + wiring into the TS project
references and the vitest alias), not a task-block refresh.

`optimization: none-this-iteration: greenfield pure-seam package — no
pre-existing brief, gate, round-trip, or log line to shrink yet; the first
slice establishes the surface that later slices will optimize against.`

## How verified

- `pnpm exec vitest run novel/tui --coverage` → **39 tests pass**; coverage
  on `novel/tui/src` = **99.5 % lines / 95.7 % branches** (gate ≥90 % / ≥85 %).
- `pnpm exec tsc --noEmit -p novel/tui/tsconfig.json` → clean.
- `pnpm exec biome check novel/tui` → clean.
- `pnpm pre-pr-lint` → green (see CI).

## Security & privacy

§ 13 reviewed. No new attack surface in this slice: the package is pure
functions with **zero runtime dependencies**, no I/O, no network, no
filesystem access, no secrets, no PII. The only externally-influenced data
the surface will ever render — process command lines — is read at the I/O
edge in a *later* slice; the renderer already hard-truncates every cell to a
fixed column width (`format.ts#cell`), which structurally prevents a long or
newline-bearing cmdline from breaking the box layout (the TUI analogue of the
dashboard-web SSR escaping). Threat: a hostile cmdline injecting ANSI to
spoof the frame — mitigation noted: the collector slice will strip control
bytes from scanned cmdlines before they reach `renderDashboard` (tracked on
the parent task's later slices; the renderer's color-off path is already
control-byte-free by construction).

## Hypothesis self-grade

- **Predicted**: a pure, I/O-free TUI substrate (scan parser + machine-info formatter + screen-(1) renderer) can be landed and unit-tested at ≥90 % line / ≥85 % branch coverage on `novel/tui/src` with all tests green, biome clean, and tsc clean — without touching the web UI (the rule-#10 ratchet is deferred to the slice that wires the TUI in as the operator surface).
- **Observed**: 39 tests pass; coverage on `novel/tui/src` = 99.5 % lines / 95.7 % branches; `biome check novel/tui` clean; `tsc -p novel/tui` clean; no web-UI files touched this slice.
- **Match**: yes
- **Lesson**: pure-seam-first makes the substrate measurable through the existing coverage gate, so later I/O slices need no preparation PR — the render/scan contract is now frozen and snapshot-tested, and the ratchet stays correctly bound to the landing slice.
