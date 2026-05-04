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

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SUCCESS_METRICS, WATCH_METRIC_IDS } from "@minsky/dashboard-web";

import { validateShortcut } from "./validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHORTCUTS_DIR = resolve(HERE, "..");

const KIND_FETCH = "fetch-and-show";
const KIND_POST = "post-control";

const VALIDATOR_CTX = {
  successMetricIds: new Set(SUCCESS_METRICS.map((m) => m.id)),
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

  it("post-control shortcuts target http(s)://<host>:8080/control with a JSON body", () => {
    const postKind = shortcuts
      .map((s) => ({ filename: s.filename, parsed: JSON.parse(s.raw) }))
      .filter((s) => s.parsed.shortcut_kind === KIND_POST);
    expect(postKind.length).toBeGreaterThanOrEqual(1);
    for (const { parsed } of postKind) {
      expect(parsed.endpoint.url).toMatch(/:8080\/control$/);
      expect(typeof parsed.endpoint.request_body.paused).toBe("boolean");
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
