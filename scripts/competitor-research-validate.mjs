#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-22 M1.10 — helper script for the .claude/skills/competitor-research SKILL; validates a draft Competitor record (kebab-case id, vendor-exclusion, metric ids exist in the catalogue, citation+asOf present) before the skill writes it into competitors.ts. -->
//
// Helper script for `.claude/skills/competitor-research`.
//
// What it does
// ------------
// Reads a draft `Competitor` record from a JSON file (the skill writes
// the draft, then invokes this script to validate it). Exits 0 when the
// draft is shippable; exits 1 with a one-line reason when it isn't.
//
// Why this exists
// ---------------
// The skill is LLM-driven research (web search + fetch + extract). The
// substrate it produces must satisfy 5 invariants before it lands in
// `competitors.ts`:
//   1. id is kebab-case, unique vs the existing corpus
//   2. label, kind, homepage, resultSource present
//   3. resultSource.kind is "published" or "local-harness"
//   4. published source has citation (≥10 chars) + asOf (YYYY-MM-DD) +
//      values map with ≥1 entry; each value is a finite number
//   5. every metric id in values exists in METRICS catalogue
//   6. id + label do NOT match EXCLUDED_VENDOR_SUBSTRINGS
//
// This script is deterministic and runs in the agent's context; the
// skill calls it after drafting and before patching competitors.ts.
//
// Pattern: validation layer between LLM-research and corpus-mutation
//   (rule #10 — deterministic enforcement of the invariants the
//   LLM-driven skill can't guarantee).
// Source: .claude/skills/competitor-research/SKILL.md phase 5.
// Anchor: rule #9 (pre-registered HDD — the skill's measurement is "this
//   script exits 0"); rule #2 (every dep behind interface — the skill
//   doesn't reach into competitors.ts directly, it validates a DTO and
//   leaves the actual edit to the skill body).

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {{ kind: "published", citation: string, asOf: string, values: Record<string, number> } | { kind: "local-harness", citation: string, harnessId: string }} ResultSourceLike
 */

/**
 * @typedef {{ id: string, label: string, kind: "closed-commercial" | "open-source", homepage: string, resultSource: ResultSourceLike }} CompetitorDraft
 */

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} ValidationResult
 */

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\//;

const EXCLUDED_SUBSTRINGS = ["groq", "xai", "x.ai", "grok", "elon", "musk"];

/**
 * Best-effort regex extraction of metric ids from
 * `novel/competitive-benchmark/src/metrics.ts`. Avoids importing the
 * package so the script runs without a build.
 *
 * @returns {Set<string>}
 */
function loadKnownMetricIds() {
  const path = resolve(REPO_ROOT, "novel/competitive-benchmark/src/metrics.ts");
  const body = readFileSync(path, "utf8");
  const ids = new Set();
  for (const match of body.matchAll(/id:\s*"([a-z0-9-]+)"/g)) {
    ids.add(match[1]);
  }
  return ids;
}

/**
 * Best-effort regex extraction of competitor ids already in the corpus.
 *
 * @returns {Set<string>}
 */
function loadExistingCompetitorIds() {
  const path = resolve(REPO_ROOT, "novel/competitive-benchmark/src/competitors.ts");
  const body = readFileSync(path, "utf8");
  const ids = new Set();
  for (const match of body.matchAll(/id:\s*"([a-z0-9-]+)",\s*\n\s*label:/g)) {
    ids.add(match[1]);
  }
  return ids;
}

/**
 * @param {unknown} draft
 * @param {{ knownMetricIds: Set<string>, existingCompetitorIds: Set<string>, allowExisting: boolean }} opts
 * @returns {ValidationResult}
 */
