## What

The deterministic least-authority permission seam for the run-anywhere
conductor (`runany-permission-scoped-writes`), its wiring into the
conductor's **only** code-write site, and the pre-registered Measurement
instrument that reads its verdict ledger (Acceptance 1, 2, 4).

- `novel/cross-repo-runner/src/repo-policy.ts` (+ paired test, 16 cases)
  — pure rule-#10 `classifyRepo` + `assertWriteAllowed`. Identity is the
  normalized `origin` URL (scp / https / `.git` / trailing-slash forms
  compare equal) with a root-path fallback for origin-less local
  clones. **Fail-safe default** (Saltzer & Schroeder 1975): identity
  unprovable ⇒ `foreign`, the least-authority class. The write matrix is
  default-deny — only `home×{push,pr}` and `foreign×pr` (iff every diff
  path is `TASKS.md`) are allowed; every refusal carries a typed reason
  and a `logLine` for the audit trail.
- `novel/cross-repo-runner/src/policy-ledger.ts` (+ paired test, 9
  cases) — pure builders that turn one `assertWriteAllowed` decision
  into the exact `.minsky/runany-policy.jsonl` record
  `scripts/runany-policy-audit.mjs` consumes (`run-start` /
  `write-verdict`).
- `scripts/local-gate-merge.mjs` (+ test) — before the conductor's only
  code write (`gh pr merge --admin` onto `main` = a `push`-class write)
  it now classifies the merge target and `assertWriteAllowed`s it. A
  target that is not provably **home** (unresolvable origin → fail-safe
  `foreign`) or an unloadable gate module → the merge is **refused,
  logged, and the PR skipped** — no gate ⇒ no code write. Each non-dry
  sweep appends one `run-start` + one `write-verdict` per attempt.
- **`scripts/runany-policy-audit.mjs` (+ paired test, 28 cases)** — the
  pre-registered Measurement instrument (slice 3). Pure transforms
  (`parseLedger`, `sliceToRunWindow`, `classifyLedgerRecord`,
  `tallyMetrics`, `evaluate`, `formatReport`) over one injected
  ledger-read seam, same shape as `cto-audit-metrics.mjs`. Emits the
  exact JSON the task's Measurement line promises:
  `{foreign_code_pushes:0, foreign_prs_nontaskmd:0,
  minsky_self_tasks_filed:>=1, pass:true}`. `classifyLedgerRecord` is
  the cross-module contract; the fixtures mirror the exact
  `buildRunStartRecord`/`buildWriteVerdictRecord` shapes so a schema
  drift fails the test loudly instead of silently zeroing the metric.
- `docs/run-anywhere.md` — the home/foreign matrix, the ledger contract,
  and the pre-registered measurement command (this PR implements that
  command verbatim).

The minsky-self scout (Acceptance 3 — emits `minsky-self-task-filed`
records) is the next slice; per the global preparation-PR rule the
instrument lands first so that slice's PR can carry a real before/after
`minsky_self_tasks_filed` delta instead of a "measure later" promise.

## Why needed

Without a deterministic seam, a run-anywhere conductor that walks many
git repos under the operator's tree could push code to an unrelated
repo. Least authority (rule #13; Saltzer & Schroeder 1975) requires
code only ever land in the one repo the run was invoked for; every other
repo's sole permitted write is a `TASKS.md`-only scout PR. The gate is
pure (rule #10 — no model, no I/O) so the security-critical decision is
unit-testable in isolation. Slice 3 makes the gate's correctness
*observable*: without the audit, the ledger had no reader and the
pre-registered Measurement (Acceptance 4) was unrunnable.

## Optimization (this iteration)

Round-trip elimination (slice-2 conductor wiring): the home-repo
`origin` is memoized — `git remote get-url origin` was re-shelled inside
`prepareScratchClone` once per candidate PR; it now runs **once per
process** (N subprocess spawns per sweep → 1). Slice 3:
`optimization: none-this-iteration: new measurement-instrument; no
pre-existing gate/brief/log/round-trip to shrink (single-pass O(n) tally
is initial design, not an optimization of existing substrate).`

## Test plan

- `npx tsc -b novel/cross-repo-runner` → exit 0; `dist/repo-policy.js` +
  `dist/policy-ledger.js` emitted (the artifacts `local-gate-merge.mjs`
  dynamically imports).
- `npx vitest run repo-policy.test.ts policy-ledger.test.ts
  local-gate-merge.test.mjs scripts/runany-policy-audit.test.mjs` →
  **77 passed** (16 + 9 + 24 + 28). The acceptance grid (home-vs-foreign
  × push/pr/taskmd) and fail-safe deny cells are each covered; the audit
  counts both escape categories and stays `pass:false` until the scout
  slice lands.
- CLI smoke (clean fixture):
  `node scripts/runany-policy-audit.mjs --window=run --json` →
  `{"foreign_code_pushes":0,"foreign_prs_nontaskmd":0,"minsky_self_tasks_filed":1,"pass":true}`;
  missing ledger → `pass:false`, never throws.

## Security & privacy

This PR **is** the security surface: a cross-repo least-authority write
gate plus its tripwire (rule #13; vision.md § 13 reviewed).

- **Threat**: a run-anywhere conductor pushing code to a repo it cannot
  prove is the invoked home repo, or opening a non-`TASKS.md` PR against
  a foreign repo — and such an escape going unobserved.
- **Mitigation**: default-deny matrix with fail-safe classification —
  unprovable identity resolves to `foreign`, foreign code pushes are
  unconditionally refused, foreign PRs allowed only when every diff path
  is `TASKS.md`, and a gate-module load failure refuses **all** merges.
  The audit's `foreign_code_pushes` counter is the tripwire: an allowed
  foreign `push-code` (unreachable by construction) is counted and
  forces `pass:false` rather than being hidden; fail-safe
  parsing/windowing can only over-report an escape, never hide one. The
  ledger records no repo contents, credentials, or PII — only
  `{repoClass, action, allowed, taskmdOnly, code}` and a run id.

## Hypothesis self-grade

- **Predicted**: a pure `classifyRepo`+`assertWriteAllowed` seam wired into the conductor's only code-write site refuses 100% of foreign code pushes and all non-`TASKS.md` foreign PRs, and the slice-3 instrument makes that observable by emitting the exact documented Measurement JSON (`pass` honestly `false` until the scout slice lands).
- **Observed**: 77/77 tests pass; every deny cell (foreign-push, foreign-pr-no-diff, foreign-pr-non-taskmd, gate-module-unavailable) refuses; the audit CLI emits `{"foreign_code_pushes":0,"foreign_prs_nontaskmd":0,"minsky_self_tasks_filed":1,"pass":true}` on a clean fixture and `pass:false` on missing-ledger / seeded-escape fixtures.
- **Match**: yes
- **Lesson**: the gate's correctness is fully decided by the pure matrix and is now measurable end-to-end; the next slice only needs the minsky-self scout to emit `minsky-self-task-filed` records, with this command as its before/after instrument.
