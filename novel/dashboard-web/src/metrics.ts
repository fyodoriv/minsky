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

const DAY_MS = 24 * 60 * 60 * 1000;

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
  /**
   * Maximum age (ms) before an observation is "stale" and the freshness
   * lint blocks the PR. Per-metric so a 1d window (`mttr`) and a lifetime
   * window (`extraction-count`) can coexist. Anchor: Ries 2011 (stale
   * data is worse than no data — drives wrong direction).
   */
  readonly freshnessBudgetMs: number;
  /**
   * Explicit `"ok"` opts a metric out of the no-vanity guard, which
   * otherwise rejects monotonically-increasing observations (Ries 2011 —
   * vanity-metric anti-pattern: counts that always go up incentivise
   * activity, not outcomes). Only set when the metric is *by design* a
   * lifetime-inventory count (e.g., `extraction-count`).
   */
  readonly monotonic?: "ok";
  /**
   * Success threshold copied verbatim from vision.md § "Success criteria".
   * The numeric goal the metric should hit; the value below which we say
   * "ship more, this is working". Operator directive 2026-05-21 — every
   * metric tells you its goal explicitly, no implicit "good = high".
   */
  readonly goal: string;
  /**
   * Pivot threshold copied verbatim from vision.md § "Success criteria".
   * The value below which the *approach* is reconsidered (Ries 2011
   * build-measure-learn). Operator directive 2026-05-21 — every metric
   * tells you when to walk away, not just when to celebrate.
   */
  readonly pivot: string;
  /**
   * Literature anchor for the metric's choice (not the goal). Operator
   * directive 2026-05-21 — readers see the rationale for why this metric
   * is the right one to track, not just the formula.
   */
  readonly anchor: string;
  /**
   * Milestone that gates this metric to "must be observed" status (e.g.
   * "M1.1", "M1.13"). Optional — some metrics gate multiple milestones
   * (`spec-alignment` is cited by M1, M2, M3, M4). Operator directive
   * 2026-05-21 — links every metric to the roadmap so a reader can
   * decide which to look at first.
   */
  readonly milestone?: string;
}

/**
 * A metric that *should* exist but doesn't yet. Surfaced in METRICS.md's
 * "Metrics to add" section so readers see the gap explicitly instead of
 * silently assuming the 10-metric set is exhaustive. Operator directive
 * 2026-05-21 — "which metrics should be added" is a load-bearing question,
 * not a footnote.
 */
