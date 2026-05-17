<!-- pattern: see vision.md § "Pattern conformance index" rows tagged `rule #6` (fail loud at the actionable boundary) and `rule #10` (deterministic enforcement) — this doc is the operator-facing runbook for the toolchain guard that TASKS.md `commit-hook-chain-node-version-and-platform-resilience` ships. -->

# Toolchain resilience — node version + biome platform binary

> The git pre-commit hook chain (`lefthook` → `biome` + `scan-secrets`) silently 100%-blocked **every commit fleet-wide** for ~10h on 2026-05-17 with an opaque `MODULE_NOT_FOUND`. `scripts/check-toolchain.mjs` exists so that failure can never again be silent: a toolchain mismatch now fails with a one-line, operator-actionable message instead of a stack trace nobody reads until throughput has been zero for hours.

## The two root causes (2026-05-17 live repro)

1. **Node-version drift.** The interactive commit shell ran `node v24.15.0` while the launchd fleet + `node_modules` were installed under `v24.14.0`. `lefthook`'s own launcher (`node_modules/lefthook/bin/index.js`) failed to resolve under the mismatched node → opaque `MODULE_NOT_FOUND`, no hook ran.
2. **Missing platform optional dep.** A reinstall dropped the host-arch biome launcher binary (`@biomejs/cli-<platform>-<arch>`). `pnpm biome` (a pre-commit step) died with `MODULE_NOT_FOUND` from `@biomejs/biome/bin/biome`.

Either alone blocks 100% of commits. `--no-verify` is **not** an escape hatch — it also bypasses `scan-secrets` (vision.md § 13.1).

## The guard

`scripts/check-toolchain.mjs` is wired into three gates (rule #10 — one guard, every gate):

- **`postinstall`** (`package.json`) — catches the divergence the moment `pnpm install` finishes.
- **lefthook `pre-commit`** (`lefthook.yml`, `toolchain` command, runs unconditionally) — the load-bearing fix: a node-version / platform-dep drift surfaces as a one-line `fnm use` / `pnpm install` remediation **before** the opaque biome/lefthook trace.
- Direct: `node scripts/check-toolchain.mjs` — exit 0 = commit-ready, exit 1 = a problem list with remediation.

It is **loud, never silent** (rule #6): every detected problem prints its own actionable line; the guard itself never throws (a malformed pin is reported, not raised), so it can never become the opaque failure it exists to prevent.

## Node-version requirement

The repo pins node in **`.node-version`** (fnm/asdf) and **`.nvmrc`** (nvm). Both must agree. The guard compares `process.version` against the pin on **major.minor** — a patch drift is tolerated, a minor/major drift is the class that breaks launcher / native-addon resolution.

```bash
fnm use      # or: nvm use   — picks up .node-version / .nvmrc
node scripts/check-toolchain.mjs
```

If you bump the pinned node, change **both** `.node-version` and `.nvmrc` in the same commit and reinstall (`pnpm install`) so `node_modules` matches.

## Recovery runbook

| Symptom | Fix |
| --- | --- |
| `check-toolchain: node vX ≠ pinned vY` | `fnm use` (or `nvm use`) in this shell, then retry the commit. |
| `check-toolchain: @biomejs/cli-<p>-<a> is not installed` | `pnpm install` on this host. If it still fails, use the `BIOME_BINARY` escape hatch below. |
| `check-toolchain: lefthook is not resolvable` | `pnpm install` under the **pinned** node, then `pnpm dlx lefthook install`. |

### `BIOME_BINARY` escape hatch

biome's launcher (and `check-toolchain.mjs`) honour `BIOME_BINARY`. If the platform optional dep cannot be reinstalled (offline, arch drift), point it at an arch-correct biome binary:

```bash
export BIOME_BINARY=/absolute/path/to/biome   # arm64 host → an arm64 biome 1.9.4
node scripts/check-toolchain.mjs               # now passes via the override
```

The short-term 2026-05-17 unblock committed an arch-correct recovery binary at `.minsky/bin/biome-darwin-arm64` and exported `BIOME_BINARY` to it; the durable fix is keeping the platform dep in the lockfile so the override is only ever a fallback.

## Follow-up (not yet shipped)

Pinning the host-arch biome cli into `optionalDependencies` + regenerating `pnpm-lock.yaml`, and wiring `check-toolchain` into the `pnpm pre-pr-lint` / CI gate, are tracked as later slices of `commit-hook-chain-node-version-and-platform-resilience` (the CI-parity surface is tightly drift-tested and warrants its own focused change).
