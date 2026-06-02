// Paired tests for the Sandbox adapter (rule #3 test-first; rule #7 chaos row
// in the package README). Covers the StubSandbox fake's isolation contract +
// record/return behavior, and the DockerSandbox Strategy's four verbs driven
// against an injected fake `docker` runner (no live daemon), plus the
// yellow self-test verdict when the daemon is unavailable.
// Pattern: parametric paired fixtures per Meszaros, *xUnit Test Patterns*, 2007.

import { describe, expect, it } from "vitest";
import { type DockerRunner, DockerSandbox, type SandboxFile, StubSandbox } from "./index.js";

describe("StubSandbox (test fake)", () => {
  it("confines writes to the workspace and reads them back", async () => {
    const sandbox = new StubSandbox();
    await sandbox.writeFiles([{ path: "src/a.txt", contents: "hello" }]);
    const files = await sandbox.readFiles(["src/a.txt"]);
    expect(files).toHaveLength(1);
    expect(files[0]?.contents).toBe("hello");
  });

  it("rejects an absolute escape path and records it", async () => {
    const sandbox = new StubSandbox();
    await expect(sandbox.writeFiles([{ path: "/etc/passwd", contents: "x" }])).rejects.toThrow(
      /escape/,
    );
    expect(sandbox.escapedWrites).toContain("/etc/passwd");
  });

  it("rejects a `..` traversal path", async () => {
    const sandbox = new StubSandbox();
    await expect(sandbox.writeFiles([{ path: "../outside.txt", contents: "x" }])).rejects.toThrow(
      /traversal/,
    );
  });

  it("records each call in FIFO order with its args", async () => {
    const sandbox = new StubSandbox();
    await sandbox.spawn(".", { cmd: "echo", args: ["hi"] });
    await sandbox.kill();
    expect(sandbox.calls).toHaveLength(2);
    expect(sandbox.calls[0]?.method).toBe("spawn");
    expect(sandbox.calls[1]?.method).toBe("kill");
    expect(sandbox.isKilled).toBe(true);
  });

  it("selfTest is unconditionally green (no I/O)", async () => {
    const result = await new StubSandbox().selfTest();
    expect(result.status).toBe("green");
    expect(result.latencyMs).toBe(0);
  });

  it("reset() drops recorded calls and FS contents", async () => {
    const sandbox = new StubSandbox();
    await sandbox.writeFiles([{ path: "a.txt", contents: "x" }]);
    sandbox.reset();
    expect(sandbox.calls).toHaveLength(0);
    expect(await sandbox.readFiles(["a.txt"])).toHaveLength(0);
  });
});

/** A fake `docker` runner that records argv and returns scripted results. */
function fakeRunner(
  responses: Record<string, { exitCode: number; stdout?: string; stderr?: string }> = {},
): { runner: DockerRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: DockerRunner = async (args) => {
    calls.push([...args]);
    const verb = args[0] ?? "";
    const r = responses[verb] ?? { exitCode: 0, stdout: "", stderr: "" };
    return { exitCode: r.exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { runner, calls };
}

describe("DockerSandbox (Strategy — injected fake docker runner)", () => {
  it("spawn lazily starts the container then runs `docker exec`", async () => {
    const { runner, calls } = fakeRunner({ exec: { exitCode: 0, stdout: "ok" } });
    const sandbox = new DockerSandbox({ runner, containerName: "c1", workspaceDir: "/ws" });
    const run = await sandbox.spawn(".", { cmd: "echo", args: ["hi"] });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("ok");
    expect(calls[0]?.[0]).toBe("run");
    expect(calls.some((c) => c[0] === "exec")).toBe(true);
  });

  it("starts the container with preventive-isolation flags", async () => {
    const { runner, calls } = fakeRunner();
    const sandbox = new DockerSandbox({ runner, containerName: "c2", workspaceDir: "/ws" });
    await sandbox.spawn(".", { cmd: "true" });
    const runArgs = calls.find((c) => c[0] === "run") ?? [];
    expect(runArgs).toContain("--network");
    expect(runArgs).toContain("none");
    expect(runArgs).toContain("--read-only");
    expect(runArgs).toContain("--cap-drop");
  });

  it("writeFiles rejects an escape path BEFORE any docker exec", async () => {
    const { runner, calls } = fakeRunner();
    const sandbox = new DockerSandbox({ runner, containerName: "c3" });
    const escapeFile: SandboxFile = { path: "../../etc/passwd", contents: "x" };
    await expect(sandbox.writeFiles([escapeFile])).rejects.toThrow(/traversal/);
    // The only docker call may be the lazy `run`; never an `exec` that wrote.
    expect(calls.every((c) => c[0] !== "exec")).toBe(true);
  });

  it("readFiles returns only files that exist (exit 0)", async () => {
    const { runner } = fakeRunner({ exec: { exitCode: 1, stdout: "" } });
    const sandbox = new DockerSandbox({ runner, containerName: "c4" });
    expect(await sandbox.readFiles(["missing.txt"])).toHaveLength(0);
  });

  it("kill is idempotent (no-op before start, safe twice after)", async () => {
    const { runner, calls } = fakeRunner();
    const sandbox = new DockerSandbox({ runner, containerName: "c5" });
    await sandbox.kill(); // before start → no-op
    expect(calls).toHaveLength(0);
    await sandbox.spawn(".", { cmd: "true" });
    await sandbox.kill();
    await sandbox.kill();
    expect(calls.filter((c) => c[0] === "rm")).toHaveLength(1);
  });

  it("selfTest reports green when the daemon answers `version`", async () => {
    const { runner } = fakeRunner({ version: { exitCode: 0, stdout: "27.0.3\n" } });
    const result = await new DockerSandbox({ runner }).selfTest();
    expect(result.status).toBe("green");
    expect(result.message).toContain("27.0.3");
  });

  it("selfTest reports yellow (never a false green) when the docker binary is missing", async () => {
    const throwingRunner: DockerRunner = async () => {
      throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    };
    const result = await new DockerSandbox({ runner: throwingRunner }).selfTest();
    expect(result.status).toBe("yellow");
    expect(result.message).toMatch(/bash-runner default|daemon/);
  });
});
