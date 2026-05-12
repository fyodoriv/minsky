// Repo-config loader — reads `.minsky/repo.yaml` content and produces a
// validated `RepoConfig`. Hand-parses the YAML subset that
// `@minsky/sidecar-bootstrap` writes (rule #1 — no yaml dep needed for
// the shape we control end-to-end).
//
// Pattern: thin parser (Aho-Sethi-Ullman 1986 — recursive-descent for a
//   tightly-constrained grammar) + reuse the existing `parseRepoConfig`
//   validator from `@minsky/sidecar-bootstrap` (rule #1). Source: rule #2
//   (vision.md § 2 — the host's repo.yaml is an external dep behind the
//   `RepoConfig` interface; this loader is its parser).
// Conformance: full — pure function over the YAML string.

import { type ParseRepoConfigResult, parseRepoConfig } from "@minsky/sidecar-bootstrap";

/**
 * Pure function: parse the repo.yaml content into a structured object,
 * then run it through `parseRepoConfig` for validation.
 *
 * The parser handles only the subset sidecar-bootstrap renders:
 *   key: "value"          — required-string fields
 *   key: null             — null literal
 *   key:                  — bare-empty (treated as null)
 *   nested-map:           — followed by indented `  inner_key: "value"` lines
 *
 * Unknown shapes / multi-line scalars / arrays are unsupported (the
 * sidecar-bootstrap renderer does not produce them).
 *
 * @otel cross-repo-runner.load-repo-config
 */
export function loadRepoConfig(yamlContent: string): ParseRepoConfigResult {
  const parsed = parseFlatYaml(yamlContent);
  return parseRepoConfig(parsed);
}

interface ProcessedLine {
  consumed: boolean;
  newIndex: number;
  key: string | null;
  value: unknown;
}

function shouldSkipLine(line: string): boolean {
  return line.trim().length === 0 || line.trim().startsWith("#") || line.startsWith("  ");
}

function processLine(lines: string[], i: number): ProcessedLine {
  const line = lines[i] ?? "";
  const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
  if (m?.[1] === undefined) return { consumed: true, newIndex: i, key: null, value: null };
  const key = m[1];
  const value = m[2] ?? "";
  if (value === "{}") {
    return { consumed: true, newIndex: i, key, value: {} };
  }
  if (value === "" || value === "null") {
    const nested = collectNested(lines, i);
    if (nested.entries === null) {
      return { consumed: true, newIndex: i, key, value: null };
    }
    return { consumed: true, newIndex: nested.lastIndex, key, value: nested.entries };
  }
  return { consumed: true, newIndex: i, key, value: parseScalar(value) };
}

/**
 * Hand-parse the flat-YAML subset produced by sidecar-bootstrap's renderer.
 *
 * @otel cross-repo-runner.parse-flat-yaml
 */
export function parseFlatYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (shouldSkipLine(line)) continue;
    const processed = processLine(lines, i);
    if (processed.key !== null) {
      result[processed.key] = processed.value;
    }
    i = processed.newIndex;
  }
  return result;
}

interface NestedCollection {
  entries: Record<string, unknown> | null;
  lastIndex: number;
}

type NestedLineHandling =
  | { kind: "skip" }
  | { kind: "stop" }
  | { kind: "empty-map" }
  | { kind: "entry"; key: string; value: unknown };

function classifyNestedLine(line: string): NestedLineHandling {
  if (line.trim().length === 0) return { kind: "skip" };
  if (!line.startsWith("  ")) return { kind: "stop" };
  if (line.trim() === "{}") return { kind: "empty-map" };
  const m = line.match(/^\s+([a-z][a-zA-Z0-9_-]*):\s*(.*)$/);
  if (m?.[1] === undefined) return { kind: "stop" };
  return { kind: "entry", key: m[1], value: parseScalar(m[2] ?? "") };
}

interface NestedAccumulator {
  entries: Record<string, unknown>;
  lastIndex: number;
  sawEmptyMapLiteral: boolean;
  done: boolean;
}

function applyNestedVerdict(verdict: NestedLineHandling, i: number, acc: NestedAccumulator): void {
  if (verdict.kind === "skip") return;
  if (verdict.kind === "stop") {
    acc.done = true;
    return;
  }
  if (verdict.kind === "empty-map") {
    acc.sawEmptyMapLiteral = true;
    acc.lastIndex = i;
    return;
  }
  acc.entries[verdict.key] = verdict.value;
  acc.lastIndex = i;
}

function collectNested(lines: string[], startIdx: number): NestedCollection {
  const acc: NestedAccumulator = {
    entries: {},
    lastIndex: startIdx,
    sawEmptyMapLiteral: false,
    done: false,
  };
  for (let i = startIdx + 1; i < lines.length; i++) {
    applyNestedVerdict(classifyNestedLine(lines[i] ?? ""), i, acc);
    if (acc.done) break;
  }
  if (Object.keys(acc.entries).length === 0) {
    return acc.sawEmptyMapLiteral
      ? { entries: {}, lastIndex: acc.lastIndex }
      : { entries: null, lastIndex: startIdx };
  }
  return { entries: acc.entries, lastIndex: acc.lastIndex };
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
      // rule-6: handled-locally — JSON.parse failure on a quoted scalar means the value contained an unsupported escape; fall back to literal-strip (host's repo.yaml is hand-editable, this is the graceful path)
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  // YAML 1.2 § 7.3.2 single-quoted scalars — strip the surrounding quotes.
  // The sidecar-bootstrap renderer emits double-quoted strings, but some
  // hand-edits and re-renderers emit single-quoted ones; both are valid
  // YAML for the flat-string subset we parse, so accepting both prevents
  // a spurious "field must be one of …" validation failure downstream.
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
