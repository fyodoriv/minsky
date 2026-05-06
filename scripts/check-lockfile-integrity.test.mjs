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
  parseArgs,
  parsePnpmLockfile,
  parseSpecifier,
  runLockfileIntegrityCheck,
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

describe("parsePnpmLockfile (slice 3 — pure pnpm-lock.yaml parser)", () => {
  it("parses a single inline-flow resolution: {integrity: …} entry", () => {
    const text = [
      "lockfileVersion: '9.0'",
      "",
      "packages:",
      "",
      "  lodash@4.17.21:",
      `    resolution: {integrity: ${SHA512_A}}`,
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    expect(parsed.packages?.["lodash@4.17.21"]).toEqual({
      resolution: { integrity: SHA512_A },
    });
  });

  it("parses a quoted scoped-package key (pnpm always quotes leading-@ keys)", () => {
    const text = [
      "packages:",
      "",
      "  '@types/node@20.0.0':",
      `    resolution: {integrity: ${SHA512_A}}`,
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    expect(parsed.packages?.["@types/node@20.0.0"]).toEqual({
      resolution: { integrity: SHA512_A },
    });
  });

  it("ignores extra inline-flow fields after integrity (engines, hasBin, …)", () => {
    const text = [
      "packages:",
      "",
      "  foo@1.0.0:",
      `    resolution: {integrity: ${SHA512_A}, tarball: 'https://example/foo.tgz'}`,
      "    engines: {node: '>=18'}",
      "    hasBin: true",
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    expect(parsed.packages?.["foo@1.0.0"]).toEqual({
      resolution: { integrity: SHA512_A },
    });
  });

  it("parses block-style resolution + integrity (hand-edited / non-pnpm-emitted shape)", () => {
    const text = [
      "packages:",
      "",
      "  foo@1.0.0:",
      "    resolution:",
      `      integrity: ${SHA512_A}`,
      "      tarball: https://example/foo.tgz",
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    expect(parsed.packages?.["foo@1.0.0"]).toEqual({
      resolution: { integrity: SHA512_A },
    });
  });

  it("parses multiple entries with mixed scoped/unscoped names", () => {
    const text = [
      "packages:",
      "",
      "  '@minsky/observability@0.1.0':",
      `    resolution: {integrity: ${SHA512_A}}`,
      "",
      "  lodash@4.17.21:",
      `    resolution: {integrity: ${SHA512_B}}`,
      "    engines: {node: '>=12'}",
      "",
      "  react@18.2.0:",
      `    resolution: {integrity: ${SHA384_A}}`,
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    expect(Object.keys(parsed.packages ?? {})).toEqual([
      "@minsky/observability@0.1.0",
      "lodash@4.17.21",
      "react@18.2.0",
    ]);
    expect(parsed.packages?.["lodash@4.17.21"]).toEqual({
      resolution: { integrity: SHA512_B },
    });
  });

  it("stops at a sibling top-level block (snapshots:, settings:, …)", () => {
    const text = [
      "packages:",
      "",
      "  foo@1.0.0:",
      `    resolution: {integrity: ${SHA512_A}}`,
      "",
      "snapshots:",
      "",
      "  bar@2.0.0:",
      `    resolution: {integrity: ${SHA512_B}}`,
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    // Only `foo@1.0.0` from `packages:` — `bar@2.0.0` lives under `snapshots:`.
    expect(Object.keys(parsed.packages ?? {})).toEqual(["foo@1.0.0"]);
  });

  it("preserves keys without integrity (workspace links, file: deps) as empty entries", () => {
    // The slice-2 walker filters these out via extractEntriesFromLockfile;
    // the parser doesn't pre-filter so the consumer sees an honest map.
    const text = [
      "packages:",
      "",
      "  link@workspace:",
      "    name: link",
      "    version: workspace",
      "",
      "  good@1.0.0:",
      `    resolution: {integrity: ${SHA512_A}}`,
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    expect(parsed.packages?.["link@workspace"]).toEqual({});
    expect(parsed.packages?.["good@1.0.0"]).toEqual({
      resolution: { integrity: SHA512_A },
    });
  });

  it("returns { packages: {} } for empty / non-string input", () => {
    expect(parsePnpmLockfile("")).toEqual({ packages: {} });
    // @ts-expect-error - exercising runtime guard
    expect(parsePnpmLockfile(null)).toEqual({ packages: {} });
    // @ts-expect-error - exercising runtime guard
    expect(parsePnpmLockfile(undefined)).toEqual({ packages: {} });
    // @ts-expect-error - exercising runtime guard
    expect(parsePnpmLockfile(42)).toEqual({ packages: {} });
  });

  it("returns { packages: {} } when the text has no packages: block", () => {
    const text = [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "",
      "importers:",
      "  .:",
      "    devDependencies: {}",
      "",
    ].join("\n");
    expect(parsePnpmLockfile(text)).toEqual({ packages: {} });
  });

  it("strips top-of-file # comments and ignores blank lines inside the block", () => {
    const text = [
      "# This file is autogenerated by pnpm. Do not edit.",
      "lockfileVersion: '9.0'",
      "",
      "packages:",
      "",
      "",
      "  foo@1.0.0:",
      `    resolution: {integrity: ${SHA512_A}}`,
      "",
    ].join("\n");
    const parsed = parsePnpmLockfile(text);
    expect(parsed.packages?.["foo@1.0.0"]).toEqual({
      resolution: { integrity: SHA512_A },
    });
  });

  it("round-trips into extractEntriesFromLockfile + walkLockfileChanges", () => {
    // The acceptance criterion of slice 3: parser output is a drop-in for the
    // slice-1/2 seams. A hash-change-without-version-change crafted as text
    // surfaces as the same supply-chain-attack verdict the walker emits.
    const before = [
      "packages:",
      "",
      "  debug@4.3.4:",
      `    resolution: {integrity: ${SHA512_A}}`,
      "",
    ].join("\n");
    const after = [
      "packages:",
      "",
      "  debug@4.3.4:",
      `    resolution: {integrity: ${SHA512_B}}`,
      "",
    ].join("\n");
    const parsedBefore = parsePnpmLockfile(before);
    const parsedAfter = parsePnpmLockfile(after);
    const entriesBefore = extractEntriesFromLockfile(parsedBefore);
    expect(entriesBefore.size).toBe(1);
    const result = walkLockfileChanges({ before: parsedBefore, after: parsedAfter });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("hash-change-without-version-change");
    expect(result.violations[0]?.key).toBe("debug@4.3.4");
  });

  it("parses the repository's own pnpm-lock.yaml without throwing and finds ≥10 entries", async () => {
    // Sanity check against the real lockfile shape — the parser's narrow
    // dialect must cover what pnpm v9 actually emits on this repo.
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const lockfilePath = resolve(here, "..", "pnpm-lock.yaml");
    const text = readFileSync(lockfilePath, "utf8");
    const parsed = parsePnpmLockfile(text);
    const keys = Object.keys(parsed.packages ?? {});
    expect(keys.length).toBeGreaterThan(10);
    // Every parsed entry that has a resolution must carry a non-empty
    // SRI-shaped integrity — otherwise the parser is mis-extracting.
    for (const key of keys) {
      const entry = parsed.packages?.[key];
      const integrity = entry?.resolution?.integrity;
      if (integrity !== undefined) {
        expect(integrity).toMatch(/^(sha256|sha384|sha512)-[A-Za-z0-9+/_-]+={0,2}$/);
      }
    }
  });
});

// Slice 4 — CLI driver + arg parsing.

describe("parseArgs (slice 4 — CLI)", () => {
  // The `env` argument defaults to `process.env` in production but lets tests
  // exercise the env-fallback path deterministically with a frozen object —
  // no `vi.stubEnv` / `delete process.env[...]` plumbing required.
  it("defaults diffBase to origin/main when no flag and no env override", () => {
    expect(parseArgs([], {}).diffBase).toBe("origin/main");
  });

  it("honours LOCKFILE_INTEGRITY_DIFF_BASE env override when no flag is set", () => {
    expect(parseArgs([], { LOCKFILE_INTEGRITY_DIFF_BASE: "upstream/main" }).diffBase).toBe(
      "upstream/main",
    );
  });

  it("honours --diff-base=<ref>", () => {
    expect(parseArgs(["--diff-base=HEAD~1"], {}).diffBase).toBe("HEAD~1");
  });

  it("--diff-base wins over env override", () => {
    expect(
      parseArgs(["--diff-base=upstream/main"], { LOCKFILE_INTEGRITY_DIFF_BASE: "main" }).diffBase,
    ).toBe("upstream/main");
  });

  it("honours --repo=<dir>", () => {
    expect(parseArgs(["--repo=/tmp/x"], {}).repo).toBe("/tmp/x");
  });

  it("ignores unrecognised flags (forward-compat with future slices)", () => {
    expect(parseArgs(["--unknown=foo", "--diff-base=HEAD"], {}).diffBase).toBe("HEAD");
  });
});

describe("runLockfileIntegrityCheck (slice 4 — driver)", () => {
  // Build a minimal lockfile-text fixture exercising the slice-3 parser. Two
  // packages, both with inline-flow `resolution: {integrity}` — the shape pnpm
  // emits.
  /** @param {readonly (readonly [string, string])[]} entries */
  const lockText = (entries) => {
    const lines = ["lockfileVersion: '9.0'", "", "packages:"];
    for (const [key, integrity] of entries) {
      lines.push(`  '${key}':`, `    resolution: {integrity: ${integrity}}`);
    }
    return `${lines.join("\n")}\n`;
  };

  const HASH_A = `sha512-${"A".repeat(86)}==`;
  const HASH_B = `sha512-${"B".repeat(86)}==`;

  it("tree missing → exit 0 with skipped diagnostic", () => {
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "missing" }),
      readBase: () => {
        throw new Error("readBase should not be called when tree is missing");
      },
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("skipped");
    expect(out.stderr).toBe("");
  });

  it("tree read error → exit 2 (fail-safe; gate cannot evaluate)", () => {
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "error", reason: "EACCES" }),
      readBase: () => ({ kind: "missing" }),
    });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("EACCES");
  });

  it("base unreachable → exit 2 (fail-safe)", () => {
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: lockText([["lodash@4.17.21", HASH_A]]) }),
      readBase: () => ({ kind: "error", reason: "diff-base unreachable" }),
    });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("unreachable");
  });

  it("base missing (file just introduced in PR) → walker treats as empty before, all entries 'added', exit 0", () => {
    const tree = lockText([
      ["lodash@4.17.21", HASH_A],
      ["debug@4.3.4", HASH_B],
    ]);
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: tree }),
      readBase: () => ({ kind: "missing" }),
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("2 added");
  });

  it("tree === base → 0 violations, exit 0, summary cites unchanged count", () => {
    const fixture = lockText([["lodash@4.17.21", HASH_A]]);
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: fixture }),
      readBase: () => ({ kind: "ok", text: fixture }),
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("1 unchanged");
    expect(out.violations).toEqual([]);
  });

  it("hash changed without version change → exit 1 with hijack diagnostic", () => {
    const before = lockText([["debug@4.3.4", HASH_A]]);
    const after = lockText([["debug@4.3.4", HASH_B]]);
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: after }),
      readBase: () => ({ kind: "ok", text: before }),
    });
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("hash-change-without-version-change");
    expect(out.stderr).toContain("debug@4.3.4");
    expect(out.violations.length).toBe(1);
    expect(out.violations[0]?.code).toBe("hash-change-without-version-change");
  });

  it("legitimate version-bump (different version key, different hash) → 0 violations", () => {
    // pnpm keys by name@version, so a version bump is a removed + added pair —
    // both benign. The 'version-bump' verdict is reachable only by manual
    // pairing in the classifier; the walker never emits it.
    const before = lockText([["debug@4.3.4", HASH_A]]);
    const after = lockText([["debug@4.3.5", HASH_B]]);
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: after }),
      readBase: () => ({ kind: "ok", text: before }),
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("1 added");
    expect(out.stdout).toContain("1 removed");
  });

  it("multi-package mix surfaces only the hijack, not the bumps", () => {
    const before = lockText([
      ["lodash@4.17.21", HASH_A],
      ["debug@4.3.4", HASH_A],
      ["chalk@5.0.0", HASH_A],
    ]);
    const after = lockText([
      ["lodash@4.17.21", HASH_A], // unchanged
      ["debug@4.3.4", HASH_B], // hijack — same key, different hash
      ["chalk@5.1.0", HASH_B], // legit bump
    ]);
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: after }),
      readBase: () => ({ kind: "ok", text: before }),
    });
    expect(out.exitCode).toBe(1);
    expect(out.violations.length).toBe(1);
    expect(out.violations[0]?.key).toBe("debug@4.3.4");
  });

  it("exit-2 diagnostic does NOT leak the base ref text into stdout", () => {
    // stdout is for ok-path digests only; failure modes go to stderr. The
    // CI gate's bash bucket asserts on exit code, but human reviewers paste
    // stdout — keeping failure diagnostics on stderr keeps the convention.
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: lockText([["a@1.0.0", HASH_A]]) }),
      readBase: () => ({ kind: "error", reason: "boom" }),
    });
    expect(out.stdout).toBe("");
    expect(out.stderr.length).toBeGreaterThan(0);
  });

  it("violation message cites vision.md § 13.5 anchor (operator hand-off)", () => {
    const before = lockText([["debug@4.3.4", HASH_A]]);
    const after = lockText([["debug@4.3.4", HASH_B]]);
    const out = runLockfileIntegrityCheck({
      readTree: () => ({ kind: "ok", text: after }),
      readBase: () => ({ kind: "ok", text: before }),
    });
    expect(out.stderr).toContain("vision.md § 13.5");
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
