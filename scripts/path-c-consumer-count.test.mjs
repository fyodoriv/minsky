// Tests for path-c-consumer-count.mjs. Pattern: pure functions exercised over
// synthetic scan-hit fixtures (Meszaros 2007 — the scan seam is injected so the
// audit runs without touching the real filesystem), plus one live guard that
// the real repo audit still meets the pre-registered ≥3-zero-consumer threshold
// (rule #10: a regression that re-couples a candidate becomes a red test, not a
// silently-stale doc).

import { describe, expect, test } from "vitest";

import {
  auditCandidates,
  countConsumers,
  importEdgeRegex,
  PATH_C_CANDIDATES,
  renderTable,
  sortByDeletionCost,
  srcLoc,
  ZERO_CONSUMER_THRESHOLD,
  zeroConsumerRows,
} from "./path-c-consumer-count.mjs";

const TOKEN = PATH_C_CANDIDATES.find((c) => c.package === "token-monitor");
if (TOKEN === undefined) throw new Error("fixture invariant: token-monitor candidate missing");

describe("importEdgeRegex matches import/export edges, not comments or aliases", () => {
  const re = importEdgeRegex("@minsky/token-monitor");
  test("matches a named import", () => {
    expect(re.test('import { TokenMonitor } from "@minsky/token-monitor";')).toBe(true);
  });
  test("matches a re-export", () => {
    expect(re.test("export { x } from '@minsky/token-monitor';")).toBe(true);
  });
  test("matches a subpath import", () => {
    expect(re.test('import x from "@minsky/token-monitor/sub";')).toBe(true);
  });
  test("matches a dynamic import", () => {
    expect(re.test('await import("@minsky/token-monitor")')).toBe(true);
  });
  test("does NOT match a JSDoc header comment", () => {
    expect(re.test(" * `@minsky/token-monitor` — package entry.")).toBe(false);
  });
  test("does NOT match a vitest alias map entry", () => {
    expect(
      re.test('"@minsky/token-monitor": r("./novel/adapters/token-monitor/src/index.ts"),'),
    ).toBe(false);
  });
  test("does NOT match a different package with a shared prefix", () => {
    // `@minsky/token-monitor-x` must not satisfy the `@minsky/token-monitor` edge.
    expect(re.test('import x from "@minsky/token-monitor-x";')).toBe(false);
  });
});

describe("countConsumers filters self-references and the alias map", () => {
  test("an external import counts as one consumer", () => {
    const hits = [
      {
        file: "novel/tick-loop/src/foo.ts",
        line: 3,
        text: 'import { T } from "@minsky/token-monitor";',
      },
    ];
    const r = countConsumers(TOKEN, hits);
    expect(r.count).toBe(1);
    expect(r.consumers).toEqual(["novel/tick-loop/src/foo.ts"]);
  });

  test("a self-directory import is NOT a consumer", () => {
    const hits = [
      {
        file: "novel/adapters/token-monitor/src/index.ts",
        line: 1,
        text: 'export * from "@minsky/token-monitor/internal";',
      },
    ];
    expect(countConsumers(TOKEN, hits).count).toBe(0);
  });

  test("the vitest alias map line is NOT a consumer", () => {
    const hits = [
      {
        file: "vitest.config.ts",
        line: 18,
        text: '"@minsky/token-monitor": r("./novel/adapters/token-monitor/src/index.ts"),',
      },
    ];
    expect(countConsumers(TOKEN, hits).count).toBe(0);
  });

  test("a header-comment mention is NOT a consumer", () => {
    const hits = [
      {
        file: "novel/adapters/notifier/src/index.ts",
        line: 9,
        text: " * mirrors `@minsky/token-monitor`'s pattern",
      },
    ];
    expect(countConsumers(TOKEN, hits).count).toBe(0);
  });

  test("multiple imports in one file count as a single consumer (file is the migration unit)", () => {
    const hits = [
      {
        file: "novel/mape-k-loop/src/a.ts",
        line: 1,
        text: 'import { A } from "@minsky/token-monitor";',
      },
      {
        file: "novel/mape-k-loop/src/a.ts",
        line: 2,
        text: 'import type { B } from "@minsky/token-monitor";',
      },
    ];
    expect(countConsumers(TOKEN, hits).count).toBe(1);
  });
});

