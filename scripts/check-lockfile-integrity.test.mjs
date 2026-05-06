// @ts-check
// Paired tests for `classifyLockfileEntryChange` (slice 1 of
// `supply-chain-hardening-lockfile-sbom-slsa`).
//
// Each case carries a one-letter rubric tag matching the verdict table in
// the script's header. Slice ≥2 (lockfile-diff walker / annotation / CLI /
// CI gate) is gated against this fixed seam.

import { describe, expect, it } from "vitest";

import {
  ALLOWED_INTEGRITY_ALGORITHMS,
  classifyLockfileEntryChange,
  extractEntriesFromLockfile,
  formatVerdict,
  parseSpecifier,
  walkLockfileChanges,
} from "./check-lockfile-integrity.mjs";

const SHA512_A =
  "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const SHA512_B =
  "sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==";
const SHA384_A =
  "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("parseSpecifier (pure helper)", () => {
  it("parses unscoped pkg@version", () => {
    expect(parseSpecifier("lodash@4.17.21")).toEqual({ name: "lodash", version: "4.17.21" });
  });

  it("parses scoped @scope/pkg@version (last @ is the boundary)", () => {
    expect(parseSpecifier("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", version: "1.2.3" });
  });

  it("parses prerelease versions with build metadata", () => {
    expect(parseSpecifier("foo@1.2.3-beta.4+sha.abc")).toEqual({
      name: "foo",
      version: "1.2.3-beta.4+sha.abc",
    });
  });

  it("returns null for missing version (no @)", () => {
    expect(parseSpecifier("lodash")).toBeNull();
  });

  it("returns null for empty version (trailing @)", () => {
    expect(parseSpecifier("lodash@")).toBeNull();
  });

  it("returns null for scope-only (leading @ only)", () => {
    expect(parseSpecifier("@scope")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseSpecifier("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    // @ts-expect-error - exercising runtime guard
    expect(parseSpecifier(undefined)).toBeNull();
    // @ts-expect-error - exercising runtime guard
    expect(parseSpecifier(null)).toBeNull();
    // @ts-expect-error - exercising runtime guard
    expect(parseSpecifier(123)).toBeNull();
  });
});

describe("ALLOWED_INTEGRITY_ALGORITHMS", () => {
  it("locks the SRI algorithm allowlist (SHA-256/384/512 — pnpm v9)", () => {
    expect(ALLOWED_INTEGRITY_ALGORITHMS).toEqual(["sha256", "sha384", "sha512"]);
  });

  it("is frozen so a downstream import cannot mutate it", () => {
    expect(Object.isFrozen(ALLOWED_INTEGRITY_ALGORITHMS)).toBe(true);
  });
});

describe("classifyLockfileEntryChange — benign verdicts", () => {
  it("(a) unchanged — same specifier + same integrity → ok/unchanged", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "lodash@4.17.21", integrity: SHA512_A },
      after: { specifier: "lodash@4.17.21", integrity: SHA512_A },
    });
    expect(r).toEqual({ ok: true, kind: "unchanged" });
  });

  it("(b) added — before null, after valid → ok/added", () => {
    const r = classifyLockfileEntryChange({
      before: null,
      after: { specifier: "lodash@4.17.21", integrity: SHA512_A },
    });
    expect(r).toEqual({ ok: true, kind: "added" });
  });

  it("(c) removed — before valid, after null → ok/removed", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "lodash@4.17.21", integrity: SHA512_A },
      after: null,
    });
    expect(r).toEqual({ ok: true, kind: "removed" });
  });

  it("(d) version-bump — version differs AND integrity differs → ok/version-bump", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "lodash@4.17.20", integrity: SHA512_A },
      after: { specifier: "lodash@4.17.21", integrity: SHA512_B },
    });
    expect(r).toEqual({ ok: true, kind: "version-bump" });
  });

  it("(e) version-bump across major works the same", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "react@17.0.2", integrity: SHA512_A },
      after: { specifier: "react@18.2.0", integrity: SHA512_B },
    });
    expect(r.ok).toBe(true);
  });

  it("(f) algorithm change with version bump (sha384 → sha512) — still version-bump", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "foo@1.0.0", integrity: SHA384_A },
      after: { specifier: "foo@1.0.1", integrity: SHA512_A },
    });
    expect(r).toEqual({ ok: true, kind: "version-bump" });
  });

  it("(g) scoped package — added is recognised", () => {
    const r = classifyLockfileEntryChange({
      before: null,
      after: { specifier: "@minsky/observability@0.1.0", integrity: SHA512_A },
    });
    expect(r).toEqual({ ok: true, kind: "added" });
  });
});

