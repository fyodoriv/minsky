// <!-- scope: human-approved daemon-self-config-analyzer (operator 2026-05-06) -->

/**
 * Daemon self-config analyzer (operator directive 2026-05-06).
 *
 * Pure decision function that inspects the daemon's runtime environment
 * (env vars, argv, launch context) and returns a list of configuration
 * recommendations for "running on self" — Minsky's first-class use case.
 *
 * Three classes of recommendation:
 *   - `enable` — a feature is wired but disabled by default; operator
 *     should set the env var (e.g. MINSKY_CHANGELOG_ENABLE=1).
 *   - `simplify` — a flag value matches the daemon's own default and
 *     could be dropped from the launch command.
 *   - `tune` — a tunable (tick interval, plan cap) deviates from the
 *     recommended value for self-dogfood.
 *
 * Per recommendation: `current` (what's set today), `recommended`
 * (what should be set), `rationale` (one-line why), `impact` category,
 * `estimatedTokenDelta` (negative = saves tokens, positive = spends more,
 * undefined = orthogonal to tokens).
 *
 * The daemon's I/O wrapper (bin/tick-loop.mjs) calls this at startup,
 * prints the recommendations as warnings, and (in the next slice)
 * auto-applies the safe ones unless `MINSKY_NO_AUTO_OPTIMIZE=1`.
 *
 * @otel-exempt pure analysis; the boot-time wrapper records the
 * `tick-loop.config.analyzed` span with the recommendation count.
 */

export type ConfigContext = {
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
  /**
   * Heuristic: is the daemon running on the Minsky repo itself?
   * Caller passes `true` when the daemon's CWD is the Minsky package
   * root (detectable via the package.json `name` field). Self-dogfood
   * mode unlocks the most aggressive defaults.
   */
  readonly isSelfDogfood: boolean;
  /**
   * Heuristic: is the process launched by launchd (legacy supervisor
   * mode) or directly (operator-launched via `pnpm minsky` or
   * `node bin/tick-loop.mjs`)? Affects which warnings are noisy.
   */
  readonly isLaunchd: boolean;
};

export type RecommendationKind = "enable" | "simplify" | "tune";
export type ImpactCategory = "tokens" | "speed" | "observability" | "safety" | "ergonomics";

export type ConfigRecommendation = {
  readonly kind: RecommendationKind;
  readonly setting: string;
  readonly current: string | undefined;
  readonly recommended: string;
  readonly rationale: string;
  readonly impact: ImpactCategory;
  readonly estimatedTokenDelta?: number;
};

/**
 * Run the analysis. Pure: same input → same output. The caller (boot-time
 * wrapper) feeds in `process.env`, `process.argv`, and the dogfood/launchd
 * flags; this function returns the recommendation list.
 *
 * @otel-exempt pure analysis function — input → output, no I/O. The
 *   caller (boot-time wrapper) is responsible for emitting any span that
 *   summarises the recommendation list at the I/O boundary.
 */
export function analyzeConfig(ctx: ConfigContext): readonly ConfigRecommendation[] {
  const recs: ConfigRecommendation[] = [];
  pushIfRecommended(recs, recommendCtoAudit(ctx));
  pushIfRecommended(recs, recommendChangelog(ctx));
  pushIfRecommended(recs, recommendSnapshot(ctx));
  pushIfRecommended(recs, recommendMetricsRender(ctx));
  pushIfRecommended(recs, recommendOtel(ctx));
  pushIfRecommended(recs, recommendNotifier(ctx));
  pushIfRecommended(recs, recommendTickInterval(ctx));
  pushIfRecommended(recs, recommendPausedSentinelSimplify(ctx));
  return recs;
}

function pushIfRecommended(
  out: ConfigRecommendation[],
  rec: ConfigRecommendation | undefined,
): void {
  if (rec !== undefined) out.push(rec);
}

