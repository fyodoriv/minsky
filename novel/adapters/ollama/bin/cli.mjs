#!/usr/bin/env node
// bin/cli.mjs — Node CLI wrapper around `@minsky/ollama`'s HTTP Strategy.
//
// Why: the bash skeleton at `bin/minsky-run.sh` needs to invoke
// warm/unload around the daemon's lifecycle (user-story 020). Bash
// could shell `curl` directly, but that would put the Ollama HTTP
// payload shape into business logic — a rule #2 violation. This thin
// shim keeps the wire protocol behind the TS adapter while exposing
// a stable argv-based CLI the bash runner can call.
//
// Subcommands:
//   warm <model> [base-url]     POST /api/generate {prompt:"", keep_alive:"30m"}
//   unload <model> [base-url]   POST /api/generate {keep_alive:0}
//   ps [base-url]               GET /api/ps; prints JSON
//
// Exit codes:
//   0  — request succeeded
//   1  — transport failure or HTTP non-2xx (still safe; never throws)
//   2  — bad argv
//
// `base-url` defaults to `http://localhost:11434` (Ollama's documented
// default port) when omitted.
//
// Reads MINSKY_OLLAMA_DISABLE_LIFECYCLE — if set to "1", subcommands
// `warm` and `unload` short-circuit to exit 0 without contacting
// Ollama. Iteration loops continue working; memory management reverts
// to the OLLAMA_KEEP_ALIVE env-var safety net. The escape hatch
// documented in user-stories/020-ollama-jit-warm-unload.md.
//
// @otel-exempt thin CLI; the adapter's public methods own the spans.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = dirname(fileURLToPath(import.meta.url));
// Import the built dist (preferred — fastest, matches prod consumers).
// `pnpm install` runs `tsc -b` via the prepare hook, so dist/ is
// always present in a sane operator environment. If absent (operator
// invoked the bin before the first build), the rule-#6 path is to
// crash loudly — the next layer can `pnpm install` to recover.
const httpModulePath = resolve(thisDir, "..", "dist", "http.js");
const { HttpOllama } = await import(httpModulePath);

const DEFAULT_BASE_URL = "http://localhost:11434";
const DISABLE_FLAG = process.env["MINSKY_OLLAMA_DISABLE_LIFECYCLE"] === "1";

function usage() {
  process.stderr.write(
    [
      "Usage: minsky-ollama-cli <subcommand> [args]",
      "",
      "Subcommands:",
      "  warm <model> [base-url]     Pre-load a model into VRAM (keep_alive=30m).",
      "  unload <model> [base-url]   Evict a model from VRAM (keep_alive=0).",
      "  ps [base-url]               List loaded models as JSON.",
      "",
      "Defaults: base-url = http://localhost:11434",
      "Env:      MINSKY_OLLAMA_DISABLE_LIFECYCLE=1 short-circuits warm/unload to no-op (exit 0).",
      "",
    ].join("\n"),
  );
}

const argv = process.argv.slice(2);
const subcommand = argv[0];

if (subcommand === undefined || subcommand === "-h" || subcommand === "--help") {
  usage();
  process.exit(subcommand === undefined ? 2 : 0);
}

async function runWarmOrUnload(op, model, baseUrl) {
  if (model === undefined || model === "") {
    process.stderr.write(`minsky-ollama: ${op} requires <model> argument\n`);
    process.exit(2);
  }
  if (DISABLE_FLAG) {
    process.stderr.write(`minsky-ollama: ${op} disabled by MINSKY_OLLAMA_DISABLE_LIFECYCLE=1\n`);
    process.exit(0);
  }
  const ollama = new HttpOllama({ baseUrl: baseUrl ?? DEFAULT_BASE_URL });
  const result = op === "warm" ? await ollama.warm(model) : await ollama.unload(model);
  if (result.ok) {
    process.stdout.write(`minsky-ollama: ${op} ok (model=${model})\n`);
    process.exit(0);
  }
  process.stderr.write(
    `minsky-ollama: ${op} failed (model=${model}): ${result.reason ?? "unknown"}\n`,
  );
  process.exit(1);
}

if (subcommand === "warm") {
  await runWarmOrUnload("warm", argv[1], argv[2]);
} else if (subcommand === "unload") {
  await runWarmOrUnload("unload", argv[1], argv[2]);
} else if (subcommand === "ps") {
  const baseUrl = argv[1] ?? DEFAULT_BASE_URL;
  const ollama = new HttpOllama({ baseUrl });
  const result = await ollama.ps();
  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write("\n");
  process.exit(result.ok ? 0 : 1);
} else {
  process.stderr.write(`minsky-ollama: unknown subcommand "${subcommand}"\n\n`);
  usage();
  process.exit(2);
}
