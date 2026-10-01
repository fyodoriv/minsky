<!-- rule-1: bin/minsky-run.sh single-host loop rejected because: it orchestrates one host repo per process and cannot run a per-host CTO audit + LLM task synthesis across multiple checkouts; this package adds the cross-repo host abstraction (host-root resolution, host-scoped CTO brief, pre-write rule-9 validation) that the bash runner cannot express. -->
<!-- scope: human-approved cto-audit-rule-9-field-quality — package README for the new cross-repo CTO-audit host runner; pre-registered in experiments/cto-audit-rule-9-field-quality.yaml -->

# cross-repo-runner

This package exists to host minsky's cross-repo orchestration layer — the
host-scoped CTO-audit runner that resolves a host root, builds a host CTO
brief, and validates proposed TASKS.md blocks against rule-9 *before* writing
them. It is the TypeScript home for logic that has bash/Python parity ports in
`bin/minsky-run.sh` and `scripts/build_cto_brief.py`.

## Modules

- `src/host-cto-audit.ts` — `writeProposedTask` (pre-write rule-9 validator +
  retry loop) and `validateProposedTask` (subprocess call to
  `scripts/check-rule-9-tasksmd-fields.mjs --input`).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every proposed task block written by
  `writeProposedTask` passes `scripts/check-rule-9-tasksmd-fields.mjs`; a
  block that fails validation is never written — it is retried up to
  `MAX_RETRIES` and, on persistent failure, recorded as an `audit-skip`
  in `.minsky/audit-log.jsonl`.
- **Blast radius**: a single audit proposal. `validateProposedTask` is a pure
  synchronous subprocess call with dependency injection in tests; a failure
  skips one write, never corrupting TASKS.md.
- **Operator escape hatch**: a persistently-rejected proposal is dropped (not
  written) and logged, so the daemon makes forward progress instead of
  blocking on one bad block.

| Failure mode | Effect | Chaos test |
| --- | --- | --- |
| LLM proposes a rule-9-incomplete block | validator rejects; `writeProposedTask` retries then logs `audit-skip` and skips the write | `novel/cross-repo-runner/src/host-cto-audit.test.ts` |
| Validator subprocess exits non-zero | proposal treated as invalid; retry/skip path exercised | `novel/cross-repo-runner/src/host-cto-audit.test.ts` |
