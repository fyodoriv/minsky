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

This is **slice 1** of `commit-hook-chain-node-version-and-platform-resilience`
(P0): the durable class fix per CLAUDE.md Feedback-Loop Guardrails ("every bug
becomes a rule — prevent the *class*, not the instance") and vision.md rule #6
("fail loudly at the actionable boundary"). It converts both divergence shapes
into one operator-actionable line at commit time instead of an opaque trace.

## What this slice ships

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
- `package.json` — a `check-toolchain` script as the documented manual
  entrypoint.

Deferred to reviewed follow-up slices, each already enumerated in the parent
task's § Details: (b) wiring into `pnpm pre-pr-lint` / a verify gate (the
`STACK_MANIFEST` parity harness makes that self-contained); (c) pinning
`@biomejs/cli-darwin-arm64` into `optionalDependencies` + regenerating
`pnpm-lock.yaml`; and the lefthook phase-split that runs this assertion
*before* the heavy biome/typecheck/test steps.

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

## Hypothesis self-grade

- **Predicted**: a deterministic toolchain classifier wired into pre-commit
  converts both divergence shapes (node-version drift, missing per-arch biome)
  into one operator-actionable line at commit time instead of the opaque
  `MODULE_NOT_FOUND` that silently 100%-blocked the fleet.
- **Observed**: 17/17 paired tests pass over the verdict table; the CLI exits
  0 on the pinned node with binaries resolving and exits 1 with a
  self-contained remediation line (no opaque trace) on any divergence.
- **Match**: partial
- **Lesson**: the pure-classifier seam lands the assertion without a real node
  switch in CI; the next slice wires it into the verify/pre-pr-lint gate so
  divergence is also caught at install, closing the parent task's § Success.

## Security & privacy

§ 13 reviewed — no new security surface. This is commit-path reliability: the
new script only *reads* `.node-version` and probes module resolution; it
introduces no auth, secrets, network, or PII handling. It strengthens the
existing posture by making the scan-secrets pre-commit gate's failure loud and
explicitly forbidding the `--no-verify` bypass in its remediation text (a
silently-broken hook chain previously degraded that gate to "no commits, so no
scan" rather than a visible, actionable failure).

`optimization: none-this-iteration: substrate-creation slice (new classifier +
node-version pin + hook command); the skip-earlier-gate optimization — abort
before the heavy biome/typecheck/test steps run on a doomed commit — is sized
as its own next slice because a fail-fast ordering that does not serialise the
common green path needs a two-phase lefthook group, not a one-line edit.`
