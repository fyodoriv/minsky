// Paired tests for the sandbox adapter (rule #3 test-first; rule #7 chaos rows
// in the package README). Covers the StubSandbox fake's record/return contract
// and the ProcessSandboxAdapter Strategy's run/selfTest behavior — the default
// (Process) sandbox shape.
// Pattern: parametric paired fixtures per Meszaros, *xUnit Test Patterns*, 2007.

import { describe, expect, it } from "vitest";
import { ProcessSandboxAdapter, type SandboxSpec, StubSandbox } from "./index.js";

describe("StubSandbox (test fake)", () => {
  it("records each run spec in FIFO order", async () => {
    const stub = new StubSandbox();
    const a: SandboxSpec = { argv: ["git", "status"], workdir: "/repo" };
    const b: SandboxSpec = { argv: ["ls"], workdir: "/tmp" };
    await stub.run(a);
    await stub.run(b);
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.argv).toEqual(["git", "status"]);
    expect(stub.calls[1]?.workdir).toBe("/tmp");
  });

  it("returns the configured fixed result", async () => {
    const stub = new StubSandbox({ exitCode: 3, stderr: "boom" });
    const result = await stub.run({ argv: ["x"], workdir: "/" });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("boom");
  });

  it("selfTest is unconditionally green (no I/O)", async () => {
    const result = await new StubSandbox().selfTest();
    expect(result.status).toBe("green");
    expect(result.latencyMs).toBe(0);
  });

  it("reset() drops recorded specs", async () => {
    const stub = new StubSandbox();
    await stub.run({ argv: ["a"], workdir: "/" });
    expect(stub.calls).toHaveLength(1);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
  });
});

describe("ProcessSandboxAdapter (default — today's behavior)", () => {
  const sandbox = new ProcessSandboxAdapter();

  it("declares the process shape", () => {
    expect(sandbox.shape).toBe("process");
  });

  it("runs a command and captures stdout + exit code", async () => {
    const result = await sandbox.run({ argv: ["echo", "hello"], workdir: process.cwd() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  });

  it("returns a non-zero exit code as a result, not a thrown error", async () => {
    const result = await sandbox.run({ argv: ["false"], workdir: process.cwd() });
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the host cannot spawn (binary not found)", async () => {
    await expect(
      sandbox.run({ argv: ["definitely-not-a-real-binary-xyzzy"], workdir: process.cwd() }),
    ).rejects.toThrow();
  });

  it("rejects empty argv", async () => {
    await expect(sandbox.run({ argv: [], workdir: process.cwd() })).rejects.toThrow(/empty argv/);
  });

  it("merges spec.env over the ambient env", async () => {
    const result = await sandbox.run({
      argv: ["printenv", "MINSKY_SANDBOX_TEST"],
      workdir: process.cwd(),
      env: { MINSKY_SANDBOX_TEST: "set-by-spec" },
    });
    expect(result.stdout.trim()).toBe("set-by-spec");
  });

  it("times out a long-running command and marks timedOut", async () => {
    const result = await sandbox.run({
      argv: ["sleep", "5"],
      workdir: process.cwd(),
      timeoutMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGTERM");
  });

  it("selfTest reports green on a host that can spawn", async () => {
    const result = await sandbox.selfTest();
    expect(result.status).toBe("green");
    expect(result.message).toContain("spawn");
  });
});
