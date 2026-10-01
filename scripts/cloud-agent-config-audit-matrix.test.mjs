// Parameterized audit-matrix spec for the (cloud-agent × host-feature)
// configuration matrix. The executable form of the agentbrew PR #1023
// audit pattern, applied to Minsky's cloud-agent surface: four audit
// dimensions (path-schema × classification × expected-surface ×
// no-clash) looped over every agent in the real fixture matrix.
//
// Two halves:
//   1. GREEN-PATH parameterized assertions over the REAL surfaces
//      (AGENT_MATRIX + supported-agents.json + AGENTS.md). These pin
//      that the three surfaces agree today — ≥20 passing tests across
//      the 4 dimensions × 4 agents.
//   2. DRIFT-DETECTION assertions over MUTATED in-memory fixtures —
//      proving each dimension actually fails (and names the offender)
//      when a developer adds an agent to one surface but not another,
//      or copy-pastes an argv contract. These are the executable form
//      of the task's Acceptance Given/When/Then scenarios.
//
// History: originally specced for
// `novel/cross-repo-runner/test/cloud-agent-config-audit-matrix.test.ts`;
// that directory was deleted in phase-7b (PRs #878-#883). The canonical
// home for the cloud-agent matrix data + audit is now `scripts/lib/`, so
// this spec lives adjacent (vitest includes `scripts/**/*.test.mjs`).
//
// Anchor: Parnas 1972 (information hiding); Wynne & Hellesøy 2012 Ch. 1
// (example-table-driven assertions); agentbrew PR #1023 (sibling
// 4-dimension audit). Composes with vision rule #3 (test-first) and
// rule #8 (pattern conformance — this spec is the executable
// conformance index for supported agents).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { AGENT_MATRIX } from "./lib/cloud-agent-config.mjs";
import {
  auditAll,
  auditClassification,
  auditExpectedSurface,
  auditNoClash,
  auditPathSchema,
  parseAgentsMdMatrix,
  VALID_BRIEF_SHAPES,
} from "./lib/cloud-agent-matrix-audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** @type {{ agents: import("./lib/cloud-agent-matrix-audit.mjs").SidecarAgent[] }} */
const sidecarDoc = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "scripts/lib/supported-agents.json"), "utf8"),
);
const SIDECAR = sidecarDoc.agents;
const AGENTS_MD = readFileSync(resolve(REPO_ROOT, "AGENTS.md"), "utf8");
const MD_ROWS = parseAgentsMdMatrix(AGENTS_MD);

describe("Block 1 — Path/argv schema (per agent)", () => {
  for (const agent of SIDECAR) {
    test(`agent "${agent.id}" has a non-empty id`, () => {
      expect(agent.id.length).toBeGreaterThan(0);
    });
    test(`agent "${agent.id}" has a valid briefDelivery shape`, () => {
      expect(VALID_BRIEF_SHAPES).toContain(agent.briefDelivery);
    });
    test(`agent "${agent.id}" has a well-formed modelFlag`, () => {
      expect(agent.modelFlag).toMatch(/^--?[a-z][a-z0-9-]*$/);
    });
  }

  test("auditPathSchema returns no findings for the real sidecar", () => {
    expect(auditPathSchema(SIDECAR)).toEqual([]);
  });
});

describe("Block 2 — Carve-out classification (sidecar ↔ AGENT_MATRIX ↔ AGENTS.md)", () => {
  /** @type {Set<string>} */
  const matrixIds = new Set(AGENT_MATRIX.map((r) => r.id));
  /** @type {Set<string>} */
  const mdIds = new Set(MD_ROWS.map((r) => r.id));

  for (const agent of SIDECAR) {
    test(`agent "${agent.id}" appears in AGENT_MATRIX`, () => {
      expect(matrixIds.has(agent.id)).toBe(true);
    });
    test(`agent "${agent.id}" appears in the AGENTS.md support-matrix table`, () => {
      expect(mdIds.has(agent.id)).toBe(true);
    });
    test(`agent "${agent.id}" briefDelivery matches AGENT_MATRIX`, () => {
      const row = AGENT_MATRIX.find((r) => r.id === agent.id);
      expect(row?.briefDeliveryShape).toBe(agent.briefDelivery);
    });
  }

  test("no orphan AGENT_MATRIX rows (every matrix id has a sidecar entry)", () => {
    const sidecarIds = new Set(SIDECAR.map((a) => a.id));
    for (const id of matrixIds) expect(sidecarIds.has(id)).toBe(true);
  });

  test("no orphan AGENTS.md rows (every table id has a sidecar entry)", () => {
    const sidecarIds = new Set(SIDECAR.map((a) => a.id));
    for (const id of mdIds) expect(sidecarIds.has(id)).toBe(true);
  });

  test("auditClassification returns no findings for the real surfaces", () => {
    expect(auditClassification(SIDECAR, AGENT_MATRIX, MD_ROWS)).toEqual([]);
  });
});

