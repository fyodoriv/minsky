/**
 * `OmcReader` — read-only filesystem walker over OMC's task-state tree.
 *
 * Path shape: `<repoRoot>/.omc/state/team/<teamName>/tasks/<taskId>.json`.
 * See research.md § "OMC handoff persistence" for the verdict that the
 * format is parseable (PR #75 read-only inspection of OMC source) and
 * the round-trip parseability gate at `scripts/omc-roundtrip.mjs`.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - Read-only adapter bridge: Helland 2007 (eventual consistency, only
 *     the read direction in v0); Gamma et al. 1994 (Adapter / Bridge).
 *   - Recursive filesystem walk: standard depth-2 enumeration; no
 *     watcher (chokidar / `fs.watch`) — that's a v1+ concern filed as
 *     `omc-tasksmd-bridge-v1-watcher` in TASKS.md.
 *
 * I/O boundary (rule #2 / Clean Architecture, Martin 2017): this module
 * is the *only* place the bridge touches the filesystem. `mapper.ts`
 * and `sync.ts` are pure.
 */

import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { BridgeOptions, OmcTeamTask } from "./types.js";

/**
 * Read every OMC team task under `<repoRoot>/.omc/state/team/`, optionally
 * filtered to a single team. Cold-start (missing directory) returns `[]`.
 * Malformed JSON files are skipped with a stderr advisory.
 *
 * @otel bridges.omc-tasksmd.list
 */
export async function list(opts: BridgeOptions): Promise<OmcTeamTask[]> {
  const teamRoot = join(opts.repoRoot, ".omc", "state", "team");
  const teamDirs = await listTeamDirs(teamRoot, opts.teamName);
  const out: OmcTeamTask[] = [];
  for (const teamDir of teamDirs) {
    const tasksDir = join(teamRoot, teamDir, "tasks");
    out.push(...(await readTasksDir(tasksDir)));
  }
  return out;
}

/**
 * `OmcReader` namespace export — keeps the public surface shaped like the
 * brief while still allowing tree-shakeable named imports.
 */
export const OmcReader = { list } as const;

/**
 * Enumerate the team subdirectories under `<repoRoot>/.omc/state/team/`.
 * If `teamName` is supplied, return just that one (still gated on the
 * directory existing — graceful-degrade per rule #7).
 *
 * @otel bridges.omc-tasksmd.list-team-dirs
 */
async function listTeamDirs(teamRoot: string, teamName?: string): Promise<string[]> {
  const dirents = await readDirSafe(teamRoot);
  if (dirents === null) return [];
  const names = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  if (teamName === undefined) return names.sort();
  return names.includes(teamName) ? [teamName] : [];
}

/**
 * Read every `*.json` file in `tasksDir` and return parsed `OmcTeamTask`s.
 * Missing dir, unreadable file, or malformed JSON → skip with stderr
 * advisory (rule #7 graceful-degrade chaos table row 2).
 *
 * @otel bridges.omc-tasksmd.read-tasks-dir
 */
async function readTasksDir(tasksDir: string): Promise<OmcTeamTask[]> {
  const dirents = await readDirSafe(tasksDir);
  if (dirents === null) return [];
  const files = dirents
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => d.name)
    .sort();
  const out: OmcTeamTask[] = [];
  for (const name of files) {
    const task = await readTaskFile(join(tasksDir, name));
    if (task !== null) out.push(task);
  }
  return out;
}

/**
 * Read one task file. Returns `null` on any read or parse failure
 * (logged to stderr) — rule #7 graceful-degrade.
 *
 * @otel bridges.omc-tasksmd.read-task-file
 */
async function readTaskFile(path: string): Promise<OmcTeamTask | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
    // rule-6: handled-locally — graceful-skip on unreadable file (EACCES, broken symlink) per rule #7 chaos table row 1
  } catch (err) {
    process.stderr.write(
      `[omc-tasksmd-bridge] skip unreadable file ${path}: ${stringifyErr(err)}\n`,
    );
    return null;
  }
  return parseTaskJson(text, path);
}

/**
 * Parse a JSON string into an `OmcTeamTask`, or `null` on malformed
 * JSON / shape mismatch.
 *
 * @otel bridges.omc-tasksmd.parse-task-json
 */
function parseTaskJson(text: string, path: string): OmcTeamTask | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
    // rule-6: handled-locally — graceful-skip on malformed JSON per rule #7 chaos table row 2
  } catch (err) {
    process.stderr.write(
      `[omc-tasksmd-bridge] skip malformed JSON ${path}: ${stringifyErr(err)}\n`,
    );
    return null;
  }
  if (!isOmcTeamTaskShape(raw)) {
    process.stderr.write(`[omc-tasksmd-bridge] skip non-task shape ${path}\n`);
    return null;
  }
  return raw;
}

/**
 * `readdir(..., { withFileTypes: true })` with a graceful `null` for
 * missing or unreadable directories. Cold-start path.
 *
 * @otel bridges.omc-tasksmd.read-dir-safe
 */
async function readDirSafe(dir: string): Promise<Dirent[] | null> {
  try {
    return (await readdir(dir, { withFileTypes: true })) as Dirent[];
    // rule-6: handled-locally — missing `.omc/state/team/` is the cold-start path; graceful-degrade per rule #7 chaos table row 3
  } catch {
    return null;
  }
}

/**
 * Minimum-shape guard. Required: `id`, `subject`, `status`, `created_at`.
 * Everything else is optional and passed through verbatim.
 *
 * @otel-exempt type guard; trivial pure function called in a tight loop
 */
function isOmcTeamTaskShape(v: unknown): v is OmcTeamTask {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["id"] === "string" &&
    typeof o["subject"] === "string" &&
    typeof o["status"] === "string" &&
    typeof o["created_at"] === "string"
  );
}

/**
 * @otel-exempt error-stringification helper; trivial pure function
 */
function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
