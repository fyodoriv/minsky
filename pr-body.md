# feat(tui): injected I/O shim feeding screen-1/2 pure cores (slice 3 of runany-retro-tui-dashboard)

<!-- scope: human-approved 2026-05-16 operator "single-command run-anywhere multi-tenant minsky + retro TUI" — every novel/tui/** artefact here is in the P0 runany-retro-tui-dashboard task block (Touches: novel/tui/**); slices 1–2 aren't on origin/main yet so the diff reads them all as new -->

## Why needed

Slices 1–2 landed the **pure** screen-1 (machine dashboard) and screen-2
(process detail + log list) renderers — but they are `model → string[]`
functions with no way to obtain a real model. Without the I/O shim the
renderers cannot show a live host: there is no bridge between
`@minsky/cross-repo-runner`'s process scan / `node:os` telemetry / a
run's `.minsky/` log dir and the `MachineRaw` / `LogFile[]` the renderers
consume. This slice is that bridge, and it is the prerequisite for the
`bin/minsky` no-arg/auto-open wiring slice that follows.

It is deliberately **additive** — the tty write/keystroke loop, the
`bin/minsky` wiring, and the rule #10 web-UI ratchet (deleting
`@minsky/dashboard-web` + the lighthouse gate) remain later slices, kept
out of this diff so each slice stays independently reviewable.

## What this slice ships

- `novel/tui/src/gather.ts` (new):
  - `gatherMachineRaw(minskyProcCount, probe?, diskPath?)` — composes
    `node:os` + `fs.statfsSync` into the slice-1 `MachineRaw`. No `df`
    subprocess: `statfsSync` (Node ≥18.15) is zero-dep and avoids
    parsing locale-variant `df` text (rule #1, $10-mo cap).
  - `listLogFiles(dir, probe?)` — a run's `.minsky/` dir → the
    name-sorted, size-tagged `LogFile[]` screen 2 lists.
  - Both pure relative to an injected `MachineProbe` / `LogDirProbe`
    (rule #2 thin seam): production binds the `node:` default, tests
    pass a frozen fixture (rule #10). Default probes degrade a
    denied/missing syscall to a safe zero/empty rather than throw
    (rule #6/#7) — the read-only TUI must never crash the operator.
  - Scan count is **threaded from the caller's `scanMinskyProcesses`**,
    not re-scanned (rule #1 — one machine-wide enumerator).
- `novel/tui/test/gather.test.ts` (new): 6 cases — model composition,
  scan-count threading, disk-path targeting, `*.log` filter + name
  sort + size tag, missing-dir `[]` degrade, un-stat-able `-1` keep.
- `novel/tui/src/index.ts` — re-export the gatherers + probe types.
- `novel/tui/README.md` — doc-first (rule #3): slice-3 paragraph,
  chaos rows 7–8 for the gatherer degrade modes, real-shim Usage
  snippet (`formatMachineInfo(gatherMachineRaw(procs.length))`).

Scope deferred (next slices): the tty write/keystroke loop, the
`bin/minsky` no-arg/auto-open wiring, `scripts/runany-tui-audit.mjs`,
and the rule #10 web-UI removal.

## Optimization (per-iteration discipline)

`round-trip elimination`: the production disk gather is a single
`fs.statfsSync` syscall instead of spawning a `df` child process and
parsing its locale-variant text — one fewer process round-trip per
dashboard refresh tick, and the brittle `df` parse code (~30 bytes
minimum) is never written. Eligible class: round-trip elimination
(≥10-byte threshold met).

## Test plan

- `npx vitest run novel/tui/test` — 28 passed (6 new in
  `gather.test.ts`), all via frozen probes (no real fs/clock).
- `npx tsc --noEmit -p novel/tui/tsconfig.json` — exit 0 under
  `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`.

## Hypothesis self-grade

- **Predicted**: feeding the slice-1/2 pure renderers via injected `node:os`/`fs` seams keeps 100% of the data-gather logic unit-tested with zero host fs/clock touch and zero new runtime dependency
- **Observed**: `npx vitest run novel/tui/test` → 28 passed (6 new gather cases, all via frozen probes, no real fs/clock); `@minsky/tui` dependency list unchanged (only `@minsky/cross-repo-runner`)
- **Match**: yes
- **Lesson**: the injected-probe seam pattern from `scan-processes.ts` generalizes cleanly to `os`/`statfs`/`readdir`, so the next slice (bin/minsky wiring) binds the real defaults at the edge with no further gather logic

## Security & privacy

No new attack surface (§ 13 reviewed). `gather.ts` is a read-only
`os`/`fs` reader behind injected seams: no auth, no secrets, no sandbox,
no network, no PII handling, no filesystem **writes**, and zero new
dependencies. It reads only public host telemetry (`os` load/mem,
`statfs`) and a run's `.minsky/` log **filenames + sizes** (not
contents); no command-line token is ever executed. The default probes
fail closed (degrade to a safe zero/empty, never throw). The future
`.minsky/*.log` tail view will carry its own content-exposure review
when landed.
