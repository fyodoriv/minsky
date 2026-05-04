/**
 * `OmcPersonaSpawner` — Strategy implementation (Gamma et al., *Design
 * Patterns*, 1994) of the {@link PersonaSpawner} interface defined in
 * `./index.ts`. Shells out `omc /team <persona>` against a per-task
 * working directory; the resulting `.omc/state/team/<teamName>/` is
 * read by `@minsky/omc-tasksmd-bridge` (PR #78).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Strategy of `PersonaSpawner`. Conformance:
 *                            full.
 *   - Subprocess invocation: Standard `child_process.spawn` shape with
 *                            `stdio: ['ignore', 'pipe', 'pipe']`. The
 *                            spawn function itself is constructor-injected
 *                            so tests assert argv without forking a real
 *                            OMC binary. Conformance: full.
 *   - selfTest lattice:      `green` if the OMC binary is in PATH,
 *                            `yellow` if not (still functional via the
 *                            Stub for tests; the daemon downgrades the
 *                            wrist surface to soft-fail), `red` on a
 *                            spawn-time error (e.g. EACCES, ENOEXEC).
 *                            Conformance: full.
 *
 * Why an injectable `spawn`: Node's `child_process.spawn` is a global
 * I/O surface. Injection lets tests assert the exact argv shape (rule
 * #2 — every dep behind interface; the OMC CLI is a dep). The seam is
 * constructor-level (Martin 2017 — DI at the edge).
 *
 * Why no try/catch deeper than 1 level (rule #6): `spawn()` has exactly
 * one `try { spawn(...) } catch { return failureResult }` at the top
 * level — the rejection is the supervisor boundary ("let it crash AT
 * the right boundary, not at the wrong one" — Armstrong 2007). The
 * `selfTest()` re-uses the same boundary by checking PATH first.
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Strategy).
 *   - Armstrong, J., *Programming Erlang*, Pragmatic Bookshelf, 2007
 *     (let-it-crash supervision — the rejection is the supervisor
 *     boundary, not silently swallowed inside the function).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (DI at the
 *     edge: the `spawnFn` seam is the only I/O, injected once).
 *   - OMC `/team` mode: `Yeachan-Heo/oh-my-claudecode` repo —
 *     `src/team/state-paths.ts` defines the
 *     `.omc/state/team/<teamName>/` layout the bridge reads.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { join } from "node:path";

import type { SelfTestResult } from "@minsky/adapter-types";

import type { PersonaSpawnOpts, PersonaSpawnResult, PersonaSpawner } from "./index.js";

/**
 * OMC binary name. Exported for tests that assert the argv shape via
 * the injected `spawnFn`; production callers should not need it.
 */
export const OMC_BIN = "omc" as const;

/**
 * Subset of `child_process.ChildProcess` we depend on. Tests pass a
 * minimal fake satisfying this shape. The real Node type is much
 * richer, but the Strategy only listens for `close` and `error`.
 */
export interface SpawnedChild {
  on(event: "close", listener: (code: number | null) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
}

/**
 * Subset of `child_process.spawn` we depend on. The third arg is the
 * options object; we always pass `cwd` and `stdio`.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; stdio: readonly ("ignore" | "pipe")[] },
) => SpawnedChild;

/**
 * Constructor options for {@link OmcPersonaSpawner}.
 */
export interface OmcPersonaSpawnerOpts {
  /**
   * Injectable `child_process.spawn` for testability. Defaults to
   * Node's built-in `spawn`. Tests pass a mock to assert argv shape
   * without forking a real OMC binary.
   */
  readonly spawnFn?: SpawnFn;
  /**
   * Optional override for the `omc` binary path. Defaults to the bare
   * `'omc'` (PATH lookup). Useful for self-hosted deployments where
   * `omc` lives at e.g. `/opt/omc/bin/omc`.
   */
  readonly omcBin?: string;
  /**
   * Injectable PATH probe for `selfTest()`. Returns `true` iff the
   * given binary name resolves on PATH. Defaults to a Node `which`-like
   * lookup walking `process.env.PATH`.
   */
  readonly hasBinaryOnPath?: (name: string) => Promise<boolean>;
  /**
   * Clock seam for `durationMs`. Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

/**
 * Build the argv we pass to OMC for one persona spawn. OMC's `/team`
 * mode is invoked as `omc /team <persona>` — the first positional is
 * the literal `/team` command (slash included; OMC parses it as a
 * subcommand).
 *
 * @otel-exempt argv-builder helper; pure mapping over inputs, covered by `spawn()`'s span
 */
function buildArgv(persona: string): readonly string[] {
  return ["/team", persona];
}

/**
 * Strategy implementation of {@link PersonaSpawner} backed by a
 * subprocess invocation of the `omc` CLI.
 */
export class OmcPersonaSpawner implements PersonaSpawner {
  private readonly spawnFn: SpawnFn;
  private readonly omcBin: string;
  private readonly hasBinaryOnPath: (name: string) => Promise<boolean>;
  private readonly nowFn: () => number;

  constructor(opts: OmcPersonaSpawnerOpts = {}) {
    this.spawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
    this.omcBin = opts.omcBin ?? OMC_BIN;
    this.hasBinaryOnPath = opts.hasBinaryOnPath ?? defaultHasBinaryOnPath;
    this.nowFn = opts.now ?? Date.now;
  }

  /**
   * Compute the OMC team-state directory the bridge will read. Mirrors
   * OMC's documented layout: `<workingDir>/.omc/state/team/<teamName>/`.
   * `teamName` defaults to the task ID so concurrent spawns don't
   * collide on the filesystem.
   *
   * @otel-exempt path-builder helper; pure string concat, covered by `spawn()`'s span
   */
  private stateDir(opts: PersonaSpawnOpts): string {
    const teamName = opts.teamName ?? opts.taskId;
    return join(opts.workingDir, ".omc", "state", "team", teamName);
  }