export function validateDraft(draft, opts) {
  /** @type {string[]} */
  const errors = [];
  if (typeof draft !== "object" || draft === null) {
    return { ok: false, errors: ["draft must be a non-null object"] };
  }
  /** @type {Partial<CompetitorDraft>} */
  const d = /** @type {Partial<CompetitorDraft>} */ (draft);

  if (typeof d.id !== "string" || !ID_RE.test(d.id)) {
    errors.push(`id must be kebab-case (got: ${JSON.stringify(d.id)})`);
  } else if (!opts.allowExisting && opts.existingCompetitorIds.has(d.id)) {
    errors.push(
      `id "${d.id}" already exists in the corpus — pass --refresh to update it instead of adding a duplicate`,
    );
  }

  if (typeof d.label !== "string" || d.label.length < 2) {
    errors.push("label must be a non-empty string");
  }

  if (typeof d.homepage !== "string" || !URL_RE.test(d.homepage)) {
    errors.push(`homepage must be https:// (got: ${JSON.stringify(d.homepage)})`);
  }

  if (d.kind !== "closed-commercial" && d.kind !== "open-source") {
    errors.push(`kind must be "closed-commercial" or "open-source" (got: ${JSON.stringify(d.kind)})`);
  }

  // Vendor-exclusion guard
  const idLower = typeof d.id === "string" ? d.id.toLowerCase() : "";
  const labelLower = typeof d.label === "string" ? d.label.toLowerCase() : "";
  for (const bad of EXCLUDED_SUBSTRINGS) {
    if (idLower.includes(bad) || labelLower.includes(bad)) {
      errors.push(
        `vendor "${d.label ?? d.id}" matches the operator-set deny list (${bad}); rejected by EXCLUDED_VENDOR_SUBSTRINGS`,
      );
    }
  }

  const src = d.resultSource;
  if (typeof src !== "object" || src === null) {
    errors.push("resultSource must be a non-null object");
  } else if (src.kind === "published") {
    if (typeof src.citation !== "string" || src.citation.length < 10) {
      errors.push("resultSource.citation must be a string ≥10 chars");
    }
    if (typeof src.asOf !== "string" || !ISO_DATE_RE.test(src.asOf)) {
      errors.push(`resultSource.asOf must match YYYY-MM-DD (got: ${JSON.stringify(src.asOf)})`);
    }
    if (typeof src.values !== "object" || src.values === null) {
      errors.push("resultSource.values must be a non-null object");
    } else {
      const keys = Object.keys(src.values);
      if (keys.length < 1) {
        errors.push("resultSource.values must carry ≥1 metric reading");
      }
      for (const key of keys) {
        if (!opts.knownMetricIds.has(key)) {
          errors.push(
            `resultSource.values key "${key}" is not in novel/competitive-benchmark/src/metrics.ts METRICS — fix the typo or add the metric definition first`,
          );
        }
        const v = src.values[key];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          errors.push(`resultSource.values["${key}"] must be a finite number (got: ${JSON.stringify(v)})`);
        }
      }
    }
  } else if (src.kind === "local-harness") {
    if (typeof src.citation !== "string" || src.citation.length < 10) {
      errors.push("resultSource.citation must be a string ≥10 chars (local-harness)");
    }
    if (typeof src.harnessId !== "string" || src.harnessId.length < 1) {
      errors.push("resultSource.harnessId must be a non-empty string");
    }
  } else {
    errors.push(
      `resultSource.kind must be "published" or "local-harness" (got: ${JSON.stringify(src && /** @type {{ kind?: unknown }} */ (src).kind)})`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/competitor-research-validate.mjs --draft <path> [--refresh]",
      "",
      "Validates a competitor-draft JSON file produced by the `competitor-research`",
      "skill. The JSON must be a single `Competitor` record matching the shape in",
      "novel/competitive-benchmark/src/competitors.ts.",
      "",
      "Options:",
      "  --draft PATH   Path to the draft JSON (required)",
      "  --refresh      Allow the draft to reuse an existing competitor id (refresh, not add)",
      "  --help, -h     Print this message",
      "",
      "Exit code:",
      "  0  draft passes every invariant (kebab-case id, vendor-exclusion, metric ids exist, etc.)",
      "  1  draft fails one or more invariants — stderr lists each one",
      "  2  reading error (missing file, parse error, etc.)",
      "",
    ].join("\n"),
  );
}

/** @typedef {{ draft: string | null, refresh: boolean, help: boolean }} CliOpts */

/**
 * @param {string[]} argv
 * @returns {CliOpts}
 */
function parseArgs(argv) {
  /** @type {CliOpts} */
  const out = { draft: null, refresh: false, help: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--draft") out.draft = args[++i] ?? null;
    else if (a === "--refresh") out.refresh = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a) {
      process.stderr.write(`competitor-research-validate: unknown argument: ${a}\n`);
      process.exit(64);
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  if (opts.draft === null) {
    process.stderr.write("competitor-research-validate: --draft <path> is required\n");
    return 2;
  }
  const draftPath = resolve(opts.draft);
  if (!existsSync(draftPath)) {
    process.stderr.write(`competitor-research-validate: draft file not found: ${draftPath}\n`);
    return 2;
  }
  /** @type {unknown} */
  let draft;
  try {
    draft = JSON.parse(readFileSync(draftPath, "utf8"));
  } catch (err) {
    process.stderr.write(
      `competitor-research-validate: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  const knownMetricIds = loadKnownMetricIds();
  const existingCompetitorIds = loadExistingCompetitorIds();

  const result = validateDraft(draft, {
    knownMetricIds,
    existingCompetitorIds,
    allowExisting: opts.refresh,
  });

  if (result.ok) {
    /** @type {Partial<CompetitorDraft>} */
    const d = /** @type {Partial<CompetitorDraft>} */ (draft);
    const valueCount =
      d.resultSource && d.resultSource.kind === "published"
        ? Object.keys(d.resultSource.values).length
        : 0;
    process.stdout.write(
      `competitor-research-validate ok: draft "${d.id}" passes ${knownMetricIds.size}-metric catalogue check; ${valueCount} reading(s)\n`,
    );
    return 0;
  }

  process.stderr.write(
    `competitor-research-validate: ${result.errors.length} invariant(s) failed:\n`,
  );
  for (const e of result.errors) {
    process.stderr.write(`  - ${e}\n`);
  }
  process.stderr.write(
    "\nFix each error in the draft JSON and re-run. See `.claude/skills/competitor-research/SKILL.md` phase 3 for the schema.\n",
  );
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

// Silence unused-import warning when the module is imported (not run).
void execSync;
