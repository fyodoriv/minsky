#!/usr/bin/env node
// <!-- scope: human-approved 2026-05-26 — operator-directed UX improvement to `pnpm minsky:logs` (structured viewer with tags + colors + span pretty-printing; renamed from `pnpm dogfood:logs` same session). Pre-emptively opted out of rule-12-scope-discipline because the task lives in the operator's session log, not a TASKS.md block; the script is the deliverable, not the artifact-of-a-task. -->
// Pretty log viewer for the minsky tick-loop. Pattern: pure shape-transform
// (`formatLine`, `formatSpan`) composed with one I/O seam (`tailFile`) above
// a tiny CLI — rule #2 (data-not-code), rule #10 (deterministic transforms).
// The supervisor unit files (launchd plist, systemd service) write raw lines
// to `~/.minsky/tick-loop.{out,err}.log`; this script tails both with proper
// stream tags, ANSI colors per source category, and per-span pretty-printing
// of the JSON payloads (iteration / strategic-pick / llm-provider.dispatch
// are the high-signal events the operator wants to read at a glance).
//
// Anchor: 2026-05-26 operator directive — "improve pnpm dogfood:logs [renamed
//   to pnpm minsky:logs same session] so that it has proper tags, colors, etc".
//   The previous shape (`tail -F a b`) had zero structure: same color for every
//   line, JSON spans inline, no source distinction beyond the `==> file <==`
//   headers.
// Conformance: full — pure formatters export to `minsky-logs.test.mjs`;
//   `tailFile` is the only spawn site.
// Pivot (rule #9): if span shapes drift (`tick-loop.iteration` field names
//   change) and the per-name formatters silently fall through to the generic
//   span format, the operator's high-signal lines lose their key fields. The
//   pure formatters' paired tests pin the field names so a daemon-side rename
//   triggers a test failure (deterministic enforcement, not vibes).
// Failure modes (rule #7):
//   - Log file missing → `tail -F` waits for creation (graceful-degrade).
//   - Non-TTY stdout → ANSI codes stripped (rule #6: visible-not-silent
//     would be polluting pipes; isTTY gates output cleanly).
//   - Malformed JSON in a span line → fall back to raw line dimmed (rule #7
//     graceful-degrade — never crash on bad upstream output).
//   - SIGINT/SIGTERM → terminate child `tail` processes cleanly.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const HOME = process.env["MINSKY_HOME"] ?? process.cwd();
const STATE_DIR = process.env["MINSKY_STATE_DIR"] ?? `${process.env["HOME"]}/.minsky`;

/**
 * Per-source descriptor used by `--all` mode and `bin/minsky logs`. Each
 * source becomes a `[tag]` prefix in front of every line, colored
 * uniquely so the operator can disambiguate interleaved streams at a
 * glance.
 *
 * Order matters: most-load-bearing sources first (tick-loop's err is the
 * single highest-signal stream — that's where iteration verdicts land).
 *
 * Source: 2026-05-27 operator directive "ensure all logs commands have
 * full colors & tags". Pre-2026-05-27 `pnpm minsky:logs` tailed only
 * tick-loop.{out,err} and `bin/minsky logs` did a raw `tail -f`. Now
 * both route through this dispatch table and any new operator-relevant
 * log gets added here in one place.
 *
 * @type {readonly {path: string, tag: string, tagColor: string, stream: "out" | "err"}[]}
 */
