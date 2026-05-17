// <!-- scope: human-approved minsky-cli-context-aware-ux (operator 2026-05-08) -->
/**
 * `@minsky/tick-loop/minsky-prompt` — interactive prompt for the context-
 * aware `minsky` (no-args) UX. Slice 3 of P0 task
 * `minsky-cli-context-aware-ux`.
 *
 * Two modes:
 *
 *   - **Interactive (TTY)**: renders the plan with a numbered option list and
 *     waits for `[Enter]` (recommended) or a digit (alternative). Validates
 *     input; invalid input falls back to the recommended action.
 *
 *   - **Non-interactive (non-TTY or `MINSKY_NON_INTERACTIVE=1`)**: renders a
 *     one-line "running recommended action" message and returns immediately.
 *     Required per rule #6 (stay-alive on non-interactive surfaces such as
 *     cron / launchd / CI where `stdin` is `/dev/null`).
 *
 * Pure-over-injection: `stdin` and `stdout` are injected seams so tests can
 * exercise the prompt without a real TTY.
 *
 * Pattern conformance (rule #8):
 *   - **Pure render** — `renderPlan` is referentially transparent. Conformance: full.
 *   - **Loud-crash boundary** — Armstrong 2007. The readline "close" event
 *     (stdin EOF / Ctrl-D) resolves to `""`, which maps to the recommended
 *     action — the right boundary for a non-answering user. Conformance: full.
 *
 * @module tick-loop/minsky-prompt
 */

import type { ActionId, MinskyAction, MinskyActionPlan } from "./minsky-action-plan.js";

// ---- Types ------------------------------------------------------------------

/** Injectable I/O seams for the prompt. */
export interface PromptOpts {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  /** Whether the surface supports interactive input. */
  readonly isTty: boolean;
}

// ---- renderPlan -------------------------------------------------------------

/**
 * Render the action plan as a multi-line string for display. Pure: no I/O.
 *
 * Format:
 * ```
 * minsky: <contextSummary>
 *
 *   → <recommendedAction.label>  [Enter to confirm]
 *   1. <alternative 1>
 *   2. <alternative 2>
 *
 * ```
 *
 * @otel-exempt pure render — no I/O.
 */
export function renderPlan(plan: MinskyActionPlan): string {
  const lines: string[] = [];
  lines.push(`minsky: ${plan.contextSummary}`);
  lines.push("");
  lines.push(`  → ${plan.recommendedAction.label}  [Enter to confirm]`);
  for (let i = 0; i < plan.alternatives.length; i++) {
    lines.push(`  ${i + 1}. ${(plan.alternatives[i] as MinskyAction).label}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---- runInteractive ---------------------------------------------------------

/**
 * Show the plan, wait for user input (TTY) or auto-confirm (non-TTY), and
 * return the chosen `ActionId`.
 *
 * On non-TTY or `MINSKY_NON_INTERACTIVE=1`: prints a one-line summary and
 * returns `plan.recommendedAction.id` immediately (no blocking).
 *
 * On TTY: renders the full plan, waits for a single line of input, and
 * parses:
 *   - `""` or `"y"` / `"Y"` → recommended action
 *   - `"1"` … `"N"` → alternative at that 1-based index
 *   - anything else → recommended action (graceful fallback)
 *
 * @otel-exempt I/O orchestrator; callers carry the span.
 */
export async function runInteractive(plan: MinskyActionPlan, opts: PromptOpts): Promise<ActionId> {
  const nonInteractive = !opts.isTty;

  if (nonInteractive) {
    opts.stdout.write(
      `minsky: ${plan.contextSummary} (non-interactive — running: ${plan.recommendedAction.label})\n`,
    );
    return plan.recommendedAction.id;
  }

  opts.stdout.write(`${renderPlan(plan)}`);
  const choiceLabel = buildChoiceLabel(plan.alternatives.length);
  opts.stdout.write(choiceLabel);

  const line = await readOneLine(opts.stdin);
  return resolveChoice(line, plan);
}

// ---- Internal helpers -------------------------------------------------------

function buildChoiceLabel(alternativeCount: number): string {
  if (alternativeCount === 0) return "Choice [Enter]: ";
  const digits = Array.from({ length: alternativeCount }, (_, i) => String(i + 1)).join("/");
  return `Choice [Enter/${digits}]: `;
}

async function readOneLine(stdin: NodeJS.ReadableStream): Promise<string> {
  return new Promise<string>((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) {
        stdin.removeListener("data", onData);
        resolve(buf.split("\n")[0]?.trim() ?? "");
      }
    };
    stdin.on("data", onData);
    stdin.once("end", () => {
      stdin.removeListener("data", onData);
      resolve(buf.split("\n")[0]?.trim() ?? "");
    });
  });
}

function resolveChoice(line: string, plan: MinskyActionPlan): ActionId {
  if (line === "" || line.toLowerCase() === "y") {
    return plan.recommendedAction.id;
  }
  const num = Number.parseInt(line, 10);
  if (Number.isInteger(num) && num >= 1 && num <= plan.alternatives.length) {
    return (plan.alternatives[num - 1] as MinskyAction).id;
  }
  return plan.recommendedAction.id;
}