describe("auditCandidates is pure over an injected scan seam", () => {
  /** A scan that gives competitive-benchmark exactly one external consumer. */
  const scanImports = () => [
    {
      file: "novel/tick-loop/src/x.ts",
      line: 1,
      text: 'import { run } from "@minsky/competitive-benchmark";',
    },
  ];
  const fileExists = () => true;

  test("maps every candidate to a row", () => {
    const rows = auditCandidates({ scanImports, fileExists });
    expect(rows.map((r) => r.package).sort()).toEqual(
      [...PATH_C_CANDIDATES].map((c) => c.package).sort(),
    );
  });

  test("a coupled candidate gets consumer_count > 0 with its consumer listed", () => {
    const rows = auditCandidates({ scanImports, fileExists });
    const cb = rows.find((r) => r.package === "competitive-benchmark");
    expect(cb?.consumer_count).toBe(1);
    expect(cb?.consumers).toEqual(["novel/tick-loop/src/x.ts"]);
  });

  test("the other candidates stay at zero consumers under this scan", () => {
    const rows = auditCandidates({ scanImports, fileExists });
    expect(
      zeroConsumerRows(rows)
        .map((r) => r.package)
        .sort(),
    ).toEqual(["dashboard-web", "token-monitor"]);
  });
});

describe("sortByDeletionCost orders cheapest-first", () => {
  /** @type {import("./path-c-consumer-count.mjs").AuditRow[]} */
  const rows = [
    {
      package: "b",
      name: "@minsky/b",
      dir: "novel/b",
      fate: "delete",
      consumer_count: 2,
      consumers: [],
      exists: true,
      src_loc: 100,
    },
    {
      package: "a",
      name: "@minsky/a",
      dir: "novel/a",
      fate: "delete",
      consumer_count: 0,
      consumers: [],
      exists: true,
      src_loc: 900,
    },
    {
      package: "c",
      name: "@minsky/c",
      dir: "novel/c",
      fate: "fold",
      consumer_count: 0,
      consumers: [],
      exists: true,
      src_loc: 200,
    },
  ];
  test("zero-consumer rows precede coupled rows", () => {
    expect(sortByDeletionCost(rows).map((r) => r.package)).toEqual(["c", "a", "b"]);
  });
  test("zero-consumer ties break by ascending src_loc (rule #9 Pivot ordering)", () => {
    const zero = sortByDeletionCost(rows).filter((r) => r.consumer_count === 0);
    expect(zero.map((r) => r.src_loc)).toEqual([200, 900]);
  });
});

describe("srcLoc returns 0 for an already-deleted package", () => {
  test("a missing src dir yields zero LOC", () => {
    expect(srcLoc("/repo", "novel/gone", () => false)).toBe(0);
  });
});

describe("renderTable reflects the pre-registered threshold verdict", () => {
  test("announces the deletion-sweep verdict when ≥3 zero-consumer rows exist", () => {
    const rows = auditCandidates({ scanImports: () => [], fileExists: () => true });
    const out = renderTable(rows);
    expect(out).toContain(`Success threshold ≥ ${ZERO_CONSUMER_THRESHOLD}`);
    expect(out).toContain("queue these for the next deletion sweep");
  });
});

describe("live guard: the real repo audit still meets the pre-registered threshold", () => {
  test("≥3 Path-C candidates have zero external consumers", () => {
    const rows = auditCandidates();
    expect(zeroConsumerRows(rows).length).toBeGreaterThanOrEqual(ZERO_CONSUMER_THRESHOLD);
  });
});
