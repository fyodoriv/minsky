# `@minsky/tui`

<!-- rule-1: blessed / ink / blessed-contrib (Node TUI frameworks) rejected because: each adds a multi-MB runtime dependency tree for a read-only, glanceable 80x24 board that needs only raw ANSI + box-drawing — a fat TUI lib violates rule #1 (compose, don't reinvent the heavy) and the $10/mo cap's dep-light constraint; the screen has no widgets, focus tree, or reflow that would justify the dependency. The process scan is itself composed, not reinvented — see "Pattern conformance" below. -->

Zero-dependency retro-1995 (amber/green-on-black, 80x24) CLI/TUI
operator surface. The **pure render core** ships across two slices:

- **Screen 1 — machine dashboard** (`renderDashboard`): the
  machine-info panel formatter (`formatMachineInfo`) plus the
  per-process table. The machine-wide process list is **composed**
  from `@minsky/cross-repo-runner` (the blessed
  `scanMinskyProcesses` / `parseMinskyProcs` / `MinskyProc`
  substrate), not re-derived here.
- **Screen 2 — process detail** (`renderDetail`): the drilled-into
  run's identity (run-id, kind, pid, repo), env (model / provider),
  launchd label, a ledger summary, recent merges, and the **log
  list** of its `.minsky/*.log` files (`formatLogRow`, size-tagged,
  selectable for a future tail view). Pressing ENTER on a screen-1
  row drills here; `b` returns to screen 1.

Both renderers are pure (`model → string[]`); colour is opt-in so the
layout is deterministically unit-tested and the future TTY shim flips
`color: true` at the I/O edge.

- **I/O shim** (`gatherMachineRaw`, `listLogFiles`): the injected edge
  that fills the screen-1/2 models from real data — `node:os` +
  `fs.statfsSync` → `MachineRaw` (no `df` subprocess), and a run's
  `.minsky/` dir → the name-sorted, size-tagged `LogFile[]`. Each
  gatherer is pure relative to an injected `MachineProbe` /
  `LogDirProbe` (production binds the `node:` default; tests pass a
  frozen fixture), and the default probes degrade a denied syscall to a
  safe zero/empty rather than throw (rule #6/#7).

The remaining tty write/keystroke loop, the `bin/minsky`
no-arg/auto-open wiring, and the rule #10 ratchet that retires
`@minsky/dashboard-web` land in later slices of TASKS.md
`runany-retro-tui-dashboard`.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 89:

- **Process scan reuse (rule #1)** — `@minsky/tui` re-exports
  `parseMinskyProcs` / `scanMinskyProcesses` / `MinskyProc` from
  `@minsky/cross-repo-runner` rather than parsing `ps` a second time.
  One machine-wide enumerator serves the whole runany cluster (TUI,
  multi-tenant guard, zero-arg entrypoint). **Conformance: full.**
- **Machine-info panel** — pre-formatted glanceable display, not a
  number dump (Card, Mackinlay, Shneiderman, *Readings in Information
  Visualization*, 1999). **Conformance: full.**
- **Dashboard renderer** — pure `model → string[]`; colour is an opt-in
  Strategy flag so the layout is deterministically testable and the TTY
  shim flips it at the edge (Martin, *Clean Architecture*, 2017).
  **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: for any `MinskyProc[]` and any machine
  telemetry, the renderer yields lines all exactly the box width and
  never throws.
- **Blast radius**: a single render frame. Every function is pure (no
  I/O, no shared state, no clock — `nowMs` is injected into the
  machine formatter).
- **Operator escape hatch**: an empty process list still renders a
  coherent "(no running minsky processes)" board; an empty repo path
  renders `—`, never a blank cell.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | `ps` returns noise / vet-child / non-minsky lines | upstream-noisy | dropped upstream by the composed scanner | `novel/cross-repo-runner/src/scan-processes.test.ts` |
| 2 | `ps` missing / permission denied | resource / perm fault | `scanMinskyProcesses` degrades to `[]`, no throw | `novel/cross-repo-runner/src/scan-processes.test.ts` |
| 3 | `df` / `os` totals are 0 | telemetry-missing | mem/disk render `0%`, not `NaN%` (rule #7) | `novel/tui/test/machine.test.ts` |
| 4 | Repo path empty or `/` | upstream-malformed | REPO column renders `—` (explicit, not blank) | `novel/tui/test/render.test.ts` |
| 5 | Zero running minsky processes | steady-idle | coherent notice board at full box width | `novel/tui/test/render.test.ts` |
| 6 | Process row wider than the REPO column | layout-overflow | basename truncated with an ellipsis; line still exactly box-width | `novel/tui/test/render.test.ts` |
| 7 | `os`/`statfs` syscall denied or missing | resource / perm fault | default `MachineProbe` degrades to safe zeros; panel renders `0%`, no throw | `novel/tui/test/gather.test.ts` |
| 8 | Run's `.minsky/` dir missing / a log un-stat-able | telemetry-missing | `listLogFiles` → `[]` (notice board) / size kept `-1` (row renders `?`) | `novel/tui/test/gather.test.ts` |

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per
Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: the `MinskyProc[]` from the composed scanner
  (derived from `ps` command lines of other host processes) and
  `os`/`df` numbers.
- **Trusted state**: every function here is pure; there is no network,
  no filesystem write, no model call (read-only surface per the task).
- **Trust boundary**: the renderer accepts data and returns strings —
  no command-line token is ever executed; `ps` parsing + vet-child
  exclusion happen once, in the audited `@minsky/cross-repo-runner`
  substrate.
- **STRIDE focus**: **S**poofing — a hostile process could name its
  argv like a minsky entrypoint and show as a phantom row; the surface
  is read-only (no action on a row) so the blast radius is a cosmetic
  phantom row, not code execution. **I**nformation disclosure — the
  dashboard renders only `pid/kind/repo-basename/runId`, never the full
  argv, on screen 1.
- **Performance-first carve-out** (rule #13's relief valve): none
  declared.

## Hypothesis-driven development (rule #9)

- **Hypothesis**: composing the existing scan substrate + a pure
  renderer (no TUI dependency, no second `ps` parser) fully covers
  screen 1's behaviour, so the operator surface costs $0 at runtime and
  every layout path is unit-testable.
- **Success threshold**: every `renderDashboard` line equals the box
  width across the empty, single, and multi-process cases; zero
  duplicate `ps`-parsing logic (rule #1 lint green).
- **Pivot threshold**: if a pure-ANSI renderer proves brittle across
  terminals once the I/O shim lands, vendor one tiny MIT TUI primitive
  (still $0, still no runtime service) — the web UI does not return.
- **Measurement**: `pnpm --filter @minsky/tui test`
- **Literature anchor**: Martin, *Clean Architecture*, 2017 (I/O at the
  edge); Card, Mackinlay, Shneiderman 1999 (glanceable display).

## Usage

```ts
import {
  formatMachineInfo,
  gatherMachineRaw,
  renderDashboard,
  scanMinskyProcesses,
} from "@minsky/tui";

// The scan substrate is composed from @minsky/cross-repo-runner; the
// I/O shim reads os/statfs at the edge (default node: probe).
const procs = scanMinskyProcesses();
const machine = formatMachineInfo(gatherMachineRaw(procs.length));
for (const line of renderDashboard({ machine, procs, selectedIndex: 0 }, { color: process.stdout.isTTY })) {
  process.stdout.write(`${line}\n`);
}
```
