// @ts-check
// Paired tests for `classifySbomShape` (slice 1) and `walkSbomViolations`
// (slice 2) of the SBOM sub-track of `supply-chain-hardening-lockfile-sbom-slsa`.
//
// Each case carries a one-line tag matching the verdict table in the
// script's header. Slice ≥3 (JSON I/O, workflow generation, CI gate) is
// gated against this fixed seam.

import { describe, expect, it } from "vitest";

import {
  ALLOWED_COMPONENT_TYPES,
  ALLOWED_SPEC_VERSIONS,
  classifySbomShape,
  formatSbomReport,
  formatSbomViolation,
  walkSbomViolations,
} from "./check-sbom-shape.mjs";

/**
 * Build a minimal valid CycloneDX 1.5 SBOM with a single library component.
 * The npm-package generator's typical output has many more fields
 * (`metadata`, `serialNumber`, `dependencies`); this returns the
 * minimum-viable shape the classifier must accept.
 *
 * @param {Partial<Record<string, unknown>>} overrides
 * @returns {Record<string, unknown>}
 */
function validSbom(overrides = {}) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    components: [
      {
        type: "library",
        name: "lodash",
        version: "4.17.21",
        purl: "pkg:npm/lodash@4.17.21",
        "bom-ref": "pkg:npm/lodash@4.17.21",
      },
    ],
    ...overrides,
  };
}

describe("ALLOWED_SPEC_VERSIONS", () => {
  it("locks the CycloneDX spec-version allowlist (1.5 / 1.6)", () => {
    expect(ALLOWED_SPEC_VERSIONS).toEqual(["1.5", "1.6"]);
  });

  it("is frozen so a downstream import cannot mutate it", () => {
    expect(Object.isFrozen(ALLOWED_SPEC_VERSIONS)).toBe(true);
  });
});

describe("ALLOWED_COMPONENT_TYPES", () => {
  it("includes the library type — the npm-dependency case", () => {
    expect(ALLOWED_COMPONENT_TYPES).toContain("library");
  });

  it("includes the application type — the root package case", () => {
    expect(ALLOWED_COMPONENT_TYPES).toContain("application");
  });

  it("is frozen so a downstream import cannot mutate it", () => {
    expect(Object.isFrozen(ALLOWED_COMPONENT_TYPES)).toBe(true);
  });
});

describe("classifySbomShape — valid", () => {
  it("accepts the minimal CycloneDX 1.5 SBOM with one library component", () => {
    expect(classifySbomShape(validSbom())).toEqual({ ok: true, kind: "valid" });
  });

  it("accepts CycloneDX 1.6 (newer spec version)", () => {
    expect(classifySbomShape(validSbom({ specVersion: "1.6" }))).toEqual({
      ok: true,
      kind: "valid",
    });
  });

  it("accepts an SBOM with extra unknown top-level fields (metadata, serialNumber)", () => {
    const withExtras = validSbom({
      serialNumber: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
      metadata: { timestamp: "2026-05-06T12:00:00Z", tools: [{ name: "cyclonedx-cli" }] },
    });
    expect(classifySbomShape(withExtras)).toEqual({ ok: true, kind: "valid" });
  });

  it("accepts a scoped-package purl (the @scope/name case)", () => {
    const scoped = validSbom({
      components: [
        {
          type: "library",
          name: "@scope/pkg",
          version: "1.2.3",
          purl: "pkg:npm/@scope/pkg@1.2.3",
        },
      ],
    });
    expect(classifySbomShape(scoped)).toEqual({ ok: true, kind: "valid" });
  });

  it("accepts a purl with qualifiers (the ?key=value spec extension)", () => {
    const withQualifier = validSbom({
      components: [
        {
          type: "library",
          name: "lodash",
          version: "4.17.21",
          purl: "pkg:npm/lodash@4.17.21?source=registry.npmjs.org",
        },
      ],
    });
    expect(classifySbomShape(withQualifier)).toEqual({ ok: true, kind: "valid" });
  });

  it("accepts an empty components array (an SBOM with no deps is well-formed)", () => {
    expect(classifySbomShape(validSbom({ components: [] }))).toEqual({
      ok: true,
      kind: "valid",
    });
  });

  it("accepts non-library components without version/purl (root application entry)", () => {
    const rootApp = validSbom({
      components: [
        { type: "application", name: "minsky" },
        {
          type: "library",
          name: "lodash",
          version: "4.17.21",
          purl: "pkg:npm/lodash@4.17.21",
        },
      ],
    });
    expect(classifySbomShape(rootApp)).toEqual({ ok: true, kind: "valid" });
  });
});

