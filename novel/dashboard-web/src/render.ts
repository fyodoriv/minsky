/**
 * `@minsky/dashboard-web` — pure SSR HTML renderer.
 * Escapes every interpolated string so an attacker-controlled metric
 * label cannot inject `<script>` (rule #7 chaos table row 3).
 */

import type { SuccessMetric } from "./metrics.js";

/** HTML-escape every character that could break out of an attribute or text node. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** @otel-exempt pure helper of `render`. */
function renderRow(m: SuccessMetric): string {
  const id = escapeHtml(m.id);
  return `<li data-metric-id="${id}"><span class="label">${escapeHtml(m.label)}</span> <span class="unit">${escapeHtml(m.unit)}</span><br><small>${escapeHtml(m.formula)}</small></li>`;
}

/**
 * Render the home-page HTML. Cold-start safe — empty `metrics` still
 * yields a well-formed document with an empty list.
 *
 * @otel dashboard-web.render
 */
export function render(args: { readonly metrics: readonly SuccessMetric[] }): string {
  const rows = args.metrics.map(renderRow).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minsky dashboard</title></head><body><h1>Minsky</h1><ul class="metrics">${rows}</ul></body></html>`;
}
