<!-- rule-1: a generic adapter-namespace tool rejected because: `novel/adapters/` is reserved for *dependency adapters* (rule #2 — every external dep behind an interface). `novel/bridges/` is the parallel namespace for two-way (or read-only) inter-format bridges between *peer* substrates we own (e.g., OMC team-task JSON ↔ tasks.md), where neither side is "the dep" — both are first-class formats with their own owners. The split mirrors `pnpm-workspace.yaml`'s `novel/adapters/*` + `novel/bridges/*` and is checked by `scripts/check-rule-3-doc-first.mjs` + `scripts/check-pattern-index.mjs` (both already include `bridges` in their `NESTED` namespace lists). Helland 2007 (eventual-consistency bridges) is the load-bearing pattern; the namespace exists so each bridge package gets a stable home and a predictable rule-1 / rule-2 boundary. -->

# `novel/bridges/`

Inter-format bridges between peer substrates Minsky owns (or reads). Each bridge is a separate package with its own README + chaos-verification table.

Current bridges:

- [`@minsky/omc-tasksmd-bridge`](./omc-tasksmd/README.md) — read-only OMC team-task JSON → tasks.md (v0).

The split between `novel/adapters/` (rule #2 — every external *dependency* behind an interface) and `novel/bridges/` (a *peer* format we own or read alongside our own) is intentional: a bridge is symmetric in spirit even when v0 ships only the read direction (Helland 2007 — read-side first when the write-side needs a CRDT story).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

This README documents the *namespace*; each contained bridge package owns its own chaos table. The namespace itself is a directory of READMEs and has no runtime — there is no I/O, no parsing, no shared state to chaos-test at this level. Per-bridge tables live in each package's `README.md`.

- **Steady-state hypothesis**: every bridge package under `novel/bridges/` declares its own chaos table; the `scripts/check-rule-7-chaos-coverage.mjs` linter enforces this on each package's `README.md` independently.
- **Blast radius**: zero — this README is documentation, not runtime code.
- **Operator escape hatch**: the per-package READMEs each carry their own chaos table.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | A new bridge package lands without its own chaos table | governance lapse | `circuit-break-and-notify` — `scripts/check-rule-7-chaos-coverage.mjs` fails the PR | covered by `scripts/check-rule-7-chaos-coverage.test.mjs` (the linter's paired test asserts the file-level policy) |
| 2 | A bridge package ships a write path before v1+ CRDT story | rule violation | `circuit-break-and-notify` — the bridge's own README's chaos table must declare it; reviewers reject otherwise | covered by per-package fixture + assertion (e.g., `novel/bridges/omc-tasksmd/src/sync.test.ts` asserts merge-by-id throws in v0) |

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: peer-format payloads each contained bridge reads (e.g., OMC team-task JSON written by a sibling process under the same user account).
- **Trusted state**: this README is namespace-only with zero runtime; per-bridge READMEs own their per-package threat models.
- **Trust boundary**: each contained bridge package sits at the boundary; the namespace itself has no I/O, no parser, no shared state — nothing to tamper with at this level.
- **STRIDE focus**: **T**ampering — bridges are read-only in v0 (Helland 2007 — read-side first when the write-side needs a CRDT story); a write path lands only with a per-package CRDT design documented in its own threat model.
- **Performance-first carve-out** (rule #13's relief valve): none declared.
