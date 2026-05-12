// Paired tests for `ignore-write.ts` — chaos row 5 (read-only global ignore →
// per-clone exclude fallback) coverage. Pure unit tests; the `writeFn` seam
// is an in-memory fake.
//
// Pattern: paired unit test (rule #3 — test-first). Source: TASKS.md
//   `cross-repo-runner-v1-live-spawn` (d); chaos row 5 of
//   `novel/sidecar-bootstrap/README.md`.

import { describe, expect, test } from "vitest";

import { classifyWriteError, decideIgnoreAppend, renderIgnorePayload } from "./ignore-write.js";

const GLOBAL = "/fake/home/.config/git/ignore";
const CLONE = "/fake/host/.git/info/exclude";

function staticWriter(
  perPath: Record<string, "ok" | "eacces" | "other">,
): (path: string, payload: string) => "ok" | "eacces" | "other" {
  return (path) => perPath[path] ?? "other";
}

describe("decideIgnoreAppend — happy path", () => {
  test("wrote-global when the global write succeeds", () => {
    const result = decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: staticWriter({ [GLOBAL]: "ok" }),
    });
    expect(result.kind).toBe("wrote-global");
    if (result.kind === "wrote-global") expect(result.path).toBe(GLOBAL);
  });

  test("never attempts per-clone when global succeeds", () => {
    const calls: string[] = [];
    const writer = (path: string) => {
      calls.push(path);
      return "ok" as const;
    };
    decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: writer,
    });
    expect(calls).toEqual([GLOBAL]);
  });
});

describe("decideIgnoreAppend — chaos row 5 fallback (EACCES on global)", () => {
  test("wrote-per-clone when global EACCES + clone OK", () => {
    const result = decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: staticWriter({ [GLOBAL]: "eacces", [CLONE]: "ok" }),
    });
    expect(result.kind).toBe("wrote-per-clone");
    if (result.kind === "wrote-per-clone") {
      expect(result.path).toBe(CLONE);
      expect(result.reason).toBe("global-readonly");
    }
  });

  test("error when both global EACCES AND clone EACCES", () => {
    const result = decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: staticWriter({ [GLOBAL]: "eacces", [CLONE]: "eacces" }),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.tried).toHaveLength(2);
      expect(result.tried[0]?.path).toBe(GLOBAL);
      expect(result.tried[1]?.path).toBe(CLONE);
    }
  });

  test("fallback attempts the clone path only after global EACCES", () => {
    const calls: string[] = [];
    const writer = (path: string) => {
      calls.push(path);
      if (path === GLOBAL) return "eacces" as const;
      return "ok" as const;
    };
    decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: writer,
    });
    expect(calls).toEqual([GLOBAL, CLONE]);
  });
});

describe("decideIgnoreAppend — error mapping", () => {
  test("error when global returns 'other' (no fallback for non-EACCES failures)", () => {
    const calls: string[] = [];
    const writer = (path: string) => {
      calls.push(path);
      return "other" as const;
    };
    const result = decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: writer,
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.tried).toHaveLength(1);
      expect(result.tried[0]?.verdict).toBe("other");
    }
    // Crucially: we do NOT attempt the per-clone path on non-EACCES errors.
    expect(calls).toEqual([GLOBAL]);
  });

  test("error when clone returns 'other' after global EACCES", () => {
    const result = decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: staticWriter({ [GLOBAL]: "eacces", [CLONE]: "other" }),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.tried).toHaveLength(2);
    }
  });
});

describe("decideIgnoreAppend — idempotency probe", () => {
  test("skipped-already when global already contains the entry", () => {
    const result = decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: staticWriter({}),
      alreadyContainsEntry: (path) => path === GLOBAL,
    });
    expect(result.kind).toBe("skipped-already");
    if (result.kind === "skipped-already") expect(result.path).toBe(GLOBAL);
  });

  test("skipped-already when clone already contains (operator pre-seeded)", () => {
    const result = decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: staticWriter({}),
      alreadyContainsEntry: (path) => path === CLONE,
    });
    expect(result.kind).toBe("skipped-already");
    if (result.kind === "skipped-already") expect(result.path).toBe(CLONE);
  });

  test("writeFn never called when the entry already exists somewhere", () => {
    let wrote = false;
    const writer = () => {
      wrote = true;
      return "ok" as const;
    };
    decideIgnoreAppend({
      globalIgnoreFile: GLOBAL,
      perCloneExcludeFile: CLONE,
      entry: ".minsky/",
      writeFn: writer,
      alreadyContainsEntry: () => true,
    });
    expect(wrote).toBe(false);
  });
});

describe("classifyWriteError", () => {
  test("maps EACCES to 'eacces'", () => {
    const err = Object.assign(new Error("permission denied"), { code: "EACCES" });
    expect(classifyWriteError(err)).toBe("eacces");
  });

  test("maps EPERM to 'eacces' (same operational class)", () => {
    const err = Object.assign(new Error("not permitted"), { code: "EPERM" });
    expect(classifyWriteError(err)).toBe("eacces");
  });

  test("maps EROFS to 'eacces' (read-only filesystem)", () => {
    const err = Object.assign(new Error("read-only fs"), { code: "EROFS" });
    expect(classifyWriteError(err)).toBe("eacces");
  });

  test("maps everything else to 'other'", () => {
    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    expect(classifyWriteError(err)).toBe("other");
    expect(classifyWriteError(new Error("plain error"))).toBe("other");
    expect(classifyWriteError("string-error")).toBe("other");
    expect(classifyWriteError(undefined)).toBe("other");
  });
});

describe("renderIgnorePayload", () => {
  test("includes the marker comment so the operator can grep", () => {
    expect(renderIgnorePayload(".minsky/")).toContain(
      "# minsky sidecar (auto-added by minsky-bootstrap)",
    );
  });

  test("includes the entry verbatim", () => {
    expect(renderIgnorePayload(".minsky/")).toContain(".minsky/");
    expect(renderIgnorePayload("custom-path/")).toContain("custom-path/");
  });

  test("payload ends with a newline so consecutive appends stay separated", () => {
    expect(renderIgnorePayload(".minsky/")).toMatch(/\n$/);
  });
});
