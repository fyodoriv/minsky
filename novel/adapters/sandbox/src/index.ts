/**
 * Sandbox adapter — interface (Adapter pattern, Gamma 1994) + a
 * `StubSandbox` test fake (Meszaros 2007) + a `DockerSandbox` implementation
 * (sibling file `./sandbox.docker.ts`).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral)
 *                            per Gamma, Helm, Johnson, Vlissides,
 *                            *Design Patterns*, 1994. Conformance: full.
 *   - `StubSandbox`:         Test fake / spy hybrid per Meszaros, *xUnit
 *                            Test Patterns*, 2007 — runs commands against an
 *                            in-memory virtual filesystem so tests can assert
 *                            isolation behavior without a Docker daemon.
 *                            Conformance: full.
 *   - `DockerSandbox.selfTest`:  Health-probe shape — re-uses
 *                            {@link SelfTestResult} from `@minsky/adapter-types`
 *                            (leaf package per Martin, *Clean Architecture*,
 *                            2017 — acyclic dependency principle).
 *
 * Why a Sandbox adapter (rule #2): Minsky's untrusted-task path needs
 * *preventive* isolation (the agent cannot escape the container) to complement
 * the existing *detective* scope-leak detector (which catches leaks after they
 * happen). OpenHands ships this shape in `openhands/app_server/sandbox/`
 * (`docker_sandbox_service.py` / `process_sandbox_service.py` /
 * `remote_sandbox_service.py`); rule #1 says adopt the published shape, don't
 * reinvent. The adapter exposes 4 verbs to Minsky's substrate:
 * `spawn(cwd, cmd) → SandboxRun`, `readFiles(paths) → SandboxFile[]`,
 * `writeFiles(files) → void`, `kill() → void`. Off by default — opt-in via
 * `untrusted: true` in a host repo's `.minsky/repo.yaml`; operators on
 * locked-down corporate machines stay with the bash-runner default.
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Adapter + Strategy).
 *   - Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test fake).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic
 *     dependency principle — `@minsky/adapter-types` is the leaf).
 *   - All-Hands AI, *OpenHands architecture*, `openhands/app_server/sandbox/`
 *     (the pluggable-sandbox-service shape this adapter mirrors).
 *   - OWASP, *Top 10 for LLM Applications*, LLM02 (untrusted-input handling —
 *     preventive isolation is the higher-bar containment).
 */

