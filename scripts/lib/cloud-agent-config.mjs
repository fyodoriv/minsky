// <!-- scope: human-approved phase-7b-delete-cross-repo-runner-multistep step 3 — ports the cloud-agent matrix data + resolver out of `novel/cross-repo-runner/src/agent-config.ts` (deletion target) to `scripts/lib/` (canonical home). Not a new public artefact; the original at `novel/cross-repo-runner/src/agent-config.ts` is the equivalent surface. -->
// Per-machine cloud-agent matrix and resolver — the source-of-truth
// data table for which agent runtimes Minsky supports and how each
// expects its brief delivered.
//
// History: originally `novel/cross-repo-runner/src/agent-config.ts`.
// Ported to .mjs / JSDoc in PR #879 (phase-7b step 3) as the TS runner
// is being deleted (phase-7b-delete-cross-repo-runner-multistep).
// The runtime / bash skeleton (`bin/minsky-run.sh`) hard-codes
// `openhands` as the spawn target, so the matrix is now LINT-ONLY:
// it documents the contract (4 rows, openhands first, brief-file
// delivery shape) and the audit-matrix lint asserts the design
// intent. No production code path reads from it.
//
// Source: operator 2026-05-22 directive (Path C reshape) and 2026-05-24
// "complete OpenHands integration today" directive. OpenHands is the
// canonical agent runtime — first row, default agent. The legacy
// claude / devin / aider rows remain as documented opt-in fallbacks but
// are no longer the default. The 2026-06-01 `pendingExternalDep` was
// lifted on 2026-05-24 once the Python-SDK shim adapter shipped
// (`@minsky/agent-runtime-openhands`); the substrate-only gate is
// gone, integration is real.
//
// Pattern: pure data table + pure resolver function — testable without
// mocking the host process. Exported for the
// `cloud-agent-config-audit-matrix-lint` script to assert the 4-row
// contract and for the paired vitest unit test
// (`cloud-agent-config.test.mjs`) to assert resolver semantics.

/**
 * Brief-delivery shape a cloud agent expects:
 *
 *   - `brief-file` — OpenHands (via the shim) reads from `--brief-file`
 *   - `stdin` — Claude Code reads from stdin (child.stdin.end)
 *   - `prompt-file` — Devin reads from a temp file via `--prompt-file`
 *     (devin panics on stdin pipe as of 2026.5.6-8)
 *   - `message-file` — aider reads from a `--message-file` argument
 *
 * @typedef {"brief-file" | "stdin" | "prompt-file" | "message-file"} BriefDeliveryShape
 */

/**
 * One row in the per-machine cloud-agent support matrix. Each row is
 * the source-of-truth for one agent's wire shape; the
 * `pendingExternalDep` field is non-null when the agent is
 * contractually accepted but its runtime dep has not yet shipped
 * (e.g. openhands awaiting the Agent Canvas Initiative CLI release
 * on 2026-06-01).
 *
 * @typedef {Object} AgentMatrixRow
 * @property {"claude" | "devin" | "aider" | "openhands"} id Canonical agent id used in `~/.minsky/config.json` `cloud_agent`.
 * @property {BriefDeliveryShape} briefDeliveryShape How the brief is delivered.
 * @property {string} modelFlag Flag name the agent CLI accepts for `--model <name>` pass-through.
 * @property {string | null} pendingExternalDep `null` when runnable today; `YYYY-MM-DD` ISO date when contractually accepted but runtime CLI not yet shipped.
 */

/**
 * The canonical 4-row cloud-agent matrix. Order is meaningful: the
 * default agent (openhands) is first, then legacy backends in the
 * order they were originally added. The
 * `cloud-agent-config-audit-matrix-lint` script asserts exactly these
 * four rows in this order.
 *
 * Source: operator 2026-05-22 Path C directive + 2026-05-24 "make
 * openhands default, integrate completely today" directive.
 * `docs/plans/2026-05-22-path-c-openhands-reshape.md` § Phase 1.
 *
 * @type {readonly AgentMatrixRow[]}
 */
