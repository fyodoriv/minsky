/**
 * Sandbox adapter — the interface (Adapter pattern, Gamma 1994 + Strategy,
 * behavioral) that separates Minsky's *sandbox shape* (where an agent's
 * commands actually execute — host process, Docker container, remote VM) from
 * the *agent loop* (the same brief, the same verbs, regardless of shape).
 *
 * Why a sandbox adapter (rule #2): Minsky's `bin/minsky` runs the agent in the
 * host repo directly today — the Process shape. OpenHands' `app_server/sandbox/`
 * separates Docker / Process / Remote-SSH behind a common abstraction so the
 * same SDK runs in all three; the operator picks the security/cost tradeoff per
 * task. Extracting the seam here (rule #1 — OpenHands already shipped the
 * pattern; we adopt its shape rather than reinvent) lets a later
 * `process-sandbox-adapter` (default, today's behavior), `docker-sandbox-adapter`
 * (the sibling `research-finding-docker-sandbox-adapter` task), and a future
 * Remote-VM Strategy slot in without touching the runner's call sites.
 *
 * The hypothesis this task pre-registers (TASKS.md
 * `research-finding-pluggable-sandbox-layer`): extracting the abstraction
 * surfaces existing assumptions about the agent's execution context that won't
 * hold for non-Process sandboxes. The most load-bearing one — encoded in
 * {@link SandboxSpec.env} and {@link SandboxSpec.workdir} below — is that
 * `$HOME` and the working directory are the *operator's*, not a
 * sandbox-internal path. A Docker or Remote-VM Strategy maps these explicitly;
 * the Process Strategy passes them through. Making the assumption a named field
 * is the value, independent of whether the Docker impl ships.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:               Adapter (structural) + Strategy (behavioral)
 *                                per Gamma, Helm, Johnson, Vlissides, *Design
 *                                Patterns*, 1994. Conformance: full.
 *   - `StubSandbox`:             Test fake / spy hybrid per Meszaros, *xUnit
 *                                Test Patterns*, 2007 — records every spawn
 *                                in-memory and returns a fixed result so tests
 *                                assert request shape without a real process.
 *                                Conformance: full.
 *   - `Sandbox.selfTest`:        Self-checking software / health probe re-using
 *                                {@link SelfTestResult} from
 *                                `@minsky/adapter-types` (leaf package per
 *                                Martin, *Clean Architecture*, 2017 — acyclic
 *                                dependency principle).
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Adapter + Strategy).
 *   - Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test fake).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic dependency
 *     principle — `@minsky/adapter-types` is the leaf).
 *   - OpenHands maintainers, `openhands/app_server/sandbox/` (three shapes
 *     behind one abstraction — the pattern this adapter adopts; rule #1).
 */

