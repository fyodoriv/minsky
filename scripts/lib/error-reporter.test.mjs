// @ts-check
// Deterministic tests for the ErrorReporter adapter (task
// `obs-error-capture-and-reporter`). No network: the Sentry strategy is
// exercised only for its dep-missing fallback path.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyError,
  createErrorReporter,
  FileErrorReporter,
  redact,
  SentryErrorReporter,
  selfTestFileReporter,
  toErrorRecord,
} from "./error-reporter.mjs";

describe("classifyError", () => {
  it("maps known signatures to a class", () => {
    expect(classifyError("spawn ENOENT")).toBe("spawn-failed");
    expect(classifyError("biome lint failed")).toBe("lint-failed");
    expect(classifyError("operation timed out")).toBe("timeout");
    expect(classifyError("PR not mergeable: gate")).toBe("gate-failed");
    expect(classifyError("Uncaught fatal")).toBe("crash");
  });
  it("defaults to unknown rather than guessing", () => {
    expect(classifyError("something odd happened")).toBe("unknown");
  });
});

describe("redact", () => {
  it("strips tokens, keys, and DSNs", () => {
    expect(redact(`ghp_${"a".repeat(36)}`)).toBe("[redacted-gh-token]");
    expect(redact("SENTRY_DSN=https://abc@o1.ingest.sentry.io/1")).toContain("[redacted]");
    expect(redact(`key sk-${"b".repeat(32)}`)).toContain("[redacted-key]");
  });
});

describe("toErrorRecord", () => {
  it("normalizes + classifies + redacts in one shot", () => {
    const rec = toErrorRecord({
      ts: "2026-06-03T00:00:00Z",
      runId: "R1",
      taskId: "t-9",
      message: `spawn ENOENT (token ghp_${"c".repeat(36)})`,
      exitCode: 1,
    });
    expect(rec.class).toBe("spawn-failed");
    expect(rec.message).toContain("[redacted-gh-token]");
    expect(rec.runId).toBe("R1");
    expect(rec.exitCode).toBe(1);
  });
});

describe("FileErrorReporter", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "errrep-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends one JSON line per error, untruncated", async () => {
    const file = join(dir, "errors.jsonl");
    const r = FileErrorReporter(file);
    const long = "x".repeat(5000);
    await r.report(toErrorRecord({ ts: "2026-06-03T00:00:00Z", message: `crash ${long}` }));
    await r.report(toErrorRecord({ ts: "2026-06-03T00:01:00Z", message: "spawn ENOENT" }));
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(String(lines[0])).message.length).toBeGreaterThan(5000); // not truncated
    expect(JSON.parse(String(lines[1])).class).toBe("spawn-failed");
  });
});

describe("createErrorReporter", () => {
  it("uses the file strategy with no DSN, sentry with one", () => {
    expect(createErrorReporter({ errorsFile: "/tmp/x.jsonl" }).kind).toBe("file");
    expect(
      createErrorReporter({ dsn: "https://k@sentry.io/1", errorsFile: "/tmp/x.jsonl" }).kind,
    ).toBe("sentry");
  });
});

describe("SentryErrorReporter", () => {
  it("falls back to the file strategy when @sentry/node is absent (never throws)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "errrep-sentry-"));
    try {
      const file = join(dir, "errors.jsonl");
      const reporter = SentryErrorReporter("https://k@sentry.io/1", FileErrorReporter(file));
      const res = await reporter.report(
        toErrorRecord({ ts: "2026-06-03T00:00:00Z", message: "crash" }),
      );
      expect(res.ok).toBe(true); // fell back to file
      expect(readFileSync(file, "utf8")).toContain("crash");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("selfTestFileReporter", () => {
  it("round-trips a probe error", async () => {
    expect(await selfTestFileReporter()).toBe(true);
  });
});
