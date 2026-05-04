/**
 * `@minsky/handoff-spec` — parser + validator for the handoff record format
 * defined in `./spec.md`.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index, row 27):
 *   - The handoff record itself: actor message-passing with continuation —
 *     Hewitt, Bishop, Steiger, "A Universal Modular ACTOR Formalism for
 *     Artificial Intelligence", *IJCAI* 1973. Conformance: full.
 *     The `Suggested next` field IS the continuation.
 *   - Parser shape: recursive-descent over markdown headings + bold-labelled
 *     fields. Conformance: full (standard parsing pattern).
 *   - Validator: schema validation per the rules in `spec.md` § "Validation
 *     rules". Conformance: full.
 */

export type HandoffStatus = "ok" | "blocked" | "needs-rework";

export interface Handoff {
  readonly subject: string;
  readonly from: string;
  readonly to?: string;
  readonly status: HandoffStatus;
  readonly summary: string;
  readonly artifacts: readonly string[];
  readonly blockers: readonly string[];
  readonly suggestedNext: readonly string[];
  readonly pushback: readonly string[];
  /** ISO-8601 UTC. Normalised on parse. */
  readonly createdAt: string;
}

export type ParseErrorKind =
  | "missing-heading"
  | "missing-required-field"
  | "invalid-status"
  | "invalid-persona-id"
  | "invalid-created-at"
  | "blockers-required-when-blocked"
  | "to-or-suggested-next-required"
  | "input-too-large";

export interface ParseError {
  readonly kind: ParseErrorKind;
  readonly message: string;
  /** Line number in the source (1-indexed). */
  readonly line: number;
}

export interface ParseResult {
  readonly handoffs: readonly Handoff[];
  readonly errors: readonly ParseError[];
}

export interface ParseOptions {
  /** Maximum input size in bytes (UTF-8). Default 1 MB. */
  readonly maxBytes?: number;
}

/** Default 1 MB cap; rejects larger inputs with `kind: "input-too-large"`. */
const DEFAULT_MAX_BYTES = 1_048_576;

const STATUS_VALUES: readonly HandoffStatus[] = ["ok", "blocked", "needs-rework"];
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const REQUIRED_FIELDS = ["From", "Status", "Summary", "Created-at"] as const;
type FieldMap = Record<string, string | string[]>;

/**
 * Convenience: did parsing produce any errors?
 *
 * @otel-exempt pure predicate — reads a single in-memory length, no I/O,
 *   no side effects. A wrapping span on a one-line array-length check
 *   would be empty noise; the calling code already has its own span.
 */
export function isValid(result: ParseResult): boolean {
  return result.errors.length === 0;
}

/**
 * Parse a handoff document into structured records + accumulated errors.
 * One bad handoff doesn't abort the document — per-record errors are
 * collected so a UI can surface them.
 *
 * @otel-exempt pure function — string-in / value-out parser with no I/O,
 *   no shared state, no async edges. Exception: the size-cap branch
 *   returns early with `kind: "input-too-large"` (Armstrong 2007) without
 *   doing any work. Callers that need observability wrap the call site
 *   (file read + parse) in their own span; instrumenting here would
 *   double-count and lose the file-path context.
 */
export function parseHandoffs(source: string, options?: ParseOptions): ParseResult {
  const tooLarge = checkSizeCap(source, options?.maxBytes ?? DEFAULT_MAX_BYTES);
  if (tooLarge) return tooLarge;
  const lines = source.split("\n");
  const blockStarts = findBlockStarts(lines);
  if (blockStarts.length === 0) {
    return {
      handoffs: [],
      errors: [
        { kind: "missing-heading", message: "no `# Handoff: <subject>` heading found", line: 1 },
      ],
    };
  }
  return parseBlocks(lines, blockStarts);
}

function parseBlocks(lines: readonly string[], blockStarts: readonly number[]): ParseResult {
  const handoffs: Handoff[] = [];
  const errors: ParseError[] = [];
  for (let b = 0; b < blockStarts.length; b++) {
    const start = blockStarts[b] ?? 0;
    const end = b + 1 < blockStarts.length ? (blockStarts[b + 1] ?? lines.length) : lines.length;
    const block = lines.slice(start, end).join("\n");
    const r = parseSingleHandoff(block, start);
    if (r.handoff) handoffs.push(r.handoff);
    for (const e of r.errors) errors.push(e);
  }
  return { handoffs, errors };
}

/**
 * Enforce the byte cap at the parser entry. Armstrong 2007: let it crash,
 * but with a precise error — return a structured `input-too-large` result
 * instead of letting Node OOM on a multi-MB input.
 */
function checkSizeCap(source: string, maxBytes: number): ParseResult | undefined {
  const byteLength = Buffer.byteLength(source, "utf-8");
  if (byteLength <= maxBytes) return undefined;
  return {
    handoffs: [],
    errors: [
      {
        kind: "input-too-large",
        message: `document exceeds ${maxBytes} bytes cap`,
        line: 0,
      },
    ],
  };
}

