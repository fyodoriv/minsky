import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CLAUDE_BIN,
  DEFAULT_PROBE_TIMEOUT_MS,
  type VersionProbeExec,
  probeClaudeVersion,
} from "./probe-claude-version.js";

describe("probeClaudeVersion", () => {
  it("returns trimmed stdout on a healthy exec", async () => {
    const exec: VersionProbeExec = vi.fn(async () => ({
      stdout: "2.1.40 (Claude Code)\n",
    }));

    const result = await probeClaudeVersion({ exec });

    expect(result).toBe("2.1.40 (Claude Code)");
  });

  it("calls the exec adapter with default bin + default timeout", async () => {
    const exec = vi.fn(async () => ({ stdout: "v2.1.32\n" }));

    await probeClaudeVersion({ exec });

    expect(exec).toHaveBeenCalledWith(DEFAULT_CLAUDE_BIN, ["--version"], {
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
    });
  });

  it("honors a custom claudeBin path", async () => {
    const exec = vi.fn(async () => ({ stdout: "2.1.50\n" }));

    await probeClaudeVersion({
      exec,
      claudeBin: "/opt/homebrew/bin/claude",
    });

    expect(exec).toHaveBeenCalledWith("/opt/homebrew/bin/claude", ["--version"], {
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
    });
  });

  it("honors a custom timeoutMs", async () => {
    const exec = vi.fn(async () => ({ stdout: "2.1.32\n" }));

    await probeClaudeVersion({ exec, timeoutMs: 500 });

    expect(exec).toHaveBeenCalledWith(DEFAULT_CLAUDE_BIN, ["--version"], {
      timeout: 500,
    });
  });

  it("returns null when stdout is empty", async () => {
    const exec: VersionProbeExec = async () => ({ stdout: "" });

    expect(await probeClaudeVersion({ exec })).toBe(null);
  });

  it("returns null when stdout is whitespace-only", async () => {
    const exec: VersionProbeExec = async () => ({ stdout: "  \n\t\n  " });

    expect(await probeClaudeVersion({ exec })).toBe(null);
  });

  it("returns null when exec throws ENOENT (claude binary missing)", async () => {
    const exec: VersionProbeExec = () => Promise.reject(new Error("ENOENT: command not found"));

    expect(await probeClaudeVersion({ exec })).toBe(null);
  });

  it("returns null when exec throws a timeout error", async () => {
    const exec: VersionProbeExec = () => {
      const err = new Error("Command timed out") as Error & { code?: string };
      err.code = "ETIMEDOUT";
      return Promise.reject(err);
    };

    expect(await probeClaudeVersion({ exec })).toBe(null);
  });

  it("returns null when exec throws a non-zero exit status", async () => {
    const exec: VersionProbeExec = () =>
      Promise.reject(new Error("Command failed with exit code 1"));

    expect(await probeClaudeVersion({ exec })).toBe(null);
  });

  it("trims surrounding whitespace from a version like ' v2.1.32 '", async () => {
    const exec: VersionProbeExec = async () => ({ stdout: "  v2.1.32  \n" });

    expect(await probeClaudeVersion({ exec })).toBe("v2.1.32");
  });

  it("never throws — every failure path resolves to null", async () => {
    const exec: VersionProbeExec = () =>
      Promise.reject(new TypeError("unexpected adapter contract violation"));

    await expect(probeClaudeVersion({ exec })).resolves.toBe(null);
  });

  it("DEFAULT_PROBE_TIMEOUT_MS is 2 seconds (bounded for boot-time safety)", () => {
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(2_000);
  });
});
