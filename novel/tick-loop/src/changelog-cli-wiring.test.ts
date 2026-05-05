import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileBackedChangelogReader } from "./changelog-cli-wiring.js";

describe("createFileBackedChangelogReader", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "changelog-reader-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the file contents when CHANGELOG.md is present", async () => {
    const path = resolve(dir, "CHANGELOG.md");
    writeFileSync(path, "## 2026-05-05\n\n- shipped X\n", "utf-8");
    const read = createFileBackedChangelogReader(path);
    expect(await read()).toBe("## 2026-05-05\n\n- shipped X\n");
  });

  it("returns an empty string when CHANGELOG.md is missing (ENOENT graceful-degrade)", async () => {
    const path = resolve(dir, "does-not-exist", "CHANGELOG.md");
    const read = createFileBackedChangelogReader(path);
    expect(await read()).toBe("");
  });

  it("returns an empty string for an unwritten CHANGELOG.md (the genesis-entry case)", async () => {
    // The runner's contract (`changelog-runner.ts` JSDoc) is "Returning `""`
    // for missing-file is intentional — a fresh checkout pre-genesis should
    // still fire (the runner authors the genesis entry)."
    const path = resolve(dir, "CHANGELOG.md");
    const read = createFileBackedChangelogReader(path);
    const content = await read();
    // shouldRunChangelog must see this as "no date section" → fire.
    expect(content).toBe("");
    expect(/^##\s+\d{4}-\d{2}-\d{2}\s*$/m.test(content)).toBe(false);
  });

  it("preserves newline shape so hasDateSection's anchored regex matches", async () => {
    // The gate's regex (`changelog-runner.ts` `DATE_HEADER_RE_FOR`) anchors
    // on `^##\s+<date>\s*$` with the `m` flag — needs the H2 to start at
    // line-begin. The reader must not strip leading newlines.
    const path = resolve(dir, "CHANGELOG.md");
    writeFileSync(path, "header text\n\n## 2026-05-05\n\nbody\n", "utf-8");
    const read = createFileBackedChangelogReader(path);
    expect(await read()).toContain("\n## 2026-05-05\n");
  });

  it("propagates non-ENOENT read errors (let-it-crash at the supervisor boundary)", async () => {
    // Pointing at a directory yields EISDIR, not ENOENT — must propagate.
    const read = createFileBackedChangelogReader(dir);
    await expect(read()).rejects.toThrow();
  });

  it("captures the path at construction time so the daemon can call it every tick", async () => {
    const path = resolve(dir, "CHANGELOG.md");
    writeFileSync(path, "first\n", "utf-8");
    const read = createFileBackedChangelogReader(path);
    expect(await read()).toBe("first\n");
    // Mutating the file out-of-band is observed on subsequent calls (no
    // caching) — the per-day idempotency lives in the gate, not here.
    writeFileSync(path, "second\n", "utf-8");
    expect(await read()).toBe("second\n");
  });

  it("surfaces EACCES (or analogous permission errors) rather than swallowing them", async () => {
    // Skip when running as root (CI containers sometimes do); chmod is a no-op.
    if (process.getuid?.() === 0) return;
    const path = resolve(dir, "CHANGELOG.md");
    writeFileSync(path, "## 2026-05-05\n", "utf-8");
    chmodSync(path, 0o000);
    const read = createFileBackedChangelogReader(path);
    try {
      await expect(read()).rejects.toThrow();
    } finally {
      chmodSync(path, 0o644);
    }
  });
});
