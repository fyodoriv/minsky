// <!-- scope: human-approved slice 4 of daemon-parallel-worktree-launch (operator 2026-05-07) -->

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { TouchesPrSnapshot } from "./touches-glob.js";

const execFile = promisify(execFileCb);

/**
 * Slice 4 I/O wrapper for `daemon-parallel-worktree-launch`.
 *
 * Pattern: rule #2 — every dep behind an interface. The pure decision
 * function `decideTouchesCollision` (in `touches-glob.ts`) consumes a
 * snapshot of open daemon-authored PRs. This module is the I/O surface
 * that produces that snapshot from `gh pr list`. The daemon imports the
 * factory, the daemon's tests inject a stub, and production calls
 * out via `execFile`.
 *
 * @otel-exempt I/O at the edge; the daemon emits `tick-loop.iteration`
 *   spans that include the file-collision verdict.
 */

/**
 * Async function that returns the current snapshot of open daemon-authored
 * PRs. Call once per daemon iteration; do NOT cache across iterations
 * (a freshly-merged PR could expire the snapshot).
 */
export type OpenPrFetcher = () => Promise<readonly TouchesPrSnapshot[]>;

/**
 * Inputs for the fetcher factory. Tests inject `runGhPrList`; production
 * uses the default that calls `gh` via `execFile`.
 */
export type CreateOpenPrFetcherInput = {
  /**
   * Filter expression for `gh pr list --author <value>`. Default
   * `"@me"` — the GitHub authenticated user. Operators on multi-account
   * setups should pass the explicit username.
   */
  readonly author?: string;
  /**
   * Optional repo override (`<owner>/<name>`). When undefined, gh resolves
   * the repo from the current working directory's `origin` remote.
   */
  readonly repo?: string;
  /**
   * Optional branch-name predicate. When set, only PRs whose head branch
   * passes the predicate are kept in the snapshot. Useful for filtering
   * to `daemon/<id>/<task-id>` branches when the operator's `@me` author
   * also includes hand-authored PRs that aren't subject to file-collision
   * gating.
   *
   * Default: keep ALL PRs from the author (no further filter).
   */
  readonly branchFilter?: (branchName: string) => boolean;
  /**
   * Injected I/O — defaults to a real `gh pr list` call. Tests pass a
   * stub that returns canned JSON. Pure decision logic stays in the
   * `decideTouchesCollision` substrate (rule #2).
   */
  readonly runGhPrList?: (args: readonly string[]) => Promise<string>;
};

/** Default `gh pr list` runner — calls `gh` via `execFile`. */
async function defaultRunGhPrList(args: readonly string[]): Promise<string> {
  const { stdout } = await execFile("gh", args.slice());
  return stdout;
}

/**
 * Build an {@link OpenPrFetcher} that calls
 * `gh pr list --author <author> [--repo <repo>] --state open --json number,files,headRefName`
 * and parses the result into {@link TouchesPrSnapshot}.
 *
 * Failures (gh missing, auth expired, network) bubble up as rejected
 * promises; the daemon catches them at the iteration boundary and logs
 * the iteration as failed — rule #6 let-it-crash. The next tick re-runs
 * the fetcher and either recovers (gh authenticates) or fails loud
 * again (visible-not-silent, Beyer SRE 2016 Ch. 6).
 *
 * @otel-exempt thin I/O wrapper; the daemon emits the span.
 */
export function createOpenPrFetcher(input: CreateOpenPrFetcherInput = {}): OpenPrFetcher {
  const author = input.author ?? "@me";
  const runGhPrList = input.runGhPrList ?? defaultRunGhPrList;
  const args = [
    "pr",
    "list",
    "--author",
    author,
    "--state",
    "open",
    "--json",
    "number,files,headRefName",
    "--limit",
    "100",
  ];
  if (input.repo !== undefined) {
    args.push("--repo", input.repo);
  }
  return async () => {
    const stdout = await runGhPrList(args);
    return parseGhPrListJson(stdout, input.branchFilter);
  };
}

/**
 * Parse the JSON output of
 * `gh pr list --json number,files,headRefName` into
 * {@link TouchesPrSnapshot}[]. Discards entries with malformed shape so a
 * single bad PR row doesn't take the whole iteration down.
 *
 * Pure helper — exported for the test boundary.
 *
 * @otel-exempt pure parser.
 */
export function parseGhPrListJson(
  stdout: string,
  branchFilter?: (branchName: string) => boolean,
): readonly TouchesPrSnapshot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
    // rule-6: handled-locally — empty/non-JSON gh output → no PRs known → return empty array
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TouchesPrSnapshot[] = [];
  for (const row of parsed) {
    const shaped = shapePrRow(row);
    if (shaped === undefined) continue;
    if (branchFilter !== undefined && !branchFilter(shaped.headRefName)) continue;
    out.push({ number: shaped.number, files: shaped.files });
  }
  return out;
}

type ShapedRow = {
  readonly number: number;
  readonly files: readonly string[];
  readonly headRefName: string;
};

/**
 * Validate the shape of a single `gh pr list` row. Returns `undefined`
 * for malformed input — the caller drops it.
 */
function shapePrRow(row: unknown): ShapedRow | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const r = row as Record<string, unknown>;
  if (typeof r["number"] !== "number") return undefined;
  if (typeof r["headRefName"] !== "string") return undefined;
  if (!Array.isArray(r["files"])) return undefined;
  return {
    number: r["number"],
    files: extractFilePaths(r["files"]),
    headRefName: r["headRefName"],
  };
}

/** Extract the `path` string from each file row, dropping malformed entries. */
function extractFilePaths(rawFiles: readonly unknown[]): readonly string[] {
  const files: string[] = [];
  for (const f of rawFiles) {
    if (typeof f !== "object" || f === null) continue;
    const path = (f as Record<string, unknown>)["path"];
    if (typeof path === "string") files.push(path);
  }
  return files;
}

/**
 * Branch-name predicate that matches the daemon's `daemon/<worker-id>/<task-id>`
 * convention introduced by slice 2 of `daemon-parallel-worktree-launch`.
 * Pre-built so the operator doesn't have to reconstruct the regex when
 * wiring the fetcher.
 */
export const isDaemonAuthoredBranch = (branchName: string): boolean =>
  /^daemon\/\d+\//.test(branchName);
