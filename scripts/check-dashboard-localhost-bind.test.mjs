// Paired tests for `check-dashboard-localhost-bind.mjs`. Pattern:
// deterministic gate over `novel/dashboard-web/src/{bind,start}.ts`
// substrate-cohesion (vision.md rule #13.4 ↔ the loopback-by-default
// contract). Tests follow the standard positive / negative fixture shape
// (Meszaros 2007).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  BIND_TS_PATH,
  REQUIRED_BIND_DEFAULT,
  START_TS_PATH,
  checkDashboardLocalhostBind,
} from "./check-dashboard-localhost-bind.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const GOOD_BIND_TS = `
export const BIND_DEFAULT = "${REQUIRED_BIND_DEFAULT}";
export const BIND_OVERRIDE_ENV = "MINSKY_DASHBOARD_BIND";

export function resolveBindHostname(env) {
  const override = env[BIND_OVERRIDE_ENV];
  if (override === undefined || override === "") return BIND_DEFAULT;
  return override;
}

export function bindHostnameWarning(hostname) {
  if (hostname === BIND_DEFAULT || hostname === "localhost") return null;
  return "WARNING: " + hostname;
}
`;

const GOOD_START_TS = `
import { serve } from "@hono/node-server";
import { bindHostnameWarning, resolveBindHostname } from "./bind.js";

const hostname = resolveBindHostname(process.env);
const port = 8080;
const warning = bindHostnameWarning(hostname);
if (warning !== null) process.stderr.write(warning + "\\n");

const server = serve({ fetch, hostname, port }, (info) => {
  process.stdout.write("listening\\n");
});
`;

describe("checkDashboardLocalhostBind — pure-function paired fixtures", () => {
  test("passes on the canonical substrate + boundary fixture", () => {
    const r = checkDashboardLocalhostBind({ bindTs: GOOD_BIND_TS, startTs: GOOD_START_TS });
    expect(r.ok).toBe(true);
  });

  test("fails when bind.ts is missing the BIND_DEFAULT export", () => {
    const bindTs = GOOD_BIND_TS.replace(/export const BIND_DEFAULT[^;]+;/, "");
    const r = checkDashboardLocalhostBind({ bindTs, startTs: GOOD_START_TS });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("BIND_DEFAULT"))).toBe(true);
  });

  test(`fails when BIND_DEFAULT is not "${REQUIRED_BIND_DEFAULT}"`, () => {
    const bindTs = GOOD_BIND_TS.replace(
      `BIND_DEFAULT = "${REQUIRED_BIND_DEFAULT}"`,
      'BIND_DEFAULT = "0.0.0.0"',
    );
    const r = checkDashboardLocalhostBind({ bindTs, startTs: GOOD_START_TS });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("0.0.0.0"))).toBe(true);
    expect(r.errors.some((e) => e.includes(REQUIRED_BIND_DEFAULT))).toBe(true);
  });

  test("fails when bind.ts removes the resolveBindHostname export", () => {
    const bindTs = GOOD_BIND_TS.replace(
      "export function resolveBindHostname",
      "function resolveBindHostname",
    );
    const r = checkDashboardLocalhostBind({ bindTs, startTs: GOOD_START_TS });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("resolveBindHostname"))).toBe(true);
  });

  test("fails when bind.ts removes the bindHostnameWarning export", () => {
    const bindTs = GOOD_BIND_TS.replace(
      "export function bindHostnameWarning",
      "function bindHostnameWarning",
    );
    const r = checkDashboardLocalhostBind({ bindTs, startTs: GOOD_START_TS });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("bindHostnameWarning"))).toBe(true);
  });

  test("fails when start.ts drops the resolveBindHostname import", () => {
    const startTs = GOOD_START_TS.replace(
      'import { bindHostnameWarning, resolveBindHostname } from "./bind.js";',
      "",
    );
    const r = checkDashboardLocalhostBind({ bindTs: GOOD_BIND_TS, startTs });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("import"))).toBe(true);
  });

  test("fails when start.ts replaces the resolveBindHostname call with a hardcoded literal", () => {
    const startTs = GOOD_START_TS.replace(
      "const hostname = resolveBindHostname(process.env);",
      'const hostname = "0.0.0.0";',
    );
    const r = checkDashboardLocalhostBind({ bindTs: GOOD_BIND_TS, startTs });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("resolveBindHostname(process.env)"))).toBe(true);
  });

  test("fails when start.ts omits the hostname field from serve(...)", () => {
    const startTs = GOOD_START_TS.replace(
      "serve({ fetch, hostname, port }",
      "serve({ fetch, port }",
    );
    const r = checkDashboardLocalhostBind({ bindTs: GOOD_BIND_TS, startTs });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("hostname"))).toBe(true);
    expect(r.errors.some((e) => e.includes("0.0.0.0"))).toBe(true);
  });

  test("aggregates multiple violations rather than short-circuiting on the first", () => {
    const bindTs = "// empty";
    const startTs = "// empty";
    const r = checkDashboardLocalhostBind({ bindTs, startTs });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 3 bind.ts errors + 3 start.ts errors = 6.
    expect(r.errors.length).toBe(6);
  });
});

describe("real source files — the loopback-by-default invariant on main", () => {
  test("bind.ts + start.ts cohere on the dashboard-localhost-bind contract", async () => {
    const bindTs = await readFile(resolve(REPO_ROOT, BIND_TS_PATH), "utf8");
    const startTs = await readFile(resolve(REPO_ROOT, START_TS_PATH), "utf8");
    const r = checkDashboardLocalhostBind({ bindTs, startTs });
    if (!r.ok) {
      throw new Error(
        `dashboard-localhost-bind violation:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
    expect(r.ok).toBe(true);
  });
});
