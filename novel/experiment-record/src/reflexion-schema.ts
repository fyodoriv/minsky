/**
 * Episodic-memory schema for Minsky's iteration ledger, structured around
 * Reflexion's verbal-reinforcement memory entry.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:    episodic memory entry for an LLM self-improvement loop —
 *                     state → action → outcome → reflection, one entry per
 *                     iteration, recalled into the next attempt's context.
 *                     Shinn et al. 2023 (Reflexion: Language Agents with
 *                     Verbal Reinforcement Learning, NeurIPS 2023).
 *   - Validator shape: schema check → semantic check (non-empty fields,
 *                     enum outcome), mirroring the sibling `parse.ts`
 *                     three-stage pipeline. No new dependency: the
 *                     hand-rolled validation matches `parse.ts` rather than
 *                     introducing Zod (which would require a rule #2 adapter).
 *                     Conformance: full.
 *
 * Why this exists: user-story-003's closed-loop MAPE-K needs a published
 * pattern to instantiate its reflection step against. `@minsky/experiment-record`
 * already carries the pre-registration record (rule #9); this adds the
 * post-iteration *reflection* record so the experiment-store doubles as
 * Reflexion's episodic memory.
 */

/**
 * The outcome of a single iteration, as Reflexion scores it. Reflexion's
 * environment returns a scalar/binary reward; we discretise it into the three
 * verdicts the tick-loop already distinguishes (a PR shipped, the iteration
 * produced no shippable change, or the iteration crashed / was killed).
 */
export type ReflexionOutcome = "success" | "failure" | "partial";

const REFLEXION_OUTCOMES: readonly ReflexionOutcome[] = ["success", "failure", "partial"];

/**
 * One episodic-memory entry, mirroring Reflexion's memory unit. The four
 * load-bearing fields are the trajectory triple plus the reflection:
 *   - `state`      — the situation the agent observed (Reflexion's trajectory
 *                    summary / task context for the attempt).
 *   - `action`     — what the agent did (the attempted trajectory).
 *   - `outcome`    — the environment's verdict (Reflexion's reward signal).
 *   - `reflection` — the agent's verbal self-critique derived from the
 *                    outcome, recalled into the next attempt (the core of
 *                    Reflexion's verbal reinforcement).
 */
export interface ReflexionMemoryEntry {
  /** Kebab-case id of the iteration / task this memory belongs to. */
  readonly id: string;
  /** Situation observed at the start of the attempt. */
  readonly state: string;
  /** What the agent attempted. */
  readonly action: string;
  /** The environment's verdict on the attempt. */
  readonly outcome: ReflexionOutcome;
  /** Verbal self-critique recalled into the next attempt. */
  readonly reflection: string;
}

export type ReflexionParseErrorKind =
  | "not-a-mapping"
  | "missing-required-field"
  | "field-too-short"
  | "invalid-id-format"
  | "invalid-outcome"
  | "unknown-field";

export interface ReflexionParseError {
  readonly kind: ReflexionParseErrorKind;
  readonly message: string;
  readonly field?: string;
}

export type ReflexionParseResult =
  | { readonly ok: true; readonly entry: ReflexionMemoryEntry }
  | { readonly ok: false; readonly errors: readonly ReflexionParseError[] };

/** The four trajectory/reflection fields plus the id. */
const REQUIRED_STRING_FIELDS = ["id", "state", "action", "reflection"] as const;
const ALL_FIELDS = [...REQUIRED_STRING_FIELDS, "outcome"] as const;

/**
 * Minimum lengths. Reflexion's reflections are short natural-language
 * sentences; an empty or trivially-short reflection carries no signal for the
 * next attempt, so we floor the free-text fields (matching `parse.ts`'s
 * field-too-short discipline).
 */