const ALL_SOURCES = [
  {
    path: resolve(HOME, ".minsky/tick-loop.err.log"),
    tag: "tick-loop:err",
    tagColor: "\x1b[33m",
    stream: "err",
  },
  {
    path: resolve(HOME, ".minsky/tick-loop.out.log"),
    tag: "tick-loop:out",
    tagColor: "\x1b[36m",
    stream: "out",
  },
  {
    path: resolve(STATE_DIR, "auto-merge.log"),
    tag: "auto-merge",
    tagColor: "\x1b[32m",
    stream: "out",
  },
  { path: resolve(STATE_DIR, "daemon.log"), tag: "daemon", tagColor: "\x1b[35m", stream: "out" },
  {
    path: resolve(HOME, ".minsky/watchdog.out.log"),
    tag: "watchdog",
    tagColor: "\x1b[34m",
    stream: "out",
  },
  {
    path: resolve(HOME, ".minsky/runany.err.log"),
    tag: "runany:err",
    tagColor: "\x1b[91m",
    stream: "err",
  },
  {
    path: resolve(HOME, ".minsky/runany.out.log"),
    tag: "runany:out",
    tagColor: "\x1b[94m",
    stream: "out",
  },
];

// Sane default = every source. Operator directive 2026-05-27:
// "Let's just have one log command with sane defaults." The old
// `tick-loop only` default forced the operator to remember --all to
// see auto-merge / watchdog / runany streams. With this change, the
// no-args invocation gives the operator EVERYTHING — `--source tick-
// loop` is the focus-mode flag, not the implicit default.
const DEFAULT_SOURCES = ALL_SOURCES;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
};

const USE_COLOR = process.stdout.isTTY && !process.env["NO_COLOR"];

/**
 * Wrap `s` in ANSI `c` if color output is enabled, else return raw.
 * @param {string} c
 * @param {string} s
 * @returns {string}
 */
export function color(c, s) {
  return USE_COLOR ? `${c}${s}${ANSI.reset}` : s;
}

/**
 * UTC HH:MM:SS timestamp of arrival (not log-write time — `tail -F` doesn't
 * surface the original write time; arrival is close enough for live viewing).
 * @returns {string}
 */
export function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

