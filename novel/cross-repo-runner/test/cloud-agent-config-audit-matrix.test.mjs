#!/usr/bin/env node
// Audit-matrix lint for the cloud-agent contract — referenced from
// `add-openhands-as-pluggable-backend` § Measurement as the green-on-
// June-1 gate that proves the 4-agent contract is in place AND
// the openhands row's `pendingExternalDep` flag has flipped to null
// on/after the OpenHands Agent Canvas Initiative CLI release.
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
// sibling `openhands-config-schema-pre-june-1` (ships AGENT_MATRIX).

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

// Dimension 2 — row order is the canonical claude / devin / aider / openhands.
const expectedIds = ["claude", "devin", "aider", "openhands"];
const actualIds = AGENT_MATRIX.map((r) => r.id);
assert(
  `row order is ${expectedIds.join(" / ")}`,
  JSON.stringify(actualIds) === JSON.stringify(expectedIds),
  `got ${JSON.stringify(actualIds)}`,
);

// Dimension 3 — every row has the required fields with valid shapes.
const validShapes = new Set(["stdin", "prompt-file", "message-file"]);
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

// Dimension 4 — shipped agents (claude, devin, aider) carry no
// pendingExternalDep. The openhands row is permitted to carry it until
// the OpenHands Agent Canvas CLI release.
const shippedIds = ["claude", "devin", "aider"];
for (const id of shippedIds) {
  const row = AGENT_MATRIX.find((r) => r.id === id);
  assert(
    `row ${id}: pendingExternalDep is null (agent is runnable today)`,
    row?.pendingExternalDep === null,
    `got ${JSON.stringify(row?.pendingExternalDep)}`,
  );
}

// Dimension 5 — openhands row carries the expected pending date until
// 2026-06-01 passes; after that, the row must have flipped to null.
// This is what makes the gate self-flipping: today the assertion
// reads "openhands.pendingExternalDep === '2026-06-01'"; on June 2 it
// reads "openhands.pendingExternalDep === null" automatically. The
// transition itself is the operator's job — the lint refuses to be
// green during the gap.
const openhands = AGENT_MATRIX.find((r) => r.id === "openhands");
const today = new Date().toISOString().slice(0, 10);
const RELEASE_DATE = "2026-06-01";
if (today < RELEASE_DATE) {
  assert(
    `row openhands: pendingExternalDep is "${RELEASE_DATE}" (pre-release; today is ${today})`,
    openhands?.pendingExternalDep === RELEASE_DATE,
    `got ${JSON.stringify(openhands?.pendingExternalDep)}`,
  );
} else {
  assert(
    `row openhands: pendingExternalDep is null (post-release; today is ${today} >= ${RELEASE_DATE})`,
    openhands?.pendingExternalDep === null,
    `got ${JSON.stringify(openhands?.pendingExternalDep)} — flip the matrix row's pendingExternalDep to null now that the OpenHands Agent Canvas CLI has shipped`,
  );
}

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
