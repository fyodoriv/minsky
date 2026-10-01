// @ts-check
// Smoke test for distribution/shortcuts/*.shortcut.json — the
// machine-validatable half of the watch-shortcuts task. Asserts:
//
//   1. each *.shortcut.json under distribution/shortcuts/ is valid JSON,
//   2. each conforms to the Minsky-shortcut schema invariants
//      (validateShortcut — see ./validate.mjs),
//   3. fetch-and-show shortcuts target :8080/watch.json on a substitutable
//      tailscale host,
//   4. post-control shortcuts POST to :8080/control with a {paused: bool}
//      body,
//   5. every fetch-and-show extract.metric_id maps to a SuccessMetric.id
//      shipped by novel/dashboard-web/src/metrics.ts (no drift),
//   6. every fetch-and-show extract.key matches a key on the WatchEnvelope
//      shape exposed by novel/dashboard-web/src/watch.ts (no drift).
//
// Pattern: rule #10 deterministic gate over a manifest set. Pure
// validator (./validate.mjs) over a parsed object; the runner reads
// the filesystem and dispatches to it.
//
// Anchor: rule #10 (deterministic enforcement); Beck XP 1999 (CI as the
// constraint enforcer); Munafò 2017 (pre-registered acceptance gate).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Path A decouple-before-delete (2026-05-25): read the metric-ID
// contract from `dashboard-metric-ids.json` (source-of-truth for the
// shortcut drift checks) instead of importing from
// `@minsky/dashboard-web`. The drift gate against the TS source lives
// in the sibling `dashboard-metric-ids-sync.test.mjs`. This means the
// shortcut test no longer requires `@minsky/dashboard-web` to be
// built, and `novel/dashboard-web/` can be deleted without breaking
// the distribution/shortcuts test set.
import { validateShortcut } from "./validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHORTCUTS_DIR = resolve(HERE, "..");

/** @type {{ success_metric_ids: readonly string[]; watch_metric_ids: Record<string,string> }} */
const METRIC_IDS = JSON.parse(readFileSync(resolve(HERE, "dashboard-metric-ids.json"), "utf8"));
const SUCCESS_METRIC_IDS = new Set(METRIC_IDS.success_metric_ids);
const WATCH_METRIC_IDS = METRIC_IDS.watch_metric_ids;

const KIND_FETCH = "fetch-and-show";
const KIND_POST = "post-control";
const KIND_SETUP = "setup-variable";

// watch-shortcuts-tailscale-host-substitution: no `*.shortcut.json` may
// carry a literal Tailscale hostname in any URL field. The host is
// captured once at first run by `setup-host.shortcut.json` (kind
// `setup-variable`) and read at run time via Get-Variable + Combine-Text.
// Allowed forms in `endpoint.url`:
//   1. the `<tailscale-host>` placeholder (so the URL still parses /
//      validates URL-shape and includes the canonical port + path);
//   2. a Get-Variable reference (e.g., `${host}` or `{{host}}`).
// Anything literal-looking (`*.tailscale.ts.net`, `*.tail-scale.ts.net`,
// `mac-mini-*`, etc.) is forbidden — the runbook would once again ask
// the operator to hand-substitute the host into 5 Shortcuts.
const LITERAL_TAILSCALE_HOST_PATTERNS = [
  /[A-Za-z0-9-]+\.tailscale\.ts\.net/,
  /[A-Za-z0-9-]+\.tail-scale\.ts\.net/,
  /[A-Za-z0-9-]+\.ts\.net/,
];
const HOST_PLACEHOLDER = "<tailscale-host>";
const HOST_VARIABLE_PATTERNS = [/\$\{host\}/, /\{\{host\}\}/];

const VALIDATOR_CTX = {
  successMetricIds: SUCCESS_METRIC_IDS,
  watchMetricIds: WATCH_METRIC_IDS,
};