describe("classifySbomShape — root-shape rejections", () => {
  it("rejects null (root must be an object)", () => {
    const result = classifySbomShape(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not-object");
  });

  it("rejects an array (top-level array is not a CycloneDX SBOM)", () => {
    const result = classifySbomShape([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not-object");
  });

  it("rejects a primitive (number)", () => {
    const result = classifySbomShape(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not-object");
  });

  it("rejects an empty object (missing bomFormat)", () => {
    const result = classifySbomShape({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-bomFormat");
  });

  it("rejects missing bomFormat (other top-level fields present)", () => {
    const { bomFormat: _bomFormat, ...sbom } = validSbom();
    const result = classifySbomShape(sbom);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-bomFormat");
  });
});

describe("classifySbomShape — bomFormat rejections", () => {
  it("rejects bomFormat=SPDX (wrong format string)", () => {
    const sbom = validSbom();
    sbom["bomFormat"] = "SPDX";
    const result = classifySbomShape(sbom);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("wrong-bomFormat");
      expect(result.reason).toContain("CycloneDX");
    }
  });

  it("rejects bomFormat=cyclonedx (case-sensitive)", () => {
    const sbom = validSbom();
    sbom["bomFormat"] = "cyclonedx";
    const result = classifySbomShape(sbom);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("wrong-bomFormat");
  });
});

describe("classifySbomShape — specVersion rejections", () => {
  it("rejects missing specVersion", () => {
    const { specVersion: _specVersion, ...sbom } = validSbom();
    const result = classifySbomShape(sbom);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-specVersion");
  });

  it("rejects specVersion=1.4 (older — outside the allowlist)", () => {
    const result = classifySbomShape(validSbom({ specVersion: "1.4" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported-specVersion");
      expect(result.reason).toContain("1.5");
    }
  });

  it("rejects specVersion=1.7 (future — outside the allowlist; pivot extends)", () => {
    const result = classifySbomShape(validSbom({ specVersion: "1.7" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupported-specVersion");
  });

  it("rejects non-string specVersion", () => {
    const result = classifySbomShape(validSbom({ specVersion: 1.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupported-specVersion");
  });
});

describe("classifySbomShape — version rejections", () => {
  it("rejects missing version", () => {
    const { version: _version, ...sbom } = validSbom();
    const result = classifySbomShape(sbom);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-version");
  });

  it("rejects version=0 (must be positive integer)", () => {
    const result = classifySbomShape(validSbom({ version: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-version");
  });

  it("rejects version=-1 (must be positive integer)", () => {
    const result = classifySbomShape(validSbom({ version: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-version");
  });

  it("rejects fractional version (must be integer)", () => {
    const result = classifySbomShape(validSbom({ version: 1.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-version");
  });

  it("rejects string version (must be a number)", () => {
    const result = classifySbomShape(validSbom({ version: "1" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-version");
  });
});

describe("classifySbomShape — components-shape rejections", () => {
  it("rejects missing components", () => {
    const { components: _components, ...sbom } = validSbom();
    const result = classifySbomShape(sbom);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-components");
  });

  it("rejects components as object (must be an array)", () => {
    const result = classifySbomShape(validSbom({ components: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("components-not-array");
  });

  it("rejects components as null", () => {
    const result = classifySbomShape(validSbom({ components: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("components-not-array");
  });
});

describe("classifySbomShape — per-component rejections", () => {
  it("rejects a non-object entry", () => {
    const result = classifySbomShape(validSbom({ components: ["not-an-object"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("component-not-object");
      expect(result.path).toBe("components[0]");
    }
  });

  it("rejects a component missing type", () => {
    const result = classifySbomShape(
      validSbom({
        components: [{ name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-missing-type");
  });

  it("rejects a component with type outside the spec enum", () => {
    const result = classifySbomShape(
      validSbom({
        components: [
          {
            type: "tarball",
            name: "lodash",
            version: "4.17.21",
            purl: "pkg:npm/lodash@4.17.21",
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-invalid-type");
  });

  it("rejects a library component without name", () => {
    const result = classifySbomShape(
      validSbom({
        components: [{ type: "library", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-missing-name");
  });

  it("rejects a library component with empty name", () => {
    const result = classifySbomShape(
      validSbom({
        components: [
          { type: "library", name: "", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-missing-name");
  });

  it("rejects a library component without version", () => {
    const result = classifySbomShape(
      validSbom({
        components: [{ type: "library", name: "lodash", purl: "pkg:npm/lodash@4.17.21" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-missing-version");
  });

  it("rejects a library component without purl", () => {
    const result = classifySbomShape(
      validSbom({
        components: [{ type: "library", name: "lodash", version: "4.17.21" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-missing-purl");
  });

  it("rejects a library component with malformed purl (missing pkg: scheme)", () => {
    const result = classifySbomShape(
      validSbom({
        components: [
          {
            type: "library",
            name: "lodash",
            version: "4.17.21",
            purl: "lodash@4.17.21",
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-malformed-purl");
  });

  it("rejects a library component with malformed purl (missing @version)", () => {
    const result = classifySbomShape(
      validSbom({
        components: [
          { type: "library", name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("component-malformed-purl");
  });

  it("points the path at the offending entry index", () => {
    const result = classifySbomShape(
      validSbom({
        components: [
          {
            type: "library",
            name: "lodash",
            version: "4.17.21",
            purl: "pkg:npm/lodash@4.17.21",
          },
          { type: "library", name: "missing-purl-pkg", version: "1.0.0" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("component-missing-purl");
      expect(result.path).toBe("components[1]");
    }
  });
});

describe("classifySbomShape — duplicate bom-ref rejections", () => {
  it("rejects two components sharing the same bom-ref", () => {
    const result = classifySbomShape(
      validSbom({
        components: [
          {
            type: "library",
            name: "lodash",
            version: "4.17.21",
            purl: "pkg:npm/lodash@4.17.21",
            "bom-ref": "shared-ref",
          },
          {
            type: "library",
            name: "underscore",
            version: "1.13.6",
            purl: "pkg:npm/underscore@1.13.6",
            "bom-ref": "shared-ref",
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-bom-ref");
      expect(result.path).toBe("components[1]");
      expect(result.reason).toContain("shared-ref");
    }
  });

  it("accepts two components without bom-ref (optional field)", () => {
    const result = classifySbomShape(
      validSbom({
        components: [
          {
            type: "library",
            name: "lodash",
            version: "4.17.21",
            purl: "pkg:npm/lodash@4.17.21",
          },
          {
            type: "library",
            name: "underscore",
            version: "1.13.6",
            purl: "pkg:npm/underscore@1.13.6",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

// Slice 2: `walkSbomViolations` aggregating walker. --------------------------

describe("walkSbomViolations — valid", () => {
  it("returns no violations for a minimal valid SBOM", () => {
    expect(walkSbomViolations(validSbom())).toEqual({ violations: [] });
  });

  it("returns no violations for an SBOM with empty components", () => {
    expect(walkSbomViolations(validSbom({ components: [] }))).toEqual({ violations: [] });
  });

  it("returns no violations for an SBOM with multiple well-formed components", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21" },
        {
          type: "library",
          name: "underscore",
          version: "1.13.6",
          purl: "pkg:npm/underscore@1.13.6",
        },
        { type: "application", name: "minsky" },
      ],
    });
    expect(walkSbomViolations(sbom)).toEqual({ violations: [] });
  });
});

describe("walkSbomViolations — top-level fail-fast", () => {
  it("returns a single not-object violation for a non-object root", () => {
    const result = walkSbomViolations(null);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("not-object");
  });

  it("returns a single missing-bomFormat violation for an empty object", () => {
    const result = walkSbomViolations({});
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("missing-bomFormat");
  });

  it("returns a single wrong-bomFormat violation and does not walk components", () => {
    const sbom = validSbom();
    sbom["bomFormat"] = "SPDX";
    sbom["components"] = [
      { type: "library", name: "" },
      { type: "library", name: "" },
    ];
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("wrong-bomFormat");
  });

  it("returns a single unsupported-specVersion violation", () => {
    const result = walkSbomViolations(validSbom({ specVersion: "1.4" }));
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("unsupported-specVersion");
  });

  it("returns a single missing-version violation", () => {
    const { version: _v, ...sbom } = validSbom();
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("missing-version");
  });

  it("returns a single missing-components violation", () => {
    const { components: _c, ...sbom } = validSbom();
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("missing-components");
  });

  it("returns a single components-not-array violation", () => {
    const result = walkSbomViolations(validSbom({ components: {} }));
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("components-not-array");
  });
});

describe("walkSbomViolations — aggregates per-component shape errors", () => {
  it("collects every malformed component, not just the first", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21" },
        { type: "library", name: "missing-purl", version: "1.0.0" },
        { type: "library", version: "1.0.0", purl: "pkg:npm/missing-name@1.0.0" },
        { type: "tarball", name: "bad-type", version: "1.0.0", purl: "pkg:npm/bad-type@1.0.0" },
      ],
    });
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(3);
    expect(result.violations.map((v) => v.code)).toEqual([
      "component-missing-purl",
      "component-missing-name",
      "component-invalid-type",
    ]);
  });

  it("preserves document order across multiple violations", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "a", version: "1.0.0" },
        { type: "library", name: "b", version: "1.0.0" },
        { type: "library", name: "c", version: "1.0.0" },
      ],
    });
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(3);
    expect(result.violations.map((v) => v.path)).toEqual([
      "components[0]",
      "components[1]",
      "components[2]",
    ]);
    for (const v of result.violations) expect(v.code).toBe("component-missing-purl");
  });

  it("flags non-object component entries", () => {
    const sbom = validSbom({
      components: ["string-not-object", 42, null],
    });
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(3);
    for (const v of result.violations) expect(v.code).toBe("component-not-object");
  });

  it("does not stop walking after a non-object — the next valid entry is still checked", () => {
    const sbom = validSbom({
      components: [
        "not-an-object",
        { type: "library", name: "good", version: "1.0.0", purl: "pkg:npm/good@1.0.0" },
        { type: "library", name: "bad-purl", version: "1.0.0", purl: "no-pkg-prefix" },
      ],
    });
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]?.code).toBe("component-not-object");
    expect(result.violations[1]?.code).toBe("component-malformed-purl");
  });
});

describe("walkSbomViolations — aggregates duplicate-bom-ref pairs", () => {
  it("flags every duplicate bom-ref, not just the first pair", () => {
    const sbom = validSbom({
      components: [
        {
          type: "library",
          name: "a",
          version: "1.0.0",
          purl: "pkg:npm/a@1.0.0",
          "bom-ref": "shared-x",
        },
        {
          type: "library",
          name: "b",
          version: "1.0.0",
          purl: "pkg:npm/b@1.0.0",
          "bom-ref": "shared-x",
        },
        {
          type: "library",
          name: "c",
          version: "1.0.0",
          purl: "pkg:npm/c@1.0.0",
          "bom-ref": "shared-y",
        },
        {
          type: "library",
          name: "d",
          version: "1.0.0",
          purl: "pkg:npm/d@1.0.0",
          "bom-ref": "shared-y",
        },
      ],
    });
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.every((v) => v.code === "duplicate-bom-ref")).toBe(true);
    expect(result.violations[0]?.reason).toContain("shared-x");
    expect(result.violations[1]?.reason).toContain("shared-y");
  });

  it("aggregates shape errors AND duplicate-bom-ref in document order", () => {
    const sbom = validSbom({
      components: [
        {
          type: "library",
          name: "a",
          version: "1.0.0",
          purl: "pkg:npm/a@1.0.0",
          "bom-ref": "dup",
        },
        { type: "library", name: "missing-purl", version: "1.0.0" },
        {
          type: "library",
          name: "b",
          version: "1.0.0",
          purl: "pkg:npm/b@1.0.0",
          "bom-ref": "dup",
        },
      ],
    });
    const result = walkSbomViolations(sbom);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]?.code).toBe("component-missing-purl");
    expect(result.violations[1]?.code).toBe("duplicate-bom-ref");
  });
});

describe("walkSbomViolations — slice-1 parity", () => {
  it("matches slice-1's verdict (in single-violation envelope) for a valid SBOM", () => {
    expect(walkSbomViolations(validSbom())).toEqual({ violations: [] });
    expect(classifySbomShape(validSbom())).toEqual({ ok: true, kind: "valid" });
  });

  it("matches slice-1's first verdict when only one violation exists", () => {
    const sbom = validSbom({
      components: [{ type: "library", name: "missing-purl", version: "1.0.0" }],
    });
    const single = classifySbomShape(sbom);
    const walk = walkSbomViolations(sbom);
    expect(single.ok).toBe(false);
    expect(walk.violations).toHaveLength(1);
    if (!single.ok) {
      expect(walk.violations[0]?.code).toBe(single.code);
      expect(walk.violations[0]?.reason).toBe(single.reason);
    }
  });

  it("is idempotent — re-running on the same input returns the same result", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "a", version: "1.0.0" },
        { type: "library", name: "b", version: "1.0.0" },
      ],
    });
    const first = walkSbomViolations(sbom);
    const second = walkSbomViolations(sbom);
    expect(first).toEqual(second);
  });
});

describe("formatSbomViolation — single-line diagnostic shape", () => {
  it("formats a top-level violation without a path segment", () => {
    const out = formatSbomViolation({
      ok: false,
      code: "missing-bomFormat",
      reason: 'SBOM is missing required top-level field "bomFormat"',
    });
    expect(out).toBe(
      '[fail] missing-bomFormat: SBOM is missing required top-level field "bomFormat"',
    );
  });

  it("includes the components[i] path segment when present", () => {
    const out = formatSbomViolation({
      ok: false,
      code: "component-missing-purl",
      reason: 'components[3] (type=library) is missing required field "purl"',
      path: "components[3]",
    });
    expect(out).toBe(
      '[fail] component-missing-purl components[3]: components[3] (type=library) is missing required field "purl"',
    );
  });

  it("starts with the stable [fail] leading token", () => {
    const out = formatSbomViolation({
      ok: false,
      code: "not-object",
      reason: "SBOM root must be a JSON object",
    });
    expect(out.startsWith("[fail] ")).toBe(true);
  });
});

describe("formatSbomReport — multi-line aggregate over walker output", () => {
  it("returns [ok] valid when there are zero violations", () => {
    const result = walkSbomViolations(validSbom());
    expect(formatSbomReport(result)).toBe("[ok] valid");
  });

  it("renders a header + one indented line per violation in document order", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "good", version: "1.0.0", purl: "pkg:npm/good@1.0.0" },
        { type: "library", name: "missing-purl", version: "1.0.0" },
        { type: "library", version: "1.0.0", purl: "pkg:npm/missing-name@1.0.0" },
      ],
    });
    const report = formatSbomReport(walkSbomViolations(sbom));
    const lines = report.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("[fail] sbom-shape: 2 violation(s)");
    expect(lines[1]?.startsWith("  [fail] component-missing-purl")).toBe(true);
    expect(lines[2]?.startsWith("  [fail] component-missing-name")).toBe(true);
  });

  it("renders a top-level wrong-bomFormat report as a single header + one line", () => {
    const sbom = validSbom();
    sbom["bomFormat"] = "SPDX";
    const report = formatSbomReport(walkSbomViolations(sbom));
    const lines = report.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("[fail] sbom-shape: 1 violation(s)");
    expect(lines[1]?.includes("wrong-bomFormat")).toBe(true);
  });

  it("does not include a trailing newline (CLI is responsible for that)", () => {
    const result = walkSbomViolations(validSbom({ specVersion: "1.4" }));
    const report = formatSbomReport(result);
    expect(report.endsWith("\n")).toBe(false);
  });

  it("is deterministic — same input produces byte-identical output", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "a", version: "1.0.0" },
        { type: "library", name: "b", version: "1.0.0" },
      ],
    });
    const r1 = formatSbomReport(walkSbomViolations(sbom));
    const r2 = formatSbomReport(walkSbomViolations(sbom));
    expect(r1).toBe(r2);
  });

  it("counts duplicate-bom-ref violations alongside per-component shape errors", () => {
    const sbom = validSbom({
      components: [
        {
          type: "library",
          name: "a",
          version: "1.0.0",
          purl: "pkg:npm/a@1.0.0",
          "bom-ref": "shared",
        },
        {
          type: "library",
          name: "b",
          version: "1.0.0",
          purl: "pkg:npm/b@1.0.0",
          "bom-ref": "shared",
        },
      ],
    });
    const report = formatSbomReport(walkSbomViolations(sbom));
    expect(report).toContain("[fail] sbom-shape: 1 violation(s)");
    expect(report).toContain("duplicate-bom-ref");
  });
});
