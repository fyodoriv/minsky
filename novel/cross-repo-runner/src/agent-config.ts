// Per-machine cloud-agent matrix and resolver for the cross-repo runner.
//
// Source: TASKS.md `openhands-config-schema-pre-june-1` — schema-half
// of the 4-agent contract per the parent P0
// `add-openhands-as-pluggable-backend`. Pre-June-1 the openhands row
// carries a `pendingExternalDep: "2026-06-01"` discriminator; the
// daemon REFUSES to spawn under that config (exit 64) with an
// actionable error, never silently falling back to a different agent.
// Post-June-1 the field flips to null and the same row becomes live.
//
// Pattern: pure data table + pure resolver function — testable without
// mocking the host process, exported for the `cloud-agent-config-audit-
// matrix-test` lint (sibling task) to assert the 4-row contract.

/**
 * Brief-delivery shape a cloud agent expects:
 *
 *   - `stdin` — Claude Code / OpenHands read from stdin (child.stdin.end)
 *   - `prompt-file` — Devin reads from a temp file via `--prompt-file`
 *     (devin panics on stdin pipe as of 2026.5.6-8)
 *   - `message-file` — aider reads from a `--message-file` argument
 */
export type BriefDeliveryShape = "stdin" | "prompt-file" | "message-file";

/**
 * One row in the per-machine cloud-agent support matrix. Each row is
 * the source-of-truth for one agent's wire shape; the `pendingExternalDep`
 * field is non-null when the agent is contractually accepted but its
 * runtime dep has not yet shipped (e.g. openhands awaiting the
 * Agent Canvas Initiative CLI release on 2026-06-01).
 */
export interface AgentMatrixRow {
  /** Canonical agent id used in `~/.minsky/config.json` `cloud_agent`. */
  id: "claude" | "devin" | "aider" | "openhands";
  /** How the brief is delivered to the agent process. */
  briefDeliveryShape: BriefDeliveryShape;
  /** Flag name the agent CLI accepts for `--model <name>` pass-through. */
  modelFlag: string;
  /**
   * `null` when the agent is runnable today. A `YYYY-MM-DD` ISO date
   * when the agent is contractually accepted by the matrix but its
   * runtime CLI / dep has not yet shipped — `resolveCloudAgent` returns
   * `status: "pending-external-dep"` for these rows and the daemon
   * refuses to spawn (exit 64) with the actionable error.
   */
  pendingExternalDep: string | null;
}

/**
 * The canonical 4-row cloud-agent matrix. Order is meaningful: shipped
 * agents first (claude / devin / aider), then pending agents
 * (openhands). The `cloud-agent-config-audit-matrix-test` lint asserts
 * exactly these four rows in this order.
 *
 * Source: parent task `add-openhands-as-pluggable-backend` § Touches
 * (this is the schema-half of the agent matrix change);
 * `docs/plans/2026-05-22-path-c-openhands-reshape.md` § Phase 1.
 */
export const AGENT_MATRIX: readonly AgentMatrixRow[] = [
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
  {
    id: "openhands",
    briefDeliveryShape: "stdin",
    modelFlag: "--model",
    pendingExternalDep: "2026-06-01",
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
 */
export type AgentResolution =
  | { status: "ok"; agent: AgentMatrixRow["id"]; row: AgentMatrixRow }
  | {
      status: "pending-external-dep";
      agent: AgentMatrixRow["id"];
      row: AgentMatrixRow;
      error: string;
    }
  | { status: "unknown"; error: string };

/**
 * Resolve the operator's `cloud_agent` setting against the matrix.
 * Lower-cases the input, looks up the matrix row, and returns the
 * three-way outcome. Pure function — no I/O, no process exit; the
 * caller is responsible for printing `error` and calling `process.exit`
 * so the resolver itself stays test-pure.
 *
 * Priority (matches `bin/minsky-run.mjs` readSpawnCommand):
 *   1. `envValue` — MINSKY_CLOUD_AGENT one-session override
 *   2. `configValue` — `~/.minsky/config.json` `cloud_agent`
 *   3. `defaultAgent` — fallback (default: `"claude"`)
 *
 * @otel-exempt pure resolver — no I/O, no state.
 */
export function resolveCloudAgent(input: {
  envValue: string | undefined;
  configValue: string | undefined;
  defaultAgent?: AgentMatrixRow["id"];
}): AgentResolution {
  const fallback = input.defaultAgent ?? "claude";
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
