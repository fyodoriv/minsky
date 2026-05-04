/**
 * `@minsky/dashboard-web` — pure SSR HTML renderer.
 * Escapes every interpolated string so an attacker-controlled metric
 * label cannot inject `<script>` (rule #7 chaos table row 3).
 */

import type { SuccessMetric } from "./metrics.js";

/**
 * Strategy seam (rule #2) — given a metric, return its current value as a
 * string, or `null` to render the `(stub)` sentinel. Synchronous by
 * contract: async caching/snapshot work happens upstream of `render`
 * (see `distribution/run-dashboard-web.sh` + `start.ts`). Default callers
 * pass `null`-returning Strategy → backward-compatible `(stub)` output.
 *
 * Note: the property is named `getValue` (not `valueOf`) deliberately —
 * `valueOf` is inherited from `Object.prototype`, so a `?? defaultFn`
 * fallback would silently pick up `Object.prototype.valueOf` and
 * crash with "Cannot convert undefined or null to object" at call time.
 */
export type GetValue = (metric: SuccessMetric) => string | null;

/** Backward-compatible default: every metric renders as `(stub)`. */
export const STUB_GET_VALUE: GetValue = () => null;

/** HTML-escape every character that could break out of an attribute or text node. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @otel-exempt pure helper of `render`.
 *
 * The metric value is rendered through `getValue(m)` Strategy: `null`
 * yields the `(stub)` sentinel (operator-visible "not wired" signal —
 * rule #7 graceful-degrade, explicit not silent); a returned string is
 * HTML-escaped (rule #7 XSS guard) before reaching the client.
 */
function renderRow(m: SuccessMetric, getValue: GetValue): string {
  const id = escapeHtml(m.id);
  const raw = getValue(m);
  const value = raw === null ? "(stub)" : escapeHtml(raw);
  return `<li data-metric-id="${id}"><span class="label">${escapeHtml(m.label)}</span> <span class="value">${value}</span> <span class="unit">${escapeHtml(m.unit)}</span><br><small>${escapeHtml(m.formula)}</small></li>`;
}

/**
 * Render the home-page HTML. Cold-start safe — empty `metrics` still
 * yields a well-formed document with an empty list. `getValue` defaults
 * to `STUB_GET_VALUE` (every row renders `(stub)`) so existing callers
 * keep their behaviour.
 *
 * @otel dashboard-web.render
 */
export function render(args: {
  readonly metrics: readonly SuccessMetric[];
  readonly getValue?: GetValue;
}): string {
  const getValue = args.getValue ?? STUB_GET_VALUE;
  const rows = args.metrics.map((m) => renderRow(m, getValue)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minsky dashboard</title></head><body><h1>Minsky</h1><ul class="metrics">${rows}</ul></body></html>`;
}
