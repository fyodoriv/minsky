# Commit-hook toolchain resilience

The git `pre-commit` chain (lefthook → `check-toolchain` + biome +
`scan-secrets`) and the `pnpm check` verify gate both run `node
scripts/check-toolchain.mjs` first. This runbook explains why and what to
do when it fails.

## Why this gate exists

On 2026-05-17 the pre-commit chain silently 100%-blocked **every** commit
fleet-wide with an opaque `MODULE_NOT_FOUND` stack trace. Two compounding
root causes:

1. **Platform incompleteness** — the host was `Darwin arm64` but
   `node_modules/.pnpm/` carried only `@biomejs/cli-darwin-x64` (no
   `cli-darwin-arm64`). Biome's launcher `require()`s the per-arch CLI
   package and threw `MODULE_NOT_FOUND` instead of a remediation.
2. **Node-version drift** — the interactive shell ran node `v24.15.0`
   while the launchd fleet + `node_modules` were pinned to `v24.14.0`, so
   lefthook's own launcher failed to resolve under the mismatched node.

Net effect: 0 autonomous merges for a 10h run — every other P0's
throughput is gated behind a working commit path. Per CLAUDE.md
Feedback-Loop Guardrails ("every bug becomes a rule — prevent the
*class*, not the instance") and vision.md rule #6 ("fail loudly at the
actionable boundary"), `check-toolchain` converts both divergence shapes
into one operator-actionable line.

## Node-version requirement

The fleet's node is pinned in `.node-version` and `.nvmrc` (read by fnm /
nvm / nodenv / asdf). Run the interactive commit shell and the launchd
fleet on the **same pinned major.minor**. Patch drift is tolerated (node
patch releases are ABI-compatible); a minor bump is not.

```sh
fnm use      # or: nvm use / nodenv local
```

`check-toolchain` asserts `process.version` matches the pin and hard-fails
with `wrong node vX, expected vY` rather than an opaque trace.

## Platform completeness

`@biomejs/cli-darwin-arm64` is pinned as a root `optionalDependencies`
entry (in addition to biome's transitive optional dep) so a reinstall on
the host arch cannot silently drop it. `check-toolchain` resolves
`@biomejs/cli-<platform>-<arch>`, `lefthook`, and `scan-secrets` for
*this* host and names the missing one if any fails.

## Recovery — `BIOME_BINARY` escape hatch

If the per-arch biome CLI package is missing and a reinstall is not
immediately possible, point biome at a committed arch-correct binary:

```sh
export BIOME_BINARY="$REPO/.minsky/bin/biome-$(node -p process.platform)-$(node -p process.arch)"
```

`check-toolchain` honours `BIOME_BINARY` when it points at an existing
file, so the gate goes green again without an opaque trace. This is a
recovery path, not the steady state — fix the install (`fnm use && pnpm
install`) so the optional dep is fetched normally.

**Never** use `git commit --no-verify`: it also bypasses `scan-secrets`
(vision.md § 13.1), trading a toolchain problem for a credential-leak
problem.

## When the gate fails

`check-toolchain` prints `[check-toolchain] FAIL:` followed by one
self-contained, actionable line per violation. Do exactly what the line
says — it names the remediation (`fnm use`, `pnpm install`, or the
`BIOME_BINARY` override). The `[check-toolchain] ok` / `FAIL` leading
tokens are stable for log greps.
