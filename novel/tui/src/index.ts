/**
 * `@minsky/tui` — public surface of the retro-1995 dashboard substrate.
 *
 * Slice 1 of `runany-retro-tui-dashboard`: the pure seam only — the
 * process-scan parser, the machine-info formatter, and the screen-(1)
 * ANSI renderer, all I/O-free and unit-tested (rule #10). The raw-mode
 * TTY driver, the `pgrep`/`os`/`df` collectors, the per-process detail
 * screen, the `bin/minsky` wiring, and the rule-#10 removal of
 * `@minsky/dashboard-web` + the lighthouse gate land in later slices on
 * top of this seam (the web UI is NOT reinstated — see the task block's
 * Pivot clause).
 */

export { cell, formatDuration, humanBytes } from "./format.js";
export { formatMachineInfo } from "./machine.js";
export type { MachineInfo, RawMachineReadings } from "./machine.js";
export { renderDashboard, WIDTH } from "./render.js";
export type { DashboardModel, ProcRow } from "./render.js";
export { parseMinskyProcs } from "./scan.js";
export type { MinskyProc, MinskyRole } from "./scan.js";
export { repoBasename } from "./render.js";
export { renderDetail, formatLogRow } from "./detail.js";
export type { DetailModel, DetailRenderOpts, LogFile } from "./detail.js";
export {
  gatherMachineRaw,
  listLogFiles,
  defaultMachineProbe,
  defaultLogDirProbe,
} from "./gather.js";
export type { MachineProbe, LogDirProbe } from "./gather.js";
export type { MachineRaw } from "./machine.js";
