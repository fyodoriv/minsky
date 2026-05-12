// Ignore-write decision — pure orchestration of the "append .minsky/ to the
// operator's global git ignore, fall back to per-clone .git/info/exclude on
// EACCES" boundary. Decision A2's fallback (decided 2026-05-04 — see
// docs/cross-repo-portability.md) is the v1 deferral chaos row 5 of
// `novel/sidecar-bootstrap/README.md` calls out.
//
// Pattern: pure-decision + injected I/O (Martin 2017 — I/O at the edge; the
//   bin CLI passes a `write` closure that does the real `writeFileSync`,
//   tests inject a fake that returns canned `EACCES` / `ok`). Source:
//   TASKS.md `cross-repo-runner-v1-live-spawn` (d); rule #7 (chaos row 5);
//   docs/cross-repo-portability.md § "A2 sidecar location"; rule #2 (every
//   dep behind an interface — `writeFn` is the seam).
// Conformance: full — `decideIgnoreAppend` is pure over typed inputs.

/**
 * Result codes the injected `writeFn` returns. `ok` = wrote successfully;
 * `eacces` = permission denied (the trigger for fallback); `other` = some
 * other error (caller's job to surface, no fallback heuristic applies).
 */
export type WriteVerdict = "ok" | "eacces" | "other";

/**
 * Inputs to {@link decideIgnoreAppend}. The two paths + a single closure
 * that does the actual write. The closure returns a verdict; the decision
 * function walks the fallback ladder.
 */
export interface IgnoreAppendInputs {
  /** The global git ignore file path (e.g. `~/.config/git/ignore`). */
  readonly globalIgnoreFile: string;
  /** The per-clone exclude file path (e.g. `<host>/.git/info/exclude`). */
  readonly perCloneExcludeFile: string;
  /** The entry to append (typically `.minsky/`). */
  readonly entry: string;
  /**
   * Injected writer. Returns `"ok"` on success; `"eacces"` when the target
   * is read-only or unwritable (triggers the fallback); `"other"` for any
   * other error (decision returns `error`, caller surfaces).
   */
  readonly writeFn: (path: string, payload: string) => WriteVerdict;
  /**
   * Optional probe — `true` when the entry already lives in the target
   * (idempotency check). Skipped by default (the bin pre-filters via
   * `existing.globalIgnoreEntry`); tests inject true when they want to
   * assert the skip path.
   */
  readonly alreadyContainsEntry?: (path: string) => boolean;
}

/**
 * Outcome verdicts {@link decideIgnoreAppend} can return.
 *
 *   - `wrote-global`     — happy path; global git ignore accepted the append.
 *   - `wrote-per-clone`  — EACCES on global; per-clone exclude succeeded
 *                         (the chaos row 5 graceful-degrade path).
 *   - `skipped-already`  — both targets already contain the entry; no-op.
 *   - `error`            — both writes returned `other`; caller surfaces.
 */
export type IgnoreAppendVerdict =
  | { kind: "wrote-global"; path: string }
  | { kind: "wrote-per-clone"; path: string; reason: "global-readonly" }
  | { kind: "skipped-already"; path: string }
  | { kind: "error"; tried: readonly { path: string; verdict: WriteVerdict }[] };

/**
 * Render the payload appended to the chosen file. Same shape regardless of
 * which path wins — the operator can grep `# minsky sidecar` to find the
 * line in either file.
 *
 * @otel-exempt pure string-rendering helper; no I/O.
 */
export function renderIgnorePayload(entry: string): string {
  return `\n# minsky sidecar (auto-added by minsky-bootstrap)\n${entry}\n`;
}

/**
 * Walk the fallback ladder: try the global git ignore first; on EACCES,
 * try the per-clone exclude. Returns a structured verdict the bin walks
 * to render operator-facing output.
 *
 * Idempotency: when `alreadyContainsEntry` is provided AND returns true on
 * EITHER target, the decision returns `skipped-already` without invoking
 * `writeFn`. The bin pre-filters via `existing.globalIgnoreEntry`, so
 * production typically reaches `writeFn` directly; tests inject the probe
 * to exercise the skip path.
 *
 * @otel sidecar-bootstrap.decide-ignore-append
 */
export function decideIgnoreAppend(inputs: IgnoreAppendInputs): IgnoreAppendVerdict {
  if (inputs.alreadyContainsEntry?.(inputs.globalIgnoreFile)) {
    return { kind: "skipped-already", path: inputs.globalIgnoreFile };
  }
  if (inputs.alreadyContainsEntry?.(inputs.perCloneExcludeFile)) {
    return { kind: "skipped-already", path: inputs.perCloneExcludeFile };
  }
  const payload = renderIgnorePayload(inputs.entry);
  const globalVerdict = inputs.writeFn(inputs.globalIgnoreFile, payload);
  if (globalVerdict === "ok") {
    return { kind: "wrote-global", path: inputs.globalIgnoreFile };
  }
  if (globalVerdict !== "eacces") {
    return {
      kind: "error",
      tried: [{ path: inputs.globalIgnoreFile, verdict: globalVerdict }],
    };
  }
  const cloneVerdict = inputs.writeFn(inputs.perCloneExcludeFile, payload);
  if (cloneVerdict === "ok") {
    return {
      kind: "wrote-per-clone",
      path: inputs.perCloneExcludeFile,
      reason: "global-readonly",
    };
  }
  return {
    kind: "error",
    tried: [
      { path: inputs.globalIgnoreFile, verdict: globalVerdict },
      { path: inputs.perCloneExcludeFile, verdict: cloneVerdict },
    ],
  };
}

/**
 * Translate a Node `fs.writeFileSync` error (or success) into the verdict
 * shape `decideIgnoreAppend` expects. Production passes this as the inner
 * implementation; tests inject a fake directly.
 *
 * @otel-exempt pure error-code mapper.
 */
export function classifyWriteError(err: unknown): WriteVerdict {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "eacces";
  return "other";
}
