#!/usr/bin/env node

// <!-- scope: human-approved runany-dynamic-model-or-local-fallback slice 3 — the run-anywhere entrypoint wiring: reads pin + budget + backend liveness, calls the shipped `decideRunAnyProvider`, prints the chosen model. Called from `bin/minsky-run.sh` (the "Next" step in docs/run-anywhere.md § Status). -->
// runany-resolve-model — the last-mile wiring of the shipped pure
// `decideRunAnyProvider` (pin > dynamic > local) into the run-anywhere
// entrypoint. `bin/minsky-run.sh` calls this BEFORE spawning the agent to
// resolve which model/agent the next iteration should use.
//
// Acceptance (parent task `runany-dynamic-model-or-local-fallback`):
//   (1) operator pin overrides everything — env `MINSKY_STRATEGIC_PIN_MODEL`
//       (alias `MINSKY_PIN_MODEL`) → that model verbatim, every iteration;
//   (2) dynamic-by-remaining-budget when unpinned — reads the on-disk
//       `~/.minsky/token-monitor.json` snapshot the same way
//       `bin/check-budget.sh` does;
//   (3) full auto local fallback when ALL configured remote backends are
//       down/inaccessible — the multi-backend liveness probe (TCP connect)
//       feeds `decideRunAnyProvider`, which returns the local row in ≤1
//       iteration and never a wedged/hold state;
//   (4) recover to remote — the decision is recomputed every iteration over
//       a fresh-or-cached liveness read, so a backend that probes reachable
//       again the next iteration returns a remote model automatically.
//
// Pattern conformance (rule #8):
//   - Pure-function core with I/O at the edge (Martin 2017, Clean
//     Architecture). The decision (`decideRunAnyProvider`), the cache
//     (`LivenessProbeCache`), and the snapshot adapter are all pure; the
//     ONLY I/O in this file is `main` (reads argv/env/disk, opens a TCP
//     socket, writes stdout/exit). The probe is injected into the cache so
//     the wiring is still unit-testable.
//   - Sensible-defaults CLI (global rule "Sensible Defaults"): zero-arg
//     `node scripts/runany-resolve-model.mjs` prints the resolved model id
//     for the common case; `--json` emits the full decision for debugging.
//   - Rule #6 (stay alive): every I/O step degrades — an unreadable budget
//     snapshot → full headroom; a probe error → that backend counts as
//     unreachable (which, if all are unreachable, drives the local
//     fallback — never a crash). The agent always gets SOME model.

import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { LivenessProbeCache, snapshotToRemaining } from "./lib/runany-backend-liveness.mjs";
import { decideRunAnyProvider } from "./lib/runany-provider-decision.mjs";

/** Default remote backend probed when `MINSKY_REMOTE_BACKENDS` is unset. */
const DEFAULT_BACKENDS = "claude=api.anthropic.com:443";

/** Per-backend TCP-connect probe timeout (ms). Short — this runs per-iteration. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * One configured remote backend the liveness probe should check.
 *
 * @typedef {Object} BackendSpec
 * @property {string} id
 * @property {string} host
 * @property {number} port
 */

/**
 * Parse `MINSKY_REMOTE_BACKENDS` — a comma-separated list of
 * `id=host:port` entries (or bare `id`, which probes nothing remote-
 * specific and is treated as the default Anthropic host). Pure over the
 * string. An empty / unset value yields the single default backend.
 *
 * @param {string | undefined} raw
 * @returns {BackendSpec[]}
 */
export function parseBackends(raw) {
  const value = raw === undefined || raw.trim() === "" ? DEFAULT_BACKENDS : raw;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseOneBackend);
}

/**
 * Parse one `id=host:port` (or `id`) token. Pure.
 *
 * @param {string} token
 * @returns {BackendSpec}
 */
function parseOneBackend(token) {
  const eq = token.indexOf("=");
  if (eq < 0) return { id: token, host: "api.anthropic.com", port: 443 };
  const id = token.slice(0, eq);
  const endpoint = token.slice(eq + 1);
  const colon = endpoint.lastIndexOf(":");
  if (colon < 0) return { id, host: endpoint, port: 443 };
  const host = endpoint.slice(0, colon);
  const port = Number(endpoint.slice(colon + 1));
  return { id, host, port: Number.isFinite(port) && port > 0 ? port : 443 };
}

