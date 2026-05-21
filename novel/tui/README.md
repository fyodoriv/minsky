<!-- rule-1: blessed / ink / blessed-contrib / terminal-kit rejected because: a runtime TUI dependency violates rule #1 (dep-light) and the $10/mo cap — ink pulls React + reconciler (~40 transitive deps), blessed is unmaintained (last release 2015) and ships its own widget runtime, terminal-kit is ~30 deps. This surface is a read-only 80×24 box-drawing screen; raw ANSI string composition is ~200 LOC of pure, fully-unit-tested code with zero install/audit/CVE surface, which is the correct trade for a $0 multi-tenant CLI. The task block mandates "no heavy TUI dep". Pivot (task block): if pure ANSI proves too brittle across terminals, vendor ONE tiny MIT primitive — never reinstate the web UI. -->

# @minsky/tui

Zero-dependency retro-1995 CLI/TUI substrate for the **machine-wide minsky
dashboard**. This package replaces the browser-based `@minsky/dashboard-web`
operator surface per the rule #10 ratchet — there are never two competing
operator surfaces.

> **Slice 1 of `runany-retro-tui-dashboard`.** This package currently ships
> the **pure seam only**: the process-scan parser, the machine-info
> formatter, and the screen-(1) ANSI renderer. All three are I/O-free and
> fully unit-tested (rule #10 — the pure render/scan logic is the seam).
> The raw-mode TTY driver, the `pgrep`/`os`/`df` collectors, the
> per-process **detail screen + log list**, the `bin/minsky` wiring
> (zero-arg → dashboard, folder-start → auto-open that run's fullscreen
> detail), and the rule-#10 **removal** of `@minsky/dashboard-web` +
> `.github/workflows/lighthouse.yml` + `distribution/run-dashboard-web.sh`
> land in later slices on top of this seam. The web UI does **not** come
> back (see the task block's Pivot clause).

## Why a TUI, not a web UI

The operator surface must work for a `$0` multi-tenant CLI tool invoked from
any folder — no browser, no port, no runtime web service (the $10/mo cap).
A retro 80×24 amber/green-on-black box-drawing screen is glanceable (Card &
Mackinlay 1999), dependency-free (rule #1), and renders over SSH with no
forwarding. Per rule #10 the superseded web surface is removed in the **same
task** (a later slice), not left to rot beside its replacement.

## Architecture

Pure-function core with I/O at the edge (Martin 2017, _Clean
Architecture_). Every exported function in `src/` is referentially
transparent and snapshot-testable without a TTY:

| Module          | Responsibility                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `src/scan.ts`   | `parseMinskyProcs(raw)` — `pgrep -fal` text → typed running-process rows.       |
| `src/machine.ts` | `formatMachineInfo(raw)` — raw host readings → fixed-width vitals strings.      |
| `src/render.ts` | `renderDashboard(model)` — model → the retro 80×24 screen-(1) string.            |
| `src/format.ts` | `humanBytes` / `formatDuration` / `cell` — shared fixed-width formatters.       |

The `pgrep` exec, the `os`/`df` reads, the raw-mode keypress loop, and the
`bin/minsky` dispatch are the I/O boundary and are added in later slices —
they compose these pure functions, never the reverse.

## Failure modes & chaos verification

This slice is pure, so every failure mode is a _bad input_, not a runtime
fault. Each degrades explicitly (rule #7 — visible, never silent) and is
pinned by a unit test (the deterministic chaos surface for a pure module —
Basiri et al. 2016, steady-state hypothesis + adversarial input):

| Failure mode | Trigger | Degraded behaviour (steady state) | Chaos test |
| --- | --- | --- | --- |
| Malformed scan line | blank / separator-less / non-numeric-pid / non-minsky line in `pgrep` output | line skipped; the rest of the list is intact | `novel/tui/src/scan.test.ts` |
| Scan tooling self-match | `pgrep`/`grep`/`rg`/`ps` row whose cmdline literally contains `tick-loop.mjs` | rejected as noise; no phantom worker row | `novel/tui/src/scan.test.ts` |
| Skewed host readings | `free > total`, `NaN`/`Infinity` load, non-finite clock, zero-total disk | sentinels (`0%`, `?`, epoch UTC); never `NaN`, never a throw | `novel/tui/src/machine.test.ts` |
| Over-long field value | run-id / repo / model longer than its column | hard-truncated with `…`; frame stays exactly 80 cols | `novel/tui/src/format.test.ts`, `novel/tui/src/render.test.ts` |
| Empty process list | host has zero running minsky procs | explicit `(no running minsky processes)` row, never a blank table | `novel/tui/src/render.test.ts` |
| Selection out of range | `selectedIndex` negative or ≥ proc count | `no process selected` footer; every row still WIDTH cols | `novel/tui/src/render.test.ts` |
| ANSI width drift | color enabled (escape bytes in the line) | visible width (escapes stripped) still exactly 80 cols | `novel/tui/src/render.test.ts` |

Chaos verification for the _I/O_ failure modes (a hostile cmdline injecting
ANSI to spoof the frame; `pgrep`/`df` non-zero exit; a non-TTY stdout) is
`(deferred — covered when runany-retro-tui-dashboard ships)` — those paths
do not exist until the collector / TTY-driver slices land on this seam.

## Usage (slice 1 — library only)

```ts
import { parseMinskyProcs, formatMachineInfo, renderDashboard } from "@minsky/tui";

const procs = parseMinskyProcs(rawPgrepOutput); // pure parse
const machine = formatMachineInfo(rawReadings); // pure format
const screen = renderDashboard({ machine, procs: rows, selectedIndex: 0 });
process.stdout.write(screen); // I/O at the edge — caller's boundary
```

`renderDashboard(model, { color: false })` disables ANSI for stable
snapshot assertions.