describe("classifyLockfileEntryChange — supply-chain-attack verdicts", () => {
  it("(h) hash-change-without-version-change — the fingerprint of a hijacked package", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "debug@4.3.4", integrity: SHA512_A },
      after: { specifier: "debug@4.3.4", integrity: SHA512_B },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("hash-change-without-version-change");
      expect(r.reason).toContain("debug@4.3.4");
      expect(r.reason).toContain("supply-chain attack");
    }
  });

  it("(i) hash-change-without-version-change for scoped package", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "@types/node@20.0.0", integrity: SHA512_A },
      after: { specifier: "@types/node@20.0.0", integrity: SHA512_B },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("hash-change-without-version-change");
      expect(r.reason).toContain("@types/node@20.0.0");
    }
  });

  it("(j) version-change-without-hash-change — cryptographically impossible", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "lodash@4.17.20", integrity: SHA512_A },
      after: { specifier: "lodash@4.17.21", integrity: SHA512_A },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("version-change-without-hash-change");
    }
  });
});

describe("classifyLockfileEntryChange — caller / input errors", () => {
  it("(k) name-mismatch — walker passed entries for different packages", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "lodash@1.0.0", integrity: SHA512_A },
      after: { specifier: "react@1.0.0", integrity: SHA512_A },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("name-mismatch");
    }
  });

  it("(l) no-change — both before and after null", () => {
    const r = classifyLockfileEntryChange({ before: null, after: null });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("no-change");
    }
  });

  it("(m) malformed-specifier — missing @version", () => {
    const r = classifyLockfileEntryChange({
      before: null,
      after: { specifier: "lodash", integrity: SHA512_A },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("malformed-specifier");
    }
  });

  it("(n) missing-integrity — empty string", () => {
    const r = classifyLockfileEntryChange({
      before: null,
      after: { specifier: "lodash@1.0.0", integrity: "" },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("missing-integrity");
    }
  });

  it("(o) malformed-integrity — wrong algorithm prefix (md5 not in SRI allowlist)", () => {
    const r = classifyLockfileEntryChange({
      before: null,
      after: { specifier: "lodash@1.0.0", integrity: "md5-AAAAAAAA==" },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("malformed-integrity");
    }
  });

  it("(p) malformed-integrity — no algorithm prefix at all", () => {
    const r = classifyLockfileEntryChange({
      before: null,
      after: { specifier: "lodash@1.0.0", integrity: "AAAAAAAA==" },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("malformed-integrity");
    }
  });

  it("(q) malformed-input — non-object change", () => {
    const r = classifyLockfileEntryChange(/** @type {any} */ (null));
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("malformed-input");
    }
  });

  it("(r) malformed-specifier on the before side surfaces as before.specifier", () => {
    const r = classifyLockfileEntryChange({
      before: { specifier: "lodash", integrity: SHA512_A },
      after: { specifier: "lodash@1.0.0", integrity: SHA512_A },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("malformed-specifier");
      expect(r.reason).toContain("before.specifier");
    }
  });
});

describe("extractEntriesFromLockfile (slice 2 — pure helper)", () => {
  it("extracts name@version → { specifier, integrity } from a pnpm v9 packages map", () => {
    const parsed = {
      packages: {
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
        "@types/node@20.0.0": { resolution: { integrity: SHA512_B } },
      },
    };
    const map = extractEntriesFromLockfile(parsed);
    expect(map.size).toBe(2);
    expect(map.get("lodash@4.17.21")).toEqual({
      specifier: "lodash@4.17.21",
      integrity: SHA512_A,
    });
    expect(map.get("@types/node@20.0.0")).toEqual({
      specifier: "@types/node@20.0.0",
      integrity: SHA512_B,
    });
  });

  it("skips entries without resolution.integrity (workspace links, file: deps)", () => {
    const parsed = {
      packages: {
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
        "link@workspace": {},
        "git-dep@1.0.0": { resolution: { tarball: "https://..." } },
      },
    };
    const map = extractEntriesFromLockfile(/** @type {any} */ (parsed));
    expect(map.size).toBe(1);
    expect(map.has("lodash@4.17.21")).toBe(true);
  });

  it("returns an empty map for missing/null/non-object input", () => {
    expect(extractEntriesFromLockfile(null).size).toBe(0);
    expect(extractEntriesFromLockfile(undefined).size).toBe(0);
    // @ts-expect-error - exercising runtime guard
    expect(extractEntriesFromLockfile("not an object").size).toBe(0);
    expect(extractEntriesFromLockfile({}).size).toBe(0);
    // @ts-expect-error - exercising runtime guard
    expect(extractEntriesFromLockfile({ packages: "not an object" }).size).toBe(0);
  });

  it("skips non-object entry values without crashing", () => {
    const parsed = {
      packages: {
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
        "weird@1.0.0": null,
        "weirder@1.0.0": "not an object",
      },
    };
    const map = extractEntriesFromLockfile(/** @type {any} */ (parsed));
    expect(map.size).toBe(1);
  });

  it("skips entries with non-string or empty integrity", () => {
    const parsed = {
      packages: {
        "good@1.0.0": { resolution: { integrity: SHA512_A } },
        "empty@1.0.0": { resolution: { integrity: "" } },
        "numeric@1.0.0": { resolution: { integrity: 123 } },
      },
    };
    const map = extractEntriesFromLockfile(/** @type {any} */ (parsed));
    expect(map.size).toBe(1);
    expect(map.has("good@1.0.0")).toBe(true);
  });
});

describe("walkLockfileChanges (slice 2 — diff walker)", () => {
  it("emits no violations on an unchanged lockfile", () => {
    const lock = {
      packages: {
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
        "@types/node@20.0.0": { resolution: { integrity: SHA512_B } },
      },
    };
    const result = walkLockfileChanges({ before: lock, after: lock });
    expect(result.violations).toEqual([]);
    expect(result.summary).toEqual({ unchanged: 2, added: 0, removed: 0, versionBump: 0 });
  });

  it("counts an added key (only in after) as ok/added", () => {
    const before = { packages: {} };
    const after = { packages: { "lodash@4.17.21": { resolution: { integrity: SHA512_A } } } };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations).toEqual([]);
    expect(result.summary.added).toBe(1);
  });

  it("counts a removed key (only in before) as ok/removed", () => {
    const before = { packages: { "lodash@4.17.21": { resolution: { integrity: SHA512_A } } } };
    const after = { packages: {} };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations).toEqual([]);
    expect(result.summary.removed).toBe(1);
  });

  it("models a version bump as removed-old + added-new (no violations, not version-bump)", () => {
    // pnpm-lock keys differ across versions, so a bump shows up as two
    // benign verdicts at the walker boundary — not the classifier's
    // `version-bump` kind, which is reachable only via direct calls.
    const before = { packages: { "lodash@4.17.20": { resolution: { integrity: SHA512_A } } } };
    const after = { packages: { "lodash@4.17.21": { resolution: { integrity: SHA512_B } } } };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations).toEqual([]);
    expect(result.summary.removed).toBe(1);
    expect(result.summary.added).toBe(1);
    expect(result.summary.versionBump).toBe(0);
  });

  it("flags hash-change-without-version-change — the supply-chain-attack signature", () => {
    const before = { packages: { "debug@4.3.4": { resolution: { integrity: SHA512_A } } } };
    const after = { packages: { "debug@4.3.4": { resolution: { integrity: SHA512_B } } } };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.key).toBe("debug@4.3.4");
    expect(result.violations[0]?.code).toBe("hash-change-without-version-change");
    expect(result.violations[0]?.reason).toContain("debug@4.3.4");
  });

  it("flags scoped-package hash-change-without-version-change", () => {
    const before = { packages: { "@types/node@20.0.0": { resolution: { integrity: SHA512_A } } } };
    const after = { packages: { "@types/node@20.0.0": { resolution: { integrity: SHA512_B } } } };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.key).toBe("@types/node@20.0.0");
    expect(result.violations[0]?.code).toBe("hash-change-without-version-change");
  });

  it("returns violations sorted by key lexicographically (stable diagnostic order)", () => {
    const before = {
      packages: {
        "zeta@1.0.0": { resolution: { integrity: SHA512_A } },
        "alpha@1.0.0": { resolution: { integrity: SHA512_A } },
        "middle@1.0.0": { resolution: { integrity: SHA512_A } },
      },
    };
    const after = {
      packages: {
        "zeta@1.0.0": { resolution: { integrity: SHA512_B } },
        "alpha@1.0.0": { resolution: { integrity: SHA512_B } },
        "middle@1.0.0": { resolution: { integrity: SHA512_B } },
      },
    };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations.map((v) => v.key)).toEqual([
      "alpha@1.0.0",
      "middle@1.0.0",
      "zeta@1.0.0",
    ]);
  });

  it("emits multiple violations for a multi-package supply-chain incident", () => {
    // The 2025 chalk/debug incident: maintainer credential compromise
    // republished several siblings under their existing version numbers.
    const before = {
      packages: {
        "chalk@5.3.0": { resolution: { integrity: SHA512_A } },
        "debug@4.3.4": { resolution: { integrity: SHA512_A } },
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
      },
    };
    const after = {
      packages: {
        "chalk@5.3.0": { resolution: { integrity: SHA512_B } },
        "debug@4.3.4": { resolution: { integrity: SHA512_B } },
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
      },
    };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((v) => v.code)).toEqual([
      "hash-change-without-version-change",
      "hash-change-without-version-change",
    ]);
    expect(result.summary.unchanged).toBe(1);
  });

  it("handles empty / missing lockfiles on either side", () => {
    expect(walkLockfileChanges({ before: null, after: null })).toEqual({
      violations: [],
      summary: { unchanged: 0, added: 0, removed: 0, versionBump: 0 },
    });
    expect(walkLockfileChanges({ before: {}, after: {} })).toEqual({
      violations: [],
      summary: { unchanged: 0, added: 0, removed: 0, versionBump: 0 },
    });
  });

  it("ignores entries that legitimately lack integrity (workspace links)", () => {
    const before = {
      packages: {
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
        "link@workspace": {},
      },
    };
    const after = {
      packages: {
        "lodash@4.17.21": { resolution: { integrity: SHA512_A } },
        "link@workspace": {},
      },
    };
    const result = walkLockfileChanges({ before, after });
    expect(result.violations).toEqual([]);
    expect(result.summary.unchanged).toBe(1); // only lodash; link@workspace skipped
  });
});

describe("formatVerdict", () => {
  it("renders an ok verdict with the leading [ok] token", () => {
    expect(formatVerdict({ ok: true, kind: "unchanged" })).toBe("[ok] unchanged");
  });

  it("renders an ok verdict with a package name when provided", () => {
    expect(formatVerdict({ ok: true, kind: "added" }, "lodash")).toBe("[ok] [lodash] added");
  });

  it("renders a fail verdict with the leading [fail] token + code + reason", () => {
    const out = formatVerdict({
      ok: false,
      code: "hash-change-without-version-change",
      reason: "debug@4.3.4: integrity changed",
    });
    expect(out.startsWith("[fail] hash-change-without-version-change:")).toBe(true);
    expect(out).toContain("debug@4.3.4");
  });
});
