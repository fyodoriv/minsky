// <!-- scope: human-approved minsky-cli-arch-detection slice 6 (operator 2026-05-08 — "rosetta/intel must be resolved as well, do it now so that this tool can auto fix it") -->
// <!-- scope: human-approved minsky-cli-arch-detection-hardening slice 7 (operator 2026-05-08 — preferredPythonPath for arch-consistent aider install) -->
// <!-- scope: human-approved minsky-cli-arch-detection slice 10 (operator 2026-05-08 — MINSKY_FORCE_HARDWARE_ARCH override for buggy/renamed sysctl) -->
/**
 * `@minsky/tick-loop/arch-probe` — pure architecture detection for the
 * local-LLM bootstrap. Slice 6 of P0 task `minsky-cli-arch-detection`
 * (composes with `minsky-cli-auto-bootstrap-local-llm`).
 *
 * Four injected probes + one pure aggregator (`detectArchState`) + three
 * derived pure helpers (`preferredBrewPath`, `preferredPipxPath`,
 * `needsArmHomebrewInstall`, `describeArchState`). All I/O lives in the
 * injected probe seams; `detectArchState` itself is pure over the record
 * shape per rule #2 (every dependency behind an interface).
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Chain of Responsibility** — Gamma, Helm, Johnson & Vlissides,
 *     *Design Patterns*, Addison-Wesley 1994, Ch. 5. The brew-path
 *     resolver walks native → intel → eventual-native in a fixed order;
 *     the first present link answers. Conformance: full.
 *   - **Fail-safe defaults** — Saltzer & Schroeder, "The Protection of
 *     Information in Computer Systems", *Proceedings of the IEEE* 63 (9),
 *     1975. When `probeHardwareArch` rejects or returns "other", the
 *     planner defaults to the slice-5 behavior (no arm-homebrew install,
 *     no absolute paths) instead of guessing wrong. Conformance: full.
 *   - **Adapter** — Wirfs-Brock & McKean, *Object Design*, 2003. Each
 *     probe is a thin wrapper over `child_process` / `node:fs` /
 *     `process.arch`; business logic in `detectArchState` never
 *     imports those directly. Conformance: full.
 *
 * Failure modes & chaos verification (rule #7 / vision.md § 7).
 *
 * Steady-state hypothesis: `detectArchState` returns an `ArchState`
 * record for every legitimate input, never mutates host state, and
 * completes in ≤2 s wall-clock (dominated by the sysctl shell-out).
 * Blast radius: a single bootstrap attempt's arch check. Operator escape
 * hatch: `MINSKY_NO_AUTO_BOOTSTRAP=1` disables the pre-flight entirely;
 * `MINSKY_ARCH_PROBE=skip` (future) would skip just this module;
 * `MINSKY_FORCE_HARDWARE_ARCH=arm64|x86_64` (slice 10) keeps the
 * planner's arch awareness but bypasses the sysctl shell-out — useful
 * on a future macOS where `hw.optional.arm64` is renamed and minsky
 * isn't patched yet, or on a host where sysctl is broken / sandboxed.
 * `parseForcedHardwareArch(env)` is the pure helper; the production
 * `buildArchProbes` in `bin/minsky.mjs` swaps the hardware probe for
 * one that returns the forced value (~200 ms saved per cold start).
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Hardware probe rejects | `sysctl` absent on PATH | loud-crash per Armstrong — rejection bubbles up to supervisor (`bin/minsky.mjs`); operator sees "sysctl failed" verbatim | `arch-probe.test.ts` "bubbles up probeHardwareArch rejections" |
 * | 2 | Shell arch unrecognised | `process.arch` returns a future value | graceful-degrade — typed as "other"; planner reverts to slice-5 behavior (no arm-homebrew step) | "Linux host" equivalence-class case |
 * | 3 | Both brew paths present | Intel Mac migrated to Apple Silicon with dual brew | graceful-degrade — prefer native (`/opt/homebrew/`); planner uses native absolute path | "both brew paths present" test |
 * | 4 | Neither brew path present + arm64 hw | Fresh Apple Silicon machine | graceful-degrade — `needsNativeBrew: true`; planner prepends install-arm-homebrew | "case 4: Apple Silicon native shell + NO brew" test |
 * | 5 | Both shell=arm64 AND hardware=arm64 AND no brew | Genuine fresh M-series | `mismatch: false, needsNativeBrew: true`; same as #4 | same test |
 *
 * @module tick-loop/arch-probe
 */

// ---- Types ----------------------------------------------------------------

