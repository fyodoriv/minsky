/**
 * `@minsky/tui` — package entry. Pure core of the retro-1995 CLI/TUI
 * operator surface that replaces `@minsky/dashboard-web`:
 *
 * - The machine-wide process scan is **composed, not re-derived**:
 *   `parseMinskyProcs` / `scanMinskyProcesses` / `MinskyProc` are
 *   re-exported from `@minsky/cross-repo-runner` (rule #1 — one
 *   enumerator for the whole runany cluster) so the future TUI shim
 *   has a single import surface.
 * - `formatMachineInfo` — the machine-info panel formatter (new).
 * - `renderDashboard` / `formatProcRow` / `repoBasename` — the pure
 *   retro 80x24 dashboard renderer (new).
 *
 * The I/O shim (gather `os` telemetry, write to the tty, read
 * keystrokes) and screen 2 (process detail + log list) land in later
 * slices of TASKS.md `runany-retro-tui-dashboard`; that wiring slice
 * also fires the rule #10 ratchet (remove `@minsky/dashboard-web` +
 * the lighthouse gate in the same PR).
 *
 * Pattern conformance: vision.md § "Pattern conformance index" row 89.
 *
 * @module tui
 */

export {
  parseMinskyProcs,
  scanMinskyProcesses,
  type MinskyProc,
  type ProcScanProbe,
} from "@minsky/cross-repo-runner";
export { formatMachineInfo, type MachineInfo, type MachineRaw } from "./machine.js";
export {
  formatProcRow,
  renderDashboard,
  repoBasename,
  type DashboardModel,
  type RenderOpts,
} from "./render.js";
