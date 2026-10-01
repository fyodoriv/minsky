#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved Tier 1 stop-gate sub-check per det-tool-call-discipline-prose-without-tool-call (PR #911 cohort task) -->
//
// check-tool-call-discipline — detect the "prose without tool call" pattern.
//
// Per AGENTS.md §"Tool-call discipline (load-bearing for non-Claude models)":
//
//   EVERY reply you emit must include a tool call — terminal, file_editor,
//   task_tracker, or finish. The OpenHands SDK (and similar agent frameworks)
//   treat a reply containing only prose with no tool call as the
//   conversation-end signal and TERMINATE the conversation immediately,
//   regardless of whether the work has shipped.
//
//   Observed failure mode (2026-05-27, ollama_chat/qwen3-coder:30b): 13/13
//   consecutive iterations emitted a final message like
//   "Let me examine the main supervisor script" AS PROSE WITH NO ATTACHED
//   TOOL CALL. Each conversation ended right there, producing zero
//   commits / zero PRs / zero pushes.
//
// This script reads a Claude Code transcript (`.jsonl`) and walks the most
// recent assistant turn. If the turn's content blocks are pure text
// (no tool_use block) AND the text matches one of the forbidden-prose
// patterns from AGENTS.md, exit 2 with a corrective stderr telling the
// agent to attach a tool call to its next reply.
//
// Wired into `.claude/hooks/stop-gate.sh` as the FIRST check (cheap; runs
// before the heavier pre-pr-lint subset).
//
// Pattern: pure transcript walker + injected reader (rule #2). Pure
// function shape lets tests pass synthetic jsonl strings; production reads
// from the path in the hook input JSON. Conformance: full.
//
// Sources:
//   - AGENTS.md §"Tool-call discipline" (verbatim policy)
//   - OpenHands #12462 (Qwen2.5-coder chatty-response failure mode)
//   - Ravichander et al. 2026 arXiv:2603.23806 "Willful Disobedience:
//     Automatically Detecting Failures in Agentic Traces"
//   - Anthropic 2026 Claude Code hooks reference (Stop event +
//     transcript_path input field)

import { readFileSync } from "node:fs";
import process from "node:process";

/**
 * Forbidden-prose patterns lifted verbatim from AGENTS.md §"Tool-call
 * discipline (load-bearing for non-Claude models)" — the "Forbidden
 * patterns" sub-section. Each is matched case-insensitively at any
 * position in the text.
 *
 * @type {readonly RegExp[]}
 */
export const FORBIDDEN_PROSE_PATTERNS = Object.freeze([
  /\blet me examine\b/i,
  /\bnow i'?ll\b/i,
  /\blet me check\b/i,
  /\bi'?ll go ahead and\b/i,
  /\blet me verify\b/i,
  /\blet me look at\b/i,
  /\bnow let'?s\b/i,
  /\bi'?m going to\b/i,
]);

/**
 * Terminal-signal patterns — text snippets that indicate the agent's turn
 * has legitimately ended (e.g. PR opened, task complete). If the LAST
 * assistant block is text AND contains one of these, it's NOT a violation
 * even if it ALSO matches a forbidden-prose pattern.
 *
 * @type {readonly RegExp[]}
 */
export const TERMINAL_SIGNAL_PATTERNS = Object.freeze([
  /https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/i,
  /\bpr opened\b/i,
  /\btask (?:complete|finished|done)\b/i,
  /\bmerged into main\b/i,
  /\bshipped\b/i,
]);

/**
 * @typedef {object} TranscriptEntry
 * @property {string} [type]
 * @property {{ role?: string, content?: unknown[] } | undefined} [message]
 */

/**
 * @typedef {object} ContentBlock
 * @property {string} [type]    "text" | "tool_use" | "thinking" | ...
 * @property {string} [text]
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok        true = pass, false = violation
 * @property {string[]} violations  human-readable reasons
 * @property {string} [lastText]    the offending text (for diagnostics)
 */

/**
 * Pure function: walk a transcript-jsonl string, find the most recent
 * assistant turn, check it for the prose-without-tool-call pattern.
 *
 * @param {string} transcriptText  full jsonl file contents
 * @returns {CheckResult}
 */
export function checkTranscript(transcriptText) {
  const entries = parseJsonl(transcriptText);
  const lastTurn = extractLastAssistantTurn(entries);
  if (lastTurn === null) {
    // No assistant entries — turn never started; nothing to gate.
    return { ok: true, violations: [] };
  }
  return checkLastTurn(lastTurn);
}

/**
 * Parse jsonl text. Skips invalid lines silently — a malformed line is
 * Claude Code's bug, not an agent violation. Per rule #6 ("let it
 * crash") we surface the issue elsewhere (the daemon's hook-error
 * reporter); this gate is best-effort.
 *
 * @param {string} text
 * @returns {TranscriptEntry[]}
 */