/**
 * The injected probe seam, bound over the parsed backend specs: a TCP
 * connect to each `host:port` with a short timeout. The ONLY network I/O.
 * A connect error / timeout marks the backend unreachable (with a short
 * cause) — never throws (rule #6).
 *
 * @param {readonly BackendSpec[]} specs
 * @returns {(ids: readonly string[]) => Promise<import("./lib/runany-backend-liveness.mjs").ProbeResult[]>}
 */
export function makeTcpProbe(specs) {
  const byId = new Map(specs.map((s) => [s.id, s]));
  return async (ids) => Promise.all(ids.map((id) => probeOne(byId.get(id), id)));
}

/**
 * Probe a single backend by TCP connect. Resolves (never rejects) with a
 * reachability verdict.
 *
 * @param {BackendSpec | undefined} spec
 * @param {string} id
 * @returns {Promise<import("./lib/runany-backend-liveness.mjs").ProbeResult>}
 */
function probeOne(spec, id) {
  if (spec === undefined) return Promise.resolve({ id, reachable: false, reason: "unconfigured" });
  return new Promise((resolve) => {
    const socket = connect({ host: spec.host, port: spec.port });
    let settled = false;
    /**
     * @param {boolean} reachable
     * @param {string} [reason]
     */
    const done = (reachable, reason) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(
        reachable ? { id, reachable: true } : { id, reachable: false, reason: reason ?? "down" },
      );
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, "timeout"));
    socket.once("error", (err) => done(false, shortErr(err)));
  });
}

/**
 * One-token cause string from a socket error (e.g. `ECONNREFUSED`).
 *
 * @param {unknown} err
 * @returns {string}
 */
function shortErr(err) {
  const code = /** @type {{ code?: string }} */ (err)?.code;
  return typeof code === "string" ? code.toLowerCase() : "error";
}

/**
 * Read + parse the token snapshot from `~/.minsky/token-monitor.json` (the
 * canonical path `bin/check-budget.sh` uses). Returns `undefined` on any
 * read/parse error so {@link snapshotToRemaining} maps it to full headroom
 * (cold-start path) rather than crashing.
 *
 * @param {string} [path]
 * @returns {Promise<object | undefined>}
 */
async function readSnapshot(path) {
  const file = path ?? join(homedir(), ".minsky", "token-monitor.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Resolve the operator pin from env. `MINSKY_STRATEGIC_PIN_MODEL` is the
 * canonical name (matches the strategic router's documented env var);
 * `MINSKY_PIN_MODEL` is accepted as a short alias.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function resolvePin(env) {
  const pin = env["MINSKY_STRATEGIC_PIN_MODEL"] ?? env["MINSKY_PIN_MODEL"];
  return pin !== undefined && pin.trim().length > 0 ? pin.trim() : undefined;
}

/**
 * Parse `--json` / `--force-probe` from argv. Pure.
 *
 * @param {string[]} argv
 * @returns {{ json: boolean, force: boolean }}
 */
export function parseArgs(argv) {
  return { json: argv.includes("--json"), force: argv.includes("--force-probe") };
}

/**
 * CLI entry — the only I/O boundary. Resolves the provider decision for the
 * next iteration and prints either the bare model id (default, for the
 * bash runner to capture) or the full decision (`--json`).
 *
 * @returns {Promise<number>}
 */
async function main() {
  const { json, force } = parseArgs(process.argv.slice(2));
  const specs = parseBackends(process.env["MINSKY_REMOTE_BACKENDS"]);
  const snapshot = await readSnapshot(process.env["MINSKY_TOKEN_SNAPSHOT"]);
  const remaining = snapshotToRemaining(snapshot);
  const pin = resolvePin(process.env);

  const cache = new LivenessProbeCache({ clock: () => Date.now(), probe: makeTcpProbe(specs) });
  const { backends } = await cache.liveness(
    specs.map((s) => s.id),
    { force },
  );

  const decision = decideRunAnyProvider({
    remaining,
    remoteBackends: backends,
    ...(pin === undefined ? {} : { operatorPin: pin }),
  });

  if (json) {
    process.stdout.write(`${JSON.stringify({ ...decision, backends })}\n`);
  } else {
    process.stdout.write(`${decision.model}\n`);
  }
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("runany-resolve-model.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