function readShortcuts() {
  const entries = readdirSync(SHORTCUTS_DIR);
  return entries
    .filter((f) => f.endsWith(".shortcut.json"))
    .map((f) => ({
      filename: f,
      raw: readFileSync(resolve(SHORTCUTS_DIR, f), "utf8"),
    }));
}

/**
 * Inspect a single shortcut's endpoint.url for the
 * watch-shortcuts-tailscale-host-substitution invariants. Returns the
 * list of violations for that file (empty = pass).
 *
 * Two checks:
 *   (a) the URL must NOT match any literal-Tailscale-host pattern
 *       (`*.tailscale.ts.net`, `*.tail-scale.ts.net`, `*.ts.net`); a
 *       literal would mean the operator is back to hand-substitution.
 *   (b) the URL must carry the `<tailscale-host>` placeholder OR a
 *       Get-Variable reference (`${host}` / `{{host}}`) OR a sibling
 *       `url_assembly` block (the Get-Variable + Combine-Text recipe).
 */
function checkUrlHostInvariants(filename, ep) {
  if (ep === undefined) return []; // setup-variable kind has no endpoint
  const url = typeof ep.url === "string" ? ep.url : "";
  /** @type {string[]} */
  const violations = [];
  for (const pat of LITERAL_TAILSCALE_HOST_PATTERNS) {
    if (pat.test(url)) {
      violations.push(`${filename}: endpoint.url contains literal host ${pat.source}: ${url}`);
    }
  }
  const hasPlaceholder = url.includes(HOST_PLACEHOLDER);
  const hasVariableRef = HOST_VARIABLE_PATTERNS.some((p) => p.test(url));
  const hasUrlAssembly = ep.url_assembly !== undefined && typeof ep.url_assembly === "object";
  if (!hasPlaceholder && !hasVariableRef && !hasUrlAssembly) {
    violations.push(
      `${filename}: endpoint.url must contain "${HOST_PLACEHOLDER}" placeholder or a Get-Variable reference (\${host} / {{host}}) or carry a url_assembly block: ${url}`,
    );
  }
  return violations;
}

