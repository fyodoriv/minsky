// @ts-check
// Paired tests for `classifySbomShape` (slice 1 of the SBOM sub-track of
// `supply-chain-hardening-lockfile-sbom-slsa`).
//
// Each case carries a one-line tag matching the verdict table in the
// script's header. Slice ≥2 (SBOM-generation workflow / artefact-attach /
// CI gate) is gated against this fixed seam.

import { describe, expect, it } from "vitest";

import {
  ALLOWED_COMPONENT_TYPES,
  ALLOWED_SPEC_VERSIONS,
  classifySbomShape,
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