function parseJsonl(text) {
  /** @type {TranscriptEntry[]} */
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/**
 * Find the most recent contiguous run of assistant entries (i.e. the last
 * "assistant turn" before Claude ended its turn). Returns the array of
 * entries OR null if no assistant entry exists.
 *
 * Claude Code splits each assistant message into MULTIPLE jsonl entries:
 * one per content block (text, tool_use, etc.). A "turn" is the
 * uninterrupted sequence between two non-assistant entries.
 *
 * @param {TranscriptEntry[]} entries
 * @returns {TranscriptEntry[] | null}
 */
function extractLastAssistantTurn(entries) {
  /** @type {TranscriptEntry[]} */
  const turn = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type === "assistant") {
      turn.unshift(e);
    } else if (turn.length > 0) {
      // hit a non-assistant boundary — the turn we found is complete
      return turn;
    }
  }
  return turn.length > 0 ? turn : null;
}

/**
 * The core check: does the turn contain at least one tool_use? If yes, OK.
 * If no AND the text matches a forbidden-prose pattern AND no terminal
 * signal, violation.
 *
 * @param {TranscriptEntry[]} turn
 * @returns {CheckResult}
 */
function checkLastTurn(turn) {
  const allBlocks = turn.flatMap((e) => extractContentBlocks(e));
  const hasToolUse = allBlocks.some((b) => b.type === "tool_use");
  if (hasToolUse) {
    return { ok: true, violations: [] };
  }
  const text = allBlocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text ?? "")
    .join("\n");

  if (text.length === 0) {
    // empty turn — no violation, just unusual
    return { ok: true, violations: [] };
  }

  if (TERMINAL_SIGNAL_PATTERNS.some((re) => re.test(text))) {
    // legitimate terminal text (PR opened, task complete) — pass
    return { ok: true, violations: [], lastText: text };
  }

  const matchedPattern = FORBIDDEN_PROSE_PATTERNS.find((re) => re.test(text));
  if (matchedPattern !== undefined) {
    return {
      ok: false,
      violations: [
        `Last assistant turn contains forbidden prose pattern "${matchedPattern.source}" with NO attached tool_use block. Per AGENTS.md §"Tool-call discipline": every reply must include a tool call (terminal, file_editor, task_tracker, or finish). Use the \`think\` tool if you only need to deliberate.`,
      ],
      lastText: text,
    };
  }

  return { ok: true, violations: [], lastText: text };
}

/**
 * @param {TranscriptEntry} entry
 * @returns {ContentBlock[]}
 */
function extractContentBlocks(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  /** @type {ContentBlock[]} */
  const out = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      out.push(/** @type {ContentBlock} */ (block));
    }
  }
  return out;
}

// ----------------------------------------------------------------- CLI -----

/**
 * @param {string[]} argv
 * @returns {{ transcript?: string, fromHookStdin: boolean }}
 */
export function parseArgs(argv) {
  let transcript;
  let fromHookStdin = false;
  for (const arg of argv) {
    if (arg === "--from-hook-stdin") {
      fromHookStdin = true;
      continue;
    }
    const m = /^--transcript=(.+)$/.exec(arg);
    if (m && m[1] !== undefined) {
      transcript = m[1];
    }
  }
  return transcript === undefined ? { fromHookStdin } : { transcript, fromHookStdin };
}

/**
 * Read the hook input JSON from stdin and extract `transcript_path`.
 *
 * @returns {Promise<string | undefined>}
 */
function readTranscriptPathFromHookStdin() {
  return new Promise((resolve) => {
    /** @type {string[]} */
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c.toString("utf8")));
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(chunks.join(""));
        const path =
          typeof parsed === "object" && parsed !== null
            ? /** @type {Record<string, unknown>} */ (parsed)["transcript_path"]
            : undefined;
        resolve(typeof path === "string" ? path : undefined);
      } catch {
        resolve(undefined);
      }
    });
    // Don't hang if stdin is closed without data.
    process.stdin.on("error", () => resolve(undefined));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let transcriptPath = args.transcript;
  if (transcriptPath === undefined && args.fromHookStdin) {
    transcriptPath = await readTranscriptPathFromHookStdin();
  }
  if (transcriptPath === undefined || transcriptPath === "") {
    // No transcript available — pass-through (don't block the Stop on
    // a missing-transcript Claude Code bug).
    process.exit(0);
  }
  let text;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch (err) {
    // Transcript file missing or unreadable — pass-through, same reasoning.
    console.error(
      `check-tool-call-discipline: could not read transcript ${transcriptPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(0);
  }

  const result = checkTranscript(text);
  if (result.ok) {
    process.exit(0);
  }
  for (const v of result.violations) {
    console.error(v);
  }
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
