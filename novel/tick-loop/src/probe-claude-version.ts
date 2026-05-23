/**
 * Slice 2.5 of `native-agent-teams-with-tiered-adapter`: bounded probe
 * of `claude --version` so the daemon can resolve the `native-agent-teams`
 * tier instead of always falling back to `native-subagents`.
 *
 * Slice 2 wired {@link detectAgentTeamsSupport} into the startup log but
 * passed `claudeVersion: null` deliberately — synchronous I/O at boot is
 * a let-it-crash hazard, and the experimental agent-teams feature isn't
 * worth blocking the supervisor on. Slice 2.5 closes the gap with an
 * **async, bounded, fail-soft** probe: the daemon awaits up to
 * {@link DEFAULT_PROBE_TIMEOUT_MS} for `claude --version` to return, then
 * passes the result (or `null` on any failure) to the detector.
 *
 * Honesty boundary (rule #6 — let it crash at the right boundary):
 * **every failure path returns `null`**, not a thrown error. The
 * caller must treat `null` as "unknown / fall back to native-subagents".
 * The detector already handles `claudeVersion: null` as the safe default,
 * so a missing/slow/broken `claude` binary degrades to today's slice-2
 * behaviour without crashing the supervisor. No new CrashLoopBackOff
 * surface is introduced by this slice.
 *
 * Pattern conformance: pure-function-over-injected-input (rule #2) — the
 * `exec` adapter is the only I/O seam; tests inject fakes that return
 * canned stdout, throw, or hang past the timeout.
 */

/**
 * Default timeout for the `claude --version` probe. 2 seconds is long
 * enough for a healthy local binary (median ~150ms in practice) and
 * short enough that a frozen / network-mounted `claude` doesn't block
 * supervisor startup. Tunable per-call via {@link ProbeClaudeVersionInput.timeoutMs}.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000 as const;

/** Default binary name. POSIX-only; uppercase `CLAUDE` is not supported. */
export const DEFAULT_CLAUDE_BIN = "claude" as const;

/**
 * The exec adapter shape the probe needs: async, throws on non-zero
 * exit or timeout, otherwise returns `{ stdout }`. Matches the existing
 * `execFileLike` adapter in `bin/tick-loop.mjs` for easy wiring.
 */
export type VersionProbeExec = (
  cmd: string,
  args: readonly string[],
  opts: { readonly timeout: number },
) => Promise<{ readonly stdout: string }>;

export interface ProbeClaudeVersionInput {
  /** Async exec adapter. The probe calls `exec(claudeBin, ["--version"], { timeout })`. */
  readonly exec: VersionProbeExec;
  /** Binary name or absolute path. Defaults to {@link DEFAULT_CLAUDE_BIN}. */
  readonly claudeBin?: string;
  /** Timeout in milliseconds. Defaults to {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * Probe `claude --version` with a bounded timeout. Returns the trimmed
 * stdout on success, or `null` on any failure (missing binary, non-zero
 * exit, timeout, empty stdout, whitespace-only stdout).
 *
 * @otel-exempt outer caller (bin/tick-loop.mjs) wraps the whole startup
 * sequence in a `tick-loop.bootstrap` span; instrumenting the probe
 * itself would double-count.
 */
export async function probeClaudeVersion(input: ProbeClaudeVersionInput): Promise<string | null> {
  const claudeBin = input.claudeBin ?? DEFAULT_CLAUDE_BIN;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  try {
    const { stdout } = await input.exec(claudeBin, ["--version"], {
      timeout: timeoutMs,
    });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
    // rule-6: handled-locally — every exec failure (ENOENT, timeout, non-zero exit) degrades to null so the supervisor never crashes on a missing or slow `claude` binary. The detector already treats claudeVersion: null as the safe fallback.
  } catch {
    return null;
  }
}
