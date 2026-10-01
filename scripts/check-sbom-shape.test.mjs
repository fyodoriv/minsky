// @ts-check
// Paired tests for `classifySbomShape` (slice 1), `walkSbomViolations`
// (slice 2), and `parseSbomJson` (slice 3) of the SBOM sub-track of
// `supply-chain-hardening-lockfile-sbom-slsa`.
//
// Each case carries a one-line tag matching the verdict table in the
// script's header. Slice ≥4 (CLI + CI gate) is gated against these fixed
// seams.

import { describe, expect, it } from "vitest";

import {
  ALLOWED_COMPONENT_TYPES,
  ALLOWED_SPEC_VERSIONS,
  classifySbomShape,
  parseArgs,
  parseSbomJson,
  runSbomShapeCheck,
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

// Slice 3: `parseSbomJson` JSON-text parser. --------------------------------

const UTF8_BOM = "﻿";

describe("parseSbomJson — valid input", () => {
  it("parses a minimal valid SBOM and round-trips through the slice-1 classifier", () => {
    const text = JSON.stringify(validSbom());
    const parsed = parseSbomJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(classifySbomShape(parsed.parsed)).toEqual({ ok: true, kind: "valid" });
    }
  });

  it("parses a multi-component valid SBOM and round-trips through the slice-2 walker", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "a", version: "1.0.0", purl: "pkg:npm/a@1.0.0" },
        { type: "library", name: "b", version: "2.0.0", purl: "pkg:npm/b@2.0.0" },
      ],
    });
    const text = JSON.stringify(sbom);
    const parsed = parseSbomJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(walkSbomViolations(parsed.parsed)).toEqual({ violations: [] });
    }
  });

  it("parses a JSON array — shape rejection is the slice-1 classifier's job, not the parser's", () => {
    const parsed = parseSbomJson("[]");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.parsed).toEqual([]);
      // `classifySbomShape` rejects arrays as `not-object` — confirms the
      // parser/classifier responsibility split.
      expect(classifySbomShape(parsed.parsed)).toEqual({
        ok: false,
        code: "not-object",
        reason: "SBOM root must be a JSON object",
      });
    }
  });

  it("parses a JSON primitive — caller responsibility to reject downstream", () => {
    expect(parseSbomJson("null")).toEqual({ ok: true, parsed: null });
    expect(parseSbomJson("42")).toEqual({ ok: true, parsed: 42 });
    expect(parseSbomJson('"a string"')).toEqual({ ok: true, parsed: "a string" });
  });

  it("strips a leading UTF-8 BOM before parsing — cyclonedx-cli sometimes emits one", () => {
    const text = `${UTF8_BOM}${JSON.stringify(validSbom())}`;
    const parsed = parseSbomJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(classifySbomShape(parsed.parsed)).toEqual({ ok: true, kind: "valid" });
    }
  });

  it("tolerates leading and trailing whitespace around valid JSON", () => {
    const parsed = parseSbomJson(`\n  ${JSON.stringify(validSbom())}\n  `);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(classifySbomShape(parsed.parsed)).toEqual({ ok: true, kind: "valid" });
    }
  });

  it("preserves Unicode characters in component names", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "café", version: "1.0.0", purl: "pkg:npm/caf%C3%A9@1.0.0" },
      ],
    });
    const text = JSON.stringify(sbom);
    const parsed = parseSbomJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const components = /** @type {Record<string, unknown>} */ (parsed.parsed)["components"];
      expect(/** @type {Array<Record<string, unknown>>} */ (components)[0]?.["name"]).toBe("café");
    }
  });
});

