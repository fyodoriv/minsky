/**
 * `@minsky/dashboard-web` — `SuccessMetric` shape (v0, sub-task 1/4).
 * Sub-task 2 (`dashboard-web-metrics-enum`) populates the 10 entries
 * from vision.md § "Success criteria". Pattern: Card & Mackinlay 1999.
 */

/** One row on the dashboard. Pure data — no methods, no behaviour. */
export interface SuccessMetric {
  /** Stable kebab-case id; rendered as `data-metric-id` (the test contract). */
  readonly id: string;
  /** Human-readable label; escaped before rendering (rule #7 — XSS guard). */
  readonly label: string;
  /** Formula / operational definition; vision.md § "Success criteria" cell. */
  readonly formula: string;
  /** Units (e.g., `%`, `s/day`, `tokens/story`). */
  readonly unit: string;
}

/** v0 placeholder. Sub-task 2 replaces with the 10 vision.md metrics. */
export const PLACEHOLDER_METRICS: readonly SuccessMetric[] = [
  { id: "placeholder", label: "Placeholder metric", formula: "n/a (skeleton)", unit: "" },
];