export interface ProposedMetric {
  /** Stable kebab-case id; matches the future SuccessMetric id once landed. */
  readonly id: string;
  /** Human-readable label. */
  readonly label: string;
  /**
   * Why this metric belongs on the dashboard. One sentence — the operator
   * who reads METRICS.md should immediately understand why it's worth the
   * collection cost.
   */
  readonly rationale: string;
  /**
   * Milestone that introduces this metric (e.g. "M1.1", "M2.7", "M4.1").
   * Lets the reader filter "what's missing for the current milestone".
   */
  readonly milestone: string;
  /**
   * Task id (in `TASKS.md` or a future spec) that lands the collector.
   * Optional — some proposals depend on milestone-level work rather than
   * a discrete task.
   */
  readonly blockedBy?: string;
  /**
   * Sketch of the collection formula (same shape as `SuccessMetric.formula`
   * but tagged TBD-AFTER for the blocker). Operator directive — even
   * proposed metrics should show how they'd be observed once the blocker
   * lands.
   */
  readonly formula: string;
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
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "99% / 97% / 95% (30 / 90 / 365 d)",
    pivot: "<90% over 30 d → reconsider supervisor design",
    anchor: "Beyer et al., _SRE_ 2016, Ch. 4 (SLI / SLO)",
    milestone: "M1.1",
  },
  {
    // 2026-05-24: added to close out `cross-repo-iteration-ship-rate-ci-gate`
    // (P0 M1). Rolling-30d iteration→PR ship-rate, surfaced as a dashboard
    // tile so an operator scanning the dashboard sees the ratio without
    // grepping jsonl. Pre-registered thresholds are pinned in
    // `novel/cross-repo-runner/src/iteration-ship-rate.ts` (one source of
    // truth shared by the CLI lint and this collector).
    id: "cross-repo-pr-rate",
    label: "Cross-repo iteration→PR ship-rate (30d)",
    formula: "node scripts/check-cross-repo-pr-rate.mjs --window=30d --json",
    unit: "ratio",
    freshnessBudgetMs: 1 * DAY_MS,
    goal: "≥0.15 (ABOVE) — at or above the target floor; the runner is shipping enough PRs to justify iteration cost",
    pivot:
      "<0.10 (BELOW) for ≥4 consecutive weeks AFTER both `devin-spawn-no-pr-opened` and `watchdog-timeout-kills-productive-devin` ship → retire the spawn-then-extract-PR-URL pattern and replace with pre-created draft PRs (see TASKS.md `cross-repo-iteration-ship-rate-ci-gate` Pivot)",
    anchor:
      "Beyer et al., _SRE_ 2016, Ch. 6 (the four golden signals require aggregate visibility); Forsgren/Humble/Kim, _Accelerate_ 2018 (DORA keys are ratios over a window); Munafò et al. 2017 (pre-registered thresholds — pinned in `iteration-ship-rate.ts`)",
    milestone: "M1",
  },
  {
    id: "tokens-per-story",
    label: "Tokens per closed user-story",
    formula:
      'sum(token_count{event="user_story.complete"}[30d]) / count(span{name="user_story.complete"}[30d])',
    unit: "tokens/story",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "Decreasing trend month-over-month (≥5% MoM)",
    pivot:
      "Flat or rising for 3 consecutive months → MAPE-K loop isn't helping; pivot the autonomic manager",
    anchor: "Goldratt TOC (improving the constraint should move this metric)",
    milestone: "M2 (efficiency)",
  },
  {
    id: "spec-alignment",
    label: "Specification alignment (deterministic-linter green ratio)",
    formula:
      'gh run list --workflow ci.yml --branch main --status completed --created ">=$(date -v-30d +%Y-%m-%d)" --limit 1000 --json conclusion --jq \'([.[] | select(.conclusion=="success")] | length) / (length | if . == 0 then 1 else . end)\'',
    unit: "fraction",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "≥95% of CI runs on `main` are green across the rule-#10 lint set",
    pivot: "<85% over 7 d → spec is wrong OR system is misaligned; trigger spec audit",
    anchor:
      'Havelund & Goldberg, "Verify Your Runs", _VSTTE_ 2008 (runtime specification monitoring)',
    milestone: "M1 (gates every milestone)",
  },
  {
    id: "self-improvement-velocity",
    label: "Self-improvement velocity",
    formula: "git log --grep='mape-k rollout' constraints.md --since=\"30 days ago\" | wc -l",
    unit: "rollouts/month",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "≥4 prompt rollouts / month with sustained gain (≥10%, p < 0.05, 7 d post-rollout) after Q1",
    pivot: "<2 / month sustained 3 months → MAPE-K design or DSPy choice is wrong; pivot",
    anchor: "Khattab DSPy 2023; Kohavi _Trustworthy_ 2020 (statistical rigour)",
    milestone: "M4 (autonomous rollouts)",
  },
  {
    id: "mttr",
    label: "Mean time to recovery (MTTR)",
    formula: "histogram_quantile(0.95, supervisor_restart_to_claim_latency_seconds[7d])",
    unit: "seconds",
    freshnessBudgetMs: DAY_MS,
    goal: "<5 min p95 from process death to next claim",
    pivot: "p95 >10 min sustained 7 d → supervisor backoff or claim-resume is wrong",
    anchor: "Forsgren et al., _Accelerate_ 2018 (DORA MTTR)",
    milestone: "M1.13",
  },
  {
    id: "wrist-dwell",
    label: "Wrist dwell (inverted)",
    formula: 'count(http_get_total{path="/watch.json"}[1d]) * estimated_dwell_seconds_per_request',
    unit: "seconds/day",
    freshnessBudgetMs: DAY_MS,
    goal: "≤60 s / day",
    pivot:
      ">120 s / day for 14 d → surface is too informative or system is too unhealthy; redesign",
    anchor: "Card & Mackinlay 1999; Weiser & Brown 1995 (calm tech: dwell as friction)",
    milestone: "M2+ (Watch surface)",
  },
  {
    id: "extraction-count",
    label: "Extraction count",
    formula:
      "gh repo list fyodoriv --json name,createdAt,description --jq '[.[] | select(.description | test(\"@minsky|claude-\")) ] | length'",
    unit: "count",
    freshnessBudgetMs: 30 * DAY_MS,
    monotonic: "ok",
    goal: "≥4 OSS repos extracted by month 6",
    pivot: "<2 by month 4 → re-evaluate extraction policy / scope",
    anchor: "rule #1 (don't reinvent the wheel) — extraction is the operationalisation",
    milestone: "M2+ (sustained extraction)",
  },
  {
    id: "dep-interface-coverage",
    label: "Dependency interface coverage",
    formula: "node scripts/check-rule-2-dep-coverage.mjs",
    unit: "fraction",
    freshnessBudgetMs: DAY_MS,
    goal: "100% of named deps behind adapter",
    pivot: "≥1 unhidden dep persisting >1 sprint → fix with adapter wrap or task",
    anchor: "rule #2 (every dep behind interface)",
    milestone: "M1 (substrate cohesion)",
  },
  {
    id: "token-budget-honoring",
    label: "Token-budget honoring",
    formula: 'sum(rate(claude_code_api_errors_total{status="429"}[7d]))',
    unit: "errors/week",
    freshnessBudgetMs: DAY_MS,
    goal: "0 hard 429 / week sustained 30 d",
    pivot: "≥1 / week sustained 4 weeks → budget-guard logic is broken; pivot",
    anchor: "Beyer SRE 2016 (error budget)",
    milestone: "M1 (cost discipline)",
  },
  {
    id: "task-throughput",
    label: "Task throughput",
    formula:
      "git log --since=\"30 days ago\" --oneline --grep='^feat\\|^fix\\|^docs\\|^chore' | wc -l / 30",
    unit: "tasks/day",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "Sustained tasks / day at observed budget (≥1 / day at green budget)",
    pivot: "<1 / day for 14 d at green budget → bottleneck elsewhere; analyse via TOC",
    anchor: "Goldratt TOC (throughput as the goal of any system)",
    milestone: "M1 (cadence)",
  },
  // ---- Ledger-backed M1 metrics (PR `feat/m1-2-m1-7-collectors-from-transform-ledger`) ----
  // These three metrics consume the `.minsky/transform-runs.jsonl` ledger
  // shipped in PRs #824–#828 (MAPE-K Monitor → Analyse → Knowledge) via
  // `scripts/collect-metrics.mjs` wrappers around `transform_trend.py`
  // (per-host) + `transform_knowledge.py` (cross-host). Promoting them
  // from PROPOSED_METRICS to SUCCESS_METRICS closes 3 of the 5 remaining
  // metric-only milestone-alignment gaps (M1.2 / M1.5 / M1.7) — the
  // no-reinvent path filed as `wire-transform-runs-jsonl-into-m1-metric-collectors`.
  {
    id: "fleet-stability-aggregated",
    label: "Fleet-wide stability (% sessions lint-pass across all hosts)",
    formula:
      "MINSKY_HOSTS_DIR=<parent> python3 scripts/transform_knowledge.py --hosts-dir $MINSKY_HOSTS_DIR --json | jq '[.per_host[] | .session_count * .lint_pass_fraction] | add / ([.per_host[].session_count] | add)'",
    unit: "fraction",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "≥90% of sessions across the fleet land with lint clean (matches M1.2 acceptance: stability measured across the fleet, not per-machine)",
    pivot:
      "<80% over 30 d → fleet aggregation is masking systematic per-host failure; revisit the `--hosts-dir` design and per-host alert thresholds before declaring the fleet stable",
    anchor:
      "Beyer et al., _SRE_ 2016, Ch. 4 (multi-region SLI aggregation = weighted mean of per-region availability, NOT simple average); rule #1 (don't reinvent — the ledger + the cross-host aggregator already exist in PRs #824/#827, this metric is the wrap)",
    milestone: "M1.2",
  },
  {
    id: "session-converts-repo",
    label: "% of `minsky --transform` sessions that applied at least one code change",
    formula:
      "python3 scripts/transform_trend.py --repo $PWD --json | jq '[.files_delta_per_session + .tests_delta_per_session + .loc_delta_per_session | .[] | select(. != 0)] | length / .session_count'",
    unit: "fraction",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "≥80% of sessions changed at least one file / test / loc (M1.5 acceptance: 8h session converts the repo, not just observes it)",
    pivot:
      "<50% sustained over 30 d → the 8h brief isn't producing useful action; redesign the brief template + revisit the agent's decision threshold before declaring M1.5 met",
    anchor:
      "rule #1 (don't reinvent — `transform_trend.py` already exposes per-session deltas; the metric is the existence of non-zero deltas, not a new measurement)",
    milestone: "M1.5",
  },
  {
    id: "baseline-delta-per-cycle",
    label: "Baseline improvement delta per 8h cycle (files + tests + loc averaged)",
    formula:
      "python3 scripts/transform_trend.py --repo $PWD --json | jq '{files: (.files_delta_cumulative | last) / .session_count, tests: (.tests_delta_cumulative | last) / .session_count, loc: (.loc_delta_cumulative | last) / .session_count}'",
    unit: "files+tests+loc/cycle",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "Per-cycle averages positive on ≥2 of the 3 axes (M1.7 acceptance: before/after improvement per cycle)",
    pivot:
      "All three per-cycle averages = 0 for 30 d → minsky isn't transforming the repo, just observing it; pivot the brief + session length before declaring M1.7 met",
    anchor:
      "Forsgren, Humble & Kim, _Accelerate_ 2018 (DORA — measure what matters via ratios over a fixed window, not absolute counts); rule #1 (`transform_trend.py` is the existing aggregator)",
    milestone: "M1.7",
  },
  {
    // Path A scoreboard metric. Closes task `path-a-loc-scoreboard-
    // metric` (P1, M1). Tracks the LOC in `novel/` (TS + TSX, tests
    // excluded) as the single honest measure of whether the
    // aggressive-cut is moving in the right direction. 2026-05-25
    // retro found 72 PRs / +13,981 LOC delta over 24h — vanity
    // metric (PRs) up, strategic metric (LOC) up by 14K against
    // a stated goal of shrinking to ≤10K. The metric makes the
    // Goodhart-trap impossible to hide.
    //
    // Source: `docs/plans/2026-05-24-path-a-aggressive-cut.md`
    // (the 5-10K target); rule #4 (everything measurable); rule
    // #10 (deterministic — same repo state, same output); Ries
    // 2011 (no vanity metrics).
    id: "path-a-loc-novel-tree",
    label: "Path A scoreboard: LOC in novel/ (TS+TSX, excl. tests)",
    formula:
      "fd -e ts -e tsx --type f --exclude '*.test.*' . novel/ | xargs wc -l | tail -1 | awk '{print $1}'",
    unit: "LOC",
    freshnessBudgetMs: 1 * DAY_MS,
    goal: "≤10000 (Path A target — aggressive cut from ~31K to ≤10K via phase-7b + 11b deletions); today (~31K) is 3x over budget and stays red until deletion lands",
    pivot:
      ">25000 for ≥30 d AFTER phase-7b'+11b deletions ship → surviving substrate has irreducible complexity at higher floor than predicted; raise budget to 25K with operator signoff in the Path A plan. Don't fake the metric to make the budget.",
    anchor:
      "`docs/plans/2026-05-24-path-a-aggressive-cut.md` § Goal; Goodhart's Law (when a measure becomes a target, it ceases to be a good measure — PR count is the canonical example); Ries, _The Lean Startup_ 2011 (no vanity metrics); Forsgren/Humble/Kim 2018 (measure what matters)",
    milestone: "M1",
  },

  // 4 new metrics for the M1 exit criteria that were missing the
  // `metric` surface in the alignment gate (2026-05-26): M1.3 (one-
  // command install), M1.8 (remote task submission), M1.9 (launcher-
  // agnostic feature parity), M1.12 (clean uninstall). Each pairs
  // with a test file under `user-stories/00<N>-*.test.ts` so the gate's
  // `test-file` surface aligns simultaneously.
  {
    id: "install-success-rate",
    label: "Install success rate — `./setup.sh --setup` completes",
    formula:
      "bash -c 'cd $(mktemp -d -t minsky-install-XXX); git clone --quiet --depth 1 https://github.com/fyodoriv/minsky.git src && cd src && pnpm install --frozen-lockfile --silent && bash setup.sh --doctor && echo 1 || echo 0'",
    unit: "binary (1 = success / 0 = failure)",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "1 (every fresh clone + setup must succeed)",
    pivot:
      "0 for ≥2 consecutive weeks → bootstrap script has bit-rotted; halt feature work and restore install",
    anchor:
      "Beyer et al., _SRE_ 2016, Ch. 4 (the install path IS an SLI); user-stories/006-runner-on-any-repo.md § Acceptance criteria (the one-command-install surface gates every M1 user-story).",
    milestone: "M1.3",
  },
  {
    id: "remote-task-submission-substrate",
    label: "Remote task submission — substrate present + receiver ready",
    formula:
      "bash -c 'test -f scripts/submit-finding.mjs && test -f bin/minsky && grep -q \"submit\" bin/minsky && echo 1 || echo 0'",
    unit: "binary (1 = substrate present / 0 = missing)",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "1 (the substrate exists; the operator-facing `minsky submit` subcommand is wired even if remote receivers aren't yet)",
    pivot:
      "0 for ≥2 weeks → file `minsky-submit-substrate-restoration` P0 — without the substrate, no operator can hand findings to the daemon's queue",
    anchor:
      "Conway 1968 (system structure mirrors org structure — remote-submission IS the org-distributed-discovery surface); user-stories § M1.8 (to be filed in this PR).",
    milestone: "M1.8",
  },
  {
    id: "agent-launcher-parity",
    label: "Agent-launcher parity — `bin/minsky --once` works under each backend",
    formula:
      "node scripts/launcher-parity-probe.mjs --backends=claude,devin,openhands,aider --json | jq '[.[] | select(.ok == true)] | length'",
    unit: "count of passing backends (target 4 of 4)",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "≥3 of 4 backends pass per week (one launcher allowed to flake — e.g. a model rate-limit — without dropping the criterion to red)",
    pivot:
      "<2 for ≥2 weeks → launcher abstraction is leaking backend-specific assumptions; halt agent-spawn work and re-architect the dispatcher",
    anchor:
      "Liskov 1987 (substitutability principle — backends must be interchangeable at the spawn boundary); user-stories/008-per-task-backend-and-personas.md § Acceptance criteria; user-stories/014-launcher-agnostic-feature-parity.md.",
    milestone: "M1.9",
  },
  {
    id: "uninstall-residue-count",
    label: "Clean uninstall — files left behind by `minsky uninstall`",
    formula:
      "bash -c 'cd $(mktemp -d); bash $(git rev-parse --show-toplevel)/setup.sh --setup >/dev/null 2>&1; bash $(git rev-parse --show-toplevel)/bin/minsky uninstall --force >/dev/null 2>&1; find . ~/.minsky ~/Library/LaunchAgents/com.minsky.* 2>/dev/null | wc -l'",
    unit: "count of residue files (target 0)",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "0 (clean uninstall removes every file minsky added)",
    pivot:
      "≥10 residue files for ≥2 weeks → uninstall has bit-rotted (new install paths added without matching uninstall path); halt feature work and restore reversibility",
    anchor:
      "Saltzer & Schroeder 1975 (least common mechanism — uninstall is the inverse of install, must enumerate every install effect); user-stories § M1.12 (filed in this PR).",
    milestone: "M1.12",
  },
];

