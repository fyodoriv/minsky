#!/usr/bin/env node
// M1 Metrics Dashboard — runs all runnable measurement commands from
// TASKS.md and produces a single-page status report.
//
// Usage: node scripts/m1-metrics-dashboard.mjs [--json]
//
// For each M1 task with a **Measurement** field containing a runnable
// command, executes the command and reports pass/fail/error.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const jsonMode = process.argv.includes("--json");

const content = readFileSync(join(ROOT, "TASKS.md"), "utf8");

// Extract M1 tasks with runnable measurements
/** @type {{ id: string; commands: string[]; raw: string }[]} */
const tasks = [];
const taskRegex = /- \[ \] `([^`]+)`(.*?)(?=\n- \[ \] |\n## |\Z)/gs;
/** @type {RegExpExecArray | null} */
let match;
// biome-ignore lint/suspicious/noAssignInExpressions: standard JS regex iteration idiom
while ((match = taskRegex.exec(content)) !== null) {
  const taskId = match[1] ?? "";
  const block = match[2] ?? "";
  if (block.includes("**Milestone**: M1") || !block.includes("**Milestone**")) {
    const mMatch = block.match(/\*\*Measurement\*\*:\s*(.+?)(?=\n\s*-\s*\*\*|\n\s*$)/s);
    if (!mMatch) continue;
    const mText = (mMatch[1] ?? "").trim();
    // Extract backtick-fenced commands
    /** @type {string[]} */
    const cmds = [];
    const cmdRegex = /`([^`]+)`/g;
    /** @type {RegExpExecArray | null} */
    let cm;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard JS regex iteration idiom
    while ((cm = cmdRegex.exec(mText)) !== null) {
      const cmd = (cm[1] ?? "").trim();
      // Only include if it looks like a shell command
      if (
        cmd.startsWith("node ") ||
        cmd.startsWith("grep ") ||
        cmd.startsWith("pnpm ") ||
        cmd.startsWith("cat ") ||
        cmd.startsWith("git ") ||
        cmd.startsWith("gh ") ||
        cmd.startsWith("test ") ||
        cmd.startsWith("ls ") ||
        cmd.startsWith("wc ")
      ) {
        cmds.push(cmd);
      }
    }
    if (cmds.length === 0) continue;
    tasks.push({ id: taskId, commands: cmds, raw: mText.slice(0, 200) });
  }
}

// Execute each measurement (with timeout + error handling)
/** @type {{ id: string; status: string; command: string; output: string }[]} */
const results = [];
for (const task of tasks) {
  const cmd = task.commands[0] ?? ""; // Run the first command only
  let status = "unknown";
  let output = "";
  try {
    output = execSync(cmd, {
      encoding: "utf8",
      timeout: 15_000,
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    status = "pass";
  } catch (err) {
    const e =
      /** @type {{ killed?: boolean; stderr?: string | Buffer; stdout?: string | Buffer; message?: string }} */ (
        err
      );
    status = e.killed ? "timeout" : "fail";
    output = (e.stderr || e.stdout || e.message || "").toString().trim().slice(0, 200);
  }
  results.push({ id: task.id, status, command: cmd.slice(0, 120), output: output.slice(0, 100) });
}

// Summary
const passed = results.filter((r) => r.status === "pass").length;
const failed = results.filter((r) => r.status === "fail").length;
const timedOut = results.filter((r) => r.status === "timeout").length;
const total = results.length;

if (jsonMode) {
  console.log(JSON.stringify({ total, passed, failed, timedOut, results }, null, 2));
} else {
  console.log("\n📊 M1 Metrics Dashboard\n");
  console.log(`   Total measurable tasks: ${total}`);
  console.log(`   ✅ Pass: ${passed}  ❌ Fail: ${failed}  ⏱ Timeout: ${timedOut}\n`);

  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏱";
    console.log(`   ${icon} ${r.id}`);
    if (r.status !== "pass") {
      console.log(`      cmd: ${r.command}`);
      console.log(`      out: ${r.output.slice(0, 80)}`);
    }
  }
  console.log();
}