function envBool(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

function recommendCtoAudit(ctx: ConfigContext): ConfigRecommendation | undefined {
  if (envBool(ctx.env, "MINSKY_CTO_AUDIT_ENABLE")) return undefined;
  if (!ctx.isSelfDogfood) return undefined;
  return {
    kind: "enable",
    setting: "MINSKY_CTO_AUDIT_ENABLE",
    current: ctx.env["MINSKY_CTO_AUDIT_ENABLE"],
    recommended: "1",
    rationale:
      "Self-dogfood: post-iteration CTO audit catches regressions the iteration itself missed. Cap-1-per-task contract bounds cost.",
    impact: "observability",
    estimatedTokenDelta: 1500,
  };
}

function recommendChangelog(ctx: ConfigContext): ConfigRecommendation | undefined {
  if (envBool(ctx.env, "MINSKY_CHANGELOG_ENABLE")) return undefined;
  if (!ctx.isSelfDogfood) return undefined;
  return {
    kind: "enable",
    setting: "MINSKY_CHANGELOG_ENABLE",
    current: ctx.env["MINSKY_CHANGELOG_ENABLE"],
    recommended: "1",
    rationale:
      "Self-dogfood: daily changelog is a first-class operator surface (CHANGELOG.md, METRICS.md). Single fire/day per UTC date keeps cost flat.",
    impact: "observability",
    estimatedTokenDelta: 800,
  };
}

function recommendSnapshot(ctx: ConfigContext): ConfigRecommendation | undefined {
  // Snapshot is gated by the SAME env var as changelog (MINSKY_CHANGELOG_ENABLE
  // umbrella). If changelog is off, snapshot is recommended together; if
  // changelog is already on, this is a no-op.
  if (envBool(ctx.env, "MINSKY_CHANGELOG_ENABLE")) return undefined;
  // Suppressed: the changelog rec already covers the umbrella. Only fires
  // separately if a future slice splits the env-var.
  return undefined;
}

function recommendMetricsRender(ctx: ConfigContext): ConfigRecommendation | undefined {
  // Same umbrella — covered by recommendChangelog.
  if (envBool(ctx.env, "MINSKY_CHANGELOG_ENABLE")) return undefined;
  return undefined;
}

function recommendOtel(ctx: ConfigContext): ConfigRecommendation | undefined {
  if (ctx.env["MINSKY_OTEL_ENDPOINT"] !== undefined && ctx.env["MINSKY_OTEL_ENDPOINT"] !== "") {
    return undefined;
  }
  // OTEL needs an endpoint; we recommend pointing it at a local OpenObserve
  // when the operator hasn't configured one. Tokens delta = 0 (telemetry
  // travels separately from claude API).
  return {
    kind: "tune",
    setting: "MINSKY_OTEL_ENDPOINT",
    current: ctx.env["MINSKY_OTEL_ENDPOINT"],
    recommended: "http://localhost:5081/api/default",
    rationale:
      "OTEL spans currently drop on the floor. Point at a local OpenObserve (default port 5081) to capture per-iteration metrics for the dashboard.",
    impact: "observability",
    estimatedTokenDelta: 0,
  };
}

function recommendNotifier(ctx: ConfigContext): ConfigRecommendation | undefined {
  if (ctx.env["MINSKY_NTFY_TOPIC"] !== undefined && ctx.env["MINSKY_NTFY_TOPIC"] !== "") {
    return undefined;
  }
  if (!ctx.isSelfDogfood) return undefined;
  return {
    kind: "enable",
    setting: "MINSKY_NTFY_TOPIC",
    current: ctx.env["MINSKY_NTFY_TOPIC"],
    recommended: "<your-ntfy-topic>",
    rationale:
      "budget-paused transitions are silent today. Set a ntfy topic to get push notifications when the daemon enters/exits budget-paused state.",
    impact: "observability",
    estimatedTokenDelta: 0,
  };
}

function recommendTickInterval(ctx: ConfigContext): ConfigRecommendation | undefined {
  // The daemon's default is 300_000 ms (5 min). Self-dogfood with two
  // workers can run faster (≥1 min) without thrashing the API since each
  // iteration's claude --print spawn dominates the wall-clock budget.
  // Recommend tightening if the operator passed a longer interval.
  const flag = findArgValue(ctx.argv, "--tick-interval-ms=");
  const ms = flag === undefined ? 300_000 : Number(flag);
  if (!ctx.isSelfDogfood) return undefined;
  if (Number.isInteger(ms) && ms >= 60_000 && ms <= 300_000) return undefined;
  if (!Number.isInteger(ms) || ms < 60_000) return undefined; // pathological — handled by validation
  return {
    kind: "tune",
    setting: "--tick-interval-ms",
    current: `${ms}`,
    recommended: "300000",
    rationale:
      "Self-dogfood: 5min is the documented prompt-cache TTL. Longer intervals miss cache reads; shorter intervals thrash the budget guard.",
    impact: "tokens",
    estimatedTokenDelta: 0,
  };
}

function recommendPausedSentinelSimplify(ctx: ConfigContext): ConfigRecommendation | undefined {
  const flag = findArgValue(ctx.argv, "--paused-sentinel=");
  if (flag === undefined) return undefined;
  // If the flag matches the new minsky-CLI per-worker default
  // (`/tmp/minsky-worker-<id>-never-paused`), it's redundant — the CLI
  // already sets it. Recommend dropping it from operator-facing
  // documentation.
  if (/^\/tmp\/minsky-worker-\d+-never-paused$/.test(flag)) {
    return {
      kind: "simplify",
      setting: "--paused-sentinel",
      current: flag,
      recommended: "(omit — minsky CLI sets this default)",
      rationale:
        "The new `pnpm minsky [<id>]` CLI auto-sets a private per-worker paused-sentinel. Passing it explicitly is redundant.",
      impact: "ergonomics",
    };
  }
  return undefined;
}

function findArgValue(argv: readonly string[], prefix: string): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

/**
 * Format a recommendation list as an operator-facing block (one
 * recommendation per line, with a leading marker the dashboard can
 * filter on).
 *
 * @otel-exempt pure formatter.
 */
export function formatRecommendations(recs: readonly ConfigRecommendation[]): string {
  if (recs.length === 0) {
    return "[config-analyzer] OK — no recommendations.";
  }
  const lines: string[] = [`[config-analyzer] ${recs.length} recommendation(s):`];
  for (const r of recs) {
    const tokenSuffix =
      r.estimatedTokenDelta !== undefined
        ? ` (~${r.estimatedTokenDelta > 0 ? "+" : ""}${r.estimatedTokenDelta} tokens/iter)`
        : "";
    lines.push(
      `[config-analyzer]   ${r.kind} ${r.setting}=${r.recommended}${tokenSuffix} — ${r.rationale}`,
    );
  }
  return lines.join("\n");
}
