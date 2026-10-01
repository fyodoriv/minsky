// Pure audit functions for the (cloud-agent × host-feature) configuration
// matrix. Catches drift between three surfaces that today can move
// independently:
//
//   1. `AGENT_MATRIX` in `scripts/lib/cloud-agent-config.mjs` — what the
//      resolver ACTUALLY knows (brief-delivery shape + model flag).
//   2. `scripts/lib/supported-agents.json` — the host-feature matrix
//      (cloud / local support) the AGENTS.md table renders for humans.
//   3. AGENTS.md § "Agent support matrix" — the documented schema the
//      operator reads first.
//
// The audit pattern is lifted verbatim from agentbrew PR #1023, which
// applied the same 4-dimension audit (path-schema × classification ×
// expected-surface × no-clash) to the (agent × non-MCP-sync-surface)
// matrix over 50+ agents. Here the surface is Minsky's cloud-agent
// contract. Adding a 4th cloud agent today means editing config.json,
// `cloud-agent-config.mjs`, the JSON sidecar, AND the AGENTS.md table —
// getting any one wrong silently breaks `--local` or the cloud-agent
// fallback. This module makes `supported-agents.json` + `AGENT_MATRIX`
// the secret-bearing module (Parnas 1972) so consumers can't drift past
// it, and the audit asserts the three surfaces agree.
//
// Pattern: pure decision functions over injected data (no I/O) — the
// caller (vitest spec OR standalone lint) supplies `{ matrix, sidecar,
// agentsMd }`; this module never reads the filesystem. Same seam shape
// as `run-pre-pr-lint-stack.mjs` (rule #2 — manifest is the seam, the
// runner is the boundary).
//
// Anchor: Parnas, "On the Criteria to Be Used in Decomposing Systems
// into Modules", CACM 15(12), 1972 (information hiding — secret the
// config decision behind one module). Wynne & Hellesøy, *The Cucumber
// Book* (2012) Ch. 1 (example-table-driven assertions). Sibling:
// agentbrew PR #1023 (same 4-dimension audit). Composes with vision
// rule #3 (test-first — the audit IS the test before implementation
// drifts) and rule #8 (pattern conformance — every supported agent must
// appear in the conformance index, of which this matrix is the
// executable form).

/**
 * One agent's host-feature classification, as declared in the JSON
 * sidecar `scripts/lib/supported-agents.json`.
 *
 * @typedef {Object} SidecarAgent
 * @property {string} id Canonical agent id (matches `AGENT_MATRIX[].id`).
 * @property {boolean} cloud Supports cloud (orchestrated) spawns.
 * @property {boolean} local Supports `--local` (zero-cloud-token) spawns.
 * @property {string} briefDelivery Brief-delivery shape (mirrors `AGENT_MATRIX`).
 * @property {string} modelFlag Flag the agent CLI accepts for `--model`.
 */

/**
 * One row parsed out of the AGENTS.md § "Agent support matrix" table.
 *
 * @typedef {Object} AgentsMdRow
 * @property {string} id Agent id from the first column (backticks stripped).
 * @property {boolean} cloud `true` when the Cloud column is non-empty / non-dash.
 * @property {boolean} local `true` when the Local column is non-empty / non-dash.
 */

/**
 * A single audit finding. `dimension` names which of the four audit
 * dimensions tripped; `message` names the offending agent(s) so the
 * operator can fix the drift without re-deriving which surface is wrong.
 *
 * @typedef {Object} AuditFinding
 * @property {"path-schema" | "classification" | "expected-surface" | "no-clash"} dimension
 * @property {string} message
 */

/** The four valid brief-delivery shapes. */
export const VALID_BRIEF_SHAPES = Object.freeze([
  "brief-file",
  "stdin",
  "prompt-file",
  "message-file",
]);

const MODEL_FLAG_PATTERN = /^--?[a-z][a-z0-9-]*$/;

