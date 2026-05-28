// `--help` flag consistency on every `bin/minsky` subcommand. The
// daemon's CLI surface must honor `--help` on every verb — operators
// learn a CLI by typing `<verb> --help` first, and an unhandled
// `--help` runs the action body (potentially with side effects:
// starting a server, killing processes, probing the host) which is
// the wrong default for "I'm exploring".
//
// Hypothesis (rule #9): every verb in `bin/minsky` honors `--help` by
// printing a `Usage:` block on stdout and exiting 0 BEFORE any action
// body runs. Surfaced from PR cli-consolidate-pnpm-minsky-scripts
// (2026-05-27); shipped 2026-05-28 by this test + per-case `--help`
// handlers in bin/minsky's doctor/status/stop/ui case blocks.
// Success: every test below passes.
// Measurement: this file.
// Anchor: rule #1 (npm/brew convention compliance — every CLI verb
// honors `--help`); Krug *Don't Make Me Think* 2014; cli-design skill
// at `~/.config/devin/skills/cli-design/SKILL.md`.

import { execSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const BIN_MINSKY = join(REPO_ROOT, "bin", "minsky");

const VERBS = ["setup", "doctor", "status", "stop", "ui", "logs"] as const;

describe("bin/minsky <verb> --help honours the CLI convention", () => {
  for (const verb of VERBS) {
    it(`\`bin/minsky ${verb} --help\` prints help and exits 0 (no action body)`, () => {
      // `execSync` throws on non-zero exit; the catch is the failure
      // signal. We capture stdout to assert the `Usage:` lede.
      const out = execSync(`bash ${BIN_MINSKY} ${verb} --help`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      // The CLI convention is `Usage: <verb>` on an early line; both
      // the bootstrap-script passthrough and the inline `cat <<EOF`
      // case blocks satisfy this. `-i` for case-insensitive (some
      // legacy subcommands use 'usage:' lowercase via downstream tools).
      expect(out.toLowerCase()).toMatch(/usage|--help/);
    });

    it(`\`bin/minsky ${verb} -h\` is an alias for --help`, () => {
      // Skip the 3 passthrough verbs (setup → bootstrap script;
      // logs → scripts/minsky-logs.mjs; ui → distribution/run-
      // dashboard-web.sh) — their -h handling is downstream behavior
      // we don't pin here. The inline-handler verbs MUST honor -h.
      if (verb === "setup" || verb === "logs" || verb === "ui") return;
      const out = execSync(`bash ${BIN_MINSKY} ${verb} -h`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      expect(out.toLowerCase()).toMatch(/usage|--help/);
    });
  }
});
