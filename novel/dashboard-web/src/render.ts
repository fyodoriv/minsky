// no-test: novel/dashboard-web is deprecated (docs/DEPRECATED.md §4) — "keep for now, do NOT add features"; existing files lack tests by policy
/**
 * `@minsky/dashboard-web` — pure SSR HTML renderer.
 * Escapes every interpolated string so an attacker-controlled metric
 * label cannot inject `<script>` (rule #7 chaos table row 3).
 */

import type { ActivityEntry } from "./activity.js";
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
const STYLE = `*,::before,::after{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.5;-webkit-font-smoothing:antialiased}main{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}header{display:flex;align-items:baseline;gap:1rem;margin-bottom:2rem;border-bottom:1px solid #1e293b;padding-bottom:1rem}h1{margin:0;font-size:1.5rem;font-weight:600;letter-spacing:-0.02em;color:#f8fafc}.subtitle{color:#64748b;font-size:0.875rem}.section-title{margin:2.5rem 0 1rem;font-size:0.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em}.metrics{list-style:none;padding:0;margin:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}.metric{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1.25rem;display:flex;flex-direction:column;gap:0.75rem;transition:border-color 0.15s ease}.metric:hover{border-color:#475569}.metric-head{display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem}.label{font-size:0.875rem;font-weight:500;color:#cbd5e1;line-height:1.3}.unit{font-size:0.75rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0}.value{font-size:1.875rem;font-weight:600;color:#f8fafc;font-variant-numeric:tabular-nums;line-height:1}.value--stub{font-size:1rem;font-weight:400;color:#64748b;font-style:italic}.formula{display:block;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:0.6875rem;color:#475569;background:#0f172a;border-radius:4px;padding:0.5rem 0.625rem;line-height:1.4;word-break:break-all;border:1px solid #1e293b}.activity{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.5rem}.activity-empty{color:#64748b;font-style:italic;font-size:0.875rem;padding:1rem 0}.activity-row{display:grid;grid-template-columns:auto auto auto 1fr;align-items:baseline;gap:0.75rem;padding:0.625rem 0.875rem;background:#1e293b;border:1px solid #334155;border-radius:6px;font-size:0.875rem}.activity-index{color:#64748b;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.75rem}.activity-status{font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:0.125rem 0.5rem;border-radius:4px;white-space:nowrap}.activity-status--completed{background:#14532d;color:#bbf7d0}.activity-status--budget-paused,.activity-status--paused{background:#422006;color:#fde68a}.activity-status--no-task,.activity-status--missing-tasks-md{background:#1e293b;color:#94a3b8}.activity-status--failed{background:#450a0a;color:#fecaca}.activity-detail{color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-detail strong{color:#f8fafc;font-weight:500}.activity-provider{font-size:0.625rem;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;padding:0.125rem 0.4rem;border-radius:3px;white-space:nowrap;color:#94a3b8;background:#0f172a;border:1px solid #334155}.activity-provider--claude{color:#bfdbfe;background:#1e3a8a;border-color:#1e40af}.activity-provider--local{color:#fde68a;background:#422006;border-color:#854d0e}.activity-provider--hold{color:#fecaca;background:#450a0a;border-color:#7f1d1d}@media (max-width:600px){main{padding:1rem}.metrics{grid-template-columns:1fr}.activity-row{grid-template-columns:auto 1fr;row-gap:0.25rem}.activity-status{grid-column:1 / -1}.activity-provider{grid-column:1 / -1}}`;

/**
 * @otel-exempt pure helper of `render`.
 *
 * The detail column shows the task ID (bold) when present, falling
 * back to the daemon's `reason` string. Both are HTML-escaped (rule
 * #7 XSS guard) — `iteration.reason` is daemon-emitted but shape-
 * stable, the escape is the defensive fallback for any future
 * upstream-malformed input.
 */
function renderActivityRow(a: ActivityEntry): string {
  const status = escapeHtml(a.status);
  const statusClass = `activity-status activity-status--${escapeHtml(a.status.replace(/[^a-z0-9-]/gi, "-"))}`;
  const detail =
    a.taskId !== ""
      ? `<strong>${escapeHtml(a.taskId)}</strong>`
      : a.reason !== ""
        ? escapeHtml(a.reason)
        : "";
  // Slice 5 of `local-llm-fallback-on-budget-pause`: surface the
  // provider tag when set (claude/local/hold). Empty string (legacy
  // single-strategy claude path) renders nothing — the column is
  // visually empty rather than "(none)" so the existing dashboard
  // layout stays unchanged for operators who haven't opted into the
  // local-llm fallback.
  const providerBadge =
    a.provider !== ""
      ? `<span class="activity-provider activity-provider--${escapeHtml(a.provider.replace(/[^a-z0-9-]/gi, "-"))}">${escapeHtml(a.provider)}</span>`
      : "";
  return `<li class="activity-row"><span class="activity-index">#${a.index}</span><span class="${statusClass}">${status}</span>${providerBadge}<span class="activity-detail">${detail}</span></li>`;
}

/**
 * Render the home-page HTML. Cold-start safe — empty `metrics` and/or
 * `activity` still yield a well-formed document. `getValue` defaults
 * to `STUB_GET_VALUE` (every row renders `(stub)`); `activity` defaults
 * to `[]` (no recent activity → "no recent iterations" placeholder).
 * Auto-refreshes every 5 s via `<meta http-equiv="refresh">` when
 * activity is non-empty so the operator sees iterations stream in
 * without manually reloading.
 *
 * @otel dashboard-web.render
 */
export function render(args: {
  readonly metrics: readonly SuccessMetric[];
  readonly getValue?: GetValue;
  readonly activity?: readonly ActivityEntry[];
}): string {
  const getValue = args.getValue ?? STUB_GET_VALUE;
  const activity = args.activity ?? [];
  const rows = args.metrics.map((m) => renderRow(m, getValue)).join("");
  const activityRows =
    activity.length === 0
      ? `<p class="activity-empty">No recent iterations — start the supervisor with <code>pnpm minsky:setup</code>.</p>`
      : `<ul class="activity">${activity.map(renderActivityRow).join("")}</ul>`;
  const refresh = activity.length > 0 ? `<meta http-equiv="refresh" content="5">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>Minsky dashboard</title><style>${STYLE}</style></head><body><main><header><h1>Minsky</h1><span class="subtitle">success metrics</span></header><ul class="metrics">${rows}</ul><h2 class="section-title">Recent activity</h2>${activityRows}</main></body></html>`;
}