// Re-export the shared health-probe contract from the leaf types package so
// callers can keep doing `import { type SelfTestResult } from "@minsky/sandbox"`
// without an extra dep declaration.
export type { SelfTestResult, SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/**
 * A command to run inside the sandbox.
 */
export interface SandboxCommand {
  /** The executable to run (e.g. `"bash"`, `"node"`). */
  readonly cmd: string;
  /** Arguments passed to the executable. */
  readonly args?: readonly string[];
  /** Environment variables visible inside the sandbox. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The result of running a command inside the sandbox.
 */
export interface SandboxRun {
  /** Process exit code (0 = success). */
  readonly exitCode: number;
  /** Captured standard output. */
  readonly stdout: string;
  /** Captured standard error. */
  readonly stderr: string;
}

/**
 * A file inside the sandbox — a workspace-relative path plus its contents.
 */
export interface SandboxFile {
  /** Workspace-relative POSIX path (no leading `/`, no `..` traversal). */
  readonly path: string;
  /** UTF-8 file contents. */
  readonly contents: string;
}

/**
 * Sandbox adapter interface — Adapter pattern (Gamma et al., *Design
 * Patterns*, 1994). Strategy implementations live in sibling files
 * (e.g. {@link "./sandbox.docker".DockerSandbox}).
 *
 * Mirrors OpenHands' sandbox-service shape (`spawn` / `readFiles` /
 * `writeFiles` / `kill`). The contract is: every filesystem effect is confined
 * to the workspace dir; an escape attempt (write outside the workspace, read a
 * host path) is denied, not silently allowed.
 *
 * `selfTest()` follows the {@link SelfTestResult} contract; the `minsky
 * doctor` aggregation runs each adapter's `selfTest()` via
 * `aggregateStatus()` from `@minsky/adapter-types`.
 */
export interface SandboxAdapter {
  /**
   * Run a command inside the sandbox, rooted at `cwd` (workspace-relative).
   * @param cwd - Workspace-relative working directory for the command.
   * @param command - The command to run.
   * @returns The run result (exit code + captured output).
   */
  spawn(cwd: string, command: SandboxCommand): Promise<SandboxRun>;

  /**
   * Read files from inside the sandbox workspace.
   * @param paths - Workspace-relative paths to read.
   * @returns The files that exist (missing paths are omitted).
   */
  readFiles(paths: readonly string[]): Promise<SandboxFile[]>;

  /**
   * Write files into the sandbox workspace. A path that escapes the workspace
   * (absolute, or containing `..`) is rejected — the adapter throws rather
   * than writing to the host (rule #6: let it crash, the caller decides).
   * @param files - The files to write.
   */
  writeFiles(files: readonly SandboxFile[]): Promise<void>;

  /**
   * Tear down the sandbox (kill the container / process, release resources).
   * Idempotent — calling `kill()` twice is a no-op (rule #6).
   */
  kill(): Promise<void>;

  /**
   * Perform a self-test of the sandbox adapter.
   * @returns Self test result.
   */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * Reject a workspace path that would escape the sandbox. Absolute paths and
 * any path containing a `..` segment are denied. Shared by `StubSandbox` and
 * `DockerSandbox` so the isolation contract is enforced in one place.
 *
 * @otel-exempt pure path-validation helper — no I/O; the calling verb's span covers it
 * @param path - The workspace-relative path to validate.
 * @returns The normalized path when safe.
 * @throws Error when the path escapes the workspace.
 */
export function assertInsideWorkspace(path: string): string {
  if (path.startsWith("/") || path.startsWith("~")) {
    throw new Error(`sandbox: refusing absolute path '${path}' (would escape workspace)`);
  }
  if (path.split("/").some((seg) => seg === "..")) {
    throw new Error(`sandbox: refusing traversal path '${path}' (would escape workspace)`);
  }
  return path.replace(/^\.\//, "");
}

/**
 * In-memory `SandboxAdapter` for tests. Backs the workspace with a `Map`
 * (path → contents) so the isolation contract — every write confined to the
 * workspace, every escape attempt denied — can be asserted without a Docker
 * daemon. Records every call's payload in order (FIFO — first call is
 * `calls[0]`).
 *
 * Pattern: test fake per Meszaros, *xUnit Test Patterns*, 2007.
 *
 * `selfTest()` always returns `green` with `latencyMs: 0` — the fake has no
 * I/O so any other status would be a lie.
 *
 * @example
 *   const sandbox = new StubSandbox();
 *   await sandbox.writeFiles([{ path: "a.txt", contents: "hi" }]);
 *   await expect(sandbox.writeFiles([{ path: "/etc/passwd", contents: "x" }]))
 *     .rejects.toThrow(/escape/);
 */
export class StubSandbox implements SandboxAdapter {
  private readonly fs = new Map<string, string>();
  private readonly recorded: { method: string; args: unknown[] }[] = [];
  private killed = false;

  /**
   * @otel-exempt test fake — production callers never invoke this; recording is the test's seam, not a span source
   */
  get calls(): readonly { method: string; args: unknown[] }[] {
    return this.recorded;
  }

  /**
   * Workspace-relative paths that escaped the sandbox during this session.
   * The contract is that this stays empty — `writeFiles` throws before a path
   * could land here. Exposed so the integration test can assert "zero
   * filesystem writes outside the workspace dir".
   *
   * @otel-exempt test fake — the escape ledger is the test's assertion seam, not a span source
   */
  get escapedWrites(): readonly string[] {
    return this.recordedEscapes;
  }
  private readonly recordedEscapes: string[] = [];

  /**
   * @otel-exempt test fake — runs against the in-memory FS; the caller's span covers it
   */
  async spawn(cwd: string, command: SandboxCommand): Promise<SandboxRun> {
    this.recorded.push({ method: "spawn", args: [cwd, command] });
    assertInsideWorkspace(cwd === "" ? "." : cwd);
    // The fake does not execute arbitrary binaries; it returns a deterministic
    // success so callers can drive the verb sequence. Real execution is the
    // DockerSandbox's job.
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  /**
   * @otel-exempt test fake — reads the in-memory FS; the caller's span covers it
   */
  async readFiles(paths: readonly string[]): Promise<SandboxFile[]> {
    this.recorded.push({ method: "readFiles", args: [paths] });
    const out: SandboxFile[] = [];
    for (const p of paths) {
      const norm = assertInsideWorkspace(p);
      const contents = this.fs.get(norm);
      if (contents !== undefined) out.push({ path: norm, contents });
    }
    return out;
  }

  /**
   * @otel-exempt test fake — writes the in-memory FS; the caller's span covers it
   */
  async writeFiles(files: readonly SandboxFile[]): Promise<void> {
    this.recorded.push({ method: "writeFiles", args: [files] });
    for (const f of files) {
      let norm: string;
      try {
        norm = assertInsideWorkspace(f.path);
        // rule-6: handled-locally — an escape attempt is a fault the caller
        // must see; we record it for the test assertion and re-throw so the
        // supervisor (not this fake) decides retry vs escalate.
      } catch (error) {
        this.recordedEscapes.push(f.path);
        throw error;
      }
      this.fs.set(norm, f.contents);
    }
  }

  /**
   * @otel-exempt test fake — idempotent flag flip; spans here would be noise
   */
  async kill(): Promise<void> {
    this.recorded.push({ method: "kill", args: [] });
    this.killed = true;
  }

  /**
   * @otel-exempt test fake — no I/O; the green status is unconditional by design, no value in a span
   */
  async selfTest(): Promise<SelfTestResult> {
    return {
      status: "green",
      message: `StubSandbox — in-memory FS (${this.fs.size} files); recorded calls available via .calls`,
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Whether `kill()` has been called. Useful for asserting teardown.
   *
   * @otel-exempt test fake — read of test-side state; spans here would be noise
   */
  get isKilled(): boolean {
    return this.killed;
  }

  /**
   * Drop all recorded calls and FS contents. Useful between test cases when
   * the same fixture is reused.
   *
   * @otel-exempt test fake — purely test-side mutation; spans here would be noise
   */
  reset(): void {
    this.recorded.length = 0;
    this.recordedEscapes.length = 0;
    this.fs.clear();
    this.killed = false;
  }
}

// Re-export the Docker Strategy + its public types from the sibling module so
// consumers can `import { DockerSandbox } from "@minsky/sandbox"` without
// reaching for the `/sandbox.docker` subpath (mirrors `@minsky/a2a`'s pattern
// of re-exporting the Strategy from `index.ts`).
export {
  type DockerRunner,
  type DockerRunResult,
  DockerSandbox,
  type DockerSandboxOptions,
  defaultDockerRunner,
} from "./sandbox.docker.js";
