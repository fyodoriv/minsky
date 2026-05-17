## What

Wires slice 1's pure gate into the conductor's **only** code-write site
(`runany-permission-scoped-writes` Acceptance 2) and ships the ledger
substrate the pre-registered measurement reads.

- `novel/cross-repo-runner/src/policy-ledger.ts` (+ paired test) — pure
  rule-#10 builders that turn an `assertWriteAllowed` decision into the
  exact `.minsky/runany-policy.jsonl` record `scripts/runany-policy
  -audit.mjs` consumes (`run-start` / `write-verdict`). The test pins
  the audit's escape predicate verbatim, so a wire-format drift fails
  the build instead of silently zeroing the metric.
- `scripts/local-gate-merge.mjs` — before the conductor's only code
  write (`gh pr merge --admin` onto `main` = a `push`-class write) it
  now classifies the merge target and `assertWriteAllowed`s it. A
  target that is not provably **home** (unresolvable origin → fail-safe
  `foreign`) or an unloadable gate module → the merge is **refused,
  logged, and the PR skipped** — no gate ⇒ no code write. Each non-dry
  sweep appends one `run-start` + one `write-verdict` per attempt.
- `docs/run-anywhere.md` — the home/foreign matrix, the ledger contract,
  and the pre-registered measurement command in one place.

## Why needed

Slice 1 shipped a pure gate that nothing called; the sibling
instrumentation PR (#602) shipped an audit that reads a ledger nothing
emitted. This is the missing seam between them: the canonical gate is
now enforced at the conductor's write boundary and the verdict ledger is
populated, so the pre-registered Measurement can carry a real number
instead of a promise to "instrument later" (preparation-PR discipline).

## Scope this iteration

Acceptance (2): a foreign/unprovable merge target is refused, logged,
and its verdict emitted; a home target gets the full flow plus an
allowed verdict. Acceptance (3) (minsky-self scout) and the end-to-end
fixture audit (which needs #602's reader merged) are deliberately out
of scope and called out below.

## Test

- `npx vitest run novel/cross-repo-runner/src/policy-ledger.test.ts` →
  9/9. Grid: home/foreign × push/pr × allowed/refused, each cross-checked
  against the audit's escape predicate; a hypothetical regression
  (allowed foreign push) is asserted to be *scored*, not hidden.
- `npx vitest run scripts/local-gate-merge.test.mjs` → 24/24, incl. two
  new cells: home origin → merge proceeds + run-start + allowed
  `push-code` verdict; unprovable origin → `foreign` → merge refused,
  `mergeFn` never called, refused verdict emitted. Existing sweep tests
  made hermetic (injected `homeOriginFn`/`runanyEmit` — no real `.minsky`
  writes, no `git` subprocess during units).

End-to-end `node scripts/runany-policy-audit.mjs --window=run --json`
numbers land when #602's reader merges; this PR makes the ledger real.

## Security & privacy

This PR *is* a security surface — the cross-repo least-authority wiring
(vision.md § 13).

- **Threat**: the conductor merges/pushes code into a repo it merely
  walked into and cannot prove is home.
- **Mitigation**: the gate runs before the sole `gh pr merge` write;
  fail-safe **refuse** on unprovable origin OR an unloadable gate
  module (no gate ⇒ no code write); one typed verdict logged per
  attempt (rule #7). The gate is the slice-1 pure unit-tested module —
  not bypassable by prompt drift. Ledger append is best-effort (rule
  #6) and never gates the sweep.
- No new secrets, PII, or network surface; classification reads only a
  `git remote` URL string already used by the sweep.

## optimization

Round-trip elimination: `git remote get-url origin` was re-shelled
inside `prepareScratchClone` once per candidate PR; it is now memoized
process-stable (`homeRemoteOrigin`) and reused for both the scratch
remote repoint and the gate's classification input — a sweep of N
candidates shells it once, not N times (N−1 subprocess round-trips
eliminated per sweep; single source of truth for the home origin).

## Scout

Pre-existing (not introduced here): the non-dry `runGateSweep` unit
tests already append to the live repo's `.minsky/local-gate-merge.jsonl`
via the best-effort `appendLedger` default. This PR makes the new sweep
tests hermetic via injected seams, but `appendLedger` itself still has
no injected sink — a latent test-hygiene smell in the existing default
path. Surfaced here per scout-and-record; not fixed (out of this slice's
surgical scope; the daemon iteration guard forbids unrelated TASKS.md
appends).

Whole-tree-biome unblock: `novel/cross-repo-runner/bin/minsky-run.mjs`
was stale vs `origin/main` (hand-wrapped lines biome's formatter
rejects), red on `biome ci .` before this branch and unrelated to the
feature. `biome ci` lints the whole tree, so that pre-existing red
blocks every daemon PR regardless of diff scope. Applied biome's own
autofix to that one file (2 lines collapsed, zero behaviour change) so
the deterministic gate is green; called out here so the formatting-only
hunk is not mistaken for feature scope.

## Hypothesis self-grade

- **Predicted**: wiring the pure gate into the conductor's only code-write site emits the `.minsky/runany-policy.jsonl` ledger (run-start + one verdict per attempt) and refuses any merge whose target is not provably home, so 0 foreign code pushes occur and the pre-registered measurement reads real data.
- **Observed**: policy-ledger 9/9 + local-gate-merge 24/24; the new cells show home→allowed+merge with an emitted allowed `push-code` verdict, and unprovable-origin→`foreign`→refused with `mergeFn` never called and a `foreign-push-refused` verdict emitted.
- **Match**: partial
- **Lesson**: the enforcement + emit half is proven end-to-end at the wiring layer; the full `{foreign_code_pushes:0,…,minsky_self_tasks_filed:>=1}` fixture verdict still needs #602's reader merged and the minsky-self scout slice, so the task hypothesis stays partially open by design.