  /**
   * Spawn one persona session. Awaits the child's `close` event and
   * returns the captured exit code + wall-clock duration + the OMC
   * team-state dir for the bridge to read. Never throws — a spawn
   * failure (binary missing, EACCES) maps to
   * `{ exitCode: -1, durationMs, omcStateDir }` so the daemon's loop
   * can continue (rule #7 graceful-degrade).
   *
   * @otel adapters.persona-spawner.spawn
   */
  async spawn(opts: PersonaSpawnOpts): Promise<PersonaSpawnResult> {
    const start = this.nowFn();
    const argv = buildArgv(opts.persona);
    const stateDir = this.stateDir(opts);
    const exitCode = await runChild(this.spawnFn, this.omcBin, argv, opts.workingDir);
    const durationMs = this.nowFn() - start;
    return { exitCode, durationMs, omcStateDir: stateDir };
  }

  /**
   * Health probe. Returns `green` if the OMC binary is on PATH,
   * `yellow` if not (the Stub still works for tests + the daemon can
   * skip persona-spawning and fall back to the dry-run path), `red` on
   * a probe-time error (filesystem unreachable, etc.).
   *
   * @otel adapters.persona-spawner.selfTest
   */
  async selfTest(): Promise<SelfTestResult> {
    const start = this.nowFn();
    const probe = await runProbe(this.hasBinaryOnPath, this.omcBin);
    const latencyMs = this.nowFn() - start;
    return buildSelfTestResult(probe, this.omcBin, latencyMs);
  }
}

/**
 * Run a single child to completion. Returns the exit code (or `-1` on a
 * spawn-time error so the caller can branch on a single boundary).
 * One try/catch at the supervisor seam (rule #6).
 *
 * @otel adapters.persona-spawner.run-child
 */
async function runChild(
  spawnFn: SpawnFn,
  bin: string,
  argv: readonly string[],
  cwd: string,
): Promise<number> {
  return new Promise<number>((resolve) => {
    let child: SpawnedChild;
    try {
      child = spawnFn(bin, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      // rule-6: handled-locally — synchronous spawn-time error (binary missing, ENOENT) is the supervisor boundary; per rule #7 (chaos table row "omc missing from PATH"), a missed spawn must never crash the daemon. The async `error` listener below catches the post-spawn variant.
    } catch {
      resolve(-1);
      return;
    }
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
  });
}

/**
 * Run the PATH probe with a single try/catch (rule #6). Returns
 * `'green'` / `'yellow'` / `'red'` directly so the caller's selfTest
 * branch is a flat lookup, not a nested branch.
 *
 * @otel adapters.persona-spawner.run-probe
 */
async function runProbe(
  hasBinaryOnPath: (name: string) => Promise<boolean>,
  bin: string,
): Promise<"green" | "yellow" | "red"> {
  let present: boolean;
  try {
    present = await hasBinaryOnPath(bin);
    // rule-6: handled-locally — a probe-level failure (filesystem unreachable, EACCES on a PATH dir) is the only error path; per rule #7 (chaos table row "OMC team-state dir not produced"), surface as red so the dashboard distinguishes "OMC missing" (yellow) from "the probe itself broke" (red).
  } catch {
    return "red";
  }
  return present ? "green" : "yellow";
}

/**
 * Build the {@link SelfTestResult} from the probe outcome + latency.
 * Pure helper — no I/O, no time (the caller passes `latencyMs`).
 *
 * @otel-exempt result-builder helper; pure mapping over inputs, covered by `selfTest()`'s span
 */
function buildSelfTestResult(
  probe: "green" | "yellow" | "red",
  bin: string,
  latencyMs: number,
): SelfTestResult {
  const message = describeProbe(probe, bin);
  return {
    status: probe,
    message,
    latencyMs,
    lastCheck: new Date().toISOString(),
  };
}

/**
 * @otel-exempt prose helper for selfTest message; trivial pure function
 */
function describeProbe(probe: "green" | "yellow" | "red", bin: string): string {
  if (probe === "green") return `${bin} found on PATH`;
  if (probe === "yellow") return `${bin} missing from PATH — Stub still works for tests`;
  return `${bin} PATH probe failed`;
}

/**
 * Default `hasBinaryOnPath` — walks `process.env.PATH` looking for a
 * file with the given name. Uses `fs/promises.access` to avoid spawning
 * `which` (which would itself need to be on PATH — rule #1
 * don't-reinvent + don't-bootstrap-on-the-thing-you're-checking).
 *
 * @otel adapters.persona-spawner.default-has-binary-on-path
 */
async function defaultHasBinaryOnPath(name: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  const dirs = (process.env["PATH"] ?? "").split(":").filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    const ok = await accessSafe(access, candidate);
    if (ok) return true;
  }
  return false;
}

/**
 * Returns `true` iff the file is accessible; any error means "not
 * present here, keep looking". Uses Promise `.then/.catch` rather than
 * `try/catch` so the supervisor boundary stays at the caller (rule #6
 * — `access` rejects on ENOENT / EACCES per the PATH walk; per rule #7
 * chaos-table row "omc missing from PATH", each individual miss is
 * graceful — only "no PATH entry has it" is the surfaced result).
 *
 * @otel-exempt access-probe helper; one fs call inside a tight loop, covered by the caller's span
 */
function accessSafe(access: (path: string) => Promise<void>, path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