// Re-export the shared health-probe contract from the leaf types package so
// callers can keep doing `import { type SelfTestResult } from "@minsky/sandbox"`
// without an extra dep declaration.
export type { SelfTestResult, SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/**
 * The shape of a sandbox — which execution context an agent's commands run in.
 * `"process"` is today's behavior (spawn in the host dir). `"docker"` and
 * `"remote-vm"` are the future Strategy slots tracked in M4.
 */
export type SandboxShape = "process" | "docker" | "remote-vm";

/**
 * A command to run inside a sandbox. Deliberately minimal — `argv` is the
 * tokenised command (no shell string, to dodge quoting/injection surface),
 * `workdir` and `env` make the two assumptions named in the module header
 * explicit so a non-Process Strategy can map them instead of inheriting the
 * operator's ambient context.
 */
export interface SandboxSpec {
  /** Tokenised command + args, e.g. `["git", "status", "--porcelain"]`. */
  readonly argv: readonly string[];
  /**
   * Working directory the command runs in. For the Process shape this is a
   * host path; for Docker / Remote-VM it is a path *inside* the sandbox that
   * the Strategy maps from a host mount. Making it explicit is the assumption
   * surfaced by this extraction (see module header).
   */
  readonly workdir: string;
  /**
   * Environment overrides. For the Process shape these merge over the
   * operator's `process.env`; for Docker / Remote-VM the Strategy decides
   * which host vars (notably `$HOME`) cross the boundary — they do NOT cross
   * implicitly. Optional; omit to inherit the Strategy's default.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Hard wall-clock limit in milliseconds. A Strategy that cannot honor a
   * timeout (none today) must declare so in its docs and `selfTest()`.
   * Optional; omit to use the Strategy's default.
   */
  readonly timeoutMs?: number;
}

/** The result of running a {@link SandboxSpec} to completion. */
export interface SandboxResult {
  /** Process exit code, or `null` if the process was killed by a signal. */
  readonly exitCode: number | null;
  /** The signal that killed the process, if any (e.g. `"SIGTERM"`). */
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Wall-clock duration of the run, in milliseconds. */
  readonly durationMs: number;
  /** `true` iff the run was terminated for exceeding {@link SandboxSpec.timeoutMs}. */
  readonly timedOut: boolean;
}

/**
 * Sandbox adapter interface — Adapter pattern (Gamma et al., *Design
 * Patterns*, 1994). Strategy implementations live in sibling files
 * (e.g. {@link "./process-sandbox-adapter".ProcessSandboxAdapter}).
 *
 * `selfTest()` follows the {@link SelfTestResult} contract; the `minsky
 * doctor` aggregation runs each adapter's `selfTest()` via
 * `aggregateStatus()` from `@minsky/adapter-types`.
 */
export interface SandboxAdapter {
  /** Which execution context this Strategy runs commands in. */
  readonly shape: SandboxShape;

  /**
   * Run a command to completion inside the sandbox.
   * @param spec - the command, working dir, env, and timeout
   * @returns the exit code, captured streams, and timing
   */
  run(spec: SandboxSpec): Promise<SandboxResult>;

  /**
   * Perform a self-test of the sandbox adapter.
   * @returns Self test result for the `doctor` aggregation
   */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * In-memory `SandboxAdapter` for tests. Records every `run()` spec in order
 * (FIFO — first call is `calls[0]`) and returns a fixed, configurable result.
 * Pattern: test fake per Meszaros, *xUnit Test Patterns*, 2007.
 *
 * `selfTest()` always returns `green` with `latencyMs: 0` — the stub has no
 * I/O so any other status would be a lie.
 *
 * @example
 *   const stub = new StubSandbox();
 *   await runner.run({ sandbox: stub });
 *   expect(stub.calls[0]?.argv).toEqual(["git", "status"]);
 */
export class StubSandbox implements SandboxAdapter {
  readonly shape: SandboxShape = "process";

  private readonly recorded: SandboxSpec[] = [];

  /**
   * The result every `run()` returns. Override in the constructor to drive a
   * specific exit code / output in a test.
   */
  private readonly fixedResult: SandboxResult;

  constructor(fixedResult?: Partial<SandboxResult>) {
    this.fixedResult = {
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      timedOut: false,
      ...fixedResult,
    };
  }

  /**
   * @otel-exempt test fake — production callers never invoke this; recording is the test's seam, not a span source
   */
  get calls(): readonly SandboxSpec[] {
    return this.recorded;
  }

  /**
   * @otel-exempt test fake — records in-memory and returns the fixed shape; the caller's span covers it
   */
  async run(spec: SandboxSpec): Promise<SandboxResult> {
    this.recorded.push(spec);
    return this.fixedResult;
  }

  /**
   * @otel-exempt test fake — no I/O; the green status is unconditional by design, no value in a span
   */
  async selfTest(): Promise<SelfTestResult> {
    return {
      status: "green",
      message: "StubSandbox — no I/O; recorded specs available via .calls",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Drop all recorded specs. Useful between test cases when the same fixture
   * is reused.
   *
   * @otel-exempt test fake — purely test-side mutation; spans here would be noise
   */
  reset(): void {
    this.recorded.length = 0;
  }
}

// Re-export the Process Strategy (today's behavior — the default) from the
// sibling module so consumers can `import { ProcessSandboxAdapter } from
// "@minsky/sandbox"` without reaching for the `/process-sandbox-adapter`
// subpath (mirrors `@minsky/a2a`'s pattern of re-exporting the Strategy from
// `index.ts`).
export { ProcessSandboxAdapter } from "./process-sandbox-adapter.js";
