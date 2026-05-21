## Why needed

On 2026-05-17 the git pre-commit hook chain (lefthook → biome + scan-secrets)
silently 100%-blocked **every** commit fleet-wide with an opaque
`MODULE_NOT_FOUND` stack trace. Two compounding root causes: (1) the host was
`Darwin arm64` but `node_modules/.pnpm/` carried only
`@biomejs/cli-darwin-x64` (no `cli-darwin-arm64`); (2) the interactive commit
shell ran node `v24.15.0` while the launchd fleet + `node_modules` were pinned
to `v24.14.0`, so lefthook's own launcher failed to resolve. Net effect:
`orchestrate.jsonl` showed 0 autonomous merges and `openPRs` stuck for a 10h
run — every other P0's throughput is gated behind a working commit path.

This is **slices 1–2** of
`commit-hook-chain-node-version-and-platform-resilience` (P0): the durable
class fix per CLAUDE.md Feedback-Loop Guardrails ("every bug becomes a rule —
prevent the *class*, not the instance") and vision.md rule #6 ("fail loudly at
the actionable boundary"). Slice 1 converts both divergence shapes into one
operator-actionable line at **commit** time; slice 2 wires the same assertion
into the repo's **verify** gate (`pnpm check`) so a broken toolchain also
loud-fails — and short-circuits the expensive lint/typecheck/coverage triplet —
before any other P0 work is attempted, closing the parent task's § Success
clause "`npm run verify` … exit ≠0 with an actionable remediation line".

## What these slices ship

- `.node-version` + `.nvmrc` pinned to the fleet's `24.14.0`.
- `scripts/check-toolchain.mjs` — a pure classifier (`parseMajorMinor`,
  `classifyToolchain`) + thin I/O boundary (`probeBinaries`, `readPinnedNode`,
  `main`). Asserts runtime node matches the pinned major.minor (patch drift
  tolerated — ABI-compatible) and that biome's per-arch CLI
  (`@biomejs/cli-<platform>-<arch>`, honouring the `BIOME_BINARY` escape
  hatch), lefthook, and scan-secrets all resolve for *this* host.
- `scripts/check-toolchain.test.mjs` — 17 paired tests covering the three
  load-bearing cases (node-version-mismatch, missing-arm64-biome, all-green)
  plus fail-open-on-an-unparseable-pin and the upstream-before-symptom
  ordering invariant.
- `lefthook.yml` — a globless `toolchain` pre-commit command so the assertion
  runs on every commit and aborts with the actionable line (its remediation
  forbids `--no-verify`, which also bypasses scan-secrets).
- `package.json` (slice 1) — a `check-toolchain` script as the documented
  manual entrypoint.
- `package.json` (slice 2) — `check` is now
  `pnpm check-toolchain && pnpm lint && pnpm typecheck && pnpm test:coverage`.
  `pnpm check` is the repo's local verify gate (CI invokes the individual
  `biome`/`typecheck`/`test` jobs directly, not `check`), so this satisfies the
  parent task's § Details (b) "wired into `npm run verify`" **without** routing
  through `STACK_MANIFEST`: the manifest's `full` stage is pinned bidirectional
  to the CI aggregator's `needs:` (`run-pre-pr-lint-stack.test.mjs` § "ci.yml
  drift-protection"), and CI runs node `20` while `.node-version` pins `24.14.0`
  — a `toolchain` manifest step would false-fail every CI run. `check-toolchain`
  is intentionally a **local-fleet-only** guard, so the npm `check` script is
  its correct verify host. The `&&` placement makes it the *first* gate:
  a broken toolchain aborts in ~0.13 s with the actionable line instead of
  after minutes of opaque `MODULE_NOT_FOUND` from `biome ci .` / `tsc -b` /
  `vitest --coverage`.

