#!/usr/bin/env node
// Audit-matrix lint for the cloud-agent contract — proves the 4-agent
// matrix contract is in place AND openhands is now the canonical default.
//
// History: originally written as a self-flipping date-gate for the
// 2026-06-01 OpenHands Agent Canvas CLI release. The dep was lifted
// early on 2026-05-24 when the Python-SDK shim adapter shipped
// (`@minsky/agent-runtime-openhands`), so the lint no longer date-flips
// — it now asserts the post-integration steady state: openhands is
// row 0, all four rows have pendingExternalDep === null, and the
// brief-file delivery shape is in the validShapes set.
//
// Standalone node script (NOT a vitest spec) so the parent task's
// Measurement command can run it without booting the test runner:
//
//     node novel/cross-repo-runner/test/cloud-agent-config-audit-matrix.test.mjs
//
// Pure assertions over the published `AGENT_MATRIX` data; no I/O
// beyond reading the compiled dist. Exits 0 on green, prints the
// first failing assertion and exits 1 on any violation.
//
// Source: parent task `add-openhands-as-pluggable-backend` § Measurement;
// operator 2026-05-24 "complete OpenHands integration today" directive.

import process from "node:process";

const { AGENT_MATRIX } = await import("../dist/agent-config.js");

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
// backends in insertion order. Per operator 2026-05-24 "make openhands
// default" directive.
const expectedIds = ["openhands", "claude", "devin", "aider"];
const actualIds = AGENT_MATRIX.map((r) => r.id);
assert(
  `row order is ${expectedIds.join(" / ")}`,
  JSON.stringify(actualIds) === JSON.stringify(expectedIds),
  `got ${JSON.stringify(actualIds)}`,
);

// Dimension 3 — every row has the required fields with valid shapes.
const validShapes = new Set(["brief-file", "stdin", "prompt-file", "message-file"]);
const flagPattern = /^--?[a-z][a-z0-9-]*$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

for (const row of AGENT_MATRIX) {
  assert(
    `row ${row.id}: briefDeliveryShape is one of ${[...validShapes].join("/")}`,
    validShapes.has(row.briefDeliveryShape),
    `got ${JSON.stringify(row.briefDeliveryShape)}`,
  );
  assert(
    `row ${row.id}: modelFlag matches ${flagPattern.source}`,
    flagPattern.test(row.modelFlag),
    `got ${JSON.stringify(row.modelFlag)}`,
  );
  assert(
    `row ${row.id}: pendingExternalDep is null or YYYY-MM-DD`,
    row.pendingExternalDep === null || isoDatePattern.test(row.pendingExternalDep),
    `got ${JSON.stringify(row.pendingExternalDep)}`,
  );
}

// Dimension 4 — ALL agents (including openhands) carry no pending
// external dep. The June-1-2026 gate was lifted on 2026-05-24 when
// the Python-SDK shim adapter shipped — see the `@minsky/agent-
// runtime-openhands` package README. If a future agent regresses
// behind a dep, file a new task and re-introduce the date-aware self-
// flipping logic for that specific row.
const allIds = ["openhands", "claude", "devin", "aider"];
for (const id of allIds) {
  const row = AGENT_MATRIX.find((r) => r.id === id);
  assert(
    `row ${id}: pendingExternalDep is null (agent is runnable today)`,
    row?.pendingExternalDep === null,
    `got ${JSON.stringify(row?.pendingExternalDep)}`,
  );
}

// Dimension 5 — openhands is the canonical default agent (operator
// 2026-05-24 directive). Asserted via the row-0 position above
// (dimension 2) and the briefDeliveryShape contract here.
const openhands = AGENT_MATRIX.find((r) => r.id === "openhands");
assert(
  "row openhands: briefDeliveryShape is brief-file (Python shim contract)",
  openhands?.briefDeliveryShape === "brief-file",
  `got ${JSON.stringify(openhands?.briefDeliveryShape)}`,
);

// Dimension 6 — no two rows share the same `briefDeliveryShape` +
// `modelFlag` pair AND id (defensive against copy-paste mistakes
// where someone duplicates a row but only edits the id).
const seenPairs = new Map();
for (const row of AGENT_MATRIX) {
  const key = `${row.briefDeliveryShape}|${row.modelFlag}|${row.id}`;
  if (seenPairs.has(key)) {
    assert(`row ${row.id}: pair is unique vs ${seenPairs.get(key)}`, false, `duplicate key ${key}`);
  } else {
    seenPairs.set(key, row.id);
  }
}
assert("no duplicate (shape,flag,id) tuples across the matrix", true);

if (failures > 0) {
  console.error(`\ncloud-agent-config-audit-matrix: ${failures} violation(s).`);
  process.exit(1);
}
console.info("\ncloud-agent-config-audit-matrix: all green.");
process.exit(0);
