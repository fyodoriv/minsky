#!/usr/bin/env node
// Pattern: deterministic CI gate (rule #10) — the standalone form of the
// `scripts/cloud-agent-config-audit-matrix.test.mjs` vitest spec, so the
// (cloud-agent × host-feature) matrix audit can run inside
// `pnpm pre-pr-lint --stage=full` without booting the test runner.
//
// What it checks: the same four audit dimensions the spec exercises —
//   1. path-schema        — every supported-agents.json row is well-formed
//                           (non-empty id, valid briefDelivery, well-formed
//                           modelFlag).
//   2. classification     — supported-agents.json, AGENT_MATRIX, and
//                           AGENTS.md § "Agent support matrix" agree on the
//                           set of agents (no orphans in any direction) and
//                           on each agent's briefDelivery / modelFlag.
//   3. expected-surface   — supported-agents.json's cloud/local booleans
//                           match the AGENTS.md table's Cloud/Local columns.
//   4. no-clash           — no two agents share an identical
//                           (briefDelivery, modelFlag) argv contract.
//
// Surfaces audited:
//   - scripts/lib/supported-agents.json   (host-feature matrix sidecar)
//   - scripts/lib/cloud-agent-config.mjs  (AGENT_MATRIX — what the resolver
//                                          actually knows)
//   - AGENTS.md § "Agent support matrix"  (the documented schema)
//
// Why this gate exists: adding a 4th cloud agent today means editing
// `~/.minsky/config.json`, `cloud-agent-config.mjs`, the JSON sidecar,
// AND the AGENTS.md table; getting any one wrong silently breaks `--local`
// or the cloud-agent fallback, and the bug only surfaces on the next live
// daemon run. This lint moves time-to-detect from "next 10h daemon run"
// to "next CI run" (TASKS.md `cloud-agent-config-and-host-feature-matrix-
// audit` § Hypothesis). Sibling: agentbrew PR #1023 (same 4-dimension
// audit over 50+ agents).
//
// Pure assertions over injected data — the audit logic lives in
// `scripts/lib/cloud-agent-matrix-audit.mjs` (single source of truth
// shared with the vitest spec, rule #2). This file is the thin I/O
// boundary: read the three surfaces, run `auditAll`, print findings,
// exit non-zero on any drift.
//
// Exit codes:
//   0 — no drift across all four dimensions.
//   1 — ≥1 drift finding; each is printed with its dimension + the
//       offending agent(s).
//
// Anchor: Parnas, "On the Criteria to Be Used in Decomposing Systems
// into Modules", CACM 15(12), 1972 (information hiding); vision rule #10
// (deterministic enforcement); rule #3 (the audit IS the test before
// implementation drifts); rule #8 (pattern conformance — supported
// agents are the executable conformance index).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { AGENT_MATRIX } from "./lib/cloud-agent-config.mjs";
import { auditAll } from "./lib/cloud-agent-matrix-audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Read the three audited surfaces from disk.
 *
 * @param {string} [repoRoot]
 * @returns {{ sidecar: import("./lib/cloud-agent-matrix-audit.mjs").SidecarAgent[], agentsMd: string }}
 */
export function loadSurfaces(repoRoot = REPO_ROOT) {
  const sidecarDoc = JSON.parse(
    readFileSync(resolve(repoRoot, "scripts/lib/supported-agents.json"), "utf8"),
  );
  const agentsMd = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
  return { sidecar: sidecarDoc.agents, agentsMd };
}

/**
 * Pure: run the audit over the loaded surfaces. Extracted so a future
 * paired test can exercise the wiring without process exit.
 *
 * @param {{ sidecar: readonly import("./lib/cloud-agent-matrix-audit.mjs").SidecarAgent[], agentsMd: string }} surfaces
 * @returns {import("./lib/cloud-agent-matrix-audit.mjs").AuditFinding[]}
 */
export function runDriftAudit(surfaces) {
  return auditAll({
    sidecar: surfaces.sidecar,
    matrix: AGENT_MATRIX,
    agentsMd: surfaces.agentsMd,
  });
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  console.info("check-cloud-agent-matrix-drift");
  const findings = runDriftAudit(loadSurfaces());
  if (findings.length === 0) {
    console.info(
      "  ok    no drift across path-schema / classification / expected-surface / no-clash",
    );
    console.info("\nall green");
    process.exit(0);
  }
  for (const f of findings) {
    console.error(`  FAIL  [${f.dimension}] ${f.message}`);
  }
  console.error(`\n${findings.length} drift finding(s)`);
  process.exit(1);
}