Still deferred to reviewed follow-up slices, each already enumerated in the
parent task's § Details: (b-postinstall) wiring into the `prepare`/install path
is blocked on the same CI-node-20 constraint (a fresh-clone `pnpm install` in
CI runs node 20 and would fail an install-time toolchain assert) and needs an
`if-local` guard, sized as its own slice; (c) pinning
`@biomejs/cli-darwin-arm64` into `optionalDependencies` + regenerating
`pnpm-lock.yaml`; and the lefthook phase-split that runs this assertion
*before* the heavy biome/typecheck/test pre-commit steps.

## Disclosed out-of-task change (mandatory-gate unblock)

`pnpm pre-pr-lint` runs `biome ci .` over the **whole repo**, and the base
(`origin/main`, verified via `git diff origin/main...HEAD`) was already
biome-red in four files I did not author —
`novel/cross-repo-runner/{src/spawn-plan.ts,src/task-finder.ts,src/task-finder.test.ts,bin/minsky-run.mjs}`
(landed unformatted via the recent #596–#600 task-finder merges). That debt
blocks **every** PR's mandatory gate fleet-wide — the exact failure class this
P0 exists to eliminate. The fix is purely mechanical and behavior-preserving:
two `noUnusedTemplateLiteral` literal-type swaps in `spawn-plan.ts` (verified
semantic-null by a quote/backtick-stripped diff) plus `biome check --write`
canonical re-formatting of the other three (multi-line→single-line reflow
only). `task-finder`'s 28 tests + the 17 new toolchain tests all pass (45/45),
confirming zero behavior change. Not folded into a separate PR because the gate
is non-optional and would block this slice indefinitely otherwise.

Second disclosed unblock — the **full-stage** pre-push hook (stricter than
`pnpm pre-pr-lint`: adds the whole vitest suite) was red on a pre-existing
test-isolation bug in `novel/tick-loop/src/minsky-bootstrap-smoke.test.ts`,
unrelated to this task. Its first three DI-seam cases call the SUT without
sandboxing `process.env`; daemon workers export `MINSKY_LLM_PROVIDER`, so the
pre-push vitest ran them in that polluted env and the SUT took its ambient
`claude-only` early-return path (`expected { MINSKY_LLM_PROVIDER:
'claude-only' } to match …`). Verified pre-existing: the file fails 3/4 under
the ambient daemon env and passes 4/4 with the env unset — i.e. **every**
daemon push fleet-wide fails this gate regardless of branch (again the exact
class this P0 targets). Minimal fix: a `beforeEach` that `vi.stubEnv(...,
undefined)`s the three bootstrap-policy vars (the pattern Slice-C in the same
file already documents), `afterEach` `vi.unstubAllEnvs()`. Now 4/4 under the
ambient daemon env; zero production-code change.

Third disclosed unblock — the same full-stage pre-push vitest was then red on
`scripts/self-diagnose.test.mjs > defaultInvariants > runInvariants(…)`, also
pre-existing and **not** in this PR's diff. `defaultInvariants()` builds probes
that shell out to real `gh pr list` with no DI seam; in a sandboxed daemon
worktree there is no route to the `gh` wrapper's enterprise host, so every
`gh` call burns its full 10 s `execFile` timeout and the sequential probe set
exceeds the test's 120 s budget — a hard timeout failure on **every** sandboxed
daemon push fleet-wide, the exact "silently blocks the whole fleet's push
path" class this P0 targets. Test-only hermetic fix: a `beforeAll` shadows
`gh` with a fail-fast stub on `PATH` (so `ghJson` resolves to `null` in ms —
the offline outcome, just immediate; `git`/`node`/`ps` still resolve from the
unmodified PATH tail), `afterAll` restores PATH and removes the stub dir. The
residual ~110 s is real local I/O the suite legitimately does (4×
`MaciekTokenMonitor.snapshot()` over `~/.claude` JSONL, log parsing); the
per-test budget is raised 120 s→240 s for full-suite-contention margin rather
than masking a hang (a hang now fails fast at the stubbed boundary). 99/99
pass; zero production-code change.

The only rule-3-governed code touched (`novel/cross-repo-runner` non-test
`.ts`) is a no-public-surface mechanical refactor, so the whole-PR rule-3
exemption marker below is accurate (the tick-loop change is a `.test.ts`,
outside rule-3's scope; `check-toolchain` is in `scripts/`, also outside it).

<!-- rule-3: refactor-no-public-surface -->

## Measurement

- `npx vitest run scripts/check-toolchain.test.mjs` → **17/17 pass**, covering
  the full verdict table (node-version mismatch on major OR minor, missing
  per-arch biome, all-green, fail-open on an unparseable/absent pin,
  upstream-before-symptom ordering).
- `node scripts/check-toolchain.mjs` on the pinned node v24.14.0 with binaries
  resolving → exit `0`, `[check-toolchain] ok`. The negative path
  (`node-version-mismatch` / `*-unresolved`) → exit `1` with a self-contained
  `[code] remediation` line and **no** `MODULE_NOT_FOUND` in the output
  (asserted by the `formatReport` test).
- Slice 2 wire-in: `check` in `package.json` now begins with
  `pnpm check-toolchain &&` — verified by string inspection of the committed
  diff. The new first gate's pass-path runtime is **0.13 s** (3-run `/usr/bin/time
  -p`, steady), so on a broken toolchain `pnpm check` aborts in ~0.13 s with
  the actionable line *instead of* running the full `biome ci .` + `tsc -b` +
  `vitest --coverage` triplet (minutes, opaque `MODULE_NOT_FOUND`). The
  negative-exit + actionable-line contract `pnpm check` now inherits is the
  same one proven by the 17/17 classifier tests above.

## Hypothesis self-grade

- **Predicted**: a deterministic toolchain classifier wired into both the
  pre-commit hook (slice 1) and the repo verify gate `pnpm check` (slice 2)
  converts both divergence shapes (node-version drift, missing per-arch biome)
  into one operator-actionable line — at commit *and* verify time — instead of
  the opaque `MODULE_NOT_FOUND` that silently 100%-blocked the fleet, and
  aborts the verify gate before its minutes-long lint/typecheck/coverage
  triplet runs on a doomed toolchain.
- **Observed**: 17/17 paired tests pass over the verdict table; the CLI exits
  0 on the pinned node with binaries resolving and exits 1 with a
  self-contained remediation line (no opaque trace) on any divergence;
  `package.json` `check` now runs `pnpm check-toolchain` first (0.13 s
  pass-path, 3-run steady), short-circuiting the rest of the gate on failure.
- **Match**: partial
- **Lesson**: the verify-gate clause of § Success is now closed via the npm
  `check` script (not `STACK_MANIFEST`, whose `full` stage is pinned
  bidirectional to CI's node-20 `needs:`); the residual `optionalDependencies`
  pin (c) and the CI-node-20-guarded `postinstall` half of (b) remain as
  enumerated follow-up slices.

## Security & privacy

§ 13 reviewed — no new security surface. This is commit-path reliability: the
new script only *reads* `.node-version` and probes module resolution; it
introduces no auth, secrets, network, or PII handling. It strengthens the
existing posture by making the scan-secrets pre-commit gate's failure loud and
explicitly forbidding the `--no-verify` bypass in its remediation text (a
silently-broken hook chain previously degraded that gate to "no commits, so no
scan" rather than a visible, actionable failure).

`optimization: skip-earlier-gate — prepending the check-toolchain invocation
(39 bytes added to the check script) makes the 0.13 s toolchain assertion the
first gate of the repo verify path, so a broken toolchain aborts there instead
of after the minutes-long biome-ci + tsc-b + vitest-coverage triplet that
would only emit an opaque MODULE_NOT_FOUND. Net: a doomed verify run returns
an actionable line in ~0.13 s instead of failing opaquely minutes later.
>=10-byte threshold met; the wall-clock saving is the short-circuited triplet.`