/**
 * Process-level architecture as reported by the Node interpreter. Maps
 * `process.arch` ("arm64", "x64", "ia32", …) to a closed three-way set
 * for planner branching. `"other"` covers architectures neither macOS
 * nor the operator's laptops will ever hit (e.g., `ppc64` on a Power
 * server, `riscv64` on future boards).
 */
export type ShellArch = "arm64" | "x86_64" | "other";

/**
 * Physical-hardware architecture as determined by the injected probe.
 * On macOS, `sysctl -n hw.optional.arm64` → "1" means Apple Silicon
 * (even under Rosetta); "0" means Intel. On Linux / Windows / WSL, the
 * probe returns `"other"` because MLX is Apple-Silicon-specific and
 * the planner has no productive path for those hosts.
 */
export type HardwareArch = "arm64" | "x86_64" | "other";

/**
 * Aggregate state the planner consumes. Built by `detectArchState`.
 *
 * `mismatch` is `true` when the shell is running under a different
 * architecture than the hardware — specifically the Rosetta-on-Apple-
 * Silicon case. It's informational (the planner uses absolute paths
 * that are arch-transparent) but surfaces in `describeArchState` so the
 * operator knows why a warning row appeared.
 *
 * `needsNativeBrew` is the planner's load-bearing field: when `true`,
 * `planLocalLlmBootstrap` prepends the `install-arm-homebrew` step.
 * It's `true` iff the hardware is Apple Silicon AND no `/opt/homebrew/`
 * is present. On Intel hardware it's always `false` even with no brew
 * (slice-1's `brew install pipx` still works via any `brew` on PATH).
 */
export interface ArchState {
  readonly shellArch: ShellArch;
  readonly hardwareArch: HardwareArch;
  /** Absolute path to `/opt/homebrew/bin/brew`, or `undefined` if absent. */
  readonly nativeBrewPath: string | undefined;
  /** Absolute path to `/usr/local/bin/brew`, or `undefined` if absent. */
  readonly intelBrewPath: string | undefined;
  /** `true` iff shellArch !== hardwareArch (Rosetta-on-Apple-Silicon). */
  readonly mismatch: boolean;
  /**
   * Load-bearing planner field. `true` iff `hardwareArch === "arm64"`
   * AND `nativeBrewPath === undefined`. The planner prepends
   * `install-arm-homebrew` when this is `true`.
   */
  readonly needsNativeBrew: boolean;
}

// ---- Env hatch — MINSKY_FORCE_HARDWARE_ARCH (slice 10) -------------------

/**
 * Slice 10 — operator escape hatch for the hardware-arch probe.
 *
 * When set to `"arm64"` or `"x86_64"`, the production `buildArchProbes`
 * in `bin/minsky.mjs` swaps `probeHardwareArch` for one that returns
 * the forced value, bypassing the ~200 ms `sysctl -n hw.optional.arm64`
 * shell-out. The rest of the planner's arch awareness (shell-arch,
 * brew paths, `needsNativeBrew`, install-arm-homebrew step) keeps
 * working as if the probe had returned that value naturally.
 *
 * Use cases — distinct from slice 9's `MINSKY_ARCH_PROBE=skip` (which
 * disables the arch awareness entirely and falls back to slice-5
 * bare-name commands):
 *   1. Future macOS where `sysctl -n hw.optional.arm64` is renamed —
 *      operator forces `arm64` to keep the arm-brew install plan
 *      working until minsky is patched.
 *   2. Operator on a host where sysctl is broken, sandboxed, or
 *      otherwise misbehaves — they know the hardware truth and want
 *      the planner to act on it.
 *   3. CI / dogfood loops on known-good hardware where the operator
 *      wants the probe-derived plan but not the shell-out cost.
 *
 * Strict-equality on `"arm64"` and `"x86_64"` — symmetric with slice 8's
 * `bootstrapTtyGate` `=1` and the future slice 9's `MINSKY_ARCH_PROBE=skip`
 * strict-equality choice. Other spellings (`=Arm64`, `=ARM64`, `=arm`,
 * `=apple-silicon`, `=intel`, leading/trailing whitespace) are rejected
 * so a future widening is a deliberate change with a test update. The
 * operator-facing env-var name uses the canonical `arm64` / `x86_64`
 * tokens already documented in this module's `HardwareArch` type and
 * in the doctor row's output, so there's exactly one spelling to learn.
 *
 * Returns `undefined` for the unset / empty / invalid case so the caller
 * can treat both "env not set" and "env set to garbage" identically:
 * fall through to the live sysctl probe. (We deliberately do NOT type
 * a discriminated union or throw on garbage — silent fall-through is
 * the safer choice when the operator's env may be inherited from
 * another tool's namespace by accident; a thrown error would gate
 * the entire bootstrap on a typo unrelated to local-LLM.)
 *
 * Pure function; same input → same output. Pattern conformance:
 * Pre-condition gate per Meyer 1992 (Eiffel-style `require`); env-var
 * shape mirrors the existing `MINSKY_NO_AUTO_BOOTSTRAP=1` /
 * `MINSKY_NON_INTERACTIVE=1` / `MINSKY_ASSUME_TTY=1` family. Composes
 * orthogonally with `MINSKY_ARCH_PROBE=skip` (slice 9): when both are
 * set, `=skip` wins because the caller checks it first — the planner
 * gets no archState at all, force is moot.
 *
 * @otel-exempt pure predicate — no span.
 */
