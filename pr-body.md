## Why needed

The git pre-commit hook chain (`lefthook` → `biome` + `scan-secrets`) silently
100%-blocked **every commit fleet-wide** for ~10h on 2026-05-17 with an opaque
`MODULE_NOT_FOUND`. Two compounding causes: (1) the interactive shell ran
`node v24.15.0` while the fleet + `node_modules` were pinned to `v24.14.0`, so
`lefthook`'s own launcher failed to resolve; (2) the host-arch biome platform
optional dep (`@biomejs/cli-<platform>-<arch>`) was missing, so `pnpm biome`
died with `MODULE_NOT_FOUND`. A broken commit path zeroes autonomous-merge-rate
— every worker iteration that produces edits is gated behind it (P0
`commit-hook-chain-node-version-and-platform-resilience`).

## What this ships (slice 1 of N)

Durable, loud-not-silent class fix for the **commit path** (the highest-leverage
half — the part that was actually blocking the fleet):

- **`.node-version` + `.nvmrc`** pinned to `24.14.0` (fnm/asdf + nvm).
- **`scripts/check-toolchain.mjs`** — a pure `assessToolchain(facts)` classifier
  plus a loud CLI. Detects node major.minor drift, a missing host-arch biome
  launcher (resolved the way biome's own launcher does — anchored at
  `@biomejs/biome`, honouring `BIOME_BINARY`, so pnpm's non-hoisted optional
  deps don't false-negative), and an unresolvable `lefthook`. Never throws;
  exits ≠0 with a one-line `fnm use` / `pnpm install` remediation instead of an
  opaque stack trace (vision.md rule #6).
- **`scripts/check-toolchain.test.mjs`** — 16 paired tests: node minor/major
  drift, patch-drift tolerance, missing-biome, missing-lefthook, malformed pin,
  all-green, + the real-branch `.node-version` invariant.
- Wired into **lefthook `pre-commit`** (unconditional `toolchain` command) and
  **`package.json` `postinstall`** (rule #10 — one guard, every gate).
- **`docs/toolchain-resilience.md`** — recovery runbook + `BIOME_BINARY` escape
  hatch + node-version requirement.

Deferred to a focused follow-up slice (noted in the doc): pinning the host-arch
biome cli into `optionalDependencies` + regenerating `pnpm-lock.yaml`, and
wiring `check-toolchain` into `pnpm pre-pr-lint` / CI — that surface is tightly
drift-tested (ci.yml `needs:` ↔ manifest ↔ docs bidirectional parity) and
warrants its own change rather than ballooning this one.

## Optimization (operator directive 2026-05-05)

`optimization: skip-earlier gate` — the pre-commit `toolchain` step
short-circuits the opaque-`MODULE_NOT_FOUND` debugging round-trip. MTTR for this
failure class drops from "invisible until someone reads a hook stack trace"
(~10h observed) to an immediate one-line remediation at the actionable
boundary; the operator round-trip (reproduce → bisect → read trace → identify
node/arch drift) is eliminated, not merely shortened.

## Manual test delta

```text
$ node scripts/check-toolchain.mjs
check-toolchain: OK (node v24.14.0, darwin-x64, biome+lefthook resolvable). (exit 0)

$ node -e "import('./scripts/check-toolchain.mjs').then(m=>{const r=m.assessToolchain({runningNodeVersion:'v24.15.0',pinnedNodeVersion:'24.14.0',platform:'darwin',arch:'arm64',biomePlatformPkgPresent:true,lefthookResolvable:true});process.exit(r.ok?0:1)})"
# exits 1, prints: node v24.15.0 ≠ pinned v24.14.0 (.node-version). Run `fnm use` ...

$ npx vitest run scripts/check-toolchain.test.mjs
Test Files 1 passed (1) / Tests 16 passed (16)
```

## Security & privacy

No new attack surface. The guard reads `.node-version` and resolves package
metadata from the local `node_modules` — no network, no secrets, no PII, no
new dependency. It explicitly reinforces the existing boundary by telling
operators **not** to use `git commit --no-verify` (which would also bypass
`scan-secrets`, vision.md § 13.1). § 13 reviewed.

## Hypothesis self-grade

- **Predicted**: a node-version switch or a missing platform optional dep silently 100%-blocks every commit fleet-wide with an opaque `MODULE_NOT_FOUND`; after this slice, that divergence is caught at install time and as a one-line pre-commit hook failure instead of silently zeroing fleet throughput.
- **Observed**: `node scripts/check-toolchain.mjs` exits 0 on the pinned node with biome+lefthook resolvable; injecting a node minor drift / missing-biome / missing-lefthook each yields exit 1 with a distinct actionable remediation line (16/16 tests green); `pnpm biome` confirmed working via the launcher-anchored resolution (the naive repo-root resolve false-negatived and was fixed).
- **Match**: yes
- **Lesson**: mirror the consumer's own resolution algorithm (biome anchors at its package, not repo root) when asserting a transitive optional dep is present — a repo-root `require.resolve` false-negatives under pnpm's non-hoisted layout.