const MIN_LENGTHS: Record<"state" | "action" | "reflection", number> = {
  state: 5,
  action: 5,
  reflection: 10,
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * @param {Record<string, unknown>} obj
 * @otel-exempt pure-function — synchronous in-memory field-presence check, no I/O.
 */
function checkUnknownFields(obj: Record<string, unknown>): ReflexionParseError[] {
  const errors: ReflexionParseError[] = [];
  for (const key of Object.keys(obj)) {
    if (!(ALL_FIELDS as readonly string[]).includes(key)) {
      errors.push({
        kind: "unknown-field",
        message: `Unknown field "${key}". Allowed: ${ALL_FIELDS.join(", ")}.`,
        field: key,
      });
    }
  }
  return errors;
}

/**
 * @otel-exempt pure-function — synchronous in-memory field-presence check, no I/O.
 */
function checkRequiredStrings(obj: Record<string, unknown>): ReflexionParseError[] {
  const errors: ReflexionParseError[] = [];
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!(field in obj)) {
      errors.push({
        kind: "missing-required-field",
        message: `Missing required field "${field}".`,
        field,
      });
      continue;
    }
    if (typeof obj[field] !== "string") {
      errors.push({
        kind: "missing-required-field",
        message: `Field "${field}" must be a string.`,
        field,
      });
    }
  }
  return errors;
}

/**
 * @otel-exempt pure-function — synchronous in-memory shape check, no I/O.
 */
function checkFieldShapes(obj: Record<string, unknown>): ReflexionParseError[] {
  const errors: ReflexionParseError[] = [];
  const id = obj["id"];
  if (typeof id === "string" && !ID_PATTERN.test(id)) {
    errors.push({
      kind: "invalid-id-format",
      message: `id "${id}" must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ (kebab-case).`,
      field: "id",
    });
  }
  for (const [field, minLen] of Object.entries(MIN_LENGTHS)) {
    const value = obj[field];
    if (typeof value === "string" && value.length < minLen) {
      errors.push({
        kind: "field-too-short",
        message: `Field "${field}" must be ≥${minLen} characters; got ${value.length}.`,
        field,
      });
    }
  }
  return errors;
}

/**
 * @otel-exempt pure-function — synchronous in-memory enum check, no I/O.
 */
function checkOutcome(obj: Record<string, unknown>): ReflexionParseError[] {
  if (!("outcome" in obj)) {
    return [
      {
        kind: "missing-required-field",
        message: `Missing required field "outcome".`,
        field: "outcome",
      },
    ];
  }
  const v = obj["outcome"];
  if (typeof v !== "string" || !(REFLEXION_OUTCOMES as readonly string[]).includes(v)) {
    return [
      {
        kind: "invalid-outcome",
        message: `outcome must be one of ${REFLEXION_OUTCOMES.join(", ")}; got ${JSON.stringify(v)}.`,
        field: "outcome",
      },
    ];
  }
  return [];
}

/**
 * Validate an unknown value (e.g. a JSON-parsed `.minsky/experiment-store/
 * reflexions/*.json` entry) into a typed {@link ReflexionMemoryEntry}.
 *
 * Pure: no I/O, no async. Mirrors `parse.ts`'s pipeline so the two records
 * share validation discipline. The caller (the tick-loop's reflection step)
 * owns reading/writing the file and any span around it.
 *
 * @otel-exempt pure-function — no I/O, no async, no side effects. Operates over
 *   an in-memory object; the caller wraps the recall/write step in its own span.
 */
export function parseReflexionEntry(raw: unknown): ReflexionParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        {
          kind: "not-a-mapping",
          message: "A Reflexion memory entry must be a mapping at the top level.",
        },
      ],
    };
  }

  const obj = raw as Record<string, unknown>;
  const errors: ReflexionParseError[] = [
    ...checkUnknownFields(obj),
    ...checkRequiredStrings(obj),
    ...checkFieldShapes(obj),
    ...checkOutcome(obj),
  ];

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    entry: {
      id: obj["id"] as string,
      state: obj["state"] as string,
      action: obj["action"] as string,
      outcome: obj["outcome"] as ReflexionOutcome,
      reflection: obj["reflection"] as string,
    },
  };
}