export function parseForcedHardwareArch(env: string | undefined): HardwareArch | undefined {
  if (env === "arm64") return "arm64";
  if (env === "x86_64") return "x86_64";
  return undefined;
}

// ---- Probes ---------------------------------------------------------------

/**
 * The probe seam `detectArchState` depends on. Each probe is bounded-time
 * (≤500 ms in production); test doubles inject synthetic shapes. All
 * four are pure-over-injection at the interface layer; production
 * implementations live in `bin/minsky.mjs` next to the `DetectProbes`
 * wiring.
 */
export interface ArchProbes {
  /** Node's `process.arch` mapped to the closed set. Sync — `process.arch` is a property read. */
  readonly probeShellArch: () => ShellArch;
  /**
   * `sysctl -n hw.optional.arm64` with 500 ms timeout. Returns "arm64"
   * iff exit 0 AND stdout trimmed is "1"; "x86_64" iff exit 0 AND
   * stdout is "0"; "other" otherwise (sysctl absent, non-darwin, etc.).
   * Rejections bubble up as loud-crash per chaos row #1.
   */
  readonly probeHardwareArch: () => Promise<HardwareArch>;
  /** `existsSync("/opt/homebrew/bin/brew")` → path or undefined. */
  readonly probeNativeBrewPath: () => string | undefined;
  /** `existsSync("/usr/local/bin/brew")` → path or undefined. */
  readonly probeIntelBrewPath: () => string | undefined;
}

// ---- detectArchState ------------------------------------------------------

/**
 * Build the aggregate {@link ArchState} from the four injected probes.
 * Pure decision function: runs the three sync probes inline and awaits
 * the one async probe via `Promise.resolve` so the `Promise.all` shape
 * is preserved for future probes that need to shell out.
 *
 * Steady-state: every legitimate `ArchProbes` input produces a fully-
 * populated `ArchState`. Probe rejections bubble up (chaos row #1).
 *
 * @otel tick-loop.arch-probe.detect
 */
export async function detectArchState(probes: ArchProbes): Promise<ArchState> {
  const [shellArch, hardwareArch, nativeBrewPath, intelBrewPath] = await Promise.all([
    Promise.resolve(probes.probeShellArch()),
    probes.probeHardwareArch(),
    Promise.resolve(probes.probeNativeBrewPath()),
    Promise.resolve(probes.probeIntelBrewPath()),
  ]);
  const mismatch = shellArch !== hardwareArch && hardwareArch !== "other";
  const needsNativeBrew = hardwareArch === "arm64" && nativeBrewPath === undefined;
  return {
    shellArch,
    hardwareArch,
    nativeBrewPath,
    intelBrewPath,
    mismatch,
    needsNativeBrew,
  };
}

// ---- Derived helpers ------------------------------------------------------

/**
 * Boolean projection used by `planLocalLlmBootstrap` to decide whether
 * to prepend the `install-arm-homebrew` step. Thin wrapper over
 * `state.needsNativeBrew` — exists as a named export so a future
 * policy change (e.g., also install when Intel-brew is stale) lives in
 * exactly one place.
 *
 * @otel-exempt pure projection — no span.
 */
export function needsArmHomebrewInstall(state: ArchState): boolean {
  return state.needsNativeBrew;
}

/**
 * Pick the absolute-path `brew` the planner should use in subsequent
 * step commands. Chain of Responsibility per module JSDoc: native arm
 * → intel → eventual native (post-install) → undefined (Linux).
 *
 * Returns the eventual `/opt/homebrew/bin/brew` path even when the
 * native brew isn't installed yet, as long as `hardwareArch === "arm64"`
 * — by the time the planner's subsequent steps run, `install-arm-
 * homebrew` has already landed that path.
 *
 * Returns `undefined` on Linux / unknown hosts so the planner falls
 * back to the slice-1 behavior (bare `brew` on PATH, which won't exist
 * on Linux anyway — the planner's Linux handling is a pivot-threshold
 * item for a future slice).
 *
 * @otel-exempt pure selector — no span.
 */
