#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved minsky CLI ergonomics (operator 2026-05-06) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 3 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-arch-detection slice 6 (operator 2026-05-08 — "rosetta/intel must be resolved as well") -->
// <!-- scope: human-approved minsky-cli-arch-detection-hardening slice 7 (operator 2026-05-08 — H0 pipx path probe + H1 aider python + H2 non-TTY refuse) -->
// <!-- scope: human-approved minsky-cli-fresh-clone-bootstrap slice 8 (operator 2026-05-08 — "I've cloned minsky from scratch, ran pnpm install, then ran minsky and got module not found about tick-loop") -->
// <!-- scope: human-approved minsky-fresh-clone-health-checks slice 1 (operator 2026-05-08 — "Next let's add as much stable self-healing as reasonable to minsky & install commands") -->
// <!-- scope: human-approved minsky-runtime-resilience slice 2 (operator 2026-05-08 — slice 2 of the self-healing trilogy) -->
// <!-- scope: human-approved minsky-cross-machine-dotfile-checks slice 3 (operator 2026-05-08 — slice 3 of the self-healing trilogy) -->
// <!-- scope: human-approved minsky-claude-exhaustion-persisted-state slice 4 (operator 2026-05-08 — "I ran minsky and it happily started claude even though it's out of tokens") -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 9 (operator 2026-05-08 — `--dry-run` flag wires existing `confirmAlwaysNo` + read-only plan render) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 23 (operator 2026-05-10 — round-trip elimination: parallelize `runDoctor`'s independent probes) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 24 (operator 2026-05-10 — skip-earlier gate: honor `MINSKY_LLM_PROVIDER=claude-only` in the bootstrap pre-flight, mirroring slice 5's local-preferred fix) -->

/**
 * `minsky` CLI — operator-facing wrapper around `bin/tick-loop.mjs`.
 *
 * Sane defaults + attach detection + local-LLM auto-bootstrap (P0 from
 * operator 2026-05-08, "git pull && minsky" UX):
 *
 *   minsky                    start-or-attach worker 0; auto-bootstrap if Claude is exhausted
 *   minsky 1                  start-or-attach worker 1
 *   minsky logs               tail worker 0's log (never spawns)
 *   minsky logs 1             tail worker 1's log
 *   minsky stop               stop worker 0 (SIGTERM the daemon, leave the log)
 *   minsky stop 1             stop worker 1
 *   minsky doctor             read-only state check (claude / local-LLM stack); prints + exits
 *   minsky bootstrap-local-llm  explicitly run the local-LLM install plan (force the prompt)
 *   minsky bootstrap-local-llm --dry-run  print the install plan and exit 0 (read-only; non-TTY safe)
 *
 * Behaviour of `minsky [<id>]` (no subcommand or just an ID):
 *   1. If `.minsky/workers/<id>.pid` exists AND the PID is live → ATTACH:
 *      open the log file with `tail -F` (pretty output), don't spawn anything.
 *   2. Otherwise (cold start) → run the local-LLM auto-bootstrap pre-flight:
 *      - probe `mlx_lm.server` reachability (~2s)
 *      - if reachable → set `MINSKY_LOCAL_LLM=1` for the spawn and skip
 *      - if unreachable AND Claude is also unhealthy → run
 *        `detectLocalLlmStack` + `planLocalLlmBootstrap`; if the plan
 *        is non-empty, prompt the operator with one `[Y/n]` confirm,
 *        then install + start the local server
 *      - then SPAWN: fork bin/tick-loop.mjs with sane defaults
 *
 * Operator escape hatches:
 *   - `MINSKY_NO_AUTO_BOOTSTRAP=1` skips the pre-flight entirely
 *   - `MINSKY_NON_INTERACTIVE=1` (or non-TTY stdin/stdout) auto-confirms
 *
 * Detach: Ctrl+C exits the tail only; the daemon keeps running.
 * Reattach: re-run `minsky` (or `minsky logs`) — it sees the live PID
 * and attaches without respawning.
 */

