/**
 * Process sandbox adapter (Strategy per Gamma et al. 1994) — the DEFAULT
 * sandbox shape, wrapping today's behavior: spawn the agent's command directly
 * in the host process tree, in the host working directory, inheriting the
 * operator's environment unless overridden.
 *
 * This is `bin/minsky`'s pre-extraction behavior expressed behind the
 * {@link SandboxAdapter} interface — no Docker, no remote VM, no isolation
 * boundary. It is the right default (rule #16 — default by default): zero
 * setup, zero per-task container cost, and it is what every existing iteration
 * already does. The Docker Strategy (`research-finding-docker-sandbox-adapter`)
 * and the Remote-VM Strategy (future M4) slot in beside this file.
 *
 * Assumption made explicit (see `index.ts` module header): the Process shape
 * inherits `$HOME` and the operator's `process.env`. {@link SandboxSpec.env}
 * merges OVER that ambient env. A Docker / Remote-VM Strategy will NOT inherit
 * implicitly — that divergence is exactly what extracting the seam surfaces.
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994 (Strategy).
 *   - Bovet & Cesati, *Understanding the Linux Kernel*, 2005 (fork/exec —
 *     the Process shape IS a child of the operator's process tree).
 */

import { spawn } from "node:child_process";
import type { SelfTestResult } from "@minsky/adapter-types";
import type { SandboxAdapter, SandboxResult, SandboxShape, SandboxSpec } from "./index.js";

/** Default hard wall-clock limit when a spec omits `timeoutMs`. */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Process Strategy. See file header — this is the default, today's behavior.
 */
export class ProcessSandboxAdapter implements SandboxAdapter {
  readonly shape: SandboxShape = "process";

  /**
   * Spawn `spec.argv` in `spec.workdir`, capture stdout/stderr, and resolve
   * when the child exits or the timeout fires. Never rejects on a non-zero
   * exit — a failed command is a {@link SandboxResult}, not a thrown error
   * (rule #6: the caller's supervisor decides retry vs escalate). It rejects
   * only when the host cannot spawn at all (e.g. binary not found) — a genuine
   * environment fault the supervisor must see.
   *
   * @otel sandbox.process.run
   */
  run(spec: SandboxSpec): Promise<SandboxResult> {
    const start = Date.now();
    const [cmd, ...args] = spec.argv;
    if (cmd === undefined) {
      return Promise.reject(new Error("ProcessSandboxAdapter.run: empty argv"));
    }
    const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<SandboxResult>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: spec.workdir,
        env: spec.env === undefined ? process.env : { ...process.env, ...spec.env },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // `error` fires when the host cannot spawn (ENOENT, EACCES) — a real
      // environment fault, not a command failure. Surface it (rule #6:
      // let-it-crash; the caller's supervisor restarts).
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          durationMs: Date.now() - start,
          timedOut,
        });
      });
    });
  }

  /**
   * Self-test: spawn a trivial no-op (`true`, the POSIX success builtin) and
   * confirm it exits 0. The Process shape is always available — there is no
   * external daemon to be down — so a healthy host returns `green`. A failure
   * here means the host cannot spawn child processes at all, which is `red`.
   *
   * @otel sandbox.process.self-test
   */
  async selfTest(): Promise<SelfTestResult> {
    const start = Date.now();
    try {
      const result = await this.run({ argv: ["true"], workdir: process.cwd() });
      if (result.exitCode === 0) {
        return {
          status: "green",
          message: "ProcessSandboxAdapter — host can spawn child processes (default sandbox shape)",
          latencyMs: Date.now() - start,
          lastCheck: new Date().toISOString(),
        };
      }
      return {
        status: "yellow",
        message: `ProcessSandboxAdapter — no-op spawn returned exit ${result.exitCode}`,
        latencyMs: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
      // rule-6: handled-locally — selfTest is the supervisor's health probe; it
      // converts a spawn fault into a `red` verdict (the probe's contract)
      // rather than re-throw and take down the doctor aggregation that calls it.
    } catch (error) {
      return {
        status: "red",
        message: `ProcessSandboxAdapter failed self-test: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    }
  }
}
