/**
 * Slice 2 of `native-agent-teams-with-tiered-adapter`: render the
 * capability-tier decision as a single startup-log line.
 *
 * Slice 1 shipped {@link detectAgentTeamsSupport} but never called it from
 * the daemon, leaving the resolver as dead code. This slice connects the
 * resolver to the daemon's startup log so the chosen tier is observable
 * in `daemon.log` and `tick-loop.out.log` — the smallest possible step
 * from "tier detection exists" to "tier detection is operator-visible".
 *
 * Honesty boundary (slice 2): this module is **purely formatting**. It
 * does not select between backends, does not change daemon behaviour, and
 * does not gate any feature. The future selection-policy slice
 * (`bin/tick-loop.mjs` picks an `AgentTeamBackend` impl from the tier
 * enum) lands after at least one real backend implementation ships;
 * over-claiming intent here would violate rule #6 (fail at the right
 * boundary).
 *
 * Pattern conformance: pure-function-over-injected-input (rule #2). No
 * I/O — the bin reads `MINSKY_CLOUD_AGENT`, `process.env`, and (in a
 * later slice) `claude --version` output, then passes them in.
 */

import type { DetectAgentTeamsResult } from "./detect-agent-teams-support.js";

/**
 * The stable log prefix every formatted line shares. Pinned because the
 * Splunk / log-grep dashboards in `daemon-log-aggregation` will key on
 * this exact substring once the tier becomes a metric (rule #10 —
 * deterministic enforcement, not free-form prose).
 */
export const TIER_LOG_PREFIX = "tick-loop: agent-team-tier=" as const;

/**
 * Format a single tier decision as a startup-log line.
 *
 * Shape: `tick-loop: agent-team-tier=<tier> reasons="<r1> | <r2> | …"`
 *
 * The reasons array from {@link DetectAgentTeamsResult} is joined with
 * ` | ` so the whole line is greppable as a single record. Empty reason
 * arrays are tolerated and render as an empty quoted string — the tier
 * itself is always present.
 *
 * @otel-exempt pure string formatter; observability is the LOG it emits, not a span around it
 *
 * @example
 *   formatTierLogLine({ tier: "process-fan-out", reasons: ["agent=devin is not Claude Code → non-native fan-out"] })
 *   // => 'tick-loop: agent-team-tier=process-fan-out reasons="agent=devin is not Claude Code → non-native fan-out"'
 */
export function formatTierLogLine(decision: DetectAgentTeamsResult): string {
  const reasons = decision.reasons.join(" | ");
  return `${TIER_LOG_PREFIX}${decision.tier} reasons="${reasons}"`;
}