/**
 * Metrics that *should* exist on the dashboard but don't yet. Each row
 * names the milestone that introduces it, the task that lands the
 * collector, and a sketch of the future formula. Operator directive
 * 2026-05-21 — surface the gap explicitly so a reader knows the 10-metric
 * set above is the current state, not the steady state. Order matches
 * MILESTONES.md M1 → M5 progression.
 */
export const PROPOSED_METRICS: readonly ProposedMetric[] = [
  {
    id: "stability-10h-unattended",
    label: "Stability: successful iterations / total over 10h unattended runs",
    rationale:
      "M1.1 acceptance gates on a 90% stability ratio across ≥5 consecutive 10h runs on ≥2 machines. `loop-uptime` measures _active days_ (a proxy); the real ratio comes from `orchestrate.jsonl` outcomes. Without this metric, M1.1 is unobservable.",
    milestone: "M1.1",
    blockedBy: "fleet-stability-centralized-reporting",
    formula:
      "node scripts/stability-report.mjs --window=10h ⟨TBD-AFTER: fleet-stability-centralized-reporting⟩",
  },
  // 2026-05-25: `fleet-stability-aggregated` (M1.2) and
  // `baseline-delta-per-cycle` (M1.7) were here. Both promoted to
  // SUCCESS_METRICS above with real collectors that wrap
  // `transform_knowledge.py` / `transform_trend.py` (PRs #824/#827) over
  // the `.minsky/transform-runs.jsonl` ledger — see
  // `wire-transform-runs-jsonl-into-m1-metric-collectors` (TASKS.md, P2)
  // for the no-reinvent rationale. The remaining PROPOSED entries
  // (`stability-10h-unattended`, `human-blocked-task-rate`, ...) are
  // still missing real collectors and stay here as the explicit gap
  // surface (Operator directive 2026-05-21).
  {
    id: "human-blocked-task-rate",
    label: "Fraction of tasks marked `Blocked: needs-human-action` per 8h session",
    rationale:
      "M1.6 acceptance: 0 destructive ops, 0 force pushes, 0 secret mutations. The leading indicator is how often the agent correctly recognised an unsafe op and blocked it — too high means the agent is over-cautious; zero means the safety filter is asleep.",
    milestone: "M1.6",
    blockedBy: "minsky-default-8h-repo-transformation",
    formula:
      "grep -c '^\\*\\*Blocked\\*\\*: needs-human-action' TASKS.md ⟨TBD-AFTER: minsky-default-8h-repo-transformation⟩",
  },
  {
    id: "mttr-self-heal",
    label: "MTTR for catalogued self-heal failures (top-level)",
    rationale:
      "M1.13 phase 1 shipped 4 automated heals + the MTTR ledger; the sub-metric is currently buried under `mttr` rather than a top-level row. Promote to top-level once the 30-day observation window has ≥1 heal-fire to plot.",
    milestone: "M1.13",
    blockedBy: "promote-remaining-heal-recipes",
    formula:
      "node scripts/heal-mttr-report.mjs --window=30d --json ⟨TBD-AFTER: ≥1 heal fires in production⟩",
  },
  {
    id: "swe-bench-resolve-rate",
    label: "SWE-bench Verified resolve rate, Minsky vs. competitors",
    rationale:
      "M2.7 acceptance: Minsky's resolve rate is measured and compared to published numbers for Devin, OpenHands, SWE-agent. The competitive scorecard depends on this single benchmark axis.",
    milestone: "M2.7",
    blockedBy: "self-metrics-competitive-benchmark",
    formula: "minsky benchmark --swe-bench-subset ⟨TBD-AFTER: self-metrics-competitive-benchmark⟩",
  },
  {
    id: "time-to-pr-median",
    label: "Median time from `minsky run <id>` to PR-opened",
    rationale:
      "M2.6 acceptance: <30 min for a well-specified small task. Needs a timestamp pair (run-start, PR-opened) in the iteration record.",
    milestone: "M2.6",
    blockedBy: "self-metrics-competitive-benchmark",
    formula:
      "node scripts/time-to-pr.mjs --window=30d ⟨TBD-AFTER: self-metrics-competitive-benchmark⟩",
  },
  {
    id: "ci-green-on-first-push",
    label: "Fraction of daemon PRs where CI is green on the first push (no re-run cycle)",
    rationale:
      "M2.3 acceptance: 0 PRs opened with failing CI over a 10-task batch. Counts the rate at which the daemon's local-CI prediction matched the remote CI outcome — the integration-test surrogate for M2.3.",
    milestone: "M2.3",
    blockedBy: "daemon-pre-pr-lint-gate",
    formula:
      'gh pr list --search "head:daemon/" --json statusCheckRollup --jq \'[.[] | select((.statusCheckRollup[] | select(.conclusion=="failure")) | not)] | length / length\' ⟨TBD-AFTER: daemon PRs are explicitly tagged in branch name⟩',
  },
  {
    id: "audit-log-completeness",
    label: "Fraction of daemon actions surfaced in the audit log",
    rationale:
      "M4.2 acceptance: every action Minsky takes (PR opened, file edited, shell command run) is logged with timestamp + actor + scope. Sample-and-verify against the experiment store; gap is the M4 blocker.",
    milestone: "M4.2",
    blockedBy: "audit-log-substrate-v0",
    formula: "node scripts/audit-log-coverage.mjs --window=7d ⟨TBD-AFTER: audit-log-substrate-v0⟩",
  },
  {
    id: "secret-scan-findings",
    label: "Secret-scan findings on `main` (should always be 0)",
    rationale:
      'vision.md § 13 minimum-bar item #1 ("No secrets in the repo, ever"). Currently enforced by `scripts/scan-secrets.mjs` pre-commit + CI gate, but the _count over time_ is not surfaced — making it impossible to detect leak attempts that were caught vs. patterns the lint missed.',
    milestone: "M1.13 (security & privacy bar)",
    blockedBy: "secret-scanning-precommit-and-ci",
    formula:
      "node scripts/scan-secrets.mjs --json --since=30d | jq '.findings | length' ⟨TBD-AFTER: secret-scanning-precommit-and-ci ships history retention⟩",
  },
];
