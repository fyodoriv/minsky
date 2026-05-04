/**
 * PersonaSpawner adapter — interface (Adapter pattern, Gamma 1994) + a
 * `StubPersonaSpawner` test fake (Meszaros 2007) + an `OmcPersonaSpawner`
 * Strategy (sibling file `./omc.ts`) that shells out
 * `omc /team <persona>` against a per-task working directory.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:               Adapter (structural) + Strategy
 *                                (behavioral) per Gamma, Helm, Johnson,
 *                                Vlissides, *Design Patterns*, 1994.
 *                                Conformance: full.
 *   - `StubPersonaSpawner`:      Test fake / spy hybrid per Meszaros,
 *                                *xUnit Test Patterns*, 2007 — records
 *                                calls in-memory + returns canned shape so
 *                                tests assert call shape without invoking
 *                                a real subprocess. Conformance: full.
 *   - Persona dispatch table:    Role-based agent orchestration per
 *                                Wooldridge, *An Introduction to
 *                                MultiAgent Systems*, 2009. The table maps
 *                                tasks.md task tags to OMC personas.
 *                                Conformance: full.
 *   - `selfTest()`:              Health-probe shape — re-uses
 *                                {@link SelfTestResult} from
 *                                `@minsky/adapter-types` (leaf package per
 *                                Martin, *Clean Architecture*, 2017 —
 *                                acyclic dependency principle).
 *
 * Why a persona-spawner adapter (rule #2): the tick-loop daemon's v0
 * dry-run path in `@minsky/tick-loop` (PR #67) does not yet spawn any
 * agent. The follow-up `tick-loop-daemon-real-spawn` plans to shell out
 * to `omc /team <persona>` so each task type ends up in front of the
 * right specialist (engineer / reviewer / researcher) — closing the
 * "society of specialists" promise (vision.md "north star"). This
 * package is the seam: a `PersonaSpawner.spawn()` interface the daemon
 * can call, with `OmcPersonaSpawner` as the v0 production Strategy and
 * `StubPersonaSpawner` as the test fake.
 *
 * Why OMC as the v0 Strategy (rule #1 — don't reinvent the wheel):
 * `oh-my-claudecode` (OMC) already runs a multi-persona team mode under
 * `/team`; the bridge `@minsky/omc-tasksmd-bridge` (PR #78) parses the
 * resulting `.omc/state/team/<teamName>/` directory. The Strategy seam
 * means a future native CrewAI / Anthropic-Agent-Teams adapter can land
 * without touching the consumer.
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Adapter + Strategy).
 *   - Wooldridge, M., *An Introduction to MultiAgent Systems*, Wiley,
 *     2009 (role-based agent orchestration — the dispatch table is the
 *     mapping from task type to role).
 *   - Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test
 *     fake).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic
 *     dependency principle — `@minsky/adapter-types` is the leaf;
 *     constructor-injected `spawn` is the I/O seam).
 *   - Hewitt, Bishop, Steiger, "A Universal Modular Actor Formalism for
 *     Artificial Intelligence", *IJCAI* 1973 (each spawned persona is an
 *     actor; the dispatch table is the address resolver).
 */

