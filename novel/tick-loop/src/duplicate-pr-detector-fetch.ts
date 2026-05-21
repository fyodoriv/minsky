// <!-- scope: human-approved P0 daemon-duplicate-work-detection (TASKS.md, operator 2026-05-07) -->

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  type DuplicateDecision,
  decideDuplicate,
  parseGhPrListForDuplicateDetection,
} from "./duplicate-pr-detector.js";

const execFile = promisify(execFileCb);

/**
 * Slice 3/N I/O wrapper for `daemon-duplicate-work-detection`.
 *
 * Mirrors `touches-glob-fetch.ts` (`createOpenPrFetcher`) and the
 * decision→parser→execFile→plumb slicing of `daemon-pr-state.ts`. Slices
 * 1–2 shipped the pure decision (`decideDuplicate`) and the pure parser
 * (`parseGhPrListForDuplicateDetection`). This slice is the thin I/O
 * surface that runs
 *
 *   gh pr list --search "<task-id> in:title" --author <author>
 *              --state all --json number,title,state,closedAt --limit 100
 *
 * feeds the parser, and runs the verdict — returning a `DuplicateDecision`
 * the daemon consults BEFORE `gh pr create`. Slice 4+ plumbs the verdict
 * into `runClaimedIteration` (after `pickAndClaim`, before the spawn that
 * runs `gh pr create`): `open` → rebase + fix-iterate on PR #N (the
 * existing `daemon-fix-own-pr-on-ci-failure` flow), `merged-recent` →
 * write the TASKS.md completion edit and `noop, exiting` (composes with
 * `daemon-task-rotation-on-completion`), `none` → proceed.
 *
 * Rule #2: the dep (`gh`) is behind the injectable `runGhPrList` seam; the
 * pure decision/parser stay in `duplicate-pr-detector.ts`. Rule #6: a `gh`
 * outage / auth failure rejects the promise; the daemon catches it at the
 * iteration boundary (let-it-crash) — the conservative fallback there is
 * "no duplicate found → proceed", backstopped by the claim layer (#298).
 *
 * Pivot (TASKS.md `daemon-duplicate-work-detection`): if the `--search`
 * query mis-classifies unrelated PRs that merely mention the task ID,
 * `author` already restricts the result set to daemon-authored PRs
 * (default `@me`); the branch-name half of the pivot (`daemon/<id>/<task-id>`)
 * requires extending the slice-2 parser to surface `headRefName` and is a
 * documented future slice rather than dead config here.
 *
 * @otel-exempt thin I/O wrapper; the daemon emits the iteration span and
 *   includes this verdict.
 */

/**
 * Async function that, given a task ID, returns the duplicate-work verdict
 * for it. Call once per claimed iteration (after `pickAndClaim`, before
 * `gh pr create`); do NOT cache across iterations — a PR can merge or open
 * between ticks.
 */
export type DuplicateCheckFetcher = (taskId: string) => Promise<DuplicateDecision>;

/**
 * Inputs for the fetcher factory. Tests inject `runGhPrList` and `now`;
 * production uses the defaults that call `gh` via `execFile` and read the
 * wall clock.
 */
export type CreateDuplicateCheckFetcherInput = {
  /**
   * `gh pr list --author <value>` filter. Default `"@me"` — the GitHub
   * authenticated user (the daemon's bot identity in production). This is
   * the conservative half of the task's pivot: only daemon-authored PRs
   * gate a new PR, so a human PR that mentions the task ID never blocks
   * the daemon.
   */
  readonly author?: string;
  /**
   * Optional repo override (`<owner>/<name>`). When undefined, `gh`
   * resolves the repo from the cwd's `origin` remote.
   */
  readonly repo?: string;
  /**
   * Forwarded to `decideDuplicate` — the "merged recently enough that
   * re-opening would be a duplicate" window. Default (in the decision) 7
   * days.
   */
  readonly recentMergedWindowDays?: number;
  /**
   * Injected I/O — defaults to a real `gh pr list` call. Tests pass a
   * stub that returns canned JSON.
   */
  readonly runGhPrList?: (args: readonly string[]) => Promise<string>;
  /**
   * Injected clock — defaults to `Date.now`. Tests pin it so the
   * `merged-recent` window is deterministic.
   */
  readonly now?: () => number;
};

/** Default `gh pr list` runner — calls `gh` via `execFile`. */
async function defaultRunGhPrList(args: readonly string[]): Promise<string> {
  const { stdout } = await execFile("gh", args.slice());
  return stdout;
}

/**
 * Build a {@link DuplicateCheckFetcher} that calls
 * `gh pr list --search "<task-id> in:title" --author <author> --state all
 * --json number,title,state,closedAt --limit 100`, parses the result via
 * {@link parseGhPrListForDuplicateDetection}, and runs
 * {@link decideDuplicate}.
 *
 * Failures (`gh` missing, auth expired, network) bubble up as rejected
 * promises; the daemon catches them at the iteration boundary and proceeds
 * conservatively (the claim layer #298 still prevents same-task selection
 * across workers) — rule #6 let-it-crash, visible-not-silent.
 *
 * @otel-exempt thin I/O wrapper; the daemon emits the span.
 */
export function createDuplicateCheckFetcher(
  input: CreateDuplicateCheckFetcherInput = {},
): DuplicateCheckFetcher {
  const author = input.author ?? "@me";
  const runGhPrList = input.runGhPrList ?? defaultRunGhPrList;
  const now = input.now ?? Date.now;
  return async (taskId: string) => {
    const args = [
      "pr",
      "list",
      "--search",
      `${taskId} in:title`,
      "--author",
      author,
      "--state",
      "all",
      "--json",
      "number,title,state,closedAt",
      "--limit",
      "100",
    ];
    if (input.repo !== undefined) {
      args.push("--repo", input.repo);
    }
    const stdout = await runGhPrList(args);
    const prs = parseGhPrListForDuplicateDetection(stdout);
    // `exactOptionalPropertyTypes`: omit `recentMergedWindowDays` entirely
    // when unset rather than passing `undefined` (which the decision's
    // optional-property type rejects); `decideDuplicate` applies its own
    // 7-day default.
    return decideDuplicate(
      input.recentMergedWindowDays === undefined
        ? { taskId, prs, now: now() }
        : { taskId, prs, now: now(), recentMergedWindowDays: input.recentMergedWindowDays },
    );
  };
}