function findBlockStarts(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^# Handoff:/.test(lines[i] ?? "")) out.push(i);
  }
  return out;
}

interface SingleParseResult {
  readonly handoff?: Handoff;
  readonly errors: readonly ParseError[];
}

function parseSingleHandoff(block: string, baseLine: number): SingleParseResult {
  const fields = extractFields(block);
  const line = baseLine + 1;
  const errors: ParseError[] = [];

  for (const f of REQUIRED_FIELDS) {
    if (!(f in fields)) {
      errors.push({
        kind: "missing-required-field",
        message: `missing required field: **${f}**`,
        line,
      });
    }
  }

  const subject = block.match(/^# Handoff:\s*(.+?)\s*$/m)?.[1]?.trim() ?? "";
  const from = strField(fields, "From");
  const to = strField(fields, "To");
  const statusRaw = strField(fields, "Status");
  const summary = strField(fields, "Summary");
  const createdAtRaw = strField(fields, "Created-at");
  const artifacts = listField(fields, "Artifacts");
  const blockers = listField(fields, "Blockers");
  const suggestedNext = listField(fields, "Suggested next");
  const pushback = listField(fields, "Pushback");

  const status = validateStatus(statusRaw, line, errors);
  validatePersonaIds(from, to, suggestedNext, line, errors);
  if (!to && suggestedNext.length === 0) {
    errors.push({
      kind: "to-or-suggested-next-required",
      message: "either **To** or at least one **Suggested next** is required",
      line,
    });
  }
  if (status === "blocked" && blockers.length === 0) {
    errors.push({
      kind: "blockers-required-when-blocked",
      message: "Status=blocked requires a non-empty **Blockers** list",
      line,
    });
  }
  const createdAt = validateCreatedAt(createdAtRaw, line, errors);

  if (errors.length > 0) return { errors };

  const handoff: Handoff = {
    subject,
    from,
    ...(to ? { to } : {}),
    status,
    summary,
    artifacts,
    blockers,
    suggestedNext,
    pushback,
    createdAt,
  };
  return { handoff, errors };
}

function strField(fields: FieldMap, key: string): string {
  const v = fields[key];
  return typeof v === "string" ? v.trim() : "";
}

function listField(fields: FieldMap, key: string): readonly string[] {
  const v = fields[key];
  return Array.isArray(v) ? v : [];
}

function validateStatus(raw: string, line: number, errors: ParseError[]): HandoffStatus {
  if (!raw) return "ok";
  if (!STATUS_VALUES.includes(raw as HandoffStatus)) {
    errors.push({
      kind: "invalid-status",
      message: `Status must be one of ${STATUS_VALUES.join(" / ")}; got "${raw}"`,
      line,
    });
    return "ok";
  }
  return raw as HandoffStatus;
}

function validatePersonaIds(
  from: string,
  to: string | undefined,
  suggestedNext: readonly string[],
  line: number,
  errors: ParseError[],
): void {
  if (from && !KEBAB_CASE.test(from)) {
    errors.push({
      kind: "invalid-persona-id",
      message: `From: persona ID must be kebab-case; got "${from}"`,
      line,
    });
  }
  if (to && !KEBAB_CASE.test(to)) {
    errors.push({
      kind: "invalid-persona-id",
      message: `To: persona ID must be kebab-case; got "${to}"`,
      line,
    });
  }
  for (const id of suggestedNext) {
    if (!KEBAB_CASE.test(id)) {
      errors.push({
        kind: "invalid-persona-id",
        message: `Suggested next: persona ID must be kebab-case; got "${id}"`,
        line,
      });
    }
  }
}

function validateCreatedAt(raw: string, line: number, errors: ParseError[]): string {
  if (!raw) return "";
  if (!ISO_8601.test(raw)) {
    errors.push({
      kind: "invalid-created-at",
      message: `Created-at must be ISO-8601; got "${raw}"`,
      line,
    });
    return raw;
  }
  return new Date(raw).toISOString();
}

/** Extract bold-labelled fields from a handoff block. */
function extractFields(block: string): FieldMap {
  const fields: FieldMap = {};
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? "").match(/^- \*\*([A-Za-z][A-Za-z -]*?)\*\*:\s*(.*)$/);
    if (!m) continue;
    const label = m[1] ?? "";
    const inline = (m[2] ?? "").trim();
    const bullets = collectBullets(lines, i + 1);
    if (bullets.length > 0) fields[label] = bullets;
    else if (inline !== "") fields[label] = inline;
  }
  return fields;
}

function collectBullets(lines: readonly string[], from: number): string[] {
  const bullets: string[] = [];
  for (let j = from; j < lines.length; j++) {
    const cont = lines[j] ?? "";
    if (/^ {2}- /.test(cont)) bullets.push(cont.replace(/^ {2}- /, "").trim());
    else break;
  }
  return bullets;
}

// Re-export helpful types but don't change the public surface.
export type { ParseErrorKind as ParseErrorKindAlias };