/**
 * Parse the AGENTS.md § "Agent support matrix" markdown table into rows.
 * Read-only — never edits AGENTS.md. The parser is intentionally tight:
 * it locates the `**Agent support matrix:**` marker, then the header row
 * whose first column is `Agent`, skips the `|---|` separator, and reads
 * data rows until the first blank / non-table line. A cell counts as
 * "supported" when it is neither empty, a literal em-dash `—`, nor an
 * ASCII hyphen `-`. The yellow circle `🟡` (schema-accepted / planned)
 * counts as supported — the agent IS in the matrix, just gated.
 *
 * Pivot (TASKS.md): if this parser breaks ≥2× in the first month from
 * minor markdown reflow, the JSON sidecar becomes the sole source and a
 * separate script renders the table; the audit then drops the AGENTS.md
 * dimension. Threshold pinned in the task block.
 *
 * @param {string} agentsMd Full AGENTS.md text.
 * @returns {AgentsMdRow[]}
 */
export function parseAgentsMdMatrix(agentsMd) {
  const lines = agentsMd.split("\n");
  const markerIdx = lines.findIndex((l) => l.includes("**Agent support matrix:**"));
  if (markerIdx === -1) return [];
  const headerIdx = findHeaderRowIndex(lines, markerIdx + 1);
  if (headerIdx === -1) return [];
  return collectTableRows(lines, headerIdx + 1);
}

/**
 * @param {readonly string[]} lines
 * @param {number} startIdx First line index to scan from.
 * @returns {number} Index of the `| Agent | … |` header row, or -1.
 */
function findHeaderRowIndex(lines, startIdx) {
  for (let i = startIdx; i < lines.length; i += 1) {
    if (isHeaderRow((lines[i] ?? "").trim())) return i;
  }
  return -1;
}

/**
 * Read data rows until the first non-table line. Skips the `|---|`
 * separator and blank-id rows.
 *
 * @param {readonly string[]} lines
 * @param {number} startIdx First line index after the header row.
 * @returns {AgentsMdRow[]}
 */
function collectTableRows(lines, startIdx) {
  /** @type {AgentsMdRow[]} */
  const rows = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed.startsWith("|")) break; // table ended
    if (isSeparatorRow(trimmed)) continue;
    const cells = splitTableCells(trimmed);
    const id = stripCell(cells[0] ?? "");
    if (id.length === 0) continue;
    rows.push({ id, cloud: isSupported(cells[1]), local: isSupported(cells[2]) });
  }
  return rows;
}

/**
 * @param {string} trimmed
 * @returns {boolean}
 */
function isHeaderRow(trimmed) {
  if (!trimmed.startsWith("|")) return false;
  const cells = splitTableCells(trimmed);
  return stripCell(cells[0] ?? "").toLowerCase() === "agent";
}

/**
 * @param {string} trimmed
 * @returns {boolean}
 */
function isSeparatorRow(trimmed) {
  return /^\|[\s:|-]+\|?$/.test(trimmed);
}

/**
 * @param {string} trimmed A markdown table row beginning with `|`.
 * @returns {string[]} Cell contents (leading/trailing pipe edges dropped).
 */
function splitTableCells(trimmed) {
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|");
}

/**
 * @param {string} cell
 * @returns {string} Cell with surrounding whitespace and backticks removed.
 */
