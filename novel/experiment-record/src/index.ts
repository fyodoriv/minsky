/**
 * `@minsky/experiment-record` — schema + parser + validator for the
 * `EXPERIMENT.yaml` record carried by every PR per rule #9
 * (pre-registered hypothesis-driven development).
 *
 * See `spec.md` for the format and `schema.json` for the JSON-Schema
 * (draft-07) definition.
 */

export {
  type ExperimentRecord,
  type ParseError,
  type ParseErrorKind,
  type ParseResult,
  parse,
} from "./parse.js";

export {
  parseReflexionEntry,
  type ReflexionMemoryEntry,
  type ReflexionOutcome,
  type ReflexionParseError,
  type ReflexionParseErrorKind,
  type ReflexionParseResult,
} from "./reflexion-schema.js";