import { exec, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const TICK_LOOP_BIN = resolve(PKG_ROOT, "bin", "tick-loop.mjs");

const MINSKY_HOME = process.env["MINSKY_HOME"] ?? resolve(PKG_ROOT, "..", "..");
const WORKERS_DIR = resolve(MINSKY_HOME, ".minsky", "workers");

// Slice 8 (`minsky-cli-fresh-clone-bootstrap`): pre-flight check that
// the dist build artifacts exist BEFORE we dynamic-import them.
// Replaces node's `ERR_MODULE_NOT_FOUND` stack trace with a single
// actionable line on a fresh clone where `pnpm install`'s prepare
// hook hasn't run yet (or failed). Static `import` declarations are
// hoisted to module-instantiation time, so a static import of
// `../dist/index.js` would fire before any code in this file runs;
// dynamic `await import()` defers the resolution until after the
// existsSync check. The pure helpers used to format the message live
// in `dist-existence-check.ts` (compiled to `dist/dist-existence-check.js`)
// — but we deliberately inline a tiny version here so the check
// itself doesn't depend on dist/ existing. The paired tests in
// `dist-existence-check.test.ts` pin the wording contract.
const DIST_INDEX_PATH = resolve(PKG_ROOT, "dist", "index.js");
if (!existsSync(DIST_INDEX_PATH)) {
  process.stderr.write(
    `minsky: dist not built (${DIST_INDEX_PATH} missing) — run \`pnpm install\` from the repo root, or \`pnpm --filter @minsky/tick-loop build\` directly\n`,
  );
  process.exit(1);
}

// Slice 1 of `minsky-fresh-clone-health-checks` — same defensive
// pattern as the dist-existence check above. The dist file might
// exist (operator ran `pnpm --filter ... build` once before deleting
// node_modules) but its transitive imports (`@types/node`, `vitest`,
// etc.) resolve at module-load time and produce cryptic
// `ERR_MODULE_NOT_FOUND` stack traces pointing at node-internals.
// Inline the check (so we don't depend on node_modules to detect that
// node_modules is missing) and emit a one-line operator-actionable
// stderr message before the failing import is reached.
const NODE_MODULES_PATH = resolve(MINSKY_HOME, "node_modules");
if (!existsSync(NODE_MODULES_PATH)) {
  process.stderr.write(
    `minsky: node_modules/ missing (${NODE_MODULES_PATH}) — run \`pnpm install\` from the repo root\n`,
  );
  process.exit(1);
}

const {
  PATH_CONFIG_KEYS,
  buildProductionProbes,
  checkGitConfigPaths,
  classifyClaudeProbeOutput,
  confirmAlwaysYes,
  describeArchState,
  detectArchState,
  detectLocalLlmStack,
  ensureWorkersDir,
  executeBootstrapPlan,
  formatTickLoopBinMissingMessage,
  formatWorkersDirRecoveryMessage,
  needsLocalLlmBootstrap,
  parseBootstrapLocalLlmArgs,
  pickLogPath,
  planLocalLlmBootstrap,
  planRequiresTty,
  preferredPipxPath,
  probePythonWithDefaults,
  readLastHardLimit,
  renderConfirmSummary,
  renderDoctorSubstrateRows,
} = await import("../dist/index.js");
const { formatLogLine } = await import("../dist/pretty-log.js");

const argv = process.argv.slice(2);
const first = argv[0];

if (first === "--help" || first === "-h" || first === "help") {
  printHelp();
  process.exit(0);
} else if (first === "logs") {
  await runLogs(argv.slice(1));
} else if (first === "stop") {
  runStop(argv.slice(1));
} else if (first === "doctor") {
  await runDoctor();
} else if (first === "bootstrap-local-llm") {
  // Slice 9: `--dry-run` short-circuits before any install attempt.
  // Pure detect + plan → render summary → exit 0. Read-only; safe in
  // non-TTY contexts where slice 7 H2's TTY-refuse path would otherwise
  // block. Anchors the task block's Risk mitigation.
  const subArgs = parseBootstrapLocalLlmArgs(argv.slice(1));
  if (subArgs.dryRun) {
    await runBootstrapLocalLlmDryRun();
    process.exit(0);
  }
  const result = await runBootstrapLocalLlm({ force: true });
  // Slice 7 H2: when the operator explicitly ran `bootstrap-local-llm`
  // AND the pre-flight refused (e.g., non-TTY + install-arm-homebrew
  // needed), exit non-zero so `minsky bootstrap-local-llm && next-cmd`
  // chaining works. The empty-object return is the refuse signal; a
  // successful bootstrap returns the env overlay with MINSKY_LOCAL_LLM.
  if (Object.keys(result).length === 0) {
    process.exit(1);
  }
} else if (first === "start") {
  // Back-compat: keep `start` as an alias of the no-subcommand form. Any
  // further args are forwarded to bin/tick-loop.mjs at spawn time.
  await runStartOrAttach(argv.slice(1));
} else {
  await runStartOrAttach(argv);
}

function printHelp() {
  process.stdout.write("minsky — operator CLI for the tick-loop daemon\n");
  process.stdout.write(`
Usage:
  minsky [<worker-id>]      start-or-attach worker <id> (default 0); Ctrl+C detaches
  minsky logs [<worker-id>] reattach to worker <id>'s log (never spawns)
  minsky stop [<worker-id>] stop worker <id> (SIGTERM the daemon)

Examples:
  minsky                          # start-or-attach worker 0
  minsky 1                        # start-or-attach worker 1 (in another terminal)
  minsky logs                     # follow worker 0's log live
  minsky stop 1                   # stop worker 1
  minsky bootstrap-local-llm --dry-run  # preview the local-LLM install plan and exit (read-only)

Sane defaults (override by passing the corresponding tick-loop flag):
  --worker-id        <positional, default 0>
  --workers-total    max(workerId+1, 1)
  --tick-interval-ms 300000 (5 min)
  --paused-sentinel  /tmp/minsky-worker-<id>-never-paused (never pauses)

Logs:    ${WORKERS_DIR}/<worker-id>.log
PID:     ${WORKERS_DIR}/<worker-id>.pid
Detach:  Ctrl+C on \`minsky\` exits the tail; the daemon keeps running.
Reattach: re-run \`minsky\` (or \`minsky logs\`) — it sees the live PID and attaches.

Operator escape hatches (env vars):
  MINSKY_LLM_PROVIDER=local-preferred   force local-LLM (skip claude probe)
  MINSKY_LLM_PROVIDER=claude-only       force claude (skip local-LLM probe)
  MINSKY_LOCAL_LLM=1                    opt in to local-LLM fallback wrapper
  MINSKY_HARD_LIMIT_TTL_MIN=<minutes>   how long to trust persisted hard-limit (default 60)
  MINSKY_NO_AUTO_BOOTSTRAP=1            skip the local-LLM auto-bootstrap pre-flight
  MINSKY_NON_INTERACTIVE=1              auto-confirm the bootstrap install plan
`);
}

/**
 * @param {readonly string[]} args
 */
async function runStartOrAttach(args) {
  const { workerId, extraArgs } = parsePositionalAndForward(args);

  // Slice 2 of `minsky-runtime-resilience` — pre-flight: tick-loop
  // bin must exist or `spawn(node, [TICK_LOOP_BIN, ...])` would emit
  // ENOENT with a stack that doesn't point at the missing path.
  // Defensive backstop on top of slice 8's dist-existence check.
  if (!existsSync(TICK_LOOP_BIN)) {
    process.stderr.write(`${formatTickLoopBinMissingMessage(TICK_LOOP_BIN)}\n`);
    process.exit(1);
  }

  // Slice 2 of `minsky-runtime-resilience` — workers-dir mkdir with
  // classified errno + recovery hint instead of a raw EACCES throw.
  const mkdirOutcome = ensureWorkersDir({
    dir: WORKERS_DIR,
    mkdirSyncFn: mkdirSync,
  });
  if (mkdirOutcome.ok === false) {
    process.stderr.write(
      `${formatWorkersDirRecoveryMessage({ dir: WORKERS_DIR, errCode: mkdirOutcome.errCode, recoveryHint: mkdirOutcome.recoveryHint })}\n`,
    );
    process.exit(1);
  }

  const logPath = resolve(WORKERS_DIR, `${workerId}.log`);
  const pidPath = resolve(WORKERS_DIR, `${workerId}.pid`);
  const livePid = readLivePid(pidPath);
  if (livePid !== undefined) {
    process.stderr.write(
      `minsky: worker ${workerId} already running (PID ${livePid}) — attaching to ${logPath}\n`,
    );
    process.stderr.write("minsky: Ctrl+C detaches (daemon keeps running)\n\n");
    await tailWithPretty(logPath, true);
    return;
  }
  // Cold start — run the local-LLM auto-bootstrap pre-flight. Idempotent:
  // a fully-set-up machine adds <500ms and sets MINSKY_LOCAL_LLM=1 if the
  // server is reachable; an unset machine prompts the operator with one
  // confirm and runs the install plan.
  const bootstrapEnv = await maybeBootstrapLocalLlm();
  const tickLoopArgs = withSaneDefaults(workerId, extraArgs);

  // Slice 2 of `minsky-runtime-resilience` — log-path fallback: if
  // the primary log path is unwritable (EACCES / EROFS / ENOSPC),
  // fall through to a /tmp path + warn instead of crashing. When
  // log falls back, ALSO fall back the pid path to the same /tmp
  // dir — they live or die together; if `.minsky/workers/` is
  // read-only, neither should target it. (Operator's `minsky stop
  // <id>` won't find the pid file in that case — known limitation,
  // covered in slice 3's cross-machine-dotfile work.)
  const fallbackLogTmp = resolve(`/tmp/minsky-worker-${workerId}-${process.pid}.log`);
  const logOutcome = pickLogPath({
    primary: logPath,
    fallbackTmp: fallbackLogTmp,
    openSyncFn: openSync,
  });
  if (logOutcome.fellBack) {
    process.stderr.write(
      `minsky: warning: ${logPath} is not writable (${logOutcome.reason ?? "unknown"}); falling back to ${logOutcome.path}\n`,
    );
    process.stderr.write(
      "minsky: warning: pid file falls back to the same /tmp dir; `minsky stop` may not find the daemon — set MINSKY_HOME to a writable path to recover\n",
    );
  }
  const activeLogPath = logOutcome.path;
  const activePidPath = logOutcome.fellBack
    ? resolve(`/tmp/minsky-worker-${workerId}-${process.pid}.pid`)
    : pidPath;

  const child = spawn(process.execPath, [TICK_LOOP_BIN, ...tickLoopArgs], {
    detached: true,
    stdio: ["ignore", logOutcome.fd, logOutcome.fd],
    env: { ...process.env, ...bootstrapEnv },
  });
  child.unref();
  writeFileSync(activePidPath, String(child.pid ?? ""), "utf8");
  process.stderr.write(
    `minsky: started worker ${workerId} (PID ${child.pid}, log: ${activeLogPath})\n`,
  );
  process.stderr.write("minsky: Ctrl+C detaches (daemon keeps running)\n\n");
  await tailWithPretty(activeLogPath, true);
}

// ---- Local-LLM auto-bootstrap pre-flight ---------------------------------

/**
 * Probe the local-LLM stack and run the install plan if needed. Idempotent
 * fast path: an already-running mlx-lm.server is detected with one fetch
 * call and we just return `MINSKY_LOCAL_LLM=1` so the spawned daemon picks
 * up the local fallback path.
 *
 * Operator escape hatches: `MINSKY_NO_AUTO_BOOTSTRAP=1` skips the pre-flight
 * entirely; `MINSKY_NON_INTERACTIVE=1` (or non-TTY stdin) auto-confirms.
 *
 * Returns an env-overlay object the spawn merges with `process.env`. Empty
 * object means "no overlay needed" (caller passes the daemon's existing env).
 *
 * @returns {Promise<Record<string, string>>}
 */
async function maybeBootstrapLocalLlm() {
  if (process.env["MINSKY_NO_AUTO_BOOTSTRAP"] === "1") {
    return {};
  }
  // Already opted in via env? Don't re-run the bootstrap.
  if (process.env["MINSKY_LOCAL_LLM"] === "1") {
    return {};
  }

  // Slice 24 — `MINSKY_LLM_PROVIDER=claude-only` is the operator's
  // explicit "skip local-LLM probe" signal. The --help text advertises
  // this behavior but slice 5 only closed the gap for `local-preferred`;
  // `claude-only` was still falling through to the persisted-hard-limit
  // read + detectLocalLlmStack (~250 ms-5 s with server timeout) +
  // probeClaude (~5-20 s). Per the optimization-discipline gate this is
  // a skip-earlier gate: no I/O, no probes, just inherit the env to the
  // spawned daemon where `llm-provider-selector` honors it via
  // `forceClaude`.
  if (process.env["MINSKY_LLM_PROVIDER"] === "claude-only") {
    return {};
  }

  // Slice 5 of self-healing — `MINSKY_LLM_PROVIDER=local-preferred`
  // is the operator's "I know I'm exhausted, just install + use
  // local NOW" shortcut. The slice-4 --help text claimed this env
  // var "skips claude probe" but the original (slice 6 of
  // minsky-cli-arch-detection) only consumed it inside the spawned
  // tick-loop daemon — `minsky` itself ignored it. This slice
  // closes the gap: when set, skip the live probe AND trigger the
  // bootstrap pipeline directly, matching the documented behavior.
  if (process.env["MINSKY_LLM_PROVIDER"] === "local-preferred") {
    process.stderr.write(
      "minsky: MINSKY_LLM_PROVIDER=local-preferred — skipping live probe and bootstrapping local-LLM\n",
    );
    return await runBootstrapLocalLlm({ force: false });
  }

  // Slice 4 of `minsky-claude-exhaustion-persisted-state` — consult
  // the persisted hard-limit field BEFORE the live probe. The live
  // probe is a 1-token query and can false-positive `healthy` when
  // a real iteration would hit Anthropic's quota; the persisted
  // state is the daemon's previous-iteration ground truth and is
  // strictly more reliable when fresh. Within TTL → skip live probe
  // and go straight to bootstrap. Default TTL: 60 minutes; override
  // via `MINSKY_HARD_LIMIT_TTL_MIN`.
  const persisted = readPersistedHardLimit();
  if (persisted.exhausted) {
    const ageMin = Math.round(persisted.ageMs / 60_000);
    process.stderr.write(
      `minsky: persisted hard-limit hit at ${persisted.ts} (${ageMin}m ago, reason: ${persisted.reason}); skipping live probe and bootstrapping local-LLM\n`,
    );
    return await runBootstrapLocalLlm({ force: false });
  }

  const probes = buildProductionProbes({ whichFn });
  const state = await detectLocalLlmStack(probes);
  // Fast path: server is reachable → set MINSKY_LOCAL_LLM=1 for the spawn,
  // skip the install pipeline entirely.
  if (state.server.reachable) {
    process.stderr.write(
      `minsky: local-LLM server reachable at ${state.server.url} — wiring fallback\n`,
    );
    return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
  }
  // Server unreachable. Run a REAL synthetic claude probe (slice 4 —
  // operator pushback 2026-05-08: "So that all will work even if no
  // message can be sent to claude right?"). The previous slice's
  // `which claude` check returned `true` whenever the binary existed,
  // falsely deferring to claude when credits were exhausted. This probe
  // spawns `claude --print "ping"` with a 10 s timeout and classifies
  // the stderr against `HARD_LIMIT_PATTERNS` (shared contract with
  // `llm-provider-selector`).
  const decision = await probeClaude();
  process.stderr.write(`minsky: claude probe → ${decision.verdict} (${decision.reason})\n`);
  if (!needsLocalLlmBootstrap(decision)) {
    // Claude is healthy OR transient error. Don't trigger a 17 GB
    // download on a network blip — the daemon's per-iteration
    // `decideProvider` will catch any hard-limit signal on the next
    // claude spawn and switch to local then (graceful-degrade).
    return {};
  }
  process.stderr.write(
    `minsky: claude unavailable (${decision.verdict}) AND local-LLM server not reachable\n`,
  );
  return await runBootstrapLocalLlm({ force: false });
}

/**
 * Slice 4 of `minsky-claude-exhaustion-persisted-state`. Wraps
 * {@link readLastHardLimit} with the production seam (file-backed
 * `readFileSync` + `existsSync`) and the env-controlled TTL.
 *
 * Default TTL: 60 minutes. Override via `MINSKY_HARD_LIMIT_TTL_MIN`
 * (positive integer minutes; non-numeric values fall back to default).
 *
 * @returns {import("../dist/claude-exhaustion-state.js").ReadHardLimitOutcome}
 */
function readPersistedHardLimit() {
  const raw = process.env["MINSKY_HARD_LIMIT_TTL_MIN"];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  const ttlMin = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
  return readLastHardLimit({
    stateFilePath: resolve(MINSKY_HOME, ".minsky", "state.json"),
    readFileSyncFn: readFileSync,
    existsSyncFn: existsSync,
    nowFn: Date.now,
    ttlMs: ttlMin * 60_000,
  });
}

/**
 * Idempotent bootstrap entry point. Runs detect + plan + execute. When
 * `force === true` (operator ran `minsky bootstrap-local-llm` explicitly),
 * the prompt always shows even if the plan is empty; otherwise we skip the
 * prompt for empty plans.
 *
 * @param {{ force: boolean }} opts
 * @returns {Promise<Record<string, string>>}
 */
/**
 * Build the planner + probe options together so `runBootstrapLocalLlm`
 * and `runDoctor` can share the wiring. Slice 7 H0 threads archState's
 * `preferredPipxPath` into the pipx probe so Intel-brew pipx doesn't
 * mask the need for a fresh arm-brew pipx install.
 *
 * @returns {Promise<{ state: import("../dist/local-llm-bootstrap.js").LocalLlmStackState, archState: import("../dist/arch-probe.js").ArchState, planOpts: import("../dist/local-llm-bootstrap.js").BootstrapPlanOptions, pythonPath: string | undefined }>}
 */
async function detectForBootstrap() {
  const archState = await detectArchState(buildArchProbes());
  const expectedPipxPath = preferredPipxPath(archState);
  /** @type {Parameters<typeof buildProductionProbes>[0]} */
  const probeOpts = { whichFn };
  if (expectedPipxPath !== undefined) probeOpts.expectedPipxPath = expectedPipxPath;
  const state = await detectLocalLlmStack(buildProductionProbes(probeOpts));
  const pythonPath = probePythonWithDefaults();
  /** @type {import("../dist/local-llm-bootstrap.js").BootstrapPlanOptions} */
  const planOpts = { archState };
  if (pythonPath !== undefined) planOpts.pythonPath = pythonPath;
  return { state, archState, planOpts, pythonPath };
}

/**
 * Slice 7 H2: emit the non-TTY refusal message with the manual install
 * one-liner. Factored out so the caller's cognitive complexity stays
 * under biome's cap.
 */
function emitNonTtyRefuseMessage() {
  process.stderr.write(
    "minsky: install-arm-homebrew step needs a TTY for sudo, but stdin is not a TTY\n",
  );
  process.stderr.write(
    "minsky: rerun `minsky bootstrap-local-llm` from an interactive terminal, OR\n",
  );
  process.stderr.write(
    "minsky: install native ARM Homebrew manually by running this one-liner in Terminal:\n",
  );
  process.stderr.write(
    '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n',
  );
  process.stderr.write("minsky: then rerun `minsky bootstrap-local-llm`\n");
}

/**
 * Slice 9: read-only "preview" path for `minsky bootstrap-local-llm
 * --dry-run`. Runs the same detect + plan as `runBootstrapLocalLlm`,
 * prints the operator-facing confirm summary to stdout, and returns.
 * Exits the caller path with code 0 — never spawns an installer, never
 * needs a TTY, never writes any state.
 *
 * Anchors the task block's Risk mitigation (operator 2026-05-08 —
 * "`--dry-run` flag prints the plan without executing"). Composes with
 * `minsky doctor` (which mixes substrate + git rows in alongside the
 * plan); this path is the focused plan-only preview.
 */
async function runBootstrapLocalLlmDryRun() {
  const { state, planOpts } = await detectForBootstrap();
  const plan = planLocalLlmBootstrap(state, planOpts);
  process.stdout.write(`${renderConfirmSummary(plan)}\n`);
  process.stdout.write("(dry-run — no install attempted; rerun without --dry-run to install)\n");
}

async function runBootstrapLocalLlm({ force }) {
  const { state, planOpts } = await detectForBootstrap();
  const plan = planLocalLlmBootstrap(state, planOpts);
  if (plan.ready && !force) {
    process.stderr.write("minsky: local-LLM stack already ready — skipping bootstrap\n");
    return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
  }
  const isInteractive =
    process.stdin.isTTY === true && process.env["MINSKY_NON_INTERACTIVE"] !== "1";
  // Slice 7 H2: if the plan requires a TTY (install-arm-homebrew's
  // sudo needs stdin inheritance) AND we're non-TTY, refuse with
  // clear recovery instructions instead of hanging silently at sudo.
  if (planRequiresTty(plan) && !isInteractive) {
    emitNonTtyRefuseMessage();
    return {};
  }
  const confirmFn = isInteractive ? confirmInteractive : confirmAlwaysYes;
  const result = await executeBootstrapPlan(plan, {
    confirm: confirmFn,
    spawnFn: spawnAdapter,
    log: (s) => process.stderr.write(s),
  });
  if (!result.success) {
    process.stderr.write(
      `minsky: local-LLM bootstrap failed (${result.failedStep ?? "unknown"}: ${result.reason ?? "no reason"})\n`,
    );
    process.stderr.write(
      "minsky: continuing without local-LLM fallback; daemon will use claude only\n",
    );
    return {};
  }
  return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
}

/**
 * Read-only doctor — prints the current state of the local-LLM stack +
 * Claude health and exits.
 */
/**
 * Emit the 8 doctor status rows. Extracted so `runDoctor` stays under
 * biome's cognitive-complexity cap.
 *
 * @param {{ state: import("../dist/local-llm-bootstrap.js").LocalLlmStackState, archState: import("../dist/arch-probe.js").ArchState, claudeDecision: import("../dist/claude-health-probe.js").ClaudeHealthDecision, pythonPath: string | undefined }} args
 */
function emitDoctorRows({ state, archState, claudeDecision, pythonPath }) {
  /** @param {string} label @param {boolean} ok @param {string} [detail] */
  const line = (label, ok, detail) => {
    const mark = ok ? "✓" : "✗";
    const detailStr = detail !== undefined && detail.length > 0 ? `  ${detail}` : "";
    process.stdout.write(`  ${mark} ${label}${detailStr}\n`);
  };
  line("claude CLI", claudeDecision.verdict === "healthy", claudeDecision.reason);
  line("pipx", state.pipx.present, state.pipx.path ?? state.pipx.reason ?? "");
  line("mlx_lm.server", state.mlxLm.present, state.mlxLm.path ?? state.mlxLm.reason ?? "");
  line("aider", state.aider.present, state.aider.path ?? state.aider.reason ?? "");
  line("model weights", state.model.present, state.model.detail ?? state.model.reason ?? "");
  line(
    "mlx-lm.server reachable",
    state.server.reachable,
    state.server.reachable ? state.server.url : (state.server.reason ?? ""),
  );
  line(
    "python 3.12/3.13 for aider",
    pythonPath !== undefined,
    pythonPath ?? "no 3.12/3.13 found — will use pipx default (may fail on 3.14+)",
  );
  // Row is GREEN when planner won't need arm-homebrew install.
  // Rosetta-with-brew still GREEN — absolute paths sidestep the mismatch.
  line("arch", !archState.needsNativeBrew, describeArchState(archState));
}

async function runDoctor() {
  process.stdout.write("minsky doctor — local-LLM stack health probe\n\n");
  // Slice 23: the three startup probes — local-LLM stack detect, claude
  // health, install-time substrate — share no inputs and no side
  // effects, so the previous sequential await chain stalled the cheap
  // probes (~250 ms detect + ~5 ms substrate) behind the slow one
  // (probeClaude can take 5–20 s on first-token latency). Promise.all
  // collapses them onto the long-pole's wall-clock. Round-trip
  // elimination per the optimization-discipline gate.
  const [detectResult, claudeDecision, substrateState] = await Promise.all([
    detectForBootstrap(),
    probeClaude(),
    probeSubstrate(),
  ]);
  const { state, archState, planOpts, pythonPath } = detectResult;
  emitDoctorRows({ state, archState, claudeDecision, pythonPath });
  const substrateLines = renderDoctorSubstrateRows(substrateState);
  for (const l of substrateLines) {
    process.stdout.write(`${l}\n`);
  }
  const anySubstrateRed = substrateLines.some((l) => l.startsWith("  ✗"));
  // Slice 3 of `minsky-cross-machine-dotfile-checks`: detect git
  // config keys that point at filesystem paths synced via dotfiles
  // across machines with different usernames. Detect-only (per the
  // operator's chosen aggressiveness — git config is outside
  // `.minsky/`); broken paths surface as YELLOW (don't block daemon).
  await emitGitConfigSanityRows();
  // Slice 4 of `minsky-claude-exhaustion-persisted-state`: surface
  // the persisted hard-limit timestamp (if any) so the operator can
  // see at a glance why minsky might be on local-LLM mode.
  emitClaudeExhaustionRow();
  process.stdout.write("\n");
  if (anySubstrateRed) {
    process.stdout.write("Substrate: RED — install-time prerequisites missing\n");
    process.stdout.write("Local-LLM stack check skipped — fix substrate first.\n");
    process.exitCode = 1;
    return;
  }
  const plan = planLocalLlmBootstrap(state, planOpts);
  if (plan.ready) {
    process.stdout.write("Local-LLM stack: GREEN — ready\n");
    return;
  }
  process.stdout.write("Local-LLM stack: YELLOW — install plan available\n");
  process.stdout.write(`${renderConfirmSummary(plan)}\n`);
  process.stdout.write("\nRun `minsky bootstrap-local-llm` to install.\n");
}

/**
 * Slice 3 of `minsky-cross-machine-dotfile-checks` — emit one row
 * per checked git config key. Renders `  ✓ <key>` when unset OR set
 * to a valid path; `  ⚠ <key>  — <value> does not exist; recover
 * with \`<recovery>\`` when set + path missing.
 *
 * Output is YELLOW (warning), not RED — broken git config doesn't
 * immediately stop the daemon; it's a footgun the operator should
 * know about.
 */
async function emitGitConfigSanityRows() {
  const outcome = checkGitConfigPaths({
    keysToCheck: PATH_CONFIG_KEYS,
    getGitConfigFn: getGitConfigShowOrigin,
    existsSyncFn: existsSyncWithTildeExpansion,
  });
  // Map broken paths back to keys for fast lookup.
  const brokenByKey = new Map(outcome.brokenPaths.map((b) => [b.configKey, b]));
  for (const key of PATH_CONFIG_KEYS) {
    const broken = brokenByKey.get(key);
    if (broken === undefined) {
      process.stdout.write(`  ✓ git config ${key}\n`);
    } else {
      process.stdout.write(
        `  ⚠ git config ${key}  — ${broken.configValue} (${broken.origin}) does not exist; recover with \`${broken.recoveryCommand}\`\n`,
      );
    }
  }
}

/**
 * Slice 4 of `minsky-claude-exhaustion-persisted-state` — emit a
 * single doctor row for the persisted hard-limit field. Renders
 * `  ✓ claude exhaustion (persisted)` when unset OR stale; `  ⚠ ...
 * (recent)` with timestamp + age when within TTL.
 */
function emitClaudeExhaustionRow() {
  const persisted = readPersistedHardLimit();
  if (!persisted.exhausted) {
    process.stdout.write("  ✓ claude exhaustion (persisted)\n");
    return;
  }
  const ageMin = Math.round(persisted.ageMs / 60_000);
  process.stdout.write(
    `  ⚠ claude exhaustion (persisted)  — hit at ${persisted.ts} (${ageMin}m ago, reason: ${persisted.reason}); minsky will skip live probe and use local-LLM until TTL expires (override: MINSKY_HARD_LIMIT_TTL_MIN=<n>)\n`,
  );
}

/**
 * Production wiring of {@link checkGitConfigPaths}'s `getGitConfigFn`
 * seam. Shells out to `git config --show-origin --get <key>` and
 * parses the origin prefix:
 *
 *   - `file:/etc/gitconfig`        → system
 *   - `file:/Users/.../.gitconfig` → global (when path matches $HOME)
 *   - `file:.git/config`           → local (when path is repo-relative)
 *   - command line / blob / unknown → unknown
 *
 * Returns `undefined` when the key is unset (`git config --get`
 * exits 1 with empty stdout — no quirks).
 *
 * @param {string} key
 * @returns {import("../dist/git-config-path-checks.js").GitConfigValue | undefined}
 */
function getGitConfigShowOrigin(key) {
  const result = spawnSync("git", ["config", "--show-origin", "--get", key], {
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  const stdout = String(result.stdout).trim();
  if (stdout.length === 0) return undefined;
  // Output format: `<origin>\t<value>` where origin is e.g. `file:/Users/.../.gitconfig`.
  const tabIdx = stdout.indexOf("\t");
  if (tabIdx === -1) return undefined;
  const originRaw = stdout.slice(0, tabIdx);
  const value = stdout.slice(tabIdx + 1);
  return { value, origin: classifyOrigin(originRaw) };
}

/**
 * Wrap `existsSync` with tilde expansion. Git config values often
 * use `~/<path>` for $HOME-relative paths (git itself expands tilde
 * when consuming the value, e.g. for `core.excludesfile`); a raw
 * `existsSync("~/...")` returns false even when the path is valid
 * because POSIX file APIs don't expand tilde. This wrapper expands
 * leading `~/` to `$HOME/` before the existsSync call.
 *
 * @param {string} p
 * @returns {boolean}
 */
function existsSyncWithTildeExpansion(p) {
  if (p.startsWith("~/") && process.env["HOME"] !== undefined) {
    return existsSync(`${process.env["HOME"]}${p.slice(1)}`);
  }
  if (p === "~" && process.env["HOME"] !== undefined) {
    return existsSync(process.env["HOME"]);
  }
  return existsSync(p);
}

/**
 * Map git's `--show-origin` output to our closed origin set.
 *
 * @param {string} originRaw
 * @returns {import("../dist/git-config-path-checks.js").GitConfigOrigin}
 */
function classifyOrigin(originRaw) {
  if (originRaw.startsWith("file:")) {
    const filePath = originRaw.slice("file:".length);
    if (filePath === "/etc/gitconfig" || filePath.startsWith("/etc/git/config")) {
      return "system";
    }
    const home = process.env["HOME"] ?? "";
    if (home.length > 0 && filePath.startsWith(home)) {
      return "global";
    }
    // Repo-local config — usually `.git/config` or `<repo>/.git/config`.
    if (filePath.includes(".git/config")) {
      return "local";
    }
  }
  return "unknown";
}

/**
 * Probe the install-time substrate for `runDoctor`. Slice 1 of
 * `minsky-fresh-clone-health-checks`. Reads four FS / PATH probes:
 * `node_modules/` at MINSKY_HOME, `pnpm-lock.yaml` at MINSKY_HOME,
 * `novel/tick-loop/dist/index.js` (PKG_ROOT-relative — already
 * resolved at module-load via DIST_INDEX_PATH), and `which pnpm`.
 *
 * @returns {Promise<import("../dist/doctor-substrate-rows.js").DoctorSubstrateRowState>}
 */
async function probeSubstrate() {
  const pnpmPath = await whichFn("pnpm");
  return {
    nodeModulesPresent: existsSync(NODE_MODULES_PATH),
    pnpmLockPresent: existsSync(resolve(MINSKY_HOME, "pnpm-lock.yaml")),
    distPresent: existsSync(DIST_INDEX_PATH),
    pnpmOnPath: pnpmPath !== undefined,
  };
}

/**
 * Build the production {@link import("../dist/arch-probe.js").ArchProbes}
 * seam. Slice 6 of `minsky-cli-arch-detection`. Wraps:
 *   - `probeShellArch`: maps Node's `process.arch` to the closed set.
 *   - `probeHardwareArch`: shells out to `sysctl -n hw.optional.arm64`.
 *   - `probeNativeBrewPath` / `probeIntelBrewPath`: `existsSync`.
 */
function buildArchProbes() {
  return {
    probeShellArch: () => {
      // Node's `process.arch` is "arm64" on native Apple Silicon, "x64"
      // on both Intel and Rosetta-emulated (x86_64). Map to our closed
      // three-way set.
      switch (process.arch) {
        case "arm64":
          return "arm64";
        case "x64":
        case "ia32":
          return "x86_64";
        default:
          return "other";
      }
    },
    probeHardwareArch: async () => {
      // `sysctl -n hw.optional.arm64` returns "1" on Apple Silicon
      // (even under Rosetta — the hardware is reported truthfully),
      // "0" on Intel Macs, and the command itself is absent on non-
      // Darwin hosts (Linux / Windows). A probe failure due to
      // "sysctl: command not found" falls through to "other".
      try {
        const { stdout } = await execAsync("sysctl -n hw.optional.arm64 2>/dev/null", {
          timeout: 500,
        });
        const trimmed = stdout.trim();
        if (trimmed === "1") return "arm64";
        if (trimmed === "0") return "x86_64";
        return "other";
        // rule-6: handled-locally — sysctl absent is a Linux signal,
        // not a bug; typing as "other" is the planner's signal to skip
        // arm-homebrew injection.
      } catch {
        return "other";
      }
    },
    probeNativeBrewPath: () =>
      existsSync("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : undefined,
    probeIntelBrewPath: () =>
      existsSync("/usr/local/bin/brew") ? "/usr/local/bin/brew" : undefined,
  };
}

/** `which <bin>` adapter — uses `command -v` (POSIX) for portability. */
async function whichFn(bin) {
  try {
    const { stdout } = await execAsync(`command -v ${shellQuote(bin)}`, {
      timeout: 1000,
    });
    const path = stdout.trim();
    return path.length > 0 ? path : undefined;
    // rule-6: handled-locally — `command -v` exits 1 when the binary is
    // missing; promisify treats that as a thrown Error. We type that as
    // "not on PATH" rather than crash the whole CLI.
  } catch {
    return undefined;
  }
}

/** Quote a shell argument minimally (no globbing in our usage). */
function shellQuote(s) {
  return /^[\w.\/-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawn adapter for the bootstrap executor — wraps `child_process.spawn`
 * to return a `{ exitCode, stderrTail }` Promise. Streams stdout/stderr
 * through to the operator's terminal so long installs (model download)
 * show progress live.
 *
 * Slice 6: honors `opts.stdinMode` so the install-arm-homebrew step
 * inherits the parent's stdin (lets sudo prompt for a password on the
 * operator's terminal). Default "ignore" matches slice-1 behavior.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv; stdinMode?: "ignore" | "inherit" }} [opts]
 * @returns {Promise<import("../dist/local-llm-bootstrap-executor.js").ExecuteSpawnResult>}
 */
function spawnAdapter(command, args, opts = {}) {
  const stdinMode = opts.stdinMode ?? "ignore";
  return new Promise((resolveDone, rejectFail) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: [stdinMode, "inherit", "pipe"],
    });
    let stderrTail = "";
    child.stderr?.on("data", (chunk) => {
      const s = chunk.toString("utf8");
      process.stderr.write(s);
      stderrTail = (stderrTail + s).slice(-2048);
    });
    child.on("error", rejectFail);
    child.on("close", (code) => {
      resolveDone({ exitCode: code ?? -1, stderrTail });
    });
  });
}

/**
 * Read one [Y/n] answer from stdin. Used by the confirm prompt.
 *
 * @param {string} summary
 * @returns {Promise<boolean>}
 */
async function confirmInteractive(summary) {
  process.stderr.write(summary);
  process.stderr.write(" [Y/n] ");
  return new Promise((resolveAns) => {
    let buf = "";
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        const ans = buf.trim().toLowerCase();
        // Default Y on empty input (operator hit Enter).
        resolveAns(ans === "" || ans === "y" || ans === "yes");
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

/**
 * Real Claude health probe — slice 4 of `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Spawns `claude --print "ping"` with a 10 s timeout, captures the
 * exit code + stderr, and classifies via {@link classifyClaudeProbeOutput}.
 * The classifier returns one of four verdicts: `healthy` / `exhausted`
 * / `binary-missing` / `error` (transient).
 *
 * Cost: ≤2 input + ≤1 output tokens of Claude budget on the healthy
 * path; zero on the exhausted path (Anthropic rejects before billing).
 *
 * @returns {Promise<import("../dist/claude-health-probe.js").ClaudeHealthDecision>}
 */
async function probeClaude() {
  // Short-circuit: binary missing → no point spawning.
  const path = await whichFn("claude");
  if (path === undefined) {
    return classifyClaudeProbeOutput({
      exitCode: -1,
      stderrTail: "",
      binaryAbsent: true,
    });
  }
  // Synthetic 1-token probe. `claude --print "ping"` returns "pong" or
  // similar in <5s on the healthy path; on exhausted, exits non-zero
  // with a hard-limit message in stderr within ~1s.
  return new Promise((resolveDone) => {
    let stderrBuf = "";
    let stdoutBuf = "";
    let resolved = false;
    const child = spawn("claude", ["--print", "ping"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    // 20s timeout — exhausted claude returns sub-second (429); healthy
    // claude --print can take 5-15s for first-token latency on a cold
    // session. Above 20s we classify as `error` (transient) and defer
    // to claude — don't trigger 17 GB download on a slow network.
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill("SIGKILL");
        resolveDone(
          classifyClaudeProbeOutput({
            exitCode: -1,
            stderrTail: `<probe timed out after 20000ms>${stderrBuf.slice(-3000)}`,
          }),
        );
      }
    }, 20_000);
    child.stdout?.on("data", (chunk) => {
      stdoutBuf = (stdoutBuf + chunk.toString("utf8")).slice(-2048);
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuf = (stderrBuf + chunk.toString("utf8")).slice(-4096);
    });
    // rule-6: handled-locally — child.on("error") fires for ENOENT/EACCES; classifier turns it into a verdict.
    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolveDone(
        classifyClaudeProbeOutput({
          exitCode: -1,
          stderrTail: err instanceof Error ? err.message : String(err),
        }),
      );
    });
    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolveDone(
        classifyClaudeProbeOutput({
          exitCode: code ?? -1,
          stderrTail: stderrBuf,
          stdoutTail: stdoutBuf,
        }),
      );
    });
  });
}

/**
 * @param {readonly string[]} args
 */
async function runLogs(args) {
  const { workerId } = parsePositionalAndForward(args);
  const logPath = resolve(WORKERS_DIR, `${workerId}.log`);
  if (!existsSync(logPath)) {
    process.stderr.write(
      `minsky: no log at ${logPath} — start the worker first with \`minsky ${workerId}\`\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`minsky: tailing ${logPath} (Ctrl+C exits)\n\n`);
  await tailWithPretty(logPath, true);
}

/**
 * @param {readonly string[]} args
 */
function runStop(args) {
  const { workerId } = parsePositionalAndForward(args);
  const pidPath = resolve(WORKERS_DIR, `${workerId}.pid`);
  const livePid = readLivePid(pidPath);
  if (livePid === undefined) {
    process.stderr.write(`minsky: worker ${workerId} is not running (no live PID at ${pidPath})\n`);
    process.exit(1);
  }
  try {
    process.kill(livePid, "SIGTERM");
    process.stderr.write(`minsky: sent SIGTERM to worker ${workerId} (PID ${livePid})\n`);
    rmSync(pidPath, { force: true });
    // rule-6: handled-locally — process.kill ESRCH is benign (already dead); we still clear the PID file
  } catch (err) {
    if (isErrno(err, "ESRCH")) {
      rmSync(pidPath, { force: true });
      process.stderr.write(
        `minsky: worker ${workerId} was already dead — cleared stale PID file\n`,
      );
      return;
    }
    throw err;
  }
}

/**
 * @param {readonly string[]} args
 * @returns {{ workerId: number, extraArgs: readonly string[] }}
 */
function parsePositionalAndForward(args) {
  // If the first arg parses as a non-negative integer, it's the worker-id;
  // everything else passes through to bin/tick-loop.mjs.
  if (args.length > 0 && /^\d+$/.test(args[0] ?? "")) {
    return { workerId: Number(args[0]), extraArgs: args.slice(1) };
  }
  // Operator may have passed `--worker-id=<N>` instead of positional;
  // honor it but still forward.
  for (const a of args) {
    const m = a.match(/^--worker(?:-id)?=(\d+)$/);
    if (m && m[1] !== undefined) return { workerId: Number(m[1]), extraArgs: args };
  }
  return { workerId: 0, extraArgs: args };
}

/**
 * Build the tick-loop args with sane defaults filled in only when the
 * operator hasn't passed them.
 * @param {number} workerId
 * @param {readonly string[]} extraArgs
 * @returns {readonly string[]}
 */
function withSaneDefaults(workerId, extraArgs) {
  const seen = new Set(extraArgs.map((a) => a.split("=", 1)[0]));
  /** @type {string[]} */
  const out = [];
  // Filter out positional digits (they were the workerId) and any
  // existing --worker-id=… so we set our own.
  for (const a of extraArgs) {
    if (/^\d+$/.test(a)) continue;
    if (a.startsWith("--worker-id=")) continue;
    out.push(a);
  }
  out.push(`--worker-id=${workerId}`);
  if (!seen.has("--workers-total")) {
    out.push(`--workers-total=${Math.max(workerId + 1, 1)}`);
  }
  if (!seen.has("--tick-interval-ms")) {
    out.push("--tick-interval-ms=300000");
  }
  if (!seen.has("--paused-sentinel")) {
    out.push(`--paused-sentinel=/tmp/minsky-worker-${workerId}-never-paused`);
  }
  return out;
}

/**
 * Read the PID file and return the PID iff that process is alive.
 * Returns undefined when the file is missing OR the recorded PID is dead.
 * @param {string} pidPath
 * @returns {number | undefined}
 */
function readLivePid(pidPath) {
  if (!existsSync(pidPath)) return undefined;
  try {
    const raw = readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    // `process.kill(pid, 0)` checks existence without signaling.
    process.kill(pid, 0);
    return pid;
    // rule-6: handled-locally — ESRCH = stale PID, ENOENT = race; both treated as "dead"
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} err
 * @param {string} code
 * @returns {boolean}
 */
function isErrno(err, code) {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    /** @type {{ code: unknown }} */ (err).code === code
  );
}

/**
 * Spawn `tail -F <path>` (or `tail -n+1` for non-follow) and pipe each
 * stdout line through `formatLogLine` to process.stdout.
 *
 * @param {string} path
 * @param {boolean} follow
 */
async function tailWithPretty(path, follow) {
  const tailArgs = follow ? ["-n", "100", "-F", path] : ["-n", "+1", path];
  const tail = spawn("tail", tailArgs, { stdio: ["ignore", "pipe", "inherit"] });
  let buffer = "";
  const colorTty = process.stdout.isTTY === true;
  tail.stdout?.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`${formatLogLine(line, { color: colorTty })}\n`);
    }
  });
  process.on("SIGINT", () => {
    if (buffer.length > 0) process.stdout.write(`${formatLogLine(buffer, { color: colorTty })}\n`);
    tail.kill();
    process.exit(0);
  });
  await new Promise((resolveDone) => {
    tail.on("close", () => resolveDone(undefined));
  });
}