function stripCell(cell) {
  return cell.trim().replace(/`/g, "").trim();
}

/**
 * A support cell is "supported" unless it is empty or only a dash
 * (em-dash `—` or ASCII `-`). The yellow circle counts as supported.
 *
 * @param {string | undefined} cell
 * @returns {boolean}
 */
function isSupported(cell) {
  const v = (cell ?? "").trim();
  if (v.length === 0) return false; // empty cell → unsupported
  if (v === "—" || v === "-") return false;
  return true;
}

/**
 * Dimension 1 — path/argv schema well-formedness. For every sidecar
 * agent: `id` non-empty, `briefDelivery` is one of the four valid
 * shapes, `modelFlag` matches the flag pattern.
 *
 * @param {readonly SidecarAgent[]} sidecar
 * @returns {AuditFinding[]}
 */
export function auditPathSchema(sidecar) {
  /** @type {AuditFinding[]} */
  const findings = [];
  for (const a of sidecar) {
    if (typeof a.id !== "string" || a.id.length === 0) {
      findings.push({ dimension: "path-schema", message: "sidecar row has empty id" });
      continue;
    }
    if (!VALID_BRIEF_SHAPES.includes(a.briefDelivery)) {
      findings.push({
        dimension: "path-schema",
        message: `agent "${a.id}" has invalid briefDelivery "${a.briefDelivery}"`,
      });
    }
    if (!MODEL_FLAG_PATTERN.test(a.modelFlag)) {
      findings.push({
        dimension: "path-schema",
        message: `agent "${a.id}" has malformed modelFlag "${a.modelFlag}"`,
      });
    }
  }
  return findings;
}

/**
 * Dimension 2 — classification consistency between the JSON sidecar and
 * the canonical `AGENT_MATRIX`. Bidirectional orphan check: every
 * sidecar agent must have a matching `AGENT_MATRIX` row (and vice
 * versa), and the `briefDelivery` / `modelFlag` of matching rows must
 * agree. This is the dimension that fails when a developer adds a 4th
 * agent to `AGENT_MATRIX` but forgets the sidecar (or AGENTS.md table).
 *
 * @param {readonly SidecarAgent[]} sidecar
 * @param {readonly { id: string, briefDeliveryShape: string, modelFlag: string }[]} matrix
 * @param {readonly AgentsMdRow[]} agentsMdRows
 * @returns {AuditFinding[]}
 */
export function auditClassification(sidecar, matrix, agentsMdRows) {
  return [
    ...auditOrphans(sidecar, matrix, agentsMdRows),
    ...auditFieldConsistency(sidecar, matrix),
  ];
}

/**
 * One classification finding helper — keeps the message construction in
 * one place so the orphan checks stay flat.
 *
 * @param {string} message
 * @returns {AuditFinding}
 */
function classificationFinding(message) {
  return { dimension: "classification", message };
}

/**
 * Bidirectional orphan check across the three id sets. An id present in
 * one surface but absent from another is a finding, in both directions.
 *
 * @param {readonly SidecarAgent[]} sidecar
 * @param {readonly { id: string }[]} matrix
 * @param {readonly AgentsMdRow[]} agentsMdRows
 * @returns {AuditFinding[]}
 */
function auditOrphans(sidecar, matrix, agentsMdRows) {
  const sidecarIds = new Set(sidecar.map((a) => a.id));
  const matrixIds = new Set(matrix.map((r) => r.id));
  const mdIds = new Set(agentsMdRows.map((r) => r.id));
  return [
    ...missingFrom(
      sidecarIds,
      matrixIds,
      (id) => `agent "${id}" is in supported-agents.json but missing from AGENT_MATRIX`,
    ),
    ...missingFrom(
      sidecarIds,
      mdIds,
      (id) =>
        `agent "${id}" is in supported-agents.json but missing from AGENTS.md § "Agent support matrix" row`,
    ),
    ...missingFrom(
      matrixIds,
      sidecarIds,
      (id) => `agent "${id}" is an orphan in AGENT_MATRIX with no supported-agents.json row`,
    ),
    ...missingFrom(
      mdIds,
      sidecarIds,
      (id) => `agent "${id}" is an orphan AGENTS.md table row with no supported-agents.json entry`,
    ),
  ];
}

/**
 * For every id in `from` that is absent from `into`, build a
 * classification finding via `message`.
 *
 * @param {ReadonlySet<string>} from
 * @param {ReadonlySet<string>} into
 * @param {(id: string) => string} message
 * @returns {AuditFinding[]}
 */
function missingFrom(from, into, message) {
  /** @type {AuditFinding[]} */
  const findings = [];
  for (const id of from) {
    if (!into.has(id)) findings.push(classificationFinding(message(id)));
  }
  return findings;
}

/**
 * Field consistency: for every agent present in BOTH the sidecar and
 * AGENT_MATRIX, the briefDelivery / modelFlag must agree.
 *
 * @param {readonly SidecarAgent[]} sidecar
 * @param {readonly { id: string, briefDeliveryShape: string, modelFlag: string }[]} matrix
 * @returns {AuditFinding[]}
 */
function auditFieldConsistency(sidecar, matrix) {
  /** @type {AuditFinding[]} */
  const findings = [];
  for (const a of sidecar) {
    const row = matrix.find((r) => r.id === a.id);
    if (row === undefined) continue;
    if (row.briefDeliveryShape !== a.briefDelivery) {
      findings.push(
        classificationFinding(
          `agent "${a.id}" briefDelivery drift: sidecar="${a.briefDelivery}" AGENT_MATRIX="${row.briefDeliveryShape}"`,
        ),
      );
    }
    if (row.modelFlag !== a.modelFlag) {
      findings.push(
        classificationFinding(
          `agent "${a.id}" modelFlag drift: sidecar="${a.modelFlag}" AGENT_MATRIX="${row.modelFlag}"`,
        ),
      );
    }
  }
  return findings;
}

/**
 * Dimension 3 — expected-surface drift guard. The JSON sidecar's
 * `cloud` / `local` booleans must match the AGENTS.md table's Cloud /
 * Local columns for every agent present in both. Catches the case where
 * the docs say an agent is local-only but the sidecar claims cloud
 * support (or vice versa).
 *
 * @param {readonly SidecarAgent[]} sidecar
 * @param {readonly AgentsMdRow[]} agentsMdRows
 * @returns {AuditFinding[]}
 */
export function auditExpectedSurface(sidecar, agentsMdRows) {
  /** @type {AuditFinding[]} */
  const findings = [];
  for (const a of sidecar) {
    const row = agentsMdRows.find((r) => r.id === a.id);
    if (row === undefined) continue; // orphan caught by classification dim
    if (row.cloud !== a.cloud) {
      findings.push({
        dimension: "expected-surface",
        message: `agent "${a.id}" cloud-surface drift: sidecar=${a.cloud} AGENTS.md=${row.cloud}`,
      });
    }
    if (row.local !== a.local) {
      findings.push({
        dimension: "expected-surface",
        message: `agent "${a.id}" local-surface drift: sidecar=${a.local} AGENTS.md=${row.local}`,
      });
    }
  }
  return findings;
}

/**
 * Dimension 4 — no-clash. No two distinct agents may share an identical
 * `(briefDelivery, modelFlag)` argv contract. Catches the copy-paste
 * failure mode unique to argv contracts: two agents accidentally given
 * the same wire shape in the fixture. Each agent's contract must be
 * verbatim-unique.
 *
 * @param {readonly SidecarAgent[]} sidecar
 * @returns {AuditFinding[]}
 */
export function auditNoClash(sidecar) {
  /** @type {AuditFinding[]} */
  const findings = [];
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const a of sidecar) {
    const key = `${a.briefDelivery} ${a.modelFlag}`;
    const prior = seen.get(key);
    if (prior !== undefined) {
      findings.push({
        dimension: "no-clash",
        message: `agents "${prior}" and "${a.id}" share an identical argv contract (${a.briefDelivery}, ${a.modelFlag})`,
      });
    } else {
      seen.set(key, a.id);
    }
  }
  return findings;
}

/**
 * Run all four audit dimensions and return the concatenated findings.
 * Empty array ⇒ no drift.
 *
 * @param {Object} input
 * @param {readonly SidecarAgent[]} input.sidecar
 * @param {readonly { id: string, briefDeliveryShape: string, modelFlag: string }[]} input.matrix
 * @param {string} input.agentsMd Full AGENTS.md text.
 * @returns {AuditFinding[]}
 */
export function auditAll({ sidecar, matrix, agentsMd }) {
  const agentsMdRows = parseAgentsMdMatrix(agentsMd);
  return [
    ...auditPathSchema(sidecar),
    ...auditClassification(sidecar, matrix, agentsMdRows),
    ...auditExpectedSurface(sidecar, agentsMdRows),
    ...auditNoClash(sidecar),
  ];
}
