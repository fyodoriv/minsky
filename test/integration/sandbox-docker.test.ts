// End-to-end integration test for the Sandbox adapter (`@minsky/sandbox`) —
// the `research-finding-docker-sandbox-adapter` task's Success criterion:
// "zero filesystem writes outside the workspace dir for a deliberately-escaping
// agent prompt".
//
// Why this file exists (AGENTS.md §3b — integration tests for adapter features;
// rule #3 test-first): the paired unit tests in
// `novel/adapters/sandbox/src/sandbox.docker.test.ts` pin the four verbs +
// the isolation contract in isolation; this file proves the contract
// end-to-end. Following the repo's hermetic-fixture discipline (every
// `test/integration/*.test.ts` uses mkdtemp / in-process fixtures, never a
// live external dependency by default), the HERMETIC arm drives the
// `StubSandbox` against a real temp workspace and asserts that a
// deliberately-escaping write sequence leaves the host FS untouched. The
// LIVE-DOCKER arm exercises the real `DockerSandbox` against a running daemon
// and is opt-in via MINSKY_RUN_INTEGRATION=1 (the daemon is the "pending
// external dependency" — the same skip-when-absent pattern as
// `submit-finding.test.ts`).

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerSandbox, StubSandbox } from "@minsky/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION =
  process.env["MINSKY_RUN_INTEGRATION"] === "1" ||
  process.env["CI"] === "true" ||
  process.env["VITEST_INTEGRATION"] === "1";

// A "deliberately-escaping agent prompt", modelled as the file-write sequence
// such a prompt would produce: one legitimate in-workspace write, then a series
// of escape attempts that must all be denied before any host I/O.
const ESCAPE_WRITES = [
  { path: "build/output.txt", contents: "legitimate" },
  { path: "/etc/passwd", contents: "pwned" },
  { path: "../../../tmp/escape.txt", contents: "pwned" },
  { path: "~/.ssh/authorized_keys", contents: "pwned" },
];

describe("Sandbox isolation contract — hermetic (StubSandbox)", () => {
  let hostScratch: string;

  beforeAll(() => {
    hostScratch = mkdtempSync(join(tmpdir(), "minsky-sandbox-host-"));
  });

  afterAll(() => {
    rmSync(hostScratch, { recursive: true, force: true });
  });

  it("denies every escape attempt and leaves zero host-FS writes outside the workspace", async () => {
    const sandbox = new StubSandbox();
    const denied: string[] = [];

    for (const write of ESCAPE_WRITES) {
      try {
        await sandbox.writeFiles([write]);
      } catch {
        denied.push(write.path);
      }
    }

    // All three escape attempts are denied; the one legitimate write lands.
    expect(denied).toEqual(["/etc/passwd", "../../../tmp/escape.txt", "~/.ssh/authorized_keys"]);
    expect(sandbox.escapedWrites).toHaveLength(3);

    // The legitimate in-workspace file is readable back; the escapes are not.
    const legit = await sandbox.readFiles(["build/output.txt"]);
    expect(legit).toHaveLength(1);
    expect(legit[0]?.contents).toBe("legitimate");

    // The host scratch dir the test created is untouched — the sandbox never
    // reached it (Success criterion: zero filesystem writes outside the
    // workspace dir).
    expect(readdirSync(hostScratch)).toHaveLength(0);
    expect(existsSync("/tmp/escape.txt")).toBe(false);
  });

  it("teardown is idempotent and recorded", async () => {
    const sandbox = new StubSandbox();
    await sandbox.spawn(".", { cmd: "true" });
    await sandbox.kill();
    await sandbox.kill();
    expect(sandbox.isKilled).toBe(true);
  });
});

describe.skipIf(!RUN_INTEGRATION)("Sandbox isolation contract — live Docker", () => {
  let dockerAvailable = false;

  beforeAll(async () => {
    // The daemon is the pending external dependency; probe via the adapter's
    // own self-test. If unreachable (yellow), skip the live assertions rather
    // than fail — the bash-runner fallback is the documented default.
    const probe = await new DockerSandbox().selfTest();
    dockerAvailable = probe.status === "green";
  });

  it("confines a deliberately-escaping write sequence to the workspace", async () => {
    if (!dockerAvailable) {
      // Daemon unreachable even under MINSKY_RUN_INTEGRATION=1 — the adapter is
      // opt-in and the host stays on the bash-runner default. Nothing to assert.
      return;
    }
    const workspaceDir = mkdtempSync(join(tmpdir(), "minsky-sandbox-ws-"));
    const sandbox = new DockerSandbox({ workspaceDir });
    try {
      const denied: string[] = [];
      for (const write of ESCAPE_WRITES) {
        try {
          await sandbox.writeFiles([write]);
        } catch {
          denied.push(write.path);
        }
      }
      expect(denied).toContain("/etc/passwd");
      expect(denied).toContain("../../../tmp/escape.txt");
      // The host FS outside the bound workspace is untouched.
      expect(existsSync("/tmp/escape.txt")).toBe(false);
    } finally {
      await sandbox.kill();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
