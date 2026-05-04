// Tests for the rule-#2 dep-coverage lint. The pure function `checkDepCoverage`
// is exercised against synthetic ARCHITECTURE.md fragments and synthetic file
// lists; no I/O.

import { describe, expect, it } from "vitest";

import { checkDepCoverage, extractVendors } from "./check-rule-2-dep-coverage.mjs";

const ARCH_WITH_HONO = `
# Header

## The dependency table

| # | Layer | Interface | Current implementation | Replacement candidates | Risk |
|---|-------|-----------|------------------------|------------------------|------|
| 1 | Web framework | \`Web\` | hono | express, fastify | Low |
| 2 | Database | \`DB\` | sqlite | postgres | Low |

## Next section
`;

describe("extractVendors", () => {
  it("pulls vendor tokens out of the dep-table cells", () => {
    const vendors = extractVendors(ARCH_WITH_HONO);
    expect(vendors).toContain("hono");
    expect(vendors).toContain("express");
    expect(vendors).toContain("fastify");
    expect(vendors).toContain("sqlite");
    expect(vendors).toContain("postgres");
  });

  it("strips parenthesised prose and markdown markers", () => {
    const arch = `
## The dependency table

| # | Layer | Interface | Current implementation | Replacement candidates | Risk |
|---|-------|-----------|------------------------|------------------------|------|
| 1 | X | \`X\` | DSPy (Stanford) + Promptfoo | **custom** | Low |
`;
    const vendors = extractVendors(arch);
    expect(vendors).toContain("DSPy");
    expect(vendors).toContain("Promptfoo");
    expect(vendors).not.toContain("Stanford"); // parenthesised prose stripped
    expect(vendors).not.toContain("custom"); // in NON_VENDOR_TOKENS allowlist
  });

  it("returns an empty list when the section header is missing", () => {
    expect(extractVendors("# only a heading\nno table here")).toEqual([]);
  });

  it("splits multi-vendor cells on commas, slashes, plus, and arrows", () => {
    const arch = `
## The dependency table

| # | Layer | Interface | Current implementation | Replacement candidates | Risk |
|---|-------|-----------|------------------------|------------------------|------|
| 1 | Obs | \`Obs\` | Claude Code OTEL → local Loki/Tempo/Grafana | Honeycomb | Low |
`;
    const vendors = extractVendors(arch);
    expect(vendors).toContain("Loki");
    expect(vendors).toContain("Tempo");
    expect(vendors).toContain("Grafana");
    expect(vendors).toContain("Honeycomb");
  });
});

describe("checkDepCoverage — violation cases", () => {
  it("(a) flags a vendor import in non-adapter novel code", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [
        {
          path: "novel/foo/x.ts",
          source: `import { Hono } from "hono";\nexport const app = new Hono();\n`,
        },
      ],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ file: "novel/foo/x.ts", line: 1, vendor: "hono" });
  });

  it("(b) does NOT flag a vendor import inside novel/adapters/", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [
        {
          path: "novel/adapters/foo/x.ts",
          source: `import { Hono } from "hono";\n`,
        },
      ],
    });
    expect(violations).toHaveLength(0);
  });

  it("(c) does NOT flag imports inside *.test.ts or *.fixture.ts files", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [
        { path: "novel/foo/x.test.ts", source: `import { Hono } from "hono";\n` },
        { path: "novel/foo/x.fixture.ts", source: `import { Hono } from "hono";\n` },
      ],
    });
    expect(violations).toHaveLength(0);
  });

  it("(d) does NOT flag imports of packages absent from the dep table", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [
        {
          path: "novel/foo/x.ts",
          source: `import { z } from "zod";\nimport pino from "pino";\n`,
        },
      ],
    });
    expect(violations).toHaveLength(0);
  });

  it("(e) catches the require() syntax as well as ES `from`", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [
        {
          path: "novel/foo/x.ts",
          source: `const { Hono } = require("hono");\n`,
        },
      ],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.vendor).toBe("hono");
  });
});

describe("checkDepCoverage — edge cases", () => {
  it("ignores relative imports", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [
        {
          path: "novel/foo/x.ts",
          source: `import { foo } from "./bar.js";\nimport { baz } from "../qux.js";\n`,
        },
      ],
    });
    expect(violations).toHaveLength(0);
  });

  it("matches subpath imports of a listed vendor (e.g. hono/middleware)", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [
        {
          path: "novel/foo/x.ts",
          source: `import { logger } from "hono/middleware";\n`,
        },
      ],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.vendor).toBe("hono");
  });

  it("ignores files outside novel/", () => {
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [{ path: "scripts/x.ts", source: `import "hono";\n` }],
    });
    expect(violations).toHaveLength(0);
  });

  it("reports each violation with file, line, and vendor", () => {
    const source = [
      "// header",
      'import { x } from "hono";',
      "",
      'const y = require("sqlite");',
    ].join("\n");
    const { violations } = checkDepCoverage({
      archMd: ARCH_WITH_HONO,
      files: [{ path: "novel/foo/leaks.ts", source }],
    });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({ file: "novel/foo/leaks.ts", line: 2, vendor: "hono" });
    expect(violations[1]).toEqual({ file: "novel/foo/leaks.ts", line: 4, vendor: "sqlite" });
  });
});
