#!/usr/bin/env node
// <!-- scope: human-approved phase-7b-delete-cross-repo-runner-multistep step 3 — ports the existing audit lint out of `novel/cross-repo-runner/test/` (deletion target) to `scripts/` (canonical home). Not a new public artefact; the original at `novel/cross-repo-runner/test/cloud-agent-config-audit-matrix.test.mjs` is the equivalent surface. -->
// Audit-matrix lint for the cloud-agent contract — proves the 4-agent
// matrix contract is in place AND openhands is the canonical default.
//
// History: originally at
// `novel/cross-repo-runner/test/cloud-agent-config-audit-matrix.test.mjs`,
// imported from the compiled `dist/agent-config.js`. Ported in PR #879
// (phase-7b step 3) to source directly from
// `scripts/lib/cloud-agent-config.mjs` — no compile step needed, lives
// adjacent to the source-of-truth data, and survives the deletion of
// `novel/cross-repo-runner/` in step 5.
//
// Originally written as a self-flipping date-gate for the 2026-06-01
// OpenHands Agent Canvas CLI release. The dep was lifted on 2026-05-24
// when the Python-SDK shim adapter shipped
// (`@minsky/agent-runtime-openhands`), so the lint no longer date-flips
// — it now asserts the post-integration steady state: openhands is
// row 0, all four rows have pendingExternalDep === null, and the
// brief-file delivery shape is in the validShapes set.
//
// Standalone node script (NOT a vitest spec) so the parent task's
// Measurement command can run it without booting the test runner:
//
//     node scripts/cloud-agent-config-audit-matrix-lint.mjs
//
// Pure assertions over the published `AGENT_MATRIX` data; no I/O
// beyond reading the source module. Exits 0 on green, prints the
// first failing assertion and exits 1 on any violation.
//
// Source: parent task `add-openhands-as-pluggable-backend` § Measurement;
// operator 2026-05-24 "complete OpenHands integration today" directive.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { AGENT_MATRIX } from "./lib/cloud-agent-config.mjs";
import { auditAll } from "./lib/cloud-agent-matrix-audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

let failures = 0;

/**
 * @param {string} label
 * @param {boolean} condition
 * @param {string} [detail]
 */
function assert(label, condition, detail) {
  if (condition) {
    console.info(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
}

console.info("cloud-agent-config-audit-matrix");

// Dimension 1 — row count.
assert("matrix has exactly 4 rows", AGENT_MATRIX.length === 4, `got ${AGENT_MATRIX.length}`);

// Dimension 2 — row order is openhands (default) first, then legacy
// claude / devin / aider in the order they were added.
const expectedOrder = ["openhands", "claude", "devin", "aider"];
const observedOrder = AGENT_MATRIX.map((r) => r.id);
assert(
  "row order is openhands / claude / devin / aider",
  JSON.stringify(observedOrder) === JSON.stringify(expectedOrder),
  `expected ${expectedOrder.join(",")} got ${observedOrder.join(",")}`,
);

// Dimension 3 — openhands is at index 0 (canonical default).
assert(
  "openhands is row 0 (canonical default since 2026-05-24)",
  AGENT_MATRIX[0]?.id === "openhands",
  `row 0 = ${AGENT_MATRIX[0]?.id ?? "<undefined>"}`,
);

// Dimension 4 — every row has a valid briefDeliveryShape.
const validShapes = new Set(["brief-file", "stdin", "prompt-file", "message-file"]);
for (const row of AGENT_MATRIX) {
  assert(
    `row "${row.id}" has valid briefDeliveryShape`,
    validShapes.has(row.briefDeliveryShape),
    row.briefDeliveryShape,
  );
}

// Dimension 5 — every row's modelFlag matches the flag pattern.
const flagPattern = /^--?[a-z][a-z0-9-]*$/;
for (const row of AGENT_MATRIX) {
  assert(
    `row "${row.id}" has well-formed modelFlag`,
    flagPattern.test(row.modelFlag),
    row.modelFlag,
  );
}

// Dimension 6 — all four agents have pendingExternalDep === null
// (integration complete). The 2026-06-01 dep was lifted on
// 2026-05-24 when the Python-SDK shim adapter shipped.
for (const row of AGENT_MATRIX) {
  assert(
    `row "${row.id}" has pendingExternalDep === null (post-integration steady state)`,
    row.pendingExternalDep === null,
    `pendingExternalDep=${row.pendingExternalDep}`,
  );
}

// Dimension 7 — openhands row uses brief-file delivery shape
// (via Python shim adapter).
const openhandsRow = AGENT_MATRIX.find((r) => r.id === "openhands");
assert(
  "openhands row uses brief-file delivery shape (via Python shim)",
  openhandsRow?.briefDeliveryShape === "brief-file",
  openhandsRow?.briefDeliveryShape,
);

// Dimension 8 — every row's pendingExternalDep is null or a
// YYYY-MM-DD ISO date (defensive — if a future dep is added,
// the format is asserted).
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
for (const row of AGENT_MATRIX) {
  if (row.pendingExternalDep !== null) {
    assert(
      `row "${row.id}" pendingExternalDep is YYYY-MM-DD ISO`,
      isoDate.test(row.pendingExternalDep),
      row.pendingExternalDep,
    );
  }
}

// Dimensions 9-12 — the (cloud-agent × host-feature) drift audit
// (TASKS.md `cloud-agent-config-and-host-feature-matrix-audit`). Runs
// the same four audit dimensions as
// `scripts/cloud-agent-config-audit-matrix.test.mjs` (path-schema ×
// classification × expected-surface × no-clash) over the three live
// surfaces — `supported-agents.json`, `AGENT_MATRIX`, and the AGENTS.md
// § "Agent support matrix" table — so a config↔implementation↔docs
// drift fails `pnpm pre-pr-lint` rather than waiting for the next live
// daemon run. The standalone form lives at
// `scripts/check-cloud-agent-matrix-drift.mjs`; folding it here keeps it
// in the manifest step that already runs (no new CI job, no parity
// drift). The audit logic is shared via
// `scripts/lib/cloud-agent-matrix-audit.mjs` (rule #2 — single seam).
const sidecar = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "scripts/lib/supported-agents.json"), "utf8"),
).agents;
const agentsMd = readFileSync(resolve(REPO_ROOT, "AGENTS.md"), "utf8");
const driftFindings = auditAll({ sidecar, matrix: AGENT_MATRIX, agentsMd });
assert(
  "no (agent × host-feature) drift across supported-agents.json / AGENT_MATRIX / AGENTS.md",
  driftFindings.length === 0,
  driftFindings.map((f) => `[${f.dimension}] ${f.message}`).join("; "),
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.info("\nall green");