describe("parseSbomJson — non-string input", () => {
  it("rejects undefined with code=non-string-input", () => {
    expect(parseSbomJson(undefined)).toEqual({
      ok: false,
      code: "non-string-input",
      reason: "parseSbomJson requires a string argument; received undefined",
    });
  });

  it("rejects null with a distinct reason that names the type", () => {
    const result = parseSbomJson(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("non-string-input");
      expect(result.reason).toContain("null");
    }
  });

  it("rejects a number with code=non-string-input", () => {
    const result = parseSbomJson(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("non-string-input");
      expect(result.reason).toContain("number");
    }
  });

  it("rejects an object with code=non-string-input — caller must read text from disk first", () => {
    const result = parseSbomJson({ bomFormat: "CycloneDX" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("non-string-input");
      expect(result.reason).toContain("object");
    }
  });
});

describe("parseSbomJson — empty input", () => {
  it("rejects an empty string with code=empty-input", () => {
    expect(parseSbomJson("")).toEqual({
      ok: false,
      code: "empty-input",
      reason: "SBOM text is empty or whitespace-only",
    });
  });

  it("rejects a whitespace-only string with code=empty-input", () => {
    expect(parseSbomJson("   \n\t  \r\n")).toEqual({
      ok: false,
      code: "empty-input",
      reason: "SBOM text is empty or whitespace-only",
    });
  });

  it("rejects a BOM-only string (no payload after BOM strip) with code=empty-input", () => {
    expect(parseSbomJson(UTF8_BOM)).toEqual({
      ok: false,
      code: "empty-input",
      reason: "SBOM text is empty or whitespace-only",
    });
  });

  it("rejects BOM + whitespace as empty-input", () => {
    expect(parseSbomJson(`${UTF8_BOM}   \n  `)).toEqual({
      ok: false,
      code: "empty-input",
      reason: "SBOM text is empty or whitespace-only",
    });
  });
});

describe("parseSbomJson — invalid JSON", () => {
  it("rejects a truncated JSON object with code=invalid-json", () => {
    const result = parseSbomJson('{"bomFormat": "CycloneDX"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid-json");
      expect(result.reason).toMatch(/^SBOM text is not valid JSON: /);
    }
  });

  it("rejects a trailing-comma object with code=invalid-json", () => {
    const result = parseSbomJson('{"bomFormat": "CycloneDX",}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid-json");
    }
  });

  it("rejects an unquoted key with code=invalid-json", () => {
    const result = parseSbomJson("{bomFormat: CycloneDX}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid-json");
    }
  });

  it("rejects accidentally-binary content with code=invalid-json", () => {
    const result = parseSbomJson("\x00\x01\x02not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid-json");
    }
  });

  it("rejects a stray character before the JSON object with code=invalid-json", () => {
    const result = parseSbomJson(`x${JSON.stringify(validSbom())}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid-json");
    }
  });
});

describe("parseSbomJson — determinism", () => {
  it("is idempotent — re-parsing the same text returns equal results", () => {
    const text = JSON.stringify(validSbom());
    expect(parseSbomJson(text)).toEqual(parseSbomJson(text));
  });

  it("returns a fresh object each call so mutating one result cannot leak into the next", () => {
    const text = JSON.stringify(validSbom());
    const a = parseSbomJson(text);
    const b = parseSbomJson(text);
    expect(a).not.toBe(b);
    if (a.ok && b.ok) expect(a.parsed).not.toBe(b.parsed);
  });
});

// Slice 4: CLI driver + parseArgs. ------------------------------------------

describe("parseArgs", () => {
  it("defaults to sbom.cdx.json when no flags given", () => {
    expect(parseArgs([], {})).toEqual({ sbomPath: "sbom.cdx.json" });
  });

  it("--sbom=<path> overrides the default", () => {
    expect(parseArgs(["--sbom=foo.json"], {})).toEqual({ sbomPath: "foo.json" });
  });

  it("env SBOM_SHAPE_PATH overrides the default when no --sbom flag is set", () => {
    expect(parseArgs([], { SBOM_SHAPE_PATH: "envpath.json" })).toEqual({
      sbomPath: "envpath.json",
    });
  });

  it("--sbom=<path> wins over env SBOM_SHAPE_PATH", () => {
    expect(parseArgs(["--sbom=cli.json"], { SBOM_SHAPE_PATH: "envpath.json" })).toEqual({
      sbomPath: "cli.json",
    });
  });

  it("ignores unknown flags", () => {
    expect(parseArgs(["--something-else=x", "--sbom=ok.json"], {})).toEqual({
      sbomPath: "ok.json",
    });
  });
});

describe("runSbomShapeCheck — happy paths", () => {
  it("exits 0 with a 'skipped' message when SBOM file is missing (fail-safe default)", () => {
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "missing" }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("skipped");
    expect(outcome.stdout).toContain("sbom.cdx.json");
    expect(outcome.stderr).toBe("");
    expect(outcome.violations).toEqual([]);
  });

  it("exits 0 when SBOM is valid CycloneDX 1.5", () => {
    const text = JSON.stringify(validSbom());
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("ok");
    expect(outcome.stdout).toContain("0 violations");
    expect(outcome.violations).toEqual([]);
  });

  it("exits 0 when SBOM is valid CycloneDX 1.6", () => {
    const text = JSON.stringify(validSbom({ specVersion: "1.6" }));
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.violations).toEqual([]);
  });
});

describe("runSbomShapeCheck — exit code 2 (cannot evaluate)", () => {
  it("exits 2 when read returns an error", () => {
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "error", reason: "EACCES: permission denied" }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("cannot read");
    expect(outcome.stderr).toContain("EACCES");
  });

  it("exits 2 when SBOM text is not valid JSON", () => {
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: "{not json" }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain("invalid-json");
  });

  it("exits 2 when SBOM text is empty", () => {
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: "" }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain("empty-input");
  });

  it("distinguishes read-error from parse-error in the diagnostic message", () => {
    const readErr = runSbomShapeCheck({
      readSbom: () => ({ kind: "error", reason: "EIO" }),
      sbomPath: "x.json",
    });
    const parseErr = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: "garbage" }),
      sbomPath: "x.json",
    });
    expect(readErr.stderr).toContain("cannot read");
    expect(parseErr.stderr).toContain("cannot parse");
    expect(readErr.exitCode).toBe(2);
    expect(parseErr.exitCode).toBe(2);
  });
});

describe("runSbomShapeCheck — exit code 1 (shape violations)", () => {
  it("exits 1 when SBOM is missing bomFormat", () => {
    const sbom = validSbom();
    sbom["bomFormat"] = undefined;
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: JSON.stringify(sbom) }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.violations.length).toBe(1);
    expect(outcome.violations[0]?.code).toBe("missing-bomFormat");
    expect(outcome.stderr).toContain("missing-bomFormat");
  });

  it("exits 1 and surfaces ALL violations when components has multiple shape errors", () => {
    const sbom = validSbom({
      components: [
        { type: "library", name: "a" }, // missing version+purl
        { type: "library", name: "b" }, // missing version+purl
        { type: "not-a-real-type", name: "c" }, // invalid type
      ],
    });
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: JSON.stringify(sbom) }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.violations.length).toBe(3);
  });

  it("includes the path in the diagnostic when the violation has one", () => {
    const sbom = validSbom({
      components: [{ type: "library", name: "lodash" }],
    });
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: JSON.stringify(sbom) }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("components[0]");
  });

  it("emits the remediation hint pointing at vision.md § 13.5", () => {
    const sbom = validSbom();
    sbom["bomFormat"] = undefined;
    const outcome = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: JSON.stringify(sbom) }),
      sbomPath: "sbom.cdx.json",
    });
    expect(outcome.stderr).toContain("vision.md");
    expect(outcome.stderr).toContain("13.5");
  });
});

describe("runSbomShapeCheck — fail-safe-defaults exit-code split", () => {
  it("exit 0 / 1 / 2 are distinct codes with distinct meanings", () => {
    const clean = runSbomShapeCheck({
      readSbom: () => ({ kind: "ok", text: JSON.stringify(validSbom()) }),
      sbomPath: "sbom.cdx.json",
    });
    const violations = runSbomShapeCheck({
      readSbom: () => ({
        kind: "ok",
        text: JSON.stringify({ ...validSbom(), bomFormat: "wrong" }),
      }),
      sbomPath: "sbom.cdx.json",
    });
    const cannotEvaluate = runSbomShapeCheck({
      readSbom: () => ({ kind: "error", reason: "any" }),
      sbomPath: "sbom.cdx.json",
    });
    expect(clean.exitCode).toBe(0);
    expect(violations.exitCode).toBe(1);
    expect(cannotEvaluate.exitCode).toBe(2);
  });
});
