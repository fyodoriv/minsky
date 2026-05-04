/**
 * `@minsky/dashboard-web` — `SuccessMetric` shape + the 10 vision.md
 * success criteria as a typed constant (sub-task 2/4 of `dashboard-web-v0`).
 * Each entry traces 1:1 to a row of `vision.md` § "Success criteria".
 * Pure data; the renderer (sub-task 3) consumes this — never the inverse
 * (Martin, *Clean Architecture*, 2017 dependency direction).
 *
 * Anchor: Card & Mackinlay 1999 (10-metric glanceable display); rule #4
 * (vision.md § 4 — every constant in source).
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

/**
 * The 10 vision.md success criteria. Order matches the table at
 * `vision.md` § "Success criteria" rows 1-10. Ids are kebab-case and
 * stable across label rewrites of the parent vision.md row.
 */
export const SUCCESS_METRICS: readonly SuccessMetric[] = [
  {
    id: "loop-uptime",
    label: "Loop uptime, 30 / 90 / 365 d",
    formula:
      'systemctl --user is-active minsky-tick-loop && journalctl --user -u minsky-tick-loop --since="30 days ago" -o json | node scripts/uptime.mjs',
    unit: "fraction",
  },
  {
    id: "tokens-per-story",
    label: "Tokens per closed user-story",
    formula:
      'sum(token_count{event="user_story.complete"}[30d]) / count(span{name="user_story.complete"}[30d])',
    unit: "tokens/story",
  },
  {
    id: "spec-alignment",
    label: "Specification alignment (deterministic-linter green ratio)",
    formula:
      'gh run list --workflow ci.yml --branch main --status completed --created ">=$(date -v-30d +%Y-%m-%d)" --limit 1000 --json conclusion --jq \'([.[] | select(.conclusion=="success")] | length) / (length | if . == 0 then 1 else . end)\'',
    unit: "fraction",
  },
  {
    id: "self-improvement-velocity",
    label: "Self-improvement velocity",
    formula: "git log --grep='mape-k rollout' constraints.md --since=\"30 days ago\" | wc -l",
    unit: "rollouts/month",
  },
  {
    id: "mttr",
    label: "Mean time to recovery (MTTR)",
    formula: "histogram_quantile(0.95, supervisor_restart_to_claim_latency_seconds[7d])",
    unit: "seconds",
  },
  {
    id: "wrist-dwell",
    label: "Wrist dwell (inverted)",
    formula: 'count(http_get_total{path="/watch.json"}[1d]) * estimated_dwell_seconds_per_request',
    unit: "seconds/day",
  },
  {
    id: "extraction-count",
    label: "Extraction count",
    formula:
      "gh repo list fyodoriv --json name,createdAt,description --jq '[.[] | select(.description | test(\"@minsky|claude-\")) ] | length'",
    unit: "count",
  },
  {
    id: "dep-interface-coverage",
    label: "Dependency interface coverage",
    formula: "node scripts/check-rule-2-dep-coverage.mjs",
    unit: "fraction",
  },
  {
    id: "token-budget-honoring",
    label: "Token-budget honoring",
    formula: 'sum(rate(claude_code_api_errors_total{status="429"}[7d]))',
    unit: "errors/week",
  },
  {
    id: "task-throughput",
    label: "Task throughput",
    formula:
      "git log --since=\"30 days ago\" --oneline --grep='^feat\\|^fix\\|^docs\\|^chore' | wc -l / 30",
    unit: "tasks/day",
  },
];
