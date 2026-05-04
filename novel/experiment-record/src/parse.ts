/**
 * Parser for `EXPERIMENT.yaml` records (rule #9 pre-registration).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:    pre-registration record + DTO validation.
 *                     Munafò et al. 2017 (pre-registration);
 *                     Fowler 2002 (DTO).
 *   - Parser shape:   recursive-descent → schema check → semantic
 *                     check (vanity-metric / empty-windows). Same
 *                     three-stage shape as `@minsky/handoff-spec`'s
 *                     parse → validate → semantic-rules pipeline.
 *                     Conformance: full.
 */

import { YAMLParseError, parse as yamlParse } from "yaml";

export interface ExperimentRecord {
  readonly id: string;
  readonly hypothesis: string;
  readonly success: string;
  readonly pivot: string;
  readonly measurement: string;
  readonly anchor: string;
  readonly replay_windows_days: readonly number[];
}

export type ParseErrorKind =
  | "bad-yaml"
  | "not-a-mapping"
  | "missing-required-field"
  | "invalid-id-format"
  | "field-too-short"
  | "vanity-metric"
  | "unknown-field"
  | "empty-replay-windows"
  | "bad-replay-window-value";

export interface ParseError {
  readonly kind: ParseErrorKind;
  readonly message: string;
  readonly line?: number;
  readonly field?: string;
}

export type ParseResult =
  | { readonly ok: true; readonly record: ExperimentRecord }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

const REQUIRED_FIELDS = ["id", "hypothesis", "success", "pivot", "measurement", "anchor"] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, "replay_windows_days"] as const;
type FieldName = (typeof ALL_FIELDS)[number];

const MIN_LENGTHS: Record<Exclude<FieldName, "replay_windows_days" | "id">, number> = {
  hypothesis: 20,
  success: 5,
  pivot: 5,
  measurement: 5,
  anchor: 5,
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * Forbidden vanity-metric phrases per rule #9 (Ries 2011 anti-pattern list).
 * Match is case-insensitive substring across either `success` or `pivot`.
 */
const VANITY_PHRASES = [
  "lines of code",
  "loc count",
  "commits made",
  "commit count",
  "hours spent",
  "hours worked",
  "tasks in flight",
  "tasks-in-flight",
];

const DEFAULT_REPLAY_WINDOWS_DAYS = [7, 30] as const;

function tryYamlParse(
  input: string,
): { ok: true; value: unknown } | { ok: false; error: ParseError } {
  try {
    return { ok: true, value: yamlParse(input) };
  } catch (e) {
    if (e instanceof YAMLParseError) {
      const line = e.linePos?.[0]?.line;
      const error: ParseError =
        line !== undefined
          ? { kind: "bad-yaml", message: e.message, line }
          : { kind: "bad-yaml", message: e.message };
      return { ok: false, error };
    }
    throw e;
  }
}

function checkUnknownFields(obj: Record<string, unknown>): ParseError[] {
  const errors: ParseError[] = [];
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

function checkRequiredFields(obj: Record<string, unknown>): ParseError[] {
  const errors: ParseError[] = [];
  for (const field of REQUIRED_FIELDS) {
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

function checkFieldShapes(obj: Record<string, unknown>): ParseError[] {
  const errors: ParseError[] = [];
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

function checkVanityMetrics(obj: Record<string, unknown>): ParseError[] {
  const errors: ParseError[] = [];
  for (const field of ["success", "pivot"] as const) {
    const value = obj[field];
    if (typeof value !== "string") continue;
    const lower = value.toLowerCase();
    const hit = VANITY_PHRASES.find((phrase) => lower.includes(phrase));
    if (hit !== undefined) {
      errors.push({
        kind: "vanity-metric",
        message: `Field "${field}" uses forbidden vanity-metric phrase "${hit}". See vision.md § 9.`,
        field,
      });
    }
  }
  return errors;
}

interface ReplayWindowsResult {
  readonly errors: readonly ParseError[];
  readonly windows: readonly number[];
}

function checkReplayWindows(obj: Record<string, unknown>): ReplayWindowsResult {
  if (!("replay_windows_days" in obj)) {
    return { errors: [], windows: DEFAULT_REPLAY_WINDOWS_DAYS };
  }
  const v = obj["replay_windows_days"];
  if (!Array.isArray(v)) {
    return {
      errors: [
        {
          kind: "bad-replay-window-value",
          message: "replay_windows_days must be an array of integers.",
          field: "replay_windows_days",
        },
      ],
      windows: DEFAULT_REPLAY_WINDOWS_DAYS,
    };
  }
  if (v.length === 0) {
    return {
      errors: [
        {
          kind: "empty-replay-windows",
          message:
            "replay_windows_days is empty; the weekly-monthly tracker would never re-run this experiment. Use [7] for a single window or omit the field for the [7, 30] default.",
          field: "replay_windows_days",
        },
      ],
      windows: DEFAULT_REPLAY_WINDOWS_DAYS,
    };
  }
  const errors: ParseError[] = [];
  const nums: number[] = [];
  for (const item of v) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1 || item > 365) {
      errors.push({
        kind: "bad-replay-window-value",
        message: `replay_windows_days entries must be integers in [1, 365]; got ${JSON.stringify(item)}.`,
        field: "replay_windows_days",
      });
    } else {
      nums.push(item);
    }
  }
  return {
    errors,
    windows: errors.length === 0 ? nums : DEFAULT_REPLAY_WINDOWS_DAYS,
  };
}

function buildRecord(obj: Record<string, unknown>, windows: readonly number[]): ExperimentRecord {
  return {
    id: obj["id"] as string,
    hypothesis: obj["hypothesis"] as string,
    success: obj["success"] as string,
    pivot: obj["pivot"] as string,
    measurement: obj["measurement"] as string,
    anchor: obj["anchor"] as string,
    replay_windows_days: windows,
  };
}

export function parse(input: string): ParseResult {
  const yaml = tryYamlParse(input);
  if (!yaml.ok) {
    return { ok: false, errors: [yaml.error] };
  }

  const raw = yaml.value;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        {
          kind: "not-a-mapping",
          message: "EXPERIMENT.yaml must be a mapping at the top level.",
        },
      ],
    };
  }

  const obj = raw as Record<string, unknown>;
  const replay = checkReplayWindows(obj);
  const errors: ParseError[] = [
    ...checkUnknownFields(obj),
    ...checkRequiredFields(obj),
    ...checkFieldShapes(obj),
    ...checkVanityMetrics(obj),
    ...replay.errors,
  ];

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, record: buildRecord(obj, replay.windows) };
}
