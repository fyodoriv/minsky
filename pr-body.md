## What

The deterministic least-authority permission seam for the run-anywhere
conductor (`runany-permission-scoped-writes` Acceptance 1 + 2), plus its
wiring into the conductor's **only** code-write site.

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
  `write-verdict`). The test pins the audit's escape predicate
  verbatim, so a wire-format drift fails the build instead of silently
  zeroing the metric.
- `scripts/local-gate-merge.mjs` (+ test) — before the conductor's only
  code write (`gh pr merge --admin` onto `main` = a `push`-class write)
  it now classifies the merge target and `assertWriteAllowed`s it. A
  target that is not provably **home** (unresolvable origin → fail-safe
  `foreign`) or an unloadable gate module → the merge is **refused,
  logged, and the PR skipped** — no gate ⇒ no code write. Each non-dry
  sweep appends one `run-start` + one `write-verdict` per attempt.
- `docs/run-anywhere.md` — the home/foreign matrix, the ledger contract,
  and the pre-registered measurement command.

This is the substantive gate code; the measurement script
(`scripts/runany-policy-audit.mjs`) and the minsky-self scout are
complementary later slices (the audit script is a separate preparation
PR).

## Why needed

Without a deterministic seam, a run-anywhere conductor that walks many
git repos under the operator's tree could push code to an unrelated
repo. Least authority (rule #13; Saltzer & Schroeder 1975) requires
code only ever land in the one repo the run was invoked for; every other
repo's sole permitted write is a `TASKS.md`-only scout PR. The gate is
pure (rule #10 — no model, no I/O) so the security-critical decision is
unit-testable in isolation and identical for identical inputs.

## Optimization (this iteration)

Round-trip elimination (bundled in the conductor wiring): the home-repo
`origin` is now memoized — `git remote get-url origin` was re-shelled
inside `prepareScratchClone` once per candidate PR; it now runs **once
per process** (N subprocess spawns per sweep → 1). Far above the
≥10-byte floor (eliminates N−1 process spawns per sweep).

## Test plan

- `npx tsc -b novel/cross-repo-runner` → exit 0; `dist/repo-policy.js` +
  `dist/policy-ledger.js` emitted (the artifacts `local-gate-merge.mjs`
  dynamically imports).
- `npx vitest run repo-policy.test.ts policy-ledger.test.ts
  local-gate-merge.test.mjs` → **49 passed** (16 + 9 + 24). The
  acceptance grid (home-vs-foreign × push/pr/taskmd) and the fail-safe
  deny cells are each covered; the gate-module-unavailable path refuses
  all merges.

## Security & privacy

This PR **is** the security surface: a cross-repo least-authority write
gate (rule #13; vision.md § 13 reviewed).

- **Threat**: a run-anywhere conductor pushing code to a repo it cannot
  prove is the invoked home repo, or opening a non-`TASKS.md` PR against
  a foreign repo.
- **Mitigation**: default-deny matrix with fail-safe classification —
  unprovable identity resolves to `foreign` (least authority), foreign
  code pushes are unconditionally refused, foreign PRs are allowed only
  when every diff path is `TASKS.md`, and a failure to load the gate
  module refuses **all** merges rather than merging ungated. Every
  verdict (allow and refuse) is appended to `.minsky/runany-policy.jsonl`
  for the pre-registered audit. The ledger records no repo contents,
  credentials, or PII — only `{repoClass, action, allowed, taskmdOnly,
  code}` and a run id.

## Hypothesis self-grade

- **Predicted**: a pure `classifyRepo` + `assertWriteAllowed` seam wired
  into the conductor's only code-write site refuses 100% of foreign code
  pushes and all non-`TASKS.md` foreign PRs, fail-safe by construction.
- **Observed**: 49/49 tests pass; every deny cell (foreign-push,
  foreign-pr-no-diff, foreign-pr-non-taskmd, gate-module-unavailable) is
  exercised and refuses; home cells allow full flow.
- **Match**: yes
- **Lesson**: the gate's correctness is fully decided by the pure
  matrix; the next slice only needs the audit script to *count*
  verdicts, not re-litigate the decision.