export function preferredBrewPath(state: ArchState): string | undefined {
  if (state.nativeBrewPath !== undefined) return state.nativeBrewPath;
  if (state.hardwareArch === "arm64") return "/opt/homebrew/bin/brew";
  if (state.intelBrewPath !== undefined) return state.intelBrewPath;
  if (state.hardwareArch === "x86_64") return "/usr/local/bin/brew";
  return undefined;
}

/**
 * Derive the matching `pipx` absolute path from the chosen brew path.
 * `brew install pipx` always lands the binary adjacent to `brew` (both
 * in the Cellar's linked `bin/` dir), so the mapping is deterministic.
 *
 * @otel-exempt pure mapping — no span.
 */
export function preferredPipxPath(state: ArchState): string | undefined {
  const brewPath = preferredBrewPath(state);
  if (brewPath === undefined) return undefined;
  // Swap the trailing `brew` → `pipx`. Works for both `/opt/homebrew/bin/brew`
  // and `/usr/local/bin/brew` and any future prefix.
  return brewPath.replace(/\/brew$/, "/pipx");
}

/**
 * Canonical post-install python path for aider on Apple Silicon hosts.
 * Slice 7 H1 — the aider install step previously used whatever
 * slice-5's `PYTHON_CANDIDATES` scan picked first (often
 * `/usr/local/bin/python3.13` on dual-brew machines), which works via
 * universal-binary dispatch but mixes Intel + Apple Silicon layouts.
 *
 * Returns `/opt/homebrew/bin/python3.13` iff the host is Apple Silicon
 * AND native brew is or will be present by the time the aider step
 * runs (either `nativeBrewPath` already set, or `needsNativeBrew`
 * signaling that install-arm-homebrew is scheduled first). `brew
 * install pipx` depends on `python@3.13` so the formula chain
 * guarantees the path will exist — see `install-pipx` step in
 * `planLocalLlmBootstrap`.
 *
 * Returns `undefined` on Intel / Linux / unknown hosts so the planner
 * falls through to slice-5's `pythonPath` (from `probePythonWithDefaults`).
 *
 * @otel-exempt pure selector — no span.
 */
export function preferredPythonPath(state: ArchState): string | undefined {
  if (state.hardwareArch !== "arm64") return undefined;
  // Native brew is or will be present → brew pipx brings python@3.13.
  if (state.needsNativeBrew || state.nativeBrewPath !== undefined) {
    return "/opt/homebrew/bin/python3.13";
  }
  // arm64 hardware without brew AND without the install plan — defensive
  // fallthrough (the planner never produces this state in practice).
  return undefined;
}

/**
 * Render the arch state as a single operator-facing line for the
 * `minsky doctor` output. Format matches the existing doctor rows:
 * short, actionable, no emojis. The caller (`bin/minsky.mjs`) prepends
 * `✓` or `✗` based on `needsNativeBrew` so the operator's eye scans to
 * the failure in one pass.
 *
 * @otel-exempt pure formatter — no span.
 */
export function describeArchState(state: ArchState): string {
  const shell = state.shellArch;
  const hw = state.hardwareArch;
  if (state.needsNativeBrew) {
    // The operator's specific bug — Apple Silicon hardware but no
    // `/opt/homebrew/`, regardless of shell arch.
    return `${shell} shell on Apple Silicon (M-series) hardware — need native ARM Homebrew at /opt/homebrew/`;
  }
  if (state.mismatch) {
    // Brew is there but we're in Rosetta. Informational, not an error
    // (absolute paths sidestep the arch mismatch).
    return `${shell} shell on Apple Silicon (M-series) hardware — native brew at ${state.nativeBrewPath ?? "/opt/homebrew/"} (OK, using absolute paths)`;
  }
  if (hw === "arm64") {
    return `arm64 shell on Apple Silicon hardware — native brew at ${state.nativeBrewPath ?? "/opt/homebrew/bin/brew"}`;
  }
  if (hw === "x86_64") {
    return `${shell} shell on Intel hardware — brew at ${state.intelBrewPath ?? "/usr/local/bin/brew"}`;
  }
  return `${shell} shell on non-Darwin host (Linux or other) — local-LLM bootstrap requires Apple Silicon`;
}