describe("distribution/shortcuts/*.shortcut.json — schema + URL invariants", () => {
  const shortcuts = readShortcuts();

  it("ships at least 4 manifests (the parent task's brief: 3 watch + 1 pause)", () => {
    expect(shortcuts.length).toBeGreaterThanOrEqual(4);
  });

  it("includes the four canonical files (3 watch + pause), plus optional resume", () => {
    const names = shortcuts.map((s) => s.filename).sort();
    for (const required of [
      "constraint-of-the-week.shortcut.json",
      "last-task-status.shortcut.json",
      "pause.shortcut.json",
      "tokens-remaining.shortcut.json",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("ships exactly one setup-variable manifest (`setup-host.shortcut.json`) that captures the `host` variable for the polling Shortcuts (watch-shortcuts-tailscale-host-substitution)", () => {
    const names = shortcuts.map((s) => s.filename);
    expect(names).toContain("setup-host.shortcut.json");
    const setupKind = shortcuts
      .map((s) => ({ filename: s.filename, parsed: JSON.parse(s.raw) }))
      .filter((s) => s.parsed.shortcut_kind === KIND_SETUP);
    expect(setupKind.length).toBe(1);
    const [{ parsed }] = setupKind;
    expect(parsed.prompt.action).toBe("Ask for Input");
    expect(parsed.set_variable.action).toBe("Set Variable");
    expect(parsed.set_variable.variable_name).toBe("host");
  });

  it("no `*.shortcut.json` carries a literal Tailscale host in any URL field — must be the `<tailscale-host>` placeholder OR a Get-Variable reference (watch-shortcuts-tailscale-host-substitution)", () => {
    // Hypothesis: parameterising the host once at first run drops operator
    // overhead from 5×5=25 manual substitutions to 1 input + 0-touch reuse.
    // This test is the deterministic gate: any literal host re-introduced
    // into the JSON would silently revert to the 25-substitution status quo.
    /** @type {string[]} */
    const offenders = [];
    for (const { filename, raw } of shortcuts) {
      const parsed = JSON.parse(raw);
      for (const v of checkUrlHostInvariants(filename, parsed.endpoint)) offenders.push(v);
    }
    expect(offenders).toEqual([]);
  });

  for (const { filename, raw } of shortcuts) {
    it(`${filename} is valid JSON`, () => {
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it(`${filename} satisfies the Minsky-shortcut schema invariants`, () => {
      const parsed = JSON.parse(raw);
      const violations = validateShortcut(filename, parsed, VALIDATOR_CTX);
      expect(violations).toEqual([]);
    });
  }

  it("every fetch-and-show shortcut targets http(s)://<host>:8080/watch.json", () => {
    const fetchKind = shortcuts
      .map((s) => ({ filename: s.filename, parsed: JSON.parse(s.raw) }))
      .filter((s) => s.parsed.shortcut_kind === KIND_FETCH);
    expect(fetchKind.length).toBe(3);
    for (const { parsed } of fetchKind) {
      expect(parsed.endpoint.url).toMatch(/:8080\/watch\.json$/);
    }
  });

  it("post-control shortcuts target http(s)://<host>:8080/control with a JSON body matching {paused: boolean} exactly", () => {
    // Schema-tightening (watch-control-endpoint, PR #88): assert the
    // post-control payload is *exactly* `{paused: boolean}` so the
    // dashboard's pure `parseControlBody` validator cannot reject it. The
    // endpoint enforces the same shape on the server side
    // (`novel/dashboard-web/src/control.ts` — 400 on missing body,
    // missing `paused` key, or non-boolean `paused`); this test enforces
    // it on the client side so drift between Shortcut and server fails CI.
    const postKind = shortcuts
      .map((s) => ({ filename: s.filename, parsed: JSON.parse(s.raw) }))
      .filter((s) => s.parsed.shortcut_kind === KIND_POST);
    expect(postKind.length).toBeGreaterThanOrEqual(1);
    for (const { filename, parsed } of postKind) {
      expect(parsed.endpoint.url, `${filename}: endpoint.url`).toMatch(/:8080\/control$/);
      expect(parsed.endpoint.method, `${filename}: endpoint.method`).toBe("POST");
      expect(parsed.endpoint.request_content_type, `${filename}: request_content_type`).toMatch(
        /application\/json/i,
      );
      const body = parsed.endpoint.request_body;
      expect(body, `${filename}: endpoint.request_body must be an object`).toBeTypeOf("object");
      expect(body, `${filename}: endpoint.request_body must not be null`).not.toBeNull();
      // Exact key-set: only `paused` (no extra fields → server's validator
      // accepts it; no missing fields → server returns 400 if absent).
      expect(
        Object.keys(body).sort(),
        `${filename}: endpoint.request_body keys must be exactly ["paused"]`,
      ).toEqual(["paused"]);
      expect(typeof body.paused, `${filename}: endpoint.request_body.paused`).toBe("boolean");
    }
  });

  it("the 3 watch readings cover all 3 WatchEnvelope keys (no drift, no overlap)", () => {
    const fetchKind = shortcuts
      .map((s) => JSON.parse(s.raw))
      .filter((s) => s.shortcut_kind === KIND_FETCH);
    const seenKeys = new Set(fetchKind.map((s) => s.extract.key));
    expect(seenKeys).toEqual(new Set(Object.keys(WATCH_METRIC_IDS)));
  });

  it("pause + resume form a symmetric pair (paused: true / paused: false)", () => {
    const postKind = shortcuts
      .map((s) => ({ filename: s.filename, parsed: JSON.parse(s.raw) }))
      .filter((s) => s.parsed.shortcut_kind === KIND_POST);
    if (postKind.length < 2) return; // resume is optional per the brief
    const pausedFlags = postKind.map((s) => s.parsed.endpoint.request_body.paused).sort();
    expect(pausedFlags).toEqual([false, true]);
  });
});
