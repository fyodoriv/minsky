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

/** Default: every row → `(stub)`. @otel-exempt pure constant function. */
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
  const isStub = raw === null;
  const value = isStub ? "(stub)" : escapeHtml(raw);
  const valueClass = isStub ? "value value--stub" : "value";
  return `<li data-metric-id="${id}" class="metric"><div class="metric-head"><span class="label">${escapeHtml(m.label)}</span><span class="unit">${escapeHtml(m.unit)}</span></div><div class="${valueClass}">${value}</div><code class="formula">${escapeHtml(m.formula)}</code></li>`;
}

// Inlined so the dashboard is a single SSR response — no extra fetch,
// works offline. Card & Mackinlay 1999 (glanceable display).
const STYLE = `*,::before,::after{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.5;-webkit-font-smoothing:antialiased}main{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}header{display:flex;align-items:baseline;gap:1rem;margin-bottom:2rem;border-bottom:1px solid #1e293b;padding-bottom:1rem}h1{margin:0;font-size:1.5rem;font-weight:600;letter-spacing:-0.02em;color:#f8fafc}.subtitle{color:#64748b;font-size:0.875rem}.metrics{list-style:none;padding:0;margin:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}.metric{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1.25rem;display:flex;flex-direction:column;gap:0.75rem;transition:border-color 0.15s ease}.metric:hover{border-color:#475569}.metric-head{display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem}.label{font-size:0.875rem;font-weight:500;color:#cbd5e1;line-height:1.3}.unit{font-size:0.75rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0}.value{font-size:1.875rem;font-weight:600;color:#f8fafc;font-variant-numeric:tabular-nums;line-height:1}.value--stub{font-size:1rem;font-weight:400;color:#64748b;font-style:italic}.formula{display:block;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:0.6875rem;color:#475569;background:#0f172a;border-radius:4px;padding:0.5rem 0.625rem;line-height:1.4;word-break:break-all;border:1px solid #1e293b}@media (max-width:600px){main{padding:1rem}.metrics{grid-template-columns:1fr}}`;

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minsky dashboard</title><style>${STYLE}</style></head><body><main><header><h1>Minsky</h1><span class="subtitle">success metrics</span></header><ul class="metrics">${rows}</ul></main></body></html>`;
}