/**
 * Pretty-print a `[span] tick-loop.<name> {JSON}` line. Per-name formatters
 * extract the high-signal fields and lay them out as a compact one-liner
 * with the JSON dropped. Unknown span names fall through to the generic
 * `[span] name {JSON-dimmed}` shape.
 * @param {string} line
 * @returns {string | null}  formatted line, or null if the line isn't a span
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: span-name dispatch table — per-name formatters extract different fields per shape; flattening into helpers per case would obscure the at-a-glance "this is the iteration formatter" reading. Refactor to a `{name -> formatterFn}` map only if we add ≥3 more span types (rule #9 pivot threshold).
export function formatSpan(line) {
  // First-pass: detect the span shape by prefix + name only, so malformed
  // JSON still gets the graceful-degrade dimmed-passthrough (rule #7).
  const prefix = line.match(/^\[span\] tick-loop\.([\w.-]+)\s+(.*)$/);
  if (prefix === null || prefix[1] === undefined || prefix[2] === undefined) return null;
  const name = prefix[1];
  let parsed;
  try {
    parsed = JSON.parse(prefix[2]);
  } catch {
    return color(ANSI.dim, line);
  }

  if (name === "iteration") {
    const status = parsed["iteration.status"] ?? "unknown";
    const idx = parsed["iteration.index"] ?? "?";
    const task = parsed["task.id"] ?? "?";
    const provider = parsed["iteration.provider"] ?? "?";
    const reason = (parsed["iteration.reason"] ?? "").replace(/\n/g, " ").trim();
    const statusTag =
      status === "validated" || status === "pr-open"
        ? color(ANSI.bgGreen + ANSI.bold, " PASS ")
        : status === "failed"
          ? color(ANSI.bgRed + ANSI.bold, " FAIL ")
          : color(ANSI.dim, ` ${status} `);
    const head = `${statusTag} ${color(ANSI.cyan, `iter#${idx}`)} ${color(ANSI.magenta, task)}`;
    const via = provider ? ` ${color(ANSI.dim, `via ${provider}`)}` : "";
    const why = reason ? ` ${color(ANSI.red, `— ${reason.slice(0, 240)}`)}` : "";
    return `${head}${via}${why}`;
  }

  if (name === "strategic-pick") {
    const model = parsed.model ?? "?";
    const agent = parsed.agent ?? "?";
    const kind = parsed.kind ?? "?";
    const reason = parsed.reason ?? "";
    const agentColor =
      agent === "claude" ? ANSI.yellow : agent === "devin" ? ANSI.cyan : ANSI.magenta;
    return `${color(ANSI.blue, "[pick]")} ${color(agentColor + ANSI.bold, `${agent}/${model}`)} ${color(ANSI.dim, `(${kind})`)} ${color(ANSI.dim, reason)}`;
  }

  if (name === "llm-provider.dispatch") {
    const provider = parsed.provider ?? "?";
    const localOk = parsed["local.reachable"] === true;
    const localReason = parsed["local.reason"] ?? "";
    const budgetState = parsed["budget.state"] ?? "?";
    const localTag = localOk
      ? color(ANSI.green, "local:ok")
      : color(ANSI.dim, `local:no(${localReason})`);
    return `${color(ANSI.blue, "[dispatch]")} ${color(ANSI.cyan, `→ ${provider}`)} ${color(ANSI.dim, `budget=${budgetState}`)} ${localTag} ${color(ANSI.dim, parsed.reason ?? "")}`;
  }

  if (name === "auto-scale.decision") {
    const verdict = parsed.verdict ?? "?";
    const reason = parsed.reason ?? "";
    const verdictColor = verdict === "spawn" ? ANSI.green : ANSI.yellow;
    return `${color(ANSI.blue, "[auto-scale]")} ${color(verdictColor + ANSI.bold, verdict)} ${color(ANSI.dim, reason)}`;
  }

  if (name === "changelog" || name === "snapshot" || name === "metrics-render") {
    const outcome = parsed[`${name}.outcome`] ?? "?";
    const date = parsed[`${name}.date`] ?? "";
    const exit = parsed[`${name}.exit_code`];
    const skip = parsed[`${name}.skip_reason`];
    const outcomeColor =
      outcome === "ran" && exit === 0 ? ANSI.green : outcome === "ran" ? ANSI.red : ANSI.dim;
    const suffix = skip
      ? color(ANSI.dim, `skip=${skip}`)
      : exit !== undefined
        ? color(outcomeColor, `exit=${exit}`)
        : "";
    return `${color(ANSI.blue, `[${name}]`)} ${color(outcomeColor, outcome)} ${color(ANSI.dim, date)} ${suffix}`;
  }

  if (name === "parallel-sweeper.tick") {
    const locks = parsed["sweeper.indexLocksSwept"] ?? 0;
    const claims = parsed["sweeper.expiredClaimsSwept"] ?? 0;
    if (locks === 0 && claims === 0) {
      // Quiet sweep — dim it; happens every tick.
      return color(ANSI.dim, "[sweeper] clean");
    }
    return `${color(ANSI.blue, "[sweeper]")} ${color(ANSI.yellow, `locks=${locks} claims=${claims}`)}`;
  }

  // Generic span fallback — keep the name visible, dim the payload.
  const payload = JSON.stringify(parsed) ?? "";
  return `${color(ANSI.blue, "[span]")} ${color(ANSI.cyan, name)} ${color(ANSI.dim, payload)}`;
}

/**
 * Format a single log line for display. Pure — given the same `stream` and
 * `line`, always emits the same output (modulo timestamp).
 * @param {"out" | "err"} stream
 * @param {string} line
 * @returns {string}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: prefix-routing table — each `line.startsWith(prefix)` branch is one short formatter call; the alternative (an array of [predicate, formatter] tuples) hides the per-prefix coloring choice. Refactor only when ≥10 prefix categories accumulate.
export function formatLine(stream, line) {
  if (line.trim() === "") return "";
  const ts = color(ANSI.dim, timestamp());
  const streamTag =
    stream === "err" ? color(ANSI.yellow + ANSI.bold, "ERR") : color(ANSI.dim, "OUT");

  const span = formatSpan(line);
  if (span !== null) return `${ts} ${streamTag} ${span}`;

  if (line.startsWith("[tick-loop]")) {
    const body = line.slice("[tick-loop]".length).trim();
    return `${ts} ${streamTag} ${color(ANSI.cyan, "[tick-loop]")} ${body}`;
  }
  if (line.startsWith("[config-analyzer]")) {
    const body = line.slice("[config-analyzer]".length).trim();
    return `${ts} ${streamTag} ${color(ANSI.yellow, "[config-analyzer]")} ${body}`;
  }
  if (line.startsWith("[machine-budget]")) {
    const body = line.slice("[machine-budget]".length).trim();
    return `${ts} ${streamTag} ${color(ANSI.yellow, "[machine-budget]")} ${body}`;
  }
  if (line.startsWith("self-diagnose:") || line.startsWith("self-diagnose findings")) {
    return `${ts} ${streamTag} ${color(ANSI.magenta + ANSI.bold, "[self-diagnose]")} ${color(ANSI.dim, line.replace(/^self-diagnose:?\s*/, "").replace(/^findings.*:?/, "findings:"))}`;
  }
  // Actor labels emitted by `self-diagnose --human` (operator directive
  // 2026-05-26 — make it clear whether intervention is needed). Color
  // by responsibility so the operator can find their action items at
  // a glance: red for 👤 needs-operator (the operator must act); cyan
  // for 🤖 minsky-will-fix (the daemon handles it next iter); yellow
  // for 🤖→👤 minsky-tries-then-operator (auto-attempt then escalate).
  if (line.includes("[👤 needs-operator]")) {
    return `${ts} ${streamTag} ${color(ANSI.red + ANSI.bold, line)}`;
  }
  if (line.includes("[🤖 minsky-will-fix]")) {
    return `${ts} ${streamTag} ${color(ANSI.cyan + ANSI.bold, line)}`;
  }
  if (line.includes("[🤖→👤 minsky-tries-then-operator]")) {
    return `${ts} ${streamTag} ${color(ANSI.yellow + ANSI.bold, line)}`;
  }
  if (line.startsWith("tick-loop: worker")) {
    return `${ts} ${streamTag} ${color(ANSI.magenta, "[worker]")} ${line.slice("tick-loop:".length).trim()}`;
  }
  if (line.includes("ERR_AMBIGUOUS_MODULE_SYNTAX") || /^\s*at\s+\w/.test(line)) {
    return `${ts} ${streamTag} ${color(ANSI.red, line)}`;
  }
  if (/\b(error|fail|fatal|panic|exception|cannot)\b/i.test(line) && stream === "err") {
    return `${ts} ${streamTag} ${color(ANSI.red, line)}`;
  }
  if (line.trim().startsWith("{") || line.trim().startsWith("[") || /^\s+"/.test(line)) {
    return `${ts} ${streamTag} ${color(ANSI.dim, line)}`;
  }
  return `${ts} ${streamTag} ${line}`;
}

/**
 * Prepend a colored `[source-tag]` to a formatted line so interleaved
 * streams stay readable when `--all` mode tails multiple sources at
 * once. Pure — no I/O.
 *
 * @param {string} tag
 * @param {string} tagColor  raw ANSI sequence (e.g. ANSI.yellow)
 * @param {string} formatted  output of `formatLine`
 * @returns {string}
 */
export function prefixSourceTag(tag, tagColor, formatted) {
  return `${color(tagColor + ANSI.bold, `[${tag}]`)} ${formatted}`;
}

/**
 * Spawn `tail -F` on `source.path` and forward formatted lines to
 * stdout, prefixed with the source's tag.
 *
 * @param {{path: string, tag: string, tagColor: string, stream: "out" | "err"}} source
 * @param {{includeSourceTag: boolean}} opts
 * @returns {import("node:child_process").ChildProcess}
 */
function tailFile(source, opts) {
  const child = spawn("tail", ["-F", "-n", "50", source.path], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const formatted = formatLine(source.stream, line);
      if (formatted === "") continue;
      const out = opts.includeSourceTag
        ? prefixSourceTag(source.tag, source.tagColor, formatted)
        : formatted;
      process.stdout.write(`${out}\n`);
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.on("exit", (code) => {
    process.stderr.write(`${color(ANSI.red, `tail ${source.path} exited with code ${code}`)}\n`);
  });
  return child;
}

/**
 * Resolve which sources to tail based on CLI args.
 *
 * Default = every source in `ALL_SOURCES` (sane default — the operator
 * gets EVERYTHING without remembering a flag). `--source <name>` is the
 * focus-mode escape hatch. `--all` is retained as an explicit alias for
 * the default so back-compat scripts don't break.
 *
 * @param {string[]} argv
 * @returns {{sources: typeof ALL_SOURCES, mode: "default" | "filter"}}
 */
export function resolveSources(argv) {
  if (argv.includes("--all")) return { sources: ALL_SOURCES, mode: "default" };
  const sourceIdx = argv.indexOf("--source");
  if (sourceIdx !== -1) {
    const name = argv[sourceIdx + 1];
    if (name) {
      const matched = ALL_SOURCES.filter((s) => s.tag === name || s.tag.startsWith(`${name}:`));
      if (matched.length > 0) return { sources: matched, mode: "filter" };
    }
  }
  return { sources: DEFAULT_SOURCES, mode: "default" };
}

// CLI entrypoint — only runs when invoked directly, never on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "Usage: bin/minsky logs [--source <name>]",
        "  Aliases: `pnpm minsky:logs`",
        "",
        "Default: tails EVERY source in the registry (tick-loop, auto-merge,",
        "daemon, watchdog, runany) with ANSI colors + per-source [tag] prefixes.",
        "",
        "Options:",
        "  --source <name>    tail only the matching source(s) — `--source tick-loop`",
        "                     covers both `tick-loop:out` and `tick-loop:err`",
        "  --all              explicit alias for the default (no-op kept for back-compat)",
        "  --help, -h         this message",
        "",
        "Available sources:",
        ...ALL_SOURCES.map((s) => `  ${s.tag.padEnd(16)} ${s.path}`),
        "",
      ].join("\n"),
    );
    process.exit(0);
  }
  const { sources, mode } = resolveSources(argv);
  // Existence check (rule #6 — fail loud, not silent). If NONE of the
  // resolved source files exist, tailing them forever leaves the
  // operator staring at an empty terminal forever. Exit 1 with a
  // hint instead. Test pin: `test/integration/runtime-paths-coverage.
  // test.ts` § "bin/minsky logs subcommand".
  const existing = sources.filter((s) => existsSync(s.path));
  if (existing.length === 0) {
    process.stdout.write("no daemon log found at any source — try `minsky --daemon` first\n");
    process.stdout.write("\nsource paths probed:\n");
    for (const s of sources) {
      process.stdout.write(`  ${s.path}\n`);
    }
    process.exit(1);
  }
  // ALWAYS show source tags now that the default tails every source.
  // The legacy "no tags in default" shape made sense when default was
  // tick-loop-only (every line had implicit context); with the
  // sane-default flip to ALL_SOURCES, tags are load-bearing — they're
  // the only way to disambiguate interleaved streams.
  const includeSourceTag = true;
  const headerLabel =
    mode === "filter"
      ? `bin/minsky logs --source ${sources.map((s) => s.tag).join(",")}`
      : "bin/minsky logs — tailing every minsky log stream";
  const header = color(ANSI.bold + ANSI.cyan, `${headerLabel} (Ctrl-C to exit)`);
  process.stdout.write(`${header}\n${color(ANSI.dim, "─".repeat(80))}\n`);

  const children = existing.map((s) => tailFile(s, { includeSourceTag }));

  for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
    process.on(sig, () => {
      for (const c of children) c.kill("SIGTERM");
      process.exit(0);
    });
  }
}