export const AGENT_MATRIX = [
  {
    id: "openhands",
    briefDeliveryShape: "brief-file",
    modelFlag: "--model",
    pendingExternalDep: null,
  },
  {
    id: "claude",
    briefDeliveryShape: "stdin",
    modelFlag: "--model",
    pendingExternalDep: null,
  },
  {
    id: "devin",
    briefDeliveryShape: "prompt-file",
    modelFlag: "--model",
    pendingExternalDep: null,
  },
  {
    id: "aider",
    briefDeliveryShape: "message-file",
    modelFlag: "--model",
    pendingExternalDep: null,
  },
];

/**
 * Result of resolving the operator's requested cloud agent to one of
 * the matrix rows. Three terminal states:
 *
 *   - `status: "ok"` — agent is runnable; caller proceeds to spawn.
 *   - `status: "pending-external-dep"` — agent is contractually
 *     accepted but its runtime CLI has not shipped; caller MUST print
 *     `error` and exit with EX_USAGE (64). Never silently fall back.
 *   - `status: "unknown"` — operator typed an agent id the matrix
 *     does not know; caller MUST print `error` and exit 64.
 *
 * @typedef {Object} AgentResolutionOk
 * @property {"ok"} status
 * @property {AgentMatrixRow["id"]} agent
 * @property {AgentMatrixRow} row
 *
 * @typedef {Object} AgentResolutionPendingExternalDep
 * @property {"pending-external-dep"} status
 * @property {AgentMatrixRow["id"]} agent
 * @property {AgentMatrixRow} row
 * @property {string} error
 *
 * @typedef {Object} AgentResolutionUnknown
 * @property {"unknown"} status
 * @property {string} error
 *
 * @typedef {AgentResolutionOk | AgentResolutionPendingExternalDep | AgentResolutionUnknown} AgentResolution
 */

/**
 * Resolve the operator's `cloud_agent` setting against the matrix.
 * Lower-cases the input, looks up the matrix row, and returns the
 * three-way outcome. Pure function — no I/O, no process exit; the
 * caller is responsible for printing `error` and calling `process.exit`
 * so the resolver itself stays test-pure.
 *
 * Priority (matches the legacy TS readSpawnCommand):
 *   1. `envValue` — MINSKY_CLOUD_AGENT one-session override
 *   2. `configValue` — `~/.minsky/config.json` `cloud_agent`
 *   3. `defaultAgent` — fallback (default: `"openhands"` as of 2026-05-24)
 *
 * @otel-exempt pure resolver — no I/O, no state.
 *
 * @param {Object} input
 * @param {string | undefined} input.envValue
 * @param {string | undefined} input.configValue
 * @param {AgentMatrixRow["id"]} [input.defaultAgent]
 * @returns {AgentResolution}
 */
export function resolveCloudAgent(input) {
  // Default agent flipped on 2026-05-24 per the operator's
  // "make openhands default" directive — OpenHands is now Minsky's
  // canonical agent runtime; the prior default has been retired.
  // Legacy backends remain valid via explicit `cloud_agent` config or
  // `MINSKY_CLOUD_AGENT` env override.
  const fallback = input.defaultAgent ?? "openhands";
  const raw = (input.envValue ?? input.configValue ?? fallback).toLowerCase();
  const row = AGENT_MATRIX.find((r) => r.id === raw);
  if (row === undefined) {
    const validIds = AGENT_MATRIX.map((r) => r.id).join(", ");
    return {
      status: "unknown",
      error: `Unknown cloud_agent "${raw}". Valid: ${validIds}.`,
    };
  }
  if (row.pendingExternalDep !== null) {
    return {
      status: "pending-external-dep",
      agent: row.id,
      row,
      error: `cloud_agent="${row.id}" not yet runnable; waiting for ${row.id} CLI release on ${row.pendingExternalDep} (GHE issue OpenHands/OpenHands#14374). Switch to cloud_agent="claude" or "devin" until then.`,
    };
  }
  return { status: "ok", agent: row.id, row };
}