// Re-export the shared health-probe contract from the leaf types package
// so callers can keep doing `import { type SelfTestResult } from
// "@minsky/persona-spawner"` without an extra dep declaration.
export type { SelfTestResult, SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/**
 * One persona name. Free-form string; consumers decide which personas
 * exist (the dispatch table in `./dispatch.ts` gives the v0 set:
 * `engineer`, `reviewer`, `researcher`). Kept open-ended so the
 * tick-loop daemon can introduce new personas without an interface
 * version bump.
 */
export type PersonaName = string;

/**
 * Options for one spawn call. The caller picks the persona (typically
 * via `dispatchPersona(task.tags)` from `./dispatch.ts`) and supplies a
 * per-task working directory the OMC subprocess will run inside.
 */
export interface PersonaSpawnOpts {
  readonly taskId: string;
  readonly persona: PersonaName;
  readonly workingDir: string;
  /**
   * Optional team name; passed through to OMC so the resulting
   * `.omc/state/team/<teamName>/` is namespaced. Defaults to the task ID
   * in the v0 Strategy.
   */
  readonly teamName?: string;
  /**
   * Optional max wall-clock budget for the spawn, in ms. Strategies may
   * enforce this with a watchdog; v0 OMC Strategy does not (it relies on
   * the daemon's tick-cadence + supervisor restart for liveness — rule
   * #6 let-it-crash). Reserved field for future Strategies.
   */
  readonly timeoutMs?: number;
}

/**
 * Result of one spawn call. `omcStateDir` points at the directory the
 * `@minsky/omc-tasksmd-bridge` reader walks; for non-OMC Strategies, it
 * may be a path to whatever artefact the Strategy produced.
 */
export interface PersonaSpawnResult {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly omcStateDir: string;
}

/**
 * PersonaSpawner adapter interface — Adapter pattern (Gamma et al.,
 * *Design Patterns*, 1994). Strategy implementations live in sibling
 * files (e.g. {@link "./omc".OmcPersonaSpawner}).
 *
 * `selfTest()` follows the {@link SelfTestResult} contract; the doctor
 * surface aggregates across adapters via `aggregateStatus()` from
 * `@minsky/adapter-types`.
 */
export interface PersonaSpawner {
  spawn(opts: PersonaSpawnOpts): Promise<PersonaSpawnResult>;
  selfTest(): Promise<SelfTestResult>;
}

/**
 * One recorded spawn call — the {@link StubPersonaSpawner}'s `.calls`
 * getter exposes a readonly view over an array of these for
 * test-assertion convenience.
 */
export interface RecordedSpawn {
  readonly opts: PersonaSpawnOpts;
}

/**
 * Constructor options for {@link StubPersonaSpawner}.
 */
export interface StubPersonaSpawnerOpts {
  /**
   * Override the canned spawn result. Defaults to
   * `{ exitCode: 0, durationMs: 100, omcStateDir: '/tmp/stub' }` — the
   * brief's pre-registered shape.
   */
  readonly cannedResult?: PersonaSpawnResult;
}

const DEFAULT_STUB_RESULT: PersonaSpawnResult = {
  exitCode: 0,
  durationMs: 100,
  omcStateDir: "/tmp/stub",
};

/**
 * In-memory `PersonaSpawner` for tests. Records every call's opts in
 * order (FIFO — first spawn is `calls[0]`) and returns a fixed canned
 * {@link PersonaSpawnResult}. Pattern: test fake per Meszaros, *xUnit
 * Test Patterns*, 2007.
 *
 * `selfTest()` always returns `green` with `latencyMs: 0` — the stub
 * has no I/O so any other status would be a lie.
 *
 * @example
 *   const stub = new StubPersonaSpawner();
 *   await daemon.run({ spawner: stub });
 *   expect(stub.calls).toHaveLength(1);
 *   expect(stub.calls[0].opts.persona).toBe("engineer");
 */
export class StubPersonaSpawner implements PersonaSpawner {
  private readonly recorded: RecordedSpawn[] = [];
  private readonly cannedResult: PersonaSpawnResult;

  constructor(opts: StubPersonaSpawnerOpts = {}) {
    this.cannedResult = opts.cannedResult ?? DEFAULT_STUB_RESULT;
  }

  /**
   * @otel-exempt test fake — production callers never invoke this; recording is the test's seam, not a span source
   */
  get calls(): readonly RecordedSpawn[] {
    return this.recorded;
  }

  /**
   * @otel-exempt test fake — records in-memory and returns a fixed shape; the caller's span covers it
   */
  async spawn(opts: PersonaSpawnOpts): Promise<PersonaSpawnResult> {
    this.recorded.push({ opts });
    return this.cannedResult;
  }

  /**
   * @otel-exempt test fake — no I/O; the green status is unconditional by design, no value in a span
   */
  async selfTest(): Promise<SelfTestResult> {
    return {
      status: "green",
      message: "StubPersonaSpawner — no I/O; recorded calls available via .calls",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Drop all recorded calls. Useful between test cases when the same
   * fixture is reused.
   *
   * @otel-exempt test fake — purely test-side mutation; spans here would be noise
   */
  reset(): void {
    this.recorded.length = 0;
  }
}

// Re-export the OMC Strategy + dispatch helper from the sibling modules
// so consumers can `import { OmcPersonaSpawner, dispatchPersona } from
// "@minsky/persona-spawner"` without reaching for the subpaths (mirrors
// `@minsky/notifier`'s pattern of re-exporting from `index.ts`).
export {
  OmcPersonaSpawner,
  type OmcPersonaSpawnerOpts,
  type SpawnFn,
  type SpawnedChild,
  OMC_BIN,
} from "./omc.js";

export {
  dispatchPersona,
  DEFAULT_PERSONA,
  PERSONA_DISPATCH_TABLE,
  type DispatchTable,
} from "./dispatch.js";