describe("Block 3 — Expected-surface drift guard (cloud / local per agent)", () => {
  for (const agent of SIDECAR) {
    test(`agent "${agent.id}" cloud-support matches the AGENTS.md table`, () => {
      const row = MD_ROWS.find((r) => r.id === agent.id);
      expect(row).toBeDefined();
      expect(row?.cloud).toBe(agent.cloud);
    });
    test(`agent "${agent.id}" local-support matches the AGENTS.md table`, () => {
      const row = MD_ROWS.find((r) => r.id === agent.id);
      expect(row).toBeDefined();
      expect(row?.local).toBe(agent.local);
    });
  }

  test("every agent supports at least one host surface (cloud or local)", () => {
    for (const agent of SIDECAR) expect(agent.cloud || agent.local).toBe(true);
  });

  test("auditExpectedSurface returns no findings for the real surfaces", () => {
    expect(auditExpectedSurface(SIDECAR, MD_ROWS)).toEqual([]);
  });
});

describe("Block 4 — No-clash (each agent's argv contract is verbatim-unique)", () => {
  test("no two agents share an identical (briefDelivery, modelFlag) contract", () => {
    expect(auditNoClash(SIDECAR)).toEqual([]);
  });

  test("briefDelivery shapes are distinct across cloud-spawn agents", () => {
    const cloudShapes = SIDECAR.filter((a) => a.cloud).map((a) => a.briefDelivery);
    expect(new Set(cloudShapes).size).toBe(cloudShapes.length);
  });
});

describe("auditAll — full green path", () => {
  test("zero findings across all four dimensions on the real surfaces", () => {
    expect(auditAll({ sidecar: SIDECAR, matrix: AGENT_MATRIX, agentsMd: AGENTS_MD })).toEqual([]);
  });
});

// --- Drift-detection: the executable form of the task's Acceptance GWT ----

describe("Acceptance — drift detection over mutated fixtures", () => {
  test("adding an agent to AGENT_MATRIX without an AGENTS.md row trips classification", () => {
    const matrix = [
      ...AGENT_MATRIX,
      { id: "cursor", briefDeliveryShape: "stdin", modelFlag: "--model" },
    ];
    const findings = auditClassification(SIDECAR, matrix, MD_ROWS);
    expect(findings.some((f) => f.dimension === "classification")).toBe(true);
    expect(findings.some((f) => f.message.includes("cursor"))).toBe(true);
  });

  test("adding an AGENTS.md row without a sidecar entry trips classification (orphan)", () => {
    const mdRows = [...MD_ROWS, { id: "cursor", cloud: true, local: false }];
    const findings = auditClassification(SIDECAR, AGENT_MATRIX, mdRows);
    expect(findings.some((f) => f.dimension === "classification")).toBe(true);
    expect(findings.some((f) => f.message.includes("cursor"))).toBe(true);
  });

  test("removing aider from the matrix while it stays in the sidecar trips classification", () => {
    const matrix = AGENT_MATRIX.filter((r) => r.id !== "aider");
    const findings = auditClassification(SIDECAR, matrix, MD_ROWS);
    expect(findings.some((f) => f.message.includes("aider"))).toBe(true);
  });

  test("two agents sharing an argv contract trip no-clash and name both", () => {
    const sidecar = [
      { id: "claude", cloud: true, local: false, briefDelivery: "stdin", modelFlag: "--model" },
      { id: "twin", cloud: true, local: false, briefDelivery: "stdin", modelFlag: "--model" },
    ];
    const findings = auditNoClash(sidecar);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("claude");
    expect(findings[0]?.message).toContain("twin");
  });

  test("a cloud/local surface mismatch trips expected-surface", () => {
    const sidecar = [
      {
        id: "aider",
        cloud: true,
        local: true,
        briefDelivery: "message-file",
        modelFlag: "--model",
      },
    ];
    const mdRows = [{ id: "aider", cloud: false, local: true }];
    const findings = auditExpectedSurface(sidecar, mdRows);
    expect(findings.some((f) => f.dimension === "expected-surface")).toBe(true);
    expect(findings.some((f) => f.message.includes("aider"))).toBe(true);
  });

  test("an invalid briefDelivery shape trips path-schema", () => {
    const sidecar = [
      {
        id: "broken",
        cloud: true,
        local: false,
        briefDelivery: "carrier-pigeon",
        modelFlag: "--model",
      },
    ];
    const findings = auditPathSchema(sidecar);
    expect(findings.some((f) => f.dimension === "path-schema")).toBe(true);
    expect(findings.some((f) => f.message.includes("broken"))).toBe(true);
  });
});

describe("parseAgentsMdMatrix — read-only table parser", () => {
  test("extracts exactly the four documented agents", () => {
    expect(MD_ROWS.map((r) => r.id).sort()).toEqual(["aider", "claude", "devin", "openhands"]);
  });

  test("returns [] when the marker is absent", () => {
    expect(parseAgentsMdMatrix("no table here")).toEqual([]);
  });
});
